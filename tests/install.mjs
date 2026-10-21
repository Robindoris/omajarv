import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-clean-install-'));
fs.mkdirSync(path.join(home,'bin'));
for(const name of ['systemctl','omarchy'])fs.writeFileSync(path.join(home,'bin',name),'#!/bin/sh\nexit 0\n',{mode:0o755});
const env={...process.env,PATH:path.join(home,'bin')+':'+process.env.PATH,HOME:home,XDG_CONFIG_HOME:path.join(home,'.config'),XDG_STATE_HOME:path.join(home,'.local/state')};
try {
 const args=[path.join(root,'install.sh'),'--no-packages','--no-models','--no-service','--no-plugin'];
 const install=()=>spawnSync('bash',args,{env,encoding:'utf8',timeout:30000});
 const first=install();assert.equal(first.status,0,first.stderr);
 const file=path.join(home,'.config/omarchy-jarvis/config.json');
 const config=JSON.parse(fs.readFileSync(file));
 assert.equal(config.host,'127.0.0.1');assert.equal(config.tunnel.enabled,false);assert.equal(config.codexFullAccess,false);assert.equal(config.agentFullAccess,false);
 assert.equal(fs.statSync(file).mode & 0o777,0o600);
 assert.ok(fs.existsSync(config.workDir));
 assert.ok(fs.lstatSync(path.join(home,'.local/bin/jarvis')).isSymbolicLink());
 config.stt.modelPath='/existing/local-model.bin';config.codexFullAccess=true;
 fs.writeFileSync(file,JSON.stringify(config));const before=fs.readFileSync(file,'utf8');
 const again=install();assert.equal(again.status,0,again.stderr);assert.equal(fs.readFileSync(file,'utf8'),before);
 const uninstall=spawnSync('bash',[path.join(root,'install.sh'),'--uninstall'],{env,encoding:'utf8',timeout:30000});
 assert.equal(uninstall.status,0,uninstall.stderr);assert.equal(fs.existsSync(path.join(home,'.local/bin/jarvis')),false);assert.equal(fs.readFileSync(file,'utf8'),before);
 console.log('PASS: clean text-only install, private defaults, rerun preserves user config, uninstall removes launcher and retains user data.');
} finally {fs.rmSync(home,{recursive:true,force:true});}
