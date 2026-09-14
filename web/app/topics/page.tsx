import { getTopics } from '@/lib/discovery/data';
import { Shell, Caveat, metadata } from '@/components/discovery/Shared';
import { TopicTree } from '@/components/discovery/TopicTree';
export const dynamic='force-dynamic';
export async function generateMetadata(){return metadata('Topic map','Explore subjects, sub-topics and the records filed across boxes and agencies.','/topics');}
export default async function Topics(){const topics=await getTopics();return <Shell title="Find what is filed elsewhere." eyebrow="Discovery / map of subjects" active="/topics"><p>Page and document embeddings group records by subject. Bar lengths represent indexed pages within each level. Select a topic, then a sub-topic, then its records. No people are mapped.</p><Caveat/>{topics.length?<TopicTree topics={topics}/>:<p>No topics with available source records are indexed yet.</p>}</Shell>;}
