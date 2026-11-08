"""Consistent SQLite snapshots and explicit, offline restore."""
import os
from contextlib import closing
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)


def validate(con):
    if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('SQLite integrity check failed')
    for table, required in [('tasks', {'id', 'title', 'col', 'run_state'}),
                            ('columns', {'id', 'title', 'position'})]:
        fields = {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
        if not required <= fields:
            raise ValueError('Not a compatible Kanban backup')


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination:
        raise ValueError('Backup must use a different path')
    # Exclusive creation prevents accidental replacement of earlier backups.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with closing(readonly(source)) as src, closing(sqlite3.connect(destination)) as dst:
            validate(src)
            src.backup(dst)
            validate(dst)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return destination


def restore(source, destination, confirmed=False):
    if not confirmed:
        raise ValueError('Restore replaces board data. Stop the server, then pass --confirm-restore.')
    status = subprocess.run(['systemctl', '--user', 'is-active', 'kanban.service'],
                            capture_output=True, text=True)
    if status.stdout.strip() in ('active', 'activating', 'reloading'):
        raise ValueError('Stop kanban.service before restoring')
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination:
        raise ValueError('Restore source must be a separate backup')
    with closing(readonly(source)) as src:
        validate(src)
        rollback = None
        if destination.exists():
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            rollback = backup(destination, str(destination) + '.before-restore-' + stamp)
        fd = os.open(destination, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)
            # Restored execution records cannot represent live agent processes.
            dst.execute("UPDATE tasks SET run_state='interrupted', run_output=COALESCE(run_output,'') || '\n[interrupted: board restored]' WHERE run_state IN ('queued','waiting','running')")
            dst.commit()
        return rollback
