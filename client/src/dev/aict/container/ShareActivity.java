package dev.aict.container;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Parcelable;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;

public final class ShareActivity extends Activity {
    private static final int MAX_BYTES = 50 * 1024 * 1024;
    private TextView status;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle("分享到 AICT");
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        status = new TextView(this);
        status.setTextIsSelectable(true);
        panel.addView(status);
        Button open = new Button(this);
        open.setText("打开 AICT");
        open.setEnabled(false);
        open.setOnClickListener(v -> {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
            finish();
        });
        panel.addView(open);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(panel);
        setContentView(scroll);

        Intent intent = getIntent();
        if (!Intent.ACTION_SEND.equals(intent.getAction()) && !Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            finish();
            return;
        }
        if (state != null) {
            status.setText("导入页面已恢复，请在项目导入目录核对结果。\n" + state.getCharSequence("status"));
            open.setEnabled(true);
            return;
        }
        status.setText("正在连接 AICT 并导入分享内容…");
        startForegroundService(new Intent(this, ConnectionService.class));
        new Thread(() -> {
            importShare(intent);
            runOnUiThread(() -> open.setEnabled(true));
        }, "AICT-Share").start();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putCharSequence("status", status.getText());
        super.onSaveInstanceState(state);
    }

    private void importShare(Intent intent) {
        StringBuilder report = new StringBuilder();
        JSONArray attachments = new JSONArray();
        Set<String> texts = new LinkedHashSet<>();
        try {
            Set<Uri> files = new LinkedHashSet<>();
            Set<String> htmlTexts = new LinkedHashSet<>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                ArrayList<Parcelable> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (streams != null) for (Parcelable stream : streams) if (stream instanceof Uri) files.add((Uri) stream);
            } else {
                Parcelable stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream instanceof Uri) files.add((Uri) stream);
            }
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null && text.length() > 0) texts.add(text.toString());
            ClipData clip = intent.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) {
                ClipData.Item item = clip.getItemAt(i);
                if (item.getUri() != null) files.add(item.getUri());
                if (item.getHtmlText() != null && !item.getHtmlText().isEmpty()) htmlTexts.add(item.getHtmlText());
                if (item.getText() != null && item.getText().length() > 0) texts.add(item.getText().toString());
            }
            String html = intent.getStringExtra(Intent.EXTRA_HTML_TEXT);
            if (html != null && !html.isEmpty()) htmlTexts.add(html);
            if (files.isEmpty() && texts.isEmpty() && htmlTexts.isEmpty()) {
                updateStatus("没有可导入的分享内容。");
                return;
            }

            if (!files.isEmpty() || !htmlTexts.isEmpty()) awaitConnection();

            for (Uri uri : files) {
                String name = "共享附件";
                try {
                    if (!"content".equals(uri.getScheme())) throw new IOException("发送应用未提供可读取的内容 URI");
                    if (checkUriPermission(uri, android.os.Process.myPid(), android.os.Process.myUid(),
                            Intent.FLAG_GRANT_READ_URI_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
                        throw new IOException("发送应用未授予读取权限");
                    }
                    name = displayName(uri);
                    try (InputStream input = getContentResolver().openInputStream(uri)) {
                        if (input == null) throw new IOException("无法读取文件");
                        JSONObject saved = upload(name, input);
                        String mime = intent.getType();
                        try { mime = getContentResolver().getType(uri); }
                        catch (RuntimeException ignored) { /* The stream was already saved. */ }
                        saved.put("mime", mime);
                        attachments.put(saved);
                    }
                } catch (Exception error) {
                    append(report, name + " 导入失败：" + failureMessage(error));
                }
            }
            if (!htmlTexts.isEmpty()) {
                try (InputStream input = new ByteArrayInputStream(String.join("\n", htmlTexts).getBytes(StandardCharsets.UTF_8))) {
                    attachments.put(upload("分享富文本.html", input).put("mime", "text/html"));
                } catch (Exception error) {
                    append(report, "富文本导入失败：" + failureMessage(error));
                }
            }
        } catch (Exception error) {
            append(report, "导入失败：" + failureMessage(error));
        }
        if (texts.isEmpty() && attachments.length() == 0) {
            updateStatus(report.toString());
            return;
        }
        try {
            JSONObject draft = new JSONObject()
                .put("device", ConnectionService.installationId)
                .put("text", String.join("\n\n", texts))
                .put("files", attachments).put("error", report.toString());
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                MainActivity.openSharedDraft(this, draft.toString());
                finish();
            });
        } catch (org.json.JSONException error) {
            updateStatus("无法创建分享草稿。");
        }
    }

    private static void awaitConnection() throws IOException {
        long deadline = SystemClock.elapsedRealtime() + 30_000;
        while (!ConnectionService.connected && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(250);
        if (!ConnectionService.connected) throw new IOException("连接超时，请打开 AICT 检查连接后重新分享。");
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (RuntimeException ignored) {
            // Some content providers expose a stream without file metadata.
        }
        return "共享附件";
    }

    private JSONObject upload(String name, InputStream input) throws Exception {
        File staged = File.createTempFile("aict-share-", ".part", getCacheDir());
        try {
            int size = 0;
            byte[] buffer = new byte[64 * 1024];
            try (OutputStream output = new FileOutputStream(staged)) {
                for (int count; (count = input.read(buffer)) != -1;) {
                    size += count;
                    if (size > MAX_BYTES) throw new IOException("超过单件 50 MiB 上限");
                    output.write(buffer, 0, count);
                }
            }
            return uploadStaged(name, staged, size, buffer);
        } finally {
            staged.delete();
        }
    }

    private JSONObject uploadStaged(String name, File staged, int size, byte[] buffer) throws Exception {
        Uri endpoint = Uri.parse(ConnectionService.config.getString("entryUrl")).buildUpon()
            .clearQuery().fragment(null).path("/api/codex/" + Uri.encode(ConnectionService.installationId) + "/files")
            .appendQueryParameter("name", name).build();
        Proxy proxy = new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", ConnectionService.proxyPort));
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint.toString()).openConnection(proxy);
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/octet-stream");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(size);
            try (InputStream input = new FileInputStream(staged);
                 OutputStream output = connection.getOutputStream()) {
                for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
            }
            int code = connection.getResponseCode();
            if (code != 200) throw new IOException("服务器返回 HTTP " + code);
            try (InputStream response = connection.getInputStream();
                 java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(response, StandardCharsets.UTF_8))) {
                return new JSONObject(reader.readLine());
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void append(StringBuilder report, String message) {
        if (report.length() != 0) report.append('\n');
        report.append(message);
    }

    private static String failureMessage(Exception error) {
        return error instanceof IOException && error.getMessage() != null ? error.getMessage() : "无法读取或上传内容";
    }

    private void updateStatus(String message) {
        runOnUiThread(() -> status.setText(message));
    }
}
