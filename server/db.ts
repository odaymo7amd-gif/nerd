import Database from 'libsql';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const dbPath = process.env.DATABASE_PATH ?? join(dataDir, 'nerd.db');

// في Vercel لا يوجد قرص دائم. نستخدم Turso/libSQL عبر الشبكة عند ضبط
// TURSO_DATABASE_URL، ونبقى على ملف SQLite محلي في التطوير أو Render.
const remoteUrl = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
export const isRemoteDatabase = Boolean(remoteUrl);
export const db = remoteUrl
  ? new Database(remoteUrl, authToken ? ({ authToken } as never) : undefined)
  : new Database(dbPath);

// إعدادات SQLite المحلية. بعضها غير مدعوم على الاتصال البعيد، فلا نُفشل الإقلاع.
try {
  db.exec('PRAGMA journal_mode = WAL');
} catch {
  // Turso/libSQL البعيد يدير السجل بنفسه.
}
try {
  db.exec('PRAGMA foreign_keys = ON');
  // انتظر بدل الفشل الفوري إذا كان النسخ الاحتياطي أو طلب آخر يكتب للحظة.
  db.exec('PRAGMA busy_timeout = 5000');
} catch {
  // تجاهل الإعدادات غير المدعومة على القاعدة البعيدة.
}
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

// ترحيلات بسيطة تُضاف تلقائيًا لقواعد بيانات موجودة مسبقًا
function ensureColumn(table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('books', 'content_hash', 'content_hash TEXT');
ensureColumn('books', 'is_content_source', 'is_content_source INTEGER NOT NULL DEFAULT 0');
ensureColumn('books', 'content_source_type', 'content_source_type TEXT');
ensureColumn('book_pages', 'error_message', 'error_message TEXT');
ensureColumn('book_pages', 'source_kind', "source_kind TEXT NOT NULL DEFAULT 'page'");
ensureColumn('book_pages', 'source_time_seconds', 'source_time_seconds REAL');
ensureColumn('book_pages', 'confidence', 'confidence REAL');
ensureColumn('document_chunks', 'content_search', 'content_search TEXT');
ensureColumn('summaries', 'content_id', 'content_id INTEGER REFERENCES study_contents(id) ON DELETE SET NULL');
ensureColumn('summaries', 'content_version', 'content_version INTEGER');
ensureColumn('summaries', 'study_kit', 'study_kit TEXT');
ensureColumn('summaries', 'review_state', "review_state TEXT NOT NULL DEFAULT '{}'");
ensureColumn('questions', 'content_id', 'content_id INTEGER REFERENCES study_contents(id) ON DELETE CASCADE');
ensureColumn('chat_conversations', 'content_id', 'content_id INTEGER REFERENCES study_contents(id) ON DELETE SET NULL');
ensureColumn('chat_conversations', 'content_version', 'content_version INTEGER');
ensureColumn('tests', 'content_id', 'content_id INTEGER REFERENCES study_contents(id) ON DELETE SET NULL');
ensureColumn('tests', 'content_version', 'content_version INTEGER');
ensureColumn('tests', 'timed', 'timed INTEGER NOT NULL DEFAULT 1');
ensureColumn('tests', 'show_answers', "show_answers TEXT NOT NULL DEFAULT 'after_finish'");
ensureColumn('study_tasks', 'notes', 'notes TEXT');
ensureColumn('study_tasks', 'content_id', 'content_id INTEGER REFERENCES study_contents(id) ON DELETE SET NULL');
ensureColumn('study_tasks', 'updated_at', 'updated_at TEXT');
ensureColumn('tests', 'challenge_date', 'challenge_date TEXT');
ensureColumn('feature_flags', 'maintenance_message', 'maintenance_message TEXT');
ensureColumn('notifications', 'campaign_id', 'campaign_id INTEGER');
ensureColumn('ai_usage_logs', 'error_code', 'error_code TEXT');
ensureColumn('ai_usage_logs', 'error_message', 'error_message TEXT');
ensureColumn('ai_usage_logs', 'latency_ms', 'latency_ms INTEGER');
ensureColumn('ai_provider_events', 'tokens_in', 'tokens_in INTEGER NOT NULL DEFAULT 0');
ensureColumn('ai_provider_events', 'tokens_out', 'tokens_out INTEGER NOT NULL DEFAULT 0');
ensureColumn('ai_provider_events', 'cost_usd', 'cost_usd REAL NOT NULL DEFAULT 0');
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_books_user_hash ON books (user_id, content_hash) WHERE content_hash IS NOT NULL',
);
db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_book_page ON document_chunks (book_id, page_from)');

