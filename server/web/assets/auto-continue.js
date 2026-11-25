/* Resume only the selected quota-blocked task, once a real quota recovery is observed. */
(() => {
  let access, inFlight = false;
  const quotas = new Map(), pending = new Map();
  const $ = id => document.getElementById(id);
  const storageKey = device => 'aict-auto-continue:' + device;
  function enabled(device) { try { return localStorage.getItem(storageKey(device)) === 'true'; } catch (_) { return false; } }
  function persist(device) { try { localStorage.setItem(storageKey(device)+':pending', JSON.stringify(pending.get(device) || null)); } catch (_) {} }
  function load(device) {
    if (pending.has(device)) return;
    try { const item = JSON.parse(localStorage.getItem(storageKey(device)+':pending')); if (item && Date.now()-item.at < 7*86400000) pending.set(device,item); } catch (_) {}
  }
  function quotaState(data) {
    const bucket = data?.rateLimitsByLimitId?.codex || data?.rateLimits;
    const windows = [bucket?.primary, bucket?.secondary].filter(w => typeof w?.usedPercent === 'number' && Number.isFinite(w.usedPercent));
    const remaining = windows.length ? Math.max(0,Math.min(...windows.map(w=>100-w.usedPercent))) : null;
    const raw = bucket?.credits?.balance;
    const credit = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 0;
    return {remaining, credit, unlimited:bucket?.credits?.unlimited === true};
  }
  function render() {
    const context=access?.snapshot(); if (!context?.device) return;
    load(context.device);
    $('auto-continue').checked=enabled(context.device);
    const wait=pending.get(context.device);
    $('auto-continue-note').textContent=wait?.threadId === context.thread ? wait.attempted ? '已尝试续接，请确认任务状态' : '等待用量恢复' : '用量恢复后续接当前任务';
  }
  async function maybeResume(device) {
    const context=access?.snapshot(), wait=pending.get(device), quota=quotas.get(device);
    if (!context || !enabled(device) || !wait || !quota || inFlight || wait.attempted || device !== context.device || wait.threadId !== context.thread || !context.connected || context.active) return;
    const recovered=(quota.remaining !== null && quota.remaining > 0 && (wait.empty || wait.remaining !== null && quota.remaining > wait.remaining)) || quota.credit > wait.credit || quota.unlimited && !wait.unlimited;
    if (!recovered) return;
    inFlight=true;wait.attempted=true;persist(device);render();
    try { await access.resume(wait.threadId); pending.delete(device); persist(device); }
    catch (_) { /* An uncertain submission is never retried automatically. */ }
    finally { inFlight=false;render(); }
  }
  window.AICTAutoContinue={
    configure(config) { access=config;render(); },
    render,
    quota(data,device) {
      if (!device) return;
      load(device); const state=quotaState(data);quotas.set(device,state);
      const wait=pending.get(device);
      if (wait && state.remaining === 0) {wait.empty=true;persist(device);}
      render();maybeResume(device);
    },
    event(msg) {
      const context=access?.snapshot(), p=msg.params || {};
      if (!context?.device || p.threadId !== context.thread) return;
      if (msg.method === 'turn/completed' && p.turn?.status === 'failed') {
        const error=p.turn.error || {}, code=error.codexErrorInfo;
        if (!(code === 'usageLimitExceeded' || code?.usageLimitExceeded || /(?:hit|reached|exceeded).{0,30}usage limit|usage limit.{0,30}(?:hit|reached|exceeded)/i.test(error.message || ''))) return;
        const quota=quotas.get(context.device) || {remaining:null,credit:0,unlimited:false};
        pending.set(context.device,{threadId:p.threadId,at:Date.now(),remaining:quota.remaining,credit:quota.credit,unlimited:quota.unlimited,empty:quota.remaining===0,attempted:false});persist(context.device);render();
      }
    },
    cancel(threadId) {const context=access?.snapshot();if(context?.device && pending.get(context.device)?.threadId===threadId){pending.delete(context.device);persist(context.device);render();}},
  };
  $('auto-continue').onchange=()=>{const context=access?.snapshot();if(!context?.device)return;try{localStorage.setItem(storageKey(context.device),String($('auto-continue').checked));}catch(_){}render();maybeResume(context.device);};
})();
