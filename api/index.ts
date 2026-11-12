// نقطة دخول Vercel: تصدير تطبيق Express كدالة Serverless.
// لا نشغّل منفذًا هنا؛ server/index.ts يكتشف VERCEL ويتخطى app.listen.
import { app } from '../server/index.ts';

export default app;
