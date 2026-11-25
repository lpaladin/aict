/* Browser-owned native progress/interaction bridge. */
(() => {
  let current, sourcePromise, rows = [], handlers = new Map();
  const responding = new Set();
  let fullAccessEnabled = false;
  const warn = error => console.warn('Codex 悬浮窗', error);

  function send(run, done = false, step = '') {
    if (!run.path) return Promise.resolve();
    const text = JSON.stringify({owner: run.owner, updated: Date.now(), done, step, entries: done ? [] : rows});
    run.chain = run.chain.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await phone.call('file.write', {path: run.path, text}); }
        catch (error) {
          if (!done || attempt >= 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }).catch(warn);
    return run.chain;
  }

  function normalize(req, sessionName, canSwitchMode) {
    const p = req.params || {};
    const base = {id: String(req.id), sessionName, title: 'Codex 需要你的确认',
      description: String(p.reason || p.command || p.message || '').slice(0, 1000)};
    if (req.method === 'item/tool/requestUserInput') {
      return {...base, kind: 'input', title: 'Codex 需要你的回答', questions: (p.questions || []).map(q => ({
        id: q.id, header: q.header, question: q.question, isOther: !!q.isOther, isSecret: !!q.isSecret,
        options: (q.options || []).map(o => ({label: o.label, description: o.description || ''}))}))};
    }
    if (/^item\/(commandExecution|fileChange)\/requestApproval$/.test(req.method)) {
      const available = p.availableDecisions || ['accept', 'decline'];
      return {...base, kind: 'approval', canSwitchMode, fullAccessEnabled, allowAccept: available.includes('accept'), allowDecline: available.includes('decline')};
    }
    return {...base, kind: 'open', title: '有一个请求需要你处理'};
  }

  function ensure() {
    if (current) return;
    const run = {owner: crypto.randomUUID(), chain: Promise.resolve()};
    current = run;
    (async () => {
      const caps = await phone.capabilities();
      if (current !== run) return;
      run.path = caps.paths.files + '/codex-progress-' + run.owner + '.json';
      await send(run);
      if (current !== run) return;
      sourcePromise ||= fetch('/assets/progress-overlay.js?v=20261125-user-input', {cache: 'no-store'})
        .then(r => { if (!r.ok) throw Error('无法加载悬浮窗脚本'); return r.text(); })
        .catch(error => { sourcePromise = null; throw error; });
      const source = await sourcePromise;
      if (current !== run) return;
      run.unsubscribe = phone.on('codex.interaction', async data => {
        if (current !== run || data.owner !== run.owner) return;
        if (data.type === 'warning') { warn(data.message); window.dispatchEvent(new CustomEvent('aict-notice-warning', {detail: data})); return; }
        const entry = rows.find(row => row.id === data.threadId);
        if (data.type === 'open-thread') {
          if (entry?.id) window.dispatchEvent(new CustomEvent('aict-open-thread', {detail: {threadId: entry.id}}));
          return;
        }
        const handler = handlers.get(data.threadId);
        if (!handler || entry?.interaction?.id !== String(data.requestId)) return;
        if (data.type === 'switch-execution-mode') {
          try { await handler.switchMode?.(); }
          catch (error) {
            warn(error);
            entry.revision++;
            send(run);
          }
          return;
        }
        const token = run.owner + ':' + entry.interaction.id;
        if (data.type !== 'response' || responding.has(token)) return;
        responding.add(token);
        try { await handler.respond(data.result); }
        catch (error) {
          if (current === run) {
            const latest = rows.find(row => row.id === entry.id);
            if (latest?.interaction?.id === entry.interaction.id) { latest.revision++; send(run); }
          }
          warn(error);
        } finally { responding.delete(token); }
      });
      await phone.start(source, {path: run.path, owner: run.owner, overlay: !!caps.overlay});
      if (current === run) run.beat = setInterval(() => { if (current === run) send(run); }, 15000);
    })().catch(error => {
      run.unsubscribe?.();
      if (current === run) current = null;
      warn(error);
    });
  }

  window.AICTProgress = {
    executionMode(enabled) {
      fullAccessEnabled = enabled;
      let changed = false;
      for (const row of rows) {
        if (row.interaction?.kind !== 'approval' || row.interaction.fullAccessEnabled === enabled) continue;
        row.interaction = {...row.interaction, fullAccessEnabled: enabled};
        row.revision++;
        changed = true;
      }
      if (changed && current) send(current);
    },
    sync(entries, completion) {
      const previous = new Map(rows.map(row => [row.id, row]));
      handlers = new Map();
      const next = entries.map(({id, turnId, sessionName, statusUrl, request}) => {
        const old = previous.get(id);
        const sameTurn = old && old.turnId === turnId;
        const interaction = request ? normalize(request.req, sessionName, Boolean(request.switchMode)) : null;
        if (request) handlers.set(id, request);
        const changed = !sameTurn || JSON.stringify(old.interaction) !== JSON.stringify(interaction);
        return {id, turnId, sessionName, statusUrl, interaction,
          revision: (old?.revision || 0) + Number(changed),
          started: sameTurn ? old.started : Date.now(), step: sameTurn ? old.step : '正在处理请求…'};
      });
      const changed = JSON.stringify(rows) !== JSON.stringify(next);
      rows = next;
      if (!rows.length) { this.finish(completion); return; }
      if (!current) ensure();
      else if (changed) send(current);
    },
    update(id, text) {
      const entry = rows.find(row => row.id === id);
      if (!entry || !current) return;
      entry.step = String(text).replace(/\s+/g, ' ').slice(0, 140);
      const run = current;
      if (run.flush) return;
      run.flush = setTimeout(() => {
        run.flush = null;
        if (current === run) send(run);
      }, 180);
    },
    finish(step = '已完成') {
      rows = [];
      handlers.clear();
      if (!current) return;
      const run = current;
      current = null;
      clearInterval(run.beat);
      clearTimeout(run.flush);
      run.unsubscribe?.();
      send(run, true, step);
    },
  };
  window.addEventListener('pagehide', () => AICTProgress.finish('页面已关闭 · 进度同步停止'));
})();
