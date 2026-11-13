import {spawn} from 'node:child_process';

const children = new Set();
process.on('exit', stopChildren);
export function killGroup(child, signal = 'SIGKILL') {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch {}
}
export function stopChildren() {
  for (const child of children) killGroup(child);
}

export function managedSpawn(file, args, {timeout, killOnClose = true, ...options}) {
  const child = spawn(file, args, {...options, detached:true});
  children.add(child);
  const timer = setTimeout(() => killGroup(child), timeout);
  child.once('close', () => { clearTimeout(timer); if (killOnClose) killGroup(child); children.delete(child); });
  return child;
}

// Linux process groups ensure helpers cannot leave a pipe-holding descendant
// behind after a timeout. SIGKILL also covers helpers which ignore SIGTERM.
export function boundedExec(file, args, {timeout = 30000, maxBuffer = 64*1024,
  encoding = 'utf8', input, fileSizeLimit, ...options} = {}) {
  return new Promise((resolve, reject) => {
    const command = fileSizeLimit ? 'prlimit' : file;
    const argv = fileSizeLimit ? [`--fsize=${fileSizeLimit}:${fileSizeLimit}`, '--', file, ...args] : args;
    const child = spawn(command, argv, {...options, detached:true, stdio:['pipe','pipe','pipe']});
    children.add(child);
    const chunks = [[], []];
    let bytes = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup(child);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      chunks[0].length = 0; chunks[1].length = 0;
      children.delete(child);
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Helper deadline exceeded')), timeout);
    for (const [index, stream] of [child.stdout, child.stderr].entries()) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBuffer) return finish(new Error('Helper output limit exceeded'));
      chunks[index].push(chunk);
    });
    child.on('error', error => finish(error));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') finish(error); });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) { const error = new Error(`Helper failed (exit ${code})`); error.code = code; return finish(error); }
      const decode = list => { const buffer = Buffer.concat(list); return encoding === 'buffer' ? buffer : buffer.toString(encoding); };
      finish(null, {stdout:decode(chunks[0]), stderr:decode(chunks[1])});
    });
    child.stdin.end(input);
  });
}
