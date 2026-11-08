import os
import tempfile
import unittest
from pathlib import Path


class KanbanWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        os.environ["KANBAN_DB"] = str(Path(cls.tmp.name) / "kanban.db")
        os.environ["KANBAN_SPEAK_RUNS"] = "0"
        import app

        cls.app = app

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.app.init_db()
        con = self.app.connect()
        with con:
            con.execute("DELETE FROM tasks")
        con.close()

    def test_entering_progress_queues_and_done_promotes_next(self):
        con = self.app.connect()
        with con:
            first = self.app.add_task(con, "first", col="todo")
            second = self.app.add_task(con, "second", col="todo")
            self.app.move_task(con, first["id"], "doing")
            self.assertEqual(self.app.get_task(con, first["id"])["run_state"], "queued")
            self.app.move_task(con, first["id"], "done")
            promoted = self.app.get_task(con, second["id"])
            self.assertEqual(promoted["col"], "doing")
            self.assertEqual(promoted["run_state"], "queued")
        con.close()

    def test_success_moves_done_and_starts_first_next_task(self):
        con = self.app.connect()
        with con:
            first = self.app.add_task(con, "current", col="doing")
            next_task = self.app.add_task(con, "next", col="todo")
            later = self.app.add_task(con, "later", col="todo")
        self.app.set_run_state(first["id"], run_state="done", run_exit=0)
        self.assertEqual(self.app.get_task(con, first["id"])["col"], "done")
        self.assertEqual(self.app.get_task(con, next_task["id"])["col"], "doing")
        self.assertEqual(self.app.get_task(con, next_task["id"])["run_state"], "queued")
        self.assertEqual(self.app.get_task(con, later["id"])["col"], "todo")
        con.close()

    def test_cancel_waiting_run_is_terminal(self):
        con = self.app.connect()
        with con:
            task = self.app.add_task(con, "waiting", col="doing")
            con.execute(
                "UPDATE tasks SET run_state='waiting', run_output='waiting' WHERE id=?",
                (task["id"],),
            )
            result = self.app.cancel_run(con, task["id"])
            self.assertEqual(result["run_state"], "cancelled")
        con.close()

    def test_retry_rejects_duplicate_queue_entries(self):
        con = self.app.connect()
        with con:
            task = self.app.add_task(con, "retry", col="backlog")
            con.execute("UPDATE tasks SET run_state='failed' WHERE id=?", (task["id"],))
        self.app.queue_run(con, task["id"])
        with self.assertRaisesRegex(ValueError, "already queued"):
            self.app.queue_run(con, task["id"])
        con.close()

    def test_restart_marks_active_tasks_interrupted(self):
        from unittest.mock import patch
        con = self.app.connect()
        with con:
            task = self.app.add_task(con, "interrupted", col="backlog")
            con.execute("UPDATE tasks SET run_state='running' WHERE id=?", (task["id"],))
        with patch.object(self.app.threading, "Thread"):
            self.app.start_runner()
        result = self.app.get_task(con, task["id"])
        self.assertEqual(result["run_state"], "interrupted")
        self.assertIn("retry", result["run_output"])
        con.close()

    def test_recurrence_creates_one_future_successor(self):
        con = self.app.connect()
        with con:
            task = self.app.add_task(con, "daily", col="doing", repeat="daily")
            self.app.move_task(con, task["id"], "done")
            completed = self.app.get_task(con, task["id"])
            child = self.app.get_task(con, completed["repeat_next"])
            self.assertEqual(child["col"], "todo")
            self.assertEqual(child["repeat"], "daily")
            self.assertGreater(child["due"], self.app.board_today().isoformat())
            self.app.move_task(con, task["id"], "backlog")
            self.app.move_task(con, task["id"], "done")
            self.assertEqual(con.execute("SELECT count(*) FROM tasks").fetchone()[0], 2)
        con.close()

    def test_monthly_recurrence_clamps_month_end(self):
        from unittest.mock import patch
        from datetime import date
        with patch.object(self.app, "board_today", return_value=date(2027, 1, 31)):
            self.assertEqual(self.app.next_due("2027-01-31", "monthly"), "2027-02-28")
            self.assertEqual(self.app.next_due(None, "weekly"), "2027-02-07")
        with self.assertRaises(ValueError):
            self.app.clean_repeat("forever")

    def test_voice_failure_does_not_raise(self):
        original = self.app.jarvis_request
        try:
            self.app.JARVIS_SPEAK_RUNS = True
            self.app.jarvis_request = lambda *_args, **_kwargs: (_ for _ in ()).throw(
                RuntimeError("unavailable")
            )
            self.app.speak_with_jarvis("hello")
        finally:
            self.app.jarvis_request = original
            self.app.JARVIS_SPEAK_RUNS = False


if __name__ == "__main__":
    unittest.main()
