'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AiMark } from '@/components/ui';

export function AskVerification({ input, siteKey, testMode, question, header, footer }: {
  input: Record<string, string | undefined>;
  siteKey?: string; testMode: boolean; question: string; header: ReactNode; footer: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const render = useCallback(() => {
    if (!siteKey || !container.current || !window.turnstile || widget.current !== null) return;
    widget.current = window.turnstile.render(container.current, {
      sitekey: siteKey, action: 'ask_ai', theme: 'auto', size: 'flexible',
      'response-field': false,
      callback: (value: string) => { setToken(value); setError(''); },
      'expired-callback': () => { setToken(''); setError('Verification expired. Please complete a new check.'); },
      'error-callback': () => { setToken(''); setError('Verification could not load. Please reload this page.'); },
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
    if (!token || pending) return;
    setPending(true); setError('');
    try {
      const response = await fetch('/api/ask/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...input }), signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json() as { location?: string; error?: string };
      if (!response.ok || !body.location) throw new Error(body.error || 'Verification failed. Please try again.');
      window.location.assign(body.location);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verification failed. Please try again.');
      setToken(''); setPending(false);
      if (widget.current !== null) window.turnstile?.reset(widget.current);
    }
  }

  return <>
    {header}
    <main id="main">
      <h1>Before we ask the records</h1>
      <p>{question}</p>
      <p>Complete this check to request an AI answer. It helps keep this free service available.</p>
      {siteKey ? <>
        {testMode && <p><strong>Local preview:</strong> test verification is enabled.</p>}
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={render}
          onError={() => setError('Verification could not load. Check your connection or content blocker, then reload.')} />
        <form onSubmit={submit}>
          <div ref={container} style={{ maxWidth: 400, minHeight: 70, margin: '1.5rem 0' }} />
          <input type="hidden" name="cf-turnstile-response" value={token} />
          <button type="submit" disabled={!token || pending} style={{ padding: '.7rem 1rem' }}>
            <AiMark /> {pending ? 'Checking the records…' : 'Get AI answer'}
          </button>
          {error && <p role="alert">{error}</p>}
          {pending && <p role="status">This can take a moment. Please keep this page open.</p>}
        </form>
        <noscript>JavaScript is required for AI verification. You can still search the records.</noscript>
      </> : <p role="alert">AI verification is temporarily unavailable.</p>}
      <p><a href={`/search?q=${encodeURIComponent(question)}`}>Search the records without AI</a></p>
    </main>
    {footer}
  </>;
}
