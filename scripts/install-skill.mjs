#!/usr/bin/env node
// Install the portable skill without following or overwriting a custom target.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Require dedicated consent even when this helper is invoked directly.
if (process.argv.length !== 3 || process.argv[2] !== '--install-agent-skill') {
  console.error('Global coding-agent skill installation requires --install-agent-skill.');
  process.exit(1);
}
const source = path.resolve(import.meta.dirname, '../skills/omajarv-dev');
const parent = path.join(os.homedir(), '.agents/skills');
const target = path.join(parent, 'omajarv-dev');
const files = fs.readdirSync(source).sort();
if (!files.includes('SKILL.md')) throw new Error('Bundled JARVIS skill is missing.');
for (const name of files) {
  if (!name.endsWith('.md') || !fs.lstatSync(path.join(source,name)).isFile()) throw new Error('Invalid bundled skill file.');
}
fs.mkdirSync(parent,{recursive:true});
let existing;
try { existing = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const identical = existing?.isDirectory() && !existing.isSymbolicLink()
  && JSON.stringify(fs.readdirSync(target).sort()) === JSON.stringify(files)
  && files.every(name => {
    const file = path.join(target,name);
    return fs.lstatSync(file).isFile() && fs.readFileSync(file).equals(fs.readFileSync(path.join(source,name)));
  });
if (identical) {
  console.log('Shared JARVIS skill is already current.');
} else {
  const staging = fs.mkdtempSync(path.join(parent,'.jarvis-skill-'));
  try {
    for (const name of files) fs.copyFileSync(path.join(source,name),path.join(staging,name));
    if (existing) {
      const backups = path.join(os.homedir(),'.local/state/omarchy-jarvis/skill-backups');
      fs.mkdirSync(backups,{recursive:true,mode:0o700});
      const backup = fs.mkdtempSync(path.join(backups,'previous-'));
      // Preserve even a foreign symlink as a symlink; never modify its referent.
      fs.renameSync(target,path.join(backup,'omajarv-dev'));
      console.log('Previous shared skill preserved in the JARVIS skill-backups folder.');
    }
    fs.renameSync(staging,target);
    console.log('Installed shared skill: ~/.agents/skills/omajarv-dev');
  } finally { fs.rmSync(staging,{recursive:true,force:true}); }
}
