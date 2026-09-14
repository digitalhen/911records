import Link from 'next/link';
import { APP_VERSION } from '@/lib/releases';
import { CaseCountBadge } from '@/components/case/CaseCountBadge';
import { AccountChip } from '@/components/auth/AccountChip';

const NAV = [
  { href: '/ask', label: 'Ask & search' },
  { href: '/map', label: 'Building map' },
  { href: '/topics', label: 'Topic map' },
  { href: '/entities', label: 'Entities' },
  { href: '/browse', label: 'Browse records' },
  { href: '/case', label: 'Case folder' },
  { href: '/changes', label: 'Releases & changes' },
];

export function Header({ active, edition }: { active?: string; edition?: string }) {
  return (
    <header className="masthead">
      <div className="mast-top">
        <Link className="brand" href="/" aria-label="9/11 Records home">
          <img src="/lockup-horizontal.svg" alt="9/11 Records — 911records.nyc" className="brand-logo" />
        </Link>
        <div className="edition">
          <strong>{edition || 'NYC Law Department release'}</strong>
          <br />
          <span className="edition-detail">Independent mirror · updated as the City releases more · <Link href="/releases" title="Version history">v{APP_VERSION}</Link></span>
        </div>
      </div>
      <nav className="nav" aria-label="Main navigation">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} className={active === item.href ? 'active' : ''}>
            {item.label}
            {item.href === '/case' && <CaseCountBadge />}
          </Link>
        ))}
        <AccountChip />
      </nav>
    </header>
  );
}
