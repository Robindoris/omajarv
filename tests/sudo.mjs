import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { publicEncrypt, constants } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sudo-'));
process.env.HOME = home;
let session;
const children = new Set();
try {
  const {ensureDirs} = await import('../server/lib/config.mjs');
  const {createSudoSession} = await import('../server/lib/sudo.mjs');
  const {runSudo} = await import('../server/sudo-command.mjs');
  ensureDirs();
  const controller = new AbortController();
  session = await createSudoSession({signal:controller.signal});
  const wrapper = session.env.PATH.split(path.delimiter)[0] + '/sudo';
  assert.equal(fs.statSync(path.dirname(wrapper)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(wrapper).mode & 0o777, 0o700);
  const source = fs.readFileSync(wrapper, 'utf8');
  const capability = JSON.parse(source.match(/await runSudo\((\{.*\}), process/)[1]);
  assert.equal(fs.statSync(capability.socketPath).mode & 0o777, 0o600);
  assert.ok(!session.instruction.includes(capability.ticket));
  let invocation;
  await runSudo(capability, ['id'], {spawnSudo:(cmd,args,options) => {
    invocation = {cmd,args,options};
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  }});
  assert.equal(invocation.cmd, '/usr/bin/sudo');
  assert.deepEqual(invocation.args, ['-A','-k','id']);
  assert.equal(invocation.options.env.SUDO_ASKPASS.endsWith('sudo-askpass.mjs'), true);
  const ask = () => {
    // This child's stdout represents sudo's private askpass pipe, never agent output.
    const child = spawn(process.execPath, [invocation.options.env.SUDO_ASKPASS], {
      env:invocation.options.env, stdio:['ignore','pipe','pipe'],
    });
    children.add(child);
    let output = '', errors = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => errors += data);
    const exited = once(child, 'exit').then(([code]) => {children.delete(child);return {code,output,errors};});
    return {child, exited};
  };
  const waitRequest = async () => {
    for (let i=0;i<200;i++) {
      if (session.list().length) return session.list()[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('No sudo request registered');
  };
  const first = ask();
  const request = await waitRequest();
  let approvalFinished = false;
  const waiting = session.waitForPending().then(() => { approvalFinished = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(approvalFinished, false, 'agent completion must not dismiss pending authorization');
  assert.equal(request.command, 'sudo "id"');
  assert.ok(!JSON.stringify(request).includes(capability.ticket));
  assert.equal(session.reply({id:request.id,password:'must not accept plaintext'}),false);
  assert.equal(session.reply({id:request.id,ciphertext:'invalid'}),false);
  const password = 'fixture-password-ä-$`';
  const ciphertext = publicEncrypt({key:request.publicKey, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256'}, Buffer.from(password)).toString('base64');
  assert.ok(!ciphertext.includes(password));
  assert.equal(session.reply({id:request.id,ciphertext}),true);
  await waiting;
  assert.equal(approvalFinished, true);
  assert.equal(session.reply({id:request.id,ciphertext}),false,'reply must be one-use');
  const result = await first.exited;
  assert.equal(result.code,0,result.errors);
  assert.equal(result.output,password+'\n');
  assert.equal(result.errors,'');
  assert.deepEqual(session.list(),[]);
  const cancelled = ask();
  assert.equal(session.reply({id:(await waitRequest()).id,cancel:true}),true);
  const cancelResult = await cancelled.exited;
  assert.equal(cancelResult.code,1);
  assert.equal(cancelResult.output,'');
  const aborted = ask();
  await waitRequest();
  controller.abort();
  assert.equal((await aborted.exited).output,'');
  assert.equal(fs.existsSync(wrapper),false);
  assert.deepEqual(session.list(),[]);
  // Requests not holding the per-turn capability cannot register a challenge.
  session = await createSudoSession({timeoutMs:150});
  const nextWrapper = session.env.PATH.split(path.delimiter)[0] + '/sudo';
  const nextCapability = JSON.parse(fs.readFileSync(nextWrapper,'utf8').match(/await runSudo\((\{.*\}), process/)[1]);
  const socket = net.connect(nextCapability.socketPath);
  socket.on('error',()=>{});
  socket.end(JSON.stringify({ticket:'wrong'})+'\n');
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.deepEqual(session.list(),[]);
  // Use the current session's capability to test automatic expiration.
  invocation.options.env.JARVIS_SUDO_SOCKET=nextCapability.socketPath;
  invocation.options.env.JARVIS_SUDO_TICKET=nextCapability.ticket;
  const expired=ask();
  const expiredResult=await expired.exited;
  assert.equal(expiredResult.code,1);
  assert.equal(expiredResult.output,'');
  console.log('PASS: encrypted sudo delivery, private permissions, one-use replies, plaintext rejection, cancellation, abort, expiry and capability checks; no real sudo invoked.');
} finally {
  session?.close();
  for (const child of children) child.kill('SIGTERM');
  fs.rmSync(home,{recursive:true,force:true});
}
