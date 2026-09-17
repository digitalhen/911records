import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';
import { captchaConfig, downloadName } from '@/lib/downloads/captcha';
import { Verification } from './verification';

export const dynamic = 'force-dynamic';
export function generateMetadata() {
  return { ...pageMetadata('Verify your download', 'Complete a quick verification before downloading the records.', '/downloads/verify'), robots: { index: false, follow: false } };
}
export default async function Verify({ searchParams }: { searchParams: Promise<{ file?: string }> }) {
  const { file } = await searchParams;
  if (!downloadName(file)) notFound();
  const config = captchaConfig();
  return (
    <PageShell prose>
      <h1>One quick check before downloading.</h1>
      <p>Complete the verification below to help keep bulk downloads available for everyone.</p>
      {config ? <Verification siteKey={config.siteKey} file={file} testMode={config.testMode} /> : (
        <p role="status">Download verification is temporarily unavailable. Please try again later.</p>
      )}
      <p>Once verified, you can download boxes and resume downloads in this browser for 12 hours.</p>
      <p><Link href="/downloads">Back to downloads</Link> · <Link href="/privacy">Privacy</Link></p>
    </PageShell>
  );
}
