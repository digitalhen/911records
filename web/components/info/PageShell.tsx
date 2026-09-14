import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import styles from './info.module.css';
/**
 * `main` itself always renders at the shared page container width (see
 * globals.css `main{}` / web/DESIGN.md "Page container") so every route's
 * outer content box matches. `prose` (about/privacy/personal-information)
 * wraps children in a readable-line-length column *inside* that container
 * instead of narrowing the container itself — the old behavior applied
 * `.prose`'s max-width directly to `<main>`, quietly shrinking those pages'
 * outer box to 760px while every other route sat at 1440px.
 */
export function PageShell({ children, active, prose = false }: { children: React.ReactNode; active?: string; prose?: boolean }) {
  return (
    <>
      <Header active={active} />
      <main id="main" className={styles.page}>
        {prose ? <div className={styles.prose}>{children}</div> : children}
      </main>
      <Footer />
    </>
  );
}
