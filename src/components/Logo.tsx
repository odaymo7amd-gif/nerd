export function Logo({ size = 40, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        role="img"
        aria-label="شعار NERD"
        className="shrink-0 drop-shadow-[0_5px_10px_rgba(81,51,156,0.18)]"
      >
        <rect x="16" y="16" width="480" height="480" rx="142" fill="#7854D8" />
        <path
          d="M96 150c0-15 12-27 27-27h109c17 0 31 14 31 31v233c-8-13-22-21-38-21H123c-15 0-27-12-27-27z"
          fill="#FFF9F4"
          opacity="0.98"
        />
        <path
          d="M416 150c0-15-12-27-27-27H280c-17 0-31 14-31 31v233c8-13 22-21 38-21h102c15 0 27-12 27-27z"
          fill="#EDE4FF"
        />
        <path
          d="M249 154c-17-16-38-23-61-23h-28v206h32c23 0 43 7 57 21z"
          fill="#FFF9F4"
        />
        <path
          d="M263 154c17-16 38-23 61-23h28v206h-32c-23 0-43 7-57 21z"
          fill="#FFF9F4"
        />
        <path d="M255 166v188" stroke="#51339C" strokeWidth="13" strokeLinecap="round" />
        <path
          d="M142 207h56M142 251h56M142 295h42M314 207h56M314 251h56M314 295h42"
          stroke="#B7A1F0"
          strokeWidth="15"
          strokeLinecap="round"
        />
        <path
          d="m374 110 10 25 27 2-21 18 6 27-22-15-23 15 7-27-21-18 27-2z"
          fill="#FFE69A"
          stroke="#28233A"
          strokeWidth="9"
          strokeLinejoin="round"
        />
        <circle cx="112" cy="386" r="17" fill="#FFD6E5" />
      </svg>
      {showText && (
        <span className="leading-none">
          <span className="logo-word block text-lg font-extrabold tracking-[0.18em]">NERD</span>
          <span className="muted block text-[11px] tracking-[0.3em]">نيرد</span>
        </span>
      )}
    </div>
  );
}
