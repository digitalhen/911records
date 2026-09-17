'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

type Turnstile = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

export function Verification({ siteKey, file, testMode }: { siteKey: string; file: string; testMode: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState('');
  const render = useCallback(() => {
    if (!container.current || !window.turnstile || widget.current !== null) return;
    widget.current = window.turnstile.render(container.current, {
      sitekey: siteKey, action: 'bulk_download', theme: 'auto', size: 'flexible',
      callback: (value: string) => { setToken(value); setError(''); },
      'expired-callback': () => { setToken(''); setError('Verification expired. Please complete the check again.'); },
      'error-callback': () => { setToken(''); setError('The verification could not load. Please try again.'); },
      'timeout-callback': () => { setToken(''); setError('Verification timed out. Please try again.'); },
    });
  }, [siteKey]);
  useEffect(() => {
    render();
    return () => {
      if (widget.current !== null) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [render]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/downloads/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, file }), signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json() as { download?: string; error?: string };
      if (!response.ok || !body.download) throw new Error(body.error || 'Verification failed. Please try again.');
      setDownload(body.download);
      window.location.assign(body.download);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verification failed. Please try again.');
      setToken('');
      if (widget.current !== null) window.turnstile?.reset(widget.current);
    } finally { setBusy(false); }
  }

  return (
    <>
      {testMode && <p><strong>Local preview:</strong> this is Cloudflare’s test CAPTCHA. Production uses a real challenge.</p>}
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={render}
        onError={() => setError('The verification could not load. Check your connection or content blocker, then reload this page.')} />
      <form onSubmit={submit}>
        <div ref={container} style={{ maxWidth: 400, minHeight: 70, margin: '1.5rem 0' }} />
        <button type="submit" disabled={!token || busy || !!download} style={{ padding: '.7rem 1rem' }}>
          {busy ? 'Verifying…' : 'Continue to download'}
        </button>
        {error && <p role="alert">{error}</p>}
        {download && <p role="status">Verified. Your download is starting. <a href={download}>Download again</a>.</p>}
      </form>
      <noscript>JavaScript is required to complete download verification. Enable it and reload this page.</noscript>
    </>
  );
}
