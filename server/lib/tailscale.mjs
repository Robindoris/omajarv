// Tailscale Serve is independent of the Cloudflare tunnel and persists in tailscaled.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadConfig, paths } from './config.mjs';
const exec = promisify(execFile);
export const serveTarget = `unix:${paths.serveSocket}`;
const legacyTarget = config => `https+insecure://localhost:${config.port}`;
async function run(args, timeout = 5000) {
  return (await exec('tailscale', args, { timeout, maxBuffer: 1024 * 1024 })).stdout;
}
const permissionDenied = error => /must be root|access denied|permission denied|requires root|must be run as root/i.test(String(error.stderr || error.message));
async function changeServe(args, { authorize = false } = {}) {
  try { return await run(args, 12000); }
  catch (error) {
    if (!permissionDenied(error)) throw error;
  }
  // Elevate only the packaged Tailscale binary, never Node or this checkout.
  // Lifecycle cleanup may use existing sudo rights, but must never open a dialog.
  const command = '/usr/bin/tailscale';
  const manualCommand = ['sudo', command, ...args].map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(' ');
  try { return (await exec('sudo', ['-n', '--', command, ...args], {timeout:12000, maxBuffer:1024 * 1024})).stdout; }
  catch (error) {
    if (!authorize) throw new Error('Tailscale needs administrator permission. Run jarvis tailscale-enable from the desktop, then retry this operation.');
  }
  try {
    return (await exec('pkexec', [command, ...args], {timeout:120000, maxBuffer:1024 * 1024})).stdout;
  } catch (error) {
    if (error.code === 126 || error.code === 127 || error.killed) {
      throw new Error('Tailscale authorization was cancelled or unavailable. Press Enable to retry, or run ' + manualCommand + ' in a terminal.');
    }
    if (error.code === 'ENOENT') throw new Error('Install polkit for desktop authorization, or run ' + manualCommand + ' in a terminal.');
    throw error;
  }
}
export async function tailscaleStatus(config) {
  try {
    const [node, serve] = await Promise.all([
      run(['status', '--json']).then(JSON.parse),
      run(['serve', 'status', '--json']).then(JSON.parse),
    ]);
    const host = (node.Self?.DNSName || '').replace(/\.$/, '');
    const target = serveTarget;
    const web = serve.Web?.[`${host}:443`];
    const ready = node.BackendState === 'Running' && node.Self?.Online !== false &&
      serve.TCP?.['443']?.HTTPS === true && web?.Handlers?.['/']?.Proxy === target &&
      !serve.AllowFunnel?.[`${host}:443`];
    return { state: ready ? 'up' : 'off', url: ready ? `https://${host}` : '',
      hostname: host, error: ready ? '' : 'Enable private Tailscale Serve; your phone must use the same tailnet.' };
  } catch (error) {
    return { state: 'error', url: '', error: String(error.stderr || error.message).trim().slice(-500) };
  }
}
// Only the root route on this node that points at JARVIS belongs to us.
// Never reset Serve wholesale: other paths/listeners may belong to other apps.
export async function disableTailscale(config, { legacyOnly = false, authorize = false } = {}) {
  let node, serve;
  try {
    [node, serve] = await Promise.all([
      run(['status', '--json']).then(JSON.parse),
      run(['serve', 'status', '--json']).then(JSON.parse),
    ]);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('Cannot inspect Tailscale Serve; refusing unsafe lifecycle change. ' + String(error.stderr || error.message).trim());
  }
  const host = (node.Self?.DNSName || '').replace(/\.$/, '');
  const target = serve.Web?.[`${host}:443`]?.Handlers?.['/']?.Proxy;
  if (target !== legacyTarget(config) && (legacyOnly || target !== serveTarget)) return;
  await changeServe(['serve', '--https=443', '--set-path=/', 'off'], {authorize});
}
export async function enableTailscale(config, { authorize = false } = {}) {
  await disableTailscale(config, { legacyOnly: true, authorize });
  const serve = JSON.parse(await run(['serve', 'status', '--json']));
  const target = serveTarget;
  // Do not replace another app's listener or a public Funnel listener.
  const webs = Object.entries(serve.Web || {}).filter(([key]) => key.endsWith(':443'));
  if (serve.TCP?.['443'] || webs.length) {
    const status = await tailscaleStatus(config);
    if (status.state === 'up') return 'Tailscale tunnel is ready.';
    throw new Error('Port 443 already has a Tailscale service. Existing settings were kept.');
  }
  try {
    return await changeServe(['serve', '--bg', '--https=443', target], {authorize});
  } catch (error) {
    // When HTTPS needs enabling, the CLI prints a user-specific approval URL.
    throw new Error([error.stdout, error.stderr || error.message, error.killed ? 'Enable HTTPS using the link above, then press Enable again.' : ''].filter(Boolean).join('\n'));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  try {
    if (process.argv[2] === 'disable') await disableTailscale(config);
    else if (process.argv[2] === 'retire-legacy') await disableTailscale(config, { legacyOnly: true });
    else if (process.argv[2] === 'enable') console.log(await enableTailscale(config, {authorize:true}));
    else console.log(JSON.stringify(await tailscaleStatus(config)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
