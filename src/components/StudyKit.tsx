import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Languages,
  Lightbulb,
  ListChecks,
  RotateCcw,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  StudyKit,
  StudyKitQuizQuestion,
  SummaryCardStatus,
  SummaryReviewState,
} from '../lib/aiTypes.ts';

/* -------------------------------------------------------------------------- */
/*                               بطاقات الفلاش                                */
/* -------------------------------------------------------------------------- */

export function FlashcardReview({
  kit,
  state,
  onRate,
}: {
  kit: StudyKit;
  state: SummaryReviewState;
  onRate: (cardId: string, status: SummaryCardStatus) => void;
}) {
  const cards = kit.flashcards;
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const [order, setOrder] = useState<string[]>(() => cards.map((card) => card.id));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [revisits, setRevisits] = useState<string[]>([]);

  useEffect(() => {
    setOrder(cards.map((card) => card.id));
    setIndex(0);
    setFlipped(false);
    setRevisits([]);
  }, [cards]);

  const current = byId.get(order[index]);
  const knownCount = cards.filter((card) => state.cards[card.id] === 'known').length;
  const learningCount = cards.filter((card) => state.cards[card.id] === 'learning').length;
  const completed = index >= order.length;

  function rate(status: SummaryCardStatus) {
    if (!current) return;
    onRate(current.id, status);
    if (status === 'learning' && !revisits.includes(current.id)) {
      setRevisits((value) => [...value, current.id]);
      setOrder((value) => [...value, current.id]);
    }
    setFlipped(false);
    setIndex((value) => value + 1);
  }

  function shuffle() {
    const next = [...cards].sort(() => Math.random() - 0.5).map((card) => card.id);
    setOrder(next);
    setIndex(0);
    setFlipped(false);
    setRevisits([]);
  }

  function restart() {
    setOrder(cards.map((card) => card.id));
    setIndex(0);
    setFlipped(false);
    setRevisits([]);
  }

  if (completed) {
    return (
      <div className="study-complete">
        <div className="study-complete-art">
          <CheckCircle2 size={34} />
        </div>
        <h2>خلصت جلسة المراجعة</h2>
        <p>
          أتقنت <strong>{knownCount}</strong> من <strong>{cards.length}</strong> بطاقة.
          {learningCount > 0 ? ` بقيت ${learningCount} بطاقة تحتاج مراجعة.` : ' كل البطاقات محفوظة.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-primary" onClick={restart}>
            <RotateCcw size={15} /> أعد المراجعة
          </button>
          <button type="button" className="btn btn-ghost" onClick={shuffle}>
            <Shuffle size={15} /> خلط البطاقات
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flashcard-panel">
      <div className="flashcard-topline">
        <span className="badge badge-lavender">
          {index + 1} من {order.length}
        </span>
        <span className="flashcard-mastery">
          <Check size={13} /> {knownCount} محفوظة
        </span>
        <button type="button" className="flashcard-text-btn" onClick={shuffle}>
          <Shuffle size={14} /> خلط
        </button>
      </div>

      <div className="flashcard-stage">
        <button
          type="button"
          className={`flashcard-scene ${flipped ? 'is-flipped' : ''}`}
          onClick={() => setFlipped((value) => !value)}
          aria-label={flipped ? 'اعرض السؤال' : 'اعرض الإجابة'}
        >
          <span className="flashcard-inner">
            <span className="flashcard-face flashcard-front">
              <span className="flashcard-label">سؤال</span>
              <span className="flashcard-text">{current?.front}</span>
              <span className="flashcard-hint">اضغط على البطاقة لرؤية الإجابة</span>
            </span>
            <span className="flashcard-face flashcard-back">
              <span className="flashcard-label">الإجابة</span>
              <span className="flashcard-text">{current?.back}</span>
              <span className="flashcard-hint">اضغط مرة أخرى للعودة للسؤال</span>
            </span>
          </span>
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setIndex((value) => Math.max(0, value - 1));
            setFlipped(false);
          }}
          disabled={index === 0}
        >
          <ChevronRight size={16} /> السابق
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlipped((value) => !value)}>
          <RotateCcw size={14} /> اقلب
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setIndex((value) => Math.min(order.length - 1, value + 1));
            setFlipped(false);
          }}
          disabled={index >= order.length - 1}
        >
          التالي <ChevronLeft size={16} />
        </button>
      </div>

      <div className="flashcard-rating">
        <button type="button" className="btn btn-danger" onClick={() => rate('learning')}>
          <X size={16} /> لسه مش حافظها
        </button>
        <button type="button" className="btn btn-success" onClick={() => rate('known')}>
          <Check size={16} /> أعرفها
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  الاختبار                                  */
/* -------------------------------------------------------------------------- */

