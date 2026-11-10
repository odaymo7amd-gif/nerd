export type RangeKey = 'today' | '7d' | '30d' | '90d' | 'all';

export interface DeveloperContext {
  admin: { username: string; email: string; memberSince: string };
  maintenance: { enabled: boolean; message: string };
  services: { database: string; server: string; aiConfigured: boolean };
  counts: { unreadFeedback: number; scheduledNotifications: number; disabledTools: number };
}

export interface ToolUsage {
  key: string;
  title: string;
  href: string | null;
  enabled: boolean;
  uses: number;
  users: number;
  share: number;
}

export interface ProviderCard {
  id: 'A' | 'B';
  label: string;
  configured: boolean;
  model: string | null;
  vision: boolean;
  baseUrlHost: string | null;
  requests: number;
  successes: number;
  failures: number;
  successRate: number | null;
  avgLatencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  fallbacks: number;
  lastSeenAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastHealthCheck: { status: string; createdAt: string; latencyMs: number } | null;
  connection: 'verified' | 'unverified' | 'failed' | 'unconfigured';
}

export interface OverviewData {
  range: RangeKey;
  rangeLabel: string;
  generatedAt: string;
  metrics: {
    users: number;
    activeToday: number;
    newUsers: number;
    disabledUsers: number;
    aiToday: number;
    aiRequests: number;
    aiSuccess: number;
    aiFailed: number;
    activeTools: number;
    feedbackOpen: number;
  };
  deltas: { newUsers: number | null; aiRequests: number | null };
  successRate: number | null;
  failureRate: number | null;
  series: Array<{ day: string; signups: number; ai: number; active: number }>;
  topTools: ToolUsage[];
  providers: ProviderCard[];
  errors: Array<{ id: string; source: string; title: string; message: string; createdAt: string }>;
  activity: Array<{
    id: number;
    kind: string;
    title: string;
    detail: string | null;
    username: string | null;
    createdAt: string;
  }>;
}

export interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  isDeveloper: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  gradeName: string | null;
  aiRequests: number;
  aiFailures: number;
  testsCount: number;
  summariesCount: number;
  contentsCount: number;
  topTool: string | null;
}

export interface UsersData {
  users: AdminUserRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  counts: { all: number; active: number; disabled: number; new: number };
}

