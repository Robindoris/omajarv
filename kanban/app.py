#!/usr/bin/env python3
"""Kanban board - single file, standard library only, SQLite storage.

Run:      python3 app.py [--host 0.0.0.0] [--port 8787]
Env:      KANBAN_DB, KANBAN_HOST, KANBAN_PORT

API
  GET    /api/health
  GET    /api/board
  POST   /api/tasks             {title, notes?, col?, priority?, due?}
  PATCH  /api/tasks/<id>        {title?, notes?, col?, priority?, due?, index?}
  DELETE /api/tasks/<id>
  POST   /api/tasks/<id>/move   {col, index?}
  POST   /api/columns           {title}
  PATCH  /api/columns/<id>      {title}
  DELETE /api/columns/<id>
"""

import argparse
import fcntl
import json
import mimetypes
import os
import queue
import re
import shutil
import signal
import socket
import sqlite3
import struct
import subprocess
import sys
import threading
import time
import ssl
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone, date, timedelta
from zoneinfo import ZoneInfo
import calendar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE, "web")
DB_PATH = os.environ.get("KANBAN_DB", os.path.join(BASE, "data", "kanban.db"))

PRIORITIES = ("low", "normal", "high")
DEFAULT_COLUMNS = [
    ("backlog", "Backlog"),
    ("todo", "Next up"),
    ("doing", "In progress"),
    ("done", "Done"),
]

# Agent runner. Uses the agent selected by Omarchy's defaults/agent file.
AGENT_DEFAULT_FILE = os.path.expanduser("~/.config/omarchy/defaults/agent")


def configured_agent() -> str:
    override = os.environ.get("KANBAN_AGENT")
    if override:
        return override.strip()
    try:
        with open(AGENT_DEFAULT_FILE, encoding="utf-8") as fh:
            value = fh.read().strip()
    except OSError:
        value = ""
    return value or "codex"


AGENT_NAME = configured_agent()
AGENT_CWD = os.environ.get("KANBAN_AGENT_CWD", os.path.expanduser("~"))
AGENT_TIMEOUT = int(os.environ.get("KANBAN_AGENT_TIMEOUT", "1200"))
AGENT_AUTO = os.environ.get("KANBAN_AGENT_AUTO", "1").lower() not in ("0", "false", "no")
AGENT_OUTPUT_LIMIT = 20_000

# Route board runs through the shared Omamac/JARVIS conversation by default.
JARVIS_URL = os.environ.get("KANBAN_JARVIS_URL", "https://127.0.0.1:4317").rstrip("/")
JARVIS_TOKEN_FILE = os.environ.get(
    "KANBAN_JARVIS_TOKEN_FILE",
    os.path.expanduser("~/.local/state/omarchy-jarvis/token"),
)
JARVIS_CERT_FILE = os.environ.get(
    "KANBAN_JARVIS_CERT_FILE",
    os.path.expanduser("~/.local/state/omarchy-jarvis/cert.pem"),
)
JARVIS_RUNS = os.environ.get("KANBAN_RUNNER", "jarvis").lower() not in (
    "agent", "direct", "0", "false", "no",
)
JARVIS_SPEAK_RUNS = os.environ.get("KANBAN_SPEAK_RUNS", "1").lower() not in (
    "0", "false", "no",
)


class JarvisBusy(RuntimeError):
    """The shared JARVIS conversation is handling another request."""


# --------------------------------------------------------------------------- db

