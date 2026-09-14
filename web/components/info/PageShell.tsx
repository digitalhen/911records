import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import styles from './info.module.css';
export function PageShell({ children, active, prose = false }: { children: React.ReactNode; active?: string; prose?: boolean }) {
  return <><Header active={active} /><main id="main" className={`${styles.page} ${prose ? styles.prose : ''}`}>{children}</main><Footer /></>;
}
