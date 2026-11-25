"""Check the actual APK's runtime interfaces and embedded configuration without logging keys."""
import sys
import hashlib
import json
import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def methods(data):
    def u32(pos): return struct.unpack_from('<I', data, pos)[0]
    def uleb(pos):
        value = shift = 0
        while True:
            byte = data[pos]
            pos += 1
            value |= (byte & 127) << shift
            if byte < 128: return value, pos
            shift += 7
    strings = []
    for i in range(u32(56)):
        _, start = uleb(u32(u32(60) + i * 4))
        strings.append(data[start:data.index(b'\0', start)].decode('utf-8', errors='replace'))
    types = [strings[u32(u32(68) + i * 4)] for i in range(u32(64))]
    protos = []
    for i in range(u32(72)):
        pos = u32(76) + i * 12
        params = u32(pos + 8)
        args = [] if not params else [types[struct.unpack_from('<H', data, params + 4 + j * 2)[0]] for j in range(u32(params))]
        protos.append('(' + ''.join(args) + ')' + types[u32(pos + 4)])
    result = set()
    for i in range(u32(88)):
        cls, proto, name = struct.unpack_from('<HHI', data, u32(92) + i * 8)
        result.add((types[cls], strings[name], protos[proto]))
    return result


apk = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'dist/aict-demo-0.4.1.apk'
with zipfile.ZipFile(apk) as archive:
    all_methods = set()
    dex_files = [n for n in archive.namelist() if n.endswith('.dex')]
    for name in dex_files:
        all_methods.update(methods(archive.read(name)))
    required = [
        ('Lorg/autojs/autojs/AutoJs;', 'getInstance', '()Lorg/autojs/autojs/AutoJs;'),
        ('Lorg/autojs/autojs/AbstractAutoJs;', 'getScriptEngineService', '()Lorg/autojs/autojs/engine/ScriptEngineService;'),
        ('Lorg/autojs/autojs/script/StringScriptSource;', '<init>', '(Ljava/lang/String;Ljava/lang/String;)V'),
        ('Lorg/autojs/autojs/execution/ExecutionConfig;', '<init>', '()V'),
        ('Lorg/autojs/autojs/execution/ExecutionConfig;', 'setArgument', '(Ljava/lang/String;Ljava/lang/Object;)V'),
        ('Lorg/autojs/autojs/engine/ScriptEngineService;', 'execute', '(Lorg/autojs/autojs/script/ScriptSource;Lorg/autojs/autojs/execution/ScriptExecutionListener;Lorg/autojs/autojs/execution/ExecutionConfig;)Lorg/autojs/autojs/execution/ScriptExecution;'),
        ('Landroidx/webkit/ProxyConfig$Builder;', 'removeImplicitRules', '()Landroidx/webkit/ProxyConfig$Builder;'),
        ('Ldev/aict/container/MainActivity;', 'onCreate', '(Landroid/os/Bundle;)V'),
        ('Ldev/aict/container/ConnectionService;', 'onStartCommand', '(Landroid/content/Intent;II)I'),
        ('Ldev/aict/container/VisionService;', 'capture', '(Ldev/aict/container/NativeRuntime$Reply;)V'),
        ('Ldev/aict/container/ScriptTasks$Task;', 'reportResult', '(Ljava/lang/String;)V'),
        ('Ldev/aict/container/ScriptTasks$Task;', 'emit', '(Ljava/lang/String;Ljava/lang/String;)V'),
        ('Lorg/autojs/autojs/engine/ScriptEngine;', 'forceStop', '()V'),
        ('Ldev/aict/container/CaptureActivity;', 'onCreate', '(Landroid/os/Bundle;)V'),
        ('Ldev/aict/container/FileAccess;', 'read', '(Landroid/content/Context;Lorg/json/JSONObject;)Lorg/json/JSONObject;'),
    ]
    missing = [entry for entry in required if entry not in all_methods]
    if missing: raise RuntimeError('APK runtime signatures missing: ' + repr(missing))
    config = json.loads(archive.read('assets/connection.json'))
    assert config['host'] == 'zhyzbklqx.gicp.net' and config['port'] == 19198
    assert config['hostKeySha256'].startswith('SHA256:')
    assert b'-----BEGIN RSA PRIVATE KEY-----' in config['privateKey'].encode()
    assert 'lib/arm64-v8a/libopencv_java4.so' in archive.namelist()
    compiled_dex = ROOT / '.build/dex/classes.dex'
    if compiled_dex.exists():
        assert archive.read('classes9.dex') == compiled_dex.read_bytes(), 'Packaged client DEX differs from compiled source'
    assert archive.read('assets/phone.js') == (ROOT / 'server/web/phone.js').read_bytes(), 'Packaged SDK is stale'
    assert archive.read('assets/webview-copy-context.js') == (ROOT / 'client/assets/webview-copy-context.js').read_bytes(), 'Packaged copy context script is stale'
    report = {
        'apk': apk.name, 'bytes': apk.stat().st_size,
        'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
        'dex_count': len(dex_files), 'runtime_signatures_checked': len(required),
        'endpoint': f"{config['host']}:{config['port']}",
        'embedded_credential': True, 'host_key_pinning': True,
        'evidence': 'static APK inspection only; device installation and runtime are separate checks',
    }
(apk.with_suffix('.build-report.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