def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
    con = connect()
    with con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS columns (
                id       TEXT PRIMARY KEY,
                title    TEXT NOT NULL,
                position INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL,
                notes      TEXT NOT NULL DEFAULT '',
                col        TEXT NOT NULL,
                position   INTEGER NOT NULL,
                priority   TEXT NOT NULL DEFAULT 'normal',
                due        TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                done_at    TEXT
            );
            CREATE INDEX IF NOT EXISTS tasks_col_pos ON tasks(col, position);
            """
        )
        if con.execute("SELECT COUNT(*) FROM columns").fetchone()[0] == 0:
            for i, (cid, title) in enumerate(DEFAULT_COLUMNS):
                con.execute(
                    "INSERT INTO columns(id, title, position) VALUES(?,?,?)",
                    (cid, title, i),
                )
        ensure_task_columns(con)
    con.close()


def ensure_task_columns(con) -> None:
    """Add the agent-run columns to databases created before they existed."""
    have = {r["name"] for r in con.execute("PRAGMA table_info(tasks)")}
    for name, ddl in (
        ("run_state", "TEXT NOT NULL DEFAULT 'idle'"),
        ("run_output", "TEXT NOT NULL DEFAULT ''"),
        ("run_started_at", "TEXT"),
        ("run_finished_at", "TEXT"),
        ("run_exit", "INTEGER"),
        ("run_session", "TEXT"),
        ("repeat", "TEXT NOT NULL DEFAULT 'none'"),
        ("repeat_next", "INTEGER"),
    ):
        if name not in have:
            con.execute(f"ALTER TABLE tasks ADD COLUMN {name} {ddl}")


def column_ids(con) -> list:
    return [r["id"] for r in con.execute("SELECT id FROM columns ORDER BY position, id")]


def slug(text: str, taken) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "column"
    cand, n = base, 2
    while cand in taken:
        cand = f"{base}-{n}"
        n += 1
    return cand


def board(con) -> dict:
    cols = con.execute("SELECT id, title FROM columns ORDER BY position, id").fetchall()
    tasks = con.execute("SELECT * FROM tasks ORDER BY position, id").fetchall()
    buckets = {c["id"]: [] for c in cols}
    for t in tasks:
        if t["col"] in buckets:
            item = dict(t)
            if len(item.get("run_output") or "") > 600:
                item["run_output"] = item["run_output"][:600] + "…"
            buckets[t["col"]].append(item)
    return {
        "columns": [
            {"id": c["id"], "title": c["title"], "tasks": buckets[c["id"]]}
            for c in cols
        ]
    }


def get_task(con, tid: int) -> dict:
    row = con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if row is None:
        raise KeyError(tid)
    return dict(row)


def clean_title(value) -> str:
    title = " ".join(str(value or "").split())
    if not title:
        raise ValueError("title is required")
    return title[:300]


def clean_notes(value) -> str:
    return str(value or "").strip()[:8000]


def clean_priority(value) -> str:
    p = str(value or "normal").strip().lower()
    if p not in PRIORITIES:
        raise ValueError("priority must be one of: " + ", ".join(PRIORITIES))
    return p


def clean_due(value):
    if value in (None, "", False):
        return None
    d = str(value).strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        raise ValueError("due must be YYYY-MM-DD")
    return d


def resolve_col(con, value) -> str:
    """Accept a column id or its title (case-insensitive)."""
    if value in (None, ""):
        ids = column_ids(con)
        if not ids:
            raise ValueError("no columns defined")
        return ids[0]
    want = str(value).strip()
    ids = column_ids(con)
    if want in ids:
        return want
    rows = con.execute("SELECT id, title FROM columns").fetchall()
    for r in rows:
        if r["title"].lower() == want.lower():
            return r["id"]
    raise ValueError(f"unknown column: {want}")


def preferred_column(con, cid: str, title: str):
    """Return a workflow column id when its default id or title exists."""
    row = con.execute(
        "SELECT id FROM columns WHERE id=? OR lower(title)=lower(?) LIMIT 1",
        (cid, title),
    ).fetchone()
    return row["id"] if row else None


def clean_repeat(value):
    value = value or "none"
    if value not in ("none", "daily", "weekly", "monthly"):
        raise ValueError("repeat must be none, daily, weekly, or monthly")
    return value


def board_today():
    return datetime.now(ZoneInfo("Europe/Bratislava")).date()


def next_due(due, repeat):
    current = max(date.fromisoformat(due) if due else board_today(), board_today())
    if repeat == "monthly":
        month = current.month % 12 + 1
        year = current.year + (current.month == 12)
        return date(year, month, min(current.day, calendar.monthrange(year, month)[1])).isoformat()
    return (current + timedelta(days=1 if repeat == "daily" else 7)).isoformat()


def add_task(con, title, notes="", col=None, priority="normal", due=None, repeat="none") -> dict:
    cid = resolve_col(con, col)
    pos = con.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE col=?", (cid,)
    ).fetchone()[0]
    stamp = now()
    cur = con.execute(
        """INSERT INTO tasks(title, notes, col, position, priority, due,
                             created_at, updated_at, done_at)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (clean_title(title), clean_notes(notes), cid, pos,
         clean_priority(priority), clean_due(due), stamp, stamp,
         stamp if cid == "done" else None),
    )
    con.execute('UPDATE tasks SET repeat=? WHERE id=?', (clean_repeat(repeat), cur.lastrowid))
    return get_task(con, cur.lastrowid)


