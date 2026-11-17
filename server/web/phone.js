/* Shared browser SDK; AICTNative is supplied to trusted WebViews and frames. */
(() => {
  if (window.phone && window.phone.__aict) return;
  let serial = 0;
  const frameId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const pending = new Map();
  const listeners = new Map();
  window.__aictReceive = response => {
    if (response.type === 'event') {
      for (const name of [response.event, '*']) {
        for (const listener of listeners.get(name) || []) {
          try { listener(response.data, response); } catch (e) { console.error(e); }
        }
      }
      return;
    }
    const p = pending.get(response.id);
    if (!p) return;
    pending.delete(response.id);
    clearTimeout(p.timer);
    response.ok ? p.resolve(response.result) : p.reject(new Error(response.error || 'Native task failed'));
  };
  window.addEventListener('message', event => {
    if (event.data && event.data.__aictResponse) {
      window.__aictReceive(event.data.__aictResponse);
      for (let i = 0; i < window.frames.length; i++) {
        window.frames[i].postMessage(event.data, '*');
      }
    }
  });
  function call(method, params = {}, timeout = 60000) {
    if (!window.AICTNative) return Promise.reject(new Error('请在 AICT Android 客户端中打开'));
    const id = `${frameId}-${Date.now()}-${++serial}`;
    const promise = new Promise((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => {
        pending.delete(id);
        reject(new Error('等待结果超时；任务可能仍在运行'));
      }, timeout) : null;
      pending.set(id, {resolve, reject, timer});
      try { AICTNative.request(JSON.stringify({id, method, params})); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
    promise.requestId = id;
    return promise;
  }
  function on(name, listener) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(listener);
    return () => { const group = listeners.get(name); if (group) { group.delete(listener); if (!group.size) listeners.delete(name); } };
  }
  async function saveBlob(blob, options = {}) {
    let target = {...options}, result;
    const encode = slice => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error); reader.readAsDataURL(slice);
    });
    for (let offset = 0; offset < blob.size || offset === 0; offset += 196608) {
      const chunk = blob.slice(offset, Math.min(offset + 196608, blob.size));
      result = await call('file.write', {...target, offset, base64: await encode(chunk)});
      target = result.location.startsWith('content:') ? {uri: result.location} : {path: result.location};
    }
    return {...result, bytes: blob.size};
  }
  async function saveUrl(url, options = {}) {
    if (/^(blob:|data:)/.test(url)) return saveBlob(await (await fetch(url)).blob(), options);
    return call('download.start', {...options, url}, 0);
  }
  function watchScreen(listener, options = {}) {
    let stopped = false, timer;
    const step = async () => {
      if (stopped) return;
      try { const frame = await call('screen.capture'); if (!stopped) listener(frame); }
      catch (error) { if (options.onError) options.onError(error); else console.error(error); }
      if (!stopped) timer = setTimeout(step, Math.max(500, options.intervalMs || 1000));
    };
    step();
    return () => { stopped = true; clearTimeout(timer); };
  }
  window.phone = Object.freeze({
    __aict: true,
    version: '0.2.0',
    call,
    execute: (source, args = {}, options = {}) => call('script.execute', {source, args, ...options}, options.waitMs === undefined ? 60000 : options.waitMs),
    start: (source, args = {}, options = {}) => call('script.start', {source, args, ...options}),
    tasks: () => call('task.list'),
    task: taskId => call('task.get', {taskId}),
    cancel: taskId => call('task.cancel', {taskId}),
    on,
    files: Object.freeze({read: options => call('file.read', options), write: options => call('file.write', options), list: options => call('file.list', options)}),
    download: (url, options = {}) => call('download.start', {url, ...options}, 0),
    cancelDownload: taskId => call('download.cancel', {taskId}),
    saveBlob,
    saveUrl,
    camera: Object.freeze({capture: (options = {}) => call('camera.capture', options, 0), video: (options = {}) => call('camera.video', options, 0)}),
    action: options => call('ui.action', options),
    capabilities: () => call('capabilities'),
    permissions: () => call('permissions.open'),
    permissionStatus: () => call('permissions.status'),
    requestPermissions: permissions => call('permissions.request', {permissions}, 0),
    stopAll: () => call('script.stopAll'),
    capture: () => call('screen.capture'),
    snapshot: () => call('accessibility.snapshot'),
    watchScreen
  });
  if (typeof document !== 'undefined') document.addEventListener('click', event => {
    const anchor = event.target && event.target.closest && event.target.closest('a[download]');
    if (!anchor || !/^(blob:|data:)/.test(anchor.href)) return;
    event.preventDefault();
    saveUrl(anchor.href, {name: anchor.download || 'download-' + Date.now()})
      .then(result => console.info('AICT saved', result.location)).catch(console.error);
  }, true);
})();
