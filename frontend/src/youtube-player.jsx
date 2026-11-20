import React,{useEffect,useRef,useState} from 'react';
const PLAYER_ORIGIN='https://www.youtube-nocookie.com';
const playbackError=code=>code===101||code===150?'This video does not allow embedded playback. Choose another result or open it on YouTube.':code===100?'This video is unavailable or private. Choose another result.':code===153?'YouTube could not verify this player. Open the video on YouTube or try another browser.':'This video could not be played. Retry, choose another result, or open it on YouTube.';
export function YouTubePlayer(){
 const [media,setMedia]=useState(null),[selected,select]=useState(null),[attempt,retry]=useState(0),[status,setStatus]=useState(''),[failed,setFailed]=useState(false),[reportedTitle,setReportedTitle]=useState('');
 const frame=useRef(null),heading=useRef(null);
 useEffect(()=>{
  const receive=e=>{
   const data=e.detail;if(!Array.isArray(data?.results))return;
   const results=data.results.filter(v=>/^[\w-]{11}$/.test(v?.id)&&typeof v.title==='string').slice(0,5).map(v=>({...v,title:v.title.slice(0,300),channel:String(v.channel||'').slice(0,200)}));
   setMedia({...data,results});select(results.some(v=>v.id===data.selected)?data.selected:null);retry(n=>n+1);
   requestAnimationFrame(()=>heading.current?.focus());
  };
  const clear=()=>{setMedia(null);select(null);};
  window.addEventListener('jarvis-video',receive);window.addEventListener('jarvis-project-changed',clear);
  return()=>{window.removeEventListener('jarvis-video',receive);window.removeEventListener('jarvis-project-changed',clear);};
 },[]);
 function command(func,args=[]){frame.current?.contentWindow?.postMessage(JSON.stringify({event:'command',func,args}),PLAYER_ORIGIN);}
 function listen(){
  frame.current?.contentWindow?.postMessage(JSON.stringify({event:'listening',id:'jarvis-youtube'}),PLAYER_ORIGIN);
  for(const event of ['onReady','onStateChange','onError','onAutoplayBlocked'])command('addEventListener',[event]);
 }
 useEffect(()=>{
  if(!selected){setStatus('');setFailed(false);setReportedTitle('');return;}
  setFailed(false);setReportedTitle('');setStatus('Loading video…');
  const stalled=setTimeout(()=>setStatus(previous=>previous==='Loading video…'?'Playback has not started. Tap Play inside the video, or retry playback.':previous),8000);
  const handshake=setInterval(listen,1000),stop=setTimeout(()=>clearInterval(handshake),10000);
  const receive=e=>{
   if(e.origin!==PLAYER_ORIGIN||e.source!==frame.current?.contentWindow||typeof e.data!=='string'||e.data.length>64000)return;
   let data;try{data=JSON.parse(e.data);}catch{return;}
   if(data.event==='infoDelivery'&&data.info?.videoData?.video_id===selected&&typeof data.info.videoData.title==='string')setReportedTitle(data.info.videoData.title.slice(0,300));
   if(data.event==='onError'){setFailed(true);setStatus(playbackError(Number(data.info)));return;}
   if(data.event==='onAutoplayBlocked'){setStatus('Autoplay was blocked. Tap Play inside the video to start playback.');return;}
   const state=data.event==='onStateChange'?data.info:data.event==='infoDelivery'?data.info?.playerState:undefined;
   if(state===1){setFailed(false);setStatus('Playing.');}
   else if(state===2)setStatus('Paused.');
   else if(state===0)setStatus('Video ended.');
   else if(data.event==='onReady')setStatus('Video ready. If playback does not start, tap Play inside the video.');
  };
  window.addEventListener('message',receive);
  return()=>{clearTimeout(stalled);clearTimeout(stop);clearInterval(handshake);window.removeEventListener('message',receive);};
 },[selected,attempt,media]);
 if(!media)return null;
 const video=media.results.find(v=>v.id===selected);
 const params=new URLSearchParams({autoplay:'1',playsinline:'1',rel:'0',controls:'1',enablejsapi:'1',origin:window.location.origin});
 return <section className="youtube-player" role="region" aria-label="YouTube video player" onKeyDown={e=>{if(e.key==='Escape'){setMedia(null);select(null);}}}>
 <button type="button" onClick={()=>{setMedia(null);select(null);}} aria-label="Close video player">Close player</button>
 <h2 ref={heading} tabIndex={-1}>{reportedTitle||video?.title||(media.error?'Video search unavailable':!media.results.length?'No videos found':'Choose a YouTube video')}</h2>
 {media.error&&<p role="alert">{String(media.error).slice(0,300)}</p>}
 {!media.error&&!media.results.length&&<p>No YouTube videos found. Try a more specific title or topic in chat or voice.</p>}
 {!video&&media.results.length>0&&<p>Several results match. Choose the video you want to play.</p>}
 {video&&<><iframe ref={frame} key={video.id+':'+attempt} title={video.title} src={PLAYER_ORIGIN+'/embed/'+video.id+'?'+params} onLoad={listen} onError={()=>{setFailed(true);setStatus('The video player could not load. Check your connection and retry.');}} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin"/>
 <p role={failed?'alert':'status'}>{status}</p>
 <div className="youtube-controls"><button type="button" onClick={()=>{command('playVideo');frame.current?.focus();setStatus('Playback requested. If it does not start, tap Play inside the video.');}}>Play</button><button type="button" onClick={()=>command('pauseVideo')}>Pause</button><button type="button" onClick={()=>{command('seekTo',[0,true]);command('playVideo');}}>Restart</button><button type="button" onClick={()=>retry(n=>n+1)}>Retry playback</button></div>
 <p>If playback does not start, tap Play inside the video. If this video is unavailable or embedding is blocked, choose another result or <a href={'https://www.youtube.com/watch?v='+video.id} target="_blank" rel="noreferrer">open it on YouTube</a>.</p></>}
 <div className="youtube-results">{media.results.map(v=><button type="button" key={v.id} aria-pressed={v.id===selected} onClick={()=>{select(v.id);retry(0);}}>{v.title}{v.channel&&' — '+v.channel}</button>)}</div>
 </section>;
}
