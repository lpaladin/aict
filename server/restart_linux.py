"""Restart the systemd-managed AICT gateway from a separate service unit."""
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

UNIT = 'aict.service'


def service_properties():
    output = subprocess.check_output([
        'systemctl', 'show', UNIT, '-p', 'MainPID', '-p', 'Restart', '-p', 'ActiveState',
    ], text=True, timeout=3)
    return dict(line.split('=', 1) for line in output.splitlines())


def restart(status_path, operation_id, expected_pid, http_port):
    def write_state(state, message, **details):
        pending = status_path.with_suffix('.tmp')
        pending.write_text(json.dumps({
            'operationId': operation_id, 'state': state, 'message': message,
            'expectedPid': expected_pid, 'updatedAt': datetime.now(timezone.utc).isoformat(),
            **details,
        }), encoding='utf-8')
        pending.replace(status_path)

    try:
        with os.fdopen(os.pidfd_open(expected_pid), 'rb') as target:
            service = service_properties()
            if int(service['MainPID']) != expected_pid or service['Restart'] != 'always':
                raise RuntimeError(f'{UNIT} must own the expected PID and use Restart=always')
            write_state('scheduled', 'Independent Linux restart worker started')
            time.sleep(4)
            if int(service_properties()['MainPID']) != expected_pid:
                raise RuntimeError('The AICT service PID changed before restart')
            write_state('restarting', 'Asking systemd to replace the AICT gateway')
            signal.pidfd_send_signal(target.fileno(), signal.SIGTERM)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            service = service_properties()
            new_pid = int(service['MainPID'])
            if new_pid not in (0, expected_pid) and service['ActiveState'] == 'active':
                try:
                    with urlopen(f'http://127.0.0.1:{http_port}/health', timeout=2) as response:
                        healthy = json.load(response).get('ok') is True
                except (OSError, ValueError):
                    healthy = False
                if healthy and int(service_properties()['MainPID']) == new_pid:
                    write_state('completed', f'AICT is healthy; new PID {new_pid}', newPid=new_pid)
                    return
            time.sleep(0.5)
        raise RuntimeError('Replacement AICT service did not become healthy')
    except Exception as exc:
        write_state('failed', str(exc))
        raise


if __name__ == '__main__':
    operation, pid, port = sys.argv[1:]
    if not re.fullmatch(r'[a-f0-9]{32}', operation):
        raise ValueError('Invalid operation ID')
    status = Path(__file__).resolve().parent / 'run' / f'restart-{operation}.json'
    restart(status, operation, int(pid), int(port))
