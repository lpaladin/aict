package dev.aict.container;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import org.json.JSONObject;
import org.json.JSONArray;
import java.lang.reflect.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Transport-independent entry point. Business code comes from the web/server. */
public final class NativeRuntime {
    public interface Reply { void send(JSONObject result); }
    private static final ExecutorService WORK = Executors.newCachedThreadPool();
    public static volatile android.app.Activity activity;

    public static void dispatch(Context context, String json, Reply reply) {
        WORK.execute(() -> {
            String id = "";
            try {
                JSONObject request = new JSONObject(json);
                id = request.getString("id");
                final String requestId = id;
                JSONObject params = request.optJSONObject("params");
                if (params == null) params = new JSONObject();
                switch (request.getString("method")) {
                    case "capabilities":
                        reply.send(ok(id, new JSONObject()
                            .put("runtime", "AutoJs6 6.6.4 / Rhino")
                            .put("sdk", Build.VERSION.SDK_INT)
                            .put("credentialId", ConnectionService.credentialId)
                            .put("installationId", ConnectionService.installationId)
                            .put("connected", ConnectionService.connected)
                            .put("connectionRoute", ConnectionService.connectionRoute)
                            .put("localForwardingEnabled", ConnectionService.allowsForwarding(context))
                            .put("allFiles", Build.VERSION.SDK_INT >= 30 && android.os.Environment.isExternalStorageManager())
                            .put("overlay", Settings.canDrawOverlays(context))
                            .put("visionService", VisionService.instance != null)
                            .put("paths", new JSONObject().put("files",context.getFilesDir().getAbsolutePath()).put("downloads",context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS).getAbsolutePath()))
                            .put("treeUri",context.getSharedPreferences("aict",Context.MODE_PRIVATE).getString("treeUri",null))
                            .put("features",new JSONArray(new String[]{"script.execute","script.start","task.cancel","events","file.chunks","file.contentUri","download.resume","camera.capture","camera.video","ui.action","forward.open","forward.list","forward.close"}))
                            .put("autojsRuntime", autoJs() != null)));
                        break;
                    case "permissions.open":
                        new Handler(Looper.getMainLooper()).post(() -> {
                            context.startActivity(new android.content.Intent(context, PermissionsActivity.class)
                                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
                        });
                        reply.send(ok(id, "opened"));
                        break;
                    case "permissions.status":
                        android.content.pm.PackageInfo packageInfo=context.getPackageManager().getPackageInfo(context.getPackageName(),android.content.pm.PackageManager.GET_PERMISSIONS);
                        JSONObject grants=new JSONObject();
                        if(packageInfo.requestedPermissions!=null)for(String permission:packageInfo.requestedPermissions)grants.put(permission,context.checkSelfPermission(permission)==android.content.pm.PackageManager.PERMISSION_GRANTED);
                        reply.send(ok(id,grants));break;
                    case "permissions.request":
                        PermissionsActivity.request(context,params.getJSONArray("permissions"),reply,id);break;
                    case "script.execute":
                    case "script.start":
                        boolean detached = "script.start".equals(request.getString("method"));
                        ScriptTasks.Task task = ScriptTasks.create(id, detached, params.optLong("timeoutMs", 0), reply);
                        if (detached) reply.send(ok(id, task.info()));
                        try { execute(params.getString("source"), params.optJSONObject("args"), task); }
                        catch (Throwable e) { task.finish(error(id, e)); }
                        break;
                    case "task.list": reply.send(ok(id, ScriptTasks.list())); break;
                    case "task.get": reply.send(ok(id, ScriptTasks.get(params.getString("taskId")))); break;
                    case "task.cancel": reply.send(ok(id, ScriptTasks.cancel(params.getString("taskId")))); break;
                    case "file.read": reply.send(ok(id, FileAccess.read(context, params))); break;
                    case "file.write": reply.send(ok(id, FileAccess.write(context, params))); break;
                    case "file.list": reply.send(ok(id, FileAccess.list(context, params))); break;
                    case "download.start":
                        DownloadEngine.start(context, params, reply, id);
                        break;
                    case "download.cancel":
                        DownloadEngine.cancel(params.getString("taskId")); reply.send(ok(id,"cancel requested")); break;
                    case "camera.capture":
                    case "camera.video":
                        CaptureActivity.launch(context, params, "camera.video".equals(request.getString("method")), reply, id);
                        break;
                    case "ui.action":
                        if (VisionService.instance == null) throw new IllegalStateException("Enable AIct Vision accessibility service");
                        VisionService.instance.action(params, reply, id);
                        break;
                    case "script.stopAll":
                        ScriptTasks.markAllCancelled();
                        Object service = engineService();
                        reply.send(ok(id, service.getClass().getMethod("stopAll").invoke(service)));
                        break;
                    case "accessibility.snapshot":
                        if (VisionService.instance == null) throw new IllegalStateException("Enable AIct Vision accessibility service");
                        reply.send(ok(id, VisionService.instance.snapshot()));
                        break;
                    case "screen.capture":
                        if (VisionService.instance == null) throw new IllegalStateException("Enable AIct Vision accessibility service");
                        VisionService.instance.capture(result -> {
                            try { result.put("id", requestId); } catch (Exception ignored) {}
                            reply.send(result);
                        });
                        break;
                    default: throw new IllegalArgumentException("Unknown method; use script.execute for arbitrary native logic");
                }
            } catch (Throwable e) { reply.send(error(id, e)); }
        });
    }

