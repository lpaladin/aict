package dev.aict.container;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.webkit.CookieManager;
import android.widget.*;
import android.view.*;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import org.json.JSONObject;
import java.io.*;
import java.lang.reflect.Method;
import java.net.*;
import java.util.*;
import java.util.concurrent.Executor;

public final class MainActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private TextView status;
    private WebView web;
    private WebView home;
    private FrameLayout pages;
    private LinearLayout tabs;
    private TextView title;
    private ImageButton back, forward, reload;
    private LinearLayout homeChip, topBar, bottomBar;
    private TextView homeLabel;
    private View connectionDot, topDivider, bottomDivider;
    private HorizontalScrollView tabScroll;
    private ProgressBar progressBar;
    private boolean dark;
    private int surface, ink, muted, accent, selected, divider;
    private final HashMap<WebView, TabItem> tabItems = new HashMap<>();
    private final HashSet<WebView> loading = new HashSet<>();
    private boolean entryLoaded;
    private int appliedProxy;
    private boolean applyingProxy;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest webPermission;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private final ArrayList<WebView> windows = new ArrayList<>();
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            status.setText(ConnectionService.status);
            updateConnectionIndicator();
            if (ConnectionService.connected && appliedProxy != ConnectionService.proxyPort && !applyingProxy) applyProxy();
            main.postDelayed(this, 1000);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        NativeRuntime.activity = this;
        readPalette();
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        status = new TextView(this);
        topBar = new LinearLayout(this); topBar.setGravity(Gravity.CENTER_VERTICAL); topBar.setPadding(dp(8),0,dp(4),0);
        homeChip = new LinearLayout(this); homeChip.setGravity(Gravity.CENTER); homeChip.setPadding(dp(10),0,dp(10),0);
        homeChip.setOnClickListener(v -> select(home)); homeChip.setContentDescription("Codex，固定标签页");
        homeLabel = text("Codex",14); homeLabel.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL)); homeChip.addView(homeLabel);
        connectionDot = new View(this); LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(6),dp(6)); dotParams.leftMargin=dp(7); homeChip.addView(connectionDot,dotParams);
        // The visual pill is 34dp tall; its parent retains a 48dp touch target.
        FrameLayout homeTarget = new FrameLayout(this); homeTarget.setOnClickListener(v -> select(home));
        homeTarget.setContentDescription("切换到 Codex，长按查看连接状态");
        FrameLayout.LayoutParams chipParams = new FrameLayout.LayoutParams(-1,dp(34),Gravity.CENTER);
        homeTarget.addView(homeChip,chipParams); topBar.addView(homeTarget,new LinearLayout.LayoutParams(dp(86),dp(48)));
        View.OnLongClickListener connectionDetails = v -> { new AlertDialog.Builder(this).setTitle("连接状态").setMessage(status.getText()).setPositiveButton("确定",null).show(); return true; };
        homeChip.setOnLongClickListener(connectionDetails); homeTarget.setOnLongClickListener(connectionDetails);
        title = text("",13); title.setGravity(Gravity.CENTER); title.setPadding(dp(8),0,dp(8),0);
        title.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        topBar.addView(title,new LinearLayout.LayoutParams(0,-1,1)); title.setOnLongClickListener(connectionDetails);
        back = iconButton("back","后退",v -> { if(web!=null && web.canGoBack()) web.goBack(); });
        forward = iconButton("forward","前进",v -> { if(web!=null && web.canGoForward()) web.goForward(); });
        reload = iconButton("reload","刷新",v -> { if(web==null)return; if(loading.contains(web)){web.stopLoading();loading.remove(web);updateNavigation();}else web.reload(); });
        reload.setOnLongClickListener(v -> {
            if (web == null) return true;
            web.stopLoading();
            web.clearCache(true);
            web.reload();
            Toast.makeText(this,"已清除网页缓存，正在重新加载",Toast.LENGTH_SHORT).show();
            return true;
        });
        topBar.addView(back,new LinearLayout.LayoutParams(dp(44),dp(48)));
        topBar.addView(forward,new LinearLayout.LayoutParams(dp(44),dp(48)));
        topBar.addView(reload,new LinearLayout.LayoutParams(dp(44),dp(48)));
        root.addView(topBar,new LinearLayout.LayoutParams(-1,dp(48)));
        FrameLayout progressTrack = new FrameLayout(this);
        topDivider = new View(this); progressTrack.addView(topDivider,new FrameLayout.LayoutParams(-1,dp(1),Gravity.BOTTOM));
        progressBar = new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal); progressBar.setMax(100);
        progressBar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
        progressTrack.addView(progressBar,new FrameLayout.LayoutParams(-1,-1)); root.addView(progressTrack,new LinearLayout.LayoutParams(-1,dp(2)));
        pages = new FrameLayout(this); root.addView(pages, new LinearLayout.LayoutParams(-1, 0, 1));
        bottomDivider = new View(this); root.addView(bottomDivider,new LinearLayout.LayoutParams(-1,dp(1)));
        bottomBar = new LinearLayout(this); bottomBar.setGravity(Gravity.CENTER_VERTICAL); bottomBar.setPadding(dp(4),0,dp(4),0);
        bottomBar.addView(iconButton("settings","设置",v -> startActivity(new Intent(this,PermissionsActivity.class))),new LinearLayout.LayoutParams(dp(48),dp(52)));
        tabScroll = new HorizontalScrollView(this); tabScroll.setHorizontalScrollBarEnabled(false); tabScroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        tabs = new LinearLayout(this); tabs.setGravity(Gravity.CENTER_VERTICAL); tabs.setPadding(dp(2),0,dp(4),0);
        tabScroll.addView(tabs,new HorizontalScrollView.LayoutParams(-2,-1)); bottomBar.addView(tabScroll,new LinearLayout.LayoutParams(0,-1,1));
        root.addView(bottomBar,new LinearLayout.LayoutParams(-1,dp(52)));
        setContentView(root); applyPalette();
        home = createWebView(); addTab(home);
        web.loadDataWithBaseURL("https://aict.invalid/", "<meta name='viewport' content='width=device-width,initial-scale=1'><style>:root{color-scheme:light dark}body{margin:0;background:#fafbfc;color:#202124;font:15px system-ui}main{max-width:420px;margin:22vh auto 0;padding:32px}small{color:#356ae6;letter-spacing:3px;font-size:11px;font-weight:600}h1{font-size:30px;font-weight:550;letter-spacing:-1px;margin:14px 0}p{color:#747980;line-height:1.8;font-size:14px}.line{height:3px;width:32px;background:#356ae6;border-radius:3px;margin:24px 0}@media(prefers-color-scheme:dark){body{background:#15171b;color:#e8eaed}p{color:#9aa0aa}small{color:#a7c3ff}}</style><main><h1>AIct</h1><div class='line'></div><p>正在连接，完成后将打开 Codex。</p><p>你可以先从左下角设置中配置权限。<br>长按左上角 Codex 查看连接状态。</p></main>", "text/html", "UTF-8", null);
        startForegroundService(new Intent(this, ConnectionService.class));
        main.post(tick);
        if (!getPreferences(MODE_PRIVATE).getBoolean("onboarded", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("onboarded", true).apply();
            startActivity(new Intent(this, PermissionsActivity.class));
        }
    }

    private WebView createWebView() {
        WebView w = new WebView(this);
        WebSettings settings = w.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(true); settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        w.addJavascriptInterface(new Object() {
            @JavascriptInterface public void request(String json) {
                NativeRuntime.dispatch(MainActivity.this, json, result -> main.post(() -> {
                    if (!windows.contains(w)) return;
                    String js = "window.postMessage({__aictResponse:" + result + "},'*');";
                    w.evaluateJavascript(js, null);
                }));
            }
        }, "AICTNative");
        final boolean contextAtDocumentStart = installCopyContext(w);
        try {
            String sdk = asset("phone.js");
            Class<?> compat = Class.forName("androidx.webkit.WebViewCompat");
            compat.getMethod("addDocumentStartJavaScript", WebView.class, String.class, Set.class)
                .invoke(null, w, sdk, Collections.singleton("*"));
        } catch (Exception e) { android.util.Log.w("AICT", "Document-start injection unavailable; page-finish fallback enabled", e); }
        w.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view,String url,Bitmap icon) { loading.add(view); updateNavigation(); }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) { updateTabs(); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                catch (Exception e) { status.setText(e.toString()); }
                return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                loading.remove(view);
                try { view.evaluateJavascript(asset("phone.js"), null); }
                catch (Exception e) { status.setText(e.toString()); }
                if (!contextAtDocumentStart) {
                    try { view.evaluateJavascript(asset("webview-copy-context.js"), null); }
                    catch (IOException e) { android.util.Log.w("AICT", "Copy context script unavailable", e); }
                }
                CookieManager.getInstance().flush();
                updateTabs();
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView view, String value) { updateTabs(); }
            @Override public void onReceivedIcon(WebView view,Bitmap icon) { updateTabs(); }
            @Override public void onProgressChanged(WebView view, int progress) { if(progress==100)loading.remove(view); updateNavigation(); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), 901); return true; }
                catch (Exception e) { fileCallback = null; return false; }
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                main.post(() -> {
                    if(webPermission!=null)webPermission.deny();
                    webPermission=request;
                    ArrayList<String> missing=new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)&&checkSelfPermission("android.permission.CAMERA")!=PackageManager.PERMISSION_GRANTED)missing.add("android.permission.CAMERA");
                        if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)&&checkSelfPermission("android.permission.RECORD_AUDIO")!=PackageManager.PERMISSION_GRANTED)missing.add("android.permission.RECORD_AUDIO");
                    }
                    if(missing.isEmpty())grantWebPermission();else requestPermissions(missing.toArray(new String[0]),903);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request){if(webPermission==request)webPermission=null;}
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if(checkSelfPermission("android.permission.ACCESS_FINE_LOCATION")==PackageManager.PERMISSION_GRANTED || checkSelfPermission("android.permission.ACCESS_COARSE_LOCATION")==PackageManager.PERMISSION_GRANTED){callback.invoke(origin,true,false);return;}
                if(locationCallback!=null)locationCallback.invoke(locationOrigin,false,false);
                locationCallback=callback;locationOrigin=origin;
                requestPermissions(new String[]{"android.permission.ACCESS_COARSE_LOCATION","android.permission.ACCESS_FINE_LOCATION"},904);
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, Message result) {
                WebView popup = createWebView();
                addTab(popup);
                ((WebView.WebViewTransport) result.obj).setWebView(popup); result.sendToTarget(); return true;
            }
            @Override public void onCloseWindow(WebView window) { closePopup(window); }
        });
        w.setOnLongClickListener(v -> {
            WebView.HitTestResult hit = w.getHitTestResult();
            if(hit.getType()!=WebView.HitTestResult.SRC_ANCHOR_TYPE && hit.getType()!=WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) return false;
            Handler handler = new Handler(Looper.getMainLooper()) {
                @Override public void handleMessage(Message msg) {
                    String link = msg.getData().getString("url"); if(link==null) link=hit.getExtra();
                    if(link==null) return; final String url=link;
                    showLinkMenu(url);
                }
            };
            w.requestFocusNodeHref(handler.obtainMessage()); return true;
        });
        w.setDownloadListener((url, ua, disposition, mime, length) -> {
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                w.evaluateJavascript("phone.saveUrl("+JSONObject.quote(url)+").catch(function(e){console.error(e);})",null);
            } else {
                try { JSONObject params=new JSONObject().put("url",url).put("name",URLUtil.guessFileName(url,disposition,mime)).put("headers",new JSONObject().put("User-Agent",ua));
                    DownloadEngine.start(this,params,result->main.post(()->{
                        if(result.optString("type").equals("event"))return;
                        String message=result.optBoolean("ok")?"下载完成："+result.optJSONObject("result").optString("path"):result.optString("error");
                        Toast.makeText(this,message,Toast.LENGTH_LONG).show();
                    }),java.util.UUID.randomUUID().toString());
                } catch(Exception e){status.setText(e.toString());}
            }
        });
        return w;
    }

    private void applyProxy() {
        applyingProxy = true;
        final int port = ConnectionService.proxyPort;
        try {
            Class<?> features = Class.forName("androidx.webkit.WebViewFeature");
            if (!(Boolean) features.getMethod("isFeatureSupported", String.class).invoke(null, "PROXY_OVERRIDE")) throw new IllegalStateException("WebView does not support PROXY_OVERRIDE; update Android System WebView");
            Class<?> builderClass = Class.forName("androidx.webkit.ProxyConfig$Builder");
            Object builder = builderClass.getConstructor().newInstance();
            builderClass.getMethod("addProxyRule", String.class).invoke(builder, "http://127.0.0.1:" + port);
            builderClass.getMethod("removeImplicitRules").invoke(builder);
            Object proxyConfig = builderClass.getMethod("build").invoke(builder);
            Class<?> controllerClass = Class.forName("androidx.webkit.ProxyController");
            Object controller = controllerClass.getMethod("getInstance").invoke(null);
            controllerClass.getMethod("setProxyOverride", Class.forName("androidx.webkit.ProxyConfig"), Executor.class, Runnable.class)
                .invoke(controller, proxyConfig, (Executor) main::post, (Runnable) () -> {
                    appliedProxy = port; applyingProxy = false;
                    if (!entryLoaded && ConnectionService.config != null) { entryLoaded=true; home.loadUrl(ConnectionService.config.optString("entryUrl")); }
                });
        } catch (Exception e) {
            applyingProxy = false;
            status.setText("代理初始化失败：" + e.getMessage());
            android.util.Log.e("AICT", "Proxy configuration failed", e);
        }
    }

    private void grantWebPermission(){
        PermissionRequest request=webPermission;webPermission=null;if(request==null)return;
        ArrayList<String> allowed=new ArrayList<>();
        for(String resource:request.getResources()){
            if(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)&&checkSelfPermission("android.permission.CAMERA")==PackageManager.PERMISSION_GRANTED)allowed.add(resource);
            if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)&&checkSelfPermission("android.permission.RECORD_AUDIO")==PackageManager.PERMISSION_GRANTED)allowed.add(resource);
        }
        if(allowed.isEmpty())request.deny();else request.grant(allowed.toArray(new String[0]));
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){
        super.onRequestPermissionsResult(code,permissions,results);
        if(code==903)grantWebPermission();
        if(code==904&&locationCallback!=null){locationCallback.invoke(locationOrigin,checkSelfPermission("android.permission.ACCESS_FINE_LOCATION")==PackageManager.PERMISSION_GRANTED||checkSelfPermission("android.permission.ACCESS_COARSE_LOCATION")==PackageManager.PERMISSION_GRANTED,false);locationCallback=null;}
    }
    private boolean installCopyContext(WebView view) {
        try {
            Class<?> compat = Class.forName("androidx.webkit.WebViewCompat");
            compat.getMethod("addDocumentStartJavaScript", WebView.class, String.class, Set.class)
                .invoke(null, view, asset("webview-copy-context.js"), Collections.singleton("*"));
            return true;
        } catch (Exception e) {
            android.util.Log.w("AICT", "Copy context will load after navigation", e);
            return false;
        }
    }

    private String asset(String name) throws IOException {
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = input.read(buffer)) != -1) out.write(buffer, 0, n);
            return out.toString("UTF-8");
        }
    }
    private void closePopup(WebView window) {
        if (window == home || !windows.contains(window)) return;
        int index=windows.indexOf(window); windows.remove(window); pages.removeView(window);
        loading.remove(window); TabItem item=tabItems.remove(window); if(item!=null)tabs.removeView(item.container);
        window.removeJavascriptInterface("AICTNative"); window.destroy();
        if(web==window) select(windows.get(Math.max(0,index-1))); else updateTabs();
    }
    private void addTab(WebView tab) { windows.add(tab); pages.addView(tab,new FrameLayout.LayoutParams(-1,-1)); select(tab); }
    private void select(WebView tab) {
        if(tab==null || !windows.contains(tab)) return; web=tab;
        for(WebView w:windows) w.setVisibility(w==tab?View.VISIBLE:View.GONE);
        updateTabs();
        if(tab!=home) tabScroll.post(() -> {
            TabItem item=tabItems.get(tab); if(item==null || web!=tab)return;
            int left=item.container.getLeft()-dp(4),right=item.container.getRight()+dp(4);
            int scroll=tabScroll.getScrollX();
            if(left<scroll)tabScroll.smoothScrollTo(Math.max(0,left),0);
            else if(right>scroll+tabScroll.getWidth())tabScroll.smoothScrollTo(right-tabScroll.getWidth(),0);
        });
    }
    private String tabTitle(WebView tab) { String value=tab.getTitle(); return value==null || value.trim().isEmpty()?"新标签页":value; }
    private void updateTabs() {
        if(web==null || tabs==null) return;
        title.setText(web==home && !entryLoaded?"工作空间":tabTitle(web));
        homeChip.setBackground(touchBackground(web==home?selected:Color.TRANSPARENT,12));
        homeLabel.setTextColor(web==home?accent:ink); homeChip.setSelected(web==home);
        updateNavigation();
        for(WebView tab:windows) {
            if(tab==home) continue;
            TabItem item=tabItems.get(tab);
            if(item==null){item=new TabItem(tab);tabItems.put(tab,item);tabs.addView(item.container);}
            item.label.setText(tabTitle(tab)); item.label.setTextColor(tab==web?ink:muted);
            item.container.setSelected(tab==web); item.container.setContentDescription(tabTitle(tab)+(tab==web?"，当前标签页":"，点击切换"));
            item.pill.setBackground(touchBackground(tab==web?selected:Color.TRANSPARENT,12));
            Bitmap favicon=tab.getFavicon(); if(favicon!=null)item.icon.setImageBitmap(favicon);else item.icon.setImageDrawable(new LineIcon("globe",tab==web?accent:muted));
            item.close.setImageDrawable(new LineIcon("close",tab==web?accent:muted));
            item.close.setContentDescription("关闭 "+tabTitle(tab));
        }
    }

    private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private void showLinkMenu(String url){
        Dialog dialog=new Dialog(this);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout sheet=new LinearLayout(this);sheet.setOrientation(LinearLayout.VERTICAL);sheet.setPadding(dp(20),dp(12),dp(20),dp(20));
        GradientDrawable background=rounded(surface,0);float radius=dp(20);background.setCornerRadii(new float[]{radius,radius,radius,radius,0,0,0,0});sheet.setBackground(background);
        View handle=new View(this);handle.setBackground(rounded(divider,2));LinearLayout.LayoutParams handleParams=new LinearLayout.LayoutParams(dp(32),dp(4));handleParams.gravity=Gravity.CENTER_HORIZONTAL;handleParams.bottomMargin=dp(20);sheet.addView(handle,handleParams);
        String host=Uri.parse(url).getHost();TextView heading=text(host==null?"链接":host,16);heading.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));sheet.addView(heading);
        TextView address=text(url,12);address.setTextColor(muted);address.setPadding(0,dp(6),0,dp(18));sheet.addView(address);
        TextView open=text("在新标签页打开",15);open.setGravity(Gravity.CENTER_VERTICAL);open.setPadding(dp(12),0,dp(12),0);open.setTextColor(accent);open.setBackground(touchBackground(selected,12));sheet.addView(open,new LinearLayout.LayoutParams(-1,dp(52)));
        open.setOnClickListener(v->{dialog.dismiss();WebView tab=createWebView();addTab(tab);tab.loadUrl(url);});
        TextView copy=text("复制链接",15);copy.setGravity(Gravity.CENTER_VERTICAL);copy.setPadding(dp(12),0,dp(12),0);copy.setBackground(touchBackground(Color.TRANSPARENT,12));LinearLayout.LayoutParams copyParams=new LinearLayout.LayoutParams(-1,dp(52));copyParams.topMargin=dp(6);sheet.addView(copy,copyParams);
        copy.setOnClickListener(v->{((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("链接",url));dialog.dismiss();if(Build.VERSION.SDK_INT<33)Toast.makeText(this,"链接已复制",Toast.LENGTH_SHORT).show();});
        dialog.setContentView(sheet);Window window=dialog.getWindow();if(window!=null){window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.28f);window.setGravity(Gravity.BOTTOM);window.setNavigationBarColor(surface);}
        dialog.show();if(window!=null)window.setLayout(-1,-2);
    }
    private TextView text(String value,int size){
        TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(ink);
        view.setSingleLine(true);view.setEllipsize(android.text.TextUtils.TruncateAt.END);return view;
    }
    private GradientDrawable rounded(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private Drawable touchBackground(int color,int radius){return new RippleDrawable(ColorStateList.valueOf(dark?0x26ffffff:0x18356ae6),rounded(color,radius),rounded(Color.WHITE,radius));}
    private ImageButton iconButton(String kind,String description,View.OnClickListener listener){
        ImageButton b=new ImageButton(this);b.setImageDrawable(new LineIcon(kind,muted));b.setScaleType(ImageView.ScaleType.CENTER);
        b.setBackground(touchBackground(Color.TRANSPARENT,12));b.setContentDescription(description);b.setOnClickListener(listener);
        if(Build.VERSION.SDK_INT>=26)b.setTooltipText(description);return b;
    }
    private void readPalette(){
        dark=(getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES;
        surface=dark?0xff191c21:0xfff6f7f9;ink=dark?0xffe8eaed:0xff202124;muted=dark?0xff9aa0aa:0xff747980;
        accent=dark?0xffa7c3ff:0xff356ae6;selected=dark?0xff283750:0xffe8f0fe;divider=dark?0xff2c3037:0xffe5e7eb;
    }
    private void applyPalette(){
        root.setBackgroundColor(surface);topBar.setBackgroundColor(surface);bottomBar.setBackgroundColor(surface);
        title.setTextColor(ink);topDivider.setBackgroundColor(divider);bottomDivider.setBackgroundColor(divider);
        progressBar.setProgressTintList(ColorStateList.valueOf(accent));
        back.setImageDrawable(new LineIcon("back",muted));forward.setImageDrawable(new LineIcon("forward",muted));
        back.setBackground(touchBackground(Color.TRANSPARENT,12));forward.setBackground(touchBackground(Color.TRANSPARENT,12));reload.setBackground(touchBackground(Color.TRANSPARENT,12));
        ImageButton settings=(ImageButton)bottomBar.getChildAt(0);settings.setImageDrawable(new LineIcon("settings",muted));settings.setBackground(touchBackground(Color.TRANSPARENT,12));
        for(TabItem item:tabItems.values())item.close.setBackground(touchBackground(Color.TRANSPARENT,12));
        getWindow().setStatusBarColor(surface);getWindow().setNavigationBarColor(surface);
        int flags=getWindow().getDecorView().getSystemUiVisibility();
        if(Build.VERSION.SDK_INT>=23)flags=dark?flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR:flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if(Build.VERSION.SDK_INT>=26)flags=dark?flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR:flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        updateConnectionIndicator();updateTabs();
    }
    private void updateConnectionIndicator(){
        if(connectionDot==null)return;
        connectionDot.setBackground(rounded(ConnectionService.connected?(dark?0xff72d6a3:0xff259b66):(dark?0xffe6b86a:0xffc28a32),3));
        homeChip.setContentDescription("Codex，固定标签页，"+ConnectionService.status+"，长按查看详情");
    }
    private void updateNavigation(){
        if(web==null || reload==null)return;
        back.setEnabled(web.canGoBack());forward.setEnabled(web.canGoForward());
        back.setAlpha(back.isEnabled()?1f:.3f);forward.setAlpha(forward.isEnabled()?1f:.3f);
        boolean busy=loading.contains(web);reload.setImageDrawable(new LineIcon(busy?"stop":"reload",muted));reload.setContentDescription(busy?"停止加载":"刷新");
        if(Build.VERSION.SDK_INT>=26)reload.setTooltipText(busy?"停止加载":"刷新");
        progressBar.setProgress(web.getProgress());progressBar.setVisibility(busy?View.VISIBLE:View.INVISIBLE);
    }
    @Override public void onConfigurationChanged(Configuration configuration){super.onConfigurationChanged(configuration);readPalette();applyPalette();}
    private final class TabItem {
        final FrameLayout container;final LinearLayout pill;final TextView label;final ImageView icon;final ImageButton close;
        TabItem(WebView tab){
            container=new FrameLayout(MainActivity.this);LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-2,-1);params.rightMargin=dp(4);container.setLayoutParams(params);
            container.setOnClickListener(v->select(tab));
            pill=new LinearLayout(MainActivity.this);pill.setGravity(Gravity.CENTER_VERTICAL);pill.setPadding(dp(12),0,0,0);
            container.addView(pill,new FrameLayout.LayoutParams(-1,dp(36),Gravity.CENTER));
            pill.setOnClickListener(v->select(tab));
            icon=new ImageView(MainActivity.this);icon.setScaleType(ImageView.ScaleType.FIT_CENTER);pill.addView(icon,new LinearLayout.LayoutParams(dp(16),dp(16)));
            label=text("",12);label.setMinWidth(dp(36));label.setMaxWidth(dp(132));label.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
            LinearLayout.LayoutParams labelParams=new LinearLayout.LayoutParams(-2,-2);labelParams.leftMargin=dp(8);labelParams.rightMargin=dp(40);pill.addView(label,labelParams);
            close=iconButton("close","关闭标签页",v->closePopup(tab));
            // Full-height overlay keeps the close target larger than the visual pill.
            container.addView(close,new FrameLayout.LayoutParams(dp(40),-1,Gravity.RIGHT));
        }
    }
    /** Small consistent vector icons, independent of fonts or platform button styling. */
    private final class LineIcon extends Drawable {
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final String kind;
        LineIcon(String kind,int color){this.kind=kind;paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.7f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);}
        @Override public int getIntrinsicWidth(){return dp(20);}@Override public int getIntrinsicHeight(){return dp(20);}
        private void line(Canvas c,float x,float y,float xx,float yy){c.drawLine(x,y,xx,yy,paint);}
        @Override public void draw(Canvas c){
            Rect b=getBounds();c.save();c.translate(b.left,b.top);c.scale(b.width()/24f,b.height()/24f);
            if(kind.equals("back")||kind.equals("forward")){if(kind.equals("forward")){c.translate(24,0);c.scale(-1,1);}line(c,14.5f,5,7.5f,12);line(c,7.5f,12,14.5f,19);}
            else if(kind.equals("close")){line(c,8,8,16,16);line(c,16,8,8,16);}
            else if(kind.equals("stop")){c.drawRoundRect(6,6,18,18,2,2,paint);}
            else if(kind.equals("reload")){c.drawArc(4.5f,4.5f,19.5f,19.5f,42,290,false,paint);line(c,19.5f,4,19.5f,9);line(c,19.5f,9,14.5f,9);}
            else if(kind.equals("globe")){c.drawCircle(12,12,8,paint);c.drawOval(8,4,16,20,paint);line(c,4,12,20,12);}
            else if(kind.equals("settings")){
                c.drawCircle(12,12,3,paint);Path p=new Path();
                for(int i=0;i<48;i++){double a=i*Math.PI/24;float r=(i%6==0||i%6==5)?8.1f:9.7f;float x=12+(float)Math.cos(a)*r,y=12+(float)Math.sin(a)*r;if(i==0)p.moveTo(x,y);else p.lineTo(x,y);}p.close();c.drawPath(p,paint);
            }
            c.restore();
        }
        @Override public void setAlpha(int alpha){paint.setAlpha(alpha);invalidateSelf();}
        @Override public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);invalidateSelf();}
        @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 901 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null;
        }
    }
    @Override protected void onResume() { super.onResume(); NativeRuntime.activity = this; }
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else if (web != home) closePopup(web); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        main.removeCallbacks(tick);
        if (NativeRuntime.activity == this) NativeRuntime.activity = null;
        if (webPermission != null) webPermission.deny();
        if (locationCallback != null) locationCallback.invoke(locationOrigin,false,false);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        for (WebView window : windows) { window.removeJavascriptInterface("AICTNative"); window.destroy(); }
        windows.clear(); super.onDestroy();
    }
}
