import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { AppShell } from '../components/AppShell.tsx';
import { NerdMascot } from '../components/NerdMascot.tsx';
import { Alert, Field, FullPageLoader, SubmitButton } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import type { MetaPayload } from '../lib/types.ts';

export default function OnboardingPage() {
  const { user, setUser, logout } = useSession();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countryId, setCountryId] = useState<number | null>(user?.countryId ?? null);
  const [curriculumId, setCurriculumId] = useState<number | null>(user?.curriculumId ?? null);
  const [gradeLevelId, setGradeLevelId] = useState<number | null>(user?.gradeLevelId ?? null);
  const [semesterId, setSemesterId] = useState<number | null>(user?.semesterId ?? null);
  const [subjectIds, setSubjectIds] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<MetaPayload>('/meta')
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        const firstCurriculum = data.curricula[0];
        setCountryId((current) => current ?? data.countries[0]?.id ?? null);
        setCurriculumId((current) => current ?? firstCurriculum?.id ?? null);
        setSemesterId((current) => current ?? firstCurriculum?.semesters[0]?.id ?? null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل بيانات المناهج.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const curriculum = useMemo(
    () => meta?.curricula.find((item) => item.id === curriculumId) ?? null,
    [meta, curriculumId],
  );

  function toggleSubject(id: number) {
    setSubjectIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function onSubmit() {
    if (busy) return;
    if (!countryId || !curriculumId || !gradeLevelId) {
      setError('اختر الدولة والمنهاج والصف الدراسي للمتابعة.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api.patch<{ user: typeof user }>('/profile', {
        countryId,
        curriculumId,
        gradeLevelId,
        semesterId,
        subjectIds,
      });
      if (data.user) setUser(data.user);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ بيانات الدراسة.');
    } finally {
      setBusy(false);
    }
  }

  if (!meta) {
    return (
      <div className="mx-auto max-w-2xl px-4">
        {error ? <Alert>{error}</Alert> : <FullPageLoader label="جار تحميل المناهج…" />}
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl">
        <div className="card p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <NerdMascot className="w-16 shrink-0 sm:w-20" />
            <div className="min-w-0">
              <p className="eyebrow">خطوة واحدة فقط</p>
              <h1 className="text-2xl font-bold">لنُجهّز ملفك الدراسي</h1>
              <p className="muted mt-1 text-sm">
                اختر بياناتك مرة واحدة، وستُخصَّص الصفحة الرئيسية والأدوات حسب صفك وموادك.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {error && <Alert>{error}</Alert>}

            <Field label="الدولة" htmlFor="country">
              <select
                id="country"
                className="input"
                value={countryId ?? ''}
                onChange={(event) => setCountryId(Number(event.target.value))}
              >
                {meta.countries.map((country) => (
                  <option key={country.id} value={country.id}>
                    {country.name_ar}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="المنهاج" htmlFor="curriculum">
              <select
                id="curriculum"
                className="input"
                value={curriculumId ?? ''}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setCurriculumId(next);
                  setGradeLevelId(null);
                  const found = meta.curricula.find((item) => item.id === next);
                  setSemesterId(found?.semesters[0]?.id ?? null);
                  setSubjectIds([]);
                }}
              >
                {meta.curricula.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الصف الدراسي" htmlFor="grade">
                <select
                  id="grade"
                  className="input"
                  value={gradeLevelId ?? ''}
                  onChange={(event) => setGradeLevelId(Number(event.target.value))}
                >
                  <option value="">— اختر الصف —</option>
                  {curriculum?.grades.map((grade) => (
                    <option key={grade.id} value={grade.id}>
                      {grade.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="الفصل الدراسي" htmlFor="semester">
                <select
                  id="semester"
                  className="input"
                  value={semesterId ?? ''}
                  onChange={(event) => setSemesterId(Number(event.target.value))}
                >
                  {curriculum?.semesters.map((semester) => (
                    <option key={semester.id} value={semester.id}>
                      {semester.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <p className="label">المواد التي تدرسها</p>
              <div className="flex flex-wrap gap-2">
                {curriculum?.subjects.map((subject) => {
                  const selected = subjectIds.includes(subject.id);
                  return (
                    <button
                      key={subject.id}
                      type="button"
                      onClick={() => toggleSubject(subject.id)}
                      aria-pressed={selected}
                      className="chip"
                    >
                      {selected && <Check size={14} />}
                      {subject.name}
                    </button>
                  );
                })}
              </div>
              <p className="muted mt-2 text-xs">اختياري: يمكنك تعديل المواد لاحقًا من حسابك.</p>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <SubmitButton type="button" busy={busy} onClick={onSubmit} className="btn btn-primary flex-1">
                {busy ? 'جار الحفظ…' : 'حفظ ومتابعة'}
              </SubmitButton>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  await logout();
                  navigate('/login', { replace: true });
                }}
              >
                تسجيل الخروج
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