    private static Object autoJs() throws Exception {
        Class<?> cls = Class.forName("org.autojs.autojs.AutoJs");
        try { return cls.getMethod("getInstance").invoke(null); }
        catch (NoSuchMethodException e) {
            Object companion = cls.getField("Companion").get(null);
            return companion.getClass().getMethod("getInstance").invoke(companion);
        }
    }

    private static Object engineService() throws Exception {
        Object instance = autoJs();
        return instance.getClass().getMethod("getScriptEngineService").invoke(instance);
    }

    private static void execute(String source, JSONObject args, ScriptTasks.Task task) throws Exception {
        if (source.length() > 2 * 1024 * 1024) throw new IllegalArgumentException("script too large");
        // Serialize only script results. Java objects remain local and can be used freely by the script.
        String trimmed = source.trim();
        String mode = trimmed.startsWith("\"ui\"") || trimmed.startsWith("'ui'") ? "\"ui\";\n" : "";
        String wrapped = mode + "var args = JSON.parse(" + JSONObject.quote(args == null ? "{}" : args.toString()) + ");\n"
            + "var __host = engines.myEngine().execArgv.aictHost;\n"
            + "var aict = {emit:function(name,data){__host.emit(String(name),JSON.stringify(data===undefined?null:data));},isCancelled:function(){return __host.isCancelled();}};\n"
            + "var __aictValue=eval(" + JSONObject.quote(source) + ");\n"
            + "__host.reportResult(JSON.stringify(__aictValue===undefined?null:__aictValue));";
        Class<?> sourceClass = Class.forName("org.autojs.autojs.script.StringScriptSource");
        Object script = sourceClass.getConstructor(String.class, String.class).newInstance("AICT remote", wrapped);
        Class<?> configClass = Class.forName("org.autojs.autojs.execution.ExecutionConfig");
        Object config = configClass.getConstructor().newInstance();
        configClass.getMethod("setArgument", String.class, Object.class).invoke(config, "aictHost", task);
        // Host handles are deliberately available to fully trusted remote scripts.
        if (activity != null) configClass.getMethod("setArgument", String.class, Object.class).invoke(config, "aictActivity", activity);
        Class<?> listenerClass = Class.forName("org.autojs.autojs.execution.ScriptExecutionListener");
        Object listener = Proxy.newProxyInstance(listenerClass.getClassLoader(), new Class<?>[]{listenerClass}, (proxy, method, values) -> {
            if (method.getName().equals("onStart")) task.attach(values[0]);
            else if (method.getName().equals("onSuccess")) {
                task.finish(ok("", task.result()));
            } else if (method.getName().equals("onException")) {
                task.finish(error("", (Throwable) values[1]));
            } else if (method.getName().equals("hashCode")) return System.identityHashCode(proxy);
            else if (method.getName().equals("equals")) return proxy == values[0];
            else if (method.getName().equals("toString")) return "AICT Script Listener";
            return null;
        });
        Object service = engineService();
        service.getClass().getMethod("execute", Class.forName("org.autojs.autojs.script.ScriptSource"), listenerClass, configClass)
            .invoke(service, script, listener, config);
    }

    public static JSONObject ok(String id, Object result) {
        try { return new JSONObject().put("id", id).put("ok", true).put("result", result == null ? JSONObject.NULL : result); }
        catch (Exception e) { throw new RuntimeException(e); }
    }
    public static JSONObject error(String id, Throwable error) {
        while (error instanceof InvocationTargetException && error.getCause() != null) error = error.getCause();
        try { return new JSONObject().put("id", id).put("ok", false).put("error", error.getClass().getSimpleName() + ": " + error.getMessage()); }
        catch (Exception e) { throw new RuntimeException(e); }
    }
}
