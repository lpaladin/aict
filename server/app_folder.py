"""Build the device project's app folder from saved pages and registered URLs."""
import html
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

PAGE_TYPES = {'.html', '.htm'}
ICON_TYPES = {'.png', '.webp', '.jpg', '.jpeg', '.gif', '.ico', '.avif'}
COLORS = ('sage', 'blue', 'purple', 'amber')


def local_file(root, name, extensions):
    if not isinstance(name, str) or not name or '\x00' in name or name.startswith('/'):
        return None
    try:
        path = (root / name).resolve()
        if path.is_relative_to(root) and path.suffix.lower() in extensions and path.is_file():
            return path.relative_to(root).as_posix()
    except (OSError, ValueError, RuntimeError):
        pass
    return None


def external_url(value):
    if not isinstance(value, str) or any(char.isspace() or ord(char) < 32 for char in value):
        return None
    try:
        parts = urlsplit(value)
        if (parts.scheme in {'http', 'https'} and parts.hostname and not parts.username
                and parts.password is None and '\\' not in value):
            return parts.geturl()
    except ValueError:
        pass
    return None


def render_folder(root, key):
    prefix = f'/artifacts/{key}/'
    files = [path.relative_to(root).as_posix() for path in sorted(root.rglob('*'))
             if path.is_file() and path.resolve().is_relative_to(root)]
    try:
        manifest = json.loads((root.parent / 'apps.json').read_text(encoding='utf-8'))
    except (ValueError, OSError):
        manifest = []
    apps = {}
    for entry in manifest if isinstance(manifest, list) else []:
        if not isinstance(entry, dict):
            continue
        path = local_file(root, entry.get('path'), PAGE_TYPES)
        url = prefix + quote(path) if path else external_url(entry.get('url'))
        name = entry.get('name')
        if not url or not isinstance(name, str) or not name.strip():
            continue
        icon = local_file(root, entry.get('icon'), ICON_TYPES)
        subtitle = path if path else urlsplit(url).netloc
        apps[url] = (name.strip(), subtitle, prefix + quote(icon) if icon else None)
    downloads = []
    for name in files:
        url = prefix + quote(name)
        if Path(name).suffix.lower() in PAGE_TYPES:
            path = Path(name)
            label = path.parent.name if path.stem.lower() == 'index' and path.parent.name else path.stem
            apps.setdefault(url, (label, name, None))
        else:
            downloads.append(f'<li><a href="{url}">{html.escape(name)}</a></li>')

    cards = []
    for index, (url, (name, subtitle, icon)) in enumerate(apps.items()):
        icon_html = f'<img src="{icon}" alt="" loading="lazy">' if icon else ''
        initial = html.escape(name[0].upper())
        color = COLORS[index % len(COLORS)]
        cards.append(
            f'<a class="app" href="{html.escape(url)}" rel="noreferrer">'
            f'<span class="icon {color}" aria-hidden="true"><span>{initial}</span>{icon_html}</span>'
            f'<span class="name">{html.escape(name)}</span>'
            f'<span class="address">{html.escape(subtitle)}</span></a>'
        )
    content = '<div class="grid">' + ''.join(cards) + '</div>' if cards else (
        '<p class="empty">还没有应用。让 Codex 保存网页或登记长期地址后，可在这里打开。</p>'
    )
    if downloads:
        content += '<details><summary>其他文件</summary><ul>' + ''.join(downloads) + '</ul></details>'
    return '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>应用文件夹</title><link rel="stylesheet" href="/assets/app-folder.css">
</head><body><main><h1>应用文件夹</h1>''' + content + '</main></body></html>'
