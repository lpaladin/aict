const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const tick=()=>new Promise(r=>setImmediate(r));
async function browserRace(){
 let writes=[],callbacks=[],failFinal=true;
 const window={addEventListener(){},dispatchEvent(){}};
 const ctx={window,phone:{capabilities:async()=>({paths:{files:'/test'},overlay:false}),call:async(m,p)=>{const s=JSON.parse(p.text);if(s.done&&failFinal){failFinal=false;throw Error('transient');}writes.push(s);},on:()=>()=>{},start:async()=>({})},fetch:async()=>({ok:true,text:async()=>''}),crypto:{randomUUID:()=> 'owner'},console,Date,CustomEvent:class{},setTimeout:f=>{callbacks.push(f);return callbacks.length;},clearTimeout(){},setInterval:f=>{callbacks.push(f);return 1;},clearInterval(){}};
 vm.runInNewContext(fs.readFileSync('server/web/assets/progress-controller.js','utf8'),ctx);
 const p=window.AICTProgress;p.sync([{id:'a'}]);await tick();p.update('a','delayed');p.finish();await tick();
 // Simulate already dispatched heartbeat/debounce callbacks after clearInterval/clearTimeout.
 for(const f of [...callbacks]) f();await tick();await tick();
 assert(writes.some(s=>s.done));const first=writes.findIndex(s=>s.done);assert(writes.slice(first).every(s=>s.done));
}
function nativeTerminal(){
 const source=fs.readFileSync('server/web/assets/progress-overlay.js','utf8');
 const a={id:'a',turnId:'ta',sessionName:'A',statusUrl:'/a',step:'Working A',started:100000};
 const b={id:'b',turnId:'tb',sessionName:'B',statusUrl:'/b',step:'Working B',started:100000};
 let callback,now=100000,closed=0,removed=0,exited=0;
 let state={owner:'o',done:false,updated:now,entries:[a,b]};
 const labels={};
 function label(name) {
   const animation={cancel(){},translationX(value){labels[name+'Offset']=value;return this;},setDuration(){return this;},start(){}};
   return {setText:text=>labels[name]=text,setContentDescription:text=>labels[name+'Description']=text,
     setTranslationX:value=>labels[name+'Offset']=value,getTranslationX:()=>labels[name+'Offset'],animate:()=>animation,
     setEnabled:value=>labels[name+'Enabled']=value,setTextColor:value=>labels[name+'Color']=value,
     getVisibility:()=>labels[name+'Visibility'],setVisibility:value=>labels[name+'Visibility']=value};
 }
 const ctx={outgoing:[],aict:{emit(){}},statePath:'/state',owner:'o',last:null,finishAt:0,dismissed:false,rendered:'',snapshot:null,available:[],selectedId:null,
   Date:{now:()=>now},files:{exists:()=>true,read:()=>JSON.stringify(state),remove:()=>removed++},
   cancelNotice(){},renderRequest(){},setInterval:f=>(callback=f,1),clearInterval(){},exit:()=>exited++,ui:{run:f=>f()},
   dp:value=>value,android:{graphics:{Color:{parseColor:value=>value}},view:{View:{VISIBLE:0,INVISIBLE:4,GONE:8}}},
   windowView:{adjacentName:label('preview'),titleSwipeArea:{getWidth:()=>200},previousHint:label('previous'),nextHint:label('next'),sessionName:label('name'),step:label('step'),elapsed:label('elapsed'),close:()=>closed++}};
 const body=source.slice(source.indexOf('var remote ='));
 vm.createContext(ctx);
 vm.runInContext(body,ctx);
 const polls=[];
 ctx.alignOverlay=()=>{};
 ctx.pollStatus=(entry,cache)=>{
   polls.push(entry.id);cache.confirmed=now;cache.step='Remote '+entry.id;
   if(entry.id==='b') {cache.done=true;cache.step='已完成 B';}
 };
 let eventTime=0;
 const touch=(action,x,y,after=150)=>{eventTime+=after;return ctx.onSessionTitleTouch(null,{
   getActionMasked:()=>action,getRawX:()=>x,getRawY:()=>y,getEventTime:()=>eventTime
 });};
 const swipe=(x,y)=>{touch(0,100,100);touch(1,x,y);};
 callback();assert.equal(labels.previousEnabled,true);assert.equal(labels.name,'A (1/2)');assert.equal(labels.nameDescription,'A (1/2)，左右滑动切换会话');
 swipe(95,100);swipe(60,180);assert.equal(labels.name,'A (1/2)');
 // Once vertical intent wins, horizontal drift cannot navigate.
 touch(0,100,100);touch(2,90,130);touch(1,40,135);assert.equal(labels.name,'A (1/2)');
 touch(0,100,100);touch(2,80,100);assert.equal(labels.nameOffset,-20);assert.equal(labels.preview,'B (2/2)');assert.equal(labels.previewOffset,180);
 callback();assert.equal(labels.previewOffset,180);
 touch(3,40,100);assert.equal(labels.nameOffset,0);assert.equal(labels.name,'A (1/2)');
 // Short, slow drags spring back; a deliberate flick commits.
 touch(0,100,100);touch(2,80,100);touch(1,79,100);assert.equal(labels.name,'A (1/2)');assert.equal(labels.nameOffset,0);
 touch(0,100,100);touch(1,79,100,25);assert.equal(labels.name,'B (2/2)');
 ctx.switchTitle(-1);assert.equal(labels.name,'A (1/2)');assert.equal(labels.preview,'B (2/2)');
 swipe(50,100);assert.equal(labels.name,'B (2/2)');
 swipe(150,100);assert.equal(labels.name,'A (1/2)');
 swipe(50,100);callback();assert.equal(labels.name,'B (2/2)');
 // A turn finishes while the finger is down. Its old neighbor cannot be selected on release.
 touch(0,100,100);touch(2,79,100);
 now+=2600;callback();assert.equal(labels.name,'A');assert.equal(labels.nameDescription,'A');assert.equal(labels.nextEnabled,false);assert.equal(labels.nextColor,'#7D8980');
 touch(1,40,100);assert.equal(labels.name,'A');assert.equal(labels.previewVisibility,4);
 assert.equal(touch(0,100,100),false);
 assert.deepEqual(polls,['a','b']);
 state={owner:'o',done:true,updated:now,step:'已完成',entries:[]};
 callback();assert.equal(labels.step,'已完成');
 state={owner:'o',done:false,updated:now,entries:[a,b]};now+=1000;callback();assert.equal(labels.step,'已完成');
 now+=5001;callback();assert.equal(closed,1);assert.equal(removed,1);assert.equal(exited,1);
}
(async()=>{await browserRace();nativeTerminal();console.log('PASS: switching, native polling and completion fallback, late callbacks, and final write retries');})().catch(e=>{console.error(e);process.exitCode=1});
