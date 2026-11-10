import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  GraduationCap,
  Languages,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { MarkdownText } from '../components/MarkdownText.tsx';
import { Alert, Field, PageHeader, Progress } from '../components/ui.tsx';
import { useAiAccess } from '../components/AiAccess.tsx';
import { aiApi, isKeyProblem } from '../lib/aiApi.ts';
import { api, ApiError } from '../lib/api.ts';
import type { AiStatus } from '../lib/aiTypes.ts';
import {
  englishDifficultyHints,
  englishDifficultyLabels,
  englishQuestionModeLabels,
  type EnglishAnswerDraft,
  type EnglishDifficulty,
  type EnglishExplanation,
  type EnglishQuestion,
  type EnglishQuestionMode,
  type EnglishResult,
  type EnglishTest,
} from '../lib/englishTypes.ts';

type Stage = 'setup' | 'explanation' | 'test-setup' | 'quiz' | 'result';
type Operation = 'explain' | 'test';
type Busy = null | 'explain' | 'test' | 'grade' | 'reexplain';

type LanguageId = 'english' | 'arabic';

interface LanguageConfig {
  id: LanguageId;
  apiBase: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  ruleLabel: string;
  ruleHint: string;
  rulePlaceholder: string;
  ruleDir: 'ltr' | 'rtl';
  ruleLang: string;
  noteHint: string;
  examples: string[];
  examplesLabel: string;
  explanationAria: string;
  explainHint: string;
  answerHint: string;
  answerPlaceholder: string;
  fillPlaceholder: string;
  errorCorrectionPlaceholder: string;
  backToLearning: string;
  missingRule: string;
  contentDir: 'ltr' | 'rtl';
  contentLang: string;
  explainCardHint: string;
  icon: typeof Languages;
}

const ENGLISH_EXAMPLES = [
  'Present Perfect',
  'Past Simple',
  'Conditional Sentences',
  'Passive Voice',
  'Reported Speech',
  'Modal Verbs',
  'Relative Clauses',
];

const ARABIC_EXAMPLES = [
  'المبتدأ والخبر',
  'كان وأخواتها',
  'إن وأخواتها',
  'النعت',
  'الحال',
  'التمييز',
  'الاستثناء',
  'أسلوب الشرط',
  'البلاغة العربية',
];

const LANGUAGES: Record<LanguageId, LanguageConfig> = {
  english: {
    id: 'english',
    apiBase: '/ai/english',
    eyebrow: 'English Learning',
    title: 'تعلّم الإنجليزية',
    subtitle:
      'اكتب أي قاعدة إنجليزية، افهمها بالعربية خطوة بخطوة، ثم اختبر نفسك بأسئلة يجهّزها الذكاء الاصطناعي خصيصًا لك.',
    ruleLabel: 'القاعدة الإنجليزية',
    ruleHint: 'اكتب أي قاعدة تريدها، وليس بالضرورة من قائمة.',
    rulePlaceholder: 'مثال: Present Perfect',
    ruleDir: 'ltr',
    ruleLang: 'en',
    noteHint: 'مثال: اشرح الفرق بينها وبين Past Simple، أو أريد أمثلة سهلة.',
    examples: ENGLISH_EXAMPLES,
    examplesLabel: 'أمثلة سريعة للقواعد الإنجليزية',
    explanationAria: 'شرح القاعدة الإنجليزية',
    explainHint: 'شرح عربي وأمثلة وترجمة',
    answerHint: 'اكتب الإجابة بالإنجليزية.',
    answerPlaceholder: 'اكتب الكلمة أو العبارة الناقصة…',
    fillPlaceholder: 'اكتب الكلمة أو العبارة الناقصة…',
    errorCorrectionPlaceholder: 'اكتب الجملة بعد التصحيح…',
    backToLearning: 'العودة إلى تعلّم الإنجليزية',
    missingRule: 'اكتب القاعدة الإنجليزية أولًا.',
    contentDir: 'ltr',
    contentLang: 'en',
    explainCardHint: 'شرح عربي وأمثلة وترجمة',
    icon: Languages,
  },
  arabic: {
    id: 'arabic',
    apiBase: '/ai/arabic',
    eyebrow: 'Arabic Learning',
    title: 'تعلّم اللغة العربية',
    subtitle:
      'اكتب أي قاعدة أو موضوع في اللغة العربية، افهمه بشرح واضح، ثم اختبر نفسك بأسئلة يجهّزها الذكاء الاصطناعي خصيصًا لك.',
    ruleLabel: 'القاعدة أو الموضوع العربي',
    ruleHint: 'اكتب أي قاعدة نحوية أو بلاغية أو موضوع تريد تعلّمه، وليس بالضرورة من قائمة.',
    rulePlaceholder: 'مثال: كان وأخواتها، أو التشبيه والاستعارة',
    ruleDir: 'rtl',
    ruleLang: 'ar',
    noteHint: 'مثال: ركز على الإعراب، أو اشرح الفرق بين الحال والتمييز.',
    examples: ARABIC_EXAMPLES,
    examplesLabel: 'أمثلة سريعة للقواعد العربية',
    explanationAria: 'شرح القاعدة العربية',
    explainHint: 'شرح نحوي وبلاغي وإعراب الأمثلة',
    answerHint: 'اكتب الإجابة بالعربية.',
    answerPlaceholder: 'اكتب الكلمة أو العبارة الناقصة…',
    fillPlaceholder: 'اكتب الكلمة أو العبارة الناقصة…',
    errorCorrectionPlaceholder: 'اكتب الجملة بعد التصحيح…',
    backToLearning: 'العودة إلى تعلّم اللغة العربية',
    missingRule: 'اكتب القاعدة أو الموضوع العربي أولًا.',
    contentDir: 'rtl',
    contentLang: 'ar',
    explainCardHint: 'شرح نحوي وبلاغي وإعراب الأمثلة',
    icon: BookOpen,
  },
};

