import Link from 'next/link';
import { suggestEntities, TYPE_LABELS, entityHref } from '@/lib/discovery/data';
import { searchHref, getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { Shell, Extraction, Caveat, metadata } from '@/components/discovery/Shared';
import EntitySearch from '@/components/discovery/EntitySearch';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic = 'force-dynamic';
export async function generateMetadata() { return metadata('Search by entity','Find labs, agencies, contractors, substances, addresses and official roles on City records.','/entities'); }
export default async function Entities({searchParams}:{searchParams:Promise<SearchParamsInput>}) {
  const q = (getStr(await searchParams,'q') || '').slice(0,120);
  const rows = await suggestEntities(q);
  const filters: Record<string,string> = {lab:'lab',substance:'contaminant',address:'address'};
  return <Shell title="Search by entity" eyebrow="Find a record through its role"><p>Labs, offices, contractors, addresses, substances and officials acting on records.</p><EntitySearch initialQuery={q}/><p className="quality">Officials are searchable by their action on a record. Private residents, complainants, patients, claimants and workers’ personal details are excluded. Appearance implies nothing about anyone.</p>
    <div className={styles.tokens}>{rows.filter(r=>filters[r.type]).slice(0,6).map(r=><Link key={r.id} href={searchHref({q:''},{[filters[r.type]!]:r.label})}>{r.type}: {r.label}</Link>)}</div><Caveat/>
    {!rows.length && <p className={styles.empty}>No matching entities are indexed yet. Try a lab, substance, address or official role.</p>}
    {Object.entries(TYPE_LABELS).map(([type,label])=><section key={type}><h2>{label}</h2><ul className={styles.cards}>{rows.filter(r=>r.type===type).map(r=><li key={r.id}><Link href={entityHref(r.type,r.slug)}>{r.label}</Link><p className="small muted">{r.role || r.type} · <Link href={`${entityHref(r.type,r.slug)}#records`}>{r.n_docs} documents · {r.n_pages} source pages</Link></p><Extraction source={r}/></li>)}</ul>{!rows.some(r=>r.type===type)&&<p className="small muted">No matching indexed records.</p>}</section>)}</Shell>;
}
