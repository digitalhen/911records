import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTopics, topicDocuments, terms, pageHref } from '@/lib/discovery/data';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { Shell, Caveat, Extraction, metadata } from '@/components/discovery/Shared';
import { TopicTree, TopicSpread } from '@/components/discovery/TopicTree';
import styles from '@/components/discovery/discovery.module.css';
export const dynamic='force-dynamic';
type Params=Promise<{id:string}>;
function topicId(id:string){return /^-?\d+$/.test(id)&&Number.isSafeInteger(Number(id))?Number(id):null;}
export async function generateMetadata({params}:{params:Params}){const {id}=await params;const topic=(await getTopics()).find(t=>t.id===topicId(id));return metadata(topic?.label||'Topic records','Machine-extracted subject assignments with source records, boxes and agencies.',`/topics/${encodeURIComponent(id)}`);}
export default async function TopicPage({params,searchParams}:{params:Params;searchParams:Promise<SearchParamsInput>}){
 const {id}=await params;const topics=await getTopics();const topic=topics.find(t=>t.id===topicId(id));if(!topic)notFound();
 const requested=Number(getStr(await searchParams,'page'));const page=Number.isSafeInteger(requested)&&requested>0?Math.min(requested,100000):1;
 const docs=await topicDocuments(topic.id,(page-1)*50);
 return <Shell title={topic.label||'Unlabelled subject'} eyebrow="Collection → topic" active="/topics"><Link href="/topics">← Whole collection</Link>{topic.parent!=null&&topics.some(t=>t.id===topic.parent)&&<> · <Link href={`/topics/${topic.parent}`}>Parent topic</Link></>}<p><a href="#records">{topic.size_pages} indexed pages · {topic.size_docs} indexed documents</a></p><Extraction source={topic} confidence={null}/><p>{terms(topic.terms).join(' · ')}</p><Extraction source={topic} confidence={null}/><Caveat/>
 <div className={styles.grid}><section><h2>Sub-topics</h2>{topics.some(t=>t.parent===topic.id&&t.id!==topic.id)?<TopicTree topics={topics} parent={topic.id} seen={[topic.id]}/>:<p>No sub-topics indexed.</p>}<section id="records"><h2>Documents in this topic</h2><p className="small muted">Ordered by assignment probability. A document-level assignment does not establish that every page is about this subject.</p>{docs.map(d=><article className="result-item" key={d.doc}><Link className="mono" href={pageHref(d.doc,d.page)}>{d.doc}</Link><p className="small muted">{d.agency} · Box {d.box||'unavailable'} · assignment probability {d.prob==null?'unavailable':Number(d.prob).toFixed(3)}</p><Extraction source={d} confidence={d.prob}/></article>)}{!docs.length&&<p>No available documents on this results page.</p>}<div className="actions">{page>1&&<Link href={`/topics/${topic.id}?page=${page-1}#records`}>← Previous</Link>}{page*50<(docs[0]?.total||0)&&<Link href={`/topics/${topic.id}?page=${page+1}#records`}>Next →</Link>}</div></section></section><aside><TopicSpread topic={topic}/></aside></div></Shell>;
}
