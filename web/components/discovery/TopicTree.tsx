import Link from 'next/link';
import { type Topic, terms, distribution, topicTitle, topicSource } from '@/lib/discovery/data';
import { Extraction } from './Shared';
import styles from './discovery.module.css';
export function TopicTree({ topics, parent = null, seen = [] }: {topics:Topic[];parent?:number|null;seen?:number[]}) {
  const children=topics.filter(t=>parent===null ? t.parent===null || !topics.some(p=>p.id===t.parent) : t.parent===parent).filter(t=>!seen.includes(t.id));
  const max=Math.max(1,...children.map(t=>t.size_pages));
  return <ul className={styles.topicList}>{children.map(t=><li key={t.id}><div className={styles.topicItem}><Link href={`/topics/${t.id}`}><strong>{topicTitle(t)}</strong> · {t.size_pages} pages · {t.size_docs} documents</Link><span className={styles.bar} style={{width:`${Math.max(1,100*t.size_pages/max)}%`}}/>{t.title&&t.description&&<p className="small">{t.description}</p>}<p className="small muted">{terms(t.terms).join(' · ')}</p><Extraction source={topicSource(t)} confidence={t.name_confidence}/></div>{seen.length<20&&<TopicTree topics={topics} parent={t.id} seen={[...seen,t.id]}/>}</li>)}</ul>;
}
export function TopicSpread({topic}:{topic:Topic}) { return <>{(['boxes','agencies'] as const).map(key=><section key={key}><h3>Spread across {key}</h3>{distribution(topic[key]).length ? <ul>{distribution(topic[key]).map(([label,count])=><li key={label}>{key==='boxes'?'Box ':''}{label} · <Link href="#records">{count} documents</Link><Extraction source={topicSource(topic)} confidence={null}/></li>)}</ul>:<p className="small muted">No distribution indexed.</p>}</section>)}</>; }
