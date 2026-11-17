const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync('server/web/phone.js', 'utf8');
let frame = 0;
function context() {
  const sent = [];
  const listeners = {};
  const c = {console, setTimeout, clearTimeout, Date, Math, Map, Promise, Object, Error, JSON,
    Set, crypto: {randomUUID: () => 'frame-' + ++frame},
    frames: [], addEventListener: (name, callback) => listeners[name] = callback,
    AICTNative: {request: value => sent.push(JSON.parse(value))}};
  c.window = c;
  vm.createContext(c); vm.runInContext(source, c);
  return {c, sent, listeners};
}
(async () => {
  const a = context(), b = context();
  const first = a.c.phone.execute('toast("x")', {x: 1});
  const second = b.c.phone.capabilities();
  assert.notEqual(a.sent[0].id, b.sent[0].id);
  a.listeners.message({data: {__aictResponse: {id: a.sent[0].id, ok: true, result: {value: 42}}}});
  b.listeners.message({data: {__aictResponse: {id: b.sent[0].id, ok: true, result: 'native'}}});
  assert.equal((await first).value, 42); assert.equal(await second, 'native');
  const bad = a.c.phone.call('unknown');
  a.c.__aictReceive({id: a.sent[1].id, ok: false, error: 'Permission denied'});
  await assert.rejects(bad, /Permission denied/);
  const original = a.c.phone;
  vm.runInContext(source, a.c);
  assert.equal(a.c.phone, original);
  let eventSeen;
  const unsubscribe = a.c.phone.on('progress', (data, event) => {eventSeen = [data.step,event.taskId];});
  const running = a.c.phone.execute('aict.emit("progress",{step:1}); 42');
  const runningId = running.requestId;
  a.c.__aictReceive({type:'event',id:runningId,taskId:runningId,event:'progress',data:{step:1}});
  assert.deepEqual(eventSeen,[1,runningId]);
  a.c.__aictReceive({id:runningId,ok:true,result:42});
  assert.equal(await running,42);
  unsubscribe(); eventSeen=null;
  a.c.__aictReceive({type:'event',event:'progress',data:{step:2}});
  assert.equal(eventSeen,null);
  const detached=a.c.phone.start('sleep(1000)');
  const request=a.sent[a.sent.length-1]; assert.equal(request.method,'script.start');
  a.c.__aictReceive({id:request.id,ok:true,result:{taskId:request.id}});
  assert.equal((await detached).taskId,request.id);
  const c = context();
  c.c.FileReader=class {readAsDataURL(blob){blob.arrayBuffer().then(data=>{this.result='data:application/octet-stream;base64,'+Buffer.from(data).toString('base64');this.onload();});}};
  let written=Buffer.alloc(0);
  c.c.AICTNative.request=value=>{
    const request=JSON.parse(value);
    assert.equal(request.method,'file.write');
    const chunk=Buffer.from(request.params.base64,'base64');
    assert.equal(request.params.offset,written.length);
    if(written.length)assert.equal(request.params.path,'/test/blob.bin');
    written=Buffer.concat([written,chunk]);
    queueMicrotask(()=>c.c.__aictReceive({id:request.id,ok:true,result:{location:'/test/blob.bin',bytes:chunk.length,nextOffset:written.length}}));
  };
  const binary=Buffer.alloc(600001);for(let i=0;i<binary.length;i++)binary[i]=i%251;
  const saved=await c.c.phone.saveBlob(new Blob([binary]),{name:'blob.bin'});
  assert.equal(saved.bytes,binary.length);assert.deepEqual(written,binary);
  written=Buffer.alloc(0);
  const empty=await c.c.phone.saveBlob(new Blob([]),{name:'empty.bin'});
  assert.equal(empty.bytes,0);
  const watch=context();let stopWatch;
  const frameSeen=new Promise(resolve=>{stopWatch=watch.c.phone.watchScreen(frame=>{stopWatch();resolve(frame);});});
  assert.equal(watch.sent[0].method,'screen.capture');
  watch.c.__aictReceive({id:watch.sent[0].id,ok:true,result:{width:100,height:200}});
  assert.equal((await frameSeen).height,200);
  delete b.c.AICTNative;
  await assert.rejects(b.c.phone.capabilities(), /AICT Android/);
  console.log('PASS: RPC correlation, events, detached tasks, 600001-byte chunked Blob roundtrip, empty Blob, reinjection and missing native');
})().catch(error => { console.error(error); process.exitCode = 1; });
