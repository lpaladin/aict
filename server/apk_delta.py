"""Build a byte-exact patch between two already validated APKs."""
import gzip
import hashlib
import struct
import tempfile
from pathlib import Path
from zipfile import ZipFile

MAX_APK_BYTES = 512 * 1024 * 1024
MAGIC = b'ACT1'
APPLY_DELTA = Path(__file__).with_name('apply_apk_delta.js').read_text(encoding='utf-8')


def payloads(path, data):
    with ZipFile(path) as apk:
        for entry in apk.infolist():
            name_size, extra_size = struct.unpack_from('<HH', data, entry.header_offset + 26)
            yield entry.filename, entry.header_offset + 30 + name_size + extra_size, entry.compress_size


def build_delta(previous, release, directory):
    base_path, target_path = Path(previous['apk']), Path(release['apk'])
    target_size = target_path.stat().st_size
    if max(base_path.stat().st_size, target_size) > MAX_APK_BYTES:
        return None
    base, target = memoryview(base_path.read_bytes()), memoryview(target_path.read_bytes())
    if len(target) != target_size or max(len(base), len(target)) > MAX_APK_BYTES:
        raise ValueError('APK changed during delta build')
    if any(hashlib.sha256(data).hexdigest() != entry['sha256']
           for data, entry in ((base, previous), (target, release))):
        raise ValueError('APK digest changed during delta build')
    previous_entries = {name: (offset, size) for name, offset, size in payloads(base_path, base)}
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{previous['sha256']}-{release['sha256']}.gz"
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as file:
        temporary = Path(file.name)
    try:
        with gzip.open(temporary, 'wb') as patch:
            patch.write(MAGIC)
            cursor = 0
            for name, offset, size in sorted(payloads(target_path, target), key=lambda entry: entry[1]):
                old_offset, old_size = previous_entries.get(name, (0, 0))
                if offset < cursor or not size or size != old_size or base[old_offset:old_offset+size] != target[offset:offset+size]:
                    continue
                if offset > cursor:
                    patch.write(struct.pack('>BI', 1, offset - cursor))
                    patch.write(target[cursor:offset])
                patch.write(struct.pack('>BII', 2, size, old_offset))
                cursor = offset + size
            if cursor < target_size:
                patch.write(struct.pack('>BI', 1, target_size - cursor))
                patch.write(target[cursor:])
            patch.write(b'\x00')
        if temporary.stat().st_size >= target_size:
            return None
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return {'fromSha256': previous['sha256'], 'path': str(path), 'targetBytes': target_size}
