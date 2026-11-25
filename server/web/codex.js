/* Mobile app-server client. Text is rendered as text; generated pages open explicitly. */
(() => {
  const $ = id => document.getElementById(id);
  let socket, session, thread, turn, serial = 0, connecting = false, requestQueue = [];
  let reconnectTimer = null, reconnectDelay = 1000, pageClosing = false;
  let localDevice, targetDevice;
  const pending = new Map(), items = new Map();
  const stream = $('messages');
  const emptyTemplate = $('empty').cloneNode(true);
  let followLatest = true, scrollFrame = null, pendingUpdate = false, submitting = false;
  const nearBottom = () => stream.scrollHeight - stream.clientHeight - stream.scrollTop < 72;
  const status = (text, state = turn ? 'working' : 'ready') => {
    $('status').textContent = text; $('status').title = text; document.body.dataset.state = state;
    $('composer-hint').textContent = state === 'working' ? '正在处理 · 可继续补充指令' : '';
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
  window.addEventListener('aict-notice-warning', e => fail(Error(e.detail.message)));
  function updateActiveTurn(msg) {
    const p = msg.params || {}, id = p.threadId;
    if (!session || !id) return;
    session.active ||= {};
    if (msg.method === 'turn/started') session.active[id] = p.turn.id;
    if (msg.method === 'turn/completed' && session.active[id] === p.turn.id) delete session.active[id];
    if (id === thread) turn = session.active[id] || null;
  }
  async function sendInput(threadId, expectedTurnId, input, model, effort) {
    if (expectedTurnId) {
      try {
        return await rpc('turn/steer', {threadId, expectedTurnId, input});
      } catch (error) {
        // Only an explicit rejection proves this input was not accepted.
        if (!/no active turns? to steer/i.test(String(error.message || error))) throw error;
        if (session.active[threadId] === expectedTurnId) delete session.active[threadId];
        if (thread === threadId && turn === expectedTurnId) turn = null;
        // A newer turn may have started while the rejection was in flight.
        if (session.active[threadId]) throw error;
      }
    }
    // turn/started is authoritative; a late RPC response must not resurrect a completed turn.
    return await rpc('turn/start', {threadId, input, model, effort});
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
      detail.querySelector('.tool-status').textContent = item.phase ? (item.phase === 'verifying' ? '校验中' : item.phase === 'completed' ? '已传输' : item.phase === 'failed' ? '失败' : item.phase === 'cancelled' ? '已取消' : '传输中') + ' · ' + Math.ceil((item.transferredBytes || 0) / 1024) + ' KB' : failed ? '失败' : busy ? '进行中' : '完成';
      detail.querySelector('.tool-chevron').textContent = '›';
      // No raw transfer payloads in the visible transcript.
      detail.lastChild.textContent = item.type === 'commandExecution' ? [item.command, item.aggregatedOutput].filter(Boolean).join('\n\n') : JSON.stringify(item, null, 2);
      scrollLatest();
    }
  }
  let threadSort = 'updatedAt', metadataRun = 0;
  try { threadSort = localStorage.getItem('aict-thread-sort') === 'createdAt' ? 'createdAt' : 'updatedAt'; } catch (_) {}
  function mergeThreadMetadata(raw) {
    const entry = session?.threads.find(t => t.id === raw.id);
    if (!entry) return;
    if ('name' in raw) entry.title = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名会话';
    for (const key of ['createdAt', 'updatedAt']) if (Number.isFinite(raw[key])) entry[key] = raw[key];
    entry.metadataLoaded = true;
  }
  function sortedThreads() {
    return [...(session?.threads || [])].sort((a,b) => (b[threadSort] || 0) - (a[threadSort] || 0) || (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id));
  }
  function renderThreadPicker() {
    const list = $('session-list'), focusedId = document.activeElement?.dataset?.sessionId;
    list.replaceChildren();
    for (const key of ['updatedAt', 'createdAt']) $('sort-' + key).setAttribute('aria-pressed', String(threadSort === key));
    for (const entry of sortedThreads()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'session-item'; button.dataset.sessionId = entry.id;
      button.setAttribute('aria-current', String(entry.id === thread));
      const copy = document.createElement('span'); copy.className = 'session-copy';
      const title = document.createElement('strong'); title.textContent = entry.title || '未命名会话';
      const detail = document.createElement('small'), stamp = entry[threadSort];
      detail.textContent = (stamp ? new Date(stamp * 1000).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : entry.metadataLoaded ? '时间未知' : '读取时间中…') + ' · ' + entry.id.slice(-6);
      const mark = document.createElement('span'); mark.className = 'session-mark'; mark.textContent = entry.id === thread ? '当前' : '›';
      copy.append(title,detail); button.append(copy,mark);
      button.onclick = async () => {
        if (submitting) return;
        button.disabled = true;
        try { await openThread(entry.id); $('session-dialog').close(); } catch(e) { fail(e); button.disabled = false; }
      };
      list.append(button);
      if (focusedId === entry.id) button.focus({preventScroll:true});
    }
  }
  async function refreshThreadMetadata() {
    const currentSession = session, connection = socket, run = ++metadataRun;
    const queue = [...currentSession.threads]; let failed = 0;
    $('session-load-status').textContent = '正在同步会话信息…';
    // Bounded reads through the existing device-scoped API; no other device IDs are requested.
    async function worker() {
      while (queue.length && run === metadataRun && currentSession === session && connection === socket) {
        const entry = queue.shift();
        try {
          const result = await rpc('thread/read', {threadId:entry.id, includeTurns:false});
          if (run !== metadataRun || currentSession !== session || connection !== socket) return;
          mergeThreadMetadata(result.thread);
        } catch (_) { failed++; }
      }
    }
    await Promise.all([worker(),worker()]);
    if (run !== metadataRun || currentSession !== session || connection !== socket) return;
    threadOptions();
    $('session-load-status').textContent = failed ? `${failed} 个会话暂未同步，重新打开可重试` : `${session.threads.length} 个会话`;
  }
  function threadOptions() {
    AICTProgress.title(session.threads.find(t=>t.id===thread)?.title);
    $('threads').replaceChildren();
    for (const entry of sortedThreads()) { const o = new Option(entry.title || '未命名会话', entry.id); $('threads').add(o); }
    $('threads').value = thread || '';
    $('session-current-title').textContent = session.threads.find(t=>t.id===thread)?.title || '未命名会话';
    if ($('session-dialog').open) renderThreadPicker();
  }
  async function openThread(id) {
    const result = await rpc('thread/read', {threadId: id, includeTurns: true});
    mergeThreadMetadata(result.thread);
    thread = id; turn = session.active?.[id]; resetMessages(); AICTUsage.select(targetDevice, thread, rpc);
    for (const t of result.thread.turns || []) for (const item of t.items || []) renderItem(item);
    AICTProgress.title(session.threads.find(t=>t.id===thread)?.title);
    AICTProgress.watch(turn ? location.origin + '/api/codex/' + encodeURIComponent(targetDevice) + '/progress/' + encodeURIComponent(turn) : null);
    if(turn || requestQueue.length) AICTProgress.start(); else AICTProgress.finish();
    welcome(); scrollLatest(true); threadOptions(); status(turn ? 'Codex 正在处理你的请求' : '已连接 · 设备工作空间');
  }
  async function newThread() {
    const r = await rpc('thread/start', {model: $('model').value || undefined});
    thread = r.thread.id; turn = null; session.threads.unshift({id: thread, title: '新对话', createdAt:r.thread.createdAt,updatedAt:r.thread.updatedAt}); mergeThreadMetadata(r.thread);
    AICTUsage.select(targetDevice, thread, rpc);
    resetMessages(); welcome(); threadOptions(); status('新对话 · 同一个设备工作空间');
  }
  function showRequest() {
    if(requestQueue.length) AICTProgress.update('等待你的回答或确认');
    else AICTProgress.request(null, null);
    const box = $('approval'); box.replaceChildren(); box.hidden = !requestQueue.length;
    scrollLatest();
    if (!requestQueue.length) return;
    const req = requestQueue[0], label = document.createElement('div'); label.textContent = req.method === 'item/tool/requestUserInput' ? 'Codex 需要你的回答' : '这一步需要你确认'; box.append(label);
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(req.params, null, 2); box.append(pre);
    const requestDevice = targetDevice, requestSocket = socket;
    let answering = false;
    const submitResponse = async result => {
      if (answering || requestDevice !== targetDevice || requestSocket !== socket || !requestQueue.some(r => r.id === req.id)) throw Error('请求已变化，请返回 AIct 确认');
      answering = true;
      try {
        await rpc('server/respond', {requestId: req.id, result});
        requestQueue = requestQueue.filter(r => r.id !== req.id); showRequest();
      } catch (e) { answering = false; throw e; }
    };
    const respond = result => submitResponse(result).catch(fail);
    AICTProgress.request(req, submitResponse, session?.threads?.find(t => t.id === req.params?.threadId)?.title);

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
    AICTAutoContinue.event(msg);
    AICTUsage.event(msg);
    const meta = msg.params || {};
    if (msg.method === 'thread/name/updated') { mergeThreadMetadata({id:meta.threadId,name:meta.threadName ?? meta.name}); threadOptions(); }
    if (['turn/started','turn/completed'].includes(msg.method)) { const entry = session?.threads.find(t=>t.id===meta.threadId); if (entry) { entry.updatedAt = Math.floor(Date.now()/1000); threadOptions(); } }
    const p = msg.params || {};
    if (msg.method === 'aict/requestResolved') { requestQueue = requestQueue.filter(r => r.id !== p.requestId); showRequest(); return; }
    if (msg.id !== undefined) { if (!requestQueue.some(r => r.id === msg.id)) requestQueue.push(msg); showRequest(); return; }
    updateActiveTurn(msg);
    if (p.threadId && p.threadId !== thread) return;
    if (msg.method === 'turn/started') { AICTProgress.watch(location.origin + '/api/codex/' + encodeURIComponent(targetDevice) + '/progress/' + encodeURIComponent(p.turn.id)); AICTProgress.title(session.threads.find(t=>t.id===thread)?.title); AICTProgress.start(); }
    if (msg.method === 'item/started') {
      const item=p.item || {}, names={commandExecution:'执行命令',fileChange:'修改文件',dynamicToolCall:'调用工具',mcpToolCall:'调用服务',reasoning:'思考中',webSearch:'搜索网页',imageView:'查看图片',plan:'更新计划',contextCompaction:'整理上下文',agentMessage:'整理回复'};
      AICTProgress.update((names[item.type] || '处理请求') + (item.tool ? ' · '+item.tool : ''));
    }
    if (msg.method === 'item/agentMessage/delta') AICTProgress.update((items.get(p.itemId)?.text || '')+p.delta);
    if (msg.method === 'turn/completed' && !turn && !requestQueue.length) AICTProgress.finish(p.turn.status === 'completed' ? '已完成' : '任务结束 · '+p.turn.status);
    if (msg.method === 'aict/disconnected') AICTProgress.finish('Codex 进程已退出');
    if (msg.method === 'item/agentMessage/delta') { const previous = items.get(p.itemId)?.text || ''; message(p.itemId, 'Codex', previous + p.delta); }
    if (msg.method === 'item/completed' || msg.method === 'item/started') renderItem(p.item);
    if (msg.method === 'item/commandExecution/outputDelta') {
      const pre = document.getElementById('tool-' + p.itemId)?.lastChild; if (pre) { pre.textContent += p.delta; scrollLatest(); }
    }
    if (msg.method === 'aict/transferProgress') {
      renderItem({id: p.transferId, type: 'dynamicToolCall', tool: 'phone_call', arguments: {method: 'transfer.' + p.direction},
        status: p.phase === 'completed' ? 'completed' : p.phase === 'failed' ? 'failed' : p.phase === 'cancelled' ? 'cancelled' : 'inProgress',
        transferredBytes: p.bytes, phase: p.phase, projectPath: p.projectPath, phonePath: p.phonePath});
    }
    if (msg.method === 'turn/started') { status('Codex 正在工作…'); }
    if (msg.method === 'turn/completed' && !turn) { status(p.turn.status === 'completed' ? '已完成' : `${p.turn.status} · ${JSON.stringify(p.turn.error || '')}`); }
    if (msg.method === 'error' || msg.method === 'aict/error') fail(p.message || p.error || JSON.stringify(p));
    if (msg.method === 'aict/disconnected') { turn = null; status('Codex 进程已退出，请重连', 'error'); }
  }
  async function refreshDevices() {
    const response = await fetch('/api/devices', {cache: 'no-store'});
    if (!response.ok) {
      $('online-device-count').textContent = ''; 
      throw Error('无法读取在线手机');
    }
    const devices = await response.json();
    const onlineIds = new Set(devices.map(device => device.installationId).filter(Boolean));
    if (localDevice) onlineIds.add(localDevice);
    $('online-device-count').textContent = String(onlineIds.size);
    $('online-device-count').title = '当前可见的在线设备（含本机）';
    const select = $('target-device'); select.replaceChildren();
    const listed = new Set();
    for (const device of devices) {
      const id = device.installationId;
      if (!id || device.acceptRemoteControl !== true || listed.has(id)) continue;
      listed.add(id);
      const name = device.name || device.deviceName || device.model || '手机';
      select.add(new Option(`${id === localDevice ? '本机 · ' : ''}${name} · ${id}`, id));
    }
    if (localDevice && !listed.has(localDevice)) select.add(new Option('本机', localDevice));
    if (targetDevice !== localDevice && !listed.has(targetDevice)) {
      targetDevice = localDevice;
      try { localStorage.setItem('aict-codex-target:' + localDevice, targetDevice); } catch (_) {}
      // Use the normal switch handler to detach the previous target session.
      select.value = targetDevice;
      if (socket) { select.onchange(); return; }
    }
    select.value = targetDevice;
  }
  window.addEventListener('focus', () => { if (localDevice && !submitting && !connecting) refreshDevices().catch(fail); });
  setInterval(() => { if (localDevice && !document.hidden && !submitting && !connecting) refreshDevices().catch(fail); }, 10000);
  $('refresh-devices').onclick = () => refreshDevices().catch(fail);
  $('target-device').onchange = () => {
    if (submitting || connecting) { $('target-device').value = targetDevice; return; }
    targetDevice = $('target-device').value;
    try { localStorage.setItem('aict-codex-target:' + localDevice, targetDevice); } catch (_) {}
    // Detach immediately: queued events and pending requests cannot cross devices.
    const previous = socket; socket = null; if (previous) previous.close();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('已切换操控手机')); } pending.clear();
    session = null; thread = null; turn = null; requestQueue = [];
    AICTProgress.finish('已切换操控手机'); showRequest(); resetMessages(); welcome();
    $('threads').replaceChildren(); $('project-info').textContent = '正在连接所选手机…';
    connect();
  };
  function scheduleReconnect() {
    if (pageClosing || reconnectTimer !== null) return;
    const delay = reconnectDelay; reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    status(`连接中断 · ${Math.ceil(delay / 1000)} 秒后自动重连`, 'connecting');
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }
  async function connect() {
    if (connecting) return; connecting = true;
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try {
      status('正在连接手机工作空间…', 'connecting');
      const previous = socket; socket = null; if (previous) previous.close();
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('连接正在恢复，请稍后重试')); } pending.clear();
      if (!localDevice) {
        const caps = await phone.capabilities(); localDevice = caps.installationId;
        try { targetDevice = localStorage.getItem('aict-codex-target:' + localDevice); } catch (_) {}
        targetDevice = targetDevice || localDevice;
      }
      await refreshDevices();
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/codex/${encodeURIComponent(targetDevice)}/ws`);
      const connection = socket;
      socket.onmessage = async frame => {
        if (connection !== socket) return;
        if (connection !== socket) return;
        const msg = JSON.parse(frame.data);
        if (msg.id !== undefined) {
          const p = pending.get(msg.id); if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Error(msg.error)) : p.resolve(msg.result); }
        } else if (msg.session) {
          reconnectDelay = 1000;
          session = msg.session; session.threads = session.threads.map(t=>({...t,title:'未命名会话'})); AICTUsage.select(targetDevice, null, rpc); requestQueue = session.requests || []; showRequest();
          $('project-info').textContent = '设备工作空间\n' + session.projectId + '\n所有对话共用此目录';
          try {
            await rpc('device/context', {viewport: {width: innerWidth, height: innerHeight}, userAgent: navigator.userAgent, language: navigator.language, pixelRatio: devicePixelRatio});
            if (session.threads.length) await openThread(thread && session.threads.some(t => t.id === thread) ? thread : session.threads[0].id);
            else await newThread();
            AICTUsage.refresh();
            const models = await rpc('model/list');
            $('model').length = 1;
            for (const m of models.data || []) $('model').add(new Option(m.displayName || m.model, m.model));
            status(turn ? 'Codex 正在处理你的请求' : '已连接 · 设备工作空间');
          } catch (e) { fail(e); }
        } else if (msg.event) event(msg.event);
      };
      socket.onclose = () => { if (connection !== socket) return; turn = null; AICTUsage.disconnect(); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('连接断开')); } pending.clear(); AICTProgress.finish('连接已断开'); scheduleReconnect(); };
      socket.onerror = () => { if (connection === socket) status('连接暂时不可用，正在恢复…', 'connecting'); };
    } catch (e) { fail(e); scheduleReconnect(); } finally { connecting = false; }
  }
  window.addEventListener('pagehide', () => { pageClosing = true; clearTimeout(reconnectTimer); reconnectTimer = null; });
  window.addEventListener('pageshow', () => { pageClosing = false; if (!socket || socket.readyState > WebSocket.OPEN) connect(); });
  window.addEventListener('online', () => { if (!socket || socket.readyState > WebSocket.OPEN) connect(); });
  $('composer').onsubmit = async e => {
    e.preventDefault(); const text = $('prompt').value.trim(); if ((!text && !selectedFiles().length) || !thread || submitting || !session || !socket || socket.readyState !== WebSocket.OPEN) return;
    submitting = true; $('target-device').disabled = true; scrollLatest(true);
    $('send').disabled = true;
    try {
      const input = [], uploads = [];
      for (const file of selectedFiles()) {
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
      await sendInput(thread, turn, input, $('model').value || undefined, $('effort').value || undefined);
      AICTAutoContinue.cancel(thread);
      const entry = session.threads.find(t => t.id === thread); if (entry) { entry.updatedAt = Math.floor(Date.now()/1000); threadOptions(); }
      $('prompt').value = ''; $('images').value = ''; $('photos').value = ''; $('prompt').required = true; resizePrompt(); renderAttachments();
    } catch (e) { fail(e); } finally { submitting = false; $('target-device').disabled = false; $('send').disabled = false; }
  };
  $('stop').onclick = () => { AICTAutoContinue.cancel(thread); if (turn) rpc('turn/interrupt', {threadId: thread, turnId: turn}).catch(fail); };
  $('new').onclick = () => session && newThread().catch(fail);
  $('session-open').onclick = () => { if (!session) return; renderThreadPicker(); $('session-dialog').showModal(); $('session-open').setAttribute('aria-expanded','true'); refreshThreadMetadata().catch(fail); };
  $('session-dialog').addEventListener('close',()=> $('session-open').setAttribute('aria-expanded','false'));
  $('session-close').onclick = () => { metadataRun++; $('session-dialog').close(); };
  for (const key of ['updatedAt', 'createdAt']) $('sort-' + key).onclick = () => { threadSort = key; try { localStorage.setItem('aict-thread-sort',key); } catch (_) {} threadOptions(); };
  $('session-dialog').addEventListener('click', e => { if (e.target === $('session-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('session-dialog').close(); } });
  $('reconnect').onclick = () => { $('settings').close(); connect(); };
  $('artifacts').onclick = () => session && window.open('/artifact-list/' + session.projectId, '_blank');
  $('settings-open').onclick = () => $('settings').showModal();
  $('settings-close').onclick = () => $('settings').close();
  $('settings').addEventListener('click', e => { if (e.target === $('settings')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  function resizePrompt() { $('prompt').style.height = 'auto'; $('prompt').style.height = Math.min($('prompt').scrollHeight, 146) + 'px'; if (followLatest) scrollLatest(); }
  function selectedFiles() { return [...$('images').files, ...$('photos').files]; }
  function renderAttachments() { $('attachments').replaceChildren(); for (const file of selectedFiles()) { const chip = document.createElement('span'); chip.className = 'attachment-chip'; chip.textContent = file.name + ' · ' + (file.size / 1024 < 1024 ? Math.ceil(file.size / 1024) + ' KB' : (file.size / 1024 / 1024).toFixed(1) + ' MB'); $('attachments').append(chip); } }
  $('images').onchange = $('photos').onchange = () => { renderAttachments(); $('prompt').required = !selectedFiles().length; };
  $('prompt').addEventListener('input', resizePrompt);
  $('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('composer').requestSubmit(); } });
  stream.addEventListener('click', e => { const suggestion = e.target.closest('[data-prompt]'); if (suggestion) { $('prompt').value = suggestion.dataset.prompt; resizePrompt(); $('prompt').focus(); } });
  AICTAutoContinue.configure({
    snapshot:()=>({device:targetDevice,thread,connected:!!session && socket?.readyState===WebSocket.OPEN,active:submitting || !!session?.active?.[thread]}),
    resume:async id=>{ if(!session || id!==thread || session.active[id]) throw Error('会话状态已变化'); await rpc('turn/start',{threadId:id,input:[{type:'text',text:'账号用量已恢复，请继续上次因用量不足中断的任务，从已完成的位置接着进行。'}],model:$('model').value||undefined,effort:$('effort').value||undefined}); }
  });
  connect();
})();
