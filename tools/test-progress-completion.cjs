const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const tick=()=>new Promise(r=>setImmediate(r));
async function browserRace(){
 let writes=[],callbacks=[],failFinal=true;
 const window={addEventListener(){},dispatchEvent(){}};
 const ctx={window,phone:{capabilities:async()=>({paths:{files:'/test'},overlay:false}),call:async(m,p)=>{const s=JSON.parse(p.text);if(s.done&&failFinal){failFinal=false;throw Error('transient');}writes.push(s);},on:()=>()=>{},start:async()=>({})},fetch:async()=>({ok:true,text:async()=>''}),crypto:{randomUUID:()=> 'owner'},console,Date,CustomEvent:class{},setTimeout:f=>{callbacks.push(f);return callbacks.length;},clearTimeout(){},setInterval:f=>{callbacks.push(f);return 1;},clearInterval(){}};
 vm.runInNewContext(fs.readFileSync('server/web/assets/progress-controller.js','utf8'),ctx);
 const p=window.AICTProgress;await p.start();p.update('delayed');p.finish();await tick();
 // Simulate already dispatched heartbeat/debounce callbacks after clearInterval/clearTimeout.
 for(const f of [...callbacks]) f();await tick();await tick();
 assert(writes.some(s=>s.done));const first=writes.findIndex(s=>s.done);assert(writes.slice(first).every(s=>s.done));
}
function nativeTerminal(){
 const source=fs.readFileSync('server/web/assets/progress-overlay.js','utf8');
 const body=source.slice(source.indexOf('var timer = setInterval(function () {'));
 let callback,now=100000,closed=0,removed=0,exited=0;
 let state={owner:'o',done:true,updated:1,step:'已完成',revision:1};
 const labels={};const ctx={serverConfirmed:0,remoteStep:'',pollStatus(){},outgoing:[],aict:{emit(){}},statePath:'/state',owner:'o',last:null,finishAt:0,dismissed:false,rendered:'',timer:1,Date:{now:()=>now},JSON,String,Math,files:{exists:()=>true,read:()=>JSON.stringify(state),remove:()=>removed++},cancelNotice(){},notifyPending(){throw Error('unexpected notification');},renderRequest(){},setInterval:f=>(callback=f,1),clearInterval(){},exit:()=>exited++,ui:{run:f=>f()},windowView:{sessionName:{setText(){}},step:{setText:t=>labels.step=t},elapsed:{setText(){}},close:()=>closed++}};
 vm.runInNewContext(body,ctx);callback();assert.equal(labels.step,'已完成');
 state={...state,done:false,updated:now,step:'连接已断开'};now+=1000;callback();assert.equal(labels.step,'已完成');
 now+=5001;callback();assert.equal(closed,1);assert.equal(removed,1);assert.equal(exited,1);
}
(async()=>{await browserRace();nativeTerminal();console.log('PASS: late callbacks retain done; final write retries; native completion resists stale state and closes after 5 seconds');})().catch(e=>{console.error(e);process.exitCode=1});
