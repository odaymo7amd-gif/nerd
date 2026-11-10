// اختبار سريع لسلوك مزوّد الذكاء الاصطناعي: إعادة المحاولة، 413، تجاوز السياق،
// ورفض الطلب المحلي الكبير قبل إرساله. يتطلب scripts/mock-ai-server.mjs على 8799.
process.env.AI_BASE_URL = process.env.AI_BASE_URL ?? 'http://127.0.0.1:8799/v1';
process.env.AI_CHAT_MODEL = 'openai/gpt-oss-120b';
process.env.AI_ALLOWED_MODELS = 'openai/gpt-oss-120b';
process.env.AI_MAX_ATTEMPTS = '4';
process.env.AI_RETRY_BASE_MS = '30';
process.env.AI_CONTEXT_TOKENS = '4096';

const { chatCompletion } = await import('../server/ai/provider.ts');

const messages = [{ role: 'user' as const, content: 'اكتب كلمة واحدة.' }];
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

try {
  const result = await chatCompletion({ apiKey: 'flaky-key', messages });
  check('إعادة المحاولة بعد 503 تنجح', result.content.length > 0);
} catch (error) {
  check('إعادة المحاولة بعد 503 تنجح', false, error instanceof Error ? error.message : String(error));
}

for (const [key, expectedCode, label] of [
  ['too-large-key', 'ai_request_too_large', 'خطأ 413 من المزوّد يُصنّف كحجم طلب'],
  ['context-too-long-key', 'ai_request_too_large', 'خطأ السياق 400 يُصنّف كحجم طلب'],
  ['rate-limited-key', 'ai_rate_limited', 'خطأ 429 يُصنّف كحد استخدام'],
] as const) {
  try {
    await chatCompletion({ apiKey: key, messages });
    check(label, false, 'لم يُرمَ خطأ');
  } catch (error) {
    const actual = (error as { code?: string }).code;
    check(label, actual === expectedCode, `code=${actual}`);
  }
}

try {
  await chatCompletion({
    apiKey: 'smoke-test-key',
    messages: [{ role: 'user', content: 'ط'.repeat(30_000) }],
  });
  check('رفض الطلب الكبير قبل الإرسال', false, 'لم يُرفض');
} catch (error) {
  const actual = (error as { code?: string }).code;
  check('رفض الطلب الكبير قبل الإرسال', actual === 'ai_request_too_large', `code=${actual}`);
}

process.exitCode = failures === 0 ? 0 : 1;
