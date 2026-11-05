#!/usr/bin/env node
// Only this helper holds the ephemeral private key and plaintext password.
import net from 'node:net';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';

let password;
let output;
try {
  const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength:3072});
  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(process.env.JARVIS_SUDO_SOCKET);
    let buffer = '';
    socket.setTimeout(125000, () => socket.destroy(new Error('timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ticket:process.env.JARVIS_SUDO_TICKET,
      publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),
      command:process.env.JARVIS_SUDO_COMMAND, cwd:process.env.JARVIS_SUDO_CWD, prompt:process.argv[2] || 'Computer password'}) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2000) socket.destroy(new Error('invalid response'));
    });
    socket.on('end', () => { try { resolve(JSON.parse(buffer)); } catch { reject(new Error('cancelled')); } });
  });
  if (response.cancelled) throw new Error('cancelled');
  password = privateDecrypt({key:privateKey, padding:constants.RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256'}, Buffer.from(response.ciphertext, 'base64'));
  if (!password.length || password.length > 256 || password.includes(10) || password.includes(13) || password.includes(0)) throw new Error('invalid password');
  // stdout is the dedicated pipe that sudo created for its askpass helper.
  output = Buffer.concat([password, Buffer.from('\n')]);
  await new Promise((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
} catch {
  // Never include request bodies, decrypted values, or crypto errors in diagnostics.
  console.error('Phone sudo authorization cancelled, expired, or unavailable.');
  process.exitCode = 1;
} finally { password?.fill(0); output?.fill(0); }