def reindex(con, cid: str) -> None:
    rows = con.execute(
        "SELECT id FROM tasks WHERE col=? ORDER BY position, id", (cid,)
    ).fetchall()
    for i, r in enumerate(rows):
        con.execute("UPDATE tasks SET position=? WHERE id=?", (i, r["id"]))


def move_task(con, tid: int, col, index=None) -> dict:
    task = get_task(con, tid)
    cid = resolve_col(con, col)
    doing_id = preferred_column(con, "doing", "In progress")
    done_id = preferred_column(con, "done", "Done")
    entered_doing = task["col"] != cid and doing_id == cid
    completed_now = task["col"] != cid and done_id == cid
    others = [
        r["id"]
        for r in con.execute(
            "SELECT id FROM tasks WHERE col=? AND id<>? ORDER BY position, id",
            (cid, tid),
        )
    ]
    if index is None:
        at = len(others)
    else:
        at = max(0, min(int(index), len(others)))
    others.insert(at, tid)
    stamp = now()
    if cid == "done":
        done_at = task["done_at"] or stamp
    else:
        done_at = None
    for i, oid in enumerate(others):
        con.execute(
            "UPDATE tasks SET col=?, position=?, updated_at=?, done_at=? WHERE id=?",
            (cid, i, stamp, done_at, oid),
        )
    if task["col"] != cid:
        reindex(con, task["col"])

    # Entering In progress is an execution request. Queue it only after the
    # move has been written so the worker cannot observe the old column/state.
    if entered_doing:
        queue_run(con, tid)

    # Create just one successor, even if a completed card is reopened.
    task = get_task(con, tid)
    if completed_now and task.get("repeat", "none") != "none" and not task.get("repeat_next"):
        target = preferred_column(con, "todo", "Next up") or preferred_column(con, "backlog", "Backlog")
        if target:
            successor = add_task(con, task["title"], task["notes"], target,
                                 task["priority"], next_due(task["due"], task["repeat"]), task["repeat"])
            con.execute('UPDATE tasks SET repeat_next=? WHERE id=?', (successor["id"], tid))

    # Finishing a task keeps the ready queue moving: promote the oldest Next up
    # task into In progress, which recursively queues its run.
    if completed_now and doing_id and doing_id != done_id:
        todo_id = preferred_column(con, "todo", "Next up")
        if todo_id and todo_id not in (doing_id, done_id):
            next_task = con.execute(
                "SELECT id FROM tasks WHERE col=? AND (repeat='none' OR due IS NULL OR due<=?) ORDER BY position, id LIMIT 1",
                (todo_id, board_today().isoformat()),
            ).fetchone()
            if next_task:
                move_task(con, next_task["id"], doing_id)

    return get_task(con, tid)


def update_task(con, tid: int, fields: dict) -> dict:
    task = get_task(con, tid)
    sets, args = [], []
    for key in ("title", "notes", "priority", "due", "repeat"):
        if key in fields:
            val = {
                "title": clean_title,
                "notes": clean_notes,
                "priority": clean_priority,
                "due": clean_due,
                "repeat": clean_repeat,
            }[key](fields[key])
            sets.append(f"{key}=?")
            args.append(val)
    if sets:
        sets.append("updated_at=?")
        args.append(now())
        con.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id=?", (*args, tid))
    if "col" in fields:
        cid = resolve_col(con, fields["col"])
        if cid != task["col"]:
            move_task(con, tid, cid, fields.get("index"))
        elif fields.get("index") is not None:
            move_task(con, tid, cid, fields["index"])
    return get_task(con, tid)


