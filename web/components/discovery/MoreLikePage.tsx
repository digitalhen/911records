import Link from 'next/link';
import { moreLikeThis } from '@/lib/discovery/moreLikeThis';
import { pageHref } from '@/lib/discovery/data';
import { Extraction } from './Shared';
export async function MoreLikePage({doc,page}:{doc:string;page:number}) {
 const {hits,unavailable}=await moreLikeThis(doc,page);
 return <section className="discovery"><h2>More like this page</h2><p className="small muted">Similar subjects in other documents. Similarity does not establish the same event, measurement or conclusion.</p>{unavailable?<p>Page similarity is temporarily unavailable or this page has no indexed vector.</p>:!hits.length?<p>No similar available pages found.</p>:hits.map(h=><article className="result-item" key={`${h.doc}:${h.page}`}><Link href={pageHref(h.doc,h.page)}>{h.doc} · page {h.page}</Link><p className="small muted">Similarity score {h.score.toFixed(3)} (not a probability)</p><Extraction source={h} confidence={null}/></article>)}</section>;
}
export default MoreLikePage;
