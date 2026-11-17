package dev.aict.container;

import org.json.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class ScriptTasksTest {
    public static final class Execution implements org.autojs.autojs.execution.ScriptExecution {
        final AtomicInteger stops=new AtomicInteger();
        public org.autojs.autojs.engine.ScriptEngine getEngine(){return ()->stops.incrementAndGet();}
    }
    static void check(boolean value,String error){if(!value)throw new AssertionError(error);}
    public static void main(String[] args)throws Exception{
        List<JSONObject> replies=new ArrayList<>();
        ScriptTasks.Task task=ScriptTasks.create("result",false,0,replies::add);
        task.attach(new Execution());task.emit("progress","{\"step\":1}");
        check(replies.size()==1&&replies.get(0).getString("type").equals("event"),"Progress should be an event");
        check(task.info().getString("state").equals("running"),"Event finished task");
        task.reportResult("{\"answer\":42}");check(((JSONObject)task.result()).getInt("answer")==42,"Explicit result lost");
        task.finish(new JSONObject().put("ok",true).put("result",task.result()));
        task.finish(new JSONObject().put("ok",true));
        check(replies.size()==2,"Duplicate terminal result");check(task.info().getString("state").equals("completed"),"Wrong completion state");
        check(ScriptTasks.get("result").getJSONObject("response").getJSONObject("result").getInt("answer")==42,"Result not retrievable after transport loss");
        System.out.println("PASS: explicit JSON results, progress and exactly-once completion");
        Execution execution=new Execution();ScriptTasks.Task cancelled=ScriptTasks.create("cancel",false,0,replies::add);
        cancelled.cancel();cancelled.attach(execution);
        check(execution.stops.get()==1&&cancelled.isCancelled(),"Early cancellation lost");
        check(cancelled.info().getString("state").equals("cancelling"),"Cancellation falsely marked stopped");
        cancelled.finish(new JSONObject().put("ok",true));
        check(cancelled.info().getString("state").equals("cancelled"),"No terminal cancellation");
        check(!replies.get(replies.size()-1).getBoolean("ok"),"Cancelled task reported success");
        System.out.println("PASS: cancel-before-start, engine interruption and truthful cancellation state");
        List<JSONObject> events=new ArrayList<>();ScriptTasks.Task detached=ScriptTasks.create("detached",true,0,events::add);
        detached.reportResult("[1,2]");detached.finish(new JSONObject().put("ok",true).put("result",detached.result()));
        check(events.get(0).getString("event").equals("task.finished"),"Detached completion not emitted");
        Execution timedExecution=new Execution();ScriptTasks.Task timed=ScriptTasks.create("timed",false,40,replies::add);timed.attach(timedExecution);
        for(int i=0;i<100&&!timed.isCancelled();i++)Thread.sleep(5);
        check(timed.isCancelled()&&timedExecution.stops.get()==1,"Deadline did not request engine interruption");
        timed.finish(new JSONObject().put("ok",false));
        System.out.println("PASS: detached completion and execution deadline");
    }
}
