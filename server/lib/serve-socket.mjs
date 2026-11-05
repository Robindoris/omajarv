// Tailscale talks HTTP only over a filesystem socket protected from other users.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { paths } from './config.mjs';

export async function listenServeSocket(handler) {
  // A crashed process can leave a socket behind. Never remove a live listener,
  // symlink or regular file, even inside our private directory.
  if (fs.existsSync(paths.serveSocket)) {
    const stat = fs.lstatSync(paths.serveSocket);
    if (!stat.isSocket() || stat.uid !== process.getuid()) throw new Error('Unsafe JARVIS Serve socket');
    await new Promise((resolve, reject) => {
      const probe = net.connect(paths.serveSocket);
      probe.setTimeout(1000, () => { probe.destroy(); reject(new Error('JARVIS Serve socket probe timed out')); });
      probe.once('connect', () => { probe.destroy(); reject(new Error('JARVIS Serve socket is already in use')); });
      probe.once('error', error => {
        if (error.code === 'ECONNREFUSED') resolve();
        else reject(error);
      });
    });
    fs.unlinkSync(paths.serveSocket);
  }
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(paths.serveSocket, () => {
      fs.chmodSync(paths.serveSocket, 0o600);
      resolve();
    });
  });
  return server;
}
