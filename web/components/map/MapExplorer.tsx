'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { COLORS, DEFAULT_FILTERS, buildingUrl, decodeBldgClass, month, pageUrl, type MapFilters, type Place, type PlaceFile } from '@/lib/map/types';
import MapCanvas from './MapCanvas';
import RecordTable from './RecordTable';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from './map.module.css';
export default function MapExplorer({ initialPlaces, substances, suggestions, homePanel, unavailable }: {
  initialPlaces: Place[]; substances: string[]; suggestions: { place: Place | null; substance: string | null; substanceSource: {doc:string;page:number} | null }; homePanel: ReactNode; unavailable: boolean;
}) {
  const [places,setPlaces]=useState(initialPlaces),[filters,setFilters]=useState<MapFilters>(DEFAULT_FILTERS);
  const [selected,setSelected]=useState<string|null>(null),[file,setFile]=useState<PlaceFile|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[mapBusy,setMapBusy]=useState(false),[mapError,setMapError]=useState(unavailable);
  const [threeD,setThreeD]=useState(true),[fallback,setFallback]=useState(false),[expanded,setExpanded]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{const read=()=>setSelected(new URLSearchParams(location.search).get('place'));read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read)},[]);
  function select(id:string|null) {setSelected(id);setExpanded(!!id);const url=new URL(location.href);if(id)url.searchParams.set('place',id);else url.searchParams.delete('place');window.history.pushState({},'',url)}
  useEffect(()=>{
    if(!selected){setFile(null);return}
    const abort=new AbortController();setBusy(true);setFile(null);setError('');
    fetch(`/api/place/${encodeURIComponent(selected)}`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error(r.status===404?'No available records for this building.':'Building records could not be loaded.');return r.json()}).then(setFile).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setBusy(false)});
    return()=>abort.abort();
  },[selected,revision]);
  useEffect(()=>{
    if(filters===DEFAULT_FILTERS && !revision)return;
    const abort=new AbortController();setMapBusy(true);setMapError(false);
    const timer=setTimeout(()=>{
      const q=new URLSearchParams({substance:filters.substance,from:String(filters.from),to:String(filters.to),type:filters.type,only:String(filters.only)});
      fetch(`/api/map?${q}`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(r=>setPlaces(r.places)).catch(()=>{if(!abort.signal.aborted){setPlaces([]);setMapError(true)}}).finally(()=>{if(!abort.signal.aborted)setMapBusy(false)});
    },180);
    return()=>{clearTimeout(timer);abort.abort()};
  },[filters,revision]);
  function change<K extends keyof MapFilters>(key:K,value:MapFilters[K]) {setFilters(f=>({...f,[key]:value}))}
  // Only a real street address makes a sensible question; fallback labels ("BIN …", "Block …",
  // "Building address in the source record") produced nonsense starter questions.
  const placeLabel=suggestions.place && /^\d/.test(suggestions.place.label)?suggestions.place.label:null;
  const question=placeLabel?`What was measured at ${placeLabel} in October 2001?`:null;
  const relatedQuestion=suggestions.substance?`Which buildings have ${suggestions.substance} test records?`:null;
  return <main id="main" className={styles.explorer}>
    <MapCanvas places={mapBusy?[]:places} threeD={threeD} onSelect={select} onFallback={()=>{setFallback(true);setThreeD(false)}} />
    <section className={styles.search} aria-label="Ask and search the records">
      <h1>Find the record. Read it for yourself.</h1>
      <form action="/ask" className={styles.searchForm}>
        <label className={styles.searchLabel} htmlFor="map-query">Ask anything / search the released records</label>
        <div className={styles.searchRow}><input id="map-query" name="q" required placeholder="An address, substance, Bates number or question" autoComplete="off"/><button type="submit" formAction="/search">Search →</button><button type="submit" formAction="/ask">Ask →</button></div>
      </form>
      <div className={styles.chips}>
        {suggestions.place && <a href={buildingUrl(suggestions.place)}>{suggestions.place.label} · most test pages</a>}
        {suggestions.substance && <a href={`/search?q=${encodeURIComponent(suggestions.substance)}`}>{suggestions.substance}</a>}
        {question && <a href={`/ask?q=${encodeURIComponent(question)}`}>{question}</a>}
        {relatedQuestion && <a href={`/ask?q=${encodeURIComponent(relatedQuestion)}`}>{relatedQuestion}</a>}
      </div>
      {(suggestions.place || suggestions.substanceSource) && <p className={styles.suggestionNote}>Machine-extracted suggestions{suggestions.place && <> · <a href={pageUrl(suggestions.place)}>building source</a></>}{suggestions.substanceSource && <> · <a href={pageUrl(suggestions.substanceSource)}>substance source</a></>}</p>}
    </section>
    <aside className={`${styles.panel} ${expanded?styles.expanded:''}`} aria-label="Building records">
      <button className={styles.sheetHandle} onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>{expanded?'Collapse':'Expand'} records panel</button>
      {selected ? <>
        <button className={styles.back} onClick={()=>select(null)}>← Collection overview</button>
        {busy && <p role="status">Reading building records…</p>}
        {error && <p role="alert">{error} <button onClick={()=>setRevision(v=>v+1)}>Retry</button></p>}
        {file && <><div className="eyebrow">Building / all boxes</div><h2>{file.place.label}</h2>
          <p>{file.place.n_docs} records · {file.place.n_pages} pages · {file.place.n_test_pages} test candidate pages</p>
          <p className={styles.note}>Machine-extracted building match · confidence {file.place.confidence?.toFixed(2) ?? 'not available'} · <a href={pageUrl(file.place)}>verify source</a></p>
          <a href={buildingUrl(file.place)}>Open building file →</a>
          {file.facts && <><h3>Building details</h3><dl className={styles.facts}>
            {file.facts.year_built!=null && <div><dt>Year built</dt><dd>{file.facts.year_built}</dd></div>}
            {file.facts.num_floors!=null && <div><dt>Floors</dt><dd>{file.facts.num_floors}</dd></div>}
            {(file.facts.units_res!=null||file.facts.units_total!=null) && <div><dt>Units</dt><dd>{file.facts.units_res??'—'} res / {file.facts.units_total??'—'} total</dd></div>}
            {file.facts.bldg_class && <div><dt>Class</dt><dd>{decodeBldgClass(file.facts.bldg_class)}</dd></div>}
          </dl><p className={styles.note}>Present-day data · provided by <a href="https://prospect.nyc">prospect.nyc</a>, not a 2001 description.</p></>}
          <h3>Tests over time</h3><p className={styles.note}>All available pages for this building, independent of the map filters.</p>
          <RecordTable rows={file.rows.filter(r=>r.has_test)} compact/>
          <h3>Other pages / related memos</h3><p className={styles.note}>These pages mention the building; a memo or decision classification is not established.</p>
          {file.rows.filter(r=>!r.has_test).map(r=><p className={styles.source} key={`${r.doc}:${r.page}`}><a href={pageUrl(r)}>{r.doc} · p. {r.page}</a><br/><small>{r.inspection?'Inspection candidate · ':''}Machine-extracted · confidence {r.confidence?.toFixed(2) ?? 'not available'}</small></p>)}
          {!file.rows.some(r=>!r.has_test) && <p>No other available pages indexed.</p>}
        </>}
      </> : homePanel}
      <details className={styles.filters} open>
        <summary>Explore buildings</summary>
        <label>Substance<select value={filters.substance} onChange={e=>change('substance',e.target.value)}><option value="">All substances</option>{substances.map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Record type<select value={filters.type} onChange={e=>change('type',e.target.value)}><option value="">All record types</option><option value="test">Test candidates</option><option value="inspection">Inspection candidates</option><option value="mention">Mentioned only</option></select></label>
        <label>From {month(filters.from)}<input type="range" min="0" max="27" value={filters.from} aria-label="Start month" onChange={e=>change('from',Math.min(Number(e.target.value),filters.to))}/></label>
        <label>Through {month(filters.to)}<input type="range" min="0" max="27" value={filters.to} aria-label="End month" onChange={e=>change('to',Math.max(Number(e.target.value),filters.from))}/></label>
        <p className={styles.note}>Full range includes undated pages and dates outside 2001–2003. Moving either slider includes only pages with a candidate date in that range.</p>
        <label className={styles.check}><input type="checkbox" checked={filters.only} onChange={e=>change('only',e.target.checked)}/>Only buildings with results</label>
        <div className={styles.mode}><button aria-pressed={threeD} disabled={fallback} onClick={()=>setThreeD(v=>!v)}>{fallback?'Flat · WebGL unavailable':threeD?'3D on · switch to flat':'Flat · switch to 3D'}</button><button onClick={()=>setFilters({...DEFAULT_FILTERS})}>Reset filters</button></div>
        <p role="status">{mapBusy?'Updating buildings…':mapError?'Building index unavailable.':`${places.length} mapped buildings match.`}{mapError && <button onClick={()=>setRevision(v=>v+1)}>Retry</button>}</p>
        <label>Choose a building<select value={selected && places.some(p=>p.id===selected)?selected:''} onChange={e=>select(e.target.value||null)}><option value="">Select a building…</option>{places.map(p=><option key={p.id} value={p.id}>{p.label} · {p.n_pages} pages</option>)}</select></label>
      </details>
      <div className={styles.legend} aria-label="Map legend">{(['test','inspection','mention'] as const).map((k,i)=><span key={k}><i style={{background:COLORS[k]}}/>{['Test candidates','Inspection candidates','Mentioned only'][i]}</span>)}<span><i style={{background:COLORS.ground}}/>No matching indexed records</span></div>
      <p className={styles.note}>Machine-extracted matches. Inspection candidates contain an inspection heading or date cue. Colour describes records, never safety. Select a building to verify its source pages.</p>
    </aside>
  </main>;
}
