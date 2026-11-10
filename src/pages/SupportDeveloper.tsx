import {
  ArrowUpLeft,
  BookOpen,
  Code2,
  FileText,
  GraduationCap,
  Heart,
  HeartHandshake,
  Instagram,
  Languages,
  ListChecks,
  Quote,
  Rocket,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';

const INSTAGRAM_URL = 'https://www.instagram.com/oday7_77?xtok=NmFjOXhiOWtyMGZn';

const whyItems = [
  {
    icon: GraduationCap,
    title: 'معلّم ذكي',
    text: 'معلّمًا ذكيًا يساعده على الفهم.',
  },
  {
    icon: Languages,
    title: 'لغتان في مكان واحد',
    text: 'أدوات لتعلّم اللغة العربية والإنجليزية.',
  },
  {
    icon: ListChecks,
    title: 'امتحانات وتدريب',
    text: 'إمكانية إنشاء امتحانات وتدريب نفسه.',
  },
  {
    icon: FileText,
    title: 'ملخصات وأدوات دراسة',
    text: 'ملخصات وأدوات تعليمية تساعده في الدراسة.',
  },
  {
    icon: Rocket,
    title: 'تطوير مستمر',
    text: 'تجربة تعليمية تتطور باستمرار وفق احتياجات الطلاب.',
  },
];

function JordanFlag({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`support-flag ${className}`.trim()}
      viewBox="0 0 42 28"
      role="img"
      aria-label="علم الأردن"
    >
      <rect width="42" height="28" fill="#fff" />
      <rect width="42" height="9.34" fill="#111" />
      <rect y="18.66" width="42" height="9.34" fill="#007a3d" />
      <path d="M0 0 18 14 0 28Z" fill="#ce1126" />
      <polygon
        fill="#fff"
        points="7.5,11.4 9.13,12.38 10.03,14.08 8.63,16.34 5.62,16.34 4.97,14.08 5.88,12.38 7.98,13.01 8.57,13.76 8.36,14.69 7.5,15.1 6.64,14.69 6.43,13.76 7.02,13.01"
      />
    </svg>
  );
}

