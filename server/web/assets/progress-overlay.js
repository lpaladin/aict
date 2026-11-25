/* AutoJs6/Rhino native script, fetched as text by progress-controller.js. ES5 only. */
var statePath = args.path, owner = args.owner, last = null, windowView = null;
var dismissed = !args.overlay, stopped = false, finishAt = 0, rendered = '', submitting = false;
var density = context.getResources().getDisplayMetrics().density;
var widthDp = Math.min(304, Math.floor(device.width / density) - 24);
var manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
var notificationId = 0x60000000 + (Math.abs(new java.lang.String(owner).hashCode()) % 0x0fffffff);
var notified = '', warned = false, controls = [], outgoing = [];
function dp(n) { return Math.round(n * density); }
function screenArea() {
    var metrics = new android.util.DisplayMetrics();
    context.getSystemService(android.content.Context.WINDOW_SERVICE).getDefaultDisplay().getRealMetrics(metrics);
    var top = 0, bottom = 0, left = 0, right = 0;
    try {
        var insets = windowView.card.getRootWindowInsets();
        var bars = insets.getInsetsIgnoringVisibility(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
        top = bars.top; bottom = bars.bottom; left = bars.left; right = bars.right;
    } catch (_) {
        var resources = context.getResources();
        var statusId = resources.getIdentifier('status_bar_height', 'dimen', 'android');
        var navId = resources.getIdentifier('navigation_bar_height', 'dimen', 'android');
        top = statusId ? resources.getDimensionPixelSize(statusId) : dp(28);
        bottom = navId ? resources.getDimensionPixelSize(navId) : dp(24);
    }
    // Some raw overlay windows report zero system-bar insets even with visible bars.
    var res = context.getResources();
    var statusResource = res.getIdentifier('status_bar_height', 'dimen', 'android');
    var navResource = res.getIdentifier('navigation_bar_height', 'dimen', 'android');
    top = Math.max(top, statusResource ? res.getDimensionPixelSize(statusResource) : dp(28));
    bottom = Math.max(bottom, navResource ? res.getDimensionPixelSize(navResource) : dp(24));
    return {left: left + dp(12), top: top + dp(12), right: metrics.widthPixels - right - dp(12), bottom: metrics.heightPixels - bottom - dp(12)};
}
function placeOverlay(x, y) {
    if (!windowView) return;
    var area = screenArea(), card = windowView.card;
    var targetWidth = Math.min(dp(304), area.right - area.left);
    if (Math.abs(card.getWidth() - targetWidth) > 1) windowView.setSize(targetWidth, -2);
    var scrollParams = windowView.scroller.getLayoutParams();
    var scrollHeight = Math.max(dp(44), Math.min(dp(280), Math.floor((area.bottom - area.top) * 0.38), area.bottom - area.top - dp(200)));
    if (scrollParams.height !== scrollHeight) { scrollParams.height = scrollHeight; windowView.scroller.setLayoutParams(scrollParams); }
    var width = card.getWidth() || dp(widthDp), height = card.getHeight();
    if (!height) return;
    // Convert Android overlay window coordinates to physical screen coordinates.
    var location = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, 2);
    card.getLocationOnScreen(location);
    var offsetX = location[0] - windowView.getX(), offsetY = location[1] - windowView.getY();
    var minX = area.left - offsetX, minY = area.top - offsetY;
    var maxX = Math.max(minX, area.right - width - offsetX), maxY = Math.max(minY, area.bottom - height - offsetY);
    var nextX = Math.round(Math.max(minX, Math.min(maxX, x))), nextY = Math.round(Math.max(minY, Math.min(maxY, y)));
    if (nextX !== windowView.getX() || nextY !== windowView.getY()) windowView.setPosition(nextX, nextY);
}
function styleCard() {
    var background = new android.graphics.drawable.GradientDrawable();
    background.setColor(android.graphics.Color.parseColor('#F522382D'));
    background.setCornerRadius(dp(18)); background.setStroke(dp(1), android.graphics.Color.parseColor('#557DA58B'));
    windowView.card.setBackground(background); windowView.card.setClipToOutline(true);
    windowView.card.setElevation(dp(8));
    windowView.dismiss.setContentDescription('关闭悬浮窗');
}
function emit(type, extra) {
    var data = {owner: owner, type: type};
    for (var key in extra) data[key] = extra[key];
    outgoing.push(data);
}
function cancelNotice() { try { manager.cancel(notificationId); } catch (_) {} notified = ''; }
function launchIntent() {
    var intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP);
    return intent;
}
function openApp() { try { context.startActivity(launchIntent()); } catch (e) { toast('请从桌面打开 AIct 处理请求'); } }
function notifyPending(request) {
    if (!request || notified === request.id) return;
    try {
        if (!manager.areNotificationsEnabled()) throw Error('AIct 通知已被系统关闭，请在通知设置中开启');
        var channel = 'aict.codex.input';
        manager.createNotificationChannel(new android.app.NotificationChannel(channel, 'Codex 等待输入', android.app.NotificationManager.IMPORTANCE_HIGH));
        var pi = android.app.PendingIntent.getActivity(context, notificationId, launchIntent(), android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        var builder = new android.app.Notification.Builder(context, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(String(request.title))
            .setContentText(String(request.sessionName || '当前会话') + ' · 点按打开 AIct 处理')
            .setContentIntent(pi).setAutoCancel(true).setOnlyAlertOnce(true)
            .setVisibility(android.app.Notification.VISIBILITY_PRIVATE)
            .setCategory(android.app.Notification.CATEGORY_MESSAGE);
        var publicVersion = new android.app.Notification.Builder(context, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle('Codex 需要你的输入').setContentText('打开 AIct 处理待办请求').build();
        builder.setPublicVersion(publicVersion);
        manager.notify(notificationId, builder.build()); notified = request.id;
    } catch (error) { if (!warned) { emit('warning', {message: String(error)}); warned = true; } }
}
function closeOverlay() {
    dismissed = true;
    try { if (windowView) windowView.close(); } catch (_) {}
    windowView = null;
    if (last && last.interaction) notifyPending(last.interaction);
}
function textView(text, size, color) {
    var view = new android.widget.TextView(context); view.setText(String(text)); view.setTextSize(size || 13);
    view.setTextColor(android.graphics.Color.parseColor(color || '#ffffff')); view.setPadding(0, dp(5), 0, dp(5));
    return view;
}
function button(label, listener) {
    var view = new android.widget.Button(context); view.setText(String(label)); view.setTextSize(13);
    view.setMinHeight(dp(44));
    var params = new android.widget.LinearLayout.LayoutParams(-1, -2);
    params.topMargin = dp(6); view.setLayoutParams(params);
    view.setPadding(dp(12), dp(6), dp(12), dp(6)); view.setMinimumHeight(dp(44)); view.setAllCaps(false);
    view.setOnClickListener(new android.view.View.OnClickListener({onClick: listener})); controls.push(view);
    return view;
}
function respond(request, result) {
    if (submitting || !last || !last.interaction || last.interaction.id !== request.id || Date.now() - last.updated > 45000) {
        toast('连接或请求已变化，请返回 AIct 确认'); return;
    }
    submitting = true;
    for (var i = 0; i < controls.length; i++) controls[i].setEnabled(false);
    windowView.hint.setText('正在提交…');
    try { windowView.disableFocus(); } catch (_) {}
    emit('response', {requestId: request.id, result: result});
}
function renderRequest(request, revision) {
    var box = windowView.requestBox; box.removeAllViews(); controls = []; submitting = false;
    windowView.scroller.setVisibility(request ? android.view.View.VISIBLE : android.view.View.GONE);
    windowView.hint.setVisibility(request ? android.view.View.VISIBLE : android.view.View.GONE);
    if (!request) { try { windowView.disableFocus(); } catch (_) {} return; }
    box.addView(textView(request.title, 15, '#d2f3dc'));
    if (request.description) box.addView(textView(request.description, 12, '#e4ece6'));
    if (request.kind === 'approval') {
        if (request.allowAccept) box.addView(button('允许这一次', function () { respond(request, {decision: 'accept'}); }));
        if (request.allowDecline) box.addView(button('拒绝', function () { respond(request, {decision: 'decline'}); }));
    } else if (request.kind === 'input') {
        var fields = [];
        for (var i = 0; i < request.questions.length; i++) (function (question) {
            box.addView(textView(question.question, 13));
            var edit = new android.widget.EditText(context); edit.setTextColor(android.graphics.Color.WHITE);
            edit.setHintTextColor(android.graphics.Color.parseColor('#bcd5c5')); edit.setHint('选择一项或输入回答');
            edit.setTextSize(14); edit.setMinLines(2); edit.setMaxLines(4); edit.setMinimumHeight(dp(48));
            edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            if (question.isSecret) edit.setTransformationMethod(android.text.method.PasswordTransformationMethod.getInstance());
            edit.setOnTouchListener(new android.view.View.OnTouchListener({onTouch: function () { windowView.requestFocus(); return false; }}));
            box.addView(edit); controls.push(edit); fields.push({id: question.id, edit: edit});
            for (var j = 0; j < question.options.length; j++) (function (option) {
                var choice = button(option.label, function () { edit.setText(String(option.label)); windowView.hint.setText('已选择，可修改后提交'); });
                if (option.description) choice.setContentDescription(String(option.label) + '，' + option.description);
                box.addView(choice);
            })(question.options[j]);
        })(request.questions[i]);
        box.addView(button('提交回答', function () {
            var answers = {};
            for (var k = 0; k < fields.length; k++) {
                var value = String(fields[k].edit.getText()).trim();
                if (!value) { toast('请先回答所有问题'); return; }
                answers[fields[k].id] = {answers: [value]};
            }
            respond(request, {answers: answers});
        }));
    }
    box.addView(button('打开 AIct', openApp));
    windowView.hint.setText('请确认内容后操作');
}
if (!dismissed) {
    try {
        var layout = ('<vertical id="card" padding="14 8 14 12"><horizontal id="handle" gravity="center_vertical" h="44"><text id="dragTitle" text="⠿  AIct · Codex" textColor="#ffffff" textSize="13sp" h="44" gravity="center_vertical" layout_weight="1"/><text id="dismiss" text="×" textColor="#ffffff" textSize="22sp" w="44" h="44" gravity="center"/></horizontal><text id="sessionName" marginTop="2" marginBottom="6" textColor="#c8e6d2" textSize="12sp" maxLines="2"/><text id="step" text="正在连接进度…" textColor="#ffffff" textSize="13sp" maxLines="3" lineSpacingExtra="2sp"/><scroll id="scroller" h="' + Math.min(280, Math.floor(device.height / density * 0.38)) + '" visibility="gone"><vertical id="requestBox"/></scroll><text id="hint" textColor="#d9d5ae" textSize="11sp" visibility="gone"/><text id="elapsed" textColor="#bcd5c5" textSize="11sp" marginTop="6"/></vertical>');
        windowView = floaty.rawWindow(new XML(layout)); windowView.setSize(dp(widthDp), -2); windowView.setPosition(dp(16), dp(90)); styleCard();
        windowView.dismiss.on('click', closeOverlay);
        var dx = 0, dy = 0, wx = 0, wy = 0;
        var dragListener = new android.view.View.OnTouchListener({onTouch: function (view, event) {
            if (!windowView) return false;
            if (event.getAction() === 0) { dx = event.getRawX(); dy = event.getRawY(); wx = windowView.getX(); wy = windowView.getY(); return true; }
            if (event.getAction() === 2) { placeOverlay(wx + event.getRawX() - dx, wy + event.getRawY() - dy); return true; }
            return true;
        }});
        windowView.handle.setOnTouchListener(dragListener);
        windowView.dragTitle.setOnTouchListener(dragListener);
        windowView.card.addOnLayoutChangeListener(new android.view.View.OnLayoutChangeListener({onLayoutChange: function () {
            if (windowView) placeOverlay(windowView.getX(), windowView.getY());
        }}));
    } catch (error) { dismissed = true; windowView = null; emit('warning', {message: String(error)}); }
}
// This native timer keeps running when Android pauses WebView JavaScript.
var serverConfirmed = 0, remoteStep = '', nextPoll = 0;
function pollStatus() {
    if (!last || last.done || !last.statusUrl || Date.now() < nextPoll) return;
    nextPoll = Date.now() + 5000;
    var connection = null, reader = null;
    try {
        var service = java.lang.Class.forName('dev.aict.container.ConnectionService', true, context.getClassLoader());
        var port = service.getField('proxyPort').getInt(null);
        var proxy = new java.net.Proxy(java.net.Proxy.Type.HTTP, new java.net.InetSocketAddress('127.0.0.1', port));
        connection = new java.net.URL(String(last.statusUrl)).openConnection(proxy);
        connection.setConnectTimeout(2000); connection.setReadTimeout(2000);
        if (connection.getResponseCode() !== 200) return;
        reader = new java.io.BufferedReader(new java.io.InputStreamReader(connection.getInputStream(), 'UTF-8'));
        var text = '', line;
        while ((line = reader.readLine()) !== null) { text += String(line); if (text.length > 16000) throw Error('Invalid progress response'); }
        var state = JSON.parse(text);
        if (!state.turnId || state.status === 'unknown') return;
        serverConfirmed = Date.now(); remoteStep = String(state.step || '正在处理请求…');
        if (state.status !== 'running') {
            last.done = true; last.interaction = null; last.step = remoteStep;
            last.updated = serverConfirmed; last.revision = (last.revision || 0) + 1;
        }
    } catch (_) {
        // A failed probe is not proof that the Codex turn ended.
    } finally {
        try { if (reader) reader.close(); } catch (_) {}
        try { if (connection) connection.disconnect(); } catch (_) {}
    }
}
var timer = setInterval(function () {
    while (outgoing.length) aict.emit('codex.interaction', outgoing.shift());
    try { if (files.exists(statePath)) { var data = JSON.parse(files.read(statePath)); if (data.owner === owner && !(last && last.done)) last = data; } } catch (_) {}
    if (!last) return;
    pollStatus();
    var stale = !last.done && Date.now() - Math.max(last.updated, serverConfirmed) > 45000;
    if (last.done) { cancelNotice(); if (!finishAt) finishAt = Date.now() + 5000; }
    if (dismissed && !last.done && !stale) { if (last.interaction) notifyPending(last.interaction); else cancelNotice(); }
    if (windowView) ui.run(function () {
        if (!windowView) return;
        windowView.sessionName.setText(String((last.interaction && last.interaction.sessionName) || last.sessionName || '当前会话'));
        windowView.step.setText(last.done ? String(last.step || '已完成') : stale ? '状态暂未同步 · 打开 AIct 刷新' : String(last.interaction ? '等待你的回答或确认' : remoteStep || last.step));
        windowView.elapsed.setText(last.done ? '5 秒后收起' : '已工作 ' + Math.floor((Date.now() - last.started) / 1000) + ' 秒');
        placeOverlay(windowView.getX(), windowView.getY());
        var key = (last.interaction ? last.interaction.id : '') + ':' + last.revision + ':' + stale;
        if (rendered !== key) { rendered = key; renderRequest(stale || last.done ? null : last.interaction, last.revision); }
    });
    if (stale) cancelNotice();
    if ((finishAt && Date.now() > finishAt) || Date.now() - Math.max(last.updated, serverConfirmed) > 180000) {
        cancelNotice(); clearInterval(timer); try { if (windowView) windowView.close(); } catch (_) {}
        try { files.remove(statePath); } catch (_) {} exit();
    }
}, 600);

