"""Extract activity timestamps without treating resume/name changes as chat activity."""
import json
from datetime import datetime
from pathlib import Path

def last_activity(thread):
    raw=thread.get('path')
    if not raw:return None
    path=Path(raw)
    if not path.is_file() or thread['id'] not in path.name:return None
    latest=None
    try:
        with path.open('rb') as stream:
            stream.seek(0,2);size=stream.tell();start=max(0,size-2*1024*1024);stream.seek(start)
            if start:stream.readline()
            for line in stream:
                try:
                    record=json.loads(line);payload=record.get('payload',{})
                    is_event=record.get('type')=='event_msg' and payload.get('type') in {'user_message','agent_message','task_started','task_complete'}
                    is_message=record.get('type')=='response_item' and payload.get('type')=='message' and payload.get('role') in {'user','assistant'}
                    if not (is_event or is_message):continue
                    stamp=datetime.fromisoformat(record['timestamp'].replace('Z','+00:00')).timestamp()
                    latest=max(latest or 0,int(stamp))
                except (ValueError,KeyError,TypeError):continue
    except OSError:return None
    return latest
