// استخراج النص من ملفات PDF صفحة بصفحة باستخدام pdfjs (يعمل داخل الخادم، بدون خدمات خارجية).
import { readFile } from 'node:fs/promises';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

interface PdfTextContent {
  items: PdfTextItem[];
}

interface PdfPage {
  getTextContent: () => Promise<PdfTextContent>;
  cleanup: () => void;
}

interface PdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
}

export interface PdfExtraction {
  pages: ExtractedPage[];
  numPages: number;
}

/**
 * يعيد بناء أسطر النص من عناصر pdfjs:
 * - العناصر تُقرأ بترتيب تدفق المحتوى (وهو ما يحافظ على ترتيب الكلمات العربية المنطقي).
 * - يبدأ سطر جديد عند تغيّر الإحداثي الرأسي أو عند hasEOL.
 */
function linesFromItems(items: PdfTextItem[]): string[] {
  const lines: string[] = [];
  let buffer = '';
  let lastY: number | null = null;

  const flush = () => {
    const line = buffer.replace(/[ \t]+/g, ' ').trim();
    if (line) lines.push(line);
    buffer = '';
  };

  for (const item of items) {
    const str = item.str;
    if (!str) {
      if (item.hasEOL) flush();
      continue;
    }
    const y = item.transform?.[5];
    if (lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > 2) {
      flush();
    }
    if (typeof y === 'number') lastY = y;

    const needsSpace = buffer.length > 0 && !/\s$/.test(buffer) && !/^\s/.test(str);
    buffer += (needsSpace ? ' ' : '') + str;
    if (item.hasEOL) {
      flush();
      lastY = null;
    }
  }
  flush();
  return lines;
}

export async function extractPdfPages(path: string): Promise<PdfExtraction> {
  const buffer = await readFile(path);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const document = (await loadingTask.promise) as unknown as PdfDocument;

  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = linesFromItems(content.items).join('\n');
        pages.push({ pageNumber, text });
      } finally {
        page.cleanup();
      }
    }
    return { pages, numPages: document.numPages };
  } finally {
    const destroyable = loadingTask as unknown as { destroy?: () => Promise<void> };
    if (typeof destroyable.destroy === 'function') {
      await destroyable.destroy().catch(() => undefined);
    }
  }
}
