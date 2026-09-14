import Link from 'next/link';

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
          <img src="/lockup-horizontal.svg" alt="9/11 Records — 911records.nyc" className="brand-logo" style={{ display: 'block' }} />
        </Link>
        <div className="edition">
          <strong>{edition || 'NYC Law Department release'}</strong>
          <br />
          <span className="edition-detail">Independent mirror · updated as the City releases more</span>
        </div>
      </div>
      <nav className="nav" aria-label="Main navigation">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} className={active === item.href ? 'active' : ''}>
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
