import { Router } from 'express';
import { all, get } from '../db.ts';
import { requireUser } from '../auth.ts';
import { ensureStats, mapStats } from './profile.ts';

export const homeRouter = Router();

function motivationFor(points: number, streak: number, testsCompleted: number): string {
  if (streak >= 7) return 'التزامك مستمر 🔥 سبعة أيام وأكثر من الدراسة المتواصلة.';
  if (testsCompleted === 0 && points === 0) {
    return 'ابدأ بأول خطوة: جهّز كتابك الأول ثم أنشئ ملخصًا قصيرًا للمراجعة.';
  }
  if (points >= 500) return 'مستواك يتقدم بثبات، واصل بنفس الوتيرة.';
  return 'كل جلسة قصيرة اليوم أفضل من جلسة طويلة مؤجلة.';
}

homeRouter.get('/home', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const stats = ensureStats(user.id);

  const grade = user.gradeLevelId
    ? get<{ name_ar: string }>('SELECT name_ar FROM grade_levels WHERE id = ?', user.gradeLevelId)
    : undefined;

  const subjects = all<{ id: number; name_ar: string }>(
    `SELECT s.id, s.name_ar FROM user_subjects us
       JOIN subjects s ON s.id = us.subject_id
      WHERE us.user_id = ?
      ORDER BY s.sort_order`,
    user.id,
  );

  const activity = all<{ id: number; kind: string; title: string; detail: string | null; created_at: string }>(
    'SELECT id, kind, title, detail, created_at FROM activity_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 5',
    user.id,
  );

  const features = all<{
    key: string;
    title_ar: string;
    description_ar: string;
    phase: number;
    is_enabled: number;
    href: string | null;
    maintenance_message: string | null;
  }>('SELECT key, title_ar, description_ar, phase, is_enabled, href, maintenance_message FROM feature_flags ORDER BY sort_order');

  const unread = get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0',
    user.id,
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : hour < 22 ? 'مساء الخير' : 'ليلة هادئة';

  res.json({
    user,
    greeting,
    gradeName: grade?.name_ar ?? null,
    subjects,
    stats: mapStats(stats),
    unreadNotifications: unread?.count ?? 0,
    motivation: motivationFor(stats.points, stats.streak_days, stats.tests_completed),
    activity: activity.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      createdAt: row.created_at,
    })),
    features: features
      .filter((feature) => feature.key !== 'global-search')
      .slice(0, 11)
      .map((feature) => ({
        key: feature.key,
        title: feature.title_ar,
        description: feature.description_ar,
        phase: feature.phase,
        enabled: Boolean(feature.is_enabled),
        href: feature.href,
        maintenanceMessage: feature.maintenance_message,
      })),
  });
});