def delete_task(con, tid: int) -> dict:
    task = get_task(con, tid)
    con.execute("DELETE FROM tasks WHERE id=?", (tid,))
    reindex(con, task["col"])
    return task


def add_column(con, title) -> dict:
    t = clean_title(title)
    ids = column_ids(con)
    cid = slug(t, set(ids))
    pos = con.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM columns").fetchone()[0]
    con.execute("INSERT INTO columns(id, title, position) VALUES(?,?,?)", (cid, t, pos))
    return {"id": cid, "title": t}


def rename_column(con, cid: str, title) -> dict:
    if cid not in column_ids(con):
        raise KeyError(cid)
    t = clean_title(title)
    con.execute("UPDATE columns SET title=? WHERE id=?", (t, cid))
    return {"id": cid, "title": t}


def delete_column(con, cid: str) -> dict:
    ids = column_ids(con)
    if cid not in ids:
        raise KeyError(cid)
    if len(ids) == 1:
        raise ValueError("cannot delete the last column")
    target = next(i for i in ids if i != cid)
    for r in con.execute("SELECT id FROM tasks WHERE col=? ORDER BY position", (cid,)).fetchall():
        move_task(con, r["id"], target)
    con.execute("DELETE FROM columns WHERE id=?", (cid,))
    reindex_cols(con)
    return {"id": cid, "moved_to": target}


def reindex_cols(con) -> None:
    for i, r in enumerate(con.execute("SELECT id FROM columns ORDER BY position, id")):
        con.execute("UPDATE columns SET position=? WHERE id=?", (i, r["id"]))


# -------------------------------------------------------------------- runner
# Tasks can be handed to the configured Omarchy agent. One run
# at a time, output streamed into the task row so the board can show it.

QUEUE: "queue.Queue[int]" = queue.Queue()
RUNNING = {}
CANCEL = set()
RUN_LOCK = threading.Lock()


def agent_bin():
    cands = [
        shutil.which(AGENT_NAME),
        os.path.expanduser(f"~/.local/share/mise/shims/{AGENT_NAME}"),
        os.path.expanduser(
            f"~/.local/share/mise/installs/{AGENT_NAME}/latest/node_modules/.bin/{AGENT_NAME}"
        ),
        f"/usr/local/bin/{AGENT_NAME}",
        f"/usr/bin/{AGENT_NAME}",
    ]
    for cand in cands:
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def agent_env() -> dict:
    env = dict(os.environ)
    extra = [
        os.path.expanduser("~/.local/share/mise/shims"),
        os.path.expanduser("~/.local/share/mise/installs/node/latest/bin"),
        os.path.expanduser("~/.local/bin"),
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ]
    env["PATH"] = os.pathsep.join([p for p in [env.get("PATH", "")] + extra if p])
    return env


def build_prompt(task: dict) -> str:
    lines = [f"Task #{task['id']} from H3man's kanban board: {task['title']}", ""]
    if task.get("notes"):
        lines += ["Notes:", task["notes"], ""]
    if task.get("due"):
        lines += [f"Due: {task['due']}", ""]
    lines += [
        "Carry out this task now, autonomously, and finish it.",
        "Prefer doing over asking; only stop to ask if something is genuinely "
        "destructive or impossible to infer.",
        "If you need H3man's answer, ask the question clearly in your reply; "
        "this task is running through Omamac/JARVIS chat.",
        "When you are done, reply with a short summary of what you did.",
    ]
    return "\n".join(lines)


def jarvis_context() -> ssl.SSLContext:
    context = ssl.create_default_context(cafile=JARVIS_CERT_FILE)
    context.check_hostname = False
    return context


def jarvis_request(path: str, payload: dict):
    try:
        with open(JARVIS_TOKEN_FILE, encoding="utf-8") as fh:
            token = fh.read().strip()
    except OSError as exc:
        raise RuntimeError("Omamac/JARVIS token is unavailable") from exc
    if not token:
        raise RuntimeError("Omamac/JARVIS token is unavailable")
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        JARVIS_URL + path,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Jarvis-Token": token,
        },
        method="POST",
    )
    try:
        return urllib.request.urlopen(request, context=jarvis_context(), timeout=15)
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            raise JarvisBusy("Omamac/JARVIS is busy with another conversation") from exc
        raise RuntimeError("Omamac/JARVIS rejected the Kanban task") from exc
    except (urllib.error.URLError, OSError, ssl.SSLError) as exc:
        raise RuntimeError("Omamac/JARVIS is unavailable") from exc


