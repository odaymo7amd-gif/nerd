// تسجيل استهلاك الذكاء الاصطناعي وحساب التكلفة وتطبيق الحد اليومي لكل مستخدم.

import { get, run } from '../db.ts';
import { HttpError } from '../http.ts';
import { readAiConfig } from './config.ts';

export interface UsageRecord {
  userId: number;
  task: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  status: 'success' | 'failed';
}

export interface DailyUsage {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

function settingNumber(key: string, fallback: number): number {
  const row = get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key);
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function dailyLimitPerUser(): number {
  const envFallback = Number(process.env.AI_DAILY_LIMIT_PER_USER ?? 30);
  return settingNumber('ai_daily_limit_per_user', Number.isFinite(envFallback) ? envFallback : 30);
}

export function computeCost(tokensIn: number, tokensOut: number): { costUsd: number; costKnown: boolean } {
  const config = readAiConfig();
  const costKnown = config.inputPricePerMTok > 0 || config.outputPricePerMTok > 0;
  const costUsd =
    (tokensIn / 1_000_000) * config.inputPricePerMTok + (tokensOut / 1_000_000) * config.outputPricePerMTok;
  return { costUsd: Number(costUsd.toFixed(6)), costKnown };
}

export function usageToday(userId: number): DailyUsage {
  const row = get<{
    requests: number;
    tokens_in: number;
    tokens_out: number;
    cost: number;
  }>(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(tokens_in), 0) AS tokens_in,
            COALESCE(SUM(tokens_out), 0) AS tokens_out,
            COALESCE(SUM(cost_usd), 0) AS cost
       FROM ai_usage_logs
      WHERE user_id = ? AND status = 'success' AND created_at >= datetime('now', 'start of day')`,
    userId,
  );
  return {
    requests: row?.requests ?? 0,
    tokensIn: row?.tokens_in ?? 0,
    tokensOut: row?.tokens_out ?? 0,
    costUsd: row?.cost ?? 0,
  };
}

// يُستدعى قبل بدء العمل: يضمن أن الطلبات المخطّطة (دفعات + دمج) لا تتجاوز الحد اليومي
export function assertQuota(userId: number, plannedRequests = 1): void {
  const limit = dailyLimitPerUser();
  const used = usageToday(userId).requests;
  const remaining = Math.max(0, limit - used);
  if (remaining < plannedRequests) {
    throw new HttpError(
      429,
      plannedRequests === 1
        ? `وصلت إلى الحد اليومي لاستخدام الذكاء الاصطناعي (${limit} طلبًا). يتجدّد الحد غدًا.`
        : `هذه العملية تحتاج ${plannedRequests} طلبًا وتنفّذ اليوم ${used} من أصل ${limit}. قلّل نطاق التلخيص أو أعد المحاولة غدًا.`,
    );
  }
}

export function recordUsage(record: UsageRecord): number {
  const { costUsd } = computeCost(record.tokensIn, record.tokensOut);
  run(
    `INSERT INTO ai_usage_logs (user_id, task, provider, model, tokens_in, tokens_out, cost_usd, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    record.userId,
    record.task,
    record.provider,
    record.model,
    record.tokensIn,
    record.tokensOut,
    record.status === 'success' ? costUsd : 0,
    record.status,
  );
  return costUsd;
}
