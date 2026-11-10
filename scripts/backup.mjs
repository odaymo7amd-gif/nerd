// نسخة احتياطية متسقة من قاعدة SQLite والملفات المرفوعة.
// الاستخدام: npm run backup
// تُحفظ النسخ في backups/YYYY-MM-DDTHH-mm-ss/ ويمكن نسخها خارج الخادم.

import { DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const databasePath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : join(dataDir, 'nerd.db');

if (!existsSync(databasePath)) {
  console.error(`لم أجد قاعدة البيانات: ${databasePath}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const targetDir = resolve('backups', stamp);
mkdirSync(targetDir, { recursive: true });

const targetDb = join(targetDir, 'nerd.db');
const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  // VACUUM INTO ينتج ملفًا متسقًا حتى لو كان الخادم يعمل.
  db.exec(`VACUUM INTO '${targetDb.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

const uploads = join(dataDir, 'uploads');
if (existsSync(uploads)) {
  cpSync(uploads, join(targetDir, 'uploads'), { recursive: true });
}

console.log(`تم إنشاء نسخة احتياطية في: ${targetDir}`);
console.log('انسخ هذا المجلد إلى مكان خارج الخادم؛ القرص وحده ليس نسخة احتياطية.');
