import {installCoreOrbit,wrapOrbitGroups} from './core-orbit';
import * as THREE from 'three';

// Activity comes from the bridge; audio energy comes from its mic/playback analyser.
const createFallbackReactor = function (canvas, getLevel) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, powerPreference:'low-power'}); }
  catch { return null; }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100);
  camera.position.z = 6;
  const group = new THREE.Group();
  const pivot=new THREE.Group();scene.add(pivot);pivot.add(group);
  const material = new THREE.MeshBasicMaterial({wireframe:true, transparent:true, opacity:.6});
  const shell = new THREE.IcosahedronGeometry(.8, 3);
  const rest = shell.attributes.position.array.slice();
  const orb = new THREE.Mesh(shell, material);
  group.add(orb);
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(.34, 1), new THREE.MeshBasicMaterial({transparent:true, opacity:.3, wireframe:true}));
  group.add(heart);
  const rings = Array.from({length:4}, (_, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12+i*.18, .008, 6, 128, Math.PI*(1.35+i*.12)), new THREE.MeshBasicMaterial({transparent:true, opacity:.45-i*.06}));
    ring.rotation.set(.5+i*.5, i*.7, i);
    group.add(ring);
    return ring;
  });
  const count=240, positions=new Float32Array(count*3), seeds=[];
  for(let i=0;i<count;i++) seeds.push({angle:i*2.39996, radius:1.05+(i%31)/31*.9, z:Math.sin(i*13.7)*.7});
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const particles=new THREE.Points(geometry,new THREE.PointsMaterial({size:.022,transparent:true,opacity:.65}));
  group.add(particles);
  const pulse=new THREE.Mesh(new THREE.TorusGeometry(1,.012,6,128),new THREE.MeshBasicMaterial({transparent:true,opacity:0}));
  group.add(pulse);
  const profiles={boot:[.5,.15],idle:[.22,.08],listening:[.65,.24],transcribing:[1.05,.22],thinking:[1.45,.32],speaking:[.85,.2],error:[.12,.12]};
  let mode='boot',reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame=0,last=0,elapsed=0,energy=0,speed=.3,activity=.1,burst=0,disposed=false;
  const corePivot=new THREE.Group();corePivot.name='Core';group.add(corePivot);corePivot.add(orb,heart);
  const targets=[corePivot,...rings.map((ring,i)=>{const p=new THREE.Group();p.name='Orbit_'+i;group.add(p);p.add(ring);return p;})];
  const orbit=installCoreOrbit(canvas,null,camera,()=>reduced,{targets});
  const color=new THREE.Color(),target=new THREE.Color();
  function resize(){
    const r=canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
    renderer.setSize(w,h,false);camera.aspect=w/h;
    camera.position.z=Math.max(6,4.8/camera.aspect);camera.updateProjectionMatrix();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  function draw(time){
    if(disposed)return;
    frame=requestAnimationFrame(draw);
    if(document.hidden){last=time;return;}
    if(time-last<(reduced?250:32))return;
    const dt=Math.min((time-last)/1000,.06);last=time;
    const style=getComputedStyle(document.documentElement);
    target.set(style.getPropertyValue(mode==='error'?'--red':mode==='thinking'||mode==='transcribing'?'--amber':'--core').trim()||style.getPropertyValue('--core').trim()||'#6ff2ff');
    color.lerp(target,1-Math.exp(-dt*5));
    [orb,heart,particles,pulse,...rings].forEach(o=>o.material.color.copy(color));
    const profile=profiles[mode]||profiles.idle;
    speed+=(profile[0]-speed)*(1-Math.exp(-dt*4));activity+=(profile[1]-activity)*(1-Math.exp(-dt*4));
    const raw=Math.max(0,Math.min(1,Number(getLevel())||0));
    energy+=(raw-energy)*(1-Math.exp(-dt*(raw>energy?18:5)));
    if(!reduced){elapsed+=dt*speed;burst=Math.max(0,burst-dt*.7);}
    const t=reduced?0:elapsed, e=reduced?0:energy;
    const breath=reduced?0:Math.sin(t*2.8)*.025;
    const vertices=shell.attributes.position.array;
    for(let i=0;i<vertices.length;i+=3){
      const x=rest[i],y=rest[i+1],z=rest[i+2];
      const wave=reduced?0:Math.sin(x*7+t*4)*Math.cos(y*6-t*3)*Math.sin(z*5+t*2);
      const scale=1+breath+e*.28+wave*(activity*.16+e*.22)+(!reduced?burst*.07:0);
      vertices[i]=x*scale;vertices[i+1]=y*scale;vertices[i+2]=z*scale;
    }
    shell.attributes.position.needsUpdate=true;
    material.opacity=.45+activity*.5+e*.2;
    heart.scale.setScalar(1+e*.65+breath*3);heart.rotation.set(t*.7,-t*.9,t*.3);
    orb.rotation.set(t*.18,t*.4,Math.sin(t*.3)*.12);
    rings.forEach((r,i)=>{r.rotation.set(.5+i*.5+Math.sin(t*.6+i)*activity,i*.7+t*(i%2?-.35:.3),i+t*(i%2?1:-1)*(.25+i*.12));r.scale.setScalar(1+e*(.06+i*.025));});
    for(let i=0;i<count;i++){
      const seed=seeds[i],a=seed.angle+t*(mode==='listening'?-.5:.22)*(1+i%3);
      const r=seed.radius+(reduced?0:Math.sin(t*2+seed.angle)*activity*.25)-e*.18;
      positions[i*3]=Math.cos(a)*r;positions[i*3+1]=Math.sin(a)*r;positions[i*3+2]=seed.z*(1+e);
    }
    geometry.attributes.position.needsUpdate=true;
    pulse.scale.setScalar(1+(1-burst)*1.3);pulse.material.opacity=reduced?0:burst*.5;
    orbit.update(dt);
    renderer.render(scene,camera);
  }
  frame=requestAnimationFrame(draw);
  window.addEventListener('pagehide',()=>{disposed=true;orbit.dispose();cancelAnimationFrame(frame);observer.disconnect();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});renderer.dispose();},{once:true});
  return {setMode(next){if(next!==mode)burst=1;mode=next;},setReduced(value){reduced=value;}};
};

