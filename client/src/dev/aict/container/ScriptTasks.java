package dev.aict.container;

import org.json.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Generic remote execution lifecycle; scripts themselves remain remote-owned. */
public final class ScriptTasks {
    private static final ConcurrentHashMap<String, Task> TASKS = new ConcurrentHashMap<>();
    private static final ScheduledExecutorService CLOCK = Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"AICT-task-deadlines");t.setDaemon(true);return t;});
    public static final class Task {
        public final String id;
        public final long createdAt = System.currentTimeMillis();
        public volatile String state = "starting";
        public volatile Object execution;
        private volatile NativeRuntime.Reply reply;
        private final boolean detached;
        private final AtomicBoolean terminal = new AtomicBoolean();
        private volatile boolean cancelRequested;
        private volatile Object result=JSONObject.NULL;
        private volatile JSONObject terminalResponse;
        private volatile ScheduledFuture<?> deadline;
        Task(String id, boolean detached, NativeRuntime.Reply reply) { this.id=id; this.detached=detached; this.reply=reply; }
        public JSONObject info() throws JSONException { return new JSONObject().put("taskId",id).put("state",state).put("cancelRequested",cancelRequested).put("createdAt",createdAt); }
        public void attach(Object execution) { this.execution=execution; state=cancelRequested?"cancelling":"running"; if(cancelRequested) interrupt(); }
        public void emit(String event, String json) {
            NativeRuntime.Reply target=reply;
            if(target==null) return;
            try {
                Object data = new JSONTokener(json).nextValue();
                target.send(new JSONObject().put("type","event").put("id",id).put("taskId",id).put("event",event).put("data",data));
            } catch(Exception e) { android.util.Log.w("AICT", "Event delivery failed", e); }
        }
        public boolean isCancelled() { return cancelRequested; }
        public void reportResult(String json) throws JSONException { result=new JSONTokener(json).nextValue(); }
        public Object result() { return result; }
        public void finish(JSONObject response) {
            if(!terminal.compareAndSet(false,true)) return;
            if(deadline!=null) deadline.cancel(false);
            state=cancelRequested ? "cancelled" : response.optBoolean("ok") ? "completed" : "failed";
            if(cancelRequested)response=NativeRuntime.error(id,new InterruptedException("Cancellation requested; execution ended"));
            terminalResponse=response;
            NativeRuntime.Reply target=reply;
            if(target!=null) {
                try {
                    response.put("id",id).put("taskId",id);
                    if(detached) {
                        target.send(new JSONObject().put("type","event").put("id",id).put("taskId",id).put("event","task.finished").put("data",response));
                    } else target.send(response);
                } catch(Exception e) { android.util.Log.w("AICT","Result delivery failed",e); }
            }
            reply=null; execution=null;
            trim();
        }
        private void interrupt() {
            Object e=execution;
            if(e==null) return;
            try {
                Object engine=Class.forName("org.autojs.autojs.execution.ScriptExecution").getMethod("getEngine").invoke(e);
                if(engine!=null) Class.forName("org.autojs.autojs.engine.ScriptEngine").getMethod("forceStop").invoke(engine);
            } catch(Exception error) { android.util.Log.w("AICT","Cancellation requested; engine has not stopped",error); }
        }
        public void cancel() { if(terminal.get()) return; cancelRequested=true; state="cancelling"; interrupt(); }
    }
    public static Task create(String id, boolean detached, long timeoutMs, NativeRuntime.Reply reply) {
        Task task=new Task(id,detached,reply);
        if(TASKS.putIfAbsent(id,task)!=null) throw new IllegalArgumentException("Duplicate task id");
        if(timeoutMs>0) task.deadline=CLOCK.schedule(task::cancel,timeoutMs,TimeUnit.MILLISECONDS);
        return task;
    }
    public static JSONObject cancel(String id) throws Exception {
        Task task=TASKS.get(id); if(task==null) throw new IllegalArgumentException("Unknown task: "+id);
        task.cancel(); return task.info();
    }
    public static JSONObject get(String id) throws Exception {
        Task task=TASKS.get(id);if(task==null)throw new IllegalArgumentException("Unknown task: "+id);
        JSONObject info=task.info();if(task.terminalResponse!=null)info.put("response",task.terminalResponse);return info;
    }
    public static void markAllCancelled() { for(Task task:TASKS.values()) task.cancel(); }
    public static JSONArray list() throws Exception {
        JSONArray out=new JSONArray(); for(Task task:TASKS.values()) out.put(task.info()); return out;
    }
    private static void trim() {
        if(TASKS.size()<=128) return;
        ArrayList<Task> done=new ArrayList<>();
        for(Task task:TASKS.values()) if(task.terminal.get()) done.add(task);
        done.sort(Comparator.comparingLong(t->t.createdAt));
        for(Task task:done) { if(TASKS.size()<=128) break; TASKS.remove(task.id,task); }
    }
}
