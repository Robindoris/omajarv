import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
await build({entryPoints:['frontend/src/dashboard.jsx'],bundle:true,minify:true,legalComments:'eof',outfile:'server/public/dashboard.js',format:'iife',jsx:'automatic'});
execFileSync('node_modules/.bin/tailwindcss',['-i','frontend/src/dashboard.css','-o','server/public/dashboard.css','--minify'],{stdio:'inherit'});
// Keep installed browsers from mixing newly generated assets with cached bundles.
const {readFileSync,writeFileSync}=await import('node:fs');
const {createHash}=await import('node:crypto');
const revision=createHash('sha256');
for(const name of ['dashboard.js','dashboard.css','jarvis.js'])revision.update(readFileSync('server/public/'+name));
const stamp=revision.digest('hex').slice(0,12);
const index='server/public/index.html';
writeFileSync(index,readFileSync(index,'utf8').replace(/v=dashboard-[a-z\d-]+/g,'v=dashboard-'+stamp));
