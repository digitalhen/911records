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
    meta={...meta,title:args.doc===other?'Site visit observations':'Proposed cleaning scope',pageCount:3,boxes:geo,pdfUrl:'https://911records.nyc/files/fixture.pdf'};
  }
  if(name==='get_document') data={...row,page_count:3,machine_extracted_summary:'A proposed scope, not a completion record.',pages:[{doc,page:1,url},{doc,page:2,url}],next_page:args.start_page?null:3,pdf_url:'https://911records.nyc/files/fixture.pdf',official_url:'https://example.org/source'};
  if(name==='browse_collection') data={documents:[{...row,page:undefined,page_count:3}],next_after:args.after?null:other};
  if(name==='get_changes') data={changes:[{doc:other,date:'2026-09-16',kind:'removed'},{...row,page:undefined,date:'2026-09-15',kind:'added'}],next_offset:args.offset?null:2};
  return {structuredContent:data,_meta:{reader:meta}};
}
function send(method,params) {frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},location.origin);}
async function invoke(name,args) { return live ? (await fetch('/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})).json() : result(name,args); }
async function show(name='search_records',args=live?{query:'Cedar Street',limit:5}:{query:'proposed'}) {send('ui/notifications/tool-input',{arguments:args});send('ui/notifications/tool-result',await invoke(name,args));}
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
 if(m.method==='ui/notifications/initialized'){ready=true;report.textContent=live?'Connected to local MCP server with live public records.':'Ready. All records shown here are test fixtures.';const initialDoc=new URLSearchParams(location.search).get('doc');if(live&&initialDoc)show('get_page',{doc:initialDoc,page:1});else show();}
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
 await check('Search rows open cited pages using existing tools',async()=>{show();await pause(40);await until(()=>dom().querySelector('.source'));dom().querySelector('.source').click();await until(()=>dom().querySelector('.ocr'));assert(text().includes(words),'missing retrieved text');});
 await check('Exact phrase highlights align with validated scan words',async()=>{find('proposed');await until(()=>dom().querySelector('.scan-highlight'));assert(dom().querySelectorAll('.ocr mark').length===1,'text count');assert(dom().querySelectorAll('.scan-highlight').length===1,'scan count');});
 await check('Scan zoom preserves overlay coordinates',async()=>{click('Zoom in');assert(dom().querySelector('.scan-page').style.width==='150%','zoom width');assert(dom().querySelector('.scan-highlight'),'missing overlay after zoom');click('Zoom out');});
 await check('Literal punctuation is not a regex',async()=>{find('proposed.');assert(dom().querySelectorAll('.ocr mark').length===1,'literal match');find('[.*]');assert(dom().querySelectorAll('.ocr mark').length===0,'regex injection');});
 await check('Mismatched word-box text never gets a scan highlight',async()=>{const r=result('get_page');r._meta.reader.boxes={...geo,words:geo.words.slice(0,-1)};send('ui/notifications/tool-result',r);await until(()=>dom().querySelector('.ocr'));find('proposed');await pause(80);assert(!dom().querySelector('.scan-highlight'),'ambiguous highlight');});
 await check('Untrusted document strings render as text, not HTML',async()=>{const r=result('get_page');r.structuredContent.text='<img src=x onerror=alert(1)> proposed';r._meta.reader.title='<script>alert(1)</script>';send('ui/notifications/tool-result',r);await pause(50);assert(dom().querySelector('.ocr').textContent.includes('<img'),'text escaped');assert(!dom().querySelector('.ocr img'),'HTML inserted');});
 await check('All five tools have usable views and pagination',async()=>{for(const name of ['search_records','get_document','browse_collection','get_changes']){show(name);await pause(30);assert(dom().querySelector('button')&&text().includes('Next results'),'missing pager '+name);click('Next results →');await pause(40);assert(!text().includes('Next results'),'pagination did not advance '+name);}show('get_page');await pause(40);click('Next page');await until(()=>text().includes('2 / 3'));});
 await check('Long OCR exposes continuation and excerpt-only highlights',async()=>{const r=result('get_page');r.structuredContent.next_offset=12000;r.structuredContent.total_chars=24000;send('ui/notifications/tool-result',r);await pause(40);find('proposed');assert(text().includes('Partial text'),'partial label');assert(!dom().querySelector('.scan-highlight'),'partial alignment');click('Continue text →');await until(()=>text().includes('Remaining extracted text.'));assert(text().includes('Start of text'),'return missing');});
 await check('Highlight toggle and scan/text views',async()=>{show('get_page');await pause(40);find('proposed');dom().querySelector('input[type=checkbox]').click();assert(!dom().querySelector('.ocr mark'),'toggle off');click('Text');assert(getComputedStyle(dom().querySelector('.scan-pane')).display==='none','text view');click('Scan + text');dom().querySelector('input[type=checkbox]').click();});
 await check('Removed record clears previous text, image and sources',async()=>{removeNext=true;click('Next page');await until(()=>text().includes('Record unavailable'));assert(!dom().querySelector('.ocr')&&!dom().querySelector('.scan-page')&&!dom().querySelector('.sources'),'stale evidence');});
 await check('Late tool response cannot overwrite newer host result',async()=>{show('get_page');await pause(40);delay=140;click('Next page');show('removed');await pause(200);assert(text().includes('Record unavailable')&&!dom().querySelector('.ocr'),'late response won');});
 await check('Non-parent postMessage results are ignored',async()=>{show('get_page');await pause(40);frame.contentWindow.dispatchEvent(new MessageEvent('message',{data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result('removed')},source:frame.contentWindow,origin:location.origin}));assert(dom().querySelector('.ocr'),'forged event accepted');});
 await check('Mobile source picker and 320px layout',async()=>{show();await pause(40);dom().querySelector('.source').click();await until(()=>dom().querySelector('.mobile-sources'));frame.style.width='320px';await pause(50);assert(dom().documentElement.scrollWidth<=320,'horizontal overflow');assert(getComputedStyle(dom().querySelector('.mobile-sources')).display==='flex','missing mobile source picker');const select=dom().querySelector('.mobile-sources select');select.value='1';select.dispatchEvent(new Event('change'));await until(()=>text().includes('Site visit observations'));frame.style.width='100%';});
 await check('Dark host theme and fullscreen acknowledgement',async()=>{send('ui/notifications/host-context-changed',{theme:'dark',availableDisplayModes:['inline','fullscreen']});await pause(30);assert(dom().documentElement.dataset.theme==='dark','theme');send('ui/notifications/host-context-changed',{theme:'light'});await pause(20);assert(!dom().getElementById('expand').hidden,'partial context lost capabilities');click('Expand ↗');await until(()=>text().includes('Collapse ↙'));send('ui/notifications/host-context-changed',{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']});});
 await check('No uncaught browser errors',async()=>assert(errors.length===0,errors.join('; ')));
 report.textContent=results.join('\n')+'\n'+(failed?'FAILED '+failed:'ALL CHECKS PASSED');
 await fetch('/report',{method:'POST',body:report.textContent});
 show('get_page');
}
document.getElementById('run').onclick=run;
document.getElementById('state').onchange=e=>show(e.target.value,live&&['get_document','get_page'].includes(e.target.value)?{doc:'NYC-WTC_000140827',page:1}:live&&e.target.value!=='search_records'?{}:undefined);
document.getElementById('mobile').onclick=()=>frame.style.width=frame.style.width==='390px'?'100%':'390px';
document.getElementById('theme').onclick=()=>{dark=!dark;send('ui/notifications/host-context-changed',{theme:dark?'dark':'light',availableDisplayModes:['inline','fullscreen']})};

frame.src='/reader';
