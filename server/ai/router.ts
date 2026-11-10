// AI Router مركزي: يوجّه مهام الذكاء الاصطناعي إلى Provider A أو B حسب نوع المهمة،
// ويجرّب المزوّد الاحتياطي فقط عند خطأ مؤقت. لا تُسجَّل المفاتيح ولا تُعاد للواجهة.

import { HttpError } from '../http.ts';
import { readAiConfig } from './config.ts';
import { chatCompletion, type ChatCompletionOptions, type ChatResult } from './provider.ts';
import { recordProviderEvent } from './monitor.ts';
import { computeCost } from './usage.ts';

export type AiProviderId = 'A' | 'B';
export type AiTask =
  | 'chat'
  | 'teacher'
  | 'arabic'
  | 'expression'
  | 'english'
  | 'tests'
  | 'summary'
  | 'bank'
  | 'content'
  | 'study'
  | 'vision'
  | 'general';

interface ProviderRuntime {
  id: AiProviderId;
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  visionModel: string;
}

interface TaskRoute {
  primary: AiProviderId;
  fallback: AiProviderId;
  requiresVision?: boolean;
}

const TASK_ROUTES: Record<AiTask, TaskRoute> = {
  chat: { primary: 'A', fallback: 'B' },
  teacher: { primary: 'A', fallback: 'B' },
  arabic: { primary: 'A', fallback: 'B' },
  expression: { primary: 'A', fallback: 'B' },
  english: { primary: 'B', fallback: 'A' },
  tests: { primary: 'B', fallback: 'A' },
  summary: { primary: 'B', fallback: 'A' },
  bank: { primary: 'B', fallback: 'A' },
  content: { primary: 'B', fallback: 'A' },
  study: { primary: 'B', fallback: 'A' },
  vision: { primary: 'B', fallback: 'A', requiresVision: true },
  general: { primary: 'B', fallback: 'A' },
};

const TASK_MODEL_SUFFIX: Record<AiTask, string> = {
  chat: 'CHAT',
  teacher: 'TEACHER',
  arabic: 'ARABIC',
  expression: 'EXPRESSION',
  english: 'ENGLISH',
  tests: 'TESTS',
  summary: 'SUMMARIES',
  bank: 'BANK',
  content: 'CONTENT',
  study: 'STUDY',
  vision: 'VISION',
  general: 'GENERAL',
};

const RETRYABLE_FALLBACK_CODES = new Set([
  'ai_rate_limited',
  'ai_timeout',
  'ai_network',
  'ai_unavailable',
  'ai_model_unavailable',
  'ai_quota_exhausted',
  'ai_empty_response',
  'ai_key_invalid',
]);

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function readProvider(id: AiProviderId, fallbackBaseUrl: string): ProviderRuntime {
  const prefix = `PROVIDER_${id}`;
  return {
    id,
    label: env(`${prefix}_NAME`) || `Provider ${id}`,
    apiKey: env(`${prefix}_API_KEY`),
    baseUrl: (env(`${prefix}_BASE_URL`) || fallbackBaseUrl).replace(/\/+$/, ''),
    model: env(`${prefix}_MODEL`),
    visionModel: env(`${prefix}_VISION_MODEL`),
  };
}

function isEnabled(provider: ProviderRuntime): boolean {
  return Boolean(provider.apiKey && provider.baseUrl && provider.model);
}

function readProviders(): Record<AiProviderId, ProviderRuntime> {
  const fallbackBaseUrl = readAiConfig().baseUrl;
  return {
    A: readProvider('A', fallbackBaseUrl),
    B: readProvider('B', fallbackBaseUrl),
  };
}

/** هل يوجد مزوّد خادم مهيأ؟ عندها لا يحتاج المستخدم إلى إدخال مفتاح. */
export function hasServerAiProviders(): boolean {
  const providers = readProviders();
  return isEnabled(providers.A) || isEnabled(providers.B);
}

export function aiProviderStatus() {
  const providers = readProviders();
  return {
    configured: isEnabled(providers.A) || isEnabled(providers.B),
    providers: (['A', 'B'] as const).map((id) => {
      const provider = providers[id];
      let baseUrlHost: string | null = null;
      try {
        baseUrlHost = new URL(provider.baseUrl).host;
      } catch {
        baseUrlHost = null;
      }
      return {
        id,
        label: provider.label,
        configured: isEnabled(provider),
        model: provider.model || null,
        vision: Boolean(provider.visionModel),
        baseUrlHost,
      };
    }),
  };
}

/** يحوّل مسمّى المهمة القادم من أداة إلى مسار توجيه ثابت. */
export function taskRoutingOverview() {
  const providers = readProviders();
  const describe = (id: AiProviderId, configured: boolean, task: AiTask) => ({
    id,
    label: providers[id].label,
    configured,
    model: configured ? taskModel(providers[id], task) : null,
  });
  return (Object.entries(TASK_ROUTES) as Array<[AiTask, TaskRoute]>).map(([task, route]) => ({
    task,
    primary: describe(route.primary, isEnabled(providers[route.primary]), task),
    fallback: describe(route.fallback, isEnabled(providers[route.fallback]), task),
    vision: Boolean(route.requiresVision),
  }));
}

export function canonicalTask(task?: string): AiTask {
  const value = (task ?? 'general').trim().toLowerCase();
  if (!value) return 'general';
  if (value.includes('vision') || value.includes('image')) return 'vision';
  if (value.includes('expression') || value.includes('writing')) return 'expression';
  if (value.includes('teacher') || value === 'ask-teacher') return 'teacher';
  if (value.includes('arabic')) return 'arabic';
  if (value.includes('english')) return 'english';
  if (value.includes('summary') || value.includes('kit')) return 'summary';
  if (value.includes('test') || value.includes('exam') || value.includes('quiz')) return 'tests';
  if (value.includes('content') || value.includes('title')) return 'content';
  if (value.includes('bank')) return 'bank';
  if (value.includes('chat')) return 'chat';
  if (value === 'tool-solver' || value === 'tool-grader' || value.includes('study')) return 'study';
  return 'general';
}

