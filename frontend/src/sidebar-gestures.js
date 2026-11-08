// Only claim deliberate horizontal touch drags; leave vertical scrolling alone.
export function installSidebarGestures() {
 const sidebar=document.querySelector('.workspace-sidebar');
 if(!sidebar)return ()=>{};
 const mobile=window.matchMedia('(max-width: 900px)');
 let gesture=null;
 const clear=()=>{
  gesture=null;
  sidebar.style.removeProperty('transform');
  sidebar.style.removeProperty('transition');
 };
 const start=e=>{
  clear();
  if(!mobile.matches || e.touches.length!==1 || document.querySelector('dialog[open]'))return;
  const touch=e.touches[0],open=document.body.dataset.sidebar==='open';
  if(open ? !sidebar.contains(e.target) : touch.clientX>32)return;
  if(e.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"]'))return;
  gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,open,width:sidebar.getBoundingClientRect().width,locked:false,dx:0};
 };
 const move=e=>{
  if(!gesture)return;
  if(e.touches.length!==1 || !mobile.matches){clear();return;}
  const t=e.touches[0];
  if(t.identifier!==gesture.id){clear();return;}
  const dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;
  if(!gesture.locked){
   if(Math.max(Math.abs(dx),Math.abs(dy))<10)return;
   if(Math.abs(dy)>=Math.abs(dx) || (gesture.open ? dx>=0 : dx<=0)){clear();return;}
   gesture.locked=true;
   sidebar.style.transition='none';
  }
  if(e.cancelable)e.preventDefault();
  gesture.dx=dx;
  const offset=Math.max(-gesture.width,Math.min(0,(gesture.open?0:-gesture.width)+dx));
  sidebar.style.transform=`translateX(${offset}px)`;
 };
 const end=e=>{
  if(!gesture)return;
  if(!Array.from(e.changedTouches).some(t=>t.identifier===gesture.id))return;
  const {locked,dx,open,width}=gesture;
  if(locked && Math.abs(dx)>=Math.min(80,width*.3))document.body.dataset.sidebar=open?'closed':'open';
  clear();
 };
 document.addEventListener('touchstart',start,{passive:true});
 document.addEventListener('touchmove',move,{passive:false});
 document.addEventListener('touchend',end);
 document.addEventListener('touchcancel',clear);
 window.addEventListener('resize',clear);
 return ()=>{
  clear();
  document.removeEventListener('touchstart',start);
  document.removeEventListener('touchmove',move);
  document.removeEventListener('touchend',end);
  document.removeEventListener('touchcancel',clear);
  window.removeEventListener('resize',clear);
 };
}
