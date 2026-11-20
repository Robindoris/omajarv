import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
function topicQuery(text){
 const request=String(text).trim().replace(/^(?:hey\s+)?jarvis[,! ]+/i,'').replace(/^(?:can|could|would) you\s+/i,'').replace(/^please\s+/i,'');
 const match=request.match(/^(?:play|show|find|search(?:\s+for)?)\s+(?:(?:me\s+)?(?:a |the )?(?:youtube\s+)?video(?:s)?\s+(?:about|of|on|called|named)\s+|(?:on\s+)?youtube\s+(?:for\s+)?)(.{1,200}?)\s*[.!?]?$/i);
 const trailing=request.match(/^(?:play|show|find)\s+(.{1,200}?)\s+on\s+youtube[.!?]?$/i);
 const query=(match?.[1]||trailing?.[1])?.trim().replace(/^["“](.*)["”]$/,'$1').trim();
 return query&&!/[\x00-\x1f\x7f]/.test(query)?query:null;
}
function channelLocation(value){
 let url;try{url=new URL(value.replace(/[).,!;]+$/,''));}catch{return null;}
 if(!['http:','https:'].includes(url.protocol)||!['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)||url.username||url.password||url.port)return null;
 let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return null;}
 const match=pathname.match(/^\/(@[\p{L}\p{N}_.-]{1,100}|channel\/UC[\w-]{22})(?:\/(?:videos|shorts|streams|featured))?\/?$/u);
 if(!match)return null;
 const key=match[1],segment=key.startsWith('@')?'@'+encodeURIComponent(key.slice(1)):key;
 return {query:key,creator:key.startsWith('@')?key:'',channelUrl:'https://www.youtube.com/'+segment+'/videos'};
}
export function videoRequest(text){
 const request=String(text).trim().replace(/^(?:hey\s+)?jarvis[,! ]+/i,'').replace(/^(?:can|could|would) you\s+/i,'').replace(/^please\s+/i,'').replace(/[.!?]+$/,'');
 if(/\b(?:don['’]t|do not|never)\b/i.test(request))return null;
 const urls=request.match(/https?:\/\/[^\s<>"`]+/gi);
 if(urls?.length){
  if(urls.length!==1)return null;
  const channel=channelLocation(urls[0]);if(!channel)return null;
  const instruction=request.replace(urls[0],'');
  if(otherVideoIntent.test(instruction))return null;
  return {...channel,chooseAny:/\b(?:any|random|one)\b|\ba\s+video\b/i.test(instruction)};
 }

 const find=request.match(/^(?:find|search(?: for)?)\s+(.{1,200}?)\s+and\s+(?:please\s+)?play\s+(?:(?:any|a|one)(?:\s+of (?:their|the))?\s+videos?|videos?\s+any|any(?: one)?|one)(?:\s+(?:from (?:it|them)|in (?:the )?(?:built-in |integrated )?player))?$/i);
 const from=request.match(/^play\s+(?:me\s+)?(?:any|a|one)\s+(?:of\s+(?:the|their)\s+)?videos?\s+(?:from|by|on)\s+(.{1,200})$/i);
 if(find||from){
  let query=(find?.[1]||from?.[1]).trim();const channel=!!from||/^channel\s+|\s+channel$/i.test(query);
  query=query.replace(/^channel\s+|\s+channel$/gi,'').trim().replace(/^["“](.*)["”]$/,'$1');
  if(!query||/[\x00-\x1f\x7f]/.test(query))return null;
  return {query,chooseAny:true,creator:channel?query:''};
 }
 const query=topicQuery(request);return query?{query,chooseAny:false,creator:''}:null;
}
export function videoQuery(text){return videoRequest(text)?.query||null;}
// Direct links and unambiguous references use the player, not an agent/browser tool.
const otherVideoIntent=/\b(?:summari[sz]e|summary|explain|transcrib\w*|translat\w*|analy[sz]\w*|download|copy|implement|debug|schedule|tomorrow|later)\b|\b(?:don['’]t|do not|never)\b|\b(?:how (?:to|do)|what is|tell me about)\b/i;
const refersToVideo=text=>!otherVideoIntent.test(text)&&/\b(?:open|play|watch|show|load|start|put)\b/i.test(text)&&/\b(?:it|this|that|video|link)\b/i.test(text)&&! /\b(?:file|folder|settings|project)\b/i.test(text);
export function linkedVideo(text,history=[]){
 const request=String(text).trim().replace(/^(?:hey\s+)?jarvis[,! ]+/i,'').replace(/^(?:can|could|would) you\s+/i,'').replace(/^please\s+/i,'');
 const links=request.match(/https?:\/\/[^\s<>"`]+/gi);
 if(!links?.length&&!videoQuery(request)&&refersToVideo(request)){
  // Only inspect recent user messages in the active conversation. Never select a
  // model-suggested link or skip over a substantive unrelated user request.
  for(const message of history.slice(-12).reverse()){
   if(message.role!=='user'||typeof message.text!=='string')continue;
   const prior=message.text.match(/https?:\/\/[^\s<>"`]+/gi);
   if(prior?.length)return prior.length===1?linkedVideo(prior[0]):null;
   if(!refersToVideo(message.text))break;
  }
  return null;
 }
 if(links?.length!==1)return null;
 const raw=links[0],value=raw.replace(/[).,!;]+$/,'');
 const instruction=request.replace(raw,'').replace(/^[\s.,:;!?"'()[\]]+|[\s.,:;!?"'()[\]]+$/g,'');
 if(otherVideoIntent.test(instruction))return null;
 let url;try{url=new URL(value);}catch{return null;}
 if(url.username||url.password||url.port)return null;
 const host=url.hostname.toLowerCase();let id;
 if(host==='youtu.be')id=url.pathname.slice(1);
 else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com'].includes(host)){
  if(url.pathname==='/watch')id=url.searchParams.get('v');
  else id=url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
 }
 if(!/^[\w-]{11}$/.test(id||''))return null;
 return {query:'https://www.youtube.com/watch?v='+id,results:[{id,title:'YouTube video '+id,channel:''}],selected:id};
}
const normalize=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const channelKey=value=>String(value).normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]/gu,'');
export function videoResults(query,entries,{chooseAny=false,creator=''}={}){
 const seen=new Set();
 const results=(Array.isArray(entries)?entries:[]).filter(v=>v&&v.is_embeddable!==false&&v.embeddable!==false&&/^[\w-]{11}$/.test(v.id||'')&&v.title&&!['private','premium_only','subscriber_only','needs_auth'].includes(v.availability)&&!seen.has(v.id)&&seen.add(v.id)).slice(0,5).map(v=>({id:v.id,title:String(v.title).slice(0,300),channel:String(v.channel||v.uploader||'').slice(0,200),channelHandle:typeof v.uploader_id==='string'&&/^@[\w.-]{1,100}$/.test(v.uploader_id)?v.uploader_id:''}));
 const exact=results.filter(v=>normalize(v.title)===normalize(query));
 const wanted=channelKey(creator||query);
 const channelResults=results.filter(v=>wanted&&(channelKey(v.channel)===wanted||channelKey(v.channelHandle)===wanted));
 const candidates=creator?channelResults:channelResults.length?channelResults:results;
 return {query,results,selected:chooseAny?(candidates[0]?.id||null):exact.length===1?exact[0].id:results.length===1?results[0].id:null};
}
export async function searchVideos(query,{signal,run=exec,chooseAny=false,creator='',channelUrl=''}={}){
 try{
 if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('Invalid query');
 const channel=channelUrl?channelLocation(channelUrl):null;
 if(channelUrl&&!channel)throw new Error('Invalid channel');
 const target=channel?.channelUrl||`ytsearch5:${query}`;
 const {stdout}=await run('yt-dlp',['--ignore-config','--no-playlist','--flat-playlist','--playlist-end','5','--dump-single-json','--skip-download','--socket-timeout','10','--',target],{signal,timeout:25000,maxBuffer:1024*1024,windowsHide:true});
 const document=JSON.parse(stdout);
 const entries=Array.isArray(document.entries)?document.entries:[];
 return videoResults(query,channel?entries.map(v=>v&&({...v,channel:v.channel||v.uploader||document.channel||document.uploader||creator,uploader_id:v.uploader_id||(!(v.channel||v.uploader)?document.uploader_id||channel.creator:'')})):entries,{chooseAny,creator});
 }catch(error){if(signal?.aborted)throw error;throw new Error('YouTube search is unavailable. Check the connection and yt-dlp installation, then try again.');}
}