export type SQLValue = string | number | null | bigint | Uint8Array;

export function all<T = Record<string, unknown>>(sql: string, ...params: SQLValue[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: SQLValue[]): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: SQLValue[]): { changes: number; lastInsertRowid: number } {
  const result = db.prepare(sql).run(...(params as never[]));
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function setting(key: string): string | undefined {
  return get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key)?.value;
}

// ------------------------------------------------------------
// البيانات التأسيسية: المنهاج الأردني + المواد + أعلام الميزات
// ------------------------------------------------------------
function seed(): void {
  const country = get<{ id: number }>("SELECT id FROM countries WHERE code = 'JO'");
  const countryId =
    country?.id ??
    run("INSERT INTO countries (code, name_ar) VALUES ('JO', 'الأردن')").lastInsertRowid;

  const curriculum = get<{ id: number }>('SELECT id FROM curricula WHERE country_id = ?', countryId);
  const curriculumId =
    curriculum?.id ??
    run('INSERT INTO curricula (country_id, name_ar) VALUES (?, ?)', countryId, 'المنهاج الأردني')
      .lastInsertRowid;

  const grades = [
    'الصف الأول',
    'الصف الثاني',
    'الصف الثالث',
    'الصف الرابع',
    'الصف الخامس',
    'الصف السادس',
    'الصف السابع',
    'الصف الثامن',
    'الصف التاسع',
    'الصف العاشر',
    'الصف الحادي عشر',
    'الصف الثاني عشر',
  ];
  grades.forEach((name, index) => {
    run(
      'INSERT OR IGNORE INTO grade_levels (curriculum_id, name_ar, order_index) VALUES (?, ?, ?)',
      curriculumId,
      name,
      index + 1,
    );
  });

  ['الفصل الأول', 'الفصل الثاني'].forEach((name, index) => {
    run(
      'INSERT OR IGNORE INTO semesters (curriculum_id, name_ar, order_index) VALUES (?, ?, ?)',
      curriculumId,
      name,
      index + 1,
    );
  });

  const subjects: Array<[string, string]> = [
    ['اللغة العربية', 'AR'],
    ['التربية الإسلامية', 'ISL'],
    ['اللغة الإنجليزية', 'EN'],
    ['تاريخ الأردن', 'JOH'],
  ];
  subjects.forEach(([name, code], index) => {
    run(
      'INSERT OR IGNORE INTO subjects (curriculum_id, name_ar, code, sort_order) VALUES (?, ?, ?, ?)',
      curriculumId,
      name,
      code,
      index + 1,
    );
  });

  // أعلام الميزات: الحالة الحقيقية لكل أداة (مفعّلة فقط إذا كانت مبنية فعليًا)
  const flags: Array<[string, string, string, number, number, string, number]> = [
    ['notifications', 'الإشعارات', 'استلام تنبيهات الدراسة والمهام وإنجازات الحساب.', 1, 1, '/notifications', 1],
    ['content-library', 'محتواي الدراسي', 'مكتبة المحتوى: صور وفيديو ونص وPDF، ومنها كل المهام.', 1, 1, '/content', 5],
    ['books', 'الكتب الدراسية', 'رفع كتاب كامل بصيغة PDF أو صور — خيار إضافي، وليس المسار الأساسي.', 2, 0, '/books', 10],
    ['summary', 'الملخص الذكي', 'توليد ملخصات من محتوى الكتاب مع مصادر الصفحات.', 3, 0, '/summary', 20],
    ['tests', 'إنشاء الاختبارات', 'بناء اختبارات من الكتاب مع مؤقت وتصحيح آلي.', 4, 0, '/tests', 30],
    ['question-bank', 'بنك الأسئلة', 'حفظ الأسئلة وتصنيفها والبحث فيها.', 3, 0, '/question-bank', 40],
    ['ai-chat', 'الدردشة', 'محادثة حرة عن أي موضوع، بلا اشتراط محتوى مرفوع.', 3, 0, '/assistant', 50],
    ['teacher', 'اسأل المعلم', 'حوّل أي سؤال إلى درس تفاعلي بعناوين وأقسام.', 3, 0, '/ask-teacher', 60],
    ['solver', 'حل المسائل', 'حل المسائل خطوة بخطوة مع المعادلات والوحدات.', 3, 0, '/solver', 70],
    ['grader', 'التصحيح التلقائي', 'تصحيح الإجابات النصية والمقالية مع درجة وأخطاء وخطوة تحسين.', 3, 0, '/grader', 80],
    ['schedule', 'الجدول الدراسي', 'تنظيم الحصص اليومية والأسبوعية وتتبع الإنجاز.', 5, 0, '/schedule', 90],
    ['expression', 'مساعد التعبير', 'مساعدة في كتابة موضوعات التعبير العربي.', 3, 0, '/expression', 100],
    ['english-grammar', 'تعلّم الإنجليزية', 'افهم القواعد الإنجليزية واختبر نفسك بالذكاء الاصطناعي.', 3, 0, '/english-grammar', 110],
    ['arabic-grammar', 'تعلّم اللغة العربية', 'افهم قواعد اللغة العربية واختبر نفسك بالذكاء الاصطناعي.', 3, 0, '/arabic-grammar', 111],
    ['daily-challenge', 'التحدي اليومي', 'أسئلة يومية بمؤقت ونتيجة وأفضل نتيجة.', 4, 0, '/challenge', 120],
    ['global-search', 'البحث الشامل', 'البحث في الكتب والملخصات والأسئلة والمحادثات.', 6, 0, '/search', 130],
  ];
  for (const [key, title, description, phase, enabled, href, order] of flags) {
    run(
      'INSERT OR IGNORE INTO feature_flags (key, title_ar, description_ar, phase, is_enabled, href, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      key,
      title,
      description,
      phase,
      enabled,
      href,
      order,
    );
  }

  // فصل الدردشة الحرة عن «اسأل المعلم»: نحدّث الصفوف الموجودة مرة واحدة فقط.
  const chatTeacherSplit = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase7_chat_teacher_split'",
  );
  if (!chatTeacherSplit) {
    run(
      "UPDATE feature_flags SET title_ar = 'الدردشة', description_ar = 'محادثة حرة عن أي موضوع، بلا اشتراط محتوى مرفوع.', href = '/assistant' WHERE key = 'ai-chat'",
    );
    run(
      "UPDATE feature_flags SET title_ar = 'اسأل المعلم', description_ar = 'حوّل أي سؤال إلى درس تفاعلي بعناوين وأقسام.', href = '/ask-teacher' WHERE key = 'teacher'",
    );
    run(
      "INSERT INTO app_settings (key, value) VALUES ('phase7_chat_teacher_split', ?)",
      nowIso(),
    );
  }

  const achievements: Array<[string, string, string, number]> = [
    ['first_test', 'أول اختبار', 'أكملت أول اختبار في التطبيق.', 20],
    ['ten_tests', '10 اختبارات', 'أكملت عشرة اختبارات.', 100],
    ['hundred_correct', '100 إجابة صحيحة', 'أجبت عن مئة سؤال بشكل صحيح.', 150],
    ['seven_days', '7 أيام التزام', 'درست سبعة أيام متتابعة.', 200],
    ['full_subject', 'إكمال مادة', 'أكملت جميع دروس مادة دراسية.', 250],
  ];
  for (const [key, title, description, points] of achievements) {
    run(
      'INSERT OR IGNORE INTO achievements (key, title_ar, description_ar, points) VALUES (?, ?, ?, ?)',
      key,
      title,
      description,
      points,
    );
  }

  run(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('app_name', 'NERD')",
  );
  run(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('ai_provider', 'unset')",
  );
  run(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('ai_daily_limit_per_user', '30')",
  );
  run(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('ads_enabled', '0')",
  );

  // تفعيل أداة الكتب مرة واحدة عند اكتمال المرحلة الثانية (لا يُعاد كل تشغيل
  // حتى يبقى تعطيل المشرف للأداة محفوظًا).
  run(
    "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('phase7_content_enabled', ?)",
    nowIso(),
  );
  run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'content-library'");

  const booksEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase2_books_enabled'",
  );
  if (!booksEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'books'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase2_books_enabled', ?)", nowIso());
  }

  // تفعيل أداة الملخص الذكي مرة واحدة عند اكتمال المرحلة الثالثة
  const summaryEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase3_summary_enabled'",
  );
  if (!summaryEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'summary'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase3_summary_enabled', ?)", nowIso());
  }

  // تفعيل الاختبارات مرة واحدة عند اكتمال المرحلة الرابعة
  const testsEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase4_tests_enabled'",
  );
  if (!testsEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'tests'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase4_tests_enabled', ?)", nowIso());
  }

  // تفعيل المحادثة التعليمية مرة واحدة (المرحلة 3)
  const chatEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase3_chat_enabled'",
  );
  if (!chatEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'ai-chat'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase3_chat_enabled', ?)", nowIso());
  }

  // بنك الأسئلة موجود في /bank، وصحّح الرابط القديم في قواعد البيانات السابقة.
  run("UPDATE feature_flags SET href = '/bank' WHERE key = 'question-bank'");
  run(
    "UPDATE feature_flags SET description_ar = 'تصحيح الإجابات النصية والمقالية مع درجة وأخطاء وخطوة تحسين.' WHERE key = 'grader'",
  );
  const bankEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase3_bank_enabled'",
  );
  if (!bankEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'question-bank'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase3_bank_enabled', ?)", nowIso());
  }

  // تفعيل الجدول الدراسي مرة واحدة عند اكتمال المرحلة الخامسة
  const scheduleEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase5_schedule_enabled'",
  );
  if (!scheduleEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'schedule'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase5_schedule_enabled', ?)", nowIso());
  }

  // أدوات الدراسة الذكية الخمس تُفعّل مرة واحدة، ويمكن للمشرف تعطيل أي منها لاحقًا.
  const studyToolsEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase3_study_tools_enabled'",
  );
  if (!studyToolsEnabled) {
    run(
      "UPDATE feature_flags SET is_enabled = 1 WHERE key IN ('teacher', 'solver', 'grader', 'expression', 'english-grammar')",
    );
    run("INSERT INTO app_settings (key, value) VALUES ('phase3_study_tools_enabled', ?)", nowIso());
  }

  // تعلّم الإنجليزية: نُحدّث الأداة القديمة مرة واحدة مع الاحتفاظ بإمكانية تعطيلها من الإدارة.
  const englishLearningEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase8_english_learning_enabled'",
  );
  if (!englishLearningEnabled) {
    run(
      "UPDATE feature_flags SET title_ar = 'تعلّم الإنجليزية', description_ar = 'افهم القواعد الإنجليزية واختبر نفسك بالذكاء الاصطناعي.', href = '/english-grammar', is_enabled = 1 WHERE key = 'english-grammar'",
    );
    run(
      "INSERT INTO app_settings (key, value) VALUES ('phase8_english_learning_enabled', ?)",
      nowIso(),
    );
  }

  // تعلّم اللغة العربية: أداة مستقلة تُفعّل مرة واحدة مع إمكانية تعطيلها من الإدارة.
  const arabicLearningEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase8_arabic_learning_enabled'",
  );
  if (!arabicLearningEnabled) {
    run(
      "UPDATE feature_flags SET title_ar = 'تعلّم اللغة العربية', description_ar = 'افهم قواعد اللغة العربية واختبر نفسك بالذكاء الاصطناعي.', href = '/arabic-grammar', is_enabled = 1 WHERE key = 'arabic-grammar'",
    );
    run(
      "INSERT INTO app_settings (key, value) VALUES ('phase8_arabic_learning_enabled', ?)",
      nowIso(),
    );
  }

  // البحث الشامل والمسار السريع إليه
  const searchEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase6_search_enabled'",
  );
  if (!searchEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'global-search'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase6_search_enabled', ?)", nowIso());
  }

  // التحدي اليومي
  const challengeEnabled = get<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'phase4_challenge_enabled'",
  );
  if (!challengeEnabled) {
    run("UPDATE feature_flags SET is_enabled = 1 WHERE key = 'daily-challenge'");
    run("INSERT INTO app_settings (key, value) VALUES ('phase4_challenge_enabled', ?)", nowIso());
  }
}

seed();

// إعدادات تشغيل افتراضية للوحة المطوّر (لا تُعيد ضبط قيمة موجودة).
run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('maintenance_mode', '0')");
run(
  "INSERT OR IGNORE INTO app_settings (key, value) VALUES ('maintenance_message', 'نيرد يخضع لصيانة سريعة. سنعود قريبًا بإذن الله.')",
);
run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('feedback_enabled', '1')");
run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('developer_panel_enabled', '1')");
