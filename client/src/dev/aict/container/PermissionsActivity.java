package dev.aict.container;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.text.InputType;
import android.widget.*;
import java.util.*;
import org.json.*;
import java.util.concurrent.ConcurrentHashMap;

/** Fixed platform authorization UI; no application business workflow lives here. */
public final class PermissionsActivity extends Activity {
    private static final Map<String,NativeRuntime.Reply> REQUESTS=new ConcurrentHashMap<>();
    private static final String INSTALL_PACKAGES = android.Manifest.permission.REQUEST_INSTALL_PACKAGES;
    private static final int INSTALL_PACKAGES_SETTINGS_REQUEST = 911;
    private String requestId;
    private final JSONObject requestedResults=new JSONObject();
    public static void request(Context context,JSONArray permissions,NativeRuntime.Reply reply,String id){
        REQUESTS.put(id,reply);
        new Handler(Looper.getMainLooper()).postDelayed(()->{NativeRuntime.Reply pending=REQUESTS.remove(id);if(pending!=null)pending.send(NativeRuntime.error(id,new IllegalStateException("Permission request timed out")));},300000);
        new Handler(Looper.getMainLooper()).post(()->{
            try{context.startActivity(new Intent(context,PermissionsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("requestId",id).putExtra("permissions",permissions.toString()));}
            catch(Exception e){NativeRuntime.Reply pending=REQUESTS.remove(id);if(pending!=null)pending.send(NativeRuntime.error(id,e));}
        });
    }
    private final ArrayDeque<String> queue = new ArrayDeque<>();
    private LinearLayout list;
    private TextView message;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this); list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); list.setPadding(28, 24, 28, 24); scroll.addView(list); setContentView(scroll);
        message = new TextView(this); message.setText("AIct 权限中心\n\n网页和服务端脚本可使用本应用已获得的权限。系统授权可随时撤销。无障碍用于界面控制；AIct Vision 用于节点读取与截图。部分手机需先在应用信息中允许受限设置。\n"); list.addView(message);
        Switch remoteControl = new Switch(this);
        remoteControl.setText("允许其他设备控制本机");
        remoteControl.setChecked(ConnectionService.acceptsRemoteControl(this));
        remoteControl.setOnCheckedChangeListener((button, enabled) ->
            getSharedPreferences("aict", MODE_PRIVATE).edit()
                .putBoolean(ConnectionService.ACCEPT_CONTROL, enabled).apply());
        list.addView(remoteControl);
        TextView remoteHelp = new TextView(this);
        remoteHelp.setText("开启后，本机才会出现在其他设备的控制目标列表中。关闭不影响在本机使用 AIct。\n");
        list.addView(remoteHelp);
        Switch forwarding = new Switch(this);
        forwarding.setText("允许 Agent 为本机应用开放额外端口");
        forwarding.setChecked(ConnectionService.allowsForwarding(this));
        forwarding.setOnCheckedChangeListener((button, enabled) ->
            getSharedPreferences("aict", MODE_PRIVATE).edit()
                .putBoolean(ConnectionService.ALLOW_FORWARDING, enabled).apply());
        list.addView(forwarding);
        TextView forwardingHelp = new TextView(this);
        forwardingHelp.setText("开启后，本机应用可访问 Agent 开放的 127.0.0.1 端口。关闭会重连 SSH 并终止所有额外转发。");
        list.addView(forwardingHelp);
        add("SSH 连接端口", this::editSshPort);
        add("逐项申请常用权限", () -> {
            queue.clear();
            Collections.addAll(queue, "android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION", "android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS", "android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR", "android.permission.READ_PHONE_STATE", "android.permission.CALL_PHONE");
            if (Build.VERSION.SDK_INT >= 33) Collections.addAll(queue, "android.permission.POST_NOTIFICATIONS", "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_MEDIA_AUDIO");
            else Collections.addAll(queue, "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE");
            if (Build.VERSION.SDK_INT >= 31) Collections.addAll(queue, "android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN");
            queue.add(INSTALL_PACKAGES);
            nextPermission();
        });
        add("允许安装未知应用（用于 AICT 更新）", () -> open(installPackagesSettings()));
        add("无障碍：启用 AutoJs6 操作服务与 AIct Vision", () -> open(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        if (Build.VERSION.SDK_INT >= 30) add("所有文件访问", () -> open(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName()))));
        add("选择并长期授权一个目录", () -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 902));
        add("悬浮窗", () -> open(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))));
        add("通知读取", () -> open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        add("修改系统设置", () -> open(new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + getPackageName()))));
        add("使用情况访问", () -> open(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)));
        add("电池优化设置", () -> open(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));
        add("应用信息 / 查看全部权限", () -> open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        add("返回网页", this::finish);
        requestId=getIntent().getStringExtra("requestId");
        if(requestId!=null){
            try{JSONArray permissions=new JSONArray(getIntent().getStringExtra("permissions"));for(int i=0;i<permissions.length();i++)queue.add(permissions.getString(i));nextPermission();}
            catch(Exception e){NativeRuntime.Reply pending=REQUESTS.remove(requestId);if(pending!=null)pending.send(NativeRuntime.error(requestId,e));finish();}
        }
    }
    private void add(String title, Runnable action) { Button b = new Button(this); b.setText(title); b.setOnClickListener(v -> { try { action.run(); } catch (Exception e) { message.setText(e.toString()); } }); list.addView(b); }
    private void editSshPort() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setSingleLine(true);
        try {
            input.setText(String.valueOf(ConnectionService.getSshPort(this)));
        } catch (Exception e) {
            message.setText(e.toString());
            return;
        }
        input.selectAll();
        SharedPreferences preferences = getSharedPreferences("aict", MODE_PRIVATE);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("SSH 连接端口").setMessage("输入服务器端口（1–65535）。保存后自动重新连接。")
            .setView(input).setNegativeButton("取消", null)
            .setNeutralButton("恢复内置端口", (ignored, which) -> {
                preferences.edit().remove(ConnectionService.SSH_PORT).apply();
                startForegroundService(new Intent(this, ConnectionService.class));
                Toast.makeText(this, "已恢复内置端口，正在重新连接", Toast.LENGTH_SHORT).show();
            })
            .setPositiveButton("保存并重连", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            try {
                int port = Integer.parseInt(input.getText().toString().trim());
                if (port < 1 || port > 65535) throw new NumberFormatException();
                preferences.edit().putInt(ConnectionService.SSH_PORT, port).apply();
                startForegroundService(new Intent(this, ConnectionService.class));
                Toast.makeText(this, "端口已保存，正在重新连接", Toast.LENGTH_SHORT).show();
                dialog.dismiss();
            } catch (NumberFormatException e) {
                input.setError("请输入 1–65535 的端口号");
            }
        }));
        dialog.show();
    }

    private void open(Intent intent) { startActivity(intent); }
    private Intent installPackagesSettings() {
        return new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.fromParts("package", getPackageName(), null));
    }

    private void recordInstallPermission() {
        try {
            requestedResults.put(INSTALL_PACKAGES, getPackageManager().canRequestPackageInstalls());
        } catch (JSONException ignored) {}
    }

    private void nextPermission() {
        while (!queue.isEmpty()) {
            String permission = queue.removeFirst();
            if (INSTALL_PACKAGES.equals(permission)) {
                recordInstallPermission();
                if (!requestedResults.optBoolean(INSTALL_PACKAGES)) {
                    try {
                        startActivityForResult(installPackagesSettings(), INSTALL_PACKAGES_SETTINGS_REQUEST);
                        return;
                    } catch (ActivityNotFoundException | SecurityException e) {
                        android.util.Log.w("AICT", "Install permission settings unavailable", e);
                    }
                }
                continue;
            }
            try{requestedResults.put(permission,checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED);}catch(JSONException ignored){}
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                if (permission.equals("android.permission.ACCESS_FINE_LOCATION") && Build.VERSION.SDK_INT >= 31) requestPermissions(new String[]{"android.permission.ACCESS_COARSE_LOCATION", permission}, 910);
                else requestPermissions(new String[]{permission}, 910);
                return;
            }
        }
        message.setText("权限申请流程结束。被拒绝的权限可在应用信息中补授；特殊权限需使用下面的设置入口。\n");
        if(requestId!=null){NativeRuntime.Reply pending=REQUESTS.remove(requestId);if(pending!=null)pending.send(NativeRuntime.ok(requestId,requestedResults));finish();}
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) { super.onRequestPermissionsResult(code, permissions, results); if (code == 910){for(int i=0;i<permissions.length;i++)try{requestedResults.put(permissions[i],i<results.length&&results[i]==PackageManager.PERMISSION_GRANTED);}catch(JSONException ignored){}nextPermission();} }
    @Override protected void onDestroy(){if(isFinishing()&&requestId!=null){NativeRuntime.Reply pending=REQUESTS.remove(requestId);if(pending!=null)pending.send(NativeRuntime.error(requestId,new IllegalStateException("Permission request cancelled")));}super.onDestroy();}
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == INSTALL_PACKAGES_SETTINGS_REQUEST) {
            recordInstallPermission();
            nextPermission();
            return;
        }
        if (code == 902 && result == RESULT_OK && data != null && data.getData() != null) {
            int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContentResolver().takePersistableUriPermission(data.getData(), flags);
            getSharedPreferences("aict", MODE_PRIVATE).edit().putString("treeUri", data.getData().toString()).apply();
            message.setText("已保留目录授权：" + data.getData());
        }
    }
}
