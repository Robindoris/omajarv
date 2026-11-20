import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openPlanner, nextOccurrence} from '../server/lib/planner.mjs';
import {createDesktopNotifications} from '../server/lib/desktop-notifications.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-notifications-'));
let now=Date.parse('2026-03-29T07:50:00Z'), store;
const options={connectionString:'',now:()=>now};
const outputs=[];let offline=false, active=0, peak=0, writes=0;
const request=async(endpoint,body)=>{
 active++;peak=Math.max(peak,active);
 try{
  await new Promise(resolve=>setImmediate(resolve));
  if(offline)throw new Error('private-token private-event transport diagnostics');
  if(endpoint==='calendar')return JSON.stringify(await store.view());
  if(body){writes++;await store.notify(JSON.parse(body));return '{"ok":true}';}
  return JSON.stringify(await store.notifications());
 }finally{active--;}
};
const native=createDesktopNotifications(request,(event,data)=>outputs.push({event,...data}));
const last=()=>outputs.at(-1);
const create=async(extra={})=>{
 const revision=(await store.view()).revision;
 return store.update({action:'create',revision,requestId:randomUUID(),title:'Synthetic calendar',notes:'Synthetic description',startAt:'2026-03-29T08:00:00Z',endAt:'2026-03-29T09:00:00Z',timeZone:'Europe/Bratislava',reminderMinutes:15,recurrence:'none',...extra});
};
try{
 store=await openPlanner(dir,options);
 assert.equal(native.handles('send'),false);
 await create();await store.tick([]);
 await native.dispatch({action:'notifications'});
 assert.equal(last().unread,1);
 let item=last().items[0];const stableId=item.id;
 assert.equal(item.when,Date.parse('2026-03-29T08:00:00Z'));
 assert.match(item.body,/Europe\/Bratislava/);
 assert.deepEqual(last().items,(await store.notifications()).items);
 await native.dispatch({action:'notificationDetails',id:item.id});
 assert.equal(last().event.timeZone,'Europe/Bratislava');
 assert.equal(last().event.startAt,item.when);
 assert.equal(last().event.endAt,Date.parse('2026-03-29T09:00:00Z'));
 await native.dispatch({action:'notificationRead',id:item.id});
 assert.equal((await store.notifications()).unread,0);
 // Dashboard snooze is reflected by native reads and returns with the same ID.
 await store.notify({action:'notification:snooze',id:item.id,minutes:5});
 await native.dispatch({action:'notifications'});assert.equal(last().items.length,0);
 now+=6*60000;
 await native.dispatch({action:'notifications'});assert.equal(last().items[0].id,stableId);
 await native.dispatch({action:'notificationSnooze',id:item.id,minutes:7});
 assert.equal(last().event,'notificationError');
 await native.dispatch({action:'notificationSnooze',id:item.id,minutes:15});
 assert.equal(last().items.length,0);now+=16*60000;
 await store.close();store=await openPlanner(dir,options);await store.tick([]);
 await native.dispatch({action:'notifications'});
 assert.equal(last().items.length,1);assert.equal(last().items[0].id,stableId);
 await native.dispatch({action:'notificationDismiss',id:stableId});
 assert.equal((await store.notifications()).items.length,0);
 // Editing invalidates old reminders and creates exactly one replacement.
 let view=await store.view(),event=view.events[0];
 await store.update({action:'edit',revision:view.revision,requestId:randomUUID(),id:event.id,title:'Edited synthetic event',notes:'',startAt:new Date(event.startAt).toISOString(),endAt:new Date(event.endAt).toISOString(),timeZone:event.timeZone,recurrence:'none',reminderMinutes:15});
 await store.tick([]);await store.tick([]);
 await native.dispatch({action:'notifications'});
 assert.equal(last().items.length,1);assert.notEqual(last().items[0].id,stableId);
 await native.dispatch({action:'notificationRead',id:stableId});assert.equal(last().event,'notificationError');
 view=await store.view();await store.update({action:'delete',id:event.id,revision:view.revision,requestId:randomUUID()});
 await native.dispatch({action:'notifications'});assert.equal(last().items.length,0);
 await store.tick([{id:'task',title:'Synthetic task',dueDate:'2020-01-01',status:'todo',execution:'idle'}]);
 await native.dispatch({action:'notifications'});assert.equal(last().unread,0);assert.equal(last().items.length,0);
 const taskItem=(await store.notifications()).items[0];
 const before=writes;await native.dispatch({action:'notificationDismiss',id:taskItem.id});assert.equal(writes,before);
 offline=true;await native.dispatch({action:'notifications'});
 assert.equal(last().event,'notificationError');assert.doesNotMatch(JSON.stringify(last()),/private-token|private-event|diagnostics/);
 offline=false;
 await Promise.all([native.dispatch({action:'notifications'}),native.dispatch({action:'notifications'})]);
 assert.equal(peak,1);assert.equal(last().event,'notifications');
 // Ended events missed during downtime do not produce a catch-up storm.
 await create({startAt:'2026-03-28T08:00:00Z',endAt:'2026-03-28T09:00:00Z'});
 await store.tick([]);await native.dispatch({action:'notifications'});assert.equal(last().items.length,0);
 assert.equal(new Date(nextOccurrence(Date.parse('2026-10-24T08:00:00Z'),'daily','Europe/Bratislava')).toISOString(),'2026-10-25T09:00:00.000Z');
 console.log('PASS: native shared calendar reads/actions/details, fake-clock due/edit/delete, source filtering, DST, restart identity, reconnect, sanitized errors and serialized requests.');
}finally{await store?.close();fs.rmSync(dir,{recursive:true,force:true});}
