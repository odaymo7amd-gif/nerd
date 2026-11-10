import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api.ts';

interface ActiveAd {
  id: number;
  title: string;
  body: string;
  imageUrl: string | null;
}

export function AdBanner() {
  const [ad, setAd] = useState<ActiveAd | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ ad: ActiveAd | null }>('/ads/active')
      .then((payload) => {
        if (cancelled || !payload.ad) return;
        try {
          if (window.sessionStorage.getItem(`nerd-ad-dismissed-${payload.ad.id}`) === '1') return;
        } catch {
          // التخزين قد يكون معطلًا؛ نعرض الإعلان happy path.
        }
        setAd(payload.ad);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ad) return null;

  function dismiss() {
    if (!ad) return;
    try {
      window.sessionStorage.setItem(`nerd-ad-dismissed-${ad.id}`, '1');
    } catch {
      // لا شيء.
    }
    setAd(null);
  }

  return (
    <aside className={`ad-banner ${ad.imageUrl ? 'has-image' : ''}`} aria-label="إعلان داخلي">
      {ad.imageUrl && <img src={ad.imageUrl} alt="" className="ad-banner-image" />}
      <div className="ad-banner-copy">
        <span className="ad-banner-eyebrow"><Sparkles size={11} /> من نيرد</span>
        <strong>{ad.title}</strong>
        <p>{ad.body}</p>
      </div>
      <button type="button" className="ad-banner-dismiss" onClick={dismiss} aria-label="إخفاء الإعلان">
        <X size={15} />
      </button>
      <span className="ad-banner-arrow" aria-hidden="true"><ArrowLeft size={17} /></span>
    </aside>
  );
}
