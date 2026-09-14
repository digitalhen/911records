import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSignatory, getOccurrences, formatDate, entityHref } from '@/lib/discovery/data';
import { Shell, Extraction, Caveat, Records, metadata } from '@/components/discovery/Shared';
export const dynamic='force-dynamic';
type Params=Promise<{slug:string}>;
export async function generateMetadata({params}:{params:Params}) { const {slug}=await params; return metadata('Official role on records','Official capacity, actions and links to the source signature pages.',entityHref('signatory',slug)); }
export default async function Signatory({params}:{params:Params}) {
  const {slug}=await params;const row=await getSignatory(slug);if(!row)notFound();const pages=await getOccurrences(row.id,true);if(!pages.length)notFound();
  return <Shell title={row.name} eyebrow="Role → action → record"><Link href="/entities">← Signatories by role</Link><p>{row.title || 'Official signatory'} · {row.org || 'Organization not recorded'}</p><Extraction source={pages[0]}/><p>{formatDate(row.first_date) || 'Date unavailable'} – {formatDate(row.last_date) || 'date unavailable'}</p><Extraction source={pages[0]} confidence={null}/><p className="quality">This person appears because of their official role on the records linked below. Appearance implies nothing about anyone. Actions describe the signature or routing block on a record.</p><p><a href="#records">{new Set(pages.map(p=>p.doc)).size} documents · {new Set(pages.map(p=>`${p.doc}:${p.page}`)).size} signature pages</a></p><Extraction source={pages[0]} confidence={null}/><Caveat/><Records rows={pages} heading="Actions on the record"/></Shell>;
}
