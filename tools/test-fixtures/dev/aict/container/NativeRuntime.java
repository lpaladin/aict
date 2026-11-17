package dev.aict.container;
import org.json.*;
/** Transport/Android boundary fixture; ScriptTasks itself is the production code. */
public final class NativeRuntime {
    public interface Reply{void send(JSONObject response);}
    public static JSONObject error(String id,Throwable error){try{return new JSONObject().put("id",id).put("ok",false).put("error",error.toString());}catch(JSONException e){throw new RuntimeException(e);}}
}
