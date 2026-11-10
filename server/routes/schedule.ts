// الجدول الدراسي: مهام يومية/أسبوعية مرتبطة بالمواد والمحتوى، مع تتبع الإنجاز
// واحتساب دقائق الدراسة والالتزام. كل الاستعلامات مقيّدة بمالك المهمة.

import { Router } from 'express';
import { z } from 'zod';
import { all, get, nowIso, run } from '../db.ts';
import { logActivity, requireUser } from '../auth.ts';
import { HttpError } from '../http.ts';
import { ensureStats } from './profile.ts';

export const scheduleRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function assertDate(value: string, label: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, `${label} غير صحيح.`);
  }
}

function assertTime(value: string, label: string): void {
  if (!TIME_RE.test(value)) throw new HttpError(400, `${label} يجب أن يكون بصيغة HH:MM.`);
}

function minutesBetween(start: string, end: string): number {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}

function validateSubject(userId: number, subjectId: number | null): void {
  if (subjectId == null) return;
  const subject = get<{ id: number }>('SELECT id FROM subjects WHERE id = ? AND is_active = 1', subjectId);
  if (!subject) throw new HttpError(400, 'المادة المختارة غير متاحة.');
  const linked = get<{ id: number }>(
    'SELECT id FROM user_subjects WHERE user_id = ? AND subject_id = ?',
    userId,
    subjectId,
  );
  if (!linked) throw new HttpError(400, 'أضف هذه المادة إلى موادك أولًا من إعدادات الحساب.');
}

function validateContent(userId: number, contentId: number | null): void {
  if (contentId == null) return;
  const content = get<{ id: number }>(
    'SELECT id FROM study_contents WHERE id = ? AND user_id = ?',
    contentId,
    userId,
  );
  if (!content) throw new HttpError(404, 'المحتوى الدراسي المرتبط غير موجود.');
}

interface TaskRow {
  id: number;
  title: string;
  study_date: string;
  start_time: string;
  end_time: string;
  is_completed: number;
  notes: string | null;
  subject_id: number | null;
  subject_name: string | null;
  content_id: number | null;
  content_title: string | null;
  created_at: string;
  updated_at: string | null;
}

const taskSelect = `SELECT t.id, t.title, t.study_date, t.start_time, t.end_time, t.is_completed,
       t.notes, t.subject_id, s.name_ar AS subject_name, t.content_id,
       c.title AS content_title, t.created_at, t.updated_at
  FROM study_tasks t
  LEFT JOIN subjects s ON s.id = t.subject_id
  LEFT JOIN study_contents c ON c.id = t.content_id`;