export interface DeveloperUserDetail {
  user: {
    id: number;
    username: string;
    email: string;
    role: string;
    isActive: boolean;
    isDeveloper: boolean;
    onboarded: boolean;
    createdAt: string;
    lastActiveAt: string | null;
    gradeName: string | null;
    curriculumName: string | null;
    countryName: string | null;
    theme: string;
  };
  stats: {
    studyMinutes: number;
    testsCompleted: number;
    points: number;
    streakDays: number;
    questionsAnswered: number;
  };
  counts: {
    contents: number;
    tests: number;
    summaries: number;
    books: number;
    conversations: number;
    feedback: number;
    sessions: number;
  };
  ai: {
    requests: number;
    success: number;
    failed: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  topTools: ToolUsage[];
  activity: Array<{ id: number; kind: string; title: string; detail: string | null; createdAt: string }>;
  aiLogs: Array<{
    id: number;
    task: string;
    provider: string | null;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    status: string;
    createdAt: string;
  }>;
  feedback: Array<{ id: number; title: string; category: string; status: string; createdAt: string }>;
}

export interface AnalyticsData {
  range: RangeKey;
  rangeLabel: string;
  generatedAt: string;
  metrics: {
    totalUsers: number;
    newUsers: number;
    activeToday: number;
    wau: number;
    mau: number;
    retentionRate: number | null;
    churnRate: number | null;
    aiRequests: number;
    aiSuccess: number;
    aiFailed: number;
    tokens: number;
    costUsd: number;
    tests: number;
    summaries: number;
    contents: number;
    books: number;
    questions: number;
  };
  deltas: { newUsers: number | null; aiRequests: number | null };
  series: Array<{
    day: string;
    newUsers: number;
    activeUsers: number;
    aiRequests: number;
    aiSuccess: number;
    aiFailed: number;
    tokens: number;
    costUsd: number;
  }>;
  tools: ToolUsage[];
  providers: Array<{
    provider: string;
    model: string | null;
    requests: number;
    success: number;
    failed: number;
    successRate: number | null;
    tokens: number;
    costUsd: number;
  }>;
}

export interface AiData {
  range: RangeKey;
  rangeLabel: string;
  providers: ProviderCard[];
  routing: Array<{
    task: string;
    primary: { id: string; label: string; configured: boolean; model: string | null };
    fallback: { id: string; label: string; configured: boolean; model: string | null };
    vision: boolean;
  }>;
  totals: {
    requests: number;
    success: number;
    failed: number;
    tokens: number;
    costUsd: number;
    successRate: number | null;
  };
  logs: Array<{
    id: number;
    task: string;
    provider: string | null;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    status: string;
    errorCode: string | null;
    latencyMs: number | null;
    createdAt: string;
    username: string | null;
  }>;
  total: number;
  page: number;
  limit: number;
  pages: number;
  tasks: Array<{ task: string; requests: number }>;
  errors: Array<{
    id: number;
    provider: string;
    task: string;
    model: string | null;
    code: string | null;
    message: string | null;
    createdAt: string;
  }>;
  errorGroups: Array< {
    provider: string;
    task: string;
    code: string | null;
    repeats: number;
    lastAt: string;
  }>;
}

export interface Campaign {
  id: number;
  title: string;
  body: string;
  type: string;
  audience: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  createdAt: string;
  targetUserId: number | null;
  targetUsername: string | null;
  adminName: string | null;
}

export interface NotificationsData {
  campaigns: Campaign[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  counts: { all: number; scheduled: number; sent: number; cancelled: number };
}

export interface AdRecord {
  id: number;
  title: string;
  body: string;
  imagePath: string | null;
  imageUrl: string | null;
  audience: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRecord {
  key: string;
  title: string;
  description: string;
  phase: number;
  enabled: boolean;
  href: string | null;
  order: number;
  maintenanceMessage: string | null;
}

export interface ToolsData {
  maintenance: { enabled: boolean; message: string };
  tools: ToolRecord[];
}

export interface HealthData {
  server: {
    status: string;
    runtime: {
      uptimeSeconds: number;
      startedAt: string;
      requests: number;
      apiRequests: number;
      errors: number;
      errorRate: number;
      avgLatencyMs: number;
    };
    node: string;
    memoryMb: { rss: number; heapUsed: number };
  };
  database: { status: string; latencyMs: number; sizeBytes: number; users: number; records: number };
  ai: {
    status: string;
    message: string;
    providers: Array<{ id: string; label: string; configured: boolean; model: string | null; vision: boolean; baseUrlHost: string | null }>;
  };
  storage: { status: string; path: string };
  backups: { available: boolean; scriptAvailable: boolean; items: Array<{ name: string; createdAt: string | null; sizeBytes: number }> };
  errors: Array<{ id: number; source: string; code: string | null; message: string; path: string | null; createdAt: string }>;
  generatedAt: string;
}

export interface ActivityItem {
  key: string;
  source: string;
  kind: string;
  title: string;
  detail: string | null;
  createdAt: string;
  userId: number | null;
  actor: string | null;
  result: string | null;
}

export interface ActivityData {
  range: RangeKey;
  rangeLabel: string;
  items: ActivityItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface FeedbackReportRow {
  id: number;
  category: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  userId: number;
  username: string;
  repliesCount: number;
  lastReplyAt: string | null;
}

export interface FeedbackData {
  reports: FeedbackReportRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  counts: Record<string, number>;
}

export interface FeedbackDetailData {
  report: FeedbackReportRow & { resolvedAt: string | null; email: string };
  replies: Array<{
    id: number;
    body: string;
    authorRole: string;
    authorName: string | null;
    createdAt: string;
  }>;
}

export interface SettingsData {
  admin: { username: string; email: string; memberSince: string; role: string };
  app: {
    name: string;
    aiDailyLimit: number;
    feedbackEnabled: boolean;
    maintenance: { enabled: boolean; message: string };
  };
  services: {
    database: string;
    server: string;
    ai: Array<{ id: string; label: string; configured: boolean; model: string | null }>;
    storage: string;
  };
  runtime: {
    uptimeSeconds: number;
    startedAt: string;
    requests: number;
    apiRequests: number;
    errors: number;
    errorRate: number;
    avgLatencyMs: number;
    memoryMb: number;
    node: string;
  };
  backups: HealthData['backups'];
}
