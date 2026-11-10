import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, ImagePlus, Megaphone, Pencil, Trash2, Upload } from 'lucide-react';
import { DevError, DevHeader, EmptyBlock, LoadingBlock, Panel, StatusBadge, Toggle } from '../ui.tsx';
import { api, ApiError, formatDateTime } from '../../../lib/api.ts';
import type { AdRecord } from '../../../lib/developerTypes.ts';
import { audienceLabels, toIsoOrNull, toLocalDateTimeInput } from '../format.ts';

interface AdForm {
  title: string;
  body: string;
  audience: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  imagePath: string | null;
}

const emptyForm: AdForm = {
  title: '',
  body: '',
  audience: 'all',
  startsAt: '',
  endsAt: '',
  isActive: true,
  imagePath: null,
};

export function DeveloperAds() {
  const [ads, setAds] = useState<AdRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<AdForm>(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api.get<{ ads: AdRecord[] }>('/developer/ads');
      setAds(payload.ads);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحميل الإعلانات.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function reset() {
    setEditing(null);
    setForm(emptyForm);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('image', file);
      const response = await fetch('/api/developer/ads/upload', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      const payload = (await response.json()) as { imagePath?: string; error?: { message?: string } };
      if (!response.ok || !payload.imagePath) {
        throw new ApiError(response.status, payload.error?.message ?? 'تعذّر رفع الصورة.');
      }
      if (localPreview) URL.revokeObjectURL(localPreview);
      setLocalPreview(URL.createObjectURL(file));
      setForm((current) => ({ ...current, imagePath: payload.imagePath ?? null }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر رفع الصورة.');
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        title: form.title.trim(),
        body: form.body.trim(),
        audience: form.audience,
        startsAt: toIsoOrNull(form.startsAt),
        endsAt: toIsoOrNull(form.endsAt),
        isActive: form.isActive,
        imagePath: form.imagePath,
      };
      if (editing) {
        await api.patch(`/developer/ads/${editing}`, body);
        setNotice('تم تحديث الإعلان.');
      } else {
        await api.post('/developer/ads', body);
        setNotice('تم إنشاء الإعلان وأصبح جاهزًا للعرض حسب الجمهور والتواريخ.');
      }
      reset();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ الإعلان.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(ad: AdRecord) {
    try {
      await api.patch(`/developer/ads/${ad.id}`, { isActive: !ad.isActive });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث حالة الإعلان.');
    }
  }

  async function remove(ad: AdRecord) {
    if (!window.confirm(`حذف الإعلان «${ad.title}» نهائيًا؟`)) return;
    try {
      await api.del(`/developer/ads/${ad.id}`);
      if (editing === ad.id) reset();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر حذف الإعلان.');
    }
  }

  function edit(ad: AdRecord) {
    setEditing(ad.id);
    setForm({
      title: ad.title,
      body: ad.body,
      audience: ad.audience,
      startsAt: toLocalDateTimeInput(ad.startsAt),
      endsAt: toLocalDateTimeInput(ad.endsAt),
      isActive: ad.isActive,
      imagePath: ad.imagePath,
    });
    setLocalPreview(ad.imageUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const previewImage = localPreview ?? (form.imagePath && editing ? `/api/ads/${editing}/image` : null);

  return (
    <div className="dev-stack">
      <DevHeader
        eyebrow="التواصل الداخلي"
        title="الإعلانات الداخلية"
        subtitle="نظام منفصل عن الإشعارات. يظهر الإعلان في الرئيسية حسب الجمهور وتاريخ البداية والنهاية."
      />

      {error && <DevError>{error}</DevError>}
      {notice && <div className="dev-success">{notice}</div>}

      <div className="dev-grid-2 dev-grid-wide-left">
        <Panel title={editing ? 'تعديل إعلان' : 'إنشاء إعلان'} subtitle="معاينة اختيارية قبل النشر">
          <form className="dev-form" onSubmit={submit}>
            <label>
              <span>عنوان الإعلان</span>
              <input
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                maxLength={120}
                required
              />
            </label>
            <label>
              <span>وصف الإعلان</span>
              <textarea
                rows={4}
                value={form.body}
                onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                maxLength={1500}
                required
              />
            </label>
            <div className="dev-form-grid">
              <label>
                <span>الجمهور</span>
                <select value={form.audience} onChange={(event) => setForm((current) => ({ ...current, audience: event.target.value }))}>
                  <option value="all">الجميع</option>
                  <option value="active">نشطون آخر 7 أيام</option>
                  <option value="new">مستخدمون جدد</option>
                </select>
              </label>
              <label>
                <span>نشط</span>
                <div className="dev-switch-wrap">
                  <Toggle checked={form.isActive} onChange={(value) => setForm((current) => ({ ...current, isActive: value }))} label="حالة الإعلان" />
                  <small>{form.isActive ? 'سيظهر عند تحقق الشروط' : 'محفوظ وموقوف'}</small>
                </div>
              </label>
            </div>
            <div className="dev-form-grid">
              <label>
                <span>بداية العرض</span>
                <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} />
              </label>
              <label>
                <span>نهاية العرض</span>
                <input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} />
              </label>
            </div>
            <label>
              <span>صورة اختيارية <small>PNG / JPG / WebP · حتى 3MB</small></span>
              <div className="dev-upload-row">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <span className="dev-upload-icon">{uploading ? <Upload size={17} /> : <ImagePlus size={17} />}</span>
              </div>
            </label>
            {form.imagePath && (
              <button type="button" className="dev-link-btn" onClick={() => { setForm((current) => ({ ...current, imagePath: null })); setLocalPreview(null); }}>
                إزالة الصورة
              </button>
            )}
            <div className="dev-form-actions">
              {editing && <button type="button" className="dev-btn dev-btn-ghost" onClick={reset}>إلغاء التعديل</button>}
              <button type="submit" className="dev-btn dev-btn-primary" disabled={busy || uploading}>
                <Megaphone size={15} /> {busy ? 'جار الحفظ…' : editing ? 'حفظ التعديلات' : 'نشر الإعلان'}
              </button>
            </div>
          </form>
        </Panel>

        <Panel title="معاينة الإعلان" subtitle="هكذا سيظهر داخل نيرد">
          {previewImage ? (
            <div className="dev-ad-preview">
              <img src={previewImage} alt="" />
              <div>
                <strong>{form.title || 'عنوان الإعلان'}</strong>
                <p>{form.body || 'سيظهر وصف الإعلان هنا.'}</p>
              </div>
            </div>
          ) : (
            <div className="dev-ad-preview is-empty">
              <Eye size={22} />
              <span>أضف عنوانًا أو صورة لرؤية المعاينة.</span>
            </div>
          )}
          <p className="dev-muted-note">
            الصورة تُحفظ باسم عشوائي داخل تخزين الخادم، ولا تُعرض إلا للمستخدمين المسجلين.
          </p>
        </Panel>
      </div>

      <Panel title="الإعلانات المحفوظة" subtitle="تفعيل أو إيقاف أو تعديل أو حذف">
        {!ads ? (
          <LoadingBlock />
        ) : ads.length === 0 ? (
          <EmptyBlock title="لا إعلانات" body="أنشئ أول إعلان داخلي من النموذج." icon={<Megaphone size={22} />} />
        ) : (
          <div className="dev-ad-grid">
            {ads.map((ad) => (
              <article key={ad.id} className={`dev-ad-card ${ad.isActive ? '' : 'is-off'}`}>
                {ad.imageUrl ? <img src={ad.imageUrl} alt="" /> : <div className="dev-ad-no-image"><Megaphone size={20} /></div>}
                <div className="dev-ad-card-body">
                  <div className="dev-ad-card-head">
                    <strong>{ad.title}</strong>
                    <StatusBadge tone={ad.isActive ? 'ok' : 'muted'} dot>{ad.isActive ? 'نشط' : 'موقوف'}</StatusBadge>
                  </div>
                  <p>{ad.body}</p>
                  <small>
                    {audienceLabels[ad.audience] ?? ad.audience}
                    {ad.startsAt ? ` · من ${formatDateTime(ad.startsAt)}` : ''}
                    {ad.endsAt ? ` · إلى ${formatDateTime(ad.endsAt)}` : ''}
                  </small>
                  <div className="dev-row-actions">
                    <Toggle checked={ad.isActive} onChange={() => void toggle(ad)} label={`تفعيل ${ad.title}`} />
                    <button type="button" className="dev-btn dev-btn-tiny" onClick={() => edit(ad)}><Pencil size={13} /> تعديل</button>
                    <button type="button" className="dev-btn dev-btn-tiny dev-btn-danger" onClick={() => void remove(ad)}><Trash2 size={13} /> حذف</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