def speak_with_jarvis(text: str) -> None:
    """Read a Kanban result aloud through the local JARVIS audio path."""
    if not JARVIS_SPEAK_RUNS or not text.strip():
        return
    player = shutil.which("pw-play")
    if not player:
        return
    response = None
    audio_path = None
    try:
        response = jarvis_request("/api/tts", {"text": text[-6000:]})
        audio = response.read()
        with tempfile.NamedTemporaryFile(prefix="kanban-tts-", suffix=".wav", delete=False) as fh:
            audio_path = fh.name
            fh.write(audio)
        os.chmod(audio_path, 0o600)
        subprocess.run(
            [player, audio_path],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=300,
        )
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        # Voice output is a convenience; never turn a completed task into a
        # failed task because audio is unavailable.
        return
    finally:
        if response is not None:
            response.close()
        if audio_path:
            try:
                os.unlink(audio_path)
            except OSError:
                pass


def execute_jarvis_run(tid: int, task: dict) -> None:
    started = now()
    response = None
    try:
        deadline = time.time() + AGENT_TIMEOUT
        while response is None:
            current = connect()
            try:
                if get_task(current, tid).get("run_state") not in ("queued", "waiting"):
                    return
            finally:
                current.close()
            if tid in CANCEL:
                return
            try:
                response = jarvis_request("/api/chat", {"text": build_prompt(task)})
            except JarvisBusy:
                set_run_state(
                    tid, run_state="waiting",
                    run_output="waiting for Omamac/JARVIS…",
                )
                if time.time() >= deadline:
                    raise RuntimeError("Omamac/JARVIS stayed busy until the task timed out")
                time.sleep(2)

        current = connect()
        try:
            if get_task(current, tid).get("run_state") not in ("queued", "waiting"):
                return
        finally:
            current.close()
        set_run_state(
            tid, run_state="running", run_started_at=started,
            run_finished_at=None, run_exit=None, run_output="",
        )
        with RUN_LOCK:
            RUNNING[tid] = response

        output = []
        event = None
        while True:
            line = response.readline()
            if not line:
                break
            line = line.decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                continue
            if line.startswith("event: "):
                event = line[7:]
                continue
            if not line.startswith("data: "):
                continue
            try:
                data = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if event == "token" and isinstance(data.get("text"), str):
                output.append(data["text"])
                flush_output(tid, output, [])
            elif event == "error":
                raise RuntimeError(data.get("error") or "Omamac/JARVIS task failed")
            elif event == "done":
                if isinstance(data.get("text"), str) and not output:
                    output.append(data["text"])
                break
            event = None

        cancelled = tid in CANCEL
        text = "".join(output).strip()
        if cancelled:
            outcome = "cancelled"
            text = text or "stopped"
        else:
            outcome = "done"
            speak_with_jarvis(text)
        set_run_state(
            tid, run_state=outcome, run_output=text[-AGENT_OUTPUT_LIMIT:],
            run_finished_at=now(), run_exit=0 if outcome == "done" else 130,
        )
    except Exception as exc:  # noqa: BLE001
        if tid in CANCEL:
            set_run_state(
                tid, run_state="cancelled", run_output="stopped",
                run_finished_at=now(), run_exit=130,
            )
        else:
            set_run_state(
                tid, run_state="failed", run_output=str(exc),
                run_finished_at=now(), run_exit=1,
            )
    finally:
        with RUN_LOCK:
            RUNNING.pop(tid, None)
        CANCEL.discard(tid)
        if response is not None:
            response.close()


def build_agent_command(binary: str, tid: int) -> list:
    """Build the non-interactive command for the configured Omarchy agent."""
    if AGENT_NAME == "codex":
        return [
            binary, "exec", "--json", "--skip-git-repo-check",
            "--ask-for-approval", "never",
        ]
    cmd = [binary, "run", "--standalone", "--format", "json", "--archived",
           "--title", f"kanban #{tid}"]
    if AGENT_AUTO:
        cmd.append("--auto")
    return cmd


