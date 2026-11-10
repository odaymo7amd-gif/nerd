/**
 * شخصية NERD الأصلية: كتاب دراسي لطيف بنظارة وقبعة تخرّج، يحمل قلمًا.
 * رسم متجهي بسيط بنفس حدود الحبر وألوان الهوية.
 */
export function NerdMascot({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 200"
      role="img"
      aria-label="شخصية نيرد: كتاب دراسي يحمل قلمًا"
      className={className}
    >
      {/* ظل أرضي */}
      <ellipse cx="110" cy="181" rx="62" ry="9" fill="#28233A" opacity="0.14" />

      {/* القبعة */}
      <path
        d="M74 44 110 26l36 18-36 18z"
        fill="#28233A"
        stroke="#28233A"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M110 62v10" stroke="#28233A" strokeWidth="4" strokeLinecap="round" />
      <circle cx="110" cy="78" r="6" fill="#FFE69A" stroke="#28233A" strokeWidth="4" />
      <path d="M146 44v26" stroke="#FFE69A" strokeWidth="5" strokeLinecap="round" />
      <path d="M146 70l6 8 6-8" fill="#FFE69A" stroke="#28233A" strokeWidth="3" strokeLinejoin="round" />

      {/* جسم الكتاب */}
      <rect
        x="50"
        y="72"
        width="120"
        height="92"
        rx="16"
        fill="#FFF9F4"
        stroke="#28233A"
        strokeWidth="5"
      />
      {/* كعب الكتاب */}
      <path d="M72 76v84" stroke="#FFD6E5" strokeWidth="9" strokeLinecap="round" />
      {/* ورق مسطّر */}
      <path d="M92 138h60M92 150h40" stroke="#7854D8" strokeWidth="4" strokeLinecap="round" opacity="0.55" />

      {/* الوجه */}
      <circle cx="104" cy="108" r="5" fill="#28233A" />
      <circle cx="136" cy="108" r="5" fill="#28233A" />
      <rect x="90" y="99" width="28" height="19" rx="9" fill="none" stroke="#7854D8" strokeWidth="4" />
      <rect x="122" y="99" width="28" height="19" rx="9" fill="none" stroke="#7854D8" strokeWidth="4" />
      <path d="M118 107h4" stroke="#7854D8" strokeWidth="4" strokeLinecap="round" />
      <path d="M113 126c4 5 14 5 18 0" stroke="#28233A" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* وجنتان */}
      <circle cx="88" cy="121" r="3.5" fill="#FFD6E5" opacity="0.85" />
      <circle cx="152" cy="121" r="3.5" fill="#FFD6E5" opacity="0.85" />

      {/* الذراعان */}
      <path d="M50 118c-12 2-18 10-18 20" stroke="#28233A" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M170 128c10 2 16 9 16 18" stroke="#28233A" strokeWidth="5" strokeLinecap="round" fill="none" />

      {/* القلم في اليد اليسرى */}
      <g transform="rotate(-24 43 143)">
        <rect x="34" y="118" width="16" height="46" rx="6" fill="#FFE69A" stroke="#28233A" strokeWidth="4" />
        <path d="M34 164h16l-8 14z" fill="#FFF9F4" stroke="#28233A" strokeWidth="4" strokeLinejoin="round" />
        <path d="M42 172l4 6" stroke="#28233A" strokeWidth="3" strokeLinecap="round" />
        <rect x="34" y="112" width="16" height="10" rx="4" fill="#FFD6E5" stroke="#28233A" strokeWidth="4" />
      </g>

      {/* نجوم صغيرة */}
      <path d="M38 72v14M31 79h14" stroke="#BDEECB" strokeWidth="5" strokeLinecap="round" />
      <path d="M188 92v10M183 97h10" stroke="#EDE4FF" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
