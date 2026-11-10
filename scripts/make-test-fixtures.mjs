// يولّد ملفات اختبار (PDF نصي) لاختبارات الكتب. للأغراض التطويرية فقط.
import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'data/fixtures';
mkdirSync(dir, { recursive: true });
const path = join(dir, 'test-book.pdf');

const doc = new PDFDocument({ size: 'A4', margin: 56 });
doc.pipe(createWriteStream(path));

doc.fontSize(22).text('NERD TEST BOOK');
doc.moveDown();
doc.fontSize(13).text(
  'Chapter One: Introduction to Study Skills. Reading a book page by page and extracting the text is the first step of every study assistant. This paragraph exists only to verify page mapping and chunking.',
);
doc.moveDown();
doc.fontSize(13).text(
  'Define the main idea of the chapter in one sentence. Then list three supporting details that appear in the same page.',
);

doc.addPage();
doc.fontSize(22).text('CHAPTER TWO');
doc.moveDown();
doc.fontSize(13).text(
  'Chapter Two: Building a Study Plan. A good plan divides the material into short sessions and reviews each session after one day and after one week. The NERD application stores every page separately so a summary can cite the exact page number.',
);
doc.moveDown();
doc.fontSize(13).text('Question: why is spaced repetition more effective than a single long session?');

doc.addPage();
doc.fontSize(22).text('CHAPTER THREE');
doc.moveDown();
doc.fontSize(13).text(
  'Chapter Three: Measuring Progress. Track the number of pages you study, the number of questions you answer, and the topics that still need revision.',
);

doc.end();

doc.on('end', () => {
  console.log(`تم إنشاء ${path}`);
});