function serializeTask(row: TaskRow) {
  const durationMinutes = Math.max(0, minutesBetween(row.start_time, row.end_time));
  return {
    id: row.id,
    title: row.title,
    studyDate: row.study_date,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes,
    isCompleted: Boolean(row.is_completed),
    notes: row.notes,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    contentId: row.content_id,
    contentTitle: row.content_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskForUser(userId: number, id: number): TaskRow {
  const row = get<TaskRow>(`${taskSelect} WHERE t.id = ? AND t.user_id = ?`, id, userId);
  if (!row) throw new HttpError(404, 'المهمة غير موجودة.');
  return row;
}

function recomputeStreak(userId: number): number {
  const rows = all<{ study_date: string }>(
    `SELECT DISTINCT study_date FROM study_tasks
      WHERE user_id = ? AND is_completed = 1
      ORDER BY study_date DESC`,
    userId,
  );
  if (rows.length === 0) {
    run("UPDATE user_statistics SET streak_days = 0, updated_at = ? WHERE user_id = ?", nowIso(), userId);
    return 0;
  }
  const dates = new Set(rows.map((row) => row.study_date));
  const today = isoDate(new Date());
  let cursor = dates.has(today) ? today : addDays(today, -1);
  if (!dates.has(cursor)) {
    run("UPDATE user_statistics SET streak_days = 0, updated_at = ? WHERE user_id = ?", nowIso(), userId);
    return 0;
  }
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  run(
    'UPDATE user_statistics SET streak_days = ?, updated_at = ? WHERE user_id = ?',
    streak,
    nowIso(),
    userId,
  );
  return streak;
}

scheduleRouter.get('/schedule', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const today = isoDate(new Date());
  const from = String(req.query.from ?? '').trim() || today;
  const to = String(req.query.to ?? '').trim() || addDays(from, 6);
  assertDate(from, 'تاريخ البداية');
  assertDate(to, 'تاريخ النهاية');
  if (to < from) throw new HttpError(400, 'نهاية النطاق يجب أن تكون بعد بدايته.');
  if (to > addDays(from, 62)) throw new HttpError(400, 'النطاق الأقصى للجدول 63 يومًا.');

  const rows = all<TaskRow>(
    `${taskSelect}
      WHERE t.user_id = ? AND t.study_date >= ? AND t.study_date <= ?
      ORDER BY t.study_date, t.start_time, t.id`,
    user.id,
    from,
    to,
  );
  const tasks = rows.map(serializeTask);
  const completed = tasks.filter((task) => task.isCompleted);
  const plannedMinutes = tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
  const completedMinutes = completed.reduce((sum, task) => sum + task.durationMinutes, 0);

  ensureStats(user.id);
  const statsRow = get<{ streak_days: number }>(
    'SELECT streak_days FROM user_statistics WHERE user_id = ?',
    user.id,
  );

  res.json({
    range: { from, to },
    today,
    tasks,
    stats: {
      total: tasks.length,
      completed: completed.length,
      remaining: tasks.length - completed.length,
      plannedMinutes,
      completedMinutes,
      todayCount: tasks.filter((task) => task.studyDate === today).length,
      todayCompleted: tasks.filter((task) => task.studyDate === today && task.isCompleted).length,
      streakDays: statsRow?.streak_days ?? 0,
    },
  });
});

const taskSchema = z.object({
  title: z.string().trim().min(2, 'اكتب عنوان المهمة.').max(120, 'عنوان المهمة طويل جدًا.'),
  studyDate: z.string().trim(),
  startTime: z.string().trim(),
  endTime: z.string().trim(),
  subjectId: z.number().int().positive().nullable().optional(),
  contentId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(1000, 'الملاحظات طويلة جدًا.').nullable().optional(),
});

scheduleRouter.post('/schedule', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const payload = taskSchema.parse(req.body);
  assertDate(payload.studyDate, 'تاريخ المهمة');
  assertTime(payload.startTime, 'وقت البداية');
  assertTime(payload.endTime, 'وقت النهاية');
  if (minutesBetween(payload.startTime, payload.endTime) <= 0) {
    throw new HttpError(400, 'وقت النهاية يجب أن يكون بعد وقت البداية.');
  }
  if (minutesBetween(payload.startTime, payload.endTime) > 12 * 60) {
    throw new HttpError(400, 'مدة المهمة الواحدة لا تتجاوز 12 ساعة.');
  }
  validateSubject(user.id, payload.subjectId ?? null);
  validateContent(user.id, payload.contentId ?? null);

  const created = run(
    `INSERT INTO study_tasks
       (user_id, subject_id, content_id, title, study_date, start_time, end_time, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    payload.subjectId ?? null,
    payload.contentId ?? null,
    payload.title,
    payload.studyDate,
    payload.startTime,
    payload.endTime,
    payload.notes || null,
    nowIso(),
  );
  res.status(201).json({ task: serializeTask(taskForUser(user.id, created.lastInsertRowid)) });
});

const taskPatchSchema = taskSchema.partial().extend({
  isCompleted: z.boolean().optional(),
});

scheduleRouter.patch('/schedule/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المهمة غير صحيح.');
  const current = taskForUser(user.id, id);
  const payload = taskPatchSchema.parse(req.body);

  const subjectId = payload.subjectId === undefined ? current.subject_id : payload.subjectId;
  const contentId = payload.contentId === undefined ? current.content_id : payload.contentId;
  const studyDate = payload.studyDate ?? current.study_date;
  const startTime = payload.startTime ?? current.start_time;
  const endTime = payload.endTime ?? current.end_time;
  const title = payload.title ?? current.title;
  const notes = payload.notes === undefined ? current.notes : payload.notes;
  const isCompleted = payload.isCompleted ?? Boolean(current.is_completed);

  assertDate(studyDate, 'تاريخ المهمة');
  assertTime(startTime, 'وقت البداية');
  assertTime(endTime, 'وقت النهاية');
  if (minutesBetween(startTime, endTime) <= 0) {
    throw new HttpError(400, 'وقت النهاية يجب أن يكون بعد وقت البداية.');
  }
  if (minutesBetween(startTime, endTime) > 12 * 60) {
    throw new HttpError(400, 'مدة المهمة الواحدة لا تتجاوز 12 ساعة.');
  }
  validateSubject(user.id, subjectId);
  validateContent(user.id, contentId);

  run(
    `UPDATE study_tasks
        SET subject_id = ?, content_id = ?, title = ?, study_date = ?, start_time = ?,
            end_time = ?, notes = ?, is_completed = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
    subjectId,
    contentId,
    title,
    studyDate,
    startTime,
    endTime,
    notes,
    isCompleted ? 1 : 0,
    nowIso(),
    id,
    user.id,
  );

  const wasCompleted = Boolean(current.is_completed);
  if (isCompleted !== wasCompleted) {
    const minutes = minutesBetween(startTime, endTime);
    const delta = isCompleted ? minutes : -minutes;
    run(
      `UPDATE user_statistics
          SET study_minutes = MAX(0, study_minutes + ?),
              points = MAX(0, points + ?),
              updated_at = ?
        WHERE user_id = ?`,
      delta,
      isCompleted ? 5 : -5,
      nowIso(),
      user.id,
    );
    if (isCompleted) {
      logActivity(user.id, 'schedule', 'إنجاز مهمة دراسية', `${title} · ${minutes} دقيقة`);
    }
  }
  recomputeStreak(user.id);

  res.json({ task: serializeTask(taskForUser(user.id, id)) });
});

scheduleRouter.delete('/schedule/:id', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'معرّف المهمة غير صحيح.');
  const task = taskForUser(user.id, id);
  if (task.is_completed) {
    const minutes = minutesBetween(task.start_time, task.end_time);
    run(
      `UPDATE user_statistics
          SET study_minutes = MAX(0, study_minutes - ?),
              points = MAX(0, points - 5),
              updated_at = ?
        WHERE user_id = ?`,
      minutes,
      nowIso(),
      user.id,
    );
  }
  run('DELETE FROM study_tasks WHERE id = ? AND user_id = ?', id, user.id);
  recomputeStreak(user.id);
  res.json({ ok: true });
});
