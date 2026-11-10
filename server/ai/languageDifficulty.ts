// مستويات صعوبة موحّدة لأداتَي تعلّم الإنجليزية والعربية.
// الوصف يُرسل إلى النموذج، والواجهة تعرض نفس التسميات حتى لا يختلف المعنى بينهما.

export const LANGUAGE_DIFFICULTIES = ['easy', 'medium', 'hard', 'advanced'] as const;
export type LanguageDifficulty = (typeof LANGUAGE_DIFFICULTIES)[number];

export const LANGUAGE_DIFFICULTY_LABELS: Record<LanguageDifficulty, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
  advanced: 'قدرات عليا',
};

export const LANGUAGE_DIFFICULTY_SHORT_HINTS: Record<LanguageDifficulty, string> = {
  easy: 'جمل قصيرة وتطبيق مباشر للقاعدة.',
  medium: 'سياقات متنوعة وخيارات أقرب.',
  hard: 'تحليل وتفاصيل وحالات متشابهة.',
  advanced: 'استنتاج متعدد الخطوات على النمط الوزاري.',
};

export const LANGUAGE_DIFFICULTY_INSTRUCTIONS: Record<LanguageDifficulty, string> = {
  easy:
    'أسئلة مباشرة تقيس فهم الأساسيات: جمل قصيرة وواضحة، تطبيق مباشر للقاعدة، وخيارات غير معقدة.',
  medium:
    'أسئلة تحتاج تطبيق القاعدة وفهمها في سياقات مختلفة: جمل متنوعة، تمييز بين الاستخدامات، خيارات متقاربة نسبيًا، وخطوات تفكير بسيطة.',
  hard:
    'أسئلة تحتاج تحليلًا دقيقًا: خيارات متقاربة، جمل تنتبه للتفاصيل، جمع بين أكثر من جانب من القاعدة، وتمييز بين الحالات المتشابهة.',
  advanced:
    'أسئلة قدرات عليا على النمط الوزاري الأردني (وليست أسئلة وزارية حقيقية): تحليل الجمل والسياق، الربط بين أكثر من مفهوم، الاستنتاج غير المباشر، اكتشاف أخطاء دقيقة، خيارات متقاربة جدًا، وتطبيق القاعدة في موقف جديد. تحتاج كل مسألة إلى خطوتين ذهنيتين على الأقل، وتبقى ملتصقة بالقاعدة المطلوبة ولا تخرج عنها.',
};

export function languageDifficultyFrom(value: unknown): LanguageDifficulty {
  return LANGUAGE_DIFFICULTIES.includes(value as LanguageDifficulty)
    ? (value as LanguageDifficulty)
    : 'medium';
}

/** صياغة موحّدة تُدرج في تعليمات المولّد. */
export function difficultyPromptLines(difficulty: LanguageDifficulty): string[] {
  return [
    `مستوى الصعوبة المختار: ${LANGUAGE_DIFFICULTY_LABELS[difficulty]}.`,
    LANGUAGE_DIFFICULTY_INSTRUCTIONS[difficulty],
    difficulty === 'advanced'
      ? 'لا تصف الأسئلة بأنها «أسئلة وزارية حقيقية». استخدم عبارة «على النمط الوزاري» فقط. لا تخرج عن القاعدة المحددة، ولا تحوّل السؤال إلى سؤال عام في اللغة.'
      : 'حافظ على المستوى المختار؛ لا تجعل الأسئلة أصعب أو أسهل من المطلوب.',
  ];
}
