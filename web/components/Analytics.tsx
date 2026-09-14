'use client';

import Script from 'next/script';
import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { GA_ID } from '@/lib/analytics';

/**
 * Loads gtag.js once and reports page views manually on every route change —
 * `send_page_view: false` in the config, because an App Router navigation
 * doesn't reload the document and the automatic view would only count the
 * first page of a session.
 *
 * An empty GA_ID means this component renders NOTHING (see lib/analytics.ts):
 * no scripts, and no PageViews either — gating only the two <Script> tags
 * would leave PageViews mounted, installing the window.gtag stub and pushing
 * a command onto window.dataLayer on every route change for the life of the
 * session, with no tag ever loading to drain the queue.
 */

function PageViews() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    const qs = search?.toString();
    window.gtag?.('event', 'page_view', {
      page_path: qs ? `${pathname}?${qs}` : pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, search]);
  return null;
}

export default function Analytics() {
  if (!GA_ID) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}', { send_page_view: false });`}
      </Script>
      {/* useSearchParams needs a Suspense boundary in the root layout. */}
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
    </>
  );
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}
