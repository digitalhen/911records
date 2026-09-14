'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LibreMap, GeoJSONSource, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import { COLORS, recordKind, type Place } from '@/lib/map/types';
import styles from './map.module.css';
type Assets = { buildings: FeatureCollection; reference: FeatureCollection; streets: FeatureCollection; joins: Record<string,string[]> };
const color: ExpressionSpecification = ['match',['get','kind'],'test',COLORS.test,'inspection',COLORS.inspection,'mention',COLORS.mention,COLORS.ground];
const center: [number,number] = [-74.0122,40.711];
function paths(geometry: Geometry): string {
  const project = ([x=0,y=0]: number[]) => `${((x+74.025)*74000).toFixed(1)},${((40.727-y)*97600).toFixed(1)}`;
  if (geometry.type === 'Polygon') return geometry.coordinates.map(r=>'M'+r.map(project).join('L')+'Z').join('');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(r=>paths({type:'Polygon',coordinates:r})).join('');
  if (geometry.type === 'MultiLineString') return geometry.coordinates.map(r=>'M'+r.map(project).join('L')).join('');
  return '';
}
export default function MapCanvas({ places, threeD, onSelect, onFallback }: { places: Place[]; threeD: boolean; onSelect: (id:string)=>void; onFallback: ()=>void }) {
  const container = useRef<HTMLDivElement>(null), map = useRef<LibreMap | null>(null);
  const select = useRef(onSelect); select.current = onSelect;
  const fallbackFn = useRef(onFallback); fallbackFn.current=onFallback;
  const [assets,setAssets]=useState<Assets|null>(null), [ready,setReady]=useState(false), [flat,setFlat]=useState(false), [error,setError]=useState(false);
  const [zoom,setZoom]=useState(1);
  const [origin,setOrigin]=useState<[number,number]>([0,0]);
  const drag=useRef<{x:number;y:number;origin:[number,number]}|null>(null);
  useEffect(()=>{
    const abort=new AbortController();
    Promise.all(['buildings.geojson','reference.geojson','streets.geojson','joins.json'].map(async f=>{
      const r=await fetch(`/geo/${f}`,{signal:abort.signal}); if(!r.ok) throw Error('Map asset unavailable'); return r.json();
    })).then(([buildings,reference,streets,joins])=>setAssets({buildings,reference,streets,joins})).catch(()=>{if(!abort.signal.aborted)setError(true)});
    return ()=>abort.abort();
  },[]);
  const painted=useMemo(()=>{
    if(!assets)return null;
    const byId=new Map(places.map(p=>[p.id,p]));
    return {...assets.buildings,features:assets.buildings.features.map(f=>{
      const matches=(assets.joins[String(f.properties?.bin)]||[]).flatMap(id=>byId.has(id)?[byId.get(id)!]:[]).sort((a,b)=>b.n_test_pages-a.n_test_pages || b.n_inspection_pages-a.n_inspection_pages);
      return {...f,properties:{bin:f.properties?.bin,height_roof:f.properties?.height_roof,kind:matches[0]?recordKind(matches[0]):'ground',place_id:matches[0]?.id || ''}};
    })};
  },[assets,places]);
  useEffect(()=>{
    if(!assets || !container.current)return;
    let cancelled=false;
    const fallback=()=>{if(cancelled)return;setFlat(true);fallbackFn.current();map.current?.remove();map.current=null;};
    import('maplibre-gl').then(lib=>{
      if(cancelled || !container.current)return;
      try {
        const m=new lib.Map({container:container.current,center,zoom:15.3,pitch:55,bearing:-22,maxZoom:19,minZoom:12,
          maxBounds:[[-74.045,40.685],[-73.965,40.74]],attributionControl:false,
          style:{version:8,sources:{},layers:[{id:'paper',type:'background',paint:{'background-color':'#f0f2ef'}}]},
          canvasContextAttributes:{antialias:true},fadeDuration:0});
        map.current=m;
        m.on('load',()=>{
          if(cancelled)return;
          m.addSource('buildings',{type:'geojson',data:assets.buildings});
          m.addSource('streets',{type:'geojson',data:assets.streets});
          m.addSource('reference',{type:'geojson',data:assets.reference});
          m.addSource('places',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
          m.addLayer({id:'streets',type:'line',source:'streets',paint:{'line-color':'#bfc9c8','line-width':0.5}});
          m.addLayer({id:'flat',type:'fill',source:'buildings',layout:{visibility:'none'},paint:{'fill-color':color}});
          m.addLayer({id:'mass',type:'fill-extrusion',source:'buildings',paint:{'fill-extrusion-color':color,'fill-extrusion-height':['*',['to-number',['get','height_roof'],0],0.3048],'fill-extrusion-opacity':0.95}});
          m.addLayer({id:'reference',type:'line',source:'reference',paint:{'line-color':'#455963','line-width':2,'line-dasharray':[4,3]}});
          m.addLayer({id:'pins',type:'circle',source:'places',paint:{'circle-color':color,'circle-radius':5,'circle-stroke-color':'#fff','circle-stroke-width':1.5}});
          // DOM text needs no remote glyphs or font server.
          const label=document.createElement('span'); label.className=styles.siteLabel!;label.textContent='WTC site · approximate';
          new lib.Marker({element:label,anchor:'bottom'}).setLngLat([-74.012,40.713]).addTo(m);
          for(const layer of ['mass','flat','pins']) {
            m.on('click',layer,e=>{const id=e.features?.[0]?.properties?.place_id;if(id)select.current(String(id));});
            m.on('mousemove',layer,e=>{m.getCanvas().style.cursor=e.features?.[0]?.properties?.place_id?'pointer':''});
            m.on('mouseleave',layer,()=>{m.getCanvas().style.cursor=''});
          }
          setReady(true);
        });
        m.on('webglcontextlost',fallback);
        m.on('error',()=>{if(!m.loaded())fallback()});
      } catch {fallback()}
    }).catch(fallback);
    return ()=>{cancelled=true;map.current?.remove();map.current=null};
  },[assets]);
  useEffect(()=>{
    const m=map.current;if(!m || !ready || !painted)return;
    (m.getSource('buildings') as GeoJSONSource).setData(painted);
    (m.getSource('places') as GeoJSONSource).setData({type:'FeatureCollection',features:places.filter(p=>p.lon!==null&&p.lat!==null).map(p=>({type:'Feature',properties:{place_id:p.id,kind:recordKind(p)},geometry:{type:'Point',coordinates:[p.lon!,p.lat!]}}))});
  },[painted,places,ready]);
  useEffect(()=>{const m=map.current;if(!m||!ready)return;m.setLayoutProperty('mass','visibility',threeD?'visible':'none');m.setLayoutProperty('flat','visibility',threeD?'none':'visible');m.easeTo({pitch:threeD?55:0,bearing:threeD?-22:0,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:600})},[threeD,ready]);
  return <div className={styles.canvas}>
    <div ref={container} className={styles.mapHost} aria-label="Interactive building map" />
    {flat && painted && assets && <svg className={styles.svg} viewBox={`${origin[0]} ${origin[1]} ${2960/zoom} ${2830/zoom}`} aria-label="Flat building map" role="img"
      onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,origin}}}
      onPointerMove={e=>{if(!drag.current)return;const scale=2960/zoom/e.currentTarget.getBoundingClientRect().width;setOrigin([drag.current.origin[0]-(e.clientX-drag.current.x)*scale,drag.current.origin[1]-(e.clientY-drag.current.y)*scale])}}
      onPointerUp={()=>{drag.current=null}} onPointerLeave={()=>{drag.current=null}}>
      {assets.streets.features.map((f,i)=><path key={`s${i}`} d={paths(f.geometry)} fill="none" stroke="#bfc9c8" strokeWidth="1"/>)}
      {painted.features.map((f,i)=><path key={i} d={paths(f.geometry)} fill={COLORS[f.properties.kind as keyof typeof COLORS] || COLORS.ground} fillRule="evenodd" onClick={()=>f.properties.place_id && onSelect(f.properties.place_id)}/>)}
      {assets.reference.features.map((f,i)=><path key={`r${i}`} d={paths(f.geometry)} fill="none" stroke="#455963" strokeWidth="3" strokeDasharray="8 6"/>)}
      <text x="800" y="1280" fontSize="30">WTC site · approximate</text>
      {places.filter(p=>p.lon!==null&&p.lat!==null).map(p=><circle key={p.id} cx={(p.lon!+74.025)*74000} cy={(40.727-p.lat!)*97600} r="9" fill={COLORS[recordKind(p)]} stroke="white" onClick={()=>onSelect(p.id)}/>)}
    </svg>}
    {(!assets || error) && <p className={styles.mapMessage} role="status">{error?'Map geometry unavailable. Explore buildings using the list.':'Loading local building geometry…'}</p>}
    <div className={styles.zoom} aria-label="Map controls">
      <button aria-label="Zoom in" onClick={()=>flat?setZoom(z=>Math.min(6,z*1.4)):map.current?.zoomIn()}>+</button>
      <button aria-label="Zoom out" onClick={()=>flat?setZoom(z=>Math.max(0.8,z/1.4)):map.current?.zoomOut()}>−</button>
      <button aria-label="Reset map" onClick={()=>{setZoom(1);setOrigin([0,0]);map.current?.easeTo({center,zoom:15.3})}}>↺</button>
    </div>
    <div className={styles.mapCredit}>Present-day NYC footprints · {flat?'flat map · ':''}Reference outline approximate. No health verdict.</div>
  </div>;
}