function taskModel(provider: ProviderRuntime, task: AiTask): string {
  if (task === 'vision') return provider.visionModel;
  const specific = env(`PROVIDER_${provider.id}_MODEL_${TASK_MODEL_SUFFIX[task]}`);
  return specific || provider.model;
}

function supportsTask(provider: ProviderRuntime, task: AiTask): boolean {
  if (!isEnabled(provider)) return false;
  return task === 'vision' ? Boolean(provider.visionModel) : Boolean(provider.model);
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof HttpError) || !error.code) return false;
  return RETRYABLE_FALLBACK_CODES.has(error.code);
}

/**
 * يوجّه الطلب إلى المزوّد الأساسي، ثم إلى الاحتياطي عند خطأ مؤقت فقط.
 * عند عدم تهيئة مزودي الخادم يعمل النظام القديم (مفتاح المتصفح) بلا تغيير.
 */
export async function routeChatCompletion(options: ChatCompletionOptions): Promise<ChatResult> {
  const providers = readProviders();
  if (!isEnabled(providers.A) && !isEnabled(providers.B)) {
    return chatCompletion({ ...options, skipRouter: true });
  }

  const task = canonicalTask(options.task);
  const route = TASK_ROUTES[task];
  const order: AiProviderId[] = [route.primary, route.fallback];
  let lastError: unknown = null;
  let attempted = false;

  for (const [attemptIndex, id] of order.entries()) {
    const provider = providers[id];
    if (!supportsTask(provider, task)) continue;
    const model = taskModel(provider, task);
    if (!model) continue;

    attempted = true;
    const startedAt = Date.now();
    try {
      const result = await chatCompletion({
        ...options,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        providerName: provider.label,
        model,
        allowedModels: [model],
        skipRouter: true,
      });
      const cost = computeCost(result.tokensIn, result.tokensOut).costUsd;
      recordProviderEvent({
        providerId: id,
        providerName: provider.label,
        task,
        model: result.model || model,
        status: 'success',
        latencyMs: Date.now() - startedAt,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: cost,
        fallbackUsed: attemptIndex > 0,
      });
      return result;
    } catch (error) {
      lastError = error;
      const code = error instanceof HttpError ? error.code : 'unknown';
      recordProviderEvent({
        providerId: id,
        providerName: provider.label,
        task,
        model,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        fallbackUsed: attemptIndex > 0,
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : 'خطأ غير معروف',
      });
      if (!isRetryable(error)) throw error;
      console.warn(`[nerd/ai] تعذّر المزوّد ${provider.label} (${task}/${code})؛ تجربة المزوّد الاحتياطي.`);
    }
  }

  if (lastError) throw lastError;
  if (attempted) {
    throw new HttpError(503, 'تعذّر تنفيذ الطلب لدى المزوّدين المتاحين.', 'ai_provider_unavailable');
  }
  throw new HttpError(
    503,
    'لم يُهيَّأ أي مزوّد ذكاء اصطناعي لهذه المهمة على الخادم. راجع إعدادات المزوّدين.',
    'ai_provider_unavailable',
  );
}

/**
 * فحص يدوي فقط من لوحة المطوّر. لا يُشغَّل تلقائيًا، ولا يسجّل مقابل استخدام المستخدمين.
 * الفحص يثبت الاتصال فعليًا بردّ من المزوّد، ولا يعرض المفتاح بأي شكل.
 */
export async function probeProvider(id: AiProviderId): Promise<{
  ok: boolean;
  providerId: AiProviderId;
  providerName: string;
  model: string;
  latencyMs: number;
  message: string;
}> {
  const provider = readProviders()[id];
  if (!isEnabled(provider)) {
    throw new HttpError(400, 'هذا المزوّد غير مهيَّأ على الخادم.', 'ai_provider_unavailable');
  }
  const startedAt = Date.now();
  const model = provider.model;
  try {
    const result = await chatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerName: provider.label,
      model,
      allowedModels: [model],
      skipRouter: true,
      messages: [
        { role: 'system', content: 'أجب بكلمة OK فقط دون شرح.' },
        { role: 'user', content: 'OK' },
      ],
      temperature: 0,
      maxTokens: 8,
      timeoutMs: 20_000,
    });
    const latencyMs = Date.now() - startedAt;
    recordProviderEvent({
      providerId: id,
      providerName: provider.label,
      task: 'health-check',
      model,
      status: 'success',
      latencyMs,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: computeCost(result.tokensIn, result.tokensOut).costUsd,
      fallbackUsed: false,
    });
    return {
      ok: true,
      providerId: id,
      providerName: provider.label,
      model,
      latencyMs,
      message: 'تم التحقق من اتصال المزوّد فعليًا.',
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const code = error instanceof HttpError ? error.code : 'unknown';
    const message = error instanceof Error ? error.message : 'تعذّر الاتصال بالمزوّد.';
    recordProviderEvent({
      providerId: id,
      providerName: provider.label,
      task: 'health-check',
      model,
      status: 'failed',
      latencyMs,
      fallbackUsed: false,
      errorCode: code,
      errorMessage: message,
    });
    return {
      ok: false,
      providerId: id,
      providerName: provider.label,
      model,
      latencyMs,
      message,
    };
  }
}
