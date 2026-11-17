package dev.aict.container;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.*;
import android.graphics.*;
import android.os.*;
import android.util.Base64;
import android.view.Display;
import org.json.*;
import java.io.ByteArrayOutputStream;

/** Screenshot and node inspection, with the platform's accessibility authorization. */
public final class VisionService extends AccessibilityService {
    public static volatile VisionService instance;
    @Override protected void onServiceConnected() { instance = this; }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) {}
    @Override public void onInterrupt() {}
    @Override public void onDestroy() { if (instance == this) instance = null; super.onDestroy(); }

    public void action(JSONObject params, NativeRuntime.Reply reply, String id) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                String type=params.getString("type");
                if(type.equals("global")) {
                    String name=params.getString("action");
                    int code=name.equals("back")?GLOBAL_ACTION_BACK:name.equals("home")?GLOBAL_ACTION_HOME:name.equals("recents")?GLOBAL_ACTION_RECENTS:name.equals("notifications")?GLOBAL_ACTION_NOTIFICATIONS:name.equals("quickSettings")?GLOBAL_ACTION_QUICK_SETTINGS:-1;
                    if(code<0)throw new IllegalArgumentException("Unknown global action");
                    reply.send(NativeRuntime.ok(id,performGlobalAction(code)));return;
                }
                if(type.equals("gesture")) {
                    JSONArray points=params.getJSONArray("points");if(points.length()==0)throw new IllegalArgumentException("No gesture points");
                    Path path=new Path();JSONArray first=points.getJSONArray(0);path.moveTo((float)first.getDouble(0),(float)first.getDouble(1));
                    for(int i=1;i<points.length();i++){JSONArray point=points.getJSONArray(i);path.lineTo((float)point.getDouble(0),(float)point.getDouble(1));}
                    android.accessibilityservice.GestureDescription gesture=new android.accessibilityservice.GestureDescription.Builder().addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(path,0,params.optLong("durationMs",100))).build();
                    boolean accepted=dispatchGesture(gesture,new GestureResultCallback(){@Override public void onCompleted(android.accessibilityservice.GestureDescription g){reply.send(NativeRuntime.ok(id,true));}@Override public void onCancelled(android.accessibilityservice.GestureDescription g){reply.send(NativeRuntime.error(id,new IllegalStateException("Gesture cancelled")));}},null);
                    if(!accepted)throw new IllegalStateException("Gesture rejected");return;
                }
                AccessibilityNodeInfo root=getRootInActiveWindow();if(root==null)throw new IllegalStateException("No active window");
                try{
                    java.util.List<AccessibilityNodeInfo> nodes=params.has("viewId")?root.findAccessibilityNodeInfosByViewId(params.getString("viewId")):root.findAccessibilityNodeInfosByText(params.getString("text"));
                    try{
                        int index=params.optInt("index",0);if(index<0||index>=nodes.size())throw new IllegalArgumentException("Node not found");
                        AccessibilityNodeInfo node=nodes.get(index);int operation;
                        Bundle args=new Bundle();
                        switch(type){case "click":operation=AccessibilityNodeInfo.ACTION_CLICK;break;case "longClick":operation=AccessibilityNodeInfo.ACTION_LONG_CLICK;break;case "setText":operation=AccessibilityNodeInfo.ACTION_SET_TEXT;args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,params.getString("value"));break;case "scrollForward":operation=AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;break;case "scrollBackward":operation=AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;break;default:throw new IllegalArgumentException("Unknown node action");}
                        reply.send(NativeRuntime.ok(id,node.performAction(operation,args)));
                    }finally{for(AccessibilityNodeInfo node:nodes)node.recycle();}
                }finally{root.recycle();}
            }catch(Throwable e){reply.send(NativeRuntime.error(id,e));}
        });
    }

    public JSONObject snapshot() throws Exception {
        JSONArray windows = new JSONArray();
        int[] budget = {5000};
        for (AccessibilityWindowInfo window : getWindows()) {
            AccessibilityNodeInfo root = window.getRoot();
            try { if (root != null) windows.put(node(root, 0, budget)); }
            finally { if (root != null) root.recycle(); window.recycle(); }
        }
        return new JSONObject().put("timestamp", System.currentTimeMillis()).put("windows", windows).put("truncated", budget[0] <= 0);
    }

    private JSONObject node(AccessibilityNodeInfo node, int depth, int[] budget) throws Exception {
        budget[0]--;
        Rect bounds = new Rect(); node.getBoundsInScreen(bounds);
        JSONObject result = new JSONObject().put("className", String.valueOf(node.getClassName()))
            .put("packageName", String.valueOf(node.getPackageName())).put("text", String.valueOf(node.getText()))
            .put("description", String.valueOf(node.getContentDescription())).put("viewId", node.getViewIdResourceName())
            .put("clickable", node.isClickable()).put("editable", node.isEditable()).put("enabled", node.isEnabled())
            .put("bounds", new JSONArray(new int[]{bounds.left, bounds.top, bounds.right, bounds.bottom}));
        JSONArray children = new JSONArray();
        if (depth < 60) for (int i = 0; i < node.getChildCount() && budget[0] > 0; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            try { if (child != null) children.put(node(child, depth + 1, budget)); }
            finally { if (child != null) child.recycle(); }
        }
        return result.put("children", children);
    }

    public void capture(NativeRuntime.Reply reply) {
        if (Build.VERSION.SDK_INT < 30) { reply.send(NativeRuntime.error("", new UnsupportedOperationException("Screenshot requires Android 11+; AutoJs6 MediaProjection remains available to scripts"))); return; }
        takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
            @Override public void onSuccess(ScreenshotResult shot) {
                Bitmap bitmap = null, software = null;
                try {
                    bitmap = Bitmap.wrapHardwareBuffer(shot.getHardwareBuffer(), shot.getColorSpace());
                    if (bitmap == null) throw new IllegalStateException("No screenshot bitmap");
                    software = bitmap.copy(Bitmap.Config.ARGB_8888, false);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    software.compress(Bitmap.CompressFormat.JPEG, 85, out);
                    if (out.size() > 5 * 1024 * 1024) throw new IllegalStateException("Screenshot exceeds transport limit");
                    reply.send(NativeRuntime.ok("", new JSONObject().put("mime", "image/jpeg")
                        .put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
                        .put("width", software.getWidth()).put("height", software.getHeight())
                        .put("rotation", getSystemService(android.view.WindowManager.class).getDefaultDisplay().getRotation())
                        .put("timestamp", System.currentTimeMillis())));
                } catch (Throwable e) { reply.send(NativeRuntime.error("", e)); }
                finally {
                    shot.getHardwareBuffer().close();
                    if (bitmap != null) bitmap.recycle();
                    if (software != null) software.recycle();
                }
            }
            @Override public void onFailure(int code) { reply.send(NativeRuntime.error("", new IllegalStateException("Screenshot error " + code + "; secure windows and capture throttling are platform restrictions"))); }
        });
    }
}
