import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from theme import current_theme


class ThemeTests(unittest.TestCase):
    def test_changes_fallback_and_allowlist(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'XDG_STATE_HOME': folder}):
            self.assertEqual(current_theme()['colors'], {})
            path = Path(folder) / 'omarchy/current/theme/colors.toml'
            path.parent.mkdir(parents=True)
            path.write_text('background = "#ffffff"\naccent = "#123456"\nmode = "light"\nsecret = "hidden"')
            self.assertEqual(current_theme(), {'colors': {'--bg': '#ffffff', '--accent': '#123456'}, 'mode': 'light'})
            path.write_text('background = "#000000"\naccent = "url(evil)"')
            self.assertEqual(current_theme()['colors'], {'--bg': '#000000'})
            path.write_text('not valid toml = [')
            self.assertEqual(current_theme()['colors'], {})
