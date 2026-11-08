"""Read only public, allowlisted Omarchy palette values."""
import os
import re
import tomllib
from pathlib import Path


def current_theme():
    state = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state')) / 'omarchy/current'
    try:
        data = tomllib.loads((state / 'theme/colors.toml').read_text())
    except (OSError, ValueError):
        return {'colors': {}, 'mode': 'dark'}
    mapping = {'background': '--bg', 'lighter_background': '--panel',
               'foreground': '--text', 'dark_foreground': '--muted',
               'accent': '--accent', 'red': '--high', 'green': '--ok',
               'yellow': '--warning', 'muted': '--accent-dim'}
    colors = {css: data[key] for key, css in mapping.items()
              if isinstance(data.get(key), str) and re.fullmatch(r'#[0-9a-fA-F]{6}', data[key])}
    return {'colors': colors, 'mode': 'light' if data.get('mode') == 'light' else 'dark'}
