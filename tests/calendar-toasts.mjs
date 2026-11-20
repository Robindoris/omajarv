import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deliverCalendarToasts} from '../server/lib/calendar-toasts.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'calendar-toasts-'));
const sent=[],send=async(...args)=>{sent.push(args);};
const item={id:'fixture',source:'calendar',title:'<b>Calendar & test</b>',body:'Starts <now>',read:false,snoozedUntil:0};
try{
 await deliverCalendarToasts(dir,[item],send);
 assert.equal(sent.length,1);assert.equal(sent[0][0],'&lt;b&gt;Calendar &amp; test&lt;/b&gt;');
 await deliverCalendarToasts(dir,[item],send);assert.equal(sent.length,1);
 await deliverCalendarToasts(dir,[{...item,snoozedUntil:123}],send);assert.equal(sent.length,2);
 await deliverCalendarToasts(dir,[{...item,id:'read',read:true},{...item,id:'kanban',source:'kanban'}],send);assert.equal(sent.length,2);
 await assert.rejects(deliverCalendarToasts(dir,[{...item,id:'retry'}],async()=>{throw new Error('offline');}));
 await deliverCalendarToasts(dir,[{...item,id:'retry'}],send);assert.equal(sent.length,3);
 assert.equal(fs.statSync(path.join(dir,'calendar-toasts.json')).mode&0o777,0o600);
 await deliverCalendarToasts(dir,Array.from({length:10},(_,i)=>({...item,id:'batch'+i})),send);assert.equal(sent.length,8);
 console.log('PASS: native toast delivery, persistent deduplication, snooze redelivery, read/source filters, retry, bounded batches and markup safety.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
