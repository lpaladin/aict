/* Native progress window. Closing it suppresses it until the next turn. */
(() => {
  let path, task, started, active=false, queue=Promise.resolve(), step='', beat;
  async function write(done=false) {
    if(!path)return;
    await phone.call('file.write',{path,text:JSON.stringify({step,started,updated:Date.now(),done})});
  }
  function send(done=false){queue=queue.then(()=>write(done)).catch(e=>console.warn('进度悬浮窗',e));return queue;}
  window.AICTProgress={
    start(){
      if(active)return;
      active=true;started=Date.now();step='正在处理请求…';
      queue=queue.then(async()=>{
        const caps=await phone.capabilities();if(!caps.overlay)throw Error('请开启悬浮窗权限');
        path=caps.paths.files+'/codex-progress-'+started+'.json';await write();
        const r=await phone.start("// AutoJs6 / Rhino. Status is written by the Codex page, never inferred.\nvar path = args.path;\nvar w = floaty.rawWindow(<vertical bg=\"#ee20382d\" padding=\"12\" w=\"260\"><horizontal id=\"handle\"><text text=\"AIct · Codex\" textColor=\"#ffffff\" textSize=\"14sp\" layout_weight=\"1\"/><text id=\"dismiss\" text=\"×\" textColor=\"#ffffff\" textSize=\"22sp\" w=\"44\" h=\"44\" gravity=\"center\"/></horizontal><text id=\"step\" text=\"正在连接进度…\" textColor=\"#ffffff\" textSize=\"13sp\" maxLines=\"3\"/><text id=\"elapsed\" text=\"\" textColor=\"#bcd5c5\" textSize=\"11sp\" marginTop=\"6\"/></vertical>);\nvar density = context.getResources().getDisplayMetrics().density;\nw.setPosition(Math.round(12*density), Math.round(100*density));\nvar closed = false, finishAt = 0, last = null;\nfunction closeWindow() { if (closed) return; closed = true; w.close(); clearInterval(timer); try { files.remove(path); } catch (_) {} exit(); }\nw.dismiss.on('click', closeWindow);\nvar dx=0, dy=0, wx=0, wy=0;\nw.handle.setOnTouchListener(new android.view.View.OnTouchListener({onTouch:function(v,e){\n  if(e.getAction()===0){dx=e.getRawX();dy=e.getRawY();wx=w.getX();wy=w.getY();return true;}\n  if(e.getAction()===2){w.setPosition(Math.max(0,Math.min(device.width-Math.round(260*density),wx+e.getRawX()-dx)),Math.max(0,Math.min(device.height-Math.round(140*density),wy+e.getRawY()-dy)));return true;}\n  return true;\n}}));\nvar timer = setInterval(function(){\n  try { if(files.exists(path)) last=JSON.parse(files.read(path)); } catch(_) {}\n  if (!last) return;\n  var stale=Date.now()-last.updated>45000;\n  ui.run(function(){w.step.setText(stale?'连接中断 · 等待进度恢复':String(last.step));w.elapsed.setText(last.done?'5 秒后收起':('已工作 '+Math.floor((Date.now()-last.started)/1000)+' 秒'));});\n  if(last.done&&!finishAt)finishAt=Date.now()+5000;\n  if((finishAt&&Date.now()>finishAt)||Date.now()-last.updated>180000)closeWindow();\n},700);\n\r\n",{path});task=r.taskId;
      }).catch(e=>console.warn('进度悬浮窗',e));
      beat=setInterval(()=>send(),15000);
    },
    update(text){if(!active)return;step=String(text).replace(/\s+/g,' ').slice(0,140);send();},
    finish(text){if(!active)return;active=false;clearInterval(beat);step=text||'已完成';send(true);},
  };
  window.addEventListener('pagehide',()=>AICTProgress.finish('页面已关闭 · 进度同步停止'));
})();
