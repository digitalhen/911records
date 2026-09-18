import Link from 'next/link';
import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';
import { Questions } from '@/components/first-responders/Questions';
import styles from '@/components/first-responders/responders.module.css';

export function generateMetadata() {
  return pageMetadata('For first responders', 'Research questions for FDNY, NYPD, PAPD, EMS, and other 9/11 responders: unit deployments, shifts, work sites, protective equipment, and recovery operations.', '/first-responders');
}

export default function FirstRespondersPage() {
  return <PageShell active="/first-responders">
    <div className={styles.intro}>
      <div className="eyebrow">A starting point for your research</div>
      <h1>For first responders</h1>
      <p className="subtitle">Where was your unit? What were conditions like? What instructions were given?</p>
      <p>For FDNY, NYPD, Port Authority Police (PAPD), EMS, and other rescue, recovery, and support personnel, as well as their families. Use the City’s released 9/11 records to investigate a date, assignment, or place you remember.</p>
      <p className="muted">This is a released document collection, not a complete personnel or deployment database. An unanswered question or a missing record does not establish that a unit was absent.</p>
    </div>
    <Questions />
    <section className={styles.guide}>
      <h2>Build a record of your search</h2>
      <ol>
        <li><strong>Be specific.</strong> Try a unit or command designation, alternate spellings, a work site, and a date range. A document’s date may differ from the date of the activity it describes.</li>
        <li><strong>Check the original page.</strong> Machine-written answers and scanned text can be wrong. Follow citations and check dates, unit numbers, and locations against the scan and official PDF.</li>
        <li><strong>Keep the context.</strong> Save useful records to your <Link href="/case">case folder</Link> and retain the Bates page number and source link. A nearby air sample alone does not establish an individual’s exposure.</li>
      </ol>
      <p>Prefer to look directly? <Link href="/search">Search the records</Link>, <Link href="/browse">browse the collections</Link>, or explore the <Link href="/map">building map</Link>.</p>
    </section>
  </PageShell>;
}
