// مزوّد ذكاء اصطناعي وهمي متوافق مع OpenAI، للاختبار المحلي فقط.
// يخدم POST /v1/chat/completions ويعيد ردًا عربيًا مع أرقام رموز حقيقية الشكل.
// يدعم نوعين من الطلبات: توليد ملخص نصي، وتوليد أسئلة اختبار على شكل JSON صالح.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_AI_PORT ?? 8799);

function buildLesson(requestText, offPage = false) {
  const page = offPage ? 999 : 1;
  const sourceNote = requestText.includes('مصادر من محتوى المستخدم')
    ? ` [ص ${page}]`
    : '';
  return JSON.stringify({
    lessonTitle: 'درس تجريبي من مزوّد وهمي',
    sections: [
      {
        title: 'الفكرة الأساسية',
        content: `هذا شرح تجريبي مختصر للفكرة الأساسية في السؤال${sourceNote}. يوضّح القسم المعنى العام ثم يربطه بمثال قريب من الحياة.`,
      },
      {
        title: 'كيف يحدث؟',
        content: `ننتقل هنا إلى الآلية أو التسلسل خطوة بخطوة${sourceNote}. الهدف أن يفهم الطالب سبب النتيجة، لا أن يحفظها فقط.`,
      },
      {
        title: 'تطبيق وخلاصة',
        content: `نختم بمثال تطبيقي قصير وخلاصة عملية${sourceNote}. هذه الجملة جزء من رد وهمي مخصص لاختبار بنية الدرس والتنقل.`,
      },
    ],
  });
}

function buildQuestions(requestText, offPage = false) {
  const batchTag = createHash('sha256').update(requestText).digest('hex').slice(0, 6);
  const countMatch = requestText.match(/عدد الأسئلة المطلوب:\s*(\d+)/);
  const count = Math.min(Math.max(Number(countMatch?.[1] ?? 3) || 3, 1), 20);
  const typesMatch = requestText.match(/أنواع الأسئلة المطلوبة:[^\n]*\(([^)]+)\)/);
  const requested = (typesMatch?.[1] ?? 'mcq')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => ['mcq', 'true_false', 'short'].includes(value));
  const types = requested.length > 0 ? requested : ['mcq'];
  const pages = [...requestText.matchAll(/\[صفحة (\d+)/g)].map((match) => Number(match[1]));
  const pageFor = (index) => (offPage ? 999 : pages.length > 0 ? pages[index % pages.length] : index + 1);

  const questions = Array.from({ length: count }, (_value, index) => {
    const type = types[index % types.length];
    const page = pageFor(index);
    if (type === 'short') {
      return {
        type,
        question: `أكمل العبارة رقم ${index + 1} من النص المستخرج (صفحة ${page} · ${batchTag}).`,
        answer: `إجابة نموذجية ${index + 1}`,
        accept: [`إجابة ${index + 1}`],
        explanation: 'إجابة تجريبية من مزوّد وهمي للاختبار الآلي فقط.',
        page,
      };
    }
    if (type === 'true_false') {
      return {
        type,
        question: `العبارة رقم ${index + 1} صحيحة حسب النص المستخرج (صفحة ${page} · ${batchTag}).`,
        correctIndex: index % 2,
        explanation: 'تعليل تجريبي من مزوّد وهمي للاختبار الآلي فقط.',
        page,
      };
    }
    return {
      type: 'mcq',
      question: `السؤال رقم ${index + 1} (صفحة ${page} · ${batchTag}): ما الفكرة التي وردت في النص المستخرج؟`,
      options: [
        `الخيار الصحيح ${index + 1}`,
        `خيار خاطئ أ ${index + 1}`,
        `خيار خاطئ ب ${index + 1}`,
        `خيار خاطئ ج ${index + 1}`,
      ],
      correctIndex: 0,
      explanation: 'تعليل تجريبي من مزوّد وهمي للاختبار الآلي فقط.',
      page,
    };
  });

  return JSON.stringify(questions);
}

