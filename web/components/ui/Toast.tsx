'use client';

import { useRef, useState } from 'react';

/** useToast — shared toast-message logic (auto-dismiss after ~4.5s). */
export function useToast(timeoutMs = 4500) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), timeoutMs);
  };
  return { message, show };
}

/** Toast — fixed-position status message, styled by .toast. Empty message renders nothing. */
export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
