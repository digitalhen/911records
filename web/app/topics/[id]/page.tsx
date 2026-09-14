import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTopics, topicDocuments, terms, pageHref, topicTitle, topicSource } from '@/lib/discovery/data';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { Shell, Caveat, Extraction, metadata } from '@/components/discovery/Shared';
import { TopicTree, TopicSpread } from '@/components/discovery/TopicTree';
import { SpreadStrip } from '@/components/discovery/SpreadStrip';
import { rootAncestorId } from '@/lib/discovery/treemap';
import { ButtonLink } from '@/components/ui';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic='force-dynamic';
type Params=Promise<{id:string}>;
function topicId(id:string){return /^-?\d+$/.test(id)&&Number.isSafeInteger(Number(id))?Number(id):null;}
export async function generateMetadata({params}:{params:Params}){const {id}=await params;const topic=(await getTopics()).find(t=>t.id===topicId(id));return metadata(topic?topicTitle(topic):'Topic records',topic?.description||'Machine-extracted subject assignments with source records, boxes and agencies.',`/topics/${encodeURIComponent(id)}`);}
export default async function TopicPage({params,searchParams}:{params:Params;searchParams:Promise<SearchParamsInput>}){
 const {id}=await params;const topics=await getTopics();const topic=topics.find(t=>t.id===topicId(id));if(!topic)notFound();
 const requested=Number(getStr(await searchParams,'page'));const page=Number.isSafeInteger(requested)&&requested>0?Math.min(requested,100000):1;
 const docs=await topicDocuments(topic.id,(page-1)*50);
 const parentOf=new Map<number,number|null>();for(const t of topics)parentOf.set(t.id,topics.some(p=>p.id===t.parent)?t.parent:null);
 const roots=topics.filter(t=>parentOf.get(t.id)==null).sort((a,b)=>b.size_pages-a.size_pages||a.id-b.id);
 const rootColorIndex=Math.max(0,roots.findIndex(r=>r.id===rootAncestorId(topic.id,parentOf)));
 return <Shell title={topicTitle(topic)} eyebrow="Collection → topic" active="/topics"><Link href="/topics">← Whole collection</Link>{topic.parent!=null&&topics.some(t=>t.id===topic.parent)&&<> · <Link href={`/topics/${topic.parent}`}>Parent topic</Link></>}<p><a href="#records">{topic.size_pages} indexed pages · {topic.size_docs} indexed documents</a></p>{topic.title&&topic.description&&<p>{topic.description}</p>}<Extraction source={topicSource(topic)} confidence={topic.name_confidence}/><p>{terms(topic.terms).join(' · ')}</p><Caveat/>
 <div className={styles.grid}><section><h2>Sub-topics</h2>{topics.some(t=>t.parent===topic.id&&t.id!==topic.id)?<TopicTree topics={topics} parent={topic.id} seen={[topic.id]}/>:<p>No sub-topics indexed.</p>}<section id="records"><h2>Documents in this topic</h2><p className="small muted">Ordered by assignment probability. A document-level assignment does not establish that every page is about this subject.</p>{docs.map(d=><article className="result-item" key={d.doc}><Link className="mono" href={pageHref(d.doc,d.page)}>{d.doc}</Link><p className="small muted">{d.agency} · Box {d.box||'unavailable'} · assignment probability {d.prob==null?'unavailable':Number(d.prob).toFixed(3)}</p><Extraction source={d} confidence={d.prob}/></article>)}{!docs.length&&<p>No available documents on this results page.</p>}<div className="actions">{page>1&&<ButtonLink variant="secondary" size="small" href={`/topics/${topic.id}?page=${page-1}#records`}>← Previous</ButtonLink>}{page*50<(docs[0]?.total||0)&&<ButtonLink variant="secondary" size="small" href={`/topics/${topic.id}?page=${page+1}#records`}>Next →</ButtonLink>}</div></section></section><aside><p className="small muted">Spread</p><SpreadStrip topic={topic} field="boxes" rootColorIndex={rootColorIndex}/><SpreadStrip topic={topic} field="agencies" rootColorIndex={rootColorIndex}/><TopicSpread topic={topic}/></aside></div></Shell>;
}
