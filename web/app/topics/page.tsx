import Link from 'next/link';
import { getTopics, topicTitle, type Topic } from '@/lib/discovery/data';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { Shell, Caveat, metadata } from '@/components/discovery/Shared';
import { TopicMap } from '@/components/discovery/TopicMap';
import styles from '@/components/discovery/topicmap.module.css';

export const dynamic = 'force-dynamic';

function topicId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** A topic is a root of the tree if it has no parent, or its parent id doesn't resolve to an
 * indexed topic (orphaned rows read as roots rather than vanishing). */
function isRoot(t: Topic, topics: Topic[]): boolean {
  return t.parent == null || !topics.some((p) => p.id === t.parent);
}

export async function generateMetadata() {
  return metadata(
    'Topic map',
    'The collection laid out by subject: regions sized by pages, zoomable from topic to sub-topic to documents. A map of subjects, never of people.',
    '/topics',
  );
}

export default async function TopicsPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const topics = await getTopics();
  const requestedId = topicId(getStr(await searchParams, 'topic'));
  const current = requestedId != null ? topics.find((t) => t.id === requestedId) ?? null : null;

  // Ancestor chain for the breadcrumb — walk parent pointers up to a root, guarding cycles.
  const ancestors: Topic[] = [];
  if (current) {
    let node: Topic | undefined = current;
    const seen = new Set<number>();
    while (node && !seen.has(node.id)) {
      ancestors.unshift(node);
      seen.add(node.id);
      node = node.parent == null ? undefined : topics.find((t) => t.id === node!.parent);
    }
  }

  const nodes = current
    ? topics.filter((t) => t.id !== current.id && t.parent === current.id)
    : topics.filter((t) => isRoot(t, topics));

  return (
    <Shell title="Topic map" eyebrow="Discovery / map of subjects" active="/topics">
      <p className="subtitle">
        Page and document embeddings group records by subject. Region area represents pages; boxes and dates trace how a
        topic spreads across the collection. This is a map of subjects, never of people.
      </p>
      <p className="coverage">
        Machine-clustered topics and assignments, not a definitive index. Select a topic to zoom into its sub-topics, then
        a sub-topic to see its documents.
      </p>
      <p className={styles.crumbs}>
        <Link href="/topics">← Whole collection</Link>
        {ancestors.map((a) => (
          <span key={a.id}> · <Link href={`/topics?topic=${a.id}`}>{topicTitle(a)}</Link></span>
        ))}
      </p>
      {current && (
        <p>
          <Link href={`/topics/${current.id}`}>{current.size_pages} pages · {current.size_docs} documents — open this topic's documents →</Link>
        </p>
      )}
      <TopicMap topics={topics} nodes={nodes} label={current ? `Sub-topics of ${topicTitle(current)}` : 'Top-level topics'} />
      <Caveat />
    </Shell>
  );
}
