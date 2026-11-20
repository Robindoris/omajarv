import assert from 'node:assert/strict';
import {videoQuery,videoRequest,videoResults,searchVideos,linkedVideo} from '../server/lib/youtube.mjs';
for(const [text,expected] of [['Play a video about space','space'],['Find me a YouTube video called Hello','Hello'],['play jazz on YouTube','jazz'],['show youtube cats','cats']])assert.equal(videoQuery(text),expected);
for(const text of ['implement video playback','play chess','find the bug','add a video task'])assert.equal(videoQuery(text),null);
const first={id:'abcdefghijk',title:'Space',channel:'Science'};
assert.equal(videoResults('Space',[first,{id:'12345678901',title:'Other'}]).selected,first.id);
assert.equal(videoResults('topic',[first,{id:'12345678901',title:'Other'}]).selected,null);
assert.equal(videoResults('Space',[first,{...first,id:'12345678901'}]).selected,null);
assert.deepEqual(videoResults('x',[{id:'unsafe',title:'bad'},{...first,availability:'private'}]).results,[]);
assert.equal(videoResults('x',[first,first]).results.length,1);
let args;const output=await searchVideos('cats; echo unsafe',{run:async(...a)=>{args=a;return {stdout:JSON.stringify({entries:[first]})};}});
assert.equal(args[1].at(-1),'ytsearch5:cats; echo unsafe');assert.equal(args[2].timeout,25000);assert.equal(output.results.length,1);
await assert.rejects(searchVideos('x',{run:async()=>{throw new Error('private diagnostic');}}),/YouTube search is unavailable/);
await assert.rejects(searchVideos('x',{run:async()=>({stdout:'invalid'})}),/YouTube search is unavailable/);
assert.deepEqual((await searchVideos('x',{run:async()=>({stdout:'{}'})})).results,[]);
console.log('PASS: intent, exact and ambiguous matches, filtering, empty results, bounded safe invocation, sanitized failures');

assert.equal(videoQuery('Jarvis, could you please play a video named “Named fixture”?'),'Named fixture');
assert.equal(videoQuery('search YouTube for space documentaries'),'space documentaries');
assert.deepEqual(videoResults('x',null).results,[]);
assert.deepEqual(videoResults('x',[null,{...first,is_embeddable:false},{...first,availability:'subscriber_only'}]).results,[]);

for(const text of ['https://www.youtube.com/watch?v=KNknduZ3NsQ open it','Open https://youtu.be/KNknduZ3NsQ','https://m.youtube.com/shorts/KNknduZ3NsQ','Please play https://www.youtube.com/watch?v=KNknduZ3NsQ&tracking=ignored'])assert.equal(linkedVideo(text)?.selected,'KNknduZ3NsQ');
for(const text of ['Summarize https://www.youtube.com/watch?v=KNknduZ3NsQ','Do not open https://youtu.be/KNknduZ3NsQ','https://youtube.com.attacker.invalid/watch?v=KNknduZ3NsQ open it','https://user:pass@youtube.com/watch?v=KNknduZ3NsQ open it','https://youtu.be/invalid open it','https://youtu.be/KNknduZ3NsQ https://youtu.be/abcdefghijk'])assert.equal(linkedVideo(text),null);
console.log('PASS direct YouTube URLs: reproduced open-it request, mobile/short links, strict hosts/IDs, no credential forwarding, non-playback intent preserved');

const previous=[{role:'user',text:'https://www.youtube.com/watch?v=KNknduZ3NsQ'}];
for(const text of ['open it','Play that in the built-in player','can you put this in the player please'])assert.equal(linkedVideo(text,previous)?.selected,'KNknduZ3NsQ');
for(const text of ['I want to see this one in the built-in player: https://www.youtube.com/watch?v=KNknduZ3NsQ','Here is the video https://youtu.be/KNknduZ3NsQ'])assert.equal(linkedVideo(text)?.selected,'KNknduZ3NsQ');
assert.equal(linkedVideo('open it',[{role:'assistant',text:previous[0].text}]),null);
assert.equal(linkedVideo('open it',[...previous,{role:'user',text:'What time is it?'}]),null);
assert.equal(linkedVideo('open it',[{role:'user',text:previous[0].text+' https://youtu.be/abcdefghijk'}]),null);
assert.equal(linkedVideo('summarize it',previous),null);assert.equal(linkedVideo('open settings',previous),null);
console.log('PASS automatic single-link and contextual playback; unrelated intent, assistant links and ambiguous history preserved');

assert.equal(linkedVideo("Play a video called Named fixture",previous),null);
assert.equal(linkedVideo("Play a video about space",previous),null);

for(const text of ['find robindorak and play video any','find robindorak channel and play any video','play any video from robindorak','Jarvis, please find channel robindorak and play a video']){assert.equal(videoRequest(text)?.query,'robindorak');assert.equal(videoRequest(text)?.chooseAny,true);}
const channelVideos=[{id:'12345678901',title:'Unrelated result',channel:'Other creator'},{id:'abcdefghijk',title:'A channel video',channel:'RobindoriS',uploader_id:'@robindorak'}];
assert.equal(videoResults('robindorak',channelVideos,{chooseAny:true}).selected,'abcdefghijk');
assert.equal(videoResults('robindorak',channelVideos,{chooseAny:true,creator:'robindorak'}).selected,'abcdefghijk');
assert.equal(videoResults('someone else',channelVideos,{chooseAny:true,creator:'someone else'}).selected,null);
assert.equal(videoResults('funny cats',channelVideos,{chooseAny:true}).selected,'12345678901');
assert.equal(videoResults('robindorak',[],{chooseAny:true}).selected,null);
assert.equal(videoRequest('do not find robindorak and play any video'),null);
assert.equal(linkedVideo('find robindorak and play video any',previous),null);
console.log('PASS natural find-and-play-any/channel requests, channel-preferred selection and unmatched-channel choice');

const reportedChannelRequest='open any video from this chanel https://www.youtube.com/@robindorak';
const channelRequest=videoRequest(reportedChannelRequest);assert.equal(channelRequest.channelUrl,'https://www.youtube.com/@robindorak/videos');assert.equal(channelRequest.chooseAny,true);assert.equal(channelRequest.creator,'@robindorak');
for(const text of ['Open any video from this channel https://m.youtube.com/@robindorak/videos','https://www.youtube.com/@robindorak'])assert.equal(videoRequest(text)?.channelUrl,channelRequest.channelUrl);
for(const text of ['summarize https://www.youtube.com/@robindorak','open any video https://www.youtube.com.attacker.invalid/@robindorak','open any video https://user:pass@youtube.com/@robindorak','open any video https://www.youtube.com/@robindorak https://youtube.com/@other'])assert.equal(videoRequest(text),null);
let channelArgs;const scoped=await searchVideos(channelRequest.query,{...channelRequest,run:async(...args)=>{channelArgs=args;return {stdout:JSON.stringify({uploader_id:'@robindorak',uploader:'RobindoriS',entries:[{id:'abcdefghijk',title:'Channel video'}]})};}});
assert.equal(scoped.selected,'abcdefghijk');assert.equal(channelArgs[1].at(-1),channelRequest.channelUrl);assert.equal(channelArgs[1][channelArgs[1].indexOf('--playlist-end')+1],'5');
await assert.rejects(searchVideos('x',{channelUrl:'https://attacker.invalid/private',run:()=>{throw new Error('Must not invoke tool');}}),/YouTube search is unavailable/);
console.log('PASS exact reported channel-URL request, bounded channel-specific listing, metadata fallback and unsafe URL rejection');
