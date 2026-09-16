const frame = document.getElementById('frame');
const report = document.getElementById('results');
const live = new URLSearchParams(location.search).has('live');
if (live) { document.getElementById('run').disabled=true; document.querySelector('header strong').textContent='LOCAL READER · Live public records'; }
const doc = 'NYC-WTC_000000100';
const other = 'NYC-WTC_000000200';
const words = 'Cleaning is proposed. Work is subject to approval. A proposal does not establish completion.';
let dark = false, generation = 0, delay = 0, removeNext = false, ready = false;
const errors = [];
function boxes(text) { let x = 12, y = 20; return { w: 400, h: 500, words: text.split(' ').map(word => { if (x + word.length * 6 > 380) { x = 12; y += 20; } const box = [x, y, x + word.length * 6, y + 14, word]; x += word.length * 6 + 6; return box; }) }; }
const geo = boxes(words);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="white"/>' + geo.words.map(w=>'<text x="'+w[0]+'" y="'+(w[1]+11)+'" font-family="monospace" font-size="10">'+w[4]+'</text>').join('') + '<text x="12" y="440" font-family="Arial" font-size="11">TEST FIXTURE — NOT AN ORIGINAL RECORD</text></svg>';
const asset = URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
function result(name,args={}) {
  const url = 'https://911records.nyc/doc/'+(args.doc||doc);
  const row = {doc, page:1, bates:doc, agency:'Test collection',machine_extracted_title:'Proposed cleaning scope',url,short_url:url};
  let data;
  let meta = {tool:name,input:args};
  if(name==='removed'||removeNext){removeNext=false;return {isError:true,content:[{type:'text',text:'Document unavailable or removed from the public collection.'}]};}
  if(name==='search_records') data={hits:[row,{...row,doc:other,bates:other,machine_extracted_title:'Site visit observations'}],indexed_page_total:3,page:args.page||1,next_page:args.page?null:2};
  if(name==='get_page') {
    const text=args.offset?'Remaining extracted text.':words;
    data={doc:args.doc||doc,page:args.page||1,bates:args.doc||doc,text,text_available:true,offset:args.offset||0,next_offset:null,total_chars:text.length,url,short_url:url,scan_url:'https://911records.nyc/files/fixture.webp',official_url:'https://example.org/source'};
    meta={...meta,title:args.doc===other?'Site visit observations':'Proposed cleaning scope',pageCount:3,summary:'A proposed scope, not a completion record.',boxes:geo,pdfUrl:'https://911records.nyc/files/fixture.pdf'};
  }
  if(name==='get_document') data={...row,page_count:3,machine_extracted_summary:'A proposed scope, not a completion record.',pages:[{doc,page:1,url},{doc,page:2,url}],next_page:args.start_page?null:3,pdf_url:'https://911records.nyc/files/fixture.pdf',official_url:'https://example.org/source'};
  if(name==='browse_collection') data={documents:[{...row,page:undefined,page_count:3}],next_after:args.after?null:other};
  if(name==='get_changes') data={changes:[{doc:other,date:'2026-09-16',kind:'removed'},{...row,page:undefined,date:'2026-09-15',kind:'added'}],next_offset:args.offset?null:2};
  if(name==='get_document') meta.evidence=[
    {doc,page:1,label:'Proposal',claim:'Cleaning is proposed, not completed.',explanation:'The wording describes proposed work.',limitation:'This does not establish completion.',quote:'Cleaning is proposed.',source:result('get_page',{doc,page:1})},
    {doc:other,page:1,label:'Context',claim:'Second source context.',explanation:'Read this source alongside the first.',quote:'Cleaning is proposed.',source:result('get_page',{doc:other,page:1})}
  ];
  return {structuredContent:data,_meta:{reader:meta}};
}
function send(method,params) {frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},location.origin);}
async function invoke(name,args) { return live ? (await fetch('/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})).json() : result(name,args); }
async function show(name='search_records',args=live?{query:'Cedar Street',limit:5}:{query:'proposed'}) {send('ui/notifications/tool-input',{arguments:args});send('ui/notifications/tool-result',await invoke(name,args));await pause(50);}
window.addEventListener('message', async event=>{
 if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
 const m=event.data;if(m?.jsonrpc!=='2.0')return;
 if(m.method==='ui/initialize') {
   const proto=frame.contentWindow.HTMLImageElement.prototype;
   const descriptor=Object.getOwnPropertyDescriptor(proto,'src');
   if (!live) Object.defineProperty(proto,'src',{...descriptor,set(value){descriptor.set.call(this,value==='https://911records.nyc/files/fixture.webp'?asset:value);}});
   frame.contentWindow.addEventListener('error', e=>errors.push(e.message));
   frame.contentWindow.addEventListener('unhandledrejection', e=>errors.push(String(e.reason)));
   frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostCapabilities:{},hostInfo:{name:'fixture-host',version:'1'},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}}},location.origin);
 }
 if(m.method==='ui/notifications/initialized'){ready=true;report.textContent=live?'Connected to local MCP server with live public records.':'Ready. All records shown here are test fixtures.';const initialDoc=new URLSearchParams(location.search).get('doc');if(live&&initialDoc)show('get_document',{doc:initialDoc,...(initialDoc==='NYC-WTC_000150782'?{evidence:[{doc:initialDoc,page:11,label:'Pearl Street entries',claim:'Cleanup is recorded at five Pearl Street addresses.',explanation:'The list marks 205, 211, 212, 213 and 215 Pearl Street Completed.',limitation:'This is a cleanup record, not an asbestos sample result.',quote:'205 PEARL STREET'},{doc:initialDoc,page:1,label:'What the list covers',claim:'The list concerns exterior cleaning by NYC DEP.',explanation:'The heading gives context for the entries on page 11.',quote:'BUILDING EXTERIORS CLEANED BY NYC DEP'}]}:{})});else show('get_document');}
 if(m.method==='tools/call') {
   const response=await invoke(m.params.name,m.params.arguments);const wait=delay;delay=0;
   setTimeout(()=>frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:response},location.origin),wait);
 }
 if(m.method==='ui/request-display-mode')frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{mode:m.params.mode}},location.origin);
 if(m.method==='ui/update-model-context')frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);
 if(m.method==='ui/open-link')frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{}},location.origin);
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const dom=()=>frame.contentDocument;
const text=()=>dom().getElementById('reader').textContent;
async function until(check){for(let i=0;i<60;i++){if(check())return;await pause(20);}throw Error('Timed out');}
function click(label){const b=[...dom().querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);if(!b)throw Error('Missing button '+label);b.click();}
function find(value){const input=dom().querySelector('input[type=search]');input.value=value;input.dispatchEvent(new Event('input'));}
async function run(){
 if(!ready)return;
 const results=[];let failed=0;
 async function check(name,fn){try{await fn();results.push('PASS '+name);}catch(e){failed++;results.push('FAIL '+name+': '+e.message);}report.textContent=results.join('\n');}
 const assert=(value,message)=>{if(!value)throw Error(message)};
 await check('One evidence panel pairs a question-specific brief with a scan',async()=>{await show('get_document');await until(()=>dom().querySelector('.meaning'));assert(text().includes('Cleaning is proposed, not completed.'),'missing brief');assert(dom().querySelectorAll('.evidence-body').length===1,'multiple panels');assert(dom().querySelectorAll('.sources button').length===2,'missing sources');assert(!dom().querySelector('.ocr'),'OCR wall');assert(dom().querySelector('.primary').href.includes(doc),'wrong source link');});
 await check('Verified quotation has aligned scan highlights',async()=>{await until(()=>dom().querySelector('.scan-highlight'));assert(dom().querySelector('blockquote').textContent==='Cleaning is proposed.','wrong quote');assert(dom().querySelectorAll('.scan-highlight').length===3,'wrong boxes');});
 await check('Source switch updates brief, citation and link in the same panel',async()=>{dom().querySelectorAll('.sources button')[1].click();await until(()=>text().includes('Second source context.'));assert(dom().querySelector('.primary').href.endsWith(other),'wrong destination');assert(dom().querySelectorAll('.evidence-body').length===1,'extra panel');});
 await check('Enlarge opens the source image and closes',async()=>{click('Enlarge ↗');assert(dom().querySelector('dialog').open,'dialog closed');assert(dom().querySelector('dialog img').src===dom().querySelector('.scan-page img').src,'wrong scan');click('Close ×');assert(!dom().querySelector('dialog').open,'dialog remains');});
 await check('Collapse preserves sources without creating another panel',async()=>{click('Hide preview −');assert(dom().getElementById('content').hidden,'not collapsed');click('Show evidence +');assert(!dom().getElementById('content').hidden,'not restored');});
 await check('Absent brief uses a clearly labelled document summary',async()=>{await show('get_page');await until(()=>dom().querySelector('.meaning'));assert(text().includes('DOCUMENT SUMMARY'),'fallback label');assert(!text().includes('WHY THIS PAGE MATTERS'),'invented relevance');});
 await check('Missing summary and scan stay explicit',async()=>{const r=result('get_page');r._meta.reader.summary=null;r.structuredContent.scan_url=null;send('ui/notifications/tool-result',r);await pause(50);assert(text().includes('No summary is available'),'missing summary');assert(text().includes('Scan unavailable'),'missing scan');assert(dom().querySelector('.primary'),'source link missing');});
 await check('Mismatched geometry never draws a plausible highlight',async()=>{const r=result('get_document');r._meta.reader.evidence[0].source._meta.reader.boxes={...geo,words:geo.words.slice(0,-1)};send('ui/notifications/tool-result',r);await pause(80);assert(!dom().querySelector('.scan-highlight'),'false highlight');assert(text().includes('Exact scan highlight unavailable'),'missing fallback');});
 await check('Untrusted interpretations render as literal text',async()=>{const r=result('get_document');r._meta.reader.evidence[0].claim='<img src=x onerror=alert(1)>';send('ui/notifications/tool-result',r);await pause(50);assert(dom().querySelector('.meaning h2').textContent.includes('<img'),'text lost');assert(!dom().querySelector('.meaning img'),'HTML injected');});
 await check('Removed source clears claims, scan and source navigation',async()=>{await show('get_document');await pause(40);removeNext=true;dom().querySelectorAll('.sources button')[1].click();await until(()=>text().includes('Record unavailable'));assert(!dom().querySelector('.meaning')&&!dom().querySelector('.scan-page')&&!dom().querySelector('.sources'),'stale evidence');});
 await check('Delayed source response cannot overwrite a newer host result',async()=>{await show('get_document');await pause(40);delay=140;dom().querySelectorAll('.sources button')[1].click();await show('removed');await pause(200);assert(text().includes('Record unavailable'),'late response won');});
 await check('Non-parent messages cannot replace the evidence',async()=>{await show('get_document');await pause(40);frame.contentWindow.dispatchEvent(new MessageEvent('message',{data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result('removed')},source:frame.contentWindow,origin:location.origin}));assert(dom().querySelector('.meaning'),'forged event accepted');});
 await check('Mobile 320px panel stays within its container',async()=>{frame.style.width='320px';await pause(50);assert(dom().documentElement.scrollWidth<=320,'horizontal overflow');assert(getComputedStyle(dom().querySelector('.evidence-body')).gridTemplateColumns.split(' ').length===1,'not stacked');frame.style.width='100%';});
 await check('Host dark theme updates the panel',async()=>{send('ui/notifications/host-context-changed',{theme:'dark'});await pause(30);assert(dom().documentElement.dataset.theme==='dark','dark theme');send('ui/notifications/host-context-changed',{theme:'light'});});
 await check('No uncaught browser errors',async()=>assert(errors.length===0,errors.join('; ')));
 report.textContent=results.join('\n')+'\n'+(failed?'FAILED '+failed:'ALL CHECKS PASSED');await fetch('/report',{method:'POST',body:report.textContent});await show('get_document');
}
document.getElementById('run').onclick=run;
document.getElementById('state').onchange=e=>show(e.target.value,live&&['get_document','get_page'].includes(e.target.value)?{doc:'NYC-WTC_000140827',page:1}:live&&e.target.value!=='search_records'?{}:undefined);
document.getElementById('mobile').onclick=()=>frame.style.width=frame.style.width==='390px'?'100%':'390px';
document.getElementById('theme').onclick=()=>{dark=!dark;send('ui/notifications/host-context-changed',{theme:dark?'dark':'light',availableDisplayModes:['inline','fullscreen']})};

frame.src='/reader';