function normalized(value: unknown) {
  return String(value)
    .normalize('NFKC')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function quizCorrect(question: StudyKitQuizQuestion, value: string | number | boolean) {
  if (question.type === 'mcq') return String(question.answer) === String(value);
  if (question.type === 'true_false') return String(question.answer) === String(value);
  return normalized(question.answer) === normalized(value) && normalized(value).length > 0;
}

function answerLabel(question: StudyKitQuizQuestion) {
  if (question.type === 'mcq') {
    const index = Number(question.answer);
    return question.options[index] ?? String(question.answer);
  }
  if (question.type === 'true_false') return question.answer === true || question.answer === 'true' ? 'صح' : 'خطأ';
  return String(question.answer);
}

export function QuizReview({
  kit,
  state,
  onAnswer,
  onReset,
}: {
  kit: StudyKit;
  state: SummaryReviewState;
  onAnswer: (questionId: string, correct: boolean, answer: string) => void;
  onReset: () => void;
}) {
  const questions = kit.quiz;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | number | boolean | null>(null);
  const [checked, setChecked] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [shortValue, setShortValue] = useState('');
  const question = questions[index];

  useEffect(() => {
    const saved = question ? state.quiz[question.id] : undefined;
    setSelected(saved?.answer ?? null);
    setChecked(Boolean(saved));
    setShortValue(saved?.answer ?? '');
  }, [index, question, state.quiz]);

  const answered = Object.keys(state.quiz).length;
  const correctCount = Object.values(state.quiz).filter((value) => value.correct).length;
  const score = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
  const allAnswered = answered >= questions.length;

  function choose(value: string | number | boolean) {
    if (!question || checked) return;
    setSelected(value);
    setChecked(true);
    onAnswer(question.id, quizCorrect(question, value), String(value));
  }

  if (showResult || (allAnswered && !reviewing)) {
    const wrong = questions.filter((item) => !state.quiz[item.id]?.correct);
    return (
      <div className="study-quiz-result">
        <div className={`quiz-score-ring ${score >= 60 ? 'is-good' : 'is-low'}`}>
          <strong>{score}%</strong>
          <span>{correctCount} من {questions.length}</span>
        </div>
        <h2>{score >= 60 ? 'شغل جيد، كمّل كذا' : 'لسه محتاجة مراجعة'}</h2>
        <p>أجبت بشكل صحيح عن {correctCount} من {questions.length} أسئلة.</p>
        {wrong.length > 0 && (
          <div className="quiz-wrong-list">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
              <CircleHelp size={14} /> راجع هذه النقاط
            </p>
            {wrong.map((item) => (
              <div key={item.id} className="quiz-wrong-item">
                <span>{item.prompt}</span>
                <strong>{answerLabel(item)}</strong>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onReset();
              setIndex(0);
              setChecked(false);
              setSelected(null);
              setShowResult(false);
              setReviewing(false);
            }}
          >
            <RotateCcw size={15} /> أعد الاختبار
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setReviewing(true); setShowResult(false); }}>
            راجع الأسئلة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="study-quiz">
      <div className="quiz-progress-row">
        <span className="badge badge-lavender">سؤال {index + 1} من {questions.length}</span>
        <span className="muted text-[11px]">{answered} تمت الإجابة</span>
      </div>
      <div className="quiz-progress-track">
        <span style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
      </div>

      <div className="quiz-question-card">
        <span className="quiz-question-type">
          {question.type === 'mcq' ? 'اختيار من متعدد' : question.type === 'true_false' ? 'صح أو خطأ' : 'إجابة قصيرة'}
        </span>
        <h2>{question.prompt}</h2>
        {question.type === 'short' ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="input"
              value={shortValue}
              onChange={(event) => setShortValue(event.target.value)}
              placeholder="اكتب إجابتك…"
              disabled={checked}
              dir="auto"
            />
            <button type="button" className="btn btn-primary shrink-0" onClick={() => choose(shortValue)} disabled={!shortValue.trim() || checked}>
              تحقق
            </button>
          </div>
        ) : (
          <div className="quiz-options">
            {(question.type === 'true_false' ? ['true', 'false'] : question.options).map((option, optionIndex) => {
              const value = question.type === 'true_false' ? option === 'true' : optionIndex;
              const label = question.type === 'true_false' ? (option === 'true' ? 'صح' : 'خطأ') : option;
              const isSelected = String(selected) === String(value);
              const isRight = checked && quizCorrect(question, value);
              const isWrong = checked && isSelected && !isRight;
              return (
                <button
                  key={`${option}-${optionIndex}`}
                  type="button"
                  className={`quiz-option ${isSelected ? 'is-selected' : ''} ${isRight ? 'is-correct' : ''} ${isWrong ? 'is-wrong' : ''}`}
                  onClick={() => choose(value)}
                  disabled={checked}
                >
                  <span className="quiz-option-letter">{question.type === 'true_false' ? (option === 'true' ? '✓' : '×') : String.fromCharCode(65 + optionIndex)}</span>
                  <span>{label}</span>
                  {isRight && <CheckCircle2 size={17} className="ms-auto shrink-0" />}
                  {isWrong && <X size={17} className="ms-auto shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
        {checked && (
          <div className={`quiz-feedback ${state.quiz[question.id]?.correct ? 'is-good' : 'is-bad'}`}>
            <strong>{state.quiz[question.id]?.correct ? 'إجابة صحيحة' : 'الإجابة تحتاج مراجعة'}</strong>
            <p>الإجابة الصحيحة: {answerLabel(question)}</p>
            {question.explanation && <p>{question.explanation}</p>}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}>
          <ChevronRight size={15} /> السابق
        </button>
        {index < questions.length - 1 ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setIndex((value) => value + 1)}>
            السؤال التالي <ChevronLeft size={15} />
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setReviewing(false); setShowResult(true); }} disabled={!allAnswered}>
            اعرض النتيجة
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                             النقاط والمصطلحات                              */
/* -------------------------------------------------------------------------- */

export function KeyPointsView({ kit }: { kit: StudyKit }) {
  if (kit.keyPoints.length === 0) return <EmptyStudySection text="لم يجد الملخص نقاطًا إضافية كافية." />;
  return (
    <div className="kit-card-grid">
      {kit.keyPoints.map((point, index) => (
        <article key={`${point.title}-${index}`} className="note-card">
          <span className="note-number">{String(index + 1).padStart(2, '0')}</span>
          <h3>{point.title}</h3>
          <p>{point.body}</p>
        </article>
      ))}
    </div>
  );
}

export function DefinitionsView({ kit }: { kit: StudyKit }) {
  if (kit.definitions.length === 0) return <EmptyStudySection text="لم يحتج هذا الدرس إلى قسم تعريفات مستقل." />;
  return (
    <div className="definitions-list">
      {kit.definitions.map((item, index) => (
        <article key={`${item.term}-${index}`} className="definition-card">
          <span className="definition-icon"><Languages size={17} /></span>
          <div className="min-w-0">
            <h3>{item.term}</h3>
            <p>{item.definition}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function StudyExtras({ kit }: { kit: StudyKit }) {
  const hasAnything =
    kit.comparisons.length > 0 || kit.equations.length > 0 || kit.timeline.length > 0;
  if (!hasAnything) return null;
  return (
    <div className="study-extras">
      {kit.comparisons.length > 0 && (
        <section>
          <div className="study-section-title"><Sparkles size={16} /> مقارنات من الدرس</div>
          {kit.comparisons.map((comparison, index) => (
            <div key={`${comparison.title}-${index}`} className="comparison-card">
              <h3>{comparison.title}</h3>
              <div className="comparison-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الوجه</th>
                      <th>{comparison.leftTitle}</th>
                      <th>{comparison.rightTitle}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((row, rowIndex) => (
                      <tr key={`${row.aspect}-${rowIndex}`}>
                        <td>{row.aspect}</td>
                        <td>{row.left}</td>
                        <td>{row.right}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {kit.equations.length > 0 && (
        <section>
          <div className="study-section-title"><Lightbulb size={16} /> قوانين ومعادلات</div>
          <div className="kit-card-grid">
            {kit.equations.map((equation, index) => (
              <article key={`${equation.expression}-${index}`} className="equation-card">
                <div className="equation-expression" dir="ltr">{equation.expression}</div>
                <p>{equation.meaning}</p>
                {equation.symbols.length > 0 && (
                  <dl className="equation-symbols">
                    {equation.symbols.map((symbol) => (
                      <div key={symbol.symbol}>
                        <dt dir="ltr">{symbol.symbol}</dt>
                        <dd>{symbol.meaning}{symbol.unit ? ` (${symbol.unit})` : ''}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {equation.example && <p className="equation-example">{equation.example}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      {kit.timeline.length > 0 && (
        <section>
          <div className="study-section-title"><ListChecks size={16} /> تسلسل الأحداث</div>
          <ol className="timeline-list">
            {kit.timeline.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                <span className="timeline-dot">{index + 1}</span>
                <div>
                  <h3>{item.label}</h3>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function VisualMapView({ kit }: { kit: StudyKit }) {
  const visual = kit.visual;
  if (!visual || visual.branches.length === 0) {
    return <EmptyStudySection text="لم يولّد الملخص مخططًا بصريًا لهذا الدرس." />;
  }
  return (
    <div className={`visual-map is-${visual.kind}`}>
      <p className="visual-map-kicker">{visual.title}</p>
      <div className="visual-center">{visual.center}</div>
      <div className="visual-branches">
        {visual.branches.map((branch, index) => (
          <article key={`${branch.title}-${index}`} className="visual-branch" style={{ '--branch-index': index } as CSSProperties}>
            <h3>{branch.title}</h3>
            {branch.detail && <p>{branch.detail}</p>}
            {branch.children.length > 0 && (
              <ul>
                {branch.children.map((child, childIndex) => (
                  <li key={`${child.title}-${childIndex}`}>
                    <strong>{child.title}</strong>
                    {child.detail && <span>{child.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function EmptyStudySection({ text }: { text: string }) {
  return (
    <div className="study-empty">
      <CircleHelp size={24} />
      <p>{text}</p>
    </div>
  );
}

export function StudyTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; icon: typeof BookOpen; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav className="study-tabs" aria-label="أقسام الملخص">
      <div className="study-tabs-track">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={active === tab.id ? 'page' : undefined}
            className={`study-tab ${active === tab.id ? 'is-active' : ''}`}
          >
            <tab.icon size={16} />
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && <span className="study-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

