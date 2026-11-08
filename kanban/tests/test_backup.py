import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import board_backup


class BackupTests(unittest.TestCase):
    def test_wal_snapshot_restore_and_safety(self):
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / 'board.db'
            snap = Path(folder) / 'snapshot.db'
            with closing(sqlite3.connect(db)) as con:
                con.execute('PRAGMA journal_mode=WAL')
                con.execute('CREATE TABLE columns (id TEXT, title TEXT, position INTEGER)')
                con.execute('CREATE TABLE tasks (id INTEGER, title TEXT, col TEXT, run_state TEXT, run_output TEXT)')
                con.execute("INSERT INTO tasks VALUES (1,'original','doing','running','')")
                con.commit()
                board_backup.backup(db, snap)
                with self.assertRaises(FileExistsError):
                    board_backup.backup(db, snap)
                con.execute("UPDATE tasks SET title='changed'")
                con.commit()
            with self.assertRaises(ValueError):
                board_backup.restore(snap, db)
            with patch('board_backup.subprocess.run', return_value=SimpleNamespace(stdout='active')):
                with self.assertRaises(ValueError):
                    board_backup.restore(snap, db, True)
            with patch('board_backup.subprocess.run', return_value=SimpleNamespace(stdout='inactive')):
                rollback = board_backup.restore(snap, db, True)
            with closing(sqlite3.connect(db)) as con:
                self.assertEqual(con.execute('SELECT title,run_state FROM tasks').fetchone(), ('original','interrupted'))
            with closing(sqlite3.connect(rollback)) as con:
                self.assertEqual(con.execute('SELECT title FROM tasks').fetchone()[0], 'changed')
            invalid = Path(folder) / 'invalid.db'
            with closing(sqlite3.connect(invalid)) as con:
                con.execute('CREATE TABLE unrelated (id INTEGER)')
            with patch('board_backup.subprocess.run', return_value=SimpleNamespace(stdout='inactive')):
                with self.assertRaises(ValueError):
                    board_backup.restore(invalid, db, True)
            with closing(sqlite3.connect(db)) as con:
                self.assertEqual(con.execute('SELECT title FROM tasks').fetchone()[0], 'original')
