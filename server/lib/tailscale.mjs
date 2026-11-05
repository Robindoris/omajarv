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
export async function disableTailscale(config, { legacyOnly = false } = {}) {
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
  await run(['serve', '--https=443', '--set-path=/', 'off']);
}
export async function enableTailscale(config) {
  await disableTailscale(config, { legacyOnly: true });
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
    return await run(['serve', '--bg', '--https=443', target], 12000);
  } catch (error) {
    // When HTTPS needs enabling, the CLI prints a user-specific approval URL.
    throw new Error([error.stdout, error.stderr, error.killed ? 'Enable HTTPS using the link above, then press Enable again.' : error.message].filter(Boolean).join('\n'));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  try {
    if (process.argv[2] === 'disable') await disableTailscale(config);
    else if (process.argv[2] === 'retire-legacy') await disableTailscale(config, { legacyOnly: true });
    else if (process.argv[2] === 'enable') console.log(await enableTailscale(config));
    else console.log(JSON.stringify(await tailscaleStatus(config)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
