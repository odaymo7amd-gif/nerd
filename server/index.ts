import './env.ts';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter } from './routes/auth.ts';
import { metaRouter } from './routes/meta.ts';
import { notificationsRouter, profileRouter } from './routes/profile.ts';
import { homeRouter } from './routes/home.ts';
import { booksRouter } from './routes/books.ts';
import { contentsRouter } from './routes/contents.ts';
import { aiRouter } from './routes/ai.ts';
import { testsRouter } from './routes/tests.ts';
import { bankRouter } from './routes/bank.ts';
import { scheduleRouter } from './routes/schedule.ts';
import { searchRouter } from './routes/search.ts';
import { challengeRouter } from './routes/challenge.ts';
import { errorHandler, notFound } from './http.ts';
import { dbPath, get, run } from './db.ts';
import { resumePendingBooks } from './book-processing.ts';
import { resumePendingContents } from './content-processing.ts';
import { shutdownOcr } from './ocr.ts';
import { readAiConfig } from './ai/config.ts';
import { developerRouter, runDueNotificationCampaigns } from './routes/developer.ts';
import { adsRouter, feedbackRouter } from './routes/community.ts';
import { featureGate, maintenanceGate } from './developer/runtime.ts';
import { developerUserId } from './developerConfig.ts';
import { recordRequest } from './metrics.ts';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// لا يتم تخزين أي استجابة تحتوي بيانات مستخدم في أي كاش وسيط
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const started = performance.now();
  res.on('finish', () => recordRequest(req.originalUrl, res.statusCode, performance.now() - started));
  next();
});

// الصيانة العامة وحالة الأدوات تُفرضان في الخادم قبل أي مسار استخدام.
app.use('/api', maintenanceGate);
app.use('/api', featureGate);

app.use('/api/auth', authRouter);
app.use('/api/developer', developerRouter);
app.use(
  '/api',
  metaRouter,
  profileRouter,
  notificationsRouter,
  homeRouter,
  feedbackRouter,
  adsRouter,
  booksRouter,
  contentsRouter,
  aiRouter,
  testsRouter,
  bankRouter,
  scheduleRouter,
  searchRouter,
  challengeRouter,
);
app.use('/api', notFound);

// في الإنتاج: يخدم الخادم ملفات الواجهة المبنية (dist) إلى جانب الـ API
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
if (existsSync(dist)) {
  app.use(
    express.static(dist, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, path) => {
        // أصول Vite تحمل بصمة في الاسم، فيمكن تخزينها طويلًا بأمان.
        if (path.includes(`${sep}assets${sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(dist, 'index.html'));
  });
}

app.use(errorHandler);

// حساب المطوّر الرئيسي مرتبط بمعرّف رقمي ثابت من الخادم، لا بالبريد أو الاسم.
const developerId = developerUserId();
const developer = get<{ id: number; role: string }>('SELECT id, role FROM users WHERE id = ?', developerId);
if (!developer) {
  console.warn(`[nerd] تحذير: حساب المطوّر ذو المعرّف ${developerId} غير موجود. لوحة المطوّر ستكون مغلقة.`);
} else if (developer.role !== 'admin') {
  run("UPDATE users SET role = 'admin' WHERE id = ?", developerId);
  console.log(`[nerd] تم ربط حساب المطوّر بالمعرّف ${developerId}.`);
}

// API_PORT في التطوير، وPORT في منصات الاستضافة التي تحدد المنفذ تلقائيًا.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[nerd] الخادم يعمل على http://0.0.0.0:${port}`);
  console.log(`[nerd] قاعدة البيانات: ${dbPath}`);
  const ai = readAiConfig();
  console.log(`[nerd] مزوّد AI: ${ai.provider} · ${ai.chatModel} · ${ai.baseUrl}`);
  console.log('[nerd] مفاتيح AI تأتي من متصفح كل مستخدم مع طلبه؛ لا يوجد مفتاح على الخادم ولا يُخزَّن أي مفتاح.');
  resumePendingBooks();
  resumePendingContents();
});

const campaignTimer = setInterval(() => {
  try {
    runDueNotificationCampaigns();
  } catch (error) {
    console.error('[nerd/developer] تعذّر فحص الإشعارات المجدولة:', (error as Error).message);
  }
}, 30_000);
campaignTimer.unref();

async function shutdown(): Promise<void> {
  clearInterval(campaignTimer);
  await shutdownOcr();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
