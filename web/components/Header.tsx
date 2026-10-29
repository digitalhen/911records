'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import styles from './Header.module.css';
import Link from 'next/link';
import { APP_VERSION } from '@/lib/releases';
import { CaseCountBadge } from '@/components/case/CaseCountBadge';

const NAV = [
  { href: '/ask', label: 'Ask & search' },
  { href: '/map', label: 'Building map' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/topics', label: 'Topic map' },
  { href: '/entities', label: 'Entities' },
  { href: '/contradictions', label: 'Contradictions' },
  { href: '/first-responders', label: 'First responders' },
  { href: '/browse', label: 'Browse records' },
  { href: '/case', label: 'Case folder' },
  { href: '/changes', label: 'Releases & changes' },
];

export function Header({ active, edition }: { active?: string; edition?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const navigationId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  const releaseInfo = <div className="edition">
    <strong>{edition || 'NYC Law Department release'}</strong><br />
    <span className="edition-detail">Independent mirror · updated as the City releases more · <Link href="/releases" title="Version history">v{APP_VERSION}</Link></span><br />
    <a className="bmac" href="https://buymeacoffee.com/digitalhen" target="_blank" rel="noopener">☕ Buy me a coffee</a>
  </div>;
  return (
    <header className={`masthead ${styles.header}`} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }}>
      <div className={`mast-top ${styles.top}`}>
        <Link className="brand" href="/" aria-label="9/11 Records home">
          <img src="/lockup-horizontal.svg" alt="9/11 Records — 911records.org" className="brand-logo" />
        </Link>
        <div className={styles.desktopEdition}>{releaseInfo}</div>
        <button className={styles.toggle} type="button" ref={toggleRef}
          aria-expanded={open} aria-controls={navigationId}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setOpen(!open)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d={open ? 'M5 5l10 10M5 15L15 5' : 'M3 5h14M3 10h14M3 15h14'} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span>{open ? 'Close' : 'Menu'}</span>
        </button>
      </div>
      <nav id={navigationId} className={`nav ${styles.navigation}`} data-open={open} aria-label="Main navigation" onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) setOpen(false);
      }}>
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} className={active === item.href ? 'active' : ''}>
            {item.label}
            {item.href === '/case' && <CaseCountBadge />}
          </Link>
        ))}
        <div className={styles.mobileEdition}>{releaseInfo}</div>
      </nav>
    </header>
  );
}