// Blender export: all seven clips play together; bridge state controls their tempo.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

window.createThreeReactor = function (canvas, getLevel) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, powerPreference:'low-power'}); }
  catch { return null; }
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), group = new THREE.Group();
  const pivot=new THREE.Group();scene.add(pivot);pivot.add(group);
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 50);
  camera.up.set(0, 0, -1);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1,1), .55, .45, .85);
  composer.addPass(bloom);
  const output=new OutputPass();
  // Bloom's intermediate targets are opaque black. Recover coverage from light
  // so the core floats over the dashboard instead of drawing a gray rectangle.
  output.material.fragmentShader=output.material.fragmentShader.replace(/}\s*$/, `
    float coverage = clamp(max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b), 0.0, 1.0);
    gl_FragColor.a = coverage;
    gl_FragColor.rgb *= coverage;
  }`);
  composer.addPass(output);
  bloom.compositeMaterial.blending = THREE.AdditiveBlending;
  const profiles = {boot:[.65,.12],idle:[.45,.08],listening:[.85,.2],transcribing:[1.2,.22],thinking:[1.5,.28],speaking:[1,.2],error:[.18,.1]};
  let mode='boot', reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let disposed=false, frame=0, last=0, elapsed=0, energy=0, speed=.45, burst=0, mixer, model, fallback;
  const materials=new Set(), color=new THREE.Color(), target=new THREE.Color(), foreground=new THREE.Color(), background=new THREE.Color();
  let orbit={update(){},dispose(){}};
  let paletteReady=false;
  function releaseModel(root) {
    const geometries=new Set(), mats=new Set();
    root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[]))mats.add(m);});
    geometries.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());
  }
  function resize() {
    const rect=canvas.getBoundingClientRect(), w=Math.max(1,rect.width), h=Math.max(1,rect.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
    renderer.setSize(w,h,false);composer.setSize(w,h);
    camera.aspect=w/h;camera.position.set(0,Math.max(8.4,7.8/camera.aspect),.2);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  }
  const observer=new ResizeObserver(resize);observer.observe(canvas);resize();
  new GLTFLoader().load('/core.glb', gltf=>{
    if(disposed){releaseModel(gltf.scene);return;}
    model=gltf.scene;group.add(model);
    model.traverse(o=>{for(const m of [].concat(o.material||[])){
      materials.add(m);
      // Keep the export's brightness hierarchy while replacing its cyan palette.
      if(!m.userData.coreStyle)m.userData.coreStyle={strength:m.emissiveIntensity||1,kind:m.name};
    }});
    const targets=wrapOrbitGroups(model);
    orbit=installCoreOrbit(canvas,null,camera,()=>reduced,{targets});
    canvas.dataset.orbitGroups=String(targets.length);
    mixer=new THREE.AnimationMixer(model);
    for(const clip of gltf.animations)mixer.clipAction(clip).play();
    canvas.dataset.coreModel='loaded';
    canvas.dataset.coreClips=String(gltf.animations.length);
  },undefined,()=>{
    if(disposed)return;
    orbit.dispose();cancelAnimationFrame(frame);observer.disconnect();bloom.dispose();composer.dispose();renderer.dispose();
    fallback=createFallbackReactor(canvas,getLevel);
    fallback?.setMode(mode);fallback?.setReduced(reduced);
    canvas.dataset.coreModel='fallback';
  });
  function draw(time) {
    if(disposed||fallback)return;
    frame=requestAnimationFrame(draw);
    if(document.hidden){last=time;return;}
    if(time-last<(reduced?250:32))return;
    const dt=Math.min((time-last)/1000,.06);last=time;
    const style=getComputedStyle(document.documentElement);
    target.set(style.getPropertyValue(mode==='error'?'--red':mode==='thinking'||mode==='transcribing'?'--amber':'--core').trim()||style.getPropertyValue('--core').trim()||'#6ff2ff');
    foreground.set(style.getPropertyValue('--text').trim()||'#ffffff');
    background.set(style.getPropertyValue('--bg').trim()||'#101010');
    if(!paletteReady){color.copy(target);paletteReady=true;}else color.lerp(target,1-Math.exp(-dt*5));
    const profile=profiles[mode]||profiles.idle;
    speed+=(profile[0]-speed)*(1-Math.exp(-dt*4));
    const raw=Math.max(0,Math.min(1,Number(getLevel())||0));
    energy+=(raw-energy)*(1-Math.exp(-dt*(raw>energy?18:5)));
    const e=reduced?0:energy;
    if(!reduced){elapsed+=dt;burst=Math.max(0,burst-dt*.8);mixer?.update(dt*(speed+e*1.8));}
    const breath=reduced?0:Math.sin(elapsed*1.8)*.012;
    group.scale.setScalar(1+breath+e*.065+(reduced?0:burst*.025));
    // Gentle three-axis precession reveals depth without losing the frontal silhouette.
    group.rotation.set(reduced?0:Math.sin(elapsed*.31)*(.045+e*.06),reduced?0:Math.sin(elapsed*.17)*.025,reduced?0:Math.cos(elapsed*.27)*(.045+e*.04));
    for(const m of materials){
      const {kind,strength}=m.userData.coreStyle;
      const tint=color.clone();
      if(kind==='Plasma White')tint.lerp(foreground,.28);
      if(kind==='Graphite')tint.copy(background).lerp(color,.12);
      m.color.copy(tint);
      m.emissive.copy(tint);
      m.emissiveIntensity=kind==='Graphite'?.12:kind==='Circuit Teal'?.35:strength*(.7+profile[1]+e*.7+(reduced?0:burst*.12));
    }
    bloom.strength=.4+e*.25+(reduced?0:burst*.08);
    orbit.update(dt);
    composer.render();
  }
  frame=requestAnimationFrame(draw);
  window.addEventListener('pagehide',()=>{
    disposed=true;orbit.dispose();cancelAnimationFrame(frame);
    if(fallback)return;
    observer.disconnect();mixer?.stopAllAction();if(model){mixer?.uncacheRoot(model);releaseModel(model);}
    bloom.dispose();composer.dispose();renderer.dispose();
  },{once:true});
  return {setMode(next){if(next!==mode)burst=1;mode=next;fallback?.setMode(next);},setReduced(value){reduced=value;fallback?.setReduced(value);}};
};
