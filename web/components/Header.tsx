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
  return (
    <header className="masthead">
      <div className="mast-top">
        <Link className="brand" href="/" aria-label="9/11 Records home">
          <img src="/lockup-horizontal.svg" alt="9/11 Records — 911records.org" className="brand-logo" />
        </Link>
        {/* issue #32 item 4: at narrow phone widths .mast-top is a flex row with no wrap, and a
            flex item's default min-width:auto keeps it from shrinking past its widest unbreakable
            word ("Department") — a few px past the viewport even though the line is already
            wrapping. min-width:0 lets it shrink the rest of the way; overflowWrap lets that one
            long word itself break rather than push past the edge. Verified at a 250px viewport
            (this repo's narrowest reachable test width) where it reproduced the same ~3px
            overflow the issue describes; the fix removes it there and is a no-op at 360px+. */}
        <div className="edition" style={{ minWidth: 0, overflowWrap: 'break-word' }}>
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
      </nav>
    </header>
  );
}
