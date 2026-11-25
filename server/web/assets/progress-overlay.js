/* AutoJs6/Rhino native script, fetched as text by progress-controller.js. ES5 only. */
var statePath = args.path, owner = args.owner, last = null, windowView = null;
var snapshot = null, selectedId = null, available = [], positioned = false;
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
    return {left: left + dp(12), top: top + dp(2), right: metrics.widthPixels - right - dp(2), bottom: metrics.heightPixels - bottom - dp(12)};
}
function placeOverlay(x, y) {
    if (!windowView) return;
    var area = screenArea(), card = windowView.card;
    var targetWidth = Math.min(dp(304), area.right - area.left);
    if (Math.abs(card.getWidth() - targetWidth) > 1) windowView.setSize(targetWidth, -2);
    var scrollParams = windowView.scroller.getLayoutParams();
    var scrollHeight = Math.max(dp(44), Math.min(dp(280), Math.floor((area.bottom - area.top) * 0.38), area.bottom - area.top - dp(244)));
    if (scrollParams.height !== scrollHeight) { scrollParams.height = scrollHeight; windowView.scroller.setLayoutParams(scrollParams); }
    var width = targetWidth, height = card.getHeight();
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
    styleHeaderAction(windowView.goToAICT, 'open', '打开 AICT 并选中此会话');
    styleHeaderAction(windowView.dismiss, 'close', '关闭悬浮窗');
}
function styleHeaderAction(view, action, description) {
    // Both glyphs use the same 24-unit grid and a centered 22dp image in a 44dp target.
    var size = dp(22), bitmap = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
    bitmap.setDensity(context.getResources().getDisplayMetrics().densityDpi);
    var canvas = new android.graphics.Canvas(bitmap);
    canvas.scale(size / 24, size / 24);
    var paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    paint.setARGB(255, 225, 239, 230);
    paint.setStyle(android.graphics.Paint.Style.STROKE);
    paint.setStrokeWidth(1.8);
    paint.setStrokeCap(android.graphics.Paint.Cap.ROUND);
    paint.setStrokeJoin(android.graphics.Paint.Join.ROUND);
    var path = new android.graphics.Path();
    if (action === 'open') {
        path.moveTo(12, 5); path.lineTo(6, 5); path.quadTo(4.5, 5, 4.5, 6.5);
        path.lineTo(4.5, 18); path.quadTo(4.5, 19.5, 6, 19.5);
        path.lineTo(17.5, 19.5); path.quadTo(19, 19.5, 19, 18); path.lineTo(19, 12);
        path.moveTo(11, 13); path.lineTo(19.5, 4.5);
        path.moveTo(14, 4.5); path.lineTo(19.5, 4.5); path.lineTo(19.5, 10);
    } else {
        path.moveTo(5.5, 5.5); path.lineTo(18.5, 18.5);
        path.moveTo(18.5, 5.5); path.lineTo(5.5, 18.5);
    }
    canvas.drawPath(path, paint);
    view.setScaleType(android.widget.ImageView.ScaleType.CENTER);
    view.setImageBitmap(bitmap);
    view.setContentDescription(description);
    view.setFocusable(true);
    var mask = new android.graphics.drawable.GradientDrawable();
    mask.setColor(android.graphics.Color.WHITE);
    mask.setCornerRadius(dp(12));
    var rippleColor = android.content.res.ColorStateList.valueOf(android.graphics.Color.parseColor('#305EB780'));
    view.setBackground(new android.graphics.drawable.RippleDrawable(rippleColor, null, mask));
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
function openApp() {
    try { context.startActivity(launchIntent()); }
    catch (_) { toast('请从桌面打开 AIct 处理请求'); }
}
function openSelectedSession() {
    var id = last && last.id;
    openApp();
    if (id) emit('open-thread', {threadId: id});
    // The launcher restores the previous tab. Switch to Codex if another tab was visible.
    function showCodexTab(attempt) {
        try {
            if (!auto.service) return;
            var appPackage = String(context.getPackageName());
            // The pinned Codex shortcut stays visible on every tab.
            if (packageName(appPackage).text('Codex · AIct').findOnce()) return;
            var tab = packageName(appPackage).descStartsWith('切换到 Codex，').findOnce();
            if (tab && tab.click()) return;
            if (attempt < 4) setTimeout(function () { showCodexTab(attempt + 1); }, 250);
        } catch (_) {}
    }
    setTimeout(function () { showCodexTab(0); }, 250);
}
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
    notifyAvailable();
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
    emit('response', {threadId: last.id, requestId: request.id, result: result});
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
        if (request.fullAccessEnabled) {
            box.addView(textView('无限制已启用。其他类型的审批仍需手动处理。', 13, '#ffaca4'));
        } else if (request.canSwitchMode) {
            box.addView(textView('警告：本轮自动批准沙箱外命令，新轮次无沙箱。', 13, '#ffaca4'));
            var confirming = false;
            var switchMode = button('启用无限制', function () {
                if (!last || !last.interaction || last.interaction.id !== request.id || Date.now() - last.updated > 45000) {
                    toast('连接或请求已变化，请返回 AIct 确认'); return;
                }
                if (!confirming) {
                    confirming = true; switchMode.setText('确认启用');
                    windowView.hint.setText('点「确认启用」，本轮开始自动审批');
                    return;
                }
                confirming = false;
                switchMode.setText('启用无限制');
                windowView.hint.setText('正在启用无限制…');
                emit('switch-execution-mode', {threadId: last.id, requestId: request.id});
            });
            box.addView(switchMode);
        }
    } else if (request.kind === 'input') {
        var fields = [];
        for (var i = 0; i < request.questions.length; i++) (function (question) {
            if (question.header) box.addView(textView(question.header, 12));
            box.addView(textView(question.question, 13));
            var edit = new android.widget.EditText(context); edit.setTextColor(android.graphics.Color.WHITE);
            edit.setHintTextColor(android.graphics.Color.parseColor('#bcd5c5')); edit.setHint('输入回答');
            edit.setTextSize(14); edit.setMinLines(2); edit.setMaxLines(4); edit.setMinimumHeight(dp(48));
            edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            if (question.isSecret) edit.setTransformationMethod(android.text.method.PasswordTransformationMethod.getInstance());
            edit.setOnTouchListener(new android.view.View.OnTouchListener({onTouch: function () { windowView.requestFocus(); return false; }}));
            var field = {id: question.id, edit: edit, selected: null};
            var choices = [];
            function addChoice(label, description, custom) {
                var caption = description ? label + '\n' + description : label;
                var choice = button(caption, function () {
                    field.selected = custom ? null : label;
                    edit.setVisibility(custom ? android.view.View.VISIBLE : android.view.View.GONE);
                    choices.forEach(function (entry) {
                        entry.view.setText((entry.view === choice ? '✓ ' : '') + entry.caption);
                    });
                });
                choices.push({view: choice, caption: caption});
                box.addView(choice);
            }
            question.options.forEach(function (option) {
                addChoice(option.label, option.description, false);
            });
            if (question.options.length) {
                edit.setVisibility(android.view.View.GONE);
                if (question.isOther) addChoice('其他', '', true);
            }
            box.addView(edit);
            controls.push(edit);
            fields.push(field);
        })(request.questions[i]);
        box.addView(button('提交回答', function () {
            var answers = Object.create(null);
            for (var k = 0; k < fields.length; k++) {
                var field = fields[k];
                var value = field.selected || (field.edit.getVisibility() === android.view.View.VISIBLE
                    ? String(field.edit.getText()).trim() : '');
                if (!value) { toast('请先回答所有问题'); return; }
                answers[field.id] = {answers: [value]};
            }
            respond(request, {answers: answers});
        }));
    }
    box.addView(button('打开 AIct', openApp));
    windowView.hint.setText('请确认内容后操作');
}
if (!dismissed) {
    try {
        var layout = ('<vertical id="card" padding="14 0 4 12"><horizontal id="handle" gravity="center_vertical" h="44"><text id="dragTitle" text="⠿  AIct · Codex" textColor="#ffffff" textSize="13sp" h="44" gravity="center_vertical" layout_weight="1"/><img id="goToAICT" w="44" h="44"/><img id="dismiss" w="44" h="44"/></horizontal><horizontal gravity="center_vertical" marginBottom="2"><text id="previousHint" text="‹" w="44" h="44" gravity="center" textSize="20sp" textColor="#bcd5c5"/><frame id="titleSwipeArea" w="0" layout_weight="1"><text id="sessionName" w="*" h="44" gravity="center" textColor="#EBF4EE" textSize="15sp" maxLines="2" ellipsize="end"/><text id="adjacentName" w="*" h="44" gravity="center" textColor="#EBF4EE" textSize="15sp" maxLines="2" ellipsize="end" visibility="invisible"/></frame><text id="nextHint" text="›" w="44" h="44" gravity="center" textSize="20sp" textColor="#bcd5c5"/></horizontal><text id="step" text="正在连接进度…" textColor="#ffffff" textSize="13sp" maxLines="3" lineSpacingExtra="2sp"/><scroll id="scroller" h="' + Math.min(280, Math.floor(device.height / density * 0.38)) + '" visibility="gone"><vertical id="requestBox"/></scroll><text id="hint" textColor="#d9d5ae" textSize="11sp" visibility="gone"/><text id="elapsed" textColor="#bcd5c5" textSize="11sp" marginTop="6"/></vertical>');
        windowView = floaty.rawWindow(new XML(layout));
        ui.run(function () {
            windowView.setSize(dp(widthDp), -2); windowView.setPosition(dp(16), dp(90)); styleCard();
            windowView.dismiss.on('click', closeOverlay);
            windowView.goToAICT.on('click', openSelectedSession);
            windowView.titleSwipeArea.setOnTouchListener(new android.view.View.OnTouchListener({onTouch: onSessionTitleTouch}));
            windowView.adjacentName.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            windowView.previousHint.setContentDescription('上一个会话');
            windowView.nextHint.setContentDescription('下一个会话');
            windowView.previousHint.on('click', function () { switchTitle(-1); });
            windowView.nextHint.on('click', function () { switchTitle(1); });
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
                if (windowView) alignOverlay();
            }}));
        });
    } catch (error) {
        dismissed = true;
        try { if (windowView) windowView.close(); } catch (_) {}
        windowView = null;
        emit('warning', {message: String(error)});
    }
}
// Keep checking each turn when Android suspends the WebView.
var remote = {}, nextPoll = 0, pollIndex = 0;
function pollStatus(entry, cached) {
    var connection = null, reader = null;
    try {
        var service = java.lang.Class.forName('dev.aict.container.ConnectionService', true, context.getClassLoader());
        var port = service.getField('proxyPort').getInt(null);
        var proxy = new java.net.Proxy(java.net.Proxy.Type.HTTP, new java.net.InetSocketAddress('127.0.0.1', port));
        connection = new java.net.URL(String(entry.statusUrl)).openConnection(proxy);
        connection.setConnectTimeout(2000); connection.setReadTimeout(2000);
        if (connection.getResponseCode() !== 200) return;
        reader = new java.io.BufferedReader(new java.io.InputStreamReader(connection.getInputStream(), 'UTF-8'));
        var text = '', line;
        while ((line = reader.readLine()) !== null) { text += String(line); if (text.length > 16000) throw Error('Invalid progress response'); }
        var state = JSON.parse(text);
        if (state.turnId !== entry.turnId || state.status === 'unknown') return;
        cached.confirmed = Date.now();
        cached.step = String(state.step || '正在处理请求…');
        cached.done = state.status !== 'running';
    } catch (_) {
        // Retain the last confirmed status if a probe fails.
    } finally {
        try { if (reader) reader.close(); } catch (_) {}
        try { if (connection) connection.disconnect(); } catch (_) {}
    }
}
function refreshEntries() {
    var entries = snapshot.entries, polls = [], nextRemote = {}, currentEntries = [], finished = null;
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.statusUrl) continue;
        var cached = nextRemote[entry.statusUrl] = remote[entry.statusUrl] || {confirmed: 0};
        if (!cached.done) polls.push(entry);
    }
    remote = nextRemote;
    if (polls.length && Date.now() >= nextPoll) {
        var target = polls[pollIndex++ % polls.length];
        pollStatus(target, remote[target.statusUrl]);
        nextPoll = Date.now() + Math.max(600, 5000 / polls.length);
    }
    for (var j = 0; j < entries.length; j++) {
        var row = entries[j], state = remote[row.statusUrl];
        row.updated = snapshot.updated;
        row.stale = Date.now() - Math.max(row.updated, state ? state.confirmed : 0) > 45000;
        row.remoteStep = state && state.step;
        if (!state || !state.done || (row.interaction && Date.now() - row.updated <= 45000)) currentEntries.push(row);
        else if (!finished || row.id === selectedId) finished = row;
    }
    available = currentEntries;
    if (!available.length && finished) {
        last = {done: true, updated: Date.now(), sessionName: finished.sessionName, step: finished.remoteStep};
    }
}
function selectedIndex() {
    for (var i = 0; i < available.length; i++) if (available[i].id === selectedId) return i;
    return 0;
}
var titleGesture = null;
function adjacentSession(offset) {
    return available[(selectedIndex() + offset + available.length) % available.length];
}
function titleOf(row) {
    var name = String(row.sessionName || '当前会话');
    return available.length > 1 ? name + ' (' + (available.indexOf(row) + 1) + '/' + available.length + ')' : name;
}
function resetTitles() {
    windowView.sessionName.animate().cancel();
    windowView.adjacentName.animate().cancel();
    windowView.sessionName.setTranslationX(0);
    windowView.adjacentName.setVisibility(android.view.View.INVISIBLE);
}
function travelTitle(label, x) {
    label.animate().translationX(x).setDuration(170).start();
}
function previewTitle(dx) {
    var span = windowView.titleSwipeArea.getWidth();
    var travel = Math.max(-span, Math.min(span, dx));
    var direction = dx <= 0 ? 1 : -1;
    var adjacent = adjacentSession(direction);
    var preview = windowView.adjacentName;
    preview.setText(titleOf(adjacent));
    preview.setTranslationX(travel + direction * span);
    preview.setVisibility(android.view.View.VISIBLE);
    windowView.sessionName.setTranslationX(travel);
    titleGesture.preview = adjacent.id;
}
function switchTitle(direction, travel) {
    if (!windowView || available.length < 2) return;
    var span = windowView.titleSwipeArea.getWidth();
    var oldName = titleOf(last), destination = adjacentSession(direction);
    resetTitles();
    selectedId = destination.id;
    renderOverlay();
    // Swap the two labels at their current positions and finish the same movement.
    var previous = windowView.adjacentName, current = windowView.sessionName;
    var x = Math.max(-span, Math.min(span, travel || 0));
    previous.setText(oldName);
    previous.setTranslationX(x);
    previous.setVisibility(android.view.View.VISIBLE);
    current.setTranslationX(x + direction * span);
    travelTitle(previous, -direction * span);
    travelTitle(current, 0);
}
function onSessionTitleTouch(view, event) {
    var action = event.getActionMasked();
    if (action === 0) {
        if (available.length < 2) return false;
        resetTitles();
        titleGesture = {id: selectedId, x: event.getRawX(), y: event.getRawY(), start: event.getEventTime(), axis: null};
        return true;
    }
    if (!titleGesture || !windowView) return false;
    if (action === 3 || action === 5 || available.length < 2 || titleGesture.id !== selectedId) {
        titleGesture = null;
        resetTitles();
        return true;
    }
    var dx = event.getRawX() - titleGesture.x, dy = event.getRawY() - titleGesture.y;
    var distance = Math.abs(dx), direction = dx <= 0 ? 1 : -1;
    if (!titleGesture.axis && Math.max(distance, Math.abs(dy)) >= dp(7)) {
        titleGesture.axis = distance > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical';
    }
    if (action === 2 && titleGesture.axis === 'horizontal') previewTitle(dx);
    if (action === 1) {
        var gesture = titleGesture;
        titleGesture = null;
        var span = windowView.titleSwipeArea.getWidth();
        var elapsed = Math.max(1, event.getEventTime() - gesture.start);
        var far = distance >= Math.max(dp(28), Math.min(dp(52), span * 0.22));
        var flick = distance >= dp(16) && distance / elapsed >= dp(650) / 1000;
        var destination = adjacentSession(direction);
        if (gesture.axis === 'horizontal' && (far || flick) && (!gesture.preview || gesture.preview === destination.id)) {
            switchTitle(direction, dx);
        } else {
            travelTitle(windowView.sessionName, 0);
            var preview = windowView.adjacentName;
            if (preview.getVisibility() === android.view.View.VISIBLE) {
                travelTitle(preview, preview.getTranslationX() < 0 ? -span : span);
            }
        }
    }
    return true;
}
function notifyAvailable() {
    for (var i = 0; i < available.length; i++) {
        if (available[i].interaction && Date.now() - available[i].updated <= 45000) {
            notifyPending(available[i].interaction);
            return;
        }
    }
    cancelNotice();
}
function alignOverlay() {
    if (!windowView.card.getHeight()) return;
    if (positioned) placeOverlay(windowView.getX(), windowView.getY());
    else {
        positioned = true;
        placeOverlay(device.width, -device.height);
    }
}
function renderOverlay() {
    var index = selectedIndex();
    if (available.length) { last = available[index]; selectedId = last.id; }
    if (!last || !windowView) return;
    if (titleGesture && (available.length < 2 || titleGesture.id !== selectedId)) {
        titleGesture = null;
        resetTitles();
    }
    var request = last.done || last.stale ? null : last.interaction;
    var name = titleOf(last);
    var canSwitch = available.length > 1;
    var arrowColor = canSwitch ? '#BCD5C5' : '#7D8980';
    windowView.previousHint.setEnabled(canSwitch);
    windowView.nextHint.setEnabled(canSwitch);
    windowView.previousHint.setTextColor(android.graphics.Color.parseColor(arrowColor));
    windowView.nextHint.setTextColor(android.graphics.Color.parseColor(arrowColor));
    windowView.sessionName.setText(name);
    windowView.sessionName.setContentDescription(canSwitch ? name + '，左右滑动切换会话' : name);
    windowView.step.setText(last.done ? String(last.step || '已完成') : last.stale ? '状态暂未同步 · 打开 AIct 刷新' : String(request ? '等待你的回答或确认' : last.remoteStep || last.step));
    windowView.elapsed.setText(last.done ? '5 秒后收起' : '已工作 ' + Math.floor((Date.now() - last.started) / 1000) + ' 秒');
    alignOverlay();
    var key = JSON.stringify([last.id, request ? request.id : null, last.revision, !!last.done]);
    if (rendered !== key) { rendered = key; renderRequest(request, last.revision); }
}
var timer = setInterval(function () {
    while (outgoing.length) aict.emit('codex.interaction', outgoing.shift());
    try {
        if (files.exists(statePath)) {
            var data = JSON.parse(files.read(statePath));
            if (data.owner === owner && !(snapshot && snapshot.done)) snapshot = data;
        }
    } catch (_) {}
    if (!snapshot) return;
    if (snapshot.done) {
        available = [];
        last = {done: true, updated: snapshot.updated, step: snapshot.step, sessionName: last && last.sessionName};
    } else {
        refreshEntries();
    }
    if (available.length) finishAt = 0;
    else if (last && last.done && !finishAt) finishAt = Date.now() + 5000;
    if (dismissed) notifyAvailable();
    if (windowView) ui.run(renderOverlay);
    var confirmed = snapshot.updated;
    for (var key in remote) confirmed = Math.max(confirmed, remote[key].confirmed);
    if ((finishAt && Date.now() > finishAt) || Date.now() - confirmed > 180000) {
        cancelNotice(); clearInterval(timer); try { if (windowView) windowView.close(); } catch (_) {}
        try { files.remove(statePath); } catch (_) {} exit();
    }
}, 600);