const QUESTION_MODE_OPTIONS: Array<{ value: EnglishQuestionMode; title: string; hint: string }> = [
  {
    value: 'mcq',
    title: 'ضع دائرة فقط',
    hint: 'جميع الأسئلة اختيار من متعدد بأربعة خيارات.',
  },
  {
    value: 'mixed',
    title: 'ضع دائرة + أكمل الفراغ',
    hint: 'توزيع متوازن قدر الإمكان بين النوعين.',
  },
];

const COUNT_OPTIONS = [5, 10, 15, 20, 25];
const DIFFICULTY_ORDER: EnglishDifficulty[] = ['easy', 'medium', 'hard', 'advanced'];

function savedDifficulty(language: LanguageId): EnglishDifficulty {
  try {
    const value = window.localStorage.getItem(`nerd.${language}.difficulty.v1`);
    return DIFFICULTY_ORDER.includes(value as EnglishDifficulty)
      ? (value as EnglishDifficulty)
      : 'medium';
  } catch {
    return 'medium';
  }
}

function busyMessage(busy: Busy): string | null {
  if (busy === 'explain') return 'جاري تجهيز شرح القاعدة...';
  if (busy === 'reexplain') return 'جاري تجهيز شرح جديد للقاعدة...';
  if (busy === 'test') return 'جاري إعداد أسئلتك...';
  if (busy === 'grade') return 'جاري تصحيح إجاباتك...';
  return null;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

function questionAnswerLabel(question: EnglishResult['questions'][number]): string | null {
  if (question.type === 'mcq') {
    return question.selectedIndex != null ? (question.options[question.selectedIndex] ?? null) : null;
  }
  return question.answerText;
}

function RuleFields({
  config,
  rule,
  note,
  onRule,
  onNote,
  disabled,
  showExamples,
}: {
  config: LanguageConfig;
  rule: string;
  note: string;
  onRule: (value: string) => void;
  onNote: (value: string) => void;
  disabled: boolean;
  showExamples: boolean;
}) {
  return (
    <>
      <Field
        label={config.ruleLabel}
        htmlFor={`${config.id}-rule`}
        hint={config.ruleHint}
      >
        <textarea
          id={`${config.id}-rule`}
          className="input min-h-24 resize-y english-rule-input"
          dir={config.ruleDir}
          lang={config.ruleLang}
          autoComplete="off"
          spellCheck={false}
          value={rule}
          onChange={(event) => onRule(event.target.value)}
          placeholder={config.rulePlaceholder}
          maxLength={400}
          disabled={disabled}
        />
      </Field>

      {showExamples && (
        <div className="english-example-row" aria-label={config.examplesLabel}>
          {config.examples.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              dir={config.ruleDir}
              onClick={() => onRule(example)}
              disabled={disabled}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <Field
        label="ملاحظة إضافية (اختياري)"
        htmlFor={`${config.id}-note`}
        hint={config.noteHint}
      >
        <textarea
          id={`${config.id}-note`}
          className="input min-h-20 resize-y"
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder="اكتب ما يساعد الذكاء الاصطناعي على فهم احتياجك…"
          maxLength={1000}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

function DifficultyPicker({
  value,
  onChange,
  disabled,
  step,
}: {
  value: EnglishDifficulty;
  onChange: (value: EnglishDifficulty) => void;
  disabled: boolean;
  step: number;
}) {
  return (
    <div className="form-section">
      <div className="form-section-head">
        <span className="step-badge">{step}</span>
        <div>
          <h3>مستوى الصعوبة</h3>
          <p>اختر مستوى واحدًا؛ يغيّر طبيعة الأسئلة وطريقة التفكير المطلوبة.</p>
        </div>
      </div>
      <div className="difficulty-style-grid">
        {DIFFICULTY_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            className={`difficulty-card ${option === 'advanced' ? 'is-advanced' : ''}`}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            disabled={disabled}
          >
            <span className="difficulty-card-top">
              <span className="difficulty-card-title">{englishDifficultyLabels[option]}</span>
              {value === option && <span className="difficulty-card-dot" aria-hidden="true" />}
            </span>
            <span className="difficulty-card-hint">{englishDifficultyHints[option]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuestionModePicker({
  value,
  onChange,
  disabled,
  step,
}: {
  value: EnglishQuestionMode;
  onChange: (value: EnglishQuestionMode) => void;
  disabled: boolean;
  step: number;
}) {
  return (
    <div className="form-section">
      <div className="form-section-head">
        <span className="step-badge">{step}</span>
        <div>
          <h3>نوع الأسئلة</h3>
          <p>اختر شكل الأسئلة التي يريدها الامتحان.</p>
        </div>
      </div>
      <div className="summary-style-grid">
        {QUESTION_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="summary-style-card"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            <span className="summary-style-icon">
              {option.value === 'mcq' ? <ListChecks size={17} /> : <ClipboardCheck size={17} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-bold">{option.title}</span>
              <span className="block text-[10px] leading-5 text-[var(--muted)]">{option.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function EnglishLearningPage() {
  return <LanguageLearning language="english" />;
}

export function ArabicLearningPage() {
  return <LanguageLearning language="arabic" />;
}

function LanguageLearning({ language }: { language: LanguageId }) {
  const config = LANGUAGES[language];
  const { hasKey, requireKey, openActivation } = useAiAccess();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [stage, setStage] = useState<Stage>('setup');
  const [operation, setOperation] = useState<Operation>('explain');
  const [rule, setRule] = useState('');
  const [note, setNote] = useState('');
  const [countText, setCountText] = useState('10');
  const [questionMode, setQuestionMode] = useState<EnglishQuestionMode>('mcq');
  const [difficulty, setDifficulty] = useState<EnglishDifficulty>(() => savedDifficulty(language));
  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const [explanation, setExplanation] = useState<EnglishExplanation | null>(null);
  const [test, setTest] = useState<EnglishTest | null>(null);
  const [result, setResult] = useState<EnglishResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, EnglishAnswerDraft>>({});
  const [quizIndex, setQuizIndex] = useState(0);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const actionRef = useRef(false);

  const count = Number(countText);
  const countValid = Number.isInteger(count) && count >= 5 && count <= 25;
  const activeQuestion = test?.questions[quizIndex] ?? null;
  const answeredCount = useMemo(
    () =>
      test?.questions.filter((question) => {
        const answer = answers[question.id];
        if (!answer) return false;
        return question.type === 'mcq' ? answer.selectedIndex != null : Boolean(answer.text?.trim());
      }).length ?? 0,
    [answers, test],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(`nerd.${language}.difficulty.v1`, difficulty);
    } catch {
      // المتصفح قد يمنع التخزين؛ يبقى المستوى داخل الجلسة الحالية.
    }
  }, [difficulty, language]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AiStatus>('/ai/status')
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  function beginBusy(kind: Busy): boolean {
    if (actionRef.current) return false;
    actionRef.current = true;
    setBusy(kind);
    setError(null);
    return true;
  }

  function finishBusy(): void {
    actionRef.current = false;
    setBusy(null);
  }

  function handleError(caught: unknown, fallback: string): void {
    if (isKeyProblem(caught)) openActivation('activate');
    setError(errorMessage(caught, fallback));
  }

  function updateStatus(remainingToday: number): void {
    setStatus((current) =>
      current ? { ...current, usedToday: current.usedToday + 1, remaining: remainingToday } : current,
    );
  }

  async function requestExplanation(
    kind: 'explain' | 'reexplain',
    values?: { rule?: string; note?: string },
  ): Promise<EnglishExplanation | null> {
    const currentRule = (values?.rule ?? rule).trim();
    const currentNote = (values?.note ?? note).trim();
    if (!requireKey()) return null;
    if (currentRule.length < 2) {
      setError(config.missingRule);
      return null;
    }
    if (!beginBusy(kind)) return null;
    try {
      const data = await aiApi.post<{ explanation: EnglishExplanation }>(`${config.apiBase}/explain`, {
        rule: currentRule,
        note: currentNote || null,
      });
      setExplanation(data.explanation);
      updateStatus(data.explanation.remainingToday);
      setStage('explanation');
      setCopied(false);
      return data.explanation;
    } catch (caught) {
      handleError(caught, 'تعذّر تجهيز الشرح. حاول مرة أخرى.');
      return null;
    } finally {
      finishBusy();
    }
  }

  async function requestTest(values?: {
    rule?: string;
    note?: string;
    count?: number;
    questionMode?: EnglishQuestionMode;
    difficulty?: EnglishDifficulty;
  }): Promise<boolean> {
    const currentRule = (values?.rule ?? rule).trim();
    const currentNote = (values?.note ?? note).trim();
    const currentCount = values?.count ?? count;
    const currentMode = values?.questionMode ?? questionMode;
    const currentDifficulty = values?.difficulty ?? difficulty;
    const currentCountValid = Number.isInteger(currentCount) && currentCount >= 5 && currentCount <= 25;
    if (!requireKey()) return false;
    if (currentRule.length < 2) {
      setError(config.missingRule);
      return false;
    }
    if (!currentCountValid) {
      setError('عدد الأسئلة يجب أن يكون بين 5 و25.');
      return false;
    }
    if (!beginBusy('test')) return false;
    try {
      const data = await aiApi.post<{ test: EnglishTest }>(`${config.apiBase}/test`, {
        rule: currentRule,
        note: currentNote || null,
        count: currentCount,
        questionMode: currentMode,
        difficulty: currentDifficulty,
      });
      setTest(data.test);
      setQuestionMode(data.test.questionMode ?? currentMode);
      setDifficulty(data.test.difficulty ?? currentDifficulty);
      setAnswers({});
      setQuizIndex(0);
      setResult(null);
      setWrongOnly(false);
      setStage('quiz');
      updateStatus(data.test.remainingToday);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    } catch (caught) {
      handleError(caught, 'تعذّر إنشاء الامتحان. حاول مرة أخرى.');
      return false;
    } finally {
      finishBusy();
    }
  }

  function submitSetup(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (operation === 'explain') {
      void requestExplanation('explain');
    } else {
      void requestTest();
    }
  }

  function chooseOperation(next: Operation) {
    setOperation(next);
    setError(null);
  }

  function chooseCount(value: number) {
    setCountText(String(value));
  }

  function editRule(value: string) {
    setRule(value);
    setExplanation(null);
    setCopied(false);
  }

  function startTestFromExplanation() {
    setOperation('test');
    setStage('test-setup');
    setError(null);
    if (!countValid) setCountText('10');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => document.getElementById(`${config.id}-count`)?.focus(), 80);
  }

  function backToExplanation() {
    if (explanation) {
      setStage('explanation');
      return;
    }
    setStage('setup');
  }

  async function copyExplanation() {
    if (!explanation) return;
    try {
      await navigator.clipboard.writeText(explanation.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function setAnswer(question: EnglishQuestion, draft: EnglishAnswerDraft) {
    setAnswers((current) => ({ ...current, [question.id]: draft }));
  }

  function questionAnswered(question: EnglishQuestion): boolean {
    const answer = answers[question.id];
    if (!answer) return false;
    return question.type === 'mcq' ? answer.selectedIndex != null : Boolean(answer.text?.trim());
  }

  function unansweredTotal(): number {
    return test?.questions.filter((question) => !questionAnswered(question)).length ?? 0;
  }

  function firstUnansweredIndex(): number {
    return test?.questions.findIndex((question) => !questionAnswered(question)) ?? -1;
  }

  async function finalizeQuiz(): Promise<void> {
    if (!test || busy) return;
    setFinishModalOpen(false);
    if (!beginBusy('grade')) return;
    try {
      const payload: Array<{ questionId: string; selectedIndex?: number; text?: string }> = [];
      for (const question of test.questions) {
        const answer = answers[question.id];
        if (!answer) continue;
        if (question.type === 'mcq') {
          if (answer.selectedIndex != null) {
            payload.push({ questionId: question.id, selectedIndex: answer.selectedIndex });
          }
        } else if (answer.text?.trim()) {
          payload.push({ questionId: question.id, text: answer.text.trim() });
        }
      }

      const data = await aiApi.post<{ result: EnglishResult }>(`${config.apiBase}/grade`, {
        sessionId: test.sessionId,
        answers: payload,
      });
      setResult(data.result);
      setWrongOnly(false);
      setStage('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (caught) {
      handleError(caught, 'تعذّر تصحيح الامتحان. إجاباتك ما زالت محفوظة، حاول مرة أخرى.');
    } finally {
      finishBusy();
    }
  }

  function submitQuiz(): void {
    if (!test || busy) return;
    if (unansweredTotal() > 0) {
      setFinishModalOpen(true);
      return;
    }
    void finalizeQuiz();
  }

  function reviewUnanswered(): void {
    setFinishModalOpen(false);
    const first = firstUnansweredIndex();
    if (first >= 0) setQuizIndex(first);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function restartTest(): void {
    if (busy) return;
    if (!test) return;
    setRule(test.rule);
    setNote(test.note ?? '');
    setCountText(String(test.count));
    setQuestionMode(test.questionMode ?? 'mcq');
    setDifficulty(test.difficulty ?? 'medium');
    setOperation('test');
    void requestTest({
      rule: test.rule,
      note: test.note ?? '',
      count: test.count,
      questionMode: test.questionMode ?? 'mcq',
      difficulty: test.difficulty ?? 'medium',
    });
  }

  function createNewExam(): void {
    if (busy) return;
    setTest(null);
    setResult(null);
    setAnswers({});
    setQuizIndex(0);
    setWrongOnly(false);
    setOperation('test');
    setStage('test-setup');
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reExplain(): void {
    if (busy) return;
    if (result) {
      setRule(result.rule);
      setNote(result.note ?? '');
    }
    void requestExplanation('reexplain', result ? { rule: result.rule, note: result.note ?? '' } : undefined);
  }

  function backToSetup(): void {
    setOperation('explain');
    setStage('setup');
    setError(null);
    setWrongOnly(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goToReview(): void {
    setWrongOnly(true);
    window.setTimeout(() => document.getElementById(`${config.id}-review`)?.scrollIntoView({ behavior: 'smooth' }), 30);
  }

  const currentStage = busyMessage(busy);
  const showHero = stage !== 'quiz' && stage !== 'result';

  return (
    <AppShell>
      {showHero && (
        <PageHeader
          eyebrow={config.eyebrow}
          title={config.title}
          subtitle={config.subtitle}
          actions={
            <span className="badge badge-yellow inline-flex items-center gap-1">
              <config.icon size={13} />
              أداة ذكاء اصطناعي
            </span>
          }
        />
      )}

      {showHero && status && (
        <p className="muted text-xs">
          المزوّد: {status.provider} · النموذج: {status.model} · المتبقي اليوم: {status.remaining} من{' '}
          {status.dailyLimit} طلبًا
        </p>
      )}

      {!hasKey && (
        <Alert tone="info">
          <span className="inline-flex flex-wrap items-center gap-2">
            {config.title} يستخدم مفتاح Groq الخاص بك، وسيُستخدم في الشرح وتوليد الأسئلة. أضفه مرة
            واحدة على هذا الجهاز.
            <button
              type="button"
              className="btn btn-soft px-2 py-1 text-xs"
              onClick={() => openActivation('activate')}
            >
              تفعيل الذكاء الاصطناعي
            </button>
          </span>
        </Alert>
      )}

      {error && <Alert>{error}</Alert>}
      {currentStage && (
        <div className="study-processing" role="status" aria-live="polite">
          <Loader2 size={18} className="animate-spin" />
          <div>
            <p className="text-sm font-bold">{currentStage}</p>
            <p className="muted mt-0.5 text-[11px] leading-6">
              لا تغلق الصفحة؛ ستبقى بيانات القاعدة والملاحظة محفوظة حتى تنتهي العملية.
            </p>
          </div>
        </div>
      )}

      {stage === 'setup' && (
        <form onSubmit={submitSetup} className="card space-y-4 p-4 sm:p-5">
          <div className="form-section mt-0 border-t-0 pt-0">
            <div className="form-section-head">
              <span className="step-badge">1</span>
              <div>
                <h3>القاعدة التي تريد تعلّمها</h3>
                <p>اكتب القاعدة كما تتذكرها، أو اختر مثالًا سريعًا من الأسفل.</p>
              </div>
            </div>
            <RuleFields
              config={config}
              rule={rule}
              note={note}
              onRule={editRule}
              onNote={setNote}
              disabled={busy !== null}
              showExamples
            />
          </div>

          <div className="form-section">
            <div className="form-section-head">
              <span className="step-badge">2</span>
              <div>
                <h3>ماذا تريد أن تفعل؟</h3>
                <p>الشرح يعلّمك القاعدة، والاختبار يقيس فهمك لها.</p>
              </div>
            </div>
            <div className="summary-style-grid">
              <button
                type="button"
                className="summary-style-card"
                aria-pressed={operation === 'explain'}
                onClick={() => chooseOperation('explain')}
                disabled={busy !== null}
              >
                <span className="summary-style-icon">
                  <BookOpen size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold">شرح القاعدة</span>
                  <span className="block text-[10px] leading-5 text-[var(--muted)]">
                    {config.explainHint}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="summary-style-card"
                aria-pressed={operation === 'test'}
                onClick={() => chooseOperation('test')}
                disabled={busy !== null}
              >
                <span className="summary-style-icon">
                  <ClipboardCheck size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold">اختبار على القاعدة</span>
                  <span className="block text-[10px] leading-5 text-[var(--muted)]">
                    أسئلة تفاعلية ونتيجة
                  </span>
                </span>
              </button>
            </div>
          </div>

          {operation === 'test' && (
            <DifficultyPicker
              step={3}
              value={difficulty}
              onChange={setDifficulty}
              disabled={busy !== null}
            />
          )}

          {operation === 'test' && (
            <QuestionModePicker
              step={4}
              value={questionMode}
              onChange={setQuestionMode}
              disabled={busy !== null}
            />
          )}

          {operation === 'test' && (
            <div className="form-section">
              <div className="form-section-head">
                <span className="step-badge">5</span>
                <div>
                  <h3>عدد الأسئلة</h3>
                  <p>اختر عددًا بين 5 و25 سؤالًا.</p>
                </div>
              </div>
              <div className="english-count-row">
                <Field label="العدد" htmlFor={`${config.id}-count`} error={!countValid ? 'أدخل عددًا من 5 إلى 25.' : undefined}>
                  <input
                    id={`${config.id}-count`}
                    type="number"
                    className="input english-count-input"
                    min={5}
                    max={25}
                    step={1}
                    value={countText}
                    onChange={(event) => setCountText(event.target.value)}
                    disabled={busy !== null}
                  />
                </Field>
                <input
                  type="range"
                  className="english-count-range"
                  min={5}
                  max={25}
                  step={1}
                  value={countValid ? count : 10}
                  aria-label="عدد الأسئلة"
                  onChange={(event) => chooseCount(Number(event.target.value))}
                  disabled={busy !== null}
                />
              </div>
              <div className="english-count-chips">
                {COUNT_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    aria-pressed={count === value}
                    onClick={() => chooseCount(value)}
                    disabled={busy !== null}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-actions flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="btn btn-primary sm:w-auto sm:px-6"
              disabled={busy !== null || rule.trim().length < 2 || (operation === 'test' && !countValid)}
            >
              {busy !== null ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {busy === 'explain'
                ? 'جاري تجهيز الشرح…'
                : busy === 'test'
                  ? 'جاري إعداد الأسئلة…'
                  : operation === 'explain'
                    ? 'اشرح القاعدة'
                    : 'أنشئ امتحاني'}
            </button>
            <Link to="/tools" className="btn btn-ghost min-h-9 px-3 text-xs">
              <ArrowRight size={14} />
              كل الأدوات
            </Link>
          </div>
        </form>
      )}

      {stage === 'explanation' && explanation && (
        <>
          <section className="card p-4 sm:p-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="badge badge-mint">شرح القاعدة</span>
                <h2 className="mt-2 font-display text-lg font-extrabold" dir="auto">
                  {explanation.rule}
                </h2>
                <p className="muted mt-1 text-[11px]">
                  {explanation.note ? 'الشرح يراعي ملاحظتك الإضافية · ' : ''}
                  {explanation.provider} · {explanation.model}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyExplanation()}>
                  <Copy size={14} />
                  {copied ? 'تم النسخ' : 'نسخ'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={backToSetup}>
                  تعديل القاعدة
                </button>
              </div>
            </div>

            <MarkdownText content={explanation.content} className="english-explanation" ariaLabel={config.explanationAria} />

            <div className="study-kit-invite mt-4">
              <span className="study-kit-invite-icon">
                <ListChecks size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <h2>هل تريد امتحانًا على هذه القاعدة؟</h2>
                <p>اختبر فهمك للقاعدة من خلال أسئلة تفاعلية يتم إنشاؤها خصيصًا لك.</p>
              </div>
              <button type="button" className="btn btn-primary shrink-0" onClick={startTestFromExplanation}>
                ابدأ الامتحان
                <ChevronLeft size={16} />
              </button>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={backToSetup}>
              <ArrowRight size={15} />
              العودة إلى الإعداد
            </button>
            <span className="muted text-[11px]">المتبقي اليوم: {explanation.remainingToday} طلبًا</span>
          </div>
        </>
      )}

      {stage === 'test-setup' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            void requestTest();
          }}
          className="card space-y-4 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="badge badge-yellow">اختبار على القاعدة</span>
              <h2 className="mt-2 font-display text-lg font-extrabold" dir="auto">
                {rule || 'القاعدة'}
              </h2>
              <p className="muted mt-1 text-[11px]">عدّل البيانات إن أردت، ثم أنشئ الأسئلة.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={backToExplanation} disabled={busy !== null}>
              <ArrowRight size={14} />
              {explanation ? 'رجوع إلى الشرح' : 'رجوع'}
            </button>
          </div>

          <RuleFields
            config={config}
            rule={rule}
            note={note}
            onRule={editRule}
            onNote={setNote}
            disabled={busy !== null}
            showExamples={false}
          />

          <DifficultyPicker
            step={1}
            value={difficulty}
            onChange={setDifficulty}
            disabled={busy !== null}
          />

          <QuestionModePicker
            step={2}
            value={questionMode}
            onChange={setQuestionMode}
            disabled={busy !== null}
          />

          <div className="form-section">
            <div className="form-section-head">
              <span className="step-badge">3</span>
              <div>
                <h3>عدد الأسئلة</h3>
                <p>اختر عددًا بين 5 و25 سؤالًا.</p>
              </div>
            </div>
            <div className="english-count-row">
              <Field label="العدد" htmlFor={`${config.id}-count`} error={!countValid ? 'أدخل عددًا من 5 إلى 25.' : undefined}>
                <input
                  id={`${config.id}-count`}
                  type="number"
                  className="input english-count-input"
                  min={5}
                  max={25}
                  step={1}
                  value={countText}
                  onChange={(event) => setCountText(event.target.value)}
                  disabled={busy !== null}
                />
              </Field>
              <input
                type="range"
                className="english-count-range"
                min={5}
                max={25}
                step={1}
                value={countValid ? count : 10}
                aria-label="عدد الأسئلة"
                onChange={(event) => chooseCount(Number(event.target.value))}
                disabled={busy !== null}
              />
            </div>
            <div className="english-count-chips">
              {COUNT_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  aria-pressed={count === value}
                  onClick={() => chooseCount(value)}
                  disabled={busy !== null}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          <div className="form-actions flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="btn btn-primary sm:w-auto sm:px-6"
              disabled={busy !== null || !countValid || rule.trim().length < 2}
            >
              {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {busy === 'test' ? 'جاري إعداد الأسئلة…' : 'أنشئ امتحاني'}
            </button>
            <span className="muted text-[11px]">سيتم إنشاء أسئلة جديدة على نفس القاعدة، وليس شرحًا جديدًا.</span>
          </div>
        </form>
      )}

      {stage === 'quiz' && test && activeQuestion && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="eyebrow mb-0.5">اختبار القاعدة</p>
              <h1 className="font-display text-lg font-extrabold sm:text-xl" dir="auto">
                {test.rule}
              </h1>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
              <span className="badge badge-yellow">{englishDifficultyLabels[test.difficulty ?? 'medium']}</span>
              <span className="badge badge-lavender">
                {quizIndex + 1} من {test.questions.length}
              </span>
            </div>
          </div>

          <Progress value={quizIndex + 1} max={test.questions.length} />

          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="muted">
              السؤال {quizIndex + 1} من {test.questions.length}
            </span>
            <span className="badge badge-mint py-0 text-[10px]">أجبت عن {answeredCount}</span>
          </div>

          <section className="exam-question card p-4">
            <span className="quiz-question-type">{activeQuestion.typeLabel}</span>
            <p className="mt-1 text-base font-semibold leading-8" dir={config.contentDir} lang={config.contentLang}>
              {activeQuestion.prompt}
            </p>

            <div className="mt-4 space-y-2">
              {activeQuestion.type === 'mcq' ? (
                activeQuestion.options.map((option, optionIndex) => {
                  const selected = answers[activeQuestion.id]?.selectedIndex === optionIndex;
                  return (
                    <button
                      key={`${activeQuestion.id}-${optionIndex}`}
                      type="button"
                      onClick={() =>
                        setAnswer(activeQuestion, {
                          ...answers[activeQuestion.id],
                          selectedIndex: optionIndex,
                        })
                      }
                      className={`quiz-option ${selected ? 'is-selected' : ''}`}
                      aria-pressed={selected}
                      disabled={busy !== null}
                    >
                      <span className="quiz-option-letter">{String.fromCharCode(65 + optionIndex)}</span>
                      <span className="leading-7" dir={config.contentDir} lang={config.contentLang}>
                        {option}
                      </span>
                    </button>
                  );
                })
              ) : (
                <Field
                  label={activeQuestion.type === 'fill_blank' ? 'أكمل الفراغ' : 'الجملة المصححة'}
                  htmlFor={`${config.id}-answer-${activeQuestion.id}`}
                  hint={config.answerHint}
                >
                  <input
                    id={`${config.id}-answer-${activeQuestion.id}`}
                    className="input english-answer-input"
                    dir={config.contentDir}
                    lang={config.contentLang}
                    autoComplete="off"
                    spellCheck={false}
                    value={answers[activeQuestion.id]?.text ?? ''}
                    onChange={(event) =>
                      setAnswer(activeQuestion, {
                        ...answers[activeQuestion.id],
                        text: event.target.value,
                      })
                    }
                    placeholder={
                      activeQuestion.type === 'fill_blank'
                        ? config.fillPlaceholder
                        : config.errorCorrectionPlaceholder
                    }
                    maxLength={1200}
                    disabled={busy !== null}
                  />
                </Field>
              )}
            </div>
          </section>

          <section className="exam-palette" aria-label="التنقل بين أسئلة الامتحان">
            <div className="exam-palette-head">
              <p>الأسئلة</p>
              <span>انتقل إلى أي سؤال</span>
            </div>
            <div className="exam-palette-grid">
              {test.questions.map((question, index) => {
                const answer = answers[question.id];
                const answered =
                  question.type === 'mcq' ? answer?.selectedIndex != null : Boolean(answer?.text?.trim());
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`exam-palette-item ${index === quizIndex ? 'is-active' : ''} ${
                      answered ? 'is-answered' : ''
                    }`}
                    aria-label={`السؤال ${index + 1}`}
                    aria-current={index === quizIndex ? 'step' : undefined}
                    onClick={() => setQuizIndex(index)}
                    disabled={busy !== null}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="exam-actions">
            <button
              type="button"
              className="btn btn-ghost min-h-10 px-3 text-sm"
              onClick={() => setQuizIndex((value) => Math.max(0, value - 1))}
              disabled={quizIndex === 0 || busy !== null}
            >
              <ChevronRight size={16} />
              السابق
            </button>

            {quizIndex < test.questions.length - 1 && (
              <button
                type="button"
                className="btn btn-primary min-h-10 px-4 text-sm"
                onClick={() => setQuizIndex((value) => Math.min(test.questions.length - 1, value + 1))}
                disabled={busy !== null}
              >
                السؤال التالي
                <ChevronLeft size={16} />
              </button>
            )}

            <button
              type="button"
              className="btn exam-finish-btn min-h-10 px-4 text-sm"
              onClick={submitQuiz}
              disabled={busy !== null}
            >
              {busy === 'grade' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {busy === 'grade' ? 'جاري التصحيح…' : 'إنهاء الامتحان'}
            </button>
          </div>

          {finishModalOpen && test && (
            <div className="exam-modal-backdrop" role="presentation">
              <div
                className="exam-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${config.id}-finish-title`}
              >
                <span className="exam-modal-icon" aria-hidden="true">
                  <AlertCircle size={26} />
                </span>
                <h2 id={`${config.id}-finish-title`}>لسه ما خلصت كل الأسئلة!</h2>
                <p>
                  أجبت عن {answeredCount} من {test.questions.length} أسئلة، وبقيت{' '}
                  {test.questions.length - answeredCount} أسئلة بدون إجابة.
                </p>
                <div className="exam-modal-actions">
                  <button type="button" className="btn btn-soft min-h-10" onClick={reviewUnanswered}>
                    مراجعة الأسئلة
                  </button>
                  <button
                    type="button"
                    className="btn exam-finish-btn min-h-10"
                    onClick={() => void finalizeQuiz()}
                  >
                    إنهاء الامتحان
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {stage === 'result' && result && (
        <>
          <section className="card result-card p-5 text-center">
            <span className={`badge ${result.score >= 50 ? 'badge-mint' : 'badge-pink'}`}>
              {result.score >= 50 ? 'أحسنت، استمر' : 'لا بأس، راجع القاعدة'}
            </span>
            <p className="muted mt-2 text-xs">نتيجتك في</p>
            <h2 className="mt-1 font-display text-lg font-extrabold" dir="auto">
              {result.rule}
            </h2>
            <p
              className="result-score mt-1 font-display text-6xl font-extrabold"
              style={{ color: result.score >= 50 ? 'var(--color-ok)' : 'var(--color-bad)' }}
            >
              {result.score}%
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
              <span className="badge badge-yellow">{englishDifficultyLabels[result.difficulty ?? 'medium']}</span>
              <span className="badge badge-lavender">{englishQuestionModeLabels[result.questionMode]}</span>
              <span className="badge">{result.total} سؤالًا</span>
            </div>
            <p className="mt-2 text-sm">
              {result.correctCount} إجابة صحيحة · {result.wrongCount} خاطئة ·{' '}
              {result.unansweredCount} بدون إجابة
            </p>
            <div className="mx-auto mt-4 grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                type="button"
                className="btn btn-primary min-h-10 px-3 text-xs"
                onClick={restartTest}
                disabled={busy !== null}
              >
                {busy === 'test' ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                {busy === 'test' ? 'جارٍ الإنشاء…' : 'أعد الامتحان'}
              </button>
              <button
                type="button"
                className="btn btn-soft min-h-10 px-3 text-xs"
                onClick={goToReview}
                disabled={busy !== null || (result.wrongCount === 0 && result.unansweredCount === 0)}
              >
                <XCircle size={15} />
                راجع الأخطاء
              </button>
              <button
                type="button"
                className="btn btn-soft min-h-10 px-3 text-xs"
                onClick={createNewExam}
                disabled={busy !== null}
              >
                <Sparkles size={15} />
                إنشاء امتحان جديد
              </button>
              <button
                type="button"
                className="btn btn-soft min-h-10 px-3 text-xs"
                onClick={reExplain}
                disabled={busy !== null}
              >
                {busy === 'reexplain' ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />}
                {busy === 'reexplain' ? 'جارٍ الشرح…' : 'شرح القاعدة مرة أخرى'}
              </button>
              <button type="button" className="btn btn-ghost min-h-10 px-3 text-xs" onClick={backToSetup} disabled={busy !== null}>
                <ArrowRight size={15} />
                {config.backToLearning}
              </button>
            </div>
          </section>

          <section id={`${config.id}-review`} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">مراجعة الأسئلة</h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setWrongOnly((value) => !value)}
              >
                {wrongOnly
                  ? 'عرض كل الأسئلة'
                  : `عرض الأخطاء (${result.wrongCount + result.unansweredCount})`}
              </button>
            </div>

            {wrongOnly && result.wrongCount === 0 && result.unansweredCount === 0 ? (
              <div className="card p-5 text-center">
                <CheckCircle2 size={28} className="mx-auto text-[var(--color-ok)]" />
                <p className="mt-2 font-bold">كل الإجابات صحيحة</p>
                <p className="muted mt-1 text-xs">لا توجد أخطاء لمراجعتها في هذه المحاولة.</p>
              </div>
            ) : (
              <ol className="space-y-2">
                {result.questions
                  .filter((question) => !wrongOnly || !question.isCorrect)
                  .map((question) => {
                    const index = result.questions.findIndex((item) => item.id === question.id);
                    const selected = questionAnswerLabel(question);
                    return (
                      <li key={question.id} className="card p-4">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-0.5 shrink-0"
                            style={{ color: question.isCorrect ? 'var(--color-ok)' : 'var(--color-bad)' }}
                          >
                            {question.isCorrect ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="badge py-0 text-[10px]">{question.typeLabel}</span>
                              <span className="muted text-[11px]">السؤال {index + 1}</span>
                            </div>
                            <p className="mt-1 text-sm font-semibold leading-8" dir={config.contentDir} lang={config.contentLang}>
                              {question.prompt}
                            </p>
                          </div>
                        </div>

                        <div className="mt-2 space-y-1.5 ps-7">
                          {question.type === 'mcq' &&
                            question.options.map((option, optionIndex) => {
                              const isSelected = question.selectedIndex === optionIndex;
                              const isCorrect = question.correctIndex === optionIndex;
                              return (
                                <div
                                  key={`${question.id}-review-${optionIndex}`}
                                  className="flex items-center gap-2 rounded-[10px_8px_11px_7px] border-2 px-2.5 py-1.5 text-xs"
                                  style={{
                                    borderColor: isCorrect
                                      ? 'var(--line)'
                                      : isSelected
                                        ? 'var(--line)'
                                        : 'var(--line-soft)',
                                    background: isCorrect
                                      ? 'color-mix(in srgb, var(--mint) 42%, var(--surface))'
                                      : isSelected
                                        ? 'color-mix(in srgb, var(--pink) 40%, var(--surface))'
                                        : undefined,
                                  }}
                                >
                                  <span className="flex-1 leading-6" dir={config.contentDir} lang={config.contentLang}>
                                    {option}
                                  </span>
                                  {isCorrect && <span className="badge badge-mint py-0 text-[9px]">الصحيحة</span>}
                                  {isSelected && !isCorrect && <span className="badge badge-pink py-0 text-[9px]">إجابتك</span>}
                                </div>
                              );
                            })}

                          {question.type !== 'mcq' && (
                            <div className="space-y-1.5 text-xs">
                              <p>
                                <span className="muted">إجابتك: </span>
                                <span
                                  dir={config.contentDir}
                                  lang={config.contentLang}
                                  style={{ color: question.isCorrect ? 'var(--color-ok)' : 'var(--color-bad)' }}
                                >
                                  {selected ?? 'لم تُجب'}
                                </span>
                              </p>
                              {!question.isCorrect && (
                                <p>
                                  <span className="muted">الإجابة الصحيحة: </span>
                                  <span dir={config.contentDir} lang={config.contentLang}>
                                    {question.correctAnswer}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}

                          {!question.answered && (
                            <p className="badge badge-pink justify-center py-1 text-[10px]">
                              لم تتم الإجابة عن هذا السؤال
                            </p>
                          )}
                          <div className="muted text-xs leading-6">
                            <MarkdownText content={question.explanation} compact />
                          </div>
                        </div>
                      </li>
                    );
                  })}
              </ol>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={backToSetup} disabled={busy !== null}>
              <ArrowRight size={14} />
              قاعدة جديدة
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/assistant')}>
              <GraduationCap size={14} />
              اسأل المعلم
            </button>
          </div>
        </>
      )}
    </AppShell>
  );
}
