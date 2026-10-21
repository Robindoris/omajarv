#!/usr/bin/env node
// Source allowlist: runtime data is never part of a distributable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const output=path.resolve(process.argv[2] || path.join(root,'dist/omarchy-jarvis'));
if(output===root || root.startsWith(output+path.sep)) throw new Error('Unsafe output directory');
if(fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Output directory must be empty; existing files were kept');
const fixed=['manifest.json','README.md','LICENSE','SECURITY.md','PRIVACY.md','install.sh','.gitignore'];
const directories=['bin','server','plugin','docs','scripts','tests','systemd'];
const allowed=file=>/\.(?:mjs|qml|js|css|html|md|template)$/.test(file) || ['jarvis','manifest.json','icon-192.png','icon-512.png'].includes(path.basename(file));
const files=[...fixed];
function visit(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
 const file=path.join(dir,entry.name);
 if(entry.isSymbolicLink()) throw new Error('Symlink refused: '+file);
 if(entry.isDirectory()) visit(file);
 else if(allowed(file))files.push(file);
}}
for(const dir of directories)visit(dir);
const secret=/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})/;
const hashes=[];
for(const name of [...new Set(files)].sort()){
 const source=path.join(root,name),data=fs.readFileSync(source);
 // Security scanner code itself describes credential signatures, not credentials.
 if(secret.test(data.toString('utf8')))throw new Error('Possible credential; refusing release: '+name);
 const destination=path.join(output,name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);
 fs.chmodSync(destination,fs.statSync(source).mode & 0o777);
 hashes.push(crypto.createHash('sha256').update(data).digest('hex')+'  '+name);
}
fs.writeFileSync(path.join(output,'SHA256SUMS'),hashes.join('\n')+'\n');
console.log(`Prepared ${hashes.length} source files in ${output}. Nothing was uploaded.`);
