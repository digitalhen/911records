import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { getMapPlaces, getSubstances, getSuggestions } from '@/lib/map/data';
import MapExplorer from './MapExplorer';
import styles from './map.module.css';
export function mapMetadata(): Metadata {
  return {title:'Building map',description:"Explore lower Manhattan buildings in New York City's released 9/11 records. Find test candidates, inspection pages and source documents.",alternates:{canonical:'/'}};
}
export default async function HomeMap() {
  const results = await Promise.allSettled([getMapPlaces(),getSubstances(),getSuggestions()]);
  const [places,substances,suggestions]=results;
  return <div className={styles.shell}><Header active="/map"/><MapExplorer initialPlaces={places.status==='fulfilled'?places.value:[]}
    substances={substances.status==='fulfilled'?substances.value:[]}
    suggestions={suggestions.status==='fulfilled'?suggestions.value:{place:null,substance:null,substanceSource:null}}
    unavailable={results.some(r=>r.status==='rejected')}
    homePanel={<div id="home-panel"><div className="eyebrow">Public records / September 11, 2001</div><h2>Lower Manhattan, on the record.</h2><p>Explore buildings to find environmental sampling, inspections and other pages across the City’s released records.</p><p>Select a building, then read the source. A sample is not a health or occupancy determination.</p><a href="/browse">Browse the collection →</a></div>}/></div>;
}
