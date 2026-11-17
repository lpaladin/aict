/* Mobile app-server client. Text is rendered as text; generated pages open explicitly. */
(() => {
  const $ = id => document.getElementById(id);
  let socket, session, thread, turn, serial = 0, connecting = false, requestQueue = [];
  const pending = new Map(), items = new Map();
  const stream = $('messages');
  const emptyTemplate = $('empty').cloneNode(true);
  let followLatest = true, scrollFrame = null, pendingUpdate = false, submitting = false;
  const nearBottom = () => stream.scrollHeight - stream.clientHeight - stream.scrollTop < 72;
  const status = (text, state = turn ? 'working' : 'ready') => {
    $('status').textContent = text; $('status').title = text; document.body.dataset.state = state;
    $('composer-hint').textContent = state === 'working' ? '正在处理 · 可继续补充指令' : '图片与文件可直接添加';
  };
  function syncJump() {
    $('jump-latest').hidden = followLatest;
    $('jump-label').textContent = pendingUpdate ? '有新内容 · 回到最新' : '回到最新';
  }
  function scrollLatest(force = false) {
    if ($('empty')) { stream.scrollTop = 0; return; }
    if (force) { followLatest = true; pendingUpdate = false; }
    if (!followLatest) { pendingUpdate = true; syncJump(); return; }
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (followLatest) { stream.scrollTop = stream.scrollHeight; pendingUpdate = false; }
      syncJump();
    });
  }
  stream.addEventListener('scroll', () => {
    followLatest = nearBottom();
    if (followLatest) pendingUpdate = false;
    syncJump();
  }, {passive: true});
  $('jump-latest').onclick = () => scrollLatest(true);
  stream.addEventListener('load', event => { if (event.target.tagName === 'IMG' && followLatest) scrollLatest(); }, true);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (followLatest) scrollLatest(); }).observe(stream);
  function rpc(method, params = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(Error('连接已断开，请重连'));
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Codex 请求超时；操作可能仍在进行')); }, 100000);
      pending.set(id, {resolve, reject, timer});
      socket.send(JSON.stringify({id, method, params}));
    });
  }
  function fail(error) { status(String(error.message || error), 'error'); }
  function links(node, text) {
    node.replaceChildren();
    const re = /\[([^\]]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s<>]+|\/artifacts\/[^\s<>]+)/g;
    let last = 0;
    for (const match of text.matchAll(re)) {
      node.append(document.createTextNode(text.slice(last, match.index)));
      const raw = match[2] || match[3];
      if (/^(https?:\/\/|\/artifacts\/)/i.test(raw)) {
        const a = document.createElement('a'); a.textContent = match[1] || raw;
        a.href = raw; a.target = '_blank'; a.rel = 'noopener'; node.append(a);
      } else node.append(document.createTextNode(match[0]));
      last = match.index + match[0].length;
    }
    node.append(document.createTextNode(text.slice(last)));
  }
  function markdown(node, text) {
    if (window.AICTMarkdown) node.innerHTML = AICTMarkdown.render(text);
    else node.textContent = text; // Fail safely if an asset is unavailable.
  }
  function resetMessages() {
    items.clear(); stream.replaceChildren(); followLatest = true; pendingUpdate = false; syncJump();
  }
  function welcome() {
    if (!stream.childNodes.length) { stream.append(emptyTemplate.cloneNode(true)); }
  }
  function message(id, label, text, role = '') {
    $('empty')?.remove();
    let entry = items.get(id);
    if (!entry) {
      const article = document.createElement('article'); article.className = role;
      const small = document.createElement('small'); small.textContent = label;
      const body = document.createElement('div'); body.className = 'message-body'; article.append(small, body); stream.append(article);
      entry = {article, body, text: ''}; items.set(id, entry);
    }
    entry.text = text; role === 'user' ? links(entry.body, text) : markdown(entry.body, text);
    scrollLatest();
    return entry;
  }
  function renderItem(item) {
    if (item.type === 'agentMessage') message(item.id, 'Codex', item.text || '');
    else if (item.type === 'userMessage') message(item.id, '你', (item.content || []).map(c => c.text || (c.type === 'image' ? '[图片]' : '')).join('\n'), 'user');
    else {
      $('empty')?.remove();
      const id = 'tool-' + item.id;
      let detail = document.getElementById(id);
      if (!detail) {
        detail = document.createElement('details'); detail.id = id; detail.className = 'tool-card';
        const summary = document.createElement('summary');
        for (const cls of ['tool-icon', 'tool-name', 'tool-status', 'tool-chevron']) { const span = document.createElement('span'); span.className = cls; summary.append(span); }
        detail.append(summary, document.createElement('pre')); stream.append(detail);
        detail.addEventListener('toggle', () => { if (followLatest) scrollLatest(); });
      }
      const failed = item.success === false || ['failed', 'declined', 'error'].includes(item.status) || (item.exitCode != null && item.exitCode !== 0);
      const busy = ['inProgress', 'running'].includes(item.status);
      detail.dataset.status = failed ? 'error' : busy ? 'working' : 'completed';
      const labels = {commandExecution: '运行命令', fileChange: '更新文件', dynamicToolCall: '调用工具', mcpToolCall: '调用服务', reasoning: '思考中', webSearch: '搜索网页', imageView: '查看图片', plan: '更新计划', contextCompaction: '整理上下文'};
      const name = item.type === 'dynamicToolCall' && item.tool === 'phone_call' ? (item.arguments?.method?.startsWith('transfer.') ? '传输文件' : '操作手机') : labels[item.type] || item.type;
      const extra = item.arguments?.method || item.tool || (item.type === 'commandExecution' ? item.command?.split('\n')[0] : '');
      detail.querySelector('.tool-icon').textContent = failed ? '!' : busy ? '·' : '✓';
      detail.querySelector('.tool-name').textContent = name + (extra ? ' · ' + extra : '');
      detail.querySelector('.tool-status').textContent = item.phase ? (item.phase === 'verifying' ? '校验中' : item.phase === 'completed' ? '已传输' : item.phase === 'failed' ? '失败' : '传输中') + ' · ' + Math.ceil((item.transferredBytes || 0) / 1024) + ' KB' : failed ? '失败' : busy ? '进行中' : '完成';
      detail.querySelector('.tool-chevron').textContent = '›';
      // No raw transfer payloads in the visible transcript.
      detail.lastChild.textContent = item.type === 'commandExecution' ? [item.command, item.aggregatedOutput].filter(Boolean).join('\n\n') : JSON.stringify(item, null, 2);
      scrollLatest();
    }
  }
  function threadOptions() {
    $('threads').replaceChildren();
    for (const entry of session.threads) { const o = new Option(entry.title, entry.id); $('threads').add(o); }
    $('threads').value = thread || '';
  }
  async function openThread(id) {
    const result = await rpc('thread/read', {threadId: id, includeTurns: true});
    thread = id; turn = session.active?.[id]; resetMessages();
    for (const t of result.thread.turns || []) for (const item of t.items || []) renderItem(item);
    welcome(); scrollLatest(true); threadOptions(); status(turn ? 'Codex 正在处理你的请求' : '已连接 · 设备工作空间');
  }
  async function newThread() {
    const r = await rpc('thread/start', {model: $('model').value || undefined});
    thread = r.thread.id; turn = null; session.threads.unshift({id: thread, title: '新对话'});
    resetMessages(); welcome(); threadOptions(); status('新对话 · 同一个设备工作空间');
  }
  function showRequest() {
    const box = $('approval'); box.replaceChildren(); box.hidden = !requestQueue.length;
    scrollLatest();
    if (!requestQueue.length) return;
    const req = requestQueue[0], label = document.createElement('div'); label.textContent = req.method === 'item/tool/requestUserInput' ? 'Codex 需要你的回答' : '这一步需要你确认'; box.append(label);
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(req.params, null, 2); box.append(pre);
    const respond = async result => { try { await rpc('server/respond', {requestId: req.id, result}); requestQueue = requestQueue.filter(r => r.id !== req.id); showRequest(); } catch (e) { fail(e); } };
    function button(text, result) { const b = document.createElement('button'); b.textContent = text; if (text.startsWith('允许')) b.className = 'primary'; b.onclick = () => respond(result); box.append(b); }
    if (/requestApproval$/.test(req.method) && /commandExecution|fileChange/.test(req.method)) {
      button('允许这一次', {decision: 'accept'}); button('拒绝', {decision: 'decline'});
    } else if (req.method === 'item/tool/requestUserInput') {
      const fields = [];
      for (const q of req.params.questions || []) {
        const label = document.createElement('label'); label.textContent = q.question;
        const input = document.createElement('textarea'); input.placeholder = (q.options || []).map(o => o.label).join(' / ');
        label.append(input);
        if (q.options?.length) { const choices = document.createElement('div'); choices.className = 'answer-options'; for (const o of q.options) { const b = document.createElement('button'); b.type = 'button'; b.textContent = o.label; b.title = o.description || ''; b.onclick = () => { input.value = o.label; }; choices.append(b); } label.append(choices); }
        box.append(label); fields.push([q.id, input]);
      }
      const b = document.createElement('button'); b.textContent = '提交回答'; b.onclick = () => respond({answers: Object.fromEntries(fields.map(([id, input]) => [id, {answers: [input.value]}]))}); box.append(b);
    } else {
      const note = document.createElement('div'); note.textContent = '此扩展请求需要按 app-server 协议填写响应 JSON：'; box.append(note);
      const input = document.createElement('textarea'); input.value = '{}'; box.append(input);
      const b = document.createElement('button'); b.textContent = '提交 JSON'; b.onclick = () => { try { respond(JSON.parse(input.value)); } catch (e) { fail(e); } }; box.append(b);
    }
  }
  function event(msg) {
    const p = msg.params || {};
    if (msg.method === 'aict/requestResolved') { requestQueue = requestQueue.filter(r => r.id !== p.requestId); showRequest(); return; }
    if (msg.id !== undefined) { if (!requestQueue.some(r => r.id === msg.id)) requestQueue.push(msg); showRequest(); return; }
    if (p.threadId && p.threadId !== thread) return;
    if (msg.method === 'item/agentMessage/delta') { const previous = items.get(p.itemId)?.text || ''; message(p.itemId, 'Codex', previous + p.delta); }
    if (msg.method === 'item/completed' || msg.method === 'item/started') renderItem(p.item);
    if (msg.method === 'item/commandExecution/outputDelta') {
      const pre = document.getElementById('tool-' + p.itemId)?.lastChild; if (pre) { pre.textContent += p.delta; scrollLatest(); }
    }
    if (msg.method === 'aict/transferProgress') {
      renderItem({id: p.transferId, type: 'dynamicToolCall', tool: 'phone_call', arguments: {method: 'transfer.' + p.direction},
        status: p.phase === 'completed' ? 'completed' : p.phase === 'failed' ? 'failed' : 'inProgress',
        transferredBytes: p.bytes, phase: p.phase, projectPath: p.projectPath, phonePath: p.phonePath});
    }
    if (msg.method === 'turn/started') { turn = p.turn.id; session.active[p.threadId] = turn; status('Codex 正在工作…'); }
    if (msg.method === 'turn/completed') { turn = null; delete session.active[p.threadId]; status(p.turn.status === 'completed' ? '已完成' : `${p.turn.status} · ${JSON.stringify(p.turn.error || '')}`); }
    if (msg.method === 'error' || msg.method === 'aict/error') fail(p.message || p.error || JSON.stringify(p));
    if (msg.method === 'aict/disconnected') { turn = null; status('Codex 进程已退出，请重连', 'error'); }
  }
  async function connect() {
    if (connecting) return; connecting = true;
    try {
      status('正在连接手机工作空间…', 'connecting');
      if (socket) socket.close();
      const caps = await phone.capabilities();
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/codex/${encodeURIComponent(caps.installationId)}/ws`);
      const connection = socket;
      socket.onmessage = async frame => {
        if (connection !== socket) return;
        const msg = JSON.parse(frame.data);
        if (msg.id !== undefined) {
          const p = pending.get(msg.id); if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Error(msg.error)) : p.resolve(msg.result); }
        } else if (msg.session) {
          session = msg.session; requestQueue = session.requests || []; showRequest();
          $('project-info').textContent = '设备工作空间\n' + session.projectId + '\n所有对话共用此目录';
          try {
            await rpc('device/context', {viewport: {width: innerWidth, height: innerHeight}, userAgent: navigator.userAgent, language: navigator.language, pixelRatio: devicePixelRatio});
            if (session.threads.length) await openThread(thread && session.threads.some(t => t.id === thread) ? thread : session.threads[0].id);
            else await newThread();
            const models = await rpc('model/list');
            $('model').length = 1;
            for (const m of models.data || []) $('model').add(new Option(m.displayName || m.model, m.model));
            status(turn ? 'Codex 正在处理你的请求' : '已连接 · 设备工作空间');
          } catch (e) { fail(e); }
        } else if (msg.event) event(msg.event);
      };
      socket.onclose = () => { if (connection !== socket) return; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('连接断开')); } pending.clear(); status('连接断开 · 在设置中重连', 'error'); };
      socket.onerror = () => status('连接失败，请检查手机 SSH 和服务端', 'error');
    } catch (e) { fail(e); } finally { connecting = false; }
  }
  $('composer').onsubmit = async e => {
    e.preventDefault(); const text = $('prompt').value.trim(); if ((!text && !$('images').files.length) || !thread || submitting) return;
    submitting = true; scrollLatest(true);
    $('send').disabled = true;
    try {
      const input = [], uploads = [];
      for (const file of $('images').files) {
        if (file.size > 50 * 1024 * 1024) throw Error('单个附件请小于 50 MiB');
        status('正在上传附件 · ' + file.name, 'working');
        const response = await fetch(`/api/codex/${encodeURIComponent(session.device)}/files?name=${encodeURIComponent(file.name)}`, {method: 'POST', body: file, headers: {'Content-Type': 'application/octet-stream'}});
        if (!response.ok) throw Error('附件上传失败：' + await response.text());
        const saved = await response.json(); uploads.push(saved);
        // Local-image input refers to the saved file; no data URL/base64 is placed in a text prompt.
        if (file.type.startsWith('image/')) input.push({type: 'localImage', path: session.cwd + '/' + saved.projectPath});
      }
      const attachmentText = uploads.length ? '\n\n[已上传到当前 project 的附件；仅路径和元数据，不含文件内容]\n' + uploads.map(f => `${f.projectPath} (${f.bytes} bytes, SHA-256 ${f.sha256})`).join('\n') + '\n如需传回手机，使用 phone_call transfer.toPhone；禁止把分块/Base64读进上下文用于传输。' : '';
      input.unshift({type: 'text', text: (text || '请查看我上传的附件。') + attachmentText});
      if (turn) await rpc('turn/steer', {threadId: thread, expectedTurnId: turn, input});
      else { const r = await rpc('turn/start', {threadId: thread, input, model: $('model').value || undefined, effort: $('effort').value || undefined}); turn = r.turn.id; }
      const entry = session.threads.find(t => t.id === thread); if (entry && entry.title === '新对话') { entry.title = text.slice(0, 60); threadOptions(); }
      $('prompt').value = ''; $('images').value = ''; $('prompt').required = true; resizePrompt(); renderAttachments();
    } catch (e) { fail(e); } finally { submitting = false; $('send').disabled = false; }
  };
  $('stop').onclick = () => turn && rpc('turn/interrupt', {threadId: thread, turnId: turn}).catch(fail);
  $('new').onclick = () => newThread().catch(fail);
  $('threads').onchange = () => openThread($('threads').value).catch(fail);
  $('reconnect').onclick = () => { $('settings').close(); connect(); };
  $('artifacts').onclick = () => session && window.open('/artifact-list/' + session.projectId, '_blank');
  $('settings-open').onclick = () => $('settings').showModal();
  $('settings-close').onclick = () => $('settings').close();
  $('settings').addEventListener('click', e => { if (e.target === $('settings')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  function resizePrompt() { $('prompt').style.height = 'auto'; $('prompt').style.height = Math.min($('prompt').scrollHeight, 146) + 'px'; if (followLatest) scrollLatest(); }
  function renderAttachments() { $('attachments').replaceChildren(); for (const file of $('images').files) { const chip = document.createElement('span'); chip.className = 'attachment-chip'; chip.textContent = file.name + ' · ' + (file.size / 1024 < 1024 ? Math.ceil(file.size / 1024) + ' KB' : (file.size / 1024 / 1024).toFixed(1) + ' MB'); $('attachments').append(chip); } }
  $('images').onchange = () => { renderAttachments(); $('prompt').required = !$('images').files.length; };
  $('prompt').addEventListener('input', resizePrompt);
  $('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('composer').requestSubmit(); } });
  stream.addEventListener('click', e => { const suggestion = e.target.closest('[data-prompt]'); if (suggestion) { $('prompt').value = suggestion.dataset.prompt; resizePrompt(); $('prompt').focus(); } });
  connect();
})();
