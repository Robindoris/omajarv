// One smoothed motion envelope for the GLB and procedural fallback.
const busyModes=new Set(['thinking','working','responding']);
export function createCoreMotion(){
 let mode='boot',workAge=0,speed=.05,energy=0,pulse=0,elapsed=0,previousRaw=0,heat=0,idleAge=0,pose=0;
 return {
  setMode(next){if(next===mode)return;if(!busyModes.has(next)||!busyModes.has(mode))workAge=0;if(next==='listening')pulse=1;mode=next;},
  step(dt,level,reduced=false){
   dt=Math.max(0,Math.min(dt,.1));
   const raw=Math.max(0,Math.min(1,Number(level)||0)),busy=busyModes.has(mode);
   if(busy)workAge+=dt;
   idleAge=mode==='idle'?idleAge+dt:0;
   const thermalTarget=busy?1:({listening:.35,transcribing:.65,speaking:.5,error:.08,boot:.12}[mode]||0);
   heat+=(thermalTarget-heat)*(1-Math.exp(-dt*(busy?.1:mode==='idle'?.075:.3)));
   if(thermalTarget===0&&heat<.006)heat=0;
   const poseTarget=mode==='idle'&&idleAge>2?0:mode==='idle'?pose:1;
   pose+=(poseTarget-pose)*(1-Math.exp(-dt*(poseTarget>pose?2:.35)));
   if(pose<.002)pose=0;
   const desired=busy?Math.min(2.8,.65+workAge*.2)+(mode==='working'?.35:0):({boot:.18,idle:.025*heat,listening:.12,transcribing:.65,speaking:.45,error:.04}[mode]??.025);
   speed+=(desired-speed)*(1-Math.exp(-dt*(busy?1.3:mode==='idle'?.45:2.8)));
   energy+=(raw-energy)*(1-Math.exp(-dt*(raw>energy?28:7)));
   pulse=Math.max(0,pulse-dt*2.6);
   if(mode==='listening'&&raw>.045&&raw-previousRaw>.025)pulse=Math.max(pulse,Math.min(1,raw*2.8));
   previousRaw=raw;
   if(!reduced)elapsed+=dt;
   return {mode,heat,pose,home:mode==='idle'&&idleAge>2, speed:reduced?0:speed,energy:reduced?0:energy,pulse:reduced?0:pulse,elapsed:reduced?0:elapsed,work:reduced?0:busy?1:mode==='transcribing'?.35:0};
  }
 };
}
