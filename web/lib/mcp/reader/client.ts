/** Self-contained evidence panel. Rebuild with node scripts/build-mcp-reader.mjs. */
(() => {
  type Args = Record<string, unknown>;
  type Data = { doc?: string; page?: number; bates?: string; text?: string; offset?: number; next_offset?: number | null; total_chars?: number; url?: string; short_url?: string; scan_url?: string | null; official_url?: string | null; agency?: string | null; machine_extracted_title?: string | null; machine_extracted_summary?: string | null; pages?: { page: number }[]; hits?: { doc: string; page: number; machine_extracted_title?: string; url?: string }[]; documents?: { doc: string; url?: string }[]; changes?: { doc: string; kind: string; url?: string }[] };
  type Boxes = { w: number; h: number; words: [number, number, number, number, string][] };
  type Brief = { doc: string; page: number; label?: string; claim?: string; explanation?: string; limitation?: string; quote?: string; source?: Result };
  type Meta = { tool?: string; input?: Args; pageCount?: number | null; title?: string | null; summary?: string | null; agency?: string | null; boxes?: Boxes | null; evidence?: Brief[] };
  type Result = { structuredContent?: Data; _meta?: { reader?: Meta }; isError?: boolean; content?: { type: string; text?: string }[] };
  type Context = { theme?: string; displayMode?: string };
  type OpenAI = Context & { toolOutput?: Data; toolResponseMetadata?: { reader?: Meta }; toolInput?: Args; callTool?: (name: string, args: Args) => Promise<Result>; openExternal?: (args: { href: string; redirectUrl: boolean }) => void; notifyIntrinsicHeight?: (height: number) => void };
  const win = window as Window & { openai?: OpenAI };
  const content = document.getElementById('content')!, notice = document.getElementById('notice')!;
  const collapse = document.getElementById('collapse') as HTMLButtonElement;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let rpcId = 0, epoch = 0, bridgeReady = false, parentOrigin = '*', disposed = false, resizeFrame = 0, lastHeight = 0;
  let data: Data | null = null, meta: Meta = {}, evidence: Brief[] = [], selected = 0, highlights = true;
  let lastRequest: { name: string; args: Args } | null = null;
  let image: HTMLImageElement | null = null, scanPage: HTMLElement | null = null, scanCaption: HTMLElement | null = null;
  let dialog: HTMLDialogElement | null = null;
  const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] { const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function button(label: string, fn: () => void, cls = '') { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; }
  function safeUrl(value: unknown): string | null { if (typeof value !== 'string') return null; try { const u = new URL(value); return u.origin === 'https://911records.nyc' && !u.username && !u.password ? u.href : null; } catch { return null; } }
  function link(label: string, value: unknown, cls = '') { const href = safeUrl(value); if (!href) return null; const a = el('a', cls, label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  function notify(method: string, params: unknown) { if (window.parent !== window) window.parent.postMessage({ jsonrpc: '2.0', method, params }, parentOrigin); }
  function request(method: string, params: unknown, timeout = 30000): Promise<unknown> { return new Promise((resolve, reject) => {
    if (window.parent === window || disposed) { reject(new Error('Open this reader in a connected MCP app.')); return; }
    const id = ++rpcId; const timer = setTimeout(() => { pending.delete(id); reject(new Error('The host did not respond. Please retry.')); }, timeout);
    pending.set(id, { resolve, reject, timer }); window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, parentOrigin);
  }); }
  document.addEventListener('click', e => { const a = (e.target as Element).closest('a'); if (!a) return; const href = safeUrl(a.href); if (!href) { e.preventDefault(); return; }
    if (bridgeReady) { e.preventDefault(); void request('ui/open-link', { url: href }).catch(() => { notice.textContent = 'The host could not open this link. Use the link menu to open it in your browser.'; }); }
    else if (win.openai?.openExternal) { e.preventDefault(); win.openai.openExternal({ href, redirectUrl: false }); }
  });
  function setContext(c: Context) { if (c.theme === 'light' || c.theme === 'dark') document.documentElement.dataset.theme = c.theme; }
  collapse.onclick = () => { content.hidden = !content.hidden; collapse.setAttribute('aria-expanded', String(!content.hidden)); collapse.textContent = content.hidden ? 'Show evidence +' : 'Hide preview −'; };
  function clearView() { dialog?.close(); dialog?.remove(); dialog = null; image = null; scanPage = scanCaption = null; content.replaceChildren(); notice.replaceChildren(); }
  function status(title: string, detail: string, retry = false) { clearView(); data = null; meta = {}; const box = el('section', 'status'); box.setAttribute('role', 'status'); box.append(el('h2', '', title), el('p', '', detail)); if (retry && lastRequest) box.append(button('Retry', () => { if (lastRequest) void call(lastRequest.name, lastRequest.args); })); content.append(box); content.setAttribute('aria-busy', 'false'); }
  function accept(result: Result, fresh = false) {
    if (fresh) { evidence = []; selected = 0; highlights = true; lastRequest = null; }
    content.setAttribute('aria-busy', 'false');
    if (result.isError || !result.structuredContent) { evidence = []; const message = result.content?.filter(c => c.type === 'text').map(c => c.text || '').join(' ') || 'No record was returned.'; status('Record unavailable', message, !/removed|does not exist/i.test(message)); return; }
    data = result.structuredContent; meta = result._meta?.reader || {};
    if (meta.evidence?.length) {
      evidence = meta.evidence; selected = 0;
      const source = evidence[0]?.source;
      if (source?.structuredContent && !source.isError) { data = source.structuredContent; meta = source._meta?.reader || {}; }
    }
    render();
    // Older connections may return a document without the enriched evidence payload.
    if (data?.pages?.length && (bridgeReady || win.openai?.callTool)) void call('get_page', { doc: data.doc, page: data.pages[0]!.page });
  }
  async function call(name: string, args: Args) {
    const generation = ++epoch; lastRequest = { name, args }; status('Opening evidence…', 'Loading the selected source page.'); content.setAttribute('aria-busy', 'true');
    try {
      const result = bridgeReady ? await request('tools/call', { name, arguments: args }) as Result : win.openai?.callTool ? await win.openai.callTool(name, args) : (() => { throw new Error('Open this reader in a connected MCP app.'); })();
      if (generation !== epoch || disposed) return; accept(result);
    } catch (e) { if (generation !== epoch || disposed) return; evidence = []; status('Unable to open evidence', e instanceof Error ? e.message : 'Please retry.', true); }
  }
  function currentBrief() { const b = evidence[selected]; return b && b.doc === data?.doc && b.page === data?.page ? b : undefined; }
  function verifiedQuote() { const q = currentBrief()?.quote; return q && data?.text && normalize(data.text).includes(normalize(q)) ? q : null; }
  function render() {
    clearView(); if (!data) return;
    if (typeof data.text !== 'string') {
      const box = el('section', 'status'); box.append(el('h2', '', data.machine_extracted_title || 'Records'));
      if (data.pages?.length) box.append(el('p', '', 'Opening the cited page…'));
      else { box.append(el('p', '', 'Open a record on the site to explore the source.')); const rows = data.hits || data.documents || data.changes || []; for (const row of rows) { if ('kind' in row && row.kind === 'removed') continue; const a = link(row.doc, row.url); if (a) box.append(a, el('br')); } }
      const a = link('Open full record ↗', data.url, 'primary'); if (a) box.append(a); content.append(box); return;
    }
    const page = data, brief = currentBrief();
    // When a source changes, never retain a claim tied to a quotation that no longer matches.
    const interpretation = brief?.claim && (!brief.quote || verifiedQuote()) ? brief : undefined;
    if (evidence.length > 1) { const nav = el('nav', 'sources'); nav.setAttribute('aria-label', 'Cited pages'); evidence.forEach((s, i) => { const b = button((i + 1) + '  ' + (s.label || 'Page ' + s.page), () => { selected = i; void call('get_page', { doc: s.doc, page: s.page, max_chars: 20000 }); }); b.setAttribute('aria-pressed', String(i === selected)); nav.append(b); }); content.append(nav); }
    const body = el('div', 'evidence-body'), meaning = el('section', 'meaning'); meaning.setAttribute('aria-label', 'Source interpretation');
    meaning.append(el('div', 'eyebrow', interpretation ? 'WHY THIS PAGE MATTERS' : 'DOCUMENT SUMMARY'));
    meaning.append(el('h2', '', interpretation?.claim || meta.title || 'Source page ' + page.page));
    meaning.append(el('p', 'explanation', interpretation?.explanation || meta.summary || 'No summary is available for this document yet. Open the full record to explore the source.'));
    if (interpretation?.limitation) { const limit = el('div', 'limit'); limit.append(el('strong', '', 'What this doesn’t establish'), el('p', '', interpretation.limitation)); meaning.append(limit); }
    const quote = verifiedQuote();
    if (quote) { const details = el('details'); details.append(el('summary', '', 'Check the wording'), el('blockquote', '', quote), el('p', 'small', 'Machine-extracted wording · Check the scan for context.')); meaning.append(details); }
    const open = link('Open full record ↗', page.url, 'primary'); if (open) meaning.append(open);
    meaning.append(el('p', 'small attribution', interpretation ? 'AI interpretation · Verify against the source' : 'Machine-generated document summary · May describe other pages'));
    const scan = el('section', 'scan'); scan.setAttribute('aria-label', 'Original document scan');
    const bar = el('div', 'scan-bar'); const pageLabel = 'Original scan · page ' + page.page + (meta.pageCount ? ' of ' + meta.pageCount : ''); bar.append(el('span', '', pageLabel));
    const enlarge = button('Enlarge ↗', () => showScan(pageLabel)); bar.append(enlarge); scan.append(bar);
    scanPage = el('div', 'scan-page'); const url = safeUrl(page.scan_url);
    const missing = () => { enlarge.disabled = true; image = null; scanPage?.replaceChildren(el('strong', '', 'Scan unavailable'), el('p', '', 'Open the full record to check the original page.')); scanPage?.classList.add('scan-missing'); if (scanCaption) scanCaption.textContent = ''; };
    if (url) { const img = el('img'); image = img; img.alt = 'Original scan, ' + page.bates + ', page ' + page.page; img.referrerPolicy = 'no-referrer'; img.onload = () => { if (image === img) highlightScan(); }; img.onerror = () => { if (image === img) missing(); }; const b = button('', () => showScan(pageLabel), 'scan-button'); b.setAttribute('aria-label', 'Enlarge original document scan'); b.append(img); scanPage.append(b); img.src = url; } else missing();
    scan.append(scanPage);
    const stamp = el('div', 'scan-caption'); stamp.append(el('span', 'mono', page.bates || page.doc || ''));
    if (quote) { const toggle = button(highlights ? 'Highlight on' : 'Highlight off', () => { highlights = !highlights; toggle.textContent = highlights ? 'Highlight on' : 'Highlight off'; toggle.setAttribute('aria-pressed', String(highlights)); highlightScan(); }); toggle.setAttribute('aria-pressed', String(highlights)); stamp.append(toggle); }
    scan.append(stamp); scanCaption = el('p', 'highlight-note'); scan.append(scanCaption); body.append(meaning, scan); content.append(body);
    const foot = el('footer'); foot.append(el('span', '', meta.agency || 'Independent public records mirror'), button('Copy citation', () => { void copyCitation(page); })); content.append(foot);
  }
  function highlightScan() {
    scanPage?.querySelectorAll('.scan-highlight').forEach(n => n.remove()); if (scanCaption) scanCaption.textContent = '';
    const quote = verifiedQuote(); if (!quote || !highlights || !image?.naturalWidth || !scanPage) return;
    const boxes = meta.boxes; let aligned = false;
    if (boxes && boxes.w > 0 && boxes.h > 0 && !(data?.offset) && data?.next_offset == null && Math.abs(image.naturalWidth / image.naturalHeight / (boxes.w / boxes.h) - 1) < .03) {
      const text = boxes.words.map(w => w[4]).join(' '), normalized = normalize(text), phrase = normalize(quote);
      if (normalized === normalize(data?.text || '')) {
        // Build offsets in the same normalized string used for matching; skip
        // uncertain mappings rather than drawing a plausible but incorrect box.
        const tokens = boxes.words.map(w => normalize(w[4]));
        if (tokens.join(' ') === normalized) {
          let start = 0, count = 0;
          while ((start = normalized.indexOf(phrase, start)) >= 0 && count++ < 20) {
            let cursor = 0;
            for (let i = 0; i < tokens.length; i++) { const end = cursor + tokens[i]!.length; if (end > start && cursor < start + phrase.length) { const w = boxes.words[i]!; const mark = el('span', 'scan-highlight'); mark.style.left = 100 * w[0] / boxes.w + '%'; mark.style.top = 100 * w[1] / boxes.h + '%'; mark.style.width = 100 * (w[2] - w[0]) / boxes.w + '%'; mark.style.height = 100 * (w[3] - w[1]) / boxes.h + '%'; scanPage.append(mark); aligned = true; } cursor = end + 1; }
            start += phrase.length;
          }
        }
      }
    }
    if (scanCaption) scanCaption.textContent = aligned ? 'Quoted wording highlighted · Check the scan' : 'Exact scan highlight unavailable · Use “Check the wording”';
  }
  function showScan(label: string) {
    if (!image || !data) return; dialog?.remove(); dialog = el('dialog', 'scan-dialog');
    const head = el('header'); head.append(el('strong', '', label), button('Close ×', () => dialog?.close()));
    const img = el('img'); img.src = image.src; img.alt = image.alt;
    dialog.append(head, img); const a = link('Open full record ↗', data.url); if (a) dialog.append(a); document.getElementById('reader')!.append(dialog); dialog.showModal();
  }
  async function copyCitation(page: Data) { const url = safeUrl(page.short_url) || safeUrl(page.url); if (!url) return; const text = (page.bates || page.doc) + ' · page ' + page.page + '\n' + url;
    try { await navigator.clipboard.writeText(text); notice.textContent = 'Citation copied.'; } catch { const area = el('textarea', 'copy-fallback'); area.readOnly = true; area.value = text; area.setAttribute('aria-label', 'Citation to copy'); notice.replaceChildren(el('span', '', 'Copy this citation:'), area); area.focus(); area.select(); }
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return; const msg = event.data; if (!msg || msg.jsonrpc !== '2.0') return; if (parentOrigin !== '*' && event.origin !== parentOrigin) return;
    if (msg.id !== undefined && pending.has(msg.id)) { const p = pending.get(msg.id)!; pending.delete(msg.id); clearTimeout(p.timer); if (event.origin && event.origin !== 'null') parentOrigin = event.origin; if (msg.error) p.reject(new Error('The host could not complete this request.')); else p.resolve(msg.result); return; }
    if (msg.method === 'ui/notifications/tool-input') { ++epoch; evidence = []; lastRequest = null; status('Opening evidence…', 'Loading source pages.'); content.setAttribute('aria-busy', 'true'); }
    if (msg.method === 'ui/notifications/tool-result') { ++epoch; accept(msg.params || {}, true); }
    if (msg.method === 'ui/notifications/tool-cancelled') { ++epoch; evidence = []; lastRequest = null; status('Request cancelled', 'Ask to open the record again when you are ready.'); }
    if (msg.method === 'ui/notifications/host-context-changed') setContext(msg.params || {});
    if (msg.method === 'ui/resource-teardown') { disposed = true; ++epoch; pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('Reader closed.')); }); pending.clear(); observer.disconnect(); cancelAnimationFrame(resizeFrame); evidence = []; clearView(); window.parent.postMessage({ jsonrpc: '2.0', id: msg.id, result: {} }, parentOrigin); }
  });
  function legacyResult(globals: OpenAI) { setContext(globals); if (!bridgeReady && 'toolOutput' in globals) { ++epoch; accept({ structuredContent: globals.toolOutput, _meta: globals.toolResponseMetadata || win.openai?.toolResponseMetadata }, true); } }
  window.addEventListener('openai:set_globals', e => legacyResult((e as CustomEvent<{ globals: OpenAI }>).detail?.globals || {}));
  const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (disposed) return; const height = Math.ceil(document.getElementById('reader')!.getBoundingClientRect().height); if (height === lastHeight) return; lastHeight = height; if (bridgeReady) notify('ui/notifications/size-changed', { height }); else win.openai?.notifyIntrinsicHeight?.(height); }); });
  observer.observe(document.getElementById('reader')!); if (win.openai) legacyResult(win.openai);
  void request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: '911records-reader', version: '1.2.0' }, appCapabilities: {} }, 5000)
    .then(value => { if (disposed) return; bridgeReady = true; setContext((value as { hostContext?: Context }).hostContext || {}); notify('ui/notifications/initialized', {}); if (data?.pages?.length) void call('get_page', { doc: data.doc, page: data.pages[0]!.page }); })
    .catch(() => { if (!win.openai?.callTool && !data && !disposed) status('Connect to read records', 'Open this reader through the 9/11 City Records app.'); });
})();
