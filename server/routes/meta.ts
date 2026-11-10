import { Router } from 'express';
import { all, get, setting } from '../db.ts';

export const metaRouter = Router();

interface CountryRow {
  id: number;
  code: string;
  name_ar: string;
}
interface CurriculumRow {
  id: number;
  country_id: number;
  name_ar: string;
}
interface SubjectRow {
  id: number;
  curriculum_id: number;
  name_ar: string;
  code: string;
  is_active: number;
}

metaRouter.get('/meta', (_req, res) => {
  const countries = all<CountryRow>('SELECT id, code, name_ar FROM countries WHERE is_active = 1 ORDER BY id');
  const curricula = all<CurriculumRow>(
    'SELECT id, country_id, name_ar FROM curricula WHERE is_active = 1 ORDER BY id',
  );
  const grades = all<{ id: number; curriculum_id: number; name_ar: string; order_index: number }>(
    'SELECT id, curriculum_id, name_ar, order_index FROM grade_levels WHERE is_active = 1 ORDER BY order_index',
  );
  const semesters = all<{ id: number; curriculum_id: number; name_ar: string; order_index: number }>(
    'SELECT id, curriculum_id, name_ar, order_index FROM semesters WHERE is_active = 1 ORDER BY order_index',
  );
  const subjects = all<SubjectRow>(
    'SELECT id, curriculum_id, name_ar, code, is_active FROM subjects WHERE is_active = 1 ORDER BY sort_order',
  );

  res.json({
    countries,
    curricula: curricula.map((curriculum) => ({
      id: curriculum.id,
      countryId: curriculum.country_id,
      name: curriculum.name_ar,
      grades: grades
        .filter((grade) => grade.curriculum_id === curriculum.id)
        .map((grade) => ({ id: grade.id, name: grade.name_ar, order: grade.order_index })),
      semesters: semesters
        .filter((semester) => semester.curriculum_id === curriculum.id)
        .map((semester) => ({ id: semester.id, name: semester.name_ar, order: semester.order_index })),
      subjects: subjects
        .filter((subject) => subject.curriculum_id === curriculum.id)
        .map((subject) => ({ id: subject.id, name: subject.name_ar, code: subject.code })),
    })),
  });
});

metaRouter.get('/status', (_req, res) => {
  res.json({
    appName: setting('app_name') ?? 'NERD',
    version: '0.7.0',
    maintenance: {
      enabled: setting('maintenance_mode') === '1',
      message: setting('maintenance_message') ?? 'نيرد يخضع لصيانة سريعة. سنعود قريبًا بإذن الله.',
    },
    feedbackEnabled: setting('feedback_enabled') !== '0',
  });
});

metaRouter.get('/features', (_req, res) => {
  const flags = all<{
    key: string;
    title_ar: string;
    description_ar: string;
    phase: number;
    is_enabled: number;
    href: string | null;
    sort_order: number;
    maintenance_message: string | null;
  }>('SELECT key, title_ar, description_ar, phase, is_enabled, href, sort_order, maintenance_message FROM feature_flags ORDER BY sort_order');

  res.json({
    features: flags.map((flag) => ({
      key: flag.key,
      title: flag.title_ar,
      description: flag.description_ar,
      phase: flag.phase,
      enabled: Boolean(flag.is_enabled),
      href: flag.href,
      maintenanceMessage: flag.maintenance_message,
    })),
  });
});

metaRouter.get('/health', (_req, res) => {
  res.json({ ok: true, database: 'sqlite', users: get<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0 });
});
