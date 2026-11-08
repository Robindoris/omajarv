import * as THREE from 'three';

// Each animation node gets a parent pivot; the mixer never overwrites user rotation.
export function wrapOrbitGroups(root) {
 const nodes=[];root.traverse(node=>{if(/^(Rotor_\d+|Plasma[ _]spin|Outer[ _]cage)$/.test(node.name))nodes.push(node);});
 return nodes.map(node=>{
  const pivot=new THREE.Group();pivot.name='Touch_'+node.name;
  node.parent.add(pivot);pivot.add(node);
  return pivot;
 });
}

// Exact visible-surface picking first, with a small screen-space tolerance for thin rings.
export function pickOrbitGroup(canvas,camera,targets,x,y) {
 const rect=canvas.getBoundingClientRect();
 if(!rect.width||!rect.height)return null;
 const ray=new THREE.Raycaster();camera.updateMatrixWorld();
 targets.forEach(t=>t.updateWorldMatrix(true,true));
 ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
 const hits=ray.intersectObjects(targets,true);
 function owner(object){return targets.find(t=>{for(let n=object;n;n=n.parent)if(n===t)return true;return false;});}
 if(hits.length)return owner(hits[0].object);
 let selected=null,best=14*14,depth=Infinity;
 const v=new THREE.Vector3();
 for(const target of targets)target.traverse(mesh=>{
  const positions=mesh.geometry?.attributes.position;if(!positions)return;
  const stride=Math.max(1,Math.ceil(positions.count/2500));
  for(let i=0;i<positions.count;i+=stride){
   v.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).project(camera);
   if(v.z< -1||v.z>1)continue;
   const dx=rect.left+(v.x+1)*rect.width/2-x,dy=rect.top+(1-v.y)*rect.height/2-y,d=dx*dx+dy*dy;
   if(d<best-.01 || (Math.abs(d-best)<.01 && v.z<depth)){best=d;depth=v.z;selected=target;}
  }
 });
 return selected;
}

// Camera-space input is transformed into each pivot parent's local space.
export function installCoreOrbit(canvas,pivot,camera,isReduced,options={}) {
 const targets=options.targets||[pivot],velocities=new Map(targets.map(t=>[t,new THREE.Vector2()]));
 let selected=pivot;
 let pointer=null,lastX=0,lastY=0,lastTime=0,moved=false;
 let velocity=velocities.get(selected);
 const axis=new THREE.Vector3(),step=new THREE.Quaternion();
 const right=new THREE.Vector3(),up=new THREE.Vector3();
 function rotate(x,y){
  camera.updateMatrixWorld();
  right.set(1,0,0).applyQuaternion(camera.quaternion);
  up.set(0,1,0).applyQuaternion(camera.quaternion);
  axis.copy(up).multiplyScalar(x).addScaledVector(right,y);
  const angle=axis.length();
  if(angle){step.setFromAxisAngle(axis.normalize(),angle);const parentRotation=new THREE.Quaternion();selected.parent?.getWorldQuaternion(parentRotation);
   axis.applyQuaternion(parentRotation.invert());step.setFromAxisAngle(axis,angle);selected.quaternion.premultiply(step).normalize();}
 }
 function finish(cancel=false){
  if(pointer===null)return;
  const id=pointer;pointer=null;
  if(cancel||isReduced())velocity.set(0,0);
  else if(!moved)velocity.set(1.2,.8);
  else if(performance.now()-lastTime>120)velocity.set(0,0);
  if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
  canvas.classList.remove('orbit-dragging');
 }
 function down(e){
  if(pointer!==null){finish(true);return;}
  if(!e.isPrimary || (e.pointerType==='mouse'&&e.button!==0))return;
  selected=options.targets?pickOrbitGroup(canvas,camera,targets,e.clientX,e.clientY):pivot;
  if(!selected)return;
  velocity=velocities.get(selected);canvas.dataset.orbitSelected=selected.name;
  pointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;lastTime=performance.now();moved=false;
  velocity.set(0,0);canvas.setPointerCapture?.(pointer);canvas.classList.add('orbit-dragging');
 }
 function move(e){
  if(e.pointerId!==pointer)return;
  const now=performance.now(),dt=Math.max((now-lastTime)/1000,1/120);
  const scale=Math.PI*2/Math.max(180,Math.min(canvas.clientWidth,canvas.clientHeight));
  const x=(e.clientX-lastX)*scale,y=(e.clientY-lastY)*scale;
  if(x||y){moved=true;rotate(x,y);velocity.set(x/dt,y/dt).clampLength(0,5);}
  lastX=e.clientX;lastY=e.clientY;lastTime=now;
 }
 const upEvent=e=>{if(e.pointerId===pointer)finish();};
 const cancel=e=>{if(e.pointerId===pointer)finish(true);};
 const stop=()=>{finish(true);velocities.forEach(v=>v.set(0,0));};
 const visibility=()=>{if(document.hidden)stop();};
 canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
 canvas.addEventListener('pointerup',upEvent);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);
 window.addEventListener('blur',stop);document.addEventListener('visibilitychange',visibility);
 return {
  update(dt){
   if(isReduced()){velocities.forEach(v=>v.set(0,0));return;}
   const active=selected;
   for(const [target,v] of velocities){if(pointer!==null&&target===active)continue;selected=target;rotate(v.x*dt,v.y*dt);v.multiplyScalar(Math.exp(-dt*1.7));}
   selected=active;
  },
  dispose(){
   stop();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);
   canvas.removeEventListener('pointerup',upEvent);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);
   window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',visibility);
  }
 };
}