export default function SupportDeveloperPage() {
  return (
    <AppShell>
      <div className="support-page">
        <section className="support-hero" aria-labelledby="support-hero-title">
          <div className="support-hero-copy">
            <span className="support-eyebrow">
              <Sparkles size={13} aria-hidden="true" />
              وراء نيرد
            </span>
            <h1 id="support-hero-title">
              وراء نيرد <span>حكاية وطموح</span>
            </h1>
            <p className="support-name">عدي محمد</p>
            <p className="support-role">مؤسس ومطوّر تطبيق نيرد (NERD).</p>
          </div>

          <div className="support-hero-art" aria-hidden="true">
            <span className="support-orbit support-orbit--one" />
            <span className="support-orbit support-orbit--two" />
            <span className="support-monogram">ع</span>
            <span className="support-art-chip support-art-chip--code">
              <Code2 size={15} />
            </span>
            <span className="support-art-chip support-art-chip--spark">
              <Sparkles size={15} />
            </span>
            <span className="support-art-chip support-art-chip--book">
              <BookOpen size={15} />
            </span>
          </div>

          <p className="support-hero-intro">
            أنا عدي محمد، شاب أردني مهتم بالتكنولوجيا والذكاء الاصطناعي وصناعة التطبيقات.
          </p>

          <div className="support-hero-badges" aria-label="عن المطوّر">
            <span>
              <JordanFlag /> من الأردن
            </span>
            <span>
              <Heart size={12} aria-hidden="true" /> صُنع بشغف للطلاب
            </span>
          </div>
        </section>

        <section className="support-panel support-story" aria-labelledby="support-story-title">
          <span className="support-panel-icon" aria-hidden="true">
            <BookOpen size={21} />
          </span>
          <p className="support-kicker">البداية</p>
          <h2 id="support-story-title">من فكرة صغيرة إلى تطبيق تعليمي</h2>
          <div className="support-prose">
            <p>
              بدأت فكرة نيرد من طموح بسيط لكنه كبير: أن أصنع تجربة تعليمية ذكية تساعد الطلاب على
              فهم دروسهم، وتطوير مستواهم الدراسي، وتجعل التعلّم أكثر سهولة ومتعة.
            </p>
            <p>
              أعمل على تطوير نيرد وتحسينه باستمرار، وأسعى إلى تحويله من مجرد فكرة إلى تطبيق
              تعليمي متكامل يخدم الطلاب ويقدم لهم أدوات ذكية ومفيدة.
            </p>
            <p>
              نيرد ليس مجرد تطبيق بالنسبة لي، بل مشروع أعمل عليه بشغف وطموح، وأتمنى أن يكبر
              بمشاركة ودعم مستخدميه.
            </p>
          </div>
          <p className="support-jordan">
            من الأردن، بدأت الفكرة، والطموح أن تصل إلى كل طالب عربي. <JordanFlag />
          </p>
        </section>

        <section className="support-panel support-why" aria-labelledby="support-why-title">
          <span className="support-panel-icon" aria-hidden="true">
            <Sparkles size={21} />
          </span>
          <p className="support-kicker">الفكرة</p>
          <h2 id="support-why-title">لماذا أنشأت نيرد؟</h2>
          <p className="support-lead">
            أنشأت نيرد لأجعل الذكاء الاصطناعي أقرب إلى الطالب، وليس مجرد أداة للإجابة عن الأسئلة.
          </p>
          <p className="support-list-intro">أريد أن يجد الطالب في مكان واحد:</p>
          <ul className="support-why-list">
            {whyItems.map((item) => (
              <li key={item.title}>
                <span className="support-why-icon" aria-hidden="true">
                  <item.icon size={17} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                </span>
              </li>
            ))}
          </ul>
          <p className="support-goal">
            <HeartHandshake size={17} aria-hidden="true" />
            هدفي أن يكون نيرد رفيق الطالب في رحلته التعليمية.
          </p>
        </section>

        <section className="support-panel support-impact" aria-labelledby="support-impact-title">
          <span className="support-impact-heart" aria-hidden="true">
            <Heart size={30} />
          </span>
          <p className="support-kicker">أنت جزء من الرحلة</p>
          <h2 id="support-impact-title">
            دعمك يصنع فرقًا <span aria-hidden="true">❤️</span>
          </h2>
          <div className="support-prose">
            <p>
              إذا أعجبك نيرد واستفدت منه، فإن دعمك ومشاركتك للتطبيق تعني لي الكثير.
            </p>
            <p>
              أنا أعمل على تطوير هذا المشروع وتحسينه باستمرار، ودعمك يساعدني على الاستمرار في
              إضافة أفكار وميزات جديدة وتقديم تجربة أفضل للجميع.
            </p>
            <p>
              حتى لو لم تستطع تقديم دعم مادي، فإن متابعة حسابي ومشاركة التطبيق مع أصدقائك تعتبر
              دعمًا كبيرًا بالنسبة لي.
            </p>
          </div>
          <p className="support-thanks">شكرًا لأنك جزء من رحلة نيرد!</p>
        </section>

        <section className="support-instagram" aria-labelledby="support-instagram-title">
          <span className="support-instagram-icon" aria-hidden="true">
            <Instagram size={30} />
          </span>
          <div className="support-instagram-copy">
            <p className="support-kicker">تابعني عن قرب</p>
            <h2 id="support-instagram-title">تابع المطوّر على إنستغرام</h2>
            <p className="support-instagram-handle" dir="ltr">
              @oday7_77
            </p>
            <p className="support-instagram-desc">
              تابعني لمعرفة جديد نيرد ومتابعة رحلة تطويره.
            </p>
          </div>
          <a
            className="support-instagram-btn"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="تابع المطوّر عدي محمد على إنستغرام"
          >
            <Instagram size={17} aria-hidden="true" />
            تابعني على إنستغرام
            <ArrowUpLeft size={16} aria-hidden="true" />
          </a>
        </section>

        <section className="support-letter" aria-labelledby="support-letter-title">
          <Quote className="support-letter-quote" size={34} aria-hidden="true" />
          <p className="support-kicker">رسالة من المطوّر</p>
          <h2 id="support-letter-title" className="sr-only">
            رسالة من المطوّر
          </h2>
          <div className="support-letter-body">
            <p>
              كل مشروع كبير بدأ بفكرة صغيرة، ونيرد بالنسبة لي بداية حلم أطمح أن يصل إلى أبعد مما
              أتخيل.
            </p>
            <p>
              شكرًا لكل شخص جرّب التطبيق، وشكرًا لكل شخص دعمه أو شاركه أو أعطاني ملاحظة تساعدني
              على تطويره.
            </p>
            <p>وجودكم جزء من نجاح هذه الرحلة. ❤️</p>
          </div>
          <p className="support-signature">
            بكل فخر، عدي محمد — مطوّر نيرد.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
