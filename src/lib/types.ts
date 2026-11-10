export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: 'student' | 'admin';
  avatarUrl: string | null;
  countryId: number | null;
  curriculumId: number | null;
  gradeLevelId: number | null;
  semesterId: number | null;
  theme: 'dark' | 'light';
  notificationsEnabled: boolean;
  isActive: boolean;
  isDeveloper: boolean;
  onboarded: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

export interface Stats {
  studyMinutes: number;
  questionsAnswered: number;
  testsCompleted: number;
  savedQuestions: number;
  points: number;
  streakDays: number;
  dailyGoalMinutes: number;
  updatedAt: string;
}

export interface Feature {
  key: string;
  title: string;
  description: string;
  phase: number;
  enabled: boolean;
  href: string | null;
  maintenanceMessage?: string | null;
}

export interface ActivityItem {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface ProfilePayload {
  user: AuthUser;
  stats: Stats;
  curriculum: {
    countryName: string | null;
    curriculumName: string | null;
    gradeName: string | null;
    semesterName: string | null;
  };
  subjects: Array<{ id: number; name: string }>;
  counts: { books: number; contents: number; summaries: number; tests: number; questions: number };
}

export interface Subject {
  id: number;
  name: string;
  code: string;
}

export interface Curriculum {
  id: number;
  countryId: number;
  name: string;
  grades: Array<{ id: number; name: string; order: number }>;
  semesters: Array<{ id: number; name: string; order: number }>;
  subjects: Subject[];
}

export interface MetaPayload {
  countries: Array<{ id: number; code: string; name_ar: string }>;
  curricula: Curriculum[];
}

export interface HomePayload {
  user: AuthUser;
  greeting: string;
  gradeName: string | null;
  subjects: Array<{ id: number; name_ar: string }>;
  stats: Stats;
  unreadNotifications: number;
  motivation: string;
  activity: ActivityItem[];
  features: Feature[];
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: 'student' | 'admin';
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  gradeName: string | null;
  testsCompleted: number;
  points: number;
}

export interface AdminOverview {
  counts: {
    users: number;
    active7d: number;
    admins: number;
    books: number;
    tests: number;
    aiRequests: number;
    storageBytes: number;
    aiCostUsd: number;
  };
  signups: Array<{ day: string; count: number }>;
  settings: Record<string, string>;
}

export interface AdminSubject {
  id: number;
  name: string;
  code: string;
  curriculumId: number;
  curriculumName: string;
  isActive: boolean;
  unitsCount: number;
}

export interface AdminLog {
  id: number;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
  adminName: string | null;
}

export interface AiUsage {
  totals: { requests: number; tokens: number; costUsd: number };
  logs: Array<{
    id: number;
    task: string;
    provider: string | null;
    model: string | null;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    status: string;
    createdAt: string;
    username: string | null;
  }>;
}
