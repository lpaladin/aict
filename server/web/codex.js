/* Mobile app-server client. Text is rendered as text; generated pages open explicitly. */
(() => {
  const $ = id => document.getElementById(id);
  let socket, session, thread, turn, serial = 0, connecting = false, requestQueue = [];
  let reconnectTimer = null, reconnectDelay = 1000, pageClosing = false;
  let localDevice, targetDevice, activityKnown = false;
  const answeringRequests = new WeakSet();
  let overlaySelection = null, openingOverlayThread = false;
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
    if (msg.method === 'turn/completed') {
      startingTurns.get(id)?.completed.add(p.turn.id);
      if (autoApproveTurns.get(id) === p.turn.id) autoApproveTurns.delete(id);
      if (fullAccessTurns.get(id) === p.turn.id) fullAccessTurns.delete(id);
    }
    if (id === thread) turn = session.active[id] || null;
    if (msg.method === 'turn/started' || msg.method === 'turn/completed') renderExecutionMode();
  }
  const executionMode = $('execution-mode');
  const fullAccessTurns = new Map();
  const startingTurns = new Map();
  let autoApproveTurns = new Map();
  const executionWarning = '警告：本轮自动批准沙箱外命令，新轮次将以无沙箱启动。命令可访问项目外文件和网络。';
  executionMode.value = 'workspace';
  function renderExecutionMode() {
    const enabled = executionMode.value === 'full-access';
    const running = [...fullAccessTurns].some(([id, turnId]) => session?.active?.[id] === turnId);
    const autoApproving = autoApproveTurns.size > 0;
    $('brand-mark').toggleAttribute('data-warning', enabled || running || autoApproving);
    $('brand-mark').textContent = enabled || running || autoApproving ? '⚠' : '✳';
    $('execution-banner').hidden = !enabled && !running && !autoApproving;
    const currentFullAccess = turn && fullAccessTurns.get(thread) === turn;
    if (enabled) {
      $('execution-status').textContent = currentFullAccess ? '当前轮权限全开（无沙箱）'
        : turn && autoApproveTurns.get(thread) === turn ? '本轮自动审批 · 新轮次无沙箱' : '无限制已启用 · 新轮次无沙箱';
    } else {
      $('execution-status').textContent = autoApproving ? '有运行中的轮次正在自动审批' : '下一轮恢复按需审核，运行中的轮次仍有完整权限';
    }
    $('disable-full-access').hidden = !enabled && !autoApproving;
    AICTProgress.executionMode(enabled);
    const approvalModeStatus = $('approval-mode-status');
    if (approvalModeStatus && approvalModeStatus.hidden === enabled) {
      approvalModeStatus.hidden = !enabled;
      $('approval-mode-confirmation').hidden = true;
      $('approval-mode-enable').hidden = enabled;
    }
  }
  function setExecutionMode(mode) {
    executionMode.value = mode;
    renderExecutionMode();
  }
  async function enableUnlimited(threadId, turnId) {
    if (turnId) await rpc('turn/auto-approve-commands', {threadId, turnId, enabled: true});
    setExecutionMode('full-access');
  }
  async function disableUnlimited() {
    await rpc('turn/auto-approve-commands', {enabled: false});
    setExecutionMode('workspace');
  }
  executionMode.addEventListener('change', () => {
    if (executionMode.value === 'full-access') {
      executionMode.value = 'workspace';
      if (window.confirm(executionWarning)) enableUnlimited(thread, turn).catch(fail);
    } else {
      executionMode.value = 'full-access';
      disableUnlimited().catch(fail);
    }
  });
  $('disable-full-access').onclick = () => disableUnlimited().catch(fail);
  async function startTurn(threadId, input, model, effort) {
    const mode = executionMode.value;
    const owner = session;
    const start = {completed: new Set()};
    if (mode === 'full-access') startingTurns.set(threadId, start);
    try {
      const result = await rpc('turn/start', {threadId, input, model, effort, executionMode: mode});
      const turnId = result.turn?.id;
      if (startingTurns.get(threadId) === start && session === owner && turnId && !start.completed.has(turnId)) {
        fullAccessTurns.set(threadId, turnId);
        renderExecutionMode();
      }
      return result;
    } finally {
      if (startingTurns.get(threadId) === start) startingTurns.delete(threadId);
    }
  }
  async function sendInput(threadId, expectedTurnId, input, model, effort) {
    if (expectedTurnId) {
      try {
        return await rpc('turn/steer', {threadId, expectedTurnId, input});
      } catch (error) {
        // Only an explicit rejection proves this input was not accepted.
        if (!/no active turns? to steer/i.test(String(error.message || error))) throw error;
        if (session.active[threadId] === expectedTurnId) {
          delete session.active[threadId];
          if ($('session-dialog').open) renderThreadPicker();
          syncProgress();
        }
        if (thread === threadId && turn === expectedTurnId) { turn = null; renderExecutionMode(); }
        // A newer turn may have started while the rejection was in flight.
        if (session.active[threadId]) throw error;
      }
    }
    // turn/started is authoritative; a late RPC response must not resurrect a completed turn.
    return await startTurn(threadId, input, model, effort);
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
  function appendToolCard(card) {
    const previous = stream.lastElementChild;
    if (previous?.classList.contains('action-stack')) {
      previous.lastElementChild.append(card);
      return;
    }
    if (!previous?.classList.contains('tool-card')) {
      stream.append(card);
      return;
    }
    const stack = document.createElement('details');
    stack.className = 'action-stack';
    const heading = document.createElement('summary');
    heading.textContent = '展开动作';
    const cards = document.createElement('div');
    cards.className = 'action-stack-cards';
    previous.replaceWith(stack);
    cards.append(previous, card);
    stack.append(heading, cards);
    stack.addEventListener('toggle', () => {
      if (followLatest) scrollLatest();
    });
  }

  function updateActionStack(card) {
    const stack = card.closest('.action-stack');
    if (!stack) return;
    const cards = stack.lastElementChild;
    const busy = cards.querySelectorAll('[data-status="working"]').length;
    const errors = cards.querySelectorAll('[data-status="error"]').length;
    const summary = [cards.childElementCount + ' 个动作'];
    if (busy) summary.push(busy + ' 个进行中');
    if (errors) summary.push(errors + ' 个失败');
    const heading = stack.firstElementChild;
    const label = document.createElement('span');
    label.className = 'action-stack-label';
    label.textContent = summary.join(' · ');
    const preview = document.createElement('span');
    preview.className = 'action-stack-preview';
    preview.setAttribute('aria-hidden', 'true');
    for (const action of Array.from(cards.children).slice(-3)) {
      const tile = document.createElement('span');
      tile.className = 'action-stack-tile';
      tile.dataset.status = action.dataset.status;
      for (const part of ['tool-icon', 'tool-name', 'tool-status']) {
        const text = document.createElement('span');
        text.className = part;
        text.textContent = action.querySelector('.' + part).textContent;
        tile.append(text);
      }
      preview.append(tile);
    }
    heading.replaceChildren(label, preview);
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
        detail.append(summary, document.createElement('pre')); appendToolCard(detail);
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
      updateActionStack(detail);
      scrollLatest();
    }
  }
  let threadSort = 'updatedAt', metadataRun = 0, threadSelection = 0;
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
      const marks = document.createElement('span'); marks.className = 'session-marks';
      const badge = document.createElement('span'); badge.className = 'session-state';
      const active = !!session?.active?.[entry.id];
      badge.classList.toggle('is-active', activityKnown && active);
      badge.textContent = activityKnown ? (active ? '运行中' : '空闲') : '状态未知';
      marks.append(badge);
      if (entry.id === thread) {
        const mark = document.createElement('span'); mark.className = 'session-mark'; mark.textContent = '当前';
        marks.append(mark);
      }
      copy.append(title,detail); button.append(copy,marks);
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
    syncProgress();
    $('session-load-status').textContent = failed ? `${failed} 个会话暂未同步，重新打开可重试` : `${session.threads.length} 个会话`;
  }
  function threadOptions() {
    $('threads').replaceChildren();
    for (const entry of sortedThreads()) { const o = new Option(entry.title || '未命名会话', entry.id); $('threads').add(o); }
    $('threads').value = thread || '';
    $('session-current-title').textContent = session.threads.find(t=>t.id===thread)?.title || '未命名会话';
    if ($('session-dialog').open) renderThreadPicker();
  }
  async function openThread(id, shouldOpen = () => true) {
    const owner = session, connection = socket, selection = ++threadSelection;
    const result = await rpc('thread/read', {threadId: id, includeTurns: true});
    if (session !== owner || socket !== connection || threadSelection !== selection || !shouldOpen()) return;
    mergeThreadMetadata(result.thread);
    thread = id; turn = session.active?.[id]; renderExecutionMode(); resetMessages(); AICTUsage.select(targetDevice, thread, rpc);
    for (const t of result.thread.turns || []) for (const item of t.items || []) renderItem(item);
    welcome(); scrollLatest(true); threadOptions(); syncProgress(); status(turn ? 'Codex 正在处理你的请求' : '已连接 · 设备工作空间');
  }
  async function openOverlayThread() {
    if (!overlaySelection || submitting || openingOverlayThread || !activityKnown) return;
    const selection = overlaySelection;
    openingOverlayThread = true;
    try {
      if (selection.id !== thread) await openThread(selection.id, () => overlaySelection === selection);
      if (overlaySelection === selection && $('session-dialog').open) $('session-dialog').close();
    } catch (error) {
      if (overlaySelection === selection && activityKnown) fail(error);
    } finally {
      if (overlaySelection === selection && activityKnown) overlaySelection = null;
      openingOverlayThread = false;
      if (overlaySelection !== selection) openOverlayThread();
    }
  }
  window.addEventListener('aict-open-thread', event => {
    const id = event.detail.threadId;
    if (!session?.threads.some(entry => entry.id === id)) return;
    overlaySelection = {id};
    openOverlayThread();
  });
  let creatingThread = false;
  async function newThread() {
    if (creatingThread || submitting) return;
    const owner = session, connection = socket, selection = ++threadSelection;
    creatingThread = true;
    let r;
    try {
      r = await rpc('thread/start', {model: $('model').value || undefined});
    } finally {
      creatingThread = false;
    }
    if (session !== owner || socket !== connection) return;
    session.threads.unshift({id: r.thread.id, title: '新对话', createdAt:r.thread.createdAt,updatedAt:r.thread.updatedAt});
    mergeThreadMetadata(r.thread);
    if (threadSelection !== selection) { threadOptions(); return; }
    thread = r.thread.id; turn = null; renderExecutionMode();
    AICTUsage.select(targetDevice, thread, rpc);
    resetMessages(); welcome(); threadOptions(); status('新对话 · 同一个设备工作空间');
  }
  function requestActions(req) {
    const requestDevice = targetDevice, requestSocket = socket;
    const stillPending = () => requestDevice === targetDevice && requestSocket === socket &&
      requestSocket?.readyState === WebSocket.OPEN && requestQueue.includes(req);
    const respond = async result => {
      if (!stillPending() || answeringRequests.has(req)) throw Error('请求已变化，请返回 AIct 确认');
      answeringRequests.add(req);
      try {
        await rpc('server/respond', {requestId: req.id, result});
        if (requestSocket === socket) {
          requestQueue = requestQueue.filter(r => r !== req);
          showRequest();
        }
      } finally { answeringRequests.delete(req); }
    };
    const canSwitchMode = /^item\/(commandExecution|fileChange)\/requestApproval$/.test(req.method);
    const switchMode = canSwitchMode ? async () => {
      if (!stillPending()) throw Error('审批请求已变化');
      const id = req.params.threadId;
      await enableUnlimited(id, req.params.turnId || session.active?.[id]);
    } : null;
    return {req, respond, switchMode};
  }
  function syncProgress(completion) {
    if (!activityKnown) return;
    const entries = new Map(Object.entries(session.active || {}).map(([id, turnId]) => [id, {id, turnId}]));
    for (const req of requestQueue) {
      const id = req.params?.threadId || '';
      if (!entries.has(id)) entries.set(id, {id});
      const entry = entries.get(id);
      if (!entry.request) entry.request = requestActions(req);
    }
    const titles = new Map(session.threads.map(t => [t.id, t.title]));
    for (const entry of entries.values()) {
      entry.sessionName = titles.get(entry.id) || '当前会话';
      if (entry.turnId) entry.statusUrl = location.origin + '/api/codex/' + encodeURIComponent(targetDevice) + '/progress/' + encodeURIComponent(entry.turnId);
    }
    AICTProgress.sync([...entries.values()], completion);
  }
  function updateRequestSession() {
    const label = $('approval-session');
    if (!label) return;
    const id = requestQueue[0]?.params?.threadId;
    const title = session?.threads.find(entry => entry.id === id)?.title;
    label.textContent = '所属会话 · ' + (title || (id ? '未命名会话' : '未知'));
  }
  function questionForm(req) {
    const form = document.createElement('form');
    form.className = 'question-form';
    const fields = req.params.questions.map((question, index) => {
      const group = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = question.question;
      group.append(legend);
      if (question.header) {
        const heading = document.createElement('small');
        heading.textContent = question.header;
        group.append(heading);
      }
      const options = question.options || [];
      const name = 'question-' + index;
      function choice(value, label, description) {
        const row = document.createElement('label');
        row.className = 'question-option';
        const radio = document.createElement('input');
        Object.assign(radio, {type: 'radio', name, value, required: true});
        const caption = document.createElement('span');
        caption.textContent = label;
        if (description) {
          const detail = document.createElement('small');
          detail.textContent = description;
          caption.append(detail);
        }
        row.append(radio, caption);
        group.append(row);
        return radio;
      }
      options.forEach((option, i) => choice(String(i), option.label, option.description));
      const custom = options.length && question.isOther ? choice('custom', '其他') : null;
      const input = document.createElement('input');
      input.type = question.isSecret ? 'password' : 'text';
      input.autocomplete = 'off';
      input.placeholder = '输入回答';
      input.setAttribute('aria-label', question.question);
      if (!options.length || custom) group.append(input);
      function updateInput() {
        input.hidden = input.disabled = Boolean(options.length && !custom?.checked);
        input.required = !input.disabled;
      }
      group.addEventListener('change', updateInput);
      updateInput();
      form.append(group);
      return [question.id, () => {
        const selected = group.querySelector('input[type=radio]:checked')?.value;
        return selected && selected !== 'custom' ? options[Number(selected)].label : input.value.trim();
      }];
    });
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = '提交回答';
    const error = document.createElement('p');
    error.setAttribute('role', 'status');
    error.hidden = true;
    form.append(submit, error);
    form.onsubmit = async event => {
      event.preventDefault();
      const answers = Object.fromEntries(fields.map(([id, value]) => [id, {answers: [value()]}]));
      if (Object.values(answers).some(answer => !answer.answers[0])) {
        error.textContent = '请先回答所有问题';
        error.hidden = false;
        return;
      }
      submit.disabled = true;
      error.hidden = true;
      try {
        await requestActions(req).respond({answers});
      } catch (cause) {
        error.textContent = String(cause.message || cause);
        error.hidden = false;
      } finally {
        submit.disabled = false;
      }
    };
    return form;
  }
  let displayedQuestion;
  function showRequest() {
    syncProgress();
    const req = requestQueue[0];
    const isQuestion = req?.method === 'item/tool/requestUserInput';
    if (isQuestion && displayedQuestion === req) return;
    displayedQuestion = isQuestion ? req : null;
    const box = $('approval'); box.replaceChildren(); box.hidden = !requestQueue.length;
    scrollLatest();
    if (!requestQueue.length) return;
    const label = document.createElement('div'); label.textContent = isQuestion ? 'Codex 需要你的回答' : '这一步需要你确认'; box.append(label);
    const sessionLabel = document.createElement('small'); sessionLabel.id = 'approval-session';
    box.append(sessionLabel); updateRequestSession();
    if (isQuestion) {
      box.append(questionForm(req));
      return;
    }
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(req.params, null, 2); box.append(pre);
    const {respond: submitResponse, switchMode: enableFullAccess} = requestActions(req);
    const canSwitchMode = !!enableFullAccess;
    const respond = result => submitResponse(result).catch(fail);

    function button(text, result) { const b = document.createElement('button'); b.textContent = text; if (text.startsWith('允许')) b.className = 'primary'; b.onclick = () => respond(result); box.append(b); }
    if (/requestApproval$/.test(req.method) && /commandExecution|fileChange/.test(req.method)) {
      button('允许这一次', {decision: 'accept'}); button('拒绝', {decision: 'decline'});
      if (canSwitchMode) {
        const warning = document.createElement('p'); warning.className = 'execution-warning';
        warning.textContent = '警告：点「启用无限制」，本轮自动批准沙箱外命令，新轮次无沙箱。';
        const enable = document.createElement('button'); enable.type = 'button'; enable.className = 'enable-full-access';
        enable.id = 'approval-mode-enable'; enable.textContent = '启用无限制';
        const confirmation = document.createElement('div'); confirmation.id = 'approval-mode-confirmation';
        confirmation.hidden = true;
        const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'enable-full-access';
        confirm.textContent = '确认启用';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
        confirmation.append(warning, confirm, cancel);
        enable.onclick = () => { enable.hidden = true; confirmation.hidden = false; confirm.focus(); };
        cancel.onclick = () => { confirmation.hidden = true; enable.hidden = false; enable.focus(); };
        confirm.onclick = async () => {
          confirm.disabled = true;
          try { await enableFullAccess(); } catch (error) { fail(error); }
          finally { confirm.disabled = false; }
        };
        const result = document.createElement('p'); result.id = 'approval-mode-status';
        result.className = 'execution-warning'; result.setAttribute('role', 'status');
        result.textContent = '已启用无限制。其他类型的审批仍需手动处理。';
        result.hidden = executionMode.value !== 'full-access'; enable.hidden = !result.hidden;
        box.append(enable, confirmation, result);
      }
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
    if (msg.method === 'thread/name/updated') { mergeThreadMetadata({id:meta.threadId,name:meta.threadName ?? meta.name}); threadOptions(); updateRequestSession(); }
    if (msg.method === 'aict/autoApproveTurns') { autoApproveTurns = new Map(meta.turns); renderExecutionMode(); return; }
    updateActiveTurn(msg);
    if (['turn/started','turn/completed'].includes(msg.method)) { const entry = session?.threads.find(t=>t.id===meta.threadId); if (entry) { entry.updatedAt = Math.floor(Date.now()/1000); threadOptions(); } }
    const p = msg.params || {};
    if (['aict/requestResolved', 'serverRequest/resolved'].includes(msg.method)) { requestQueue = requestQueue.filter(r => r.id !== p.requestId); showRequest(); return; }
    if (msg.id !== undefined) { if (!requestQueue.some(r => r.id === msg.id)) requestQueue.push(msg); showRequest(); return; }
    if (msg.method === 'aict/disconnected' && session) {
      session.active = {}; requestQueue = [];
      AICTProgress.finish('Codex 进程已退出');
      showRequest(); threadOptions();
    }
    if (['turn/started', 'turn/completed', 'thread/name/updated'].includes(msg.method)) {
      const completion = msg.method === 'turn/completed' && p.turn.status !== 'completed' ? '任务结束 · ' + p.turn.status : undefined;
      syncProgress(completion);
    }
    if (msg.method === 'item/started') {
      const item=p.item || {}, names={commandExecution:'执行命令',fileChange:'修改文件',dynamicToolCall:'调用工具',mcpToolCall:'调用服务',reasoning:'思考中',webSearch:'搜索网页',imageView:'查看图片',plan:'更新计划',contextCompaction:'整理上下文',agentMessage:'整理回复'};
      AICTProgress.update(p.threadId, (names[item.type] || '处理请求') + (item.tool ? ' · '+item.tool : ''));
    }
    if (p.threadId && p.threadId !== thread) return;
    if (msg.method === 'item/agentMessage/delta') {
      const text = (items.get(p.itemId)?.text || '') + p.delta;
      AICTProgress.update(p.threadId, text);
      message(p.itemId, 'Codex', text);
    }
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
    overlaySelection = null;
    session = null; activityKnown = false; thread = null; turn = null; requestQueue = [];
    fullAccessTurns.clear(); startingTurns.clear(); autoApproveTurns.clear(); setExecutionMode('workspace');
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
        const msg = JSON.parse(frame.data);
        if (msg.id !== undefined) {
          const p = pending.get(msg.id); if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(Error(msg.error)) : p.resolve(msg.result); }
        } else if (msg.session) {
          reconnectDelay = 1000;
          session = msg.session; activityKnown = true;
          autoApproveTurns = new Map(session.autoApproveTurns || []);
          for (const [id, turnId] of fullAccessTurns) {
            if (session.active?.[id] !== turnId) fullAccessTurns.delete(id);
          }
          renderExecutionMode();
          session.threads = session.threads.map(t=>({...t,title:t.title || '未命名会话'})); AICTUsage.select(targetDevice, null, rpc); requestQueue = session.requests || []; showRequest();
          $('project-info').textContent = '设备工作空间\n' + session.projectId + '\n所有对话共用此目录';
          const selection = threadSelection;
          threadOptions();
          status(turn ? 'Codex 正在处理你的请求' : '已连接 · 设备工作空间');
          try {
            await rpc('device/context', {viewport: {width: innerWidth, height: innerHeight}, userAgent: navigator.userAgent, language: navigator.language, pixelRatio: devicePixelRatio});
            if (connection !== socket) return;
            if (threadSelection === selection) {
              if (overlaySelection) await openOverlayThread();
              else if (session.threads.length) await openThread(thread && session.threads.some(t => t.id === thread) ? thread : session.threads[0].id);
              else await newThread();
            }
          } catch (e) { if (connection === socket && threadSelection <= selection + 1) fail(e); }
          if (connection !== socket) return;
          AICTUsage.refresh();
          try {
            const models = await rpc('model/list');
            if (connection !== socket) return;
            $('model').length = 1;
            for (const m of models.data || []) $('model').add(new Option(m.displayName || m.model, m.model));
          } catch (_) { /* The default model remains available. */ }
        } else if (msg.event) event(msg.event);
      };
      socket.onclose = () => { if (connection !== socket) return; turn = null; activityKnown = false; requestQueue = []; showRequest(); if ($('session-dialog').open) renderThreadPicker(); AICTUsage.disconnect(); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('连接断开')); } pending.clear(); AICTProgress.finish('连接已断开'); scheduleReconnect(); };
      socket.onerror = () => { if (connection === socket) status('连接暂时不可用，正在恢复…', 'connecting'); };
    } catch (e) { fail(e); scheduleReconnect(); } finally { connecting = false; }
  }
  window.addEventListener('pagehide', () => { pageClosing = true; clearTimeout(reconnectTimer); reconnectTimer = null; });
  window.addEventListener('pageshow', () => { pageClosing = false; if (!socket || socket.readyState > WebSocket.OPEN) connect(); });
  window.addEventListener('online', () => { if (!socket || socket.readyState > WebSocket.OPEN) connect(); });
  $('composer').onsubmit = async e => {
    e.preventDefault();
    const text = $('prompt').value.trim();
    if ((!text && !selectedFiles().length) || submitting) return;
    if (!activityKnown || socket?.readyState !== WebSocket.OPEN) {
      status('连接尚未就绪，请稍后重试', 'connecting');
      return;
    }
    if (!thread || creatingThread) {
      status('正在打开对话，请稍后发送', 'ready');
      return;
    }
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
    } catch (e) { fail(e); } finally { submitting = false; $('target-device').disabled = false; openOverlayThread(); $('send').disabled = false; }
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
    resume:async id=>{ if(!session || id!==thread || session.active[id]) throw Error('会话状态已变化'); await startTurn(id, [{type:'text',text:'账号用量已恢复，请继续上次因用量不足中断的任务，从已完成的位置接着进行。'}], $('model').value || undefined, $('effort').value || undefined); }
  });
  connect();
})();
