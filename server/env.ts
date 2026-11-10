// تحميل ملف .env قبل أي وحدة تقرأ متغيّرات البيئة عند الاستيراد (مثل مسار قاعدة البيانات).
// المتغيّرات الموجودة في البيئة الفعلية (نظام التشغيل أو أسرار النشر) لها الأولوية دائمًا،
// فلا يستطيع .env أن يطمس مفتاحًا حقيقيًا موضوعًا في البيئة.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : join(here, '..', '.env');

if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.warn(`[nerd/env] تعذّر قراءة ${envPath}: ${(error as Error).message}`);
  }
}
