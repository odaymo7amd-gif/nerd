// محرك OCR للصور.
//
// الافتراضي: tesseract.js (يعمل داخل الخادم، بدون مفاتيح). ينزّل ملفات اللغة
// (ara + eng) مرة واحدة إلى data/ocr-cache ثم يعمل محليًا.
//
// قبل القراءة تُصحّح الصورة تلقائيًا: اتجاه EXIF، الدوران، الحجم، التباين والحدّة.
// وتُعاد ثقة القراءة حتى تستطيع الواجهة تنبيه الطالب إلى الصور غير الواضحة.

import sharp from 'sharp';
import { ocrCacheRoot } from './storage.ts';

// دقة أعلى لقراءة الحروف العربية الصغيرة في صفحات الكتب، مع نسخة أخف لنموذج الرؤية.
const OCR_MAX_DIMENSION = Number(process.env.OCR_MAX_DIMENSION ?? 2800);
const VISION_MAX_DIMENSION = Number(process.env.VISION_MAX_DIMENSION ?? 2200);

interface TesseractWorker {
  recognize: (
    image: string | Buffer,
    options?: { rotateAuto?: boolean },
  ) => Promise<{ data: { text: string; confidence?: number } }>;
  terminate: () => Promise<unknown>;
}

export interface OcrResult {
  text: string;
  confidence: number;
  width: number;
  height: number;
  /** انحراف معياري للسطوع: قريب من الصفر يعني صورة فارغة أو شديدة الضبابية. */
  brightnessSpread: number;
  blurred: boolean;
}

export interface PreparedImage {
  /** نسخة ملوّنة مضغوطة تصلح لنموذج الرؤية. */
  color: Buffer;
  /** نسخة رمادية عالية التباين تصلح لـ OCR. */
  gray: Buffer;
  width: number;
  height: number;
  brightnessSpread: number;
  blurred: boolean;
}

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker(['ara', 'eng'], 1, {
        cachePath: ocrCacheRoot,
        logger: () => undefined,
      });
      return worker as unknown as TesseractWorker;
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

export function ocrProvider(): string {
  return process.env.OCR_PROVIDER ?? 'tesseract';
}

/** يهيّئ الصورة للقراءة دون المساس بالملف الأصلي. */
export async function prepareImage(path: string): Promise<PreparedImage> {
  const base = sharp(path, { failOn: 'none' }).rotate();
  const metadata = await base.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const gray = await sharp(path, { failOn: 'none' })
    .rotate()
    .resize({ width: OCR_MAX_DIMENSION, height: OCR_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 90 })
    .toBuffer();

  const color = await sharp(path, { failOn: 'none' })
    .rotate()
    .resize({ width: VISION_MAX_DIMENSION, height: VISION_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();

  const stats = await sharp(color).stats();
  const brightnessSpread = stats.channels[0]?.stdev ?? 0;

  return {
    color,
    gray,
    width,
    height,
    brightnessSpread,
    blurred: brightnessSpread < 12,
  };
}

/**
 * يقرأ الصورة ويعيد النص مع ثقة Tesseract. الصور الفارغة أو شديدة الضبابية
 * تُعلَّم بثقة منخفضة حتى تعرض الواجهة «أعد التصوير».
 */
export async function ocrImageDetailed(path: string): Promise<OcrResult> {
  const provider = ocrProvider();
  if (provider !== 'tesseract') {
    throw new Error(
      `مزوّد OCR المضبوط (${provider}) غير مدعوم في هذا الإصدار. المدعوم حاليًا: tesseract.`,
    );
  }

  return ocrPrepared(await prepareImage(path));
}

function ocrQuality(text: string, confidence: number): number {
  const chars = text.replace(/\s/g, '').length;
  return chars + Math.max(0, confidence) * 1.5;
}

function needsSecondPass(text: string, confidence: number): boolean {
  const chars = text.replace(/\s/g, '').length;
  return chars < 60 || confidence < 65;
}

/**
 * قراءة الصورة، ومع الصور الضعيفة نجرّب نسخة عالية التباين ونختار الأفضل.
 * هذا يحسّن الصفحات الفاتحة أو المصوّرة بإضاءة غير متساوية دون بطء كل الصور.
 */
export async function ocrPrepared(prepared: PreparedImage): Promise<OcrResult> {
  const worker = await getWorker();
  const first = await worker.recognize(prepared.gray, { rotateAuto: true });
  let text = (first.data.text ?? '').trim();
  let confidence = Number(first.data.confidence ?? 0);

  if (needsSecondPass(text, confidence)) {
    try {
      const enhanced = await sharp(prepared.gray)
        .normalize()
        .linear(1.18, -14)
        .sharpen({ sigma: 1.1 })
        .jpeg({ quality: 92 })
        .toBuffer();
      const second = await worker.recognize(enhanced, { rotateAuto: true });
      const secondText = (second.data.text ?? '').trim();
      const secondConfidence = Number(second.data.confidence ?? 0);
      if (ocrQuality(secondText, secondConfidence) > ocrQuality(text, confidence)) {
        text = secondText;
        confidence = secondConfidence;
      }
    } catch {
      // النسخة الأساسية كافية؛ لا نفشل الصفحة بسبب محاولة تحسين اختيارية.
    }
  }

  const chars = text.replace(/\s/g, '').length;
  return {
    text,
    confidence: Number.isFinite(confidence) ? Math.round(confidence) : 0,
    width: prepared.width,
    height: prepared.height,
    brightnessSpread: Math.round(prepared.brightnessSpread),
    blurred: prepared.blurred || (chars > 0 && confidence < 45) || (prepared.blurred && chars === 0),
  };
}

export async function ocrImage(path: string): Promise<string> {
  return (await ocrImageDetailed(path)).text;
}

export async function shutdownOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  if (worker) await worker.terminate().catch(() => undefined);
  workerPromise = null;
}
