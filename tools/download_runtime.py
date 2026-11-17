"""Download a pinned official release using validated HTTP ranges."""
import concurrent.futures
import hashlib
import json
import time
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
release = json.loads((ROOT / '.release.json').read_text(encoding='utf-8'))
asset = next(a for a in release['assets'] if 'arm64-v8a' in a['name'])
is_apktool = '--apktool' in sys.argv
if is_apktool:
    asset = {'browser_download_url': 'https://github.com/iBotPeaches/Apktool/releases/download/v2.12.1/apktool_2.12.1.jar', 'size': 25926183}
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
parts = ROOT / ('.tools/apktool-parts' if is_apktool else '.tools/download-parts')
parts.mkdir(parents=True, exist_ok=True)
size = asset['size']
block = 2 * 1024 * 1024


def fetch(i):
    start, end = i * block, min(size, (i + 1) * block) - 1
    path = parts / str(i)
    if path.exists() and path.stat().st_size == end - start + 1:
        return path
    for attempt in range(4):
        try:
            req = urllib.request.Request(asset['browser_download_url'], headers={'Range': f'bytes={start}-{end}'})
            with opener.open(req, timeout=120) as r:
                if r.status != 206 or not r.headers.get('Content-Range', '').startswith(f'bytes {start}-{end}/'):
                    raise RuntimeError('Server did not honor exact range')
                data = r.read()
            if len(data) != end - start + 1:
                raise RuntimeError('incomplete range')
            path.write_bytes(data)
            print(f'part {i + 1}/{(size + block - 1)//block}', flush=True)
            return path
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


if __name__ == '__main__':
    count = (size + block - 1) // block
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        paths = list(pool.map(fetch, range(count)))
    output = ROOT / ('.tools/apktool-new.jar' if is_apktool else '.tools/autojs6-runtime-source.apk')
    with output.open('wb') as stream:
        for path in paths:
            stream.write(path.read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    expected = asset.get('digest')
    if expected and expected != 'sha256:' + digest:
        raise RuntimeError('official asset SHA256 mismatch')
    # The suffix in the upstream filename is not a SHA256 prefix.
    # Pin the entire downloaded and APK-signature-verified release for rebuilds.
    if not is_apktool and digest != '3392a70bd0389c77fc5cc8eeb864b6b21be369b721c98f3f2cd9af8111a7c160':
        raise RuntimeError('pinned runtime SHA256 mismatch')
    print(json.dumps({'file': str(output), 'sha256': digest, 'official_digest': expected}), flush=True)