def set_run_state(tid: int, **fields) -> None:
    con = connect()
    try:
        with con:
            sets = ", ".join(f"{k}=?" for k in fields)
            con.execute(f"UPDATE tasks SET {sets} WHERE id=?", (*fields.values(), tid))
            if fields.get("run_state") == "done":
                task = get_task(con, tid)
                doing_id = preferred_column(con, "doing", "In progress")
                done_id = preferred_column(con, "done", "Done")
                if task["col"] == doing_id and done_id:
                    move_task(con, tid, done_id)
    finally:
        con.close()


def flush_output(tid: int, text: list, raw: list) -> None:
    out = ("".join(text).strip() or "\n".join(raw[-20:])).strip()
    if out:
        set_run_state(tid, run_output=out[-AGENT_OUTPUT_LIMIT:])


def terminate(proc) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


def execute_run(tid: int) -> None:
    con = connect()
    try:
        task = get_task(con, tid)
    except KeyError:
        con.close()
        return
    con.close()
    if task.get("run_state") != "queued":
        return

    if JARVIS_RUNS:
        execute_jarvis_run(tid, task)
        return

    binary = agent_bin()
    started = now()
    if not binary:
        set_run_state(
            tid, run_state="failed", run_started_at=started, run_finished_at=now(),
            run_exit=127, run_output=f"{AGENT_NAME} not found on PATH",
        )
        return

    set_run_state(
        tid, run_state="running", run_started_at=started,
        run_finished_at=None, run_exit=None, run_output="",
    )

    cmd = build_agent_command(binary, tid)

    try:
        proc = subprocess.Popen(
            cmd, cwd=AGENT_CWD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, bufsize=1,
            start_new_session=True, env=agent_env(),
        )
    except OSError as exc:
        set_run_state(
            tid, run_state="failed", run_finished_at=now(), run_exit=126,
            run_output=f"could not start {AGENT_NAME}: {exc}",
        )
        return

    with RUN_LOCK:
        RUNNING[tid] = proc
    try:
        proc.stdin.write(build_prompt(task))
        proc.stdin.close()
    except (BrokenPipeError, ValueError, OSError):
        pass

    lines: "queue.Queue" = queue.Queue()

    def pump():
        try:
            for line in proc.stdout:
                lines.put(line)
        finally:
            lines.put(None)

    threading.Thread(target=pump, daemon=True).start()

    text, raw, session = [], [], None
    deadline = time.time() + AGENT_TIMEOUT
    outcome = "done"
    last_flush = time.time()

    while True:
        try:
            line = lines.get(timeout=1.0)
        except queue.Empty:
            line = ""
        if line is None:
            break
        if line:
            payload = line.strip()
            if payload:
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    raw.append(payload)
                else:
                    if event.get("sessionID"):
                        session = event["sessionID"]
                    elif event.get("thread_id"):
                        session = event["thread_id"]
                    part = event.get("part") or {}
                    if event.get("type") == "text" and isinstance(part.get("text"), str):
                        text.append(part["text"])
                    elif (
                        event.get("type") == "item.completed"
                        and isinstance(event.get("item"), dict)
                        and event["item"].get("type") == "agent_message"
                        and isinstance(event["item"].get("text"), str)
                    ):
                        text.append(event["item"]["text"])
                    elif event.get("type") == "error":
                        raw.append(payload[:2000])
        if tid in CANCEL:
            outcome = "cancelled"
            terminate(proc)
            break
        if time.time() > deadline:
            outcome = "failed"
            raw.append(f"[timed out after {AGENT_TIMEOUT}s]")
            terminate(proc)
            break
        if time.time() - last_flush > 3:
            flush_output(tid, text, raw)
            last_flush = time.time()

    try:
        rc = proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        terminate(proc)
        rc = proc.wait(timeout=5)

    with RUN_LOCK:
        RUNNING.pop(tid, None)
    CANCEL.discard(tid)

    output = "".join(text).strip() or "\n".join(raw[-40:]).strip()
    if outcome == "done" and rc != 0:
        outcome = "failed"
        tail = "\n".join(raw[-20:]).strip()
        if tail:
            output = (output + "\n\n" + tail).strip()
    if outcome == "cancelled" and not output:
        output = "stopped"
    set_run_state(
        tid, run_state=outcome, run_output=output[-AGENT_OUTPUT_LIMIT:],
        run_finished_at=now(), run_exit=rc, run_session=session,
    )


