'use client';
import Script from 'next/script';
import { useEffect, useRef } from 'react';
export function AdUnit() {
  const unit = useRef<HTMLModElement>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ADS === 'off' || !unit.current || unit.current.dataset.adRequested) return;
    unit.current.dataset.adRequested = 'true';
    try {
      const ads = window as Window & { adsbygoogle?: object[] };
      (ads.adsbygoogle = ads.adsbygoogle || []).push({});
    } catch { /* Ad blockers must not interrupt reading. */ }
  }, []);
  if (process.env.NEXT_PUBLIC_ADS === 'off') return null;
  return <aside aria-label="Advertisement" style={{ borderTop: '1px solid var(--line)', marginTop: 36, paddingTop: 14, minHeight: 120 }}><div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Advertisement</div><ins ref={unit} className="adsbygoogle" style={{ display: 'block' }} data-ad-client="ca-pub-9961054735948902" data-ad-slot="4391479569" data-ad-format="auto" data-full-width-responsive="true" /><Script id="b2-adsense" async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9961054735948902" crossOrigin="anonymous" strategy="afterInteractive" /></aside>;
}
export default AdUnit;
