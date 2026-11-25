"""Launch restart work outside the Codex command job and gateway lifetime."""
import os
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = None
operation = None


def schedule_restart():
    global worker, operation
    if os.name != 'nt':
        raise RuntimeError('The restart worker currently supports Windows only')
    if worker is not None and worker.poll() is None:
        return {'operationId': operation, 'state': 'scheduled', 'alreadyScheduled': True}
    operation = uuid.uuid4().hex
    executable = shutil.which('powershell.exe')
    if not executable:
        raise RuntimeError('Windows PowerShell is unavailable')
    run = ROOT / 'server/run'
    run.mkdir(exist_ok=True)
    with (run / ('restart-' + operation + '.log')).open('ab') as log:
        worker = subprocess.Popen([executable, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            str(ROOT / 'tools/restart-server.ps1'), '-ExpectedPid', str(os.getpid()),
            '-OperationId', operation, '-Python', sys.executable],
            cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
    status_file = run / ('restart-' + operation + '.json')
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            status = json.loads(status_file.read_text(encoding='utf-8-sig'))
            if status.get('operationId') == operation:
                if status.get('state') == 'failed':
                    raise RuntimeError('Restart worker failed: ' + status.get('message', 'unknown error'))
                break
        except (OSError, ValueError):
            pass
        code = worker.poll()
        if code is not None:
            raise RuntimeError(f'Restart worker exited before startup confirmation (exit {code}); inspect {run / ("restart-" + operation + ".log")}')
        time.sleep(0.05)
    else:
        raise RuntimeError(f'Restart worker startup was not confirmed; inspect {status_file}')
    return {'operationId': operation, 'state': 'scheduled', 'delaySeconds': 4,
            'message': 'Independent worker will restart AICT. This turn will be interrupted; reconnect and resume the saved conversation.',
            'statusFile': str(run / ('restart-' + operation + '.json'))}