def worker() -> None:
    while True:
        tid = QUEUE.get()
        try:
            execute_run(tid)
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"kanban: run {tid} failed: {exc}\n")
            try:
                set_run_state(
                    tid, run_state="failed", run_finished_at=now(),
                    run_output=f"runner error: {exc}",
                )
            except Exception:  # noqa: BLE001
                pass
        finally:
            QUEUE.task_done()


def start_runner() -> None:
    con = connect()
    try:
        with con:
            con.execute(
                """UPDATE tasks
                      SET run_state='interrupted', run_finished_at=?,
                          run_output=run_output || '\n[interrupted: service restarted; retry to run again]'
                    WHERE run_state IN ('running','waiting','queued')""",
                (now(),),
            )
    finally:
        con.close()
    threading.Thread(target=worker, daemon=True, name="agent-runner").start()


def queue_run(con, tid: int) -> dict:
    get_task(con, tid)
    result = con.execute(
        """UPDATE tasks
              SET run_state='queued', run_output='', run_exit=NULL,
                  run_started_at=NULL, run_finished_at=NULL
            WHERE id=? AND COALESCE(run_state, 'idle') NOT IN ('queued','waiting','running')""",
        (tid,),
    )
    if result.rowcount != 1:
        raise ValueError("task is already queued or running")
    # The HTTP handler owns the surrounding transaction. Commit before waking
    # the worker, otherwise it can read the old idle state and exit.
    con.commit()
    QUEUE.put(tid)
    return get_task(con, tid)


def cancel_run(con, tid: int) -> dict:
    task = get_task(con, tid)
    state = task.get("run_state")
    if state == "running":
        CANCEL.add(tid)
        with RUN_LOCK:
            active = RUNNING.get(tid)
        if JARVIS_RUNS and active is not None:
            try:
                active.close()
            except OSError:
                pass
        con.execute(
            "UPDATE tasks SET run_output=? WHERE id=?",
            ((task["run_output"].rstrip() + "\n[stopping…]").strip(), tid),
        )
    elif state == "waiting":
        CANCEL.add(tid)
        con.execute(
            """UPDATE tasks
                  SET run_state='cancelled', run_finished_at=?, run_exit=130,
                      run_output=?
                WHERE id=?""",
            (now(), (task["run_output"].rstrip() + "\n[stopped]").strip(), tid),
        )
    elif state == "queued":
        con.execute("UPDATE tasks SET run_state='idle' WHERE id=?", (tid,))
    return get_task(con, tid)


# ------------------------------------------------------------------ networking

