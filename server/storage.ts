// طبقة التخزين المحلي للملفات.
// لا تُخزَّن أي أسماء ملفات قادمة من المستخدم في المسار؛ المسار مبني على معرّفات رقمية فقط،
// والوصول إلى الملفات يمر دائمًا عبر نقطة API تتحقق من ملكية الكتاب.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { dbPath } from './db.ts';

const dataDir = join(dbPath, '..');
export const uploadRoot = join(dataDir, 'uploads');
export const tmpRoot = join(dataDir, 'tmp');
export const ocrCacheRoot = join(dataDir, 'ocr-cache');

mkdirSync(uploadRoot, { recursive: true });
mkdirSync(tmpRoot, { recursive: true });
mkdirSync(ocrCacheRoot, { recursive: true });

export const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);
export const MAX_FILES_PER_BOOK = Number(process.env.MAX_FILES_PER_BOOK ?? 30);
export const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];

export function bookDirectory(userId: number, bookId: number): string {
  return join(uploadRoot, String(userId), String(bookId));
}

export function ensureBookDirectory(userId: number, bookId: number): string {
  const dir = bookDirectory(userId, bookId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function moveFile(from: string, to: string): Promise<void> {
  const { rename } = await import('node:fs/promises');
  try {
    await rename(from, to);
  } catch {
    const { copyFile } = await import('node:fs/promises');
    await copyFile(from, to);
    await unlink(from).catch(() => undefined);
  }
}

export async function removeFile(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

export async function removeBookDirectory(userId: number, bookId: number): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(bookDirectory(userId, bookId), { recursive: true, force: true });
}

export async function removeUserUploadDirectory(userId: number): Promise<void> {
  const { rm } = await import('node:fs/promises');
  await rm(join(uploadRoot, String(userId)), { recursive: true, force: true });
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export function tmpPath(extension: string): string {
  return join(tmpRoot, `${randomUUID()}${extension}`);
}

export async function writeTmpFile(extension: string, data: Buffer): Promise<string> {
  const path = tmpPath(extension);
  await writeFile(path, data);
  return path;
}
