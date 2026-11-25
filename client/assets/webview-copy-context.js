(() => {
    if (window !== window.top || !/^https?:$/.test(location.protocol)) return;
    const key = Symbol.for('aict.contextAtSelection');
    if (window[key]) return;

    const blocks = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption';
    let pressedLink;
    document.addEventListener('pointerdown', event => {
        if (!event.isTrusted) return;
        pressedLink = event.composedPath().find(node => node instanceof HTMLAnchorElement && node.hasAttribute('href'));
    }, true);
    window.addEventListener('pagehide', () => { pressedLink = undefined; });

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

    window[key] = expectedLink => {
        let element;
        let text;
        if (expectedLink) {
            const link = pressedLink;
            if (!link?.isConnected || link.href !== new URL(expectedLink, location.href).href) return null;
            element = link;
            text = link.innerText.trim() || link.getAttribute('aria-label') ||
                link.querySelector('img[alt]')?.alt || link.href;
        } else {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const node = container instanceof Element ? container : container.parentElement;
            if (!node || node.isContentEditable || node.closest('textarea,input,select')) return null;
            element = node.closest(blocks) || node;
            text = element === node && !node.matches(blocks) ?
                selection.toString().trim() : element.innerText.trim();
            if (!text) return null;
        }
        const address = new URL(location.href);
        address.username = '';
        address.password = '';
        return ['地址：' + address.href, '选择器：' + selectorPath(element), '内容：', text].join('\n');
    };
})();
