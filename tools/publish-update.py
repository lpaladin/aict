"""Register an explicitly built APK with the matching persistent user key/config."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / '.tools/python'), str(ROOT / 'server')]
from device_updates import load, save, validate_release

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', required=True)
    parser.add_argument('--connection', required=True)
    parser.add_argument('--version', required=True, help='Human readable release label')
    args = parser.parse_args()
    config_path = Path(args.connection).resolve()
    config = load(config_path, {})
    release = {'credentialId': config['credentialId'], 'connectionConfig': str(config_path),
               'apk': str(Path(args.apk).resolve()), 'version': args.version}
    release['sha256'] = validate_release(release)
    manifest = ROOT / 'server/data/updates/releases.json'
    data = load(manifest, {'releases': {}})
    data['releases'][release['credentialId']] = release
    save(manifest, data)
    print(json.dumps({'credentialId': release['credentialId'], 'version': args.version,
                      'sha256': release['sha256']}, ensure_ascii=False))