const models = (process.env.MOCK_AI_MODELS ?? 'openai/gpt-oss-120b')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function keyFrom(req) {
  const header = String(req.headers.authorization ?? '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// مفاتيح خاصة للاختبار (بادئة فقط): `invalid-key…` (401)، `rate-limited…` (429)،
// `quota-exceeded…` (402)، و`no-phrase…` (يرد دون عبارة التحقق)
let flakyAttempts = 0;

function authProblem(key) {
  if (!key) return { status: 401, message: 'Missing API key' };
  if (key.startsWith('invalid-key')) return { status: 401, message: 'Invalid API Key' };
  if (key.startsWith('rate-limited')) return { status: 429, message: 'Rate limit reached' };
  if (key.startsWith('quota-exceeded')) return { status: 402, message: 'Quota exceeded' };
  if (key.startsWith('too-large')) return { status: 413, message: 'Request entity too large' };
  if (key.startsWith('context-too-long')) {
    return { status: 400, message: 'maximum context length exceeded' };
  }
  if (key.startsWith('flaky') && flakyAttempts < 2) {
    flakyAttempts += 1;
    return { status: 503, message: 'Temporary upstream error' };
  }
  return null;
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url?.endsWith('/models')) {
    const problem = authProblem(keyFrom(req));
    if (problem) {
      res.writeHead(problem.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: problem.message } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: models.map((id) => ({ id, object: 'model' })) }));
    return;
  }

  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  const apiKey = keyFrom(req);
  const problem = authProblem(apiKey);
  if (problem) {
    res.writeHead(problem.status, {
      'Content-Type': 'application/json',
      ...(problem.status === 429 ? { 'retry-after': '7' } : {}),
    });
    res.end(JSON.stringify({ error: { message: problem.message } }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }
    if (parsed.model === 'missing-model') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'The model does not exist' } }));
      return;
    }

    const raw = JSON.stringify(parsed.messages ?? []);
    const isVerification = raw.includes('انشر التطبيق لمساعدة الآخرين');
    const isLesson = raw.includes('lessonTitle') && raw.includes('sections');
    const isQuestions = raw.includes('عدد الأسئلة المطلوب');
    const isMerge = raw.includes('ملخصات جزئية');
    const isChat = raw.includes('وضع الدردشة الحرة');
    let content;
    if (isVerification) {
      // مفتاح يبدأ بـ`no-phrase` يحاكي مفتاحًا لا يكتب عبارة التحقق (منتهي/غير فعّال)
      content = apiKey.startsWith('no-phrase')
        ? 'أهلًا بك! كيف أساعدك في الدراسة اليوم؟'
        : 'انشر التطبيق لمساعدة الآخرين';
    } else if (isLesson) {
      content = buildLesson(raw, apiKey.startsWith('offpage-'));
    } else if (isChat) {
      content = 'هذه إجابة دردشة تجريبية طبيعية من المزوّد الوهمي. أستطيع الحديث عن أي موضوع دون الحاجة إلى كتاب أو محتوى مرفوع.';
    } else if (isQuestions) {
      content = buildQuestions(raw, apiKey.startsWith('offpage-'));
    } else if (isMerge) {
      content = '## ملخص مدموج\n- هذا نص دمج تجريبي من مزوّد وهمي [ص 1].';
    } else if (apiKey.startsWith('offpage-')) {
      content =
        '## ملخص تجريبي\n- مرجع مختلق يجب حذفه [ص 999].\n- الفكرة الأولى من النص المستخرج [ص 1].';
    } else {
      content =
        '## ملخص تجريبي\n- الفكرة الأولى من النص المستخرج [ص 1].\n- الفكرة الثانية من الصفحة الثانية [ص 2].';
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock-completion',
        model: parsed.model ?? 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
      }),
    );
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`[mock-ai] يعمل على http://127.0.0.1:${port}/v1`);
});
