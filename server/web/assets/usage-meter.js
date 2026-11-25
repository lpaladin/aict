/* Account quota and current-context remaining space, kept separate. */
(() => {
  const $ = id => document.getElementById(id);
  const contexts = new Map(), accounts = new Map();
  let device, thread, rpc, requestSerial = 0;
  const percent = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  function contextRemaining(usage) {
    const limit = usage?.modelContextWindow, used = usage?.last?.totalTokens;
    return typeof limit === 'number' && limit > 0 && typeof used === 'number' && used >= 0 ? percent(100 * (1 - used / limit)) : null;
  }
  function quotaWindows(data) {
    const buckets = data?.rateLimitsByLimitId;
    const bucket = buckets?.codex || data?.rateLimits;
    return ['primary', 'secondary'].flatMap((key, index) => {
      const window = bucket?.[key], used = percent(window?.usedPercent);
      if (used === null) return [];
      const mins = window.windowDurationMins;
      const duration = mins === 10080 ? '每周' : mins >= 60 ? `${mins / 60} 小时` : mins > 0 ? `${mins} 分钟` : index ? '长期额度' : '短期额度';
      return [{remaining: 100 - used, duration, resetsAt: window.resetsAt}];
    });
  }
  function drawRing(id, value) {
    const ring = $(id);
    ring.style.strokeDasharray = `${value === null ? 0 : value} 100`;
    ring.style.stroke = value === null ? 'var(--line)' : value <= 10 ? '#a44639' : value <= 25 ? '#b38a35' : id === 'usage-account' ? '#285e47' : '#7b9cb6';
  }
  const label = value => value === null ? '未知' : `${Math.round(value)}%`;
  function render() {
    const usage = contexts.get(`${device}:${thread}`);
    const context = contextRemaining(usage);
    const account = accounts.get(device);
    const windows = account && Date.now() - account.updated < 120000 ? quotaWindows(account.data) : [];
    const quota = windows.length ? Math.min(...windows.map(w => w.remaining)) : null;
    drawRing('usage-account', quota); drawRing('usage-context', context);
    $('usage-meter').setAttribute('aria-label', `剩余用量：账号 ${label(quota)}，上下文 ${label(context)}。点击查看详情`);
    $('usage-meter').title = `账号剩余 ${label(quota)} · 上下文剩余 ${label(context)}`;
    $('usage-unknown').textContent = quota === null && context === null ? '?' : '';
    const box = $('usage-details'); box.replaceChildren();
    function row(name,value,color) {
      const row=document.createElement('div');row.className='usage-mini-row';
      const caption=document.createElement('span');caption.className='usage-mini-name';
      const dot=document.createElement('span');dot.className='usage-mini-dot';dot.style.background=color;
      const nameText=document.createElement('span');nameText.textContent=name;caption.append(dot,nameText);
      const metric=document.createElement('span'),valueText=document.createElement('strong'),suffix=document.createElement('small');
      valueText.textContent=value===null?'—':label(value);suffix.textContent=value===null?'未知':'剩余';
      if(value!==null && value<=25)valueText.style.color=value<=10?'#a44639':'#b38a35';
      metric.append(valueText,suffix);row.append(caption,metric);box.append(row);
    }
    row('上下文',context,'#7b9cb6');
    if(!windows.length)row('账号额度',null,'#285e47');
    for(const window of windows)row(window.duration==='每周'?'每周额度':`${window.duration}额度`,window.remaining,'#285e47');
    AICTAutoContinue.render();
  }
  async function refresh() {
    if (!rpc || !device) return;
    const target = device, serial = ++requestSerial;
    try {
      const data = await rpc('account/rateLimits/read');
      if (target !== device || serial !== requestSerial) return;
      accounts.set(target, {data, updated: Date.now()}); AICTAutoContinue.quota(data,target); render();
    } catch (_) { if (target === device) render(); }
  }
  window.AICTUsage = {
    select(nextDevice, nextThread, request) { device = nextDevice; thread = nextThread; rpc = request; render(); },
    refresh,
    event(msg) {
      const p = msg.params || {};
      if (msg.method === 'thread/tokenUsage/updated' && p.threadId) { contexts.set(`${device}:${p.threadId}`, p.tokenUsage); render(); }
      if (msg.method === 'account/rateLimits/updated') {
        requestSerial++; accounts.set(device, {data: p, updated: Date.now()}); AICTAutoContinue.quota(p,device); render();
      }
      if (msg.method === 'account/updated') { accounts.delete(device); render(); refresh(); }
    },
    disconnect() { requestSerial++; accounts.delete(device); render(); },
  };
  $('usage-meter').onclick = () => { render(); $('usage-dialog').showModal(); refresh(); };
  $('usage-close').onclick = () => $('usage-dialog').close();
  $('usage-dialog').addEventListener('click', e => { if (e.target === $('usage-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
  setInterval(() => { render(); if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  render();
})();
