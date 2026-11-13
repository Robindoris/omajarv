import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {boundedExec} from '../server/lib/bounded-process.mjs';
import {readClipboard} from '../server/lib/clipboard.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-native-limits-'));
try {
  const normal = await boundedExec(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {input:'fixture', maxBuffer:16});
  assert.equal(normal.stdout, 'fixture');
  await assert.rejects(boundedExec(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {timeout:100}), /deadline/);
  await assert.rejects(boundedExec(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>process.stderr.write("x".repeat(8192)),1)'], {timeout:1000,maxBuffer:1024}), /output limit/);
  await assert.rejects(boundedExec(path.join(root, 'missing'), []), /ENOENT/);

  const owner = path.join(root, 'wl-paste');
  const calls = [];
  const exec = (file, args, options) => { calls.push(args); return boundedExec(owner, args, options); };
  const writeOwner = body => fs.writeFileSync(owner, '#!' + process.execPath + '\n' + body, {mode:0o700});
  writeOwner('process.stdout.write("fixture paste")');
  assert.equal((await readClipboard(exec, {primary:true,textOnly:true})).text, 'fixture paste');
  assert.deepEqual(calls.pop(), ['--primary','--no-newline','--type','text']);
  await assert.rejects(readClipboard(exec, {imageOnly:true}), /No supported image/);
  writeOwner('process.stdout.write("x".repeat(100000))');
  await assert.rejects(readClipboard(exec, {textOnly:true}), /output limit/);
  writeOwner('process.on("SIGTERM",()=>{});setInterval(()=>{},1000)');
  const start = Date.now();
  await assert.rejects(readClipboard(exec, {textOnly:true}), /deadline/);
  assert.ok(Date.now() - start < 6500);

  // A helper's descendant must not keep pipes alive after the deadline.
  const pidFile = path.join(root, 'pid');
  await assert.rejects(boundedExec(process.execPath, ['-e', `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`], {timeout:300}), /deadline/);
  await new Promise(resolve => setTimeout(resolve, 100));
  const pid = fs.readFileSync(pidFile, 'utf8');
  if (fs.existsSync('/proc/' + pid + '/stat')) assert.equal(fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(' ')[2], 'Z');

  // A hard kernel file-size limit applies before JS reads the generated WAV.
  const output = path.join(root, 'oversized');
  await assert.rejects(boundedExec(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(output)},Buffer.alloc(8192))`], {fileSizeLimit:1024}), /failed/);
  assert.ok(fs.statSync(output).size <= 1024);

  const testRoot = path.resolve(import.meta.dirname, '..');
  const home = path.join(root, 'home');
  const mockDir = path.join(root, 'bin'); fs.mkdirSync(mockDir);
  const piper = path.join(mockDir, 'piper');
  fs.writeFileSync(piper, '#!' + process.execPath + '\n' + `
    const fs=require('node:fs'),args=process.argv.slice(2);
    if(args.includes('--help')) {
      if(process.env.PIPER_FIXTURE==='help-flood') { process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000); }
      else if(process.env.PIPER_FIXTURE==='help-hang') setInterval(()=>{},1000);
      else { console.log('-f --length-scale'); process.exit(0); }
    } else
    if(process.env.PIPER_FIXTURE==='flood') { process.stdout.write('x'.repeat(100000)); setInterval(()=>{},1000); }
    else if(process.env.PIPER_FIXTURE==='hang') { process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); }
    else { fs.writeFileSync(args[args.indexOf(args.includes('-f')?'-f':'--output_file')+1],Buffer.alloc(process.env.PIPER_FIXTURE==='disk'?17*1024*1024:100)); process.stdin.resume(); }
  `, {mode:0o700});
  const worker = `
    import fs from 'node:fs';
    import {paths} from ${JSON.stringify(path.join(testRoot,'server/lib/config.mjs'))};
    import {synthesize} from ${JSON.stringify(path.join(testRoot,'server/lib/tts.mjs'))};
    fs.mkdirSync(paths.tmp,{recursive:true});fs.mkdirSync(paths.piperVoices,{recursive:true});
    fs.writeFileSync(paths.piperVoices+'/fixture.onnx','fixture');
    const config={tts:{voice:'fixture',speed:1}};
    const active=synthesize('fixture',config);
    try { await synthesize('second',config);process.exit(6); } catch(error) { if(!/busy/.test(error.message))process.exit(7); }
    try { const wav=await active; if(wav.length!==100 || process.env.PIPER_FIXTURE!=='ok')process.exit(3); }
    catch { if(process.env.PIPER_FIXTURE==='ok')process.exit(4); }
    if(fs.readdirSync(paths.tmp).length)process.exit(5);
  `;
  for (const mode of ['ok','flood','disk','help-flood','help-hang','hang']) {
    const result = spawnSync(process.execPath, ['--input-type=module','-e',worker], {
      env:{...process.env, HOME:home, PATH:mockDir+':'+process.env.PATH, PIPER_FIXTURE:mode}, encoding:'utf8',timeout:35000,
    });
    assert.equal(result.status,0,mode+': '+result.stderr);
  }
  // Run the actual native protocol with an isolated HOME; no HTTP or clipboard.
  for (const payload of ['x'.repeat(65537), '{}\n'.repeat(9)]) {
    const result = spawnSync(process.execPath, [path.join(testRoot,'server/desktop.mjs')], {
      env:{...process.env, HOME:home}, input:payload, encoding:'utf8', timeout:5000,
    });
    assert.equal(result.status,1,result.stderr);
  }
  const result = spawnSync(process.execPath, [path.join(testRoot,'server/native-command.mjs'),'unsupported'], {
    env:{...process.env,HOME:home}, encoding:'utf8', timeout:5000,
  });
  assert.equal(result.status,1);
  console.log('PASS: bounded clipboard/PRIMARY, stalled and oversized owners, helper deadlines, process-group cleanup, hard file-size limit, TTS success/flood/deadline and temporary-file cleanup.');
} finally { fs.rmSync(root, {recursive:true,force:true}); }
