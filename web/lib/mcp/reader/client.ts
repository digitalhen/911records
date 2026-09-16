/** Self-contained browser entry. Rebuild with: node scripts/build-mcp-reader.mjs */
(() => {
  type Args = Record<string, unknown>;
  type Row = { doc: string; page?: number; bates?: string; agency?: string | null; machine_extracted_title?: string | null; page_count?: number | null; date?: string; kind?: string; url?: string; short_url?: string };
  type Data = Partial<Row> & { text?: string; text_available?: boolean; offset?: number; next_offset?: number | null; total_chars?: number; scan_url?: string | null; official_url?: string | null; pdf_url?: string | null; pages?: Row[]; hits?: Row[]; documents?: Row[]; changes?: Row[]; indexed_page_total?: number; next_page?: number | null; next_after?: string | null; machine_extracted_summary?: string | null; note?: string };
  type Boxes = { w: number; h: number; words: [number, number, number, number, string][] };
  type Meta = { tool?: string; input?: Args; pageCount?: number | null; title?: string | null; pdfUrl?: string | null; boxes?: Boxes | null };
  type Result = { structuredContent?: Data; _meta?: { reader?: Meta }; isError?: boolean; content?: { type: string; text?: string }[] };
  type HostContext = { theme?: string; displayMode?: string; availableDisplayModes?: string[] };
  type OpenAI = { toolOutput?: Data; toolResponseMetadata?: { reader?: Meta }; toolInput?: Args; theme?: string; displayMode?: string; callTool?: (name: string, args: Args) => Promise<Result>; requestDisplayMode?: (args: { mode: string }) => Promise<{ mode: string }>; openExternal?: (args: { href: string; redirectUrl: boolean }) => void; notifyIntrinsicHeight?: (height: number) => void };
  const win = window as Window & { openai?: OpenAI };
  const content = document.getElementById('content')!;
  const notice = document.getElementById('notice')!;
  const expand = document.getElementById('expand') as HTMLButtonElement;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let rpcId = 0, epoch = 0, bridgeReady = false, parentOrigin = '*', mode = 'inline';
  let contextState: HostContext = {};
  let hostInput: Args = {}, tool = '', input: Args = {}, data: Data | null = null, metadata: Meta = {};
  let list: { data: Data; meta: Meta; tool: string; input: Args } | null = null;
  let phrase = '', view = 'both', highlights = true, activeMatch = 0, lastRequest: { name: string; args: Args } | null = null;
  let matches: [number, number][] = [], scanMatches: number[][] = [];
  let textElement: HTMLElement | null = null, scanPage: HTMLElement | null = null, scanImage: HTMLImageElement | null = null;
  let matchLabel: HTMLElement | null = null, scanNote: HTMLElement | null = null, nextMatch: HTMLButtonElement | null = null;
  let scanReady = false, disposed = false, resizeFrame = 0, lastHeight = 0;

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label: string, run: () => void, cls = '') { const node = el('button', cls, label); node.type = 'button'; node.onclick = run; return node; }
  function notify(method: string, params: unknown) { if (window.parent !== window) window.parent.postMessage({ jsonrpc: '2.0', method, params }, parentOrigin); }
  function request(method: string, params: unknown, timeout = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (window.parent === window || disposed) { reject(new Error('Open this reader in a connected MCP app.')); return; }
      const id = ++rpcId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The host did not respond. Please retry.')); }, timeout);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, parentOrigin);
    });
  }
  function safeUrl(value: unknown, firstParty = false): string | null {
    if (typeof value !== 'string') return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!firstParty || url.origin === 'https://911records.nyc') ? url.href : null; } catch { return null; }
  }
  function link(label: string, value: unknown, firstParty = false) {
    const url = safeUrl(value, firstParty); if (!url) return null;
    const a = el('a', '', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  document.addEventListener('click', event => {
    const a = (event.target as Element).closest('a'); if (!a) return;
    const href = safeUrl(a.href); if (!href) { event.preventDefault(); return; }
    if (bridgeReady) { event.preventDefault(); void request('ui/open-link', { url: href }).catch(() => { notice.textContent = 'The host could not open the link. Use its link menu to open it in your browser.'; }); }
    else if (win.openai?.openExternal) { event.preventDefault(); win.openai.openExternal({ href, redirectUrl: false }); }
  });
  function setContext(update: HostContext) {
    contextState = { ...contextState, ...update };
    const context = contextState;
    if (context.theme === 'light' || context.theme === 'dark') document.documentElement.dataset.theme = context.theme;
    if (context.displayMode) mode = context.displayMode;
    expand.textContent = mode === 'fullscreen' ? 'Collapse ↙' : 'Expand ↗';
    expand.hidden = !(win.openai?.requestDisplayMode || context.availableDisplayModes?.includes('fullscreen'));
  }
  expand.onclick = async () => {
    expand.disabled = true;
    try {
      const desired = mode === 'fullscreen' ? 'inline' : 'fullscreen';
      const result = bridgeReady ? await request('ui/request-display-mode', { mode: desired }) as { mode: string } : await win.openai?.requestDisplayMode?.({ mode: desired });
      if (result) { mode = result.mode; expand.textContent = mode === 'fullscreen' ? 'Collapse ↙' : 'Expand ↗'; }
    } catch { notice.textContent = 'Expanded view is unavailable in this host. You can still read or open the source page.'; }
    finally { expand.disabled = false; }
  };
  function clearReader() {
    data = null; metadata = {}; textElement = scanPage = scanNote = matchLabel = null; scanImage = null; nextMatch = null; scanReady = false; matches = []; scanMatches = [];
    content.replaceChildren(); notice.replaceChildren();
  }
  function status(title: string, detail: string, retry = false) {
    clearReader(); const box = el('section', 'status'); box.setAttribute('role', 'status'); box.append(el('h2', '', title), el('p', '', detail));
    if (retry && lastRequest) box.append(button('Retry', () => { if (lastRequest) void call(lastRequest.name, lastRequest.args); }));
    content.append(box); content.setAttribute('aria-busy', 'false');
  }
  function inferTool(value: Data) { return value.hits ? 'search_records' : value.documents ? 'browse_collection' : value.changes ? 'get_changes' : value.pages ? 'get_document' : value.doc && typeof value.text === 'string' ? 'get_page' : ''; }
  function accept(result: Result, name?: string, args?: Args) {
    content.setAttribute('aria-busy', 'false');
    if (result.isError || !result.structuredContent) {
      list = null;
      const message = result.content?.filter(c => c.type === 'text').map(c => c.text || '').join(' ') || 'The records service could not return this result.';
      status('Record unavailable', message, !/removed|does not exist/i.test(message)); return;
    }
    data = result.structuredContent; metadata = result._meta?.reader || {};
    tool = metadata.tool || name || inferTool(data); input = metadata.input || args || hostInput;
    if (tool === 'search_records') phrase = typeof input.query === 'string' ? input.query.slice(0, 200) : '';
    if (tool !== 'get_page') list = { data, meta: metadata, tool, input };
    activeMatch = 0; render();
  }
  async function call(name: string, args: Args) {
    const generation = ++epoch; lastRequest = { name, args };
    status('Opening record…', 'Loading the selected source.'); content.setAttribute('aria-busy', 'true');
    try {
      const result = bridgeReady ? await request('tools/call', { name, arguments: args }) as Result : win.openai?.callTool ? await win.openai.callTool(name, args) : (() => { throw new Error('Open this reader in a connected MCP app.'); })();
      if (generation !== epoch || disposed) return;
      accept(result, name, args);
      if (bridgeReady && !result.isError && result.structuredContent?.doc) {
        const page = result.structuredContent;
        void request('ui/update-model-context', { content: [{ type: 'text', text: 'The user opened record ' + page.doc + (page.page ? ', page ' + page.page : '') + '. Source: ' + (safeUrl(page.url, true) || '') }] }).catch(() => {});
      }
    } catch (error) {
      if (generation !== epoch || disposed) return;
      list = null; status('Unable to open record', error instanceof Error ? error.message : 'Please retry.', true);
    }
  }
  function rows(value: Data): Row[] {
    if (value.pages) return value.pages.map(row => ({ ...row, doc: value.doc!, machine_extracted_title: value.machine_extracted_title }));
    return value.hits || value.documents || value.changes || [];
  }
  function rowTitle(row: Row) { return row.machine_extracted_title || row.bates || row.doc; }
  function openRow(row: Row) { if (row.kind === 'removed') return; void call(row.page ? 'get_page' : 'get_document', row.page ? { doc: row.doc, page: row.page } : { doc: row.doc }); }
  function more(value: Data, name: string, args: Args) {
    if (name === 'search_records' && value.next_page) return { ...args, page: value.next_page };
    if (name === 'get_document' && value.next_page) return { ...args, doc: value.doc, start_page: value.next_page };
    if (name === 'browse_collection' && value.next_after) return { ...args, after: value.next_after };
    if (name === 'get_changes' && value.next_offset != null) return { ...args, offset: value.next_offset };
    return null;
  }
  function sourceRow(row: Row) {
    if (row.kind === 'removed') { const removed = el('div', 'removed'); removed.append(el('div', 'mono', row.doc), el('p', 'small', (row.date || '') + ' · Removed from collection')); return removed; }
    const node = button('', () => openRow(row), 'source');
    node.setAttribute('aria-pressed', String(data?.doc === row.doc && data?.page === row.page));
    node.append(el('strong', '', rowTitle(row)), el('span', 'detail', [row.agency, row.page ? 'Page ' + row.page : row.page_count != null ? row.page_count + ' pages' : null, row.date ? 'Observed ' + row.date : null, row.kind].filter(Boolean).join(' · ')), el('span', 'mono', row.bates || row.doc));
    if (row.machine_extracted_title) node.append(el('span', 'machine', 'Machine-extracted title'));
    return node;
  }
  function sourcePicker(container: HTMLElement) {
    if (!list) return;
    const options = rows(list.data).filter(r => r.kind !== 'removed'); if (!options.length) return;
    const label = el('label', 'mobile-sources', 'Sources'); const select = el('select'); select.setAttribute('aria-label', 'Referenced source');
    const placeholder = el('option', '', 'Choose a source'); placeholder.value = ''; select.append(placeholder);
    options.forEach((row, i) => { const option = el('option', '', rowTitle(row) + (row.page ? ' · p. ' + row.page : '')); option.value = String(i); option.selected = data?.doc === row.doc && data?.page === row.page; select.append(option); });
    select.onchange = () => { const row = options[Number(select.value)]; if (select.value !== '' && row) openRow(row); };
    label.append(select); container.append(label);
  }
  function renderCollection() {
    if (!data) return;
    const section = el('section', 'collection'); const heading = el('div', 'collection-head');
    const title = tool === 'search_records' ? 'Matching record pages' : tool === 'get_document' ? data.machine_extracted_title || data.doc || 'Document' : tool === 'get_changes' ? 'Collection changes' : 'Browse records';
    heading.append(el('h2', '', title));
    if (tool === 'search_records') heading.append(el('p', '', String(data.indexed_page_total ?? 0) + ' indexed pages · Counts are not unique documents and may lag removals.'));
    if (tool === 'get_changes') heading.append(el('p', '', 'Dates show when the mirror observed a change, not when the document was written.'));
    if (tool === 'get_document') {
      if (data.machine_extracted_title || data.machine_extracted_summary) heading.append(el('p', '', 'Machine-extracted title and summary · Verify against the source.'));
      if (data.machine_extracted_summary) heading.append(el('p', '', data.machine_extracted_summary));
      const links = el('div', 'links'); for (const a of [link('Document ↗', data.url, true), link('PDF ↗', data.pdf_url, true), link('City source ↗', data.official_url)]) if (a) links.append(a); heading.append(links);
    }
    section.append(heading); const records = rows(data);
    records.forEach(row => section.append(sourceRow(row)));
    if (!records.length) section.append(el('p', 'status', tool === 'search_records' ? 'No matching pages. Try a broader phrase or fewer filters. No result does not establish that an event did not occur.' : 'No records in this batch.'));
    const next = more(data, tool, input); if (next) { const name = tool; const foot = el('div', 'list-footer'); foot.append(button('Next results →', () => { void call(name, next); })); section.append(foot); }
    content.append(section);
  }
  function render() {
    content.replaceChildren(); notice.replaceChildren(); textElement = scanPage = scanNote = matchLabel = null; scanImage = null; nextMatch = null; scanReady = false;
    if (!data) return;
    if (tool !== 'get_page') { renderCollection(); return; }
    const pageData = data, pageMeta = metadata;
    const layout = el('div', list ? 'layout' : 'layout single');
    if (list) { const rail = el('aside', 'sources'); rail.setAttribute('aria-label', 'Referenced sources'); rail.append(el('div', 'section-label', 'Referenced pages')); rows(list.data).forEach(row => rail.append(sourceRow(row))); const saved = list; rail.append(button('Back to results', () => { data = saved.data; metadata = saved.meta; tool = saved.tool; input = saved.input; render(); })); layout.append(rail); }
    const reader = el('section'); reader.setAttribute('aria-label', 'Selected source page'); sourcePicker(reader);
    const heading = el('div', 'document-heading'); heading.append(el('div', 'eyebrow', pageData.bates || pageData.doc || ''), el('h2', '', pageMeta.title || 'Source page ' + pageData.page)); if (pageMeta.title) heading.append(el('span', 'machine', 'Machine-extracted title')); reader.append(heading);
    const toolbar = el('div', 'toolbar'); const modes = el('div', 'modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Document view');
    for (const [key, label] of [['both', 'Scan + text'], ['scan', 'Scan'], ['text', 'Text']]) { const b = button(label!, () => { view = key!; render(); }); b.setAttribute('aria-pressed', String(view === key)); modes.append(b); }
    const pager = el('div', 'pager');
    const prev = button('←', () => { void call('get_page', { doc: pageData.doc, page: pageData.page! - 1 }); }); prev.setAttribute('aria-label', 'Previous page'); prev.disabled = (pageData.page || 1) <= 1;
    const next = button('→', () => { void call('get_page', { doc: pageData.doc, page: pageData.page! + 1 }); }); next.setAttribute('aria-label', 'Next page'); next.disabled = pageMeta.pageCount != null && (pageData.page || 1) >= pageMeta.pageCount;
    pager.append(prev, el('span', 'mono', String(pageData.page) + (pageMeta.pageCount != null ? ' / ' + pageMeta.pageCount : '')), next); toolbar.append(modes, pager); reader.append(toolbar);
    const findbar = el('div', 'findbar'); const findLabel = el('label', '', 'Find phrase'); const find = el('input'); find.type = 'search'; find.maxLength = 200; find.value = phrase; find.placeholder = 'Exact words on this page'; find.oninput = () => { phrase = find.value; activeMatch = 0; updateMatches(); }; findLabel.append(find);
    const toggleLabel = el('label', '', 'Highlights'); const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = highlights; toggle.onchange = () => { highlights = toggle.checked; updateMatches(); }; toggleLabel.prepend(toggle);
    matchLabel = el('span', 'match-count'); matchLabel.setAttribute('role', 'status'); nextMatch = button('Next match ↓', () => { activeMatch = (activeMatch + 1) % matches.length; updateMatches(); textElement?.querySelector('mark.active')?.scrollIntoView({ block: 'nearest' }); scanPage?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); });
    findbar.append(findLabel, toggleLabel, matchLabel, nextMatch); reader.append(findbar);
    const panes = el('div', 'panes' + (view === 'both' ? '' : ' ' + view + '-only'));
    const scan = el('div', 'scan-pane'); const scanLabel = el('div', 'pane-label', 'DOCUMENT SCAN');
    const zoomControls = el('div', 'zoom-controls'); let zoom = 1;
    const zoomOut = button('−', () => changeZoom(-.5)); zoomOut.setAttribute('aria-label', 'Zoom out'); zoomOut.disabled = true;
    const zoomIn = button('+', () => changeZoom(.5)); zoomIn.setAttribute('aria-label', 'Zoom in');
    const zoomValue = el('span', '', 'Fit');
    function changeZoom(delta: number) { zoom = Math.max(1, Math.min(3, zoom + delta)); if (scanPage) scanPage.style.width = zoom * 100 + '%'; zoomValue.textContent = zoom === 1 ? 'Fit' : Math.round(zoom * 100) + '%'; zoomOut.disabled = zoom === 1; zoomIn.disabled = zoom === 3; }
    zoomControls.append(zoomOut, zoomValue, zoomIn); scanLabel.append(zoomControls); scan.append(scanLabel); const scroll = el('div', 'scan-scroll'); scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Document scan');
    scanPage = el('div', 'scan-page'); const scanUrl = safeUrl(pageData.scan_url, true);
    if (scanUrl) {
      const image = el('img'); scanImage = image; image.alt = 'Original scan, ' + pageData.bates + ', page ' + pageData.page; image.referrerPolicy = 'no-referrer';
      image.onload = () => { if (scanImage !== image) return; scanReady = true; updateMatches(); };
      image.onerror = () => { if (scanImage !== image) return; scanReady = false; scanPage?.replaceChildren(el('p', 'status', 'Scan unavailable. Use the source links below to check the original.')); updateMatches(); };
      image.src = scanUrl; scanPage.append(image);
    } else scanPage.append(el('p', 'status', 'Scan unavailable. Read the text or open the source.'));
    scroll.append(scanPage); scan.append(scroll); scanNote = el('p', 'caveat'); scan.append(scanNote);
    const textPane = el('div', 'text-pane'); textPane.append(el('div', 'pane-label', 'EXTRACTED TEXT')); textElement = el('div', 'ocr'); textElement.tabIndex = 0; textElement.setAttribute('aria-label', 'Machine-extracted page text'); textPane.append(textElement);
    textPane.append(el('p', 'caveat', 'Machine-extracted text may contain errors. Check the scan before quoting.'));
    if ((pageData.offset || 0) > 0 || pageData.next_offset != null) {
      textPane.append(el('p', 'caveat', 'Partial text · characters ' + ((pageData.offset || 0) + 1) + '–' + ((pageData.offset || 0) + (pageData.text?.length || 0)) + ' of ' + pageData.total_chars + '. Highlights cover this excerpt only.'));
      if ((pageData.offset || 0) > 0) textPane.append(button('Start of text', () => { void call('get_page', { doc: pageData.doc, page: pageData.page, offset: 0 }); }));
      if (pageData.next_offset != null) textPane.append(button('Continue text →', () => { void call('get_page', { doc: pageData.doc, page: pageData.page, offset: pageData.next_offset }); }));
    }
    panes.append(scan, textPane); reader.append(panes);
    const foot = el('div', 'reader-footer'); foot.append(el('span', 'mono', (pageData.bates || '') + ' · p. ' + pageData.page)); const links = el('div', 'links');
    for (const a of [link('Open page ↗', pageData.url, true), link('PDF ↗', pageMeta.pdfUrl, true), link('City source ↗', pageData.official_url)]) if (a) links.append(a);
    links.append(button('Copy citation', () => { void copyCitation(pageData); })); foot.append(links); reader.append(foot); layout.append(reader); content.append(layout); updateMatches();
  }
  function occurrences(text: string, needle: string): [number, number][] {
    if (!needle.trim()) return [];
    const result: [number, number][] = []; const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    for (const match of text.matchAll(pattern)) { result.push([match.index, match.index + match[0].length]); if (result.length === 200) break; }
    return result;
  }
  function updateMatches() {
    if (!data || !textElement) return;
    const text = data.text || ''; matches = occurrences(text, phrase); activeMatch = matches.length ? activeMatch % matches.length : 0;
    textElement.replaceChildren(); let offset = 0;
    if (highlights) for (const [i, range] of matches.entries()) { textElement.append(document.createTextNode(text.slice(offset, range[0]))); textElement.append(el('mark', i === activeMatch ? 'active' : '', text.slice(range[0], range[1]))); offset = range[1]; }
    textElement.append(document.createTextNode(text.slice(offset) || (!text ? 'Text unavailable. Missing text does not mean a blank page.' : '')));
    if (matchLabel) matchLabel.textContent = phrase.trim() ? (matches.length ? (activeMatch + 1) + ' of ' + matches.length + (matches.length === 200 ? '+' : '') : 'No matches') : '';
    if (nextMatch) nextMatch.disabled = !highlights || !matches.length;
    scanPage?.querySelectorAll('.scan-highlight').forEach(node => node.remove()); scanMatches = [];
    const boxes = metadata.boxes;
    let aligned = false;
    if (boxes && scanReady && scanImage && !(data.offset || data.next_offset) && matches.length && matches.length < 200) {
      const ratio = scanImage.naturalWidth / scanImage.naturalHeight;
      if (Number.isFinite(ratio) && Math.abs(ratio / (boxes.w / boxes.h) - 1) < .02) {
        let joined = ''; const positions: [number, number][] = [];
        for (const word of boxes.words) { const start = joined.length; joined += word[4]; positions.push([start, joined.length]); joined += ' '; }
        const found = occurrences(joined, phrase);
        // Different occurrence counts are ambiguous: never guess the location.
        if (found.length === matches.length && joined.trim().replace(/\s+/g, ' ').toLowerCase() === text.trim().replace(/\s+/g, ' ').toLowerCase()) {
          scanMatches = found.map(([start, end]) => positions.flatMap(([a, b], i) => b > start && a < end ? [i] : []));
          aligned = scanMatches.every(words => words.length > 0);
          if (aligned && highlights) scanMatches.forEach((words, index) => words.forEach(i => { const word = boxes.words[i]!; const overlay = el('span', 'scan-highlight' + (index === activeMatch ? ' active' : '')); overlay.setAttribute('aria-hidden', 'true'); Object.assign(overlay.style, { left: word[0] / boxes.w * 100 + '%', top: word[1] / boxes.h * 100 + '%', width: (word[2] - word[0]) / boxes.w * 100 + '%', height: (word[3] - word[1]) / boxes.h * 100 + '%' }); scanPage?.append(overlay); }));
        }
      }
    }
    if (scanNote) scanNote.textContent = !phrase.trim() ? 'Find an exact phrase to highlight its wording.' : !highlights ? 'Highlights off.' : aligned ? 'Matching words located using machine-extracted coordinates. Verify against the scan.' : 'Scan highlight unavailable. Text matches are shown where available.';
  }
  async function copyCitation(page: Data) {
    const url = safeUrl(page.short_url, true) || safeUrl(page.url, true) || '';
    const text = (page.bates || page.doc || '') + ' · p. ' + page.page + '\n' + url;
    try { await navigator.clipboard.writeText(text); notice.textContent = 'Citation copied.'; }
    catch { notice.replaceChildren(el('span', '', 'Copy this citation:')); const area = el('textarea', 'copy-fallback'); area.readOnly = true; area.value = text; area.setAttribute('aria-label', 'Citation to copy'); notice.append(area); area.focus(); area.select(); }
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || disposed) return;
    const msg = event.data; if (!msg || msg.jsonrpc !== '2.0') return;
    if (parentOrigin !== '*' && event.origin !== parentOrigin) return;
    if (msg.id !== undefined && pending.has(msg.id)) {
      const p = pending.get(msg.id)!; pending.delete(msg.id); clearTimeout(p.timer);
      if (event.origin && event.origin !== 'null') parentOrigin = event.origin;
      if (msg.error) p.reject(new Error('The host could not complete this request.')); else p.resolve(msg.result); return;
    }
    if (msg.method === 'ui/notifications/tool-input') { ++epoch; hostInput = msg.params?.arguments || {}; list = null; status('Opening record…', 'Loading the selected source.'); content.setAttribute('aria-busy', 'true'); }
    if (msg.method === 'ui/notifications/tool-result') { ++epoch; list = null; accept(msg.params || {}); }
    if (msg.method === 'ui/notifications/tool-cancelled') { ++epoch; list = null; status('Request cancelled', 'Select a source or try the tool again.'); }
    if (msg.method === 'ui/notifications/host-context-changed') setContext(msg.params || {});
    if (msg.method === 'ui/resource-teardown') { disposed = true; ++epoch; pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('Reader closed.')); }); pending.clear(); observer.disconnect(); cancelAnimationFrame(resizeFrame); clearReader(); window.parent.postMessage({ jsonrpc: '2.0', id: msg.id, result: {} }, parentOrigin); }
  });
  // Compatibility for hosts still delivering tool results through window.openai.
  function legacyResult(globals: OpenAI) {
    setContext(globals);
    if (!bridgeReady && 'toolOutput' in globals && !globals.toolOutput) { ++epoch; list = null; status('Record unavailable', 'No record was returned. Try the tool again.'); }
    if (!bridgeReady && globals.toolOutput) { ++epoch; list = null; accept({ structuredContent: globals.toolOutput, _meta: globals.toolResponseMetadata || win.openai?.toolResponseMetadata }, undefined, globals.toolInput || win.openai?.toolInput); }
  }
  window.addEventListener('openai:set_globals', event => legacyResult((event as CustomEvent<{ globals: OpenAI }>).detail?.globals || {}));
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => {
      if (disposed) return; const height = Math.ceil(document.getElementById('reader')!.getBoundingClientRect().height);
      if (height === lastHeight) return; lastHeight = height;
      if (bridgeReady) notify('ui/notifications/size-changed', { height }); else win.openai?.notifyIntrinsicHeight?.(height);
    });
  });
  observer.observe(document.getElementById('reader')!);
  if (win.openai) legacyResult(win.openai);
  void request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: '911records-reader', version: '1.0.0' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } }, 5000)
    .then(value => { if (disposed) return; bridgeReady = true; const initialized = value as { hostContext?: HostContext }; setContext(initialized.hostContext || {}); notify('ui/notifications/initialized', {}); notify('ui/notifications/size-changed', { height: document.getElementById('reader')!.getBoundingClientRect().height }); })
    .catch(() => { if (!win.openai?.callTool && !data && !disposed) status('Connect to read records', 'Open this reader through the 9/11 City Records MCP app.'); });
})();
