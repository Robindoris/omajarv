import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/jarvis-daily.py'


class DailyTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        base = Path(tmp.name)
        self.repo, self.state, self.bin = (base / name for name in ('working copy', 'state', 'bin'))
        self.source = base / 'upstream'
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}')
        for repo in (self.repo, self.source):
            subprocess.run(['git', 'init', '-q', '-b', 'jarvis-2.0', repo], check=True)
            self.git(repo, 'config', 'user.email', 'daily@example.invalid')
            self.git(repo, 'config', 'user.name', 'Daily Test')
        (self.source / 'feature.mjs').write_text('export const version = 1;\n')
        self.commit_upstream('Initial version')
        self.git(self.repo, 'remote', 'add', 'origin', str(self.source))
        self.git(self.repo, 'pull', '-q', 'origin', 'jarvis-2.0')

    def git(self, repo, *args):
        return subprocess.check_output(['git', '-C', repo, *args], text=True, stderr=subprocess.PIPE).strip()

    def commit_upstream(self, subject):
        self.git(self.source, 'add', '.')
        self.git(self.source, 'commit', '-qm', subject)

    def run_daily(self, *args, input=None):
        return subprocess.run([sys.executable, SCRIPT, '--repo', self.repo, '--state', self.state, *args],
                              env=self.env, text=True, capture_output=True, input=input)

    def read(self, name):
        return (self.state / name).read_text()

    def test_evening_fetches_and_prepares_without_touching_dirty_work(self):
        self.assertEqual(self.run_daily('evening').returncode, 0)
        (self.repo / 'feature.mjs').write_text('export const version = 2; // unfinished\n')
        (self.source / 'feature.mjs').write_text('export const version = 3;\n')
        self.commit_upstream('Upstream change')
        before = self.git(self.repo, 'status', '--porcelain')
        result = self.run_daily('evening')
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = self.read('plan.md')
        self.assertIn('Upstream change', plan)
        self.assertIn('feature.mjs', plan)
        self.assertNotIn('// unfinished', plan)
        self.assertEqual(self.git(self.repo, 'status', '--porcelain'), before)
        self.assertIn('// unfinished', (self.repo / 'feature.mjs').read_text())
        self.assertEqual(self.git(self.repo, 'log', '-1', '--format=%s'), 'Initial version')

    def test_morning_picks_default_agent_and_evening_reuses_its_handoff(self):
        self.assertEqual(self.run_daily('evening').returncode, 0)
        board, env = self.start_board()
        (self.repo / 'feature.mjs').write_text('export const version = 2; // already edited\n')
        agent = self.bin / 'omarchy'
        agent.write_text('''#!/usr/bin/python3
from pathlib import Path
import sys
assert sys.argv[1:4] == ['agent', 'prompt', '--inline'], sys.argv
assert 'Wait for my approval' in sys.argv[4]
with Path('feature.mjs').open('a') as f:
    f.write('// agent edit\\n')
notes = next(line[7:] for line in sys.argv[4].splitlines() if line.startswith('Notes: '))
Path(notes).write_text('Follow-up: verify regression coverage.')
''')
        agent.chmod(0o700)
        result = self.run_daily('--board-state', board, 'session', input='\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        summary, = (self.state / 'sessions').glob('*/summary.md')
        self.assertIn('feature.mjs', summary.read_text())
        self.assertNotIn('// agent edit', summary.read_text())
        task, = self.board_tool(env, 'list')['tasks']
        self.assertEqual(task['status'], 'done', 'visible as soon as the morning session exits')
        self.assertIn('verify regression coverage', task['notes'])
        self.assertEqual(self.run_daily('evening').returncode, 0)
        self.assertIn('Follow-up: verify regression coverage.', self.read('plan.md'))

    def test_offline_refresh_still_creates_a_labeled_plan(self):
        self.git(self.repo, 'remote', 'set-url', 'origin', str(self.source / 'unavailable'))
        result = self.run_daily('evening')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Cached only (fetch failed)', self.read('plan.md'))

    def test_session_cancel_does_not_launch_agent_or_record_a_session(self):
        (self.bin / 'omarchy').write_text('#!/bin/sh\nexit 42\n')
        (self.bin / 'omarchy').chmod(0o700)
        result = self.run_daily('session', input='')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.state / 'sessions').exists())

    def test_wrong_branch_is_refused_before_fetch_or_launch(self):
        self.git(self.repo, 'switch', '-c', 'another-branch')
        result = self.run_daily('evening')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Expected the jarvis-2.0 checkout', result.stderr)
        self.assertFalse(self.state.exists())

    def test_morning_launcher_does_not_wait_for_terminal_to_close(self):
        launcher = self.bin / 'omarchy'
        launcher.write_text('''#!/usr/bin/python3
import sys
from pathlib import Path
from time import sleep
assert sys.argv[1:4] == ['launch', 'tui', '--app-id=org.omarchy.jarvis-daily']
assert Path(sys.argv[6]) == Path.cwd()
marker = Path(sys.argv[8]) / 'morning-date'
for _ in range(30):
    if marker.is_file():
        sys.exit(0)
    sleep(0.1)
sys.exit(42)
''')
        launcher.chmod(0o700)
        result = self.run_daily('morning')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.state / 'morning-date').is_file())

    def start_board(self, port=0):
        home = self.state.parent / 'b'
        config = home / '.config/omarchy-jarvis'
        config.mkdir(parents=True)
        (config / 'config.json').write_text(json.dumps({'host': '127.0.0.1', 'port': port,
                                                        'tunnel': {'enabled': False}}))
        tailscale = self.bin / 'tailscale'
        tailscale.write_text('#!/bin/sh\nprintf "{}\\n"\n')
        tailscale.chmod(0o700)
        env = dict(self.env, HOME=str(home), XDG_RUNTIME_DIR=str(home / 'run'),
                   DBUS_SESSION_BUS_ADDRESS='unix:path=' + str(home / 'no-session-bus'))
        board = home / '.local/state/omarchy-jarvis'
        board.mkdir(parents=True, mode=0o700)
        (board / 'token').write_text('fixture-only_token\n')
        (board / 'token').chmod(0o600)
        server = subprocess.Popen(['node', SCRIPT.parents[1] / 'server/jarvis-server.mjs', '--http'],
                                  env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def stop():
            server.terminate()
            server.wait(timeout=10)
        self.addCleanup(stop)
        for _ in range(100):
            if (board / 'serve.sock').is_socket():
                return board, env
            self.assertIsNone(server.poll(), 'fixture bridge exited before creating its socket')
            time.sleep(0.05)
        self.fail('fixture bridge did not start')

    def board_tool(self, env, *args):
        return json.loads(subprocess.check_output(
            ['node', SCRIPT.parents[1] / 'server/kanban-cli.mjs', *args], env=env, text=True))

    def test_offline_report_retries_into_done_once_on_the_real_board(self):
        report = self.state / 'sessions/2026-11-20T080000.123456'
        report.mkdir(parents=True)
        (report / 'summary.md').write_text('Agent process: exited with code 0\nObserved: feature.mjs')
        (report / 'notes.md').write_text('Fixed the regression.\nTests: 2 passed.\nNext: review.')
        board = self.state.parent / 'b/.local/state/omarchy-jarvis'
        result = self.run_daily('--board-state', board, 'evening')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('pending', result.stderr)
        self.assertIn('Fixed the regression', self.read('plan.md'))
        board, env = self.start_board()
        for _ in range(2):
            result = self.run_daily('--board-state', board, 'publish')
            self.assertEqual(result.returncode, 0, result.stderr)
        view = self.board_tool(env, 'list')
        task, = view['tasks']
        self.assertIn('Jarvis 2.0', task['title'])
        self.assertEqual(task['status'], 'done')
        self.assertEqual(task['attempts'], 0)
        self.assertIn('Tests: 2 passed.', task['notes'])
        self.assertIn('feature.mjs', task['notes'])
        # The board can have the card even if the runner died before saving a receipt.
        (report / 'kanban-card').unlink()
        (report / 'kanban-published').unlink()
        self.assertEqual(self.run_daily('--board-state', board, 'publish').returncode, 0)
        self.assertEqual(self.board_tool(env, 'list'), view, 'missing receipts do not duplicate the card')
        self.board_tool(env, 'delete', task['id'])
        self.assertEqual(self.run_daily('--board-state', board, 'publish').returncode, 0)
        self.assertEqual(self.board_tool(env, 'list')['tasks'], [], 'a deleted card is not recreated')

    def test_selected_card_is_used_by_the_morning_runner_even_without_a_listener(self):
        import http.client
        import socket

        board, env = self.start_board()
        chosen, = self.board_tool(env, 'add', 'Polish the mobile search field')['tasks']
        self.board_tool(env, 'edit', chosen['id'], json.dumps({'notes': 'Keep desktop unchanged. Verify at 390px.'}))
        view = self.board_tool(env, 'list')

        def request(method, data=None, authorized=True):
            connection = http.client.HTTPConnection('localhost', timeout=3)
            connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            connection.sock.connect(str(board / 'serve.sock'))
            headers = {'Content-Type': 'application/json'}
            if authorized:
                headers['X-Jarvis-Token'] = (board / 'token').read_text().strip()
            try:
                connection.request(method, '/api/kanban/morning', json.dumps(data) if data is not None else None, headers)
                with connection.getresponse() as response:
                    return response.status, json.loads(response.read())
            finally:
                connection.close()

        self.assertEqual(request('GET', authorized=False)[0], 401)
        self.assertEqual(request('GET'), (200, {'task': None}))
        self.assertEqual(request('POST', {'id': chosen['id'], 'revision': 0})[0], 409)
        self.assertEqual(request('POST', {'id': 'missing', 'revision': view['revision']})[0], 404)
        self.assertEqual(request('POST', {'id': chosen['id'], 'revision': view['revision']})[0], 200)
        selected = request('GET')[1]['task']
        self.assertIn('Verify at 390px', selected['notes'])
        self.assertEqual(self.board_tool(env, 'list'), view, 'selection does not run or move the task')
        result = self.run_daily('--board-state', board, 'task', 'clear')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(request('GET'), (200, {'task': None}))
        result = self.run_daily('--board-state', board, 'task', chosen['id'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(request('GET')[1]['task'], selected)
        self.assertEqual((board / 'morning-task.json').stat().st_mode & 0o777, 0o600)

        (board / 'serve.sock').rename(board / 'offline.sock')
        result = self.run_daily('--board-state', board, 'evening')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Polish the mobile search field', self.read('plan.md'))
        agent = self.bin / 'omarchy'
        agent.write_text('''#!/usr/bin/python3
from pathlib import Path
import sys
prompt = sys.argv[4]
assert 'Wait for my approval' in prompt
selection = next(l.removeprefix('Selection: ') for l in prompt.splitlines() if l.startswith('Selection: '))
assert 'Verify at 390px' in Path(selection).read_text()
''')
        agent.chmod(0o700)
        result = self.run_daily('--board-state', board, 'session', input='\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        (board / 'offline.sock').rename(board / 'serve.sock')
        self.board_tool(env, 'move', chosen['id'], 'done')
        self.assertIsNone(request('GET')[1]['task'], 'finished tasks are not selected')
        self.assertIsNone(json.loads((board / 'morning-task.json').read_text()), 'the offline copy is cleared too')


if __name__ == '__main__':
    unittest.main()
