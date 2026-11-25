(() => {
    if (window !== window.top || !/^https?:$/.test(location.protocol)) return false;
    const installed = Symbol.for('aict.copyContext.v2');
    if (window[installed]) return true;
    window[installed] = true;

    const controls = 'a[href], button, input, textarea, select, [contenteditable], [role="button"], img, video';
    const blocks = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption';
    let menu;

    function closeMenu() {
        menu?.remove();
        menu = undefined;
    }

    function selectorPath(element) {
        const selectors = [];
        for (let node = element; node;) {
            const root = node.getRootNode();
            const parts = [];
            for (; node; node = node.parentElement) {
                const id = node.id && '#' + CSS.escape(node.id);
                if (id && root.querySelectorAll(id).length === 1) {
                    parts.unshift(id);
                    break;
                }
                let index = 1;
                for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
                parts.unshift(CSS.escape(node.localName) + ':nth-child(' + index + ')');
            }
            selectors.unshift(parts.join(' > '));
            node = root.host;
        }
        return selectors.length === 1 ? selectors[0] : JSON.stringify(selectors);
    }

    function copy(text) {
        const field = document.createElement('textarea');
        field.value = text;
        field.style.cssText = 'position:fixed;left:-9999px;top:0';
        menu.shadowRoot.append(field);
        field.select();
        try {
            return document.execCommand('copy');
        } finally {
            field.remove();
        }
    }

    window.addEventListener('contextmenu', event => {
        const target = event.composedPath().find(node => node instanceof Element);
        if (!target || target.closest(controls) || target.isContentEditable) return;
        const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
        const textNode = caret?.startContainer;
        if (textNode?.nodeType !== Node.TEXT_NODE || !target.contains(textNode)) return;
        const block = textNode.parentElement.closest(blocks) || textNode.parentElement;
        const text = block.innerText.trim();
        if (!text) return;

        const address = new URL(location.href);
        address.username = '';
        address.password = '';
        const context = ['地址：' + address.href, '选择器：' + selectorPath(block), '内容：', text].join('\n');
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMenu();
        menu = document.createElement('div');
        menu.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0';
        const shadow = menu.attachShadow({mode: 'open'});
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '复制上下文';
        button.style.cssText = 'background:#20352c;color:white;font:15px system-ui;border:0;border-radius:12px;padding:0 16px;height:44px;white-space:nowrap;box-shadow:0 3px 14px #0005';
        shadow.append(button);
        document.documentElement.append(menu);
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        menu.style.left = Math.max(left + 4, Math.min(event.clientX,
            left + (viewport?.width ?? innerWidth) - button.offsetWidth - 4)) + 'px';
        menu.style.top = Math.max(top + 4, Math.min(event.clientY - 52,
            top + (viewport?.height ?? innerHeight) - button.offsetHeight - 4)) + 'px';

        button.addEventListener('click', async click => {
            if (!click.isTrusted) return;
            let copied = false;
            try {
                copied = copy(context);
                if (!copied && navigator.clipboard) {
                    await navigator.clipboard.writeText(context);
                    copied = true;
                }
            } catch (_) {
                // Clipboard permission can depend on the site's context.
            }
            button.textContent = copied ? '已复制' : '复制失败';
            setTimeout(() => { if (button.isConnected) closeMenu(); }, 1200);
        });
    }, true);

    document.addEventListener('pointerdown', event => {
        if (menu && !event.composedPath().includes(menu)) closeMenu();
    }, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenu();
    }, true);
    window.addEventListener('pagehide', closeMenu);
    return true;
})();
