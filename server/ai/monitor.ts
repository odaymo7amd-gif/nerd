import { all, get, run } from '../db.ts';

export interface ProviderEvent {
  providerId: string;
  providerName: string;
  task: string;
  model: string | null;
  status: 'success' | 'failed';
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  fallbackUsed: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export function recordProviderEvent(event: ProviderEvent): void {
  run(
    `INSERT INTO ai_provider_events
       (provider_id, provider_name, task, model, status, latency_ms, tokens_in, tokens_out, cost_usd,
        fallback_used, error_code, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event.providerId,
    event.providerName,
    event.task,
    event.model,
    event.status,
    Math.max(0, Math.round(event.latencyMs)),
    Math.max(0, Math.round(event.tokensIn ?? 0)),
    Math.max(0, Math.round(event.tokensOut ?? 0)),
    Math.max(0, event.costUsd ?? 0),
    event.fallbackUsed ? 1 : 0,
    event.errorCode ?? null,
    event.errorMessage ? event.errorMessage.slice(0, 500) : null,
  );
}

export interface ProviderEventSummary {
  providerId: string;
  providerName: string;
  requests: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  fallbacks: number;
  lastSeenAt: string | null;
}

export function providerEventSummary(from: string): ProviderEventSummary[] {
  return all<{
    provider_id: string;
    provider_name: string;
    requests: number;
    successes: number;
    failures: number;
    avg_latency: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    fallbacks: number;
    last_seen_at: string | null;
  }>(
    `SELECT provider_id, MAX(provider_name) AS provider_name,
            COUNT(*) AS requests,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,
            COALESCE(AVG(latency_ms), 0) AS avg_latency,
            COALESCE(SUM(tokens_in), 0) AS tokens_in,
            COALESCE(SUM(tokens_out), 0) AS tokens_out,
            COALESCE(SUM(cost_usd), 0) AS cost_usd,
            SUM(fallback_used) AS fallbacks,
            MAX(created_at) AS last_seen_at
       FROM ai_provider_events
      WHERE created_at >= ?
      GROUP BY provider_id
      ORDER BY requests DESC`,
    from,
  ).map((row) => ({
    providerId: row.provider_id,
    providerName: row.provider_name,
    requests: Number(row.requests ?? 0),
    successes: Number(row.successes ?? 0),
    failures: Number(row.failures ?? 0),
    avgLatencyMs: Math.round(Number(row.avg_latency ?? 0)),
    tokensIn: Number(row.tokens_in ?? 0),
    tokensOut: Number(row.tokens_out ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    fallbacks: Number(row.fallbacks ?? 0),
    lastSeenAt: row.last_seen_at,
  }));
}

export function lastProviderError(providerId: string): { message: string; createdAt: string } | null {
  const row = get<{ error_message: string | null; created_at: string }>(
    `SELECT error_message, created_at FROM ai_provider_events
      WHERE provider_id = ? AND status = 'failed'
      ORDER BY id DESC LIMIT 1`,
    providerId,
  );
  return row?.error_message ? { message: row.error_message, createdAt: row.created_at } : null;
}
