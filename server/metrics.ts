// عدادات حقيقية منذ تشغيل الخادم فقط. لا تُخزَّن في قاعدة البيانات ولا تُختلق قيم تاريخية.
interface RuntimeMetrics {
  startedAt: number;
  requests: number;
  apiRequests: number;
  errors: number;
  totalLatencyMs: number;
}

const state: RuntimeMetrics = {
  startedAt: Date.now(),
  requests: 0,
  apiRequests: 0,
  errors: 0,
  totalLatencyMs: 0,
};

export function recordRequest(path: string, status: number, latencyMs: number): void {
  state.requests += 1;
  state.totalLatencyMs += Math.max(0, latencyMs);
  if (path.startsWith('/api')) state.apiRequests += 1;
  if (status >= 500) state.errors += 1;
}

export function runtimeMetrics() {
  const uptimeMs = Date.now() - state.startedAt;
  return {
    uptimeSeconds: Math.round(uptimeMs / 1000),
    startedAt: new Date(state.startedAt).toISOString(),
    requests: state.requests,
    apiRequests: state.apiRequests,
    errors: state.errors,
    errorRate: state.requests > 0 ? Number(((state.errors / state.requests) * 100).toFixed(2)) : 0,
    avgLatencyMs:
      state.requests > 0 ? Math.round(state.totalLatencyMs / state.requests) : 0,
  };
}
