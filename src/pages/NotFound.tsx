import { Link } from 'react-router-dom';
import { NerdMascot } from '../components/NerdMascot.tsx';

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <NerdMascot className="hero-mascot w-32" />
      <p className="font-display text-6xl font-extrabold leading-none">
        <span className="inline-block -rotate-2 rounded-[14px_10px_16px_9px] border-[2.5px] border-[var(--line)] bg-[var(--yellow)] px-4 py-2 shadow-[var(--shadow)]">
          404
        </span>
      </p>
      <h1 className="mt-2 text-xl font-bold">الصفحة غير موجودة</h1>
      <p className="muted max-w-xs text-sm leading-7">
        الرابط الذي فتحته غير متاح، أو تغيّر موقعه. يمكنك العودة إلى الصفحة الرئيسية ومتابعة الدراسة.
      </p>
      <Link to="/" className="btn btn-primary mt-2">
        العودة للرئيسية
      </Link>
    </div>
  );
}
