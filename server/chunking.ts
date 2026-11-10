// تقطيع محتوى الكتاب إلى مقاطع (chunks) مرتبطة بأرقام الصفحات.
// كل مقطع يحمل: رقم أول صفحة، رقم آخر صفحة، ورقم موقعه داخل الكتاب.

export interface PageInput {
  pageNumber: number;
  text: string;
}

export interface BuiltChunk {
  chunkIndex: number;
  content: string;
  pageFrom: number;
  pageTo: number;
  tokens: number;
}

const TARGET_CHARS = 900;
const MAX_CHARS = 1400;
const OVERLAP_CHARS = 120;

function splitLongPage(text: string): string[] {
  const paragraphs = text
    .split(/\n{1,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHARS) {
      segments.push(paragraph);
      continue;
    }
    // تقسيم على حدود الجمل مع الحفاظ على علامات الترقيم العربية والإنجليزية
    let rest = paragraph;
    while (rest.length > MAX_CHARS) {
      const window = rest.slice(0, MAX_CHARS);
      const cut = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('؟ '),
        window.lastIndexOf('! '),
        window.lastIndexOf('، '),
        window.lastIndexOf('؛ '),
      );
      const end = cut > TARGET_CHARS / 2 ? cut + 1 : MAX_CHARS;
      segments.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) segments.push(rest);
  }
  return segments;
}

export function normalizeArabic(input: string): string {
  return input
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ \t]+/g, ' ')
    .toLowerCase();
}

export function estimateTokens(text: string): number {
  // تقدير تقريبي موحّد للعربية والإنجليزية (يُستبدل بعدّاد المزوّد في المرحلة 3)
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildChunks(pages: PageInput[]): BuiltChunk[] {
  interface Segment {
    text: string;
    page: number;
  }

  const segments: Segment[] = [];
  for (const page of pages) {
    const text = page.text?.trim();
    if (!text) continue;
    for (const segment of splitLongPage(text)) {
      segments.push({ text: segment, page: page.pageNumber });
    }
  }

  const chunks: BuiltChunk[] = [];
  let buffer = '';
  let pageFrom = 0;
  let pageTo = 0;

  const flush = () => {
    const content = buffer.trim();
    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        pageFrom: pageFrom || pageTo,
        pageTo: pageTo || pageFrom,
        tokens: estimateTokens(content),
      });
    }
    const tail = content.slice(-OVERLAP_CHARS);
    buffer = tail ? `${tail} ` : '';
    pageFrom = pageTo;
  };

  for (const segment of segments) {
    if (buffer.length + segment.text.length + 1 > TARGET_CHARS && buffer.trim().length > 0) {
      flush();
    }
    if (!pageFrom) pageFrom = segment.page;
    pageTo = segment.page;
    buffer += `${segment.text}\n`;
  }
  if (buffer.trim()) {
    const content = buffer.trim();
    chunks.push({
      chunkIndex: chunks.length,
      content,
      pageFrom: pageFrom || pageTo,
      pageTo: pageTo || pageFrom,
      tokens: estimateTokens(content),
    });
  }

  return chunks;
}

export function buildSnippet(content: string, query: string, radius = 90): string {
  const normalizedContent = normalizeArabic(content);
  const normalizedQuery = normalizeArabic(query);
  const index = normalizedContent.indexOf(normalizedQuery);
  if (index < 0) return content.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + normalizedQuery.length + radius);
  return `${start > 0 ? '… ' : ''}${content.slice(start, end).trim()}${end < content.length ? ' …' : ''}`;
}
