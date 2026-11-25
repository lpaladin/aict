import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = root / 'dist/aict-source-0.4.1.zip'
files = [root / 'README.md', root / 'API.md', root / 'CODEX_MOBILE.md', root / 'THIRD_PARTY_NOTICES.md', root / '.gitignore', root / 'client/connection.example.json']
files.append(root / 'client/assets/webview-copy-context.js')
for directory in ('client/src', 'server/web', 'tools'):
    files.extend(p for p in (root / directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
files.extend((root / 'server').glob('*.py'))
files.append(root / 'server/requirements.txt')
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(set(files)):
        archive.write(path, path.relative_to(root))
print(f'Created {output.name}: {output.stat().st_size} bytes; excludes APK credentials, signing keys and downloaded binaries.')
