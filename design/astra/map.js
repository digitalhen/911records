/* Offline SVG rendering; geometry and fixture records are loaded by local script tags. */
(() => {
 const svg=document.getElementById('building-map');
 if(!svg)return;
 const ns='http://www.w3.org/2000/svg', buildings=window.mapBuildings, records=window.mapRecords;
 const colors={lab:'#315f91',inspection:'#668873',mention:'#bba578'};
 const make=(tag,attrs,parent)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));parent.append(e);return e};
 const geometry=document.getElementById('map-geometry'),pins=document.getElementById('map-pins'),reference=document.getElementById('map-reference');
 const paths=new Map();
 window.footprints.forEach(([bin,d])=>{const p=make('path',{d,'fill-rule':'evenodd'},geometry);if(!paths.has(bin))paths.set(bin,[]);paths.get(bin).push(p)});
 const project=(lon,lat)=>[(lon+74.025)*74000,(40.725-lat)*97600];
 function outline(points,label){const xy=points.map(p=>project(...p));make('polygon',{points:xy.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#455963','stroke-width':2,'stroke-dasharray':'7 5','vector-effect':'non-scaling-stroke'},reference);const t=make('text',{x:xy[0][0],y:xy[0][1]-12,fill:'#253c4a','font-size':26},reference);t.textContent=label}
 reference.style.pointerEvents='none';
 outline([[-74.0137,40.713],[-74.0098,40.7116],[-74.0113,40.709],[-74.0155,40.7104]],'WTC site · approximate');
 outline([[-74.0145,40.7098],[-74.009,40.7082],[-74.0086,40.7075],[-74.014,40.7091]],'Liberty sampling zone · fixture memo');
 const detail=document.getElementById('map-detail');
 const substance=document.getElementById('map-substance'),type=document.getElementById('map-type'),date=document.getElementById('map-date'),only=document.getElementById('results-only');
 let selected=0,visible=[],matching=[];
 const stamp=n=>'NYC-WTC_9'+String(n).padStart(8,'0');
 const link=r=>'document.html?page='+r.page+'&highlight='+encodeURIComponent(r.highlight)+'#page';
 const dots=buildings.map((b,i)=>{const f=window.footprints.find(f=>f[0]===b.bin);const dot=make('circle',{cx:f[2],cy:f[3],r:19,tabindex:0,role:'button','aria-label':b.address+' — open fixture records'},pins);make('title',{},dot).textContent=b.address;dot.onclick=()=>{selected=i;panel()};dot.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selected=i;panel()}};return dot});
 function panel(){
  if(!visible.length){detail.innerHTML='<h2>No matching fixture buildings</h2><p>Change the substance, date or record type to see records.</p>';return}
  if(!visible.includes(selected))selected=visible[0];
  const b=buildings[selected],rows=matching.filter(r=>r.building===selected);
  detail.innerHTML='<label for="map-building">Building with matching records</label><select id="map-building" class="map-record-selector">'+visible.map(i=>'<option value="'+i+'"'+(i===selected?' selected':'')+'>'+buildings[i].address+'</option>').join('')+'</select><h2>'+b.address+'</h2><p>BIN '+b.bin+' · <a href="#map-timeline">'+rows.length+' records / '+new Set(rows.map(r=>r.page)).size+' pages in these filters</a></p><p class="extraction">Machine-extracted · fixture matching confidence 0.91. Address-to-BIN assignments are illustrative, not verified real addresses. Check each linked source.</p>'+(selected===0?'<a href="building.html">Open building case file →</a>':'')+'<h3 id="map-timeline">Tests and related records</h3>'+rows.map(r=>'<section class="source-item"><p><b>'+r.date+' · '+r.title+'</b></p><p>'+r.substance+' · '+(r.result?r.result+' · '+r.lab+' (analyzing laboratory)':'No test result on this record.')+'</p>'+(r.limit?'<p>'+r.limit+' Limit source: worksheet below.</p>':'')+'<a href="'+link(r)+'">'+stamp(r.page)+' · verify highlighted reading / record →</a><p class="extraction">Machine-extracted · confidence 0.86 · verify against the page.</p></section>').join('');
  document.getElementById('map-building').onchange=e=>{selected=Number(e.target.value);panel()};
  dots.forEach((d,i)=>{d.setAttribute('aria-pressed',String(i===selected));d.setAttribute('r',i===selected?25:19)});
 }
 function update(){
  const end=new Date(Date.UTC(2001,8+Number(date.value)+1,0));
  document.getElementById('map-date-label').textContent=end.toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
  matching=records.filter(r=>r.date<=end.toISOString().slice(0,10)&&(substance.value==='all'||r.substance===substance.value)&&(type.value==='all'||r.type===type.value)).sort((a,b)=>a.date.localeCompare(b.date));
  visible=buildings.map((_,i)=>i).filter(i=>matching.some(r=>r.building===i)&&(!only.checked||matching.some(r=>r.building===i&&r.type==='lab')));
  buildings.forEach((b,i)=>{const rows=matching.filter(r=>r.building===i);const color=colors[rows.some(r=>r.type==='lab')?'lab':rows.some(r=>r.type==='inspection')?'inspection':'mention'];const show=visible.includes(i);dots[i].style.display=show?'':'none';dots[i].setAttribute('fill',color);(paths.get(b.bin)||[]).forEach(p=>{p.style.fill=show?color:'';p.style.cursor=show?'pointer':'';p.onclick=show?()=>{selected=i;panel()}:null})});
  document.getElementById('map-count').textContent=visible.length+' of 4 fixture buildings match.';panel();
 }
 [substance,type,only].forEach(e=>e.addEventListener('change',update));date.addEventListener('input',update);
 let view=[0,0,3000,3300],drag=null,moved=false;
 const draw=()=>svg.setAttribute('viewBox',view.join(' '));
 function zoom(f){const w=Math.min(6000,Math.max(300,view[2]*f)),h=w*1.1;view=[view[0]+(view[2]-w)/2,view[1]+(view[3]-h)/2,w,h];draw()}
 document.getElementById('map-in').onclick=()=>zoom(.65);document.getElementById('map-out').onclick=()=>zoom(1/.65);document.getElementById('map-reset').onclick=()=>{view=[0,0,3000,3300];draw()};
 svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,view:[...view]};moved=false});
 svg.addEventListener('pointermove',e=>{if(!drag)return;const scale=svg.getScreenCTM().a,dx=(e.clientX-drag.x)/scale,dy=(e.clientY-drag.y)/scale;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4){moved=true;svg.setPointerCapture(e.pointerId)}if(moved){view=[drag.view[0]-dx,drag.view[1]-dy,...drag.view.slice(2)];draw()}});
 svg.addEventListener('pointerup',()=>{drag=null});svg.addEventListener('pointercancel',()=>{drag=null});svg.addEventListener('pointerleave',()=>{if(!moved)drag=null});
 svg.addEventListener('click',e=>{if(moved){e.stopPropagation();e.preventDefault();moved=false}},true);
 svg.setAttribute('role','group');update();
})();