def tailscale_ip():
    """Return this host's Tailscale (CGNAT 100.64/10) IPv4 address, if any."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        for _, name in socket.if_nameindex():
            try:
                packed = fcntl.ioctl(
                    s.fileno(), 0x8915, struct.pack("256s", name.encode()[:15])
                )
            except OSError:
                continue
            ip = socket.inet_ntoa(packed[20:24])
            parts = ip.split(".")
            if ip.startswith("100.") and 64 <= int(parts[1]) <= 127:
                return ip
    except Exception:
        pass
    finally:
        s.close()
    return None


# ----------------------------------------------------------------------- http

class Handler(BaseHTTPRequestHandler):
    server_version = "kanban/1.0"
    protocol_version = "HTTP/1.1"

    # -- helpers
    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": str(message)}, status)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > 2_000_000:
            raise ValueError("payload too large")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSON: {exc.msg}")
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        return data

    def serve_static(self, path: str):
        rel = path.lstrip("/") or "index.html"
        if ".." in rel.split("/") or rel.startswith("/"):
            return self.send_error_json("forbidden", 403)
        full = os.path.join(WEB_DIR, rel)
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            full = os.path.join(WEB_DIR, "index.html")
            if not os.path.isfile(full):
                return self.send_error_json("not found", 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in (
            "application/javascript", "application/json", "image/svg+xml"
        ):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # -- verbs
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/theme":
            from theme import current_theme
            return self.send_json(current_theme())
        if path == "/api/health":
            return self.send_json({"ok": True, "time": now()})
        if path == "/api/board":
            con = connect()
            try:
                return self.send_json(board(con))
            finally:
                con.close()
        m = re.fullmatch(r"/api/tasks/(\d+)", path)
        if m:
            con = connect()
            try:
                return self.send_json(get_task(con, int(m.group(1))))
            except KeyError:
                return self.send_error_json("task not found", 404)
            finally:
                con.close()
        if path.startswith("/api/"):
            return self.send_error_json("not found", 404)
        return self.serve_static(path)

    do_HEAD = do_GET

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            con = connect()
            try:
                with con:
                    if path == "/api/tasks":
                        return self.send_json(add_task(
                            con,
                            data.get("title"),
                            data.get("notes", ""),
                            data.get("col"),
                            data.get("priority", "normal"),
                            data.get("due"),
                            data.get("repeat", "none"),
                        ), 201)
                    m = re.fullmatch(r"/api/tasks/(\d+)/move", path)
                    if m:
                        return self.send_json(move_task(
                            con, int(m.group(1)), data.get("col"), data.get("index")
                        ))
                    m = re.fullmatch(r"/api/tasks/(\d+)/run", path)
                    if m:
                        return self.send_json(queue_run(con, int(m.group(1))), 202)
                    m = re.fullmatch(r"/api/tasks/(\d+)/cancel", path)
                    if m:
                        return self.send_json(cancel_run(con, int(m.group(1))))
                    if path == "/api/columns":
                        return self.send_json(add_column(con, data.get("title")), 201)
                return self.send_error_json("not found", 404)
            finally:
                con.close()
        except KeyError:
            return self.send_error_json("task or column not found", 404)
        except ValueError as exc:
            return self.send_error_json(exc, 400)
        except Exception as exc:  # noqa: BLE001
            return self.send_error_json(f"server error: {exc}", 500)

    def do_PATCH(self):
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            con = connect()
            try:
                with con:
                    m = re.fullmatch(r"/api/tasks/(\d+)", path)
                    if m:
                        return self.send_json(update_task(con, int(m.group(1)), data))
                    m = re.fullmatch(r"/api/columns/([\w-]+)", path)
                    if m:
                        return self.send_json(rename_column(con, m.group(1), data.get("title")))
                return self.send_error_json("not found", 404)
            finally:
                con.close()
        except KeyError:
            return self.send_error_json("task or column not found", 404)
        except ValueError as exc:
            return self.send_error_json(exc, 400)
        except Exception as exc:  # noqa: BLE001
            return self.send_error_json(f"server error: {exc}", 500)

    def do_DELETE(self):
        path = urlparse(self.path).path
        try:
            con = connect()
            try:
                with con:
                    m = re.fullmatch(r"/api/tasks/(\d+)", path)
                    if m:
                        return self.send_json(delete_task(con, int(m.group(1))))
                    m = re.fullmatch(r"/api/columns/([\w-]+)", path)
                    if m:
                        return self.send_json(delete_column(con, m.group(1)))
                return self.send_error_json("not found", 404)
            finally:
                con.close()
        except KeyError:
            return self.send_error_json("task or column not found", 404)
        except ValueError as exc:
            return self.send_error_json(exc, 400)
        except Exception as exc:  # noqa: BLE001
            return self.send_error_json(f"server error: {exc}", 500)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


def main() -> int:
    ap = argparse.ArgumentParser(description="Kanban board server")
    ap.add_argument("--host", default=os.environ.get("KANBAN_HOST"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("KANBAN_PORT", "8787")))
    args = ap.parse_args()

    host = args.host
    if not host:
        host = tailscale_ip() or "127.0.0.1"

    init_db()
    start_runner()
    httpd = ThreadingHTTPServer((host, args.port), Handler)
    httpd.daemon_threads = True
    print(
        f"kanban listening on http://{host}:{args.port}  (db: {DB_PATH})\n"
        f"agent runner: {AGENT_NAME} in {AGENT_CWD} "
        f"(auto-approve: {'on' if AGENT_AUTO else 'off'})",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
