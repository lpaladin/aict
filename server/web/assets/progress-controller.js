/* Browser-owned native progress/interaction bridge. No APK update required. */
(() => {
  let active = false, owner, path, ready, beat, flushTimer, revision = 0, step = '', started;
  let statusUrl = null;
  let sessionName = '当前会话', interaction = null, responseHandler = null, sourcePromise;
  let chain = Promise.resolve(), unsubscribe, responding = null;
  const warn = error => console.warn('Codex 悬浮窗', error);
  function send(done = !active) {
    if (!path) return Promise.resolve();
    const destination = path;
    const text = JSON.stringify({owner, step, sessionName, started, updated: Date.now(), done, revision, interaction, statusUrl});
    chain = chain.then(async () => {
      // Final state must survive a brief native bridge interruption.
      for (let attempt = 0; ; attempt++) {
        try { return await phone.call('file.write', {path: destination, text}); }
        catch (error) {
          if (!done || attempt >= 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }).catch(warn);
    return chain;
  }
  function normalize(req, title) {
    const p = req.params || {};
    const base = {id: String(req.id), threadId: p.threadId, sessionName: title || sessionName,
      title: 'Codex 需要你的确认', description: String(p.reason || p.command || p.message || '').slice(0, 1000)};
    if (req.method === 'item/tool/requestUserInput') {
      return {...base, kind: 'input', title: 'Codex 需要你的回答', questions: (p.questions || []).map(q => ({
        id: q.id, question: q.question, isSecret: !!q.isSecret,
        options: (q.options || []).map(o => ({label: o.label, description: o.description || ''}))}))};
    }
    if (/^item\/(commandExecution|fileChange)\/requestApproval$/.test(req.method)) {
      const available = p.availableDecisions || ['accept', 'decline'];
      return {...base, kind: 'approval', allowAccept: available.includes('accept'), allowDecline: available.includes('decline')};
    }
    return {...base, kind: 'open', title: '有一个请求需要你处理'};
  }
  async function ensure() {
    if (ready) return ready;
    active = true; path = null; started = Date.now(); owner = crypto.randomUUID();
    const thisOwner = owner;
    ready = (async () => {
      const caps = await phone.capabilities();
      if (!active || owner !== thisOwner) return;
      path = caps.paths.files + '/codex-progress-' + thisOwner + '.json';
      await send();
      if (!sourcePromise) sourcePromise = fetch('/assets/progress-overlay.js?v=20261121-style-1', {cache: 'no-store'}).then(r => { if (!r.ok) throw Error('无法加载悬浮窗脚本'); return r.text(); }).catch(e => { sourcePromise = null; throw e; });
      unsubscribe = phone.on('codex.interaction', async data => {
        if (!active || data.owner !== owner) return;
        if (data.type === 'warning') { warn(data.message); window.dispatchEvent(new CustomEvent('aict-notice-warning', {detail: data})); return; }
        if (data.type !== 'response' || !interaction || String(data.requestId) !== interaction.id || !responseHandler) return;
        const requestId = interaction.id, handler = responseHandler, token = owner + ':' + interaction.id;
        if (responding === token) return;
        responding = token;
        try {
          await handler(data.result);
          // A new queued question may already have replaced this one.
          if (interaction?.id === requestId) { interaction = null; responseHandler = null; revision++; send(); }
        } catch (error) { if (interaction?.id === requestId) { revision++; send(); } warn(error); } finally { if (responding === token) responding = null; }
      });
      const source = await sourcePromise;
      if (!active || owner !== thisOwner) return;
      await phone.start(source, {path, owner: thisOwner, overlay: !!caps.overlay});
      if (!active || owner !== thisOwner) return;
      beat = setInterval(() => send(), 15000);
    })().catch(error => { ready = null; warn(error); });
    return ready;
  }
  window.AICTProgress = {
    watch(url) { statusUrl = url || null; if (active) send(); },
    title(name) { sessionName = String(name || '当前会话'); if (active) send(); },
    start() { if (!active) step = '正在处理请求…'; return ensure(); },
    update(text) { if (!active) return; step = String(text).replace(/\s+/g, ' ').slice(0, 140); clearTimeout(flushTimer); flushTimer = setTimeout(() => send(), 180); },
    request(req, respond, title) {
      responseHandler = respond;
      if (!req) { if (interaction) { interaction = null; revision++; if (active) send(); } return; }
      const next = normalize(req, title);
      // Do not destroy an in-progress native answer on unrelated server events.
      const changed = !interaction || JSON.stringify(interaction) !== JSON.stringify(next);
      interaction = next; if (changed) revision++;
      const request = next;
      ensure().then(() => { if (active && interaction === request && changed) send(); });
    },
    finish(text) {
      if (!active) return;
      active = false; clearInterval(beat); clearTimeout(flushTimer);
      interaction = null; responseHandler = null; revision++; step = text || '已完成';
      send(true); if (unsubscribe) unsubscribe(); unsubscribe = null; ready = null;
    },
  };
  window.addEventListener('pagehide', () => AICTProgress.finish('页面已关闭 · 进度同步停止'));
})();
