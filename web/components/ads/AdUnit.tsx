'use client';
import { ADSENSE_CLIENT, ADSENSE_SLOT } from '@/lib/brand';
import Script from 'next/script';
import { useEffect, useRef } from 'react';
export function AdUnit() {
  const unit = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (!ADSENSE_CLIENT || !unit.current || unit.current.dataset.adRequested) return;
    unit.current.dataset.adRequested = 'true';
    try {
      const ads = window as Window & { adsbygoogle?: object[] };
      (ads.adsbygoogle = ads.adsbygoogle || []).push({});
    } catch { /* Ad blockers must not interrupt reading. */ }
  }, []);
  if (!ADSENSE_CLIENT) return null;
  return (
    <aside aria-label="Advertisement" className="ad-unit">
      <div className="eyebrow">Advertisement</div>
      <ins
        ref={unit}
        className="adsbygoogle"
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <Script
        id="b2-adsense"
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
    </aside>
  );
}
export default AdUnit;
