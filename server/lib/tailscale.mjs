// Tailscale Serve is independent of the Cloudflare tunnel and persists in tailscaled.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
const exec = promisify(execFile);
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
    const target = `https+insecure://localhost:${config.port}`;
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
export async function enableTailscale(config) {
  const serve = JSON.parse(await run(['serve', 'status', '--json']));
  const target = `https+insecure://localhost:${config.port}`;
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
    if (process.argv[2] === 'enable') console.log(await enableTailscale(config));
    else console.log(JSON.stringify(await tailscaleStatus(config)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
