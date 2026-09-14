import Link from 'next/link';

export function Footer() {
  return (
    <footer>
      <span>An independent project by Cleartext Labs. Not affiliated with the City of New York.</span>
      <span>
        <Link href="/about">About</Link> · <Link href="/privacy">Privacy</Link> ·{' '}
        <Link href="/personal-information">Personal-information policy</Link>
      </span>
    </footer>
  );
}
