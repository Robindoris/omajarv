// Read the active palette on demand so atomic Omarchy theme swaps need no restart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const fallback = { background: '#101315', foreground: '#cacccc', accent: '#cacccc', muted: '#707880', red: '#a55555', yellow: '#d7ba7d' };
const hex = value => typeof value === 'string' && /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value);
export function rgb(value) {
  const full = value.length === 4 ? '#' + [...value.slice(1)].map(c => c + c).join('') : value;
  return [1, 3, 5].map(i => parseInt(full.slice(i, i + 2), 16));
}
function mix(a, b, amount) {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v * (1 - amount) + y[i] * amount).toString(16).padStart(2, '0')).join('');
}
export function parsePalette(source) {
  const values = {};
  // Only top-level literal palette values are relevant; never evaluate theme content.
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*([\w-]+)\s*=\s*(["'])([^"']+)\2\s*(?:#.*)?$/);
    if (match && (hex(match[3]) || (match[1] === 'mode' && /^(dark|light)$/.test(match[3])))) values[match[1]] = match[3];
  }
  return values;
}
export function buildTheme(values, name = 'Omarchy') {
  const pick = (key, alternative) => hex(values[key]) ? values[key] : alternative;
  const bg = pick('background', fallback.background), text = pick('foreground', fallback.foreground);
  const core = pick('accent', text), muted = pick('muted', mix(bg, text, 0.6));
  const mode = /^(dark|light)$/.test(values.mode || '') ? values.mode : rgb(bg).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0) > 150 ? 'light' : 'dark';
  const palette = {
    bg, text, core, muted,
    mid: mix(core, bg, 0.2), dim: mix(core, bg, 0.75),
    amber: pick('yellow', fallback.yellow), red: pick('red', fallback.red),
    bright: pick('bright_foreground', mix(core, text, 0.65)),
    panel: pick('lighter_background', mix(bg, text, 0.045)),
  };
  const css = {};
  for (const [key, value] of Object.entries(palette)) {
    css['--' + key] = value;
    css['--' + key + '-rgb'] = rgb(value).join(', ');
  }
  css['--panel'] = `rgba(${rgb(palette.panel).join(', ')}, 0.92)`;
  css['--line'] = `rgba(${rgb(core).join(', ')}, 0.15)`;
  css['--line-strong'] = `rgba(${rgb(core).join(', ')}, 0.34)`;
  const revision = crypto.createHash('sha256').update(JSON.stringify([name, mode, palette])).digest('hex').slice(0, 16);
  return { name, mode, palette, css, revision };
}
export function createThemeReader(home = os.homedir()) {
  const current = path.join(home, '.local/state/omarchy/current');
  const directories = [path.join(current, 'theme'), path.join(home, '.config/omarchy/current/theme')];
  let last = buildTheme(fallback);
  return () => {
    for (const directory of directories) {
      try {
        const values = parsePalette(fs.readFileSync(path.join(directory, 'colors.toml'), 'utf8'));
        // During a theme swap keep the last complete palette, avoiding a flash.
        if (!hex(values.background) || !hex(values.foreground)) continue;
        let name = 'Omarchy';
        try { name = fs.readFileSync(path.join(current, 'theme.name'), 'utf8').trim().slice(0, 100) || name; } catch {}
        last = buildTheme(values, name);
        return last;
      } catch { /* theme directory can disappear briefly during an atomic swap */ }
    }
    return last;
  };
}
export const readTheme = createThemeReader();
export function themeStyles(theme = readTheme()) {
  return ':root {\n' + Object.entries(theme.css).map(([key, value]) => `  ${key}: ${value};`).join('\n') + `\n  color-scheme: ${theme.mode};\n}\n`;
}
