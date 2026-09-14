import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { getMapPlaces, getSubstances, getSuggestions } from '@/lib/map/data';
import { HomePanel } from '@/components/home/HomePanel';
import { AdUnit } from '@/components/ads/AdUnit';
import MapExplorer from './MapExplorer';
import { socialMeta } from '@/lib/seo/social';
import styles from './map.module.css';
export function mapMetadata(): Metadata {
  const title='Building map';
  const description="Explore lower Manhattan buildings in New York City's released 9/11 records. Find test candidates, inspection pages and source documents.";
  return {title,description,alternates:{canonical:'/'},...socialMeta(title,description,'/')};
}
export default async function HomeMap() {
  const results = await Promise.allSettled([getMapPlaces(),getSubstances(),getSuggestions()]);
  const [places,substances,suggestions]=results;
  return <div className={styles.shell}><Header active="/map"/><MapExplorer initialPlaces={places.status==='fulfilled'?places.value:[]}
    substances={substances.status==='fulfilled'?substances.value:[]}
    suggestions={suggestions.status==='fulfilled'?suggestions.value:{place:null,substance:null,substanceSource:null}}
    unavailable={results.some(r=>r.status==='rejected')}
    homePanel={<><HomePanel /><AdUnit /></>}/></div>;
}
