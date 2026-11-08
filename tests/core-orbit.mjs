import assert from 'node:assert/strict';
import * as THREE from 'three';
import {installCoreOrbit,pickOrbitGroup,wrapOrbitGroups} from '../frontend/src/core-orbit.js';
globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.hidden=false;
class Canvas extends EventTarget {
 clientWidth=390;clientHeight=400;captured=null;
 dataset={};
 classList={add(){},remove(){}};
 setPointerCapture(id){this.captured=id;}
 hasPointerCapture(id){return this.captured===id;}
 releasePointerCapture(){this.captured=null;}
}
function event(canvas,type,x=100,y=100,extra={}){
 const e=new Event(type);Object.assign(e,{pointerId:1,isPrimary:true,pointerType:'touch',button:0,clientX:x,clientY:y,...extra});canvas.dispatchEvent(e);
}
for(const pointerType of ['mouse','touch','pen'])for(const [dx,dy] of [[60,0],[0,60],[60,60]]){
 const canvas=new Canvas(),pivot=new THREE.Group(),camera=new THREE.PerspectiveCamera();
 camera.position.set(0,8,.2);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
 let reduced=false;const orbit=installCoreOrbit(canvas,pivot,camera,()=>reduced);
 event(canvas,'pointerdown',100,100,{pointerType});event(canvas,'pointermove',100+dx,100+dy,{pointerType});
 assert.ok(pivot.quaternion.angleTo(new THREE.Quaternion())>.1,'Drag rotates the 3D pivot');
 event(canvas,'pointerup');const released=pivot.quaternion.clone();orbit.update(.06);
 assert.ok(pivot.quaternion.angleTo(released)>.001,'Release keeps momentum');
 reduced=true;const before=pivot.quaternion.clone();orbit.update(.06);assert.ok(pivot.quaternion.angleTo(before)<1e-7,'Reduced motion stops inertia');
 event(canvas,'pointerdown');event(canvas,'pointermove',140,130);assert.ok(pivot.quaternion.angleTo(before)>.01,'Reduced motion permits direct manipulation');
 event(canvas,'pointercancel');reduced=false;const cancelled=pivot.quaternion.clone();orbit.update(.06);assert.ok(pivot.quaternion.angleTo(cancelled)<1e-7);
 orbit.dispose();assert.equal(canvas.captured,null);
}
const canvas=new Canvas(),pivot=new THREE.Group(),camera=new THREE.PerspectiveCamera(),orbit=installCoreOrbit(canvas,pivot,camera,()=>false);
event(canvas,'pointerdown');event(canvas,'pointerup');orbit.update(.06);assert.ok(pivot.quaternion.angleTo(new THREE.Quaternion())>.01,'Tap starts spinning');
const first=pivot.quaternion.clone();for(let i=0;i<400;i++)orbit.update(.06);
const settled=pivot.quaternion.clone();orbit.update(.06);assert.ok(pivot.quaternion.angleTo(settled)<1e-7,'Momentum settles');
assert.ok(first.angleTo(settled)>.01);orbit.dispose();
console.log('PASS: mouse, touch and pen; horizontal, vertical and diagonal rotation; tap spin; momentum; cancellation; reduced motion; cleanup.');

// Two separate visible groups, plus a rear surface behind the first.
{
 const canvas=new Canvas();canvas.getBoundingClientRect=()=>({left:0,top:0,width:390,height:400});
 const camera=new THREE.PerspectiveCamera(40,390/400,.1,100);camera.position.z=6;camera.lookAt(0,0,0);
 const root=new THREE.Group();
 for(const [name,x,z] of [['Rotor_00',-.8,0],['Plasma_spin',.8,0],['Rotor_01',-.8,-1]]){
  const node=new THREE.Group();node.name=name;const mesh=new THREE.Mesh(new THREE.SphereGeometry(.4),new THREE.MeshBasicMaterial());mesh.position.set(x,0,z);node.add(mesh);root.add(node);
 }
 const targets=wrapOrbitGroups(root);assert.equal(targets.length,3);
 function point(x,z=0){const v=new THREE.Vector3(x,0,z).project(camera);return [(v.x+1)*195,(1-v.y)*200];}
 const left=point(-.8),right=point(.8);
 assert.equal(pickOrbitGroup(canvas,camera,targets,...left),targets[0],'Nearest visible group wins overlapping hits');
 assert.equal(pickOrbitGroup(canvas,camera,targets,5,5),null,'Empty canvas never spins another group');
 const orbit=installCoreOrbit(canvas,null,camera,()=>false,{targets});
 event(canvas,'pointerdown',...left);event(canvas,'pointermove',left[0]+25,left[1]);event(canvas,'pointerup');
 const a=targets[0].quaternion.clone();assert.ok(a.angleTo(new THREE.Quaternion())>.1);
 assert.equal(targets[1].quaternion.angleTo(new THREE.Quaternion()),0,'Dragging one group leaves the core unchanged');
 event(canvas,'pointerdown',...right);event(canvas,'pointermove',right[0]-25,right[1]);event(canvas,'pointerup');
 assert.ok(targets[0].quaternion.y*targets[1].quaternion.y<0,'Groups spin in opposite directions');
 const b=targets[1].quaternion.clone();orbit.update(.06);
 assert.ok(targets[0].quaternion.angleTo(a)>.01);assert.ok(targets[1].quaternion.angleTo(b)>.01,'Both momenta advance independently');
 assert.equal(targets[2].quaternion.angleTo(new THREE.Quaternion()),0,'Rear group remains untouched');
 const node=targets[0].children[0],mixer=new THREE.AnimationMixer(root);
 const track=new THREE.QuaternionKeyframeTrack(node.name+'.quaternion',[0,1],[0,0,0,1,0,0,1,0]);
 mixer.clipAction(new THREE.AnimationClip('test',1,[track])).play();
 const interaction=targets[0].quaternion.clone();mixer.update(.5);
 assert.ok(targets[0].quaternion.angleTo(interaction)<1e-7,'Animation does not overwrite user pivot');
 orbit.dispose();
 console.log('PASS: independent groups, frontmost picking, empty-space rejection, opposite concurrent momentum, animation composition.');
}
