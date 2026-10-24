import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as SDK from './sdk.js';
import { A } from './audio.js';

const $=id=>document.getElementById(id);
const TOUCH=('ontouchstart' in window)||location.search.includes('touch');
const T=3, MAXF=18;
let Q=TOUCH?1:2; // 2 high: bloom+shadows, 1 medium: bloom, 0 low
const ZONES=[
  {name:'OFFICES',wall:0xc8bca8,metal:0xb8b0a0,fog:0x0a0705,amb:0x6a5a48,lamp:0xff2a10,floorP:['desk','shelf','crate'],corrP:['shelf'],wallP:['screen','sign','vent','cables'],clutter:'papers',special:null},
  {name:'SERVER WING',wall:0x8a98b0,metal:0x8a9ab8,fog:0x030814,amb:0x30508a,lamp:0xff2010,floorP:['rack','rack','crate'],corrP:['rack'],wallP:['screen','cables','cables','sign'],clutter:null,special:null},
  {name:'LABS',wall:0xd8e0dc,metal:0xc0ccc8,fog:0x03100a,amb:0x308a60,lamp:0xff3018,floorP:['tank','desk','shelf'],corrP:['shelf'],wallP:['vent','screen','sign','pipes'],clutter:'papers',special:'tank'},
  {name:'MAINTENANCE',wall:0xa08868,metal:0xa08870,fog:0x100803,amb:0x7a5030,lamp:0xff4010,floorP:['crate','barrel','barrel'],corrP:['barrel'],wallP:['pipes','pipes','vent','cables'],clutter:null,special:null},
  {name:'REACTOR',wall:0x9a8070,metal:0xa08878,fog:0x180502,amb:0x8a3010,lamp:0xff3010,floorP:['barrel','crate'],corrP:['barrel'],wallP:['pipes','vent','sign','cables'],clutter:null,special:'reactor'},
  {name:'CRYO VAULT',wall:0xd8ecff,metal:0xc0dcf4,fog:0x0c1c2c,amb:0x5888c0,lamp:0x40c8ff,floorP:['frostcrate','cryopod','icepillar'],corrP:['icepillar'],wallP:['vent','sign','pipes','screen'],clutter:null,special:'cryo',fogD:0.085,dust:[0.8,0.9,1.0],dustB:0.45,mech:'lasers'},
  {name:'SEWERS',wall:0x6a7258,metal:0x707a60,fog:0x0d1309,amb:0x7a8a5a,lamp:0xffb040,floorP:['sewcol','barrel','crate'],corrP:['barrel'],wallP:['sewpipe','sewpipe','valve','cables','sign'],clutter:null,special:'sewer',fogD:0.065,dust:[0.7,0.75,0.6],mech:'blackout'},
  {name:'CONTROL CORE',wall:0x8c8ca0,metal:0x9090a8,fog:0x08060e,amb:0x483870,lamp:0xff2050,floorP:['rack','crate','shelf'],corrP:['rack'],wallP:['screen','screen','sign','cables'],clutter:'papers',special:null,mech:'secdoors'}];
const ZMAP=[0,0,1,1,2,2,3,3,4,4,5,5,5,6,6,6,7,7];
const zoneOf=f=>ZONES[ZMAP[Math.min(MAXF,f)-1]];
const BOSSF={13:'sentinel',16:'stalker',18:'warden'};
const zoneName=f=>f===MAXF?'CONTROL CORE — FINAL ESCAPE':f===13?'CRYO VAULT — FROST SENTINEL':f===16?'SEWERS — THE STALKER':zoneOf(f).name;

const canvas=$('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:!TOUCH,powerPreference:'high-performance'});
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x020102);
scene.fog=new THREE.FogExp2(0x040203,0.07);
const camera=new THREE.PerspectiveCamera(72,1,0.05,60); camera.rotation.order='YXZ'; scene.add(camera);
const hemi=new THREE.HemisphereLight(0x303848,0x100808,0.5); scene.add(hemi);
const FL_I=30;
const flash=new THREE.SpotLight(0xfff0d6,FL_I,24,0.46,0.6,2.0); flash.position.set(0.23,-0.22,-0.64); camera.add(flash);
flash.target.position.set(0.05,-0.1,-5); camera.add(flash.target);
flash.shadow.mapSize.set(1024,1024); flash.shadow.camera.near=0.2; flash.shadow.bias=-0.0006; flash.shadow.normalBias=0.02;
const BEAM_VS=`varying float vD; varying vec3 vN; varying vec3 vV; uniform float uH; void main(){ vec4 p=vec4(position,1.0);
  #ifdef USE_INSTANCING
  p=instanceMatrix*p; vD=clamp(-position.y/uH,0.0,1.0);
  #else
  vD=-position.z/uH;
  #endif
  vec4 mv=modelViewMatrix*p; vV=-mv.xyz; vN=normalMatrix*normal; gl_Position=projectionMatrix*mv; }`;
const BEAM_FS=`uniform float uI; uniform vec3 uC; varying float vD; varying vec3 vN; varying vec3 vV; void main(){ float e=abs(dot(normalize(vN),normalize(vV))); float a=pow(1.0-vD,2.0)*pow(e,2.0)*uI*smoothstep(0.0,0.2,vD); gl_FragColor=vec4(uC*a,a); }`;
function beamMaterial(c,i,h){ return new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,uniforms:{uI:{value:i},uC:{value:new THREE.Color(c)},uH:{value:h}},vertexShader:BEAM_VS,fragmentShader:BEAM_FS}); }
const beamGeo=new THREE.ConeGeometry(2.6,11,28,1,true); beamGeo.translate(0,-5.5,0); beamGeo.rotateX(Math.PI/2);
const beamMat=beamMaterial(0xffeed0,0.06,11); const beam=new THREE.Mesh(beamGeo,beamMat); beam.position.copy(flash.position); beam.renderOrder=5; camera.add(beam);
const DN=TOUCH?220:450, dpos=new Float32Array(DN*3); for(let i=0;i<DN*3;i++)dpos[i]=Math.random()*8;
const dGeo=new THREE.BufferGeometry(); dGeo.setAttribute('position',new THREE.BufferAttribute(dpos,3));
const dustMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  uniforms:{uDC:{value:new THREE.Vector3(1,0.95,0.85)},uB:{value:0.15},uCam:{value:new THREE.Vector3()},uL:{value:new THREE.Vector3()},uDir:{value:new THREE.Vector3(0,0,-1)},uOn:{value:1},uT:{value:0},uPx:{value:1}},
  vertexShader:`uniform vec3 uCam,uL,uDir; uniform float uOn,uT,uPx,uB; varying float vA; void main(){ vec3 p=position+vec3(sin(uT*0.3+position.y)*0.3,uT*0.05,cos(uT*0.2+position.x)*0.3); p=uCam+mod(p-uCam+4.0,8.0)-4.0; vec3 d=p-uL; float l=length(d); float c=smoothstep(0.86,0.97,dot(d/l,uDir)); vA=uB+c*uOn*smoothstep(8.0,1.0,l)*smoothstep(0.3,1.0,l); vec4 mv=modelViewMatrix*vec4(p,1.0); gl_PointSize=uPx*14.0/-mv.z; gl_Position=projectionMatrix*mv; }`,
  fragmentShader:`uniform vec3 uDC; varying float vA; void main(){ float r=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,r)*vA*0.5; gl_FragColor=vec4(uDC*a,a); }`});
const dust=new THREE.Points(dGeo,dustMat); dust.frustumCulled=false; scene.add(dust);
function softTex(){ const c=document.createElement('canvas'); c.width=c.height=64; const g=c.getContext('2d'); const gr=g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(0.25,'rgba(255,255,255,.6)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=gr; g.fillRect(0,0,64,64); return new THREE.CanvasTexture(c); }
const SOFT=softTex();
class FX{ constructor(n,additive){ this.n=n; this.p=new Float32Array(n*3); this.c=new Float32Array(n*3); this.a=new Float32Array(n); this.s=new Float32Array(n); this.v=new Float32Array(n*3); this.l=new Float32Array(n); this.ml=new Float32Array(n).fill(1); this.g=new Float32Array(n); this.gr=new Float32Array(n); this.s0=new Float32Array(n); this.i=0;
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(this.p,3)); g.setAttribute('aC',new THREE.BufferAttribute(this.c,3)); g.setAttribute('aA',new THREE.BufferAttribute(this.a,1)); g.setAttribute('aS',new THREE.BufferAttribute(this.s,1)); this.geo=g;
    const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,uniforms:{uPx:{value:1},map:{value:SOFT}},
      vertexShader:`attribute vec3 aC; attribute float aA,aS; uniform float uPx; varying vec3 vC; varying float vA; void main(){ vC=aC; vA=aA; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aS*uPx*300.0/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader:`uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ float t=texture2D(map,gl_PointCoord).a; gl_FragColor=vec4(vC,t*vA); }`});
    this.pts=new THREE.Points(g,m); this.pts.frustumCulled=false; this.pts.renderOrder=6; scene.add(this.pts); this.mat=m; }
  emit(x,y,z,vx,vy,vz,life,size,col,grav=0,grow=0){ const i=this.i; this.i=(this.i+1)%this.n; this.p[i*3]=x;this.p[i*3+1]=y;this.p[i*3+2]=z; this.v[i*3]=vx;this.v[i*3+1]=vy;this.v[i*3+2]=vz; this.l[i]=life; this.ml[i]=life; this.s0[i]=size; this.g[i]=grav; this.gr[i]=grow; this.c[i*3]=col.r; this.c[i*3+1]=col.g; this.c[i*3+2]=col.b; }
  update(dt){ for(let i=0;i<this.n;i++){ if(this.l[i]<=0){ this.a[i]=0; continue; } this.l[i]-=dt; const k=i*3; this.v[k+1]+=this.g[i]*dt; this.p[k]+=this.v[k]*dt; this.p[k+1]+=this.v[k+1]*dt; this.p[k+2]+=this.v[k+2]*dt;
      if(this.p[k+1]<0.02&&this.g[i]<0){ this.p[k+1]=0.02; this.v[k+1]*=-0.35; this.v[k]*=0.6; this.v[k+2]*=0.6; }
      const t=Math.max(0,this.l[i]/this.ml[i]); this.a[i]=Math.min(1,t*1.6)*(this.gr[i]>0?Math.min(1,(1-t)*5)*0.5:1); this.s[i]=this.s0[i]*(1+this.gr[i]*(1-t)); }
    for(const n of ['position','aA','aS','aC'])this.geo.attributes[n].needsUpdate=true; } }
const sparks=new FX(500,true), smoke=new FX(220,false);
const C=h=>new THREE.Color(h);
function burstSparks(x,y,z,n,col=0xffb050,sp=3){ const c=C(col); for(let i=0;i<n;i++){ const a=Math.random()*6.28,u=Math.random(); sparks.emit(x,y,z,Math.cos(a)*sp*u,(Math.random()*0.8-0.2)*sp,Math.sin(a)*sp*u,0.4+Math.random()*0.5,0.025+Math.random()*0.02,c,-9.8); } }
function puff(x,y,z,n,col=0x808080,sz=0.25){ const c=C(col); for(let i=0;i<n;i++) smoke.emit(x+(Math.random()-.5)*0.3,y,z+(Math.random()-.5)*0.3,(Math.random()-.5)*0.8,0.2+Math.random()*0.4,(Math.random()-.5)*0.8,0.8+Math.random()*0.6,sz,c,0,2.5); }
const flareMat=new THREE.PointsMaterial({size:0.9,map:SOFT,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true});
const eyeGeo=new THREE.BufferGeometry(); const eyeP=new Float32Array(40*3), eyeC=new Float32Array(40*3); eyeGeo.setAttribute('position',new THREE.BufferAttribute(eyeP,3)); eyeGeo.setAttribute('color',new THREE.BufferAttribute(eyeC,3));
const eyeFlare=new THREE.Points(eyeGeo,new THREE.PointsMaterial({size:0.55,map:SOFT,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})); eyeFlare.frustumCulled=false; scene.add(eyeFlare);
const composer=new EffectComposer(renderer); composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(256,256),0.6,0.45,0.97); composer.addPass(bloom);
composer.addPass(new OutputPass());
const post=new ShaderPass({uniforms:{tDiffuse:{value:null},uT:{value:0},uD:{value:0},uS:{value:0}},
  vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`uniform sampler2D tDiffuse; uniform float uT,uD,uS; varying vec2 vUv; float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  void main(){ vec2 uv=vUv; float band=h(vec2(floor(uv.y*24.0),floor(uT*14.0))); float gl=step(1.0-0.12*uD-0.5*uS,band); uv.x+=gl*(band-0.5)*0.06*(uD+uS); uv.x+=sin(uv.y*50.0+uT*12.0)*0.002*uD;
    vec2 o=(uv-0.5)*(uD*0.008+uS*0.02); vec3 c=vec3(texture2D(tDiffuse,uv+o).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-o).b);
    float n=h(uv*vec2(1013.0,977.0)+fract(uT)*91.0); c+=(n-0.5)*(0.05+0.1*uD); c=mix(c,vec3(n),clamp(uS,0.0,0.85)); c*=1.0-0.12*uD*step(0.5,fract(uv.y*180.0));
    float v=smoothstep(0.95,0.3,length(vUv-0.5)); c*=mix(0.45,1.0,v); gl_FragColor=vec4(c,1.0);} `});
composer.addPass(post);
function applyQuality(){ flash.castShadow=Q>1; renderer.shadowMap.enabled=Q>1; renderer.setPixelRatio(Math.min(devicePixelRatio,Q===2?1.5:Q===1?1.25:1)); resize(); scene.traverse(o=>{ if(o.isMesh&&o.material&&!Array.isArray(o.material))o.material.needsUpdate=true; }); }
function resize(){ const w=innerWidth,h=innerHeight; renderer.setSize(w,h,false); composer.setSize(w,h); bloom.resolution.set(w/2,h/2); camera.aspect=w/h; camera.fov=w<h?82:72; camera.updateProjectionMatrix(); const px=h/600*renderer.getPixelRatio(); dustMat.uniforms.uPx.value=px; sparks.mat.uniforms.uPx.value=px; smoke.mat.uniforms.uPx.value=px; }
addEventListener('resize',resize);
{ const c=document.createElement('canvas'); c.width=c.height=256; const g=c.getContext('2d'); const d=g.createImageData(256,256); for(let i=0;i<d.data.length;i+=4){const v=Math.random()*255; d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=255;} g.putImageData(d,0,0); $('static').style.backgroundImage=`url(${c.toDataURL()})`; }
const NOISE=`varying vec3 vW; float hh(vec3 p){p=fract(p*0.3183+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);return mix(mix(mix(hh(i),hh(i+vec3(1,0,0)),f.x),mix(hh(i+vec3(0,1,0)),hh(i+vec3(1,1,0)),f.x),f.y),mix(mix(hh(i+vec3(0,0,1)),hh(i+vec3(1,0,1)),f.x),mix(hh(i+vec3(0,1,1)),hh(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
function grime(m,amt=0.3){ if(m.userData.g)return; m.userData.g=1; if(m.metalness>0.6)m.metalness=0.6;
  m.onBeforeCompile=s=>{ s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vW;').replace('#include <project_vertex>',`#include <project_vertex>
    vec4 wq=vec4(transformed,1.0);
    #ifdef USE_INSTANCING
    wq=instanceMatrix*wq;
    #endif
    vW=(modelMatrix*wq).xyz;`);
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\n'+NOISE).replace('#include <color_fragment>',`#include <color_fragment>
    float gn=vn(vW*0.7)*0.6+vn(vW*4.0)*0.4; diffuseColor.rgb*=mix(1.0,mix(0.55,1.12,gn),${amt.toFixed(2)});
    float ao=mix(0.4,1.0,smoothstep(0.0,0.8,vW.y))*mix(0.55,1.0,smoothstep(3.0,2.2,vW.y)); diffuseColor.rgb*=ao;`)
    .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n roughnessFactor=clamp(roughnessFactor*mix(0.7,1.3,vn(vW*2.5)),0.05,1.0);'); };
}
const loader=new GLTFLoader(); const P={}, MAT={}, GL={}; let viewModel=null, lensMat=null;
const loadGLB=u=>new Promise((res,rej)=>loader.load(u,res,undefined,rej));
async function loadAssets(){
  const names=['kit','guard','heavy','drone','secam','zone2']; const r=await Promise.all(names.map(n=>loadGLB('assets/models/'+n+'.glb'))); names.forEach((n,i)=>GL[n]=r[i]);
  const kit=GL.kit.scene; kit.updateMatrixWorld(true);
  for(const node of [...kit.children,...GL.zone2.scene.children]){ const list=[]; node.traverse(o=>{ if(o.isMesh){ const m=o.material; MAT[m.name]=m; if(!m.emissive||m.emissive.getHex()===0||m.emissiveIntensity<0.5)grime(m,m.map?0.25:0.8); list.push({geo:o.geometry,mat:m}); } }); P[node.name]=list; }
  if(MAT.coinM)MAT.coinM.emissiveIntensity=0.25; for(const k of ['reactorglow','glass','lamp','wscreen','screen'])if(MAT[k]&&MAT[k].emissive)MAT[k].emissiveIntensity=Math.min(MAT[k].emissiveIntensity,k==='reactorglow'?0.9:k==='glass'?0.45:1.2); if(MAT.robot)MAT.robot.color.multiplyScalar(0.8); if(MAT.ice){MAT.ice.transparent=true;MAT.ice.opacity=0.8;MAT.ice.emissiveIntensity=0.3;} if(MAT.laserE)MAT.laserE.emissiveIntensity=3;
  for(const k of ['guard','heavy','drone','secam'])GL[k].scene.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.frustumCulled=false; const m=o.material; if(m.name==='geye'){ m.fog=false; m.emissiveIntensity=14; } else if(!m.emissive||m.emissive.getHex()===0)grime(m,0.2); } });
  const fl=single('flashlight'); fl.traverse(o=>{ if(o.isMesh){ o.castShadow=false; o.material=o.material.clone(); if(o.material.name==='lens')lensMat=o.material; else { o.material.emissive=new THREE.Color(0x2a2620); o.material.emissiveIntensity=1; } } });
  fl.position.set(0.24,-0.24,-0.42); fl.rotation.set(0.06,0.06,0); camera.add(fl); viewModel=fl;
}
class Batch{ constructor(){this.m={};} add(name,x,y,z,ry=0,s=1){ (this.m[name]||(this.m[name]=[])).push([x,y,z,ry,s]); }
  build(group){ const d=new THREE.Object3D(); for(const n in this.m){ const arr=this.m[n]; if(!P[n])continue; for(const {geo,mat} of P[n]){ const im=new THREE.InstancedMesh(geo,mat,arr.length); arr.forEach((a,i)=>{d.position.set(a[0],a[1],a[2]);d.rotation.set(0,a[3],0);d.scale.setScalar(a[4]);d.updateMatrix();im.setMatrixAt(i,d.matrix);}); im.castShadow=!['floor','ceil','papers','cables'].includes(n); im.receiveShadow=true; im.computeBoundingSphere(); group.add(im);} } } }
function single(name){ const g=new THREE.Group(); for(const {geo,mat} of P[name]){const m=new THREE.Mesh(geo,mat); m.castShadow=true; m.receiveShadow=true; g.add(m);} return g; }
const DEF={floor:1,coins:0,best:0,stars:{},up:{bat:0,sta:0,quiet:0,cans:0,shoes:0,lens:0}};
let save=Object.assign({},DEF,SDK.loadData('bb_save')||{}); save.up=Object.assign({},DEF.up,save.up||{}); save.stars=save.stars||{};
const UPS=[{k:'bat',n:'BATTERY',d:'Flashlight lasts longer'},{k:'lens',n:'FOCUSED LENS',d:'Brighter, longer beam'},{k:'sta',n:'STAMINA',d:'Sprint longer'},{k:'shoes',n:'RUNNER SHOES',d:'Move faster'},{k:'quiet',n:'QUIET STEPS',d:'Guards hear you less'},{k:'cans',n:'CAN POUCH',d:'+1 throwable can'}];
const upCost=l=>40+l*35; const persist=()=>SDK.saveData('bb_save',save);
const totalStars=()=>Object.values(save.stars).reduce((a,b)=>a+b,0);
let world=null, state='load';
const player={pos:new THREE.Vector3(),yaw:0,pitch:0,bat:1,sta:1,light:true,bob:0,stepT:0,inv:0,revived:false,cards:0,coins:0,cans:2,hidden:null,time:0,spotted:0,shake:0};
const keys={}, inp={run:false,use:false,throw:false};
const run={time:0,spotted:0,coins:0,floors:0};
function rng(seed){ return ()=>{ seed=(seed*16807)%2147483647; return (seed-1)/2147483646; }; }
const W2=x=>x*T;
const isWall=(G,x,y)=>y<0||x<0||y>=G.length||x>=G.length||G[y][x]===1;
function genFloor(f){
  const R=rng(1+Math.floor(Math.random()*2e9)); const n=Math.min(12,5+Math.floor(f*0.55)), S=2*n+1;
  const G=[]; for(let y=0;y<S;y++)G.push(new Array(S).fill(1));
  const st=[[1,1]]; G[1][1]=0;
  while(st.length){ const [x,y]=st[st.length-1]; const nb=[[2,0],[-2,0],[0,2],[0,-2]].filter(([dx,dy])=>{const a=x+dx,b=y+dy;return a>0&&b>0&&a<S-1&&b<S-1&&G[b][a]===1;});
    if(!nb.length){st.pop();continue;} const [dx,dy]=nb[Math.floor(R()*nb.length)]; G[y+dy/2][x+dx/2]=0; G[y+dy][x+dx]=0; st.push([x+dx,y+dy]); }
  for(let i=0;i<n*n*0.14;i++){ const x=1+Math.floor(R()*(S-2)),y=1+Math.floor(R()*(S-2)); if(G[y][x]===1&&((x%2===1&&y%2===0)||(x%2===0&&y%2===1)))G[y][x]=0; }
  const rooms=[], roomSet=new Set(); for(let i=0;i<2+Math.floor(f/3);i++){ const cx=3+2*Math.floor(R()*(n-2)),cy=3+2*Math.floor(R()*(n-2)); if(cx<4&&cy<4)continue; for(let y=cy-1;y<=cy+1;y++)for(let x=cx-1;x<=cx+1;x++){G[y][x]=0;roomSet.add(x+','+y);} rooms.push([cx,cy]); }
  return {G,S,n,rooms,roomSet,R};
}
function bfs(G,sx,sy,tx,ty){ const S=G.length; if(isWall(G,tx,ty)||isWall(G,sx,sy))return null; const prev=new Int32Array(S*S).fill(-1),q=[sy*S+sx]; prev[sy*S+sx]=sy*S+sx; let h=0;
  while(h<q.length){ const c=q[h++]; const x=c%S,y=(c/S)|0; if(x===tx&&y===ty)break; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy; if(!isWall(G,a,b)&&prev[b*S+a]<0){prev[b*S+a]=c;q.push(b*S+a);}} }
  if(prev[ty*S+tx]<0)return null; const path=[]; let c=ty*S+tx; while(c!==sy*S+sx){path.push([c%S,(c/S)|0]);c=prev[c];} return path.reverse(); }
function distMap(G,sx,sy){ const S=G.length,d=new Int32Array(S*S).fill(-1),q=[sy*S+sx]; d[q[0]]=0; let h=0; while(h<q.length){const c=q[h++];const x=c%S,y=(c/S)|0; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy; if(!isWall(G,a,b)&&d[b*S+a]<0){d[b*S+a]=d[c]+1;q.push(b*S+a);}}} return d; }
const DIRS=[[0,-1],[0,1],[-1,0],[1,0]];
const PROPS={desk:{d:0.8,r:0.62,room:1},shelf:{d:0.45,r:0.45},crate:{d:1.2,r:0.8,room:1},rack:{d:0.9,r:0.5},barrel:{d:0.7,r:0.38},tank:{d:1.1,r:0.55,room:1},frostcrate:{d:1.0,r:0.7,room:1},cryopod:{d:1.1,r:0.55,room:1},icepillar:{d:0.9,r:0.5},sewcol:{d:0.7,r:0.45}};
function buildFloor(f){
  if(world){ scene.remove(world.group); world.group.traverse(o=>{ if(o.isInstancedMesh)o.dispose(); }); A.buzz(0); A.siren(false); }
  const Z=zoneOf(f); const L=genFloor(f), {G,S,R,roomSet}=L; const group=new THREE.Group(); scene.add(group);
  if(MAT.concrete)MAT.concrete.color.setHex(Z.wall); if(MAT.metal)MAT.metal.color.setHex(Z.metal); if(MAT.grate)MAT.grate.color.setHex(Z.metal);
  scene.fog.color.setHex(Z.fog); scene.background.setHex(Z.fog); scene.fog.density=Z.fogD||0.07; dustMat.uniforms.uDC.value.fromArray(Z.dust||[1,0.95,0.85]); dustMat.uniforms.uB.value=Z.dustB||0.15; hemi.color.setHex(Z.amb); hemi.intensity=1.15;
  const B=new Batch(); const open=[], edges=[];
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){ if(G[y][x]===1)continue; open.push([x,y]); B.add('floor',W2(x),0,W2(y)); B.add('ceil',W2(x),0,W2(y));
    if(isWall(G,x,y-1))edges.push([x,y,W2(x),W2(y)-1.5,0]); if(isWall(G,x,y+1))edges.push([x,y,W2(x),W2(y)+1.5,Math.PI]);
    if(isWall(G,x-1,y))edges.push([x,y,W2(x)-1.5,W2(y),Math.PI/2]); if(isWall(G,x+1,y))edges.push([x,y,W2(x)+1.5,W2(y),-Math.PI/2]); }
  for(const e of edges)B.add('wall',e[2],0,e[3],e[4]);
  const nrm=ry=>[Math.sin(ry),Math.cos(ry)];
  const dm=distMap(G,1,1); const deg=(x,y)=>DIRS.filter(([a,b])=>!isWall(G,x+a,y+b)).length;
  let dead=open.filter(([x,y])=>deg(x,y)===1&&!(x===1&&y===1)).sort((a,b)=>dm[b[1]*S+b[0]]-dm[a[1]*S+a[0]]);
  const used=new Set(['1,1','2,1','1,2']); const key=t=>t[0]+','+t[1]; const take=t=>{used.add(key(t)); return t;};
  const closedDir=([x,y])=>DIRS.find(([a,b])=>isWall(G,x+a,y+b))||[0,-1];
  const exitT=take(dead.shift()||open[open.length-1]);
  const ncard=f<3?1:f<7?2:3; const cards=[];
  const pool=dead.filter(t=>dm[t[1]*S+t[0]]>4);
  for(let i=0;i<ncard;i++){ const t=pool.length?pool.splice(Math.floor(R()*Math.min(pool.length,4+i*2)),1)[0]:open[Math.floor(R()*open.length)]; take(t);
    const [x,y]=t, d=closedDir(t); const tx=W2(x)+d[0]*1.05, tz=W2(y)+d[1]*1.05, ry=Math.atan2(-d[0],-d[1]);
    B.add('terminal',tx,0,tz,ry); const card=single('keycard'); card.position.set(tx-d[0]*0.15,1.55,tz-d[1]*0.15); group.add(card);
    cards.push({mesh:card,x:tx-d[0]*0.45,z:tz-d[1]*0.45,got:false}); }
  const [ex,ey]=exitT, ed=closedDir(exitT); const ery=Math.atan2(-ed[0],-ed[1]);
  const exitFrame=single('exitframe'); exitFrame.position.set(W2(ex)+ed[0]*1.3,0,W2(ey)+ed[1]*1.3); exitFrame.rotation.y=ery; group.add(exitFrame);
  const exitGate=single('exitgate'); exitGate.position.copy(exitFrame.position); exitGate.rotation.y=ery; group.add(exitGate);
  const exitLight=new THREE.PointLight(0x30ff70,4,7,1.8); exitLight.position.set(W2(ex)+ed[0]*0.7,2.3,W2(ey)+ed[1]*0.7); group.add(exitLight);
  const srcs=[], flares=[]; const addSrc=(x,y,z,c,i,d,kind)=>{ srcs.push({p:new THREE.Vector3(x,y,z),c:new THREE.Color(c),i,d,kind}); flares.push([x,y,z,c]); };
  const brokens=[], vents=[], shafts=[];
  open.forEach(([x,y])=>{ if(used.has(key([x,y])))return; const r=R(); if(r<0.11){ B.add('redlight',W2(x),0,W2(y),R()<.5?0:Math.PI/2); addSrc(W2(x),2.62,W2(y),Z.lamp,6,10,'red'); shafts.push([W2(x),W2(y)]); }
    else if(r<0.16){ B.add('tubelight',W2(x),0,W2(y),R()<.5?0:Math.PI/2); addSrc(W2(x),2.75,W2(y),0xffe0c0,4,9,'tube'); }
    else if(r<0.2){ B.add('brokenlight',W2(x),0,W2(y),R()*6); brokens.push({x:W2(x),z:W2(y),t:R()*3}); } });
  B.add('tubelight',W2(1),0,W2(1),0); addSrc(W2(1),2.75,W2(1),0xffe0c0,4,9,'tube');
  const doors=[]; open.forEach(([x,y])=>{ if(used.has(key([x,y]))||roomSet.has(key([x,y])))return; const hz=isWall(G,x,y-1)&&isWall(G,x,y+1)&&!isWall(G,x-1,y)&&!isWall(G,x+1,y); const vt=isWall(G,x-1,y)&&isWall(G,x+1,y)&&!isWall(G,x,y-1)&&!isWall(G,x,y+1);
    if((hz||vt)&&R()<0.07){ const ry=hz?Math.PI/2:0; B.add('doorframe',W2(x),0,W2(y),ry); const leaf=single('door'); leaf.position.set(W2(x),0,W2(y)); leaf.rotation.y=ry; group.add(leaf); doors.push({x,y,leaf,o:0,hz}); used.add(key([x,y]));} });
  const obst=[];
  for(const [cx,cy] of L.rooms){ if(Z.special==='reactor'&&R()<0.8){ B.add('reactor',W2(cx),0,W2(cy),0); obst.push([W2(cx),W2(cy),1.35]); addSrc(W2(cx),1.6,W2(cy),0xff7020,5,12,'reactor'); }
    else if(Z.special==='tank'){ for(const o of [[-0.8,0],[0.8,0]]){B.add('tank',W2(cx)+o[0],0,W2(cy)+o[1],0); obst.push([W2(cx)+o[0],W2(cy)+o[1],0.6]);} addSrc(W2(cx),1.4,W2(cy),0x30ff90,1.6,6,'tank'); }
    else if(Z.special==='cryo'){ const p=R()<0.5?'cryopod':'icepillar'; B.add(p,W2(cx),0,W2(cy),R()*6); obst.push([W2(cx),W2(cy),0.6]); B.add('icicles',W2(cx)+0.8,0,W2(cy)-0.6,R()*6); addSrc(W2(cx),2.2,W2(cy),0x40c8ff,1.4,6,'screen'); }
    else if(Z.special==='sewer'){ B.add('sewcol',W2(cx),0,W2(cy),0); obst.push([W2(cx),W2(cy),0.45]); }
    else { B.add('pillar',W2(cx),0,W2(cy),0); obst.push([W2(cx),W2(cy),0.45]); } used.add(key([cx,cy])); }
  const lockers=[], cams=[]; const shuffled=edges.slice().sort(()=>R()-0.5);
  let nLock=2+Math.floor(f/3), nCam=f>=2?Math.min(4,1+Math.floor((f-2)/3)):0; if(f===MAXF)nCam=3;
  for(const e of shuffled){ const [x,y,wx,wz,ry]=e; const k=key([x,y]); const [nx,nz]=nrm(ry); const inRoom=roomSet.has(k);
    if(used.has(k)){ if(R()<0.25)B.add(R()<0.5?'cables':'pipes',wx+nx*0.15,0,wz+nz*0.15,ry); continue; }
    const r=R();
    if(nCam>0&&!inRoom&&deg(x,y)>=3&&dm[y*S+x]>3){ nCam--; cams.push({x:wx+nx*0.15,z:wz+nz*0.15,ry}); used.add(k); continue; }
    if(nLock>0&&r<0.12&&dm[y*S+x]>2){ nLock--; B.add('locker',wx+nx*0.45,0,wz+nz*0.45,ry); lockers.push({x:wx+nx*0.45,z:wz+nz*0.45,px:wx+nx*1.15,pz:wz+nz*1.15,ry}); obst.push([wx+nx*0.45,wz+nz*0.45,0.45]); used.add(k); continue; }
    if(r<0.3){ const wp=Z.wallP[Math.floor(R()*Z.wallP.length)]; if(wp==='vent'){ B.add('vent',wx+nx*0.2,2.3,wz+nz*0.2,ry); vents.push({x:wx+nx*0.25,z:wz+nz*0.25,nx,nz,t:R()*4}); } else { B.add(wp,wx+nx*0.15,0,wz+nz*0.15,ry); if(wp==='sign')addSignText(group,ZONES.indexOf(Z),wx,wz,nx,nz,ry,R); } if(wp==='screen')addSrc(wx+nx*0.4,1.6,wz+nz*0.4,0x40b8ff,1.5,4,'screen'); }
    else if(r<0.5){ const list=inRoom?Z.floorP:Z.corrP; const pn=list[Math.floor(R()*list.length)]; const pr=PROPS[pn]; if(pr.room&&!inRoom&&deg(x,y)>1)continue;
      const off=0.15+pr.d/2; const px=wx+nx*off,pz=wz+nz*off; B.add(pn,px,0,pz,ry+(pn==='crate'||pn==='barrel'?R():0)); obst.push([px,pz,pr.r]);
      if(pn==='desk'){ B.add('chair',px+nx*0.75,0,pz+nz*0.75,ry+Math.PI+R()-.5); } if(pn==='barrel'&&R()<0.5){ const sx=Math.cos(ry)*0.75,sz=-Math.sin(ry)*0.75; B.add('barrel',px+sx,0,pz+sz,R()); obst.push([px+sx,pz+sz,0.38]); }
      if(pn==='rack'&&R()<0.4)addSrc(px+nx*0.6,1.2,pz+nz*0.6,0x3060ff,1.5,4,'screen'); used.add(k); }
    if(Z.clutter&&R()<0.12)B.add(Z.clutter,W2(x)+(R()-.5)*1.5,0,W2(y)+(R()-.5)*1.5,R()*6);
  }
  B.build(group);
  if(shafts.length){ const sg=new THREE.ConeGeometry(1.1,2.6,16,1,true); sg.translate(0,-1.3,0); const sm=beamMaterial(Z.lamp,0.09,2.6); const im=new THREE.InstancedMesh(sg,sm,shafts.length); const d=new THREE.Object3D(); shafts.forEach((s,i)=>{d.position.set(s[0],2.82,s[1]);d.updateMatrix();im.setMatrixAt(i,d.matrix);}); im.renderOrder=5; group.add(im); }
  if(flares.length){ const fg=new THREE.BufferGeometry(); const fp=new Float32Array(flares.length*3), fc=new Float32Array(flares.length*3); flares.forEach((q,i)=>{fp.set([q[0],q[1]-0.12,q[2]],i*3); const c=C(q[3]); fc.set([c.r*0.7,c.g*0.7,c.b*0.7],i*3);}); fg.setAttribute('position',new THREE.BufferAttribute(fp,3)); fg.setAttribute('color',new THREE.BufferAttribute(fc,3)); group.add(new THREE.Points(fg,flareMat)); }
  const coins=[], pick=[]; const cpool=open.filter(t=>!(t[0]<3&&t[1]<3));
  for(let i=0;i<8+f;i++){ const t=cpool[Math.floor(R()*cpool.length)]; const c=single('coin'); c.position.set(W2(t[0])+(R()-.5),0.9,W2(t[1])+(R()-.5)); group.add(c); coins.push(c); }
  for(let i=0;i<1+Math.floor(f/3);i++){ const t=cpool[Math.floor(R()*cpool.length)]; const m=single('battery'); m.position.set(W2(t[0])+(R()-.5),0.02,W2(t[1])+(R()-.5)); group.add(m); pick.push({m,type:'bat'}); }
  for(let i=0;i<2;i++){ const t=cpool[Math.floor(R()*cpool.length)]; const m=single('can'); m.position.set(W2(t[0])+(R()-.5),0.02,W2(t[1])+(R()-.5)); group.add(m); pick.push({m,type:'can'}); }
  const lp=[]; for(let i=0;i<[3,5,6][Q];i++){ const l=new THREE.PointLight(0xff2010,0,10,1.7); group.add(l); lp.push(l); }
  world={f,Z,G,S,group,open,srcs,lp,brokens,vents,lockers,exit:{x:W2(ex)+ed[0]*0.6,z:W2(ey)+ed[1]*0.6,gate:exitGate,open:0,opening:false},exitLight,cards,ncard,coins,pick,doors,obst,guards:[],dm,t:0,cans:[],alarm:0,rooms:L.rooms}; buildMech(world,used,R);
  const gpool=open.filter(t=>dm[t[1]*S+t[0]]>6); const rt=()=>gpool[Math.floor(R()*gpool.length)]||open[open.length-1];
  const nw=Math.min(6,1+Math.floor(f*0.5)); for(let i=0;i<nw;i++){ const t=rt(); spawnGuard('walker',t[0],t[1],f); }
  if(f>=5)for(let i=0;i<Math.min(3,1+Math.floor((f-5)/3));i++){ const t=rt(); spawnGuard('heavy',t[0],t[1],f); }
  if(f>=3)for(let i=0;i<Math.min(3,1+Math.floor((f-3)/3));i++){ const t=rt(); spawnGuard('drone',t[0],t[1],f); }
  for(const c of cams)spawnCam(c,f);
  if(BOSSF[f]){ const t=f===MAXF?[ex,ey]:rt(); spawnGuard(BOSSF[f],t[0],t[1],f); }
}
function guardModel(type){ const src=type==='walker'?GL.guard:GL.heavy; const m=SkeletonUtils.clone(src.scene); const mixer=new THREE.AnimationMixer(m); const acts={};
  for(const c of src.animations){ const a=mixer.clipAction(c); acts[c.name]=a; if(['alert','attack'].includes(c.name)){a.setLoop(THREE.LoopOnce);a.clampWhenFinished=true;} } return {m,mixer,acts}; }
function makeCone(){ const NR=18, cp=new Float32Array((NR+2)*3), idx=[]; for(let i=1;i<=NR;i++)idx.push(0,i+1,i); const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(cp,3)); g.setIndex(idx);
  const cone=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xffc040,transparent:true,opacity:0.07,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,side:THREE.DoubleSide})); cone.frustumCulled=false; cone.renderOrder=4; cone.NR=NR; world.group.add(cone); return cone; }
function spawnGuard(type,tx,ty,f){
  const g={type,tx,ty,home:[tx,ty],pos:new THREE.Vector3(W2(tx),0,W2(ty)),yaw:Math.random()*6.28,path:[],state:'patrol',meter:0,phase:Math.random()*6,stepT:0,look:0,lastSeen:null,timer:0,repath:0,coneT:0,cur:null,lastSaw:-99};
  if(type==='drone'){ g.m=GL.drone.scene.clone(true); g.rotors=[]; g.m.traverse(o=>{ if(/^rotor/.test(o.name))g.rotors.push(o); }); g.spd=1.9+f*0.05; g.cspd=3.2; g.y=2.3;
    g.beam=new THREE.Mesh(new THREE.ConeGeometry(1.3,2.6,16,1,true).translate(0,-1.3,0),beamMaterial(0xfff0c8,0.12,2.6)); g.beam.renderOrder=5; world.group.add(g.beam);
    g.spot=new THREE.Mesh(new THREE.CircleGeometry(1.25,24).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xfff0c0,transparent:true,opacity:0.18,blending:THREE.AdditiveBlending,depthWrite:false,fog:false})); g.spot.renderOrder=4; world.group.add(g.spot); }
  else { g.mdl=(type==='walker'||type==='stalker')?'walker':'heavy'; Object.assign(g,guardModel(g.mdl)); g.cone=makeCone();
    if(type==='walker'){ g.range=6.5+f*0.3; g.fov=0.62; g.spd=1.25+f*0.05; g.cspd=3.3+f*0.12; g.scale=1; }
    else if(type==='heavy'){ g.range=8.5+f*0.3; g.fov=0.55; g.spd=0.95; g.cspd=2.75+f*0.05; g.scale=1; }
    else { const B={warden:{r:11,fov:0.7,spd:2.2,cspd:3.4,sc:1.25,eye:0xff0000,tint:null},sentinel:{r:10,fov:0.66,spd:1.8,cspd:3.3,sc:1.2,eye:0x40e0ff,tint:0xa8d8ff},stalker:{r:9,fov:0.6,spd:2.4,cspd:3.9,sc:1.15,eye:0x60ff30,tint:0x708050}}[type];
      g.boss=true; g.range=B.r; g.fov=B.fov; g.spd=B.spd; g.cspd=B.cspd; g.scale=B.sc; g.eyeC=B.eye; g.m.scale.setScalar(B.sc); g.state='hunt';
      g.m.traverse(o=>{ if(!o.isMesh)return; o.material=o.material.clone(); if(o.material.name==='geye'){ o.material.emissive.setHex(B.eye); o.material.color.setHex(B.eye);} else if(B.tint)o.material.color.multiply(new THREE.Color(B.tint)); }); } }
  world.group.add(g.m); g.m.position.copy(g.pos); world.guards.push(g); return g;
}
function spawnCam(c,f){ const m=GL.secam.scene.clone(true); let head=null; m.traverse(o=>{ if(o.name==='camhead')head=o; }); m.position.set(c.x,2.75,c.z); m.rotation.y=c.ry; world.group.add(m);
  const g={type:'cam',m,head,pos:new THREE.Vector3(c.x,0,c.z),baseYaw:c.ry,yaw:c.ry,range:9+f*0.2,fov:0.42,meter:0,state:'watch',phase:Math.random()*6,coneT:0,cone:makeCone(),path:[],beepT:0}; world.guards.push(g); return g; }
// ---- zone mechanics (cryo lasers, sewer blackouts/water, core security doors) ----
const SIGNW={0:['SECTOR A','EXIT →','AUTHORIZED'],1:['SERVER','NO ACCESS','B-2'],2:['BIOHAZARD','LAB 3','QUARANTINE'],3:['MAINT','HIGH VOLT','PUMP 2'],4:['REACTOR','DANGER','RAD ZONE'],5:['CRYO','−40°C','STASIS'],6:['OUTFLOW','SEWER 4','NO ENTRY'],7:['CORE','LOCKDOWN','CONTROL']};
const signCache={};
function signMat(t,col){ const k=t+col; if(signCache[k])return signCache[k]; const c=document.createElement('canvas'); c.width=256; c.height=64; const x=c.getContext('2d'); x.fillStyle='#000'; x.fillRect(0,0,256,64); x.fillStyle=col; x.font='bold 34px monospace'; x.textAlign='center'; x.textBaseline='middle'; x.fillText(t,128,34); const tx=new THREE.CanvasTexture(c); tx.colorSpace=THREE.SRGBColorSpace; return signCache[k]=new THREE.MeshBasicMaterial({map:tx,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,fog:true}); }
const signGeo=new THREE.PlaneGeometry(0.9,0.225);
function addSignText(group,zi,wx,wz,nx,nz,ry,R){ const ws=SIGNW[zi]||SIGNW[0]; const t=ws[Math.floor(R()*ws.length)]; const col=zi===5?'#7fe0ff':zi===6?'#ffb040':zi===7?'#ff4060':'#ffd060'; const m=new THREE.Mesh(signGeo,signMat(t,col)); m.position.set(wx+nx*0.2,2.2,wz+nz*0.2); m.rotation.y=ry; group.add(m); }
const laserGeo=new THREE.CylinderGeometry(0.018,0.018,3.0,6); laserGeo.rotateX(Math.PI/2);
const laserMat=new THREE.MeshBasicMaterial({color:0xff1010,transparent:true,opacity:0.9,blending:THREE.AdditiveBlending,depthWrite:false});
function buildMech(w,used,R){ const {G,S,open,group,Z}=w; w.lasers=[]; w.sec=[]; w.bo=null; w.water=null; w.dark=0;
  const ZI=ZONES.indexOf(Z); const cand=open.filter(([x,y])=>!used.has(x+','+y)&&w.dm[y*S+x]>3&&x+y>4&&!(Math.abs(W2(x)-w.exit.x)<5&&Math.abs(W2(y)-w.exit.z)<5)).map(([x,y])=>{ const hz=isWall(G,x,y-1)&&isWall(G,x,y+1)&&!isWall(G,x-1,y)&&!isWall(G,x+1,y); const vt=isWall(G,x-1,y)&&isWall(G,x+1,y)&&!isWall(G,x,y-1)&&!isWall(G,x,y+1); return (hz||vt)?{x,y,hz}:null; }).filter(Boolean).sort(()=>R()-0.5);
  const takeSpread=(n)=>{ const out=[]; for(const c of cand){ if(out.length>=n)break; if(out.some(o=>Math.abs(o.x-c.x)+Math.abs(o.y-c.y)<4))continue; out.push(c); used.add(c.x+','+c.y); } return out; };
  if(Z.mech==='lasers'){ for(const c of takeSpread(Math.min(6,3+(w.f-11)))){ const cx=W2(c.x),cz=W2(c.y); const g=new THREE.Group(); g.position.set(cx,0,cz); if(c.hz)g.rotation.y=0; else g.rotation.y=Math.PI/2;
      for(const h of [0.35,0.95,1.6]){ const b=new THREE.Mesh(laserGeo,laserMat); b.position.y=h; b.renderOrder=6; g.add(b); }
      // emitters on both walls (corridor along x when hz → walls at z±1.5)
      for(const sgn of [-1,1]){ const e=single('laseremit'); if(c.hz){ e.position.set(cx,0,cz+sgn*1.5); e.rotation.y=sgn<0?0:Math.PI; } else { e.position.set(cx+sgn*1.5,0,cz); e.rotation.y=sgn<0?Math.PI/2:-Math.PI/2; } group.add(e); }
      group.add(g); w.lasers.push({x:cx,z:cz,hz:c.hz,g,ph:R()*4,on:true,cd:0}); } }
  if(Z.mech==='secdoors'){ for(const c of takeSpread(w.f===MAXF?5:4)){ const cx=W2(c.x),cz=W2(c.y); const leaf=single('secdoor'); leaf.position.set(cx,0,cz); leaf.rotation.y=c.hz?Math.PI/2:0; group.add(leaf); const fr=single('doorframe'); fr.position.set(cx,0,cz); fr.rotation.y=c.hz?Math.PI/2:0; group.add(fr); w.sec.push({x:c.x,y:c.y,hz:c.hz,leaf,o:1,ph:R()*9,sec:true}); } }
  if(Z.mech==='blackout'){ w.bo={t:10+R()*6,ph:0};
    const wm=new THREE.MeshStandardMaterial({color:0x1c2414,roughness:0.08,metalness:0.6,transparent:true,opacity:0.82}); const wg=new THREE.PlaneGeometry(S*T,S*T); wg.rotateX(-Math.PI/2); const wp=new THREE.Mesh(wg,wm); wp.position.set(S*T/2-T/2,0.05,S*T/2-T/2); group.add(wp); w.water=wp; w.dripT=0; }
  if(Z.special==='cryo'){ for(const c of cand.slice(0,14)){ if(used.has(c.x+','+c.y))continue; const m=single('icicles'); m.position.set(W2(c.x)+(R()-.5),0,W2(c.y)+(R()-.5)); m.rotation.y=R()*6; group.add(m); } }
}
function secAt(x,y){ for(const d of world.sec||[])if(d.x===x&&d.y===y)return d; return null; }
function secBlocked(x,z,r){ for(const d of world.sec||[]){ if(d.o>0.45)continue; const dx=W2(d.x),dz=W2(d.y); if(d.hz){ if(Math.abs(z-dz)<1.6&&Math.abs(x-dx)<0.15+r)return true; } else if(Math.abs(x-dx)<1.6&&Math.abs(z-dz)<0.15+r)return true; } return false; }
function mechTick(w,dt){ const P=player;
  for(const L of w.lasers){ const ph=(w.t+L.ph)%4; const on=ph<2.5; const warn=ph>3.6; L.g.visible=on||(warn&&Math.random()<0.5); L.cd-=dt;
    if(on&&state==='play'&&!P.hidden&&L.cd<=0){ const along=L.hz?P.pos.x-L.x:P.pos.z-L.z, across=L.hz?P.pos.z-L.z:P.pos.x-L.x; if(Math.abs(along)<0.22&&Math.abs(across)<1.5){ L.cd=2; raiseAlarm(P.pos.x,P.pos.z); P.shake=Math.max(P.shake,0.5); burstSparks(P.pos.x,1,P.pos.z,16,0xff3020,2.5); A.laser(); msg('LASER TRIPPED!',1.2); } } }
  for(const d of w.sec){ const ph=(w.t+d.ph)%9; let tgt=ph<5?1:ph<5.6?1-(ph-5)/0.6:ph<8.4?0:(ph-8.4)/0.6; const dx=W2(d.x),dz=W2(d.y); if(Math.hypot(P.pos.x-dx,P.pos.z-dz)<1.1&&d.o>0.3)tgt=Math.max(tgt,d.o); const prev=d.o; d.o=tgt; d.leaf.position.y=d.o*2.7;
    if(prev>0.95&&d.o<=0.95&&Math.hypot(P.pos.x-dx,P.pos.z-dz)<12){ A.door(); burstSparks(dx,2.7,dz,6,0xff4040,1.5); } if(prev>0.02&&d.o<=0.02&&Math.hypot(P.pos.x-dx,P.pos.z-dz)<12){ puff(dx,0.1,dz,6,0x606070,0.35); P.shake=Math.max(P.shake,0.15); } }
  if(w.bo){ const b=w.bo; b.t-=dt; if(b.ph===0&&b.t<=0){ b.ph=1; b.t=1.5; } else if(b.ph===1&&b.t<=0){ b.ph=2; b.t=5; A.power(true); msg('⚠ POWER FAILURE',2); } else if(b.ph===2&&b.t<=0){ b.ph=0; b.t=14+Math.random()*6; A.power(false); }
    w.dark=b.ph===2?1:b.ph===1?(Math.random()<0.5?1:0):0;
    if(w.water)w.water.position.y=0.05+Math.sin(w.t*0.8)*0.01;
    w.dripT-=dt; if(w.dripT<=0){ w.dripT=0.08+Math.random()*0.15; const x=P.pos.x+(Math.random()-.5)*12,z=P.pos.z+(Math.random()-.5)*12; if(!isWall(w.G,Math.round(x/T),Math.round(z/T))){ sparks.emit(x,2.95,z,0,-1,0,0.75,0.035,C(0x7090a0),-9.8); setTimeout(()=>{ if(world===w){ puff(x,0.08,z,2,0x506060,0.12); A.drip(Math.max(0,1-Math.hypot(x-P.pos.x,z-P.pos.z)/8)); } },700); } } }
  hemi.intensity=w.dark?0.12:1.15; if(w.dark)for(const l of w.lp)l.intensity*=0.04;
}
function doorAt(x,y){ const sd=secAt(x,y); if(sd)return sd; for(const d of world.doors)if(d.x===x&&d.y===y)return d; return null; }
function losClear(ax,az,bx,bz){ const dx=bx-ax,dz=bz-az,l=Math.hypot(dx,dz),n=Math.ceil(l/0.35); for(let i=1;i<n;i++){ const x=ax+dx*i/n,z=az+dz*i/n; const tx=Math.round(x/T),ty=Math.round(z/T); if(isWall(world.G,tx,ty))return false; const d=doorAt(tx,ty); if(d&&d.o<0.6)return false; } return true; }
function rayLen(ax,az,ang,max){ const dx=Math.sin(ang),dz=Math.cos(ang); for(let s=0.3;s<max;s+=0.3){ const x=ax+dx*s,z=az+dz*s; const tx=Math.round(x/T),ty=Math.round(z/T); if(isWall(world.G,tx,ty))return s; const d=doorAt(tx,ty); if(d&&d.o<0.6&&Math.abs(d.hz?x-W2(tx):z-W2(ty))<0.2)return s; } return max; }
function blocked(x,z,r){ if(secBlocked(x,z,r))return true; const tx=Math.round(x/T),ty=Math.round(z/T); for(let y=ty-1;y<=ty+1;y++)for(let xx=tx-1;xx<=tx+1;xx++){ if(!isWall(world.G,xx,y))continue; const cx=Math.max(W2(xx)-1.65,Math.min(x,W2(xx)+1.65)),cz=Math.max(W2(y)-1.65,Math.min(z,W2(y)+1.65)); if((x-cx)**2+(z-cz)**2<r*r)return true; }
  for(const o of world.obst)if((x-o[0])**2+(z-o[1])**2<(o[2]+r)**2)return true; return false; }
const show=id=>{ for(const p of ['title','shop','dead','win','paused'])$(p).classList.toggle('hide',p!==id); $('screen').classList.toggle('hide',!id); };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function glitch(fn){ const t=$('trans'); t.className='on'; A.static(0.35); await wait(460); await fn(); t.className='off'; await wait(460); t.className=''; }
let msgT=0; function msg(t,d=2){ $('msg').textContent=t; $('msg').style.opacity=1; msgT=d; }
function pop(id){ const e=$(id); e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); }
function hud(){ const w=world; $('floor').textContent='FLOOR '+w.f+' / '+MAXF; $('zone').textContent=zoneName(w.f); $('cards').innerHTML=Array.from({length:w.ncard},(_,i)=>`<div class="kc${i<player.cards?' on':''}"></div>`).join(''); $('coins').textContent='● '+(save.coins+player.coins); $('cans').textContent='CAN ×'+player.cans; }
function titleCard(f){ const c=$('card'); c.classList.add('hide'); void c.offsetWidth; c.innerHTML=`<div class="cf">FLOOR ${f}</div><div class="cz">— ${zoneName(f)} —</div><div class="co">${f===MAXF?'The Warden is awake. Grab 3 keycards and RUN.':'Find '+world.ncard+' keycard'+(world.ncard>1?'s':'')+' · Reach the exit'}</div>`; c.classList.remove('hide'); clearTimeout(titleCard.t); titleCard.t=setTimeout(()=>c.classList.add('hide'),3600); }
function renderShop(fromFloor){ $('scoins').textContent='● '+save.coins; const u=$('ups'); u.innerHTML='';
  for(const U of UPS){ const l=save.up[U.k], c=upCost(l); const d=document.createElement('div'); d.className='up'; d.innerHTML=`<div><b>${U.n}</b><small>${U.d}</small><div class="pips">${'■'.repeat(l)}${'□'.repeat(4-l)}</div></div>`;
    const b=document.createElement('button'); b.textContent=l>=4?'MAX':'● '+c; b.disabled=l>=4||save.coins<c; b.onclick=()=>{ save.coins-=c; save.up[U.k]++; persist(); A.coin(); renderShop(fromFloor); pop('scoins'); }; d.appendChild(b); u.appendChild(d); }
  $('nextFloor').classList.toggle('hide',!fromFloor); $('shopBack').classList.toggle('hide',!!fromFloor); $('shopTitle').textContent=fromFloor?'FLOOR CLEARED':'UPGRADES'; if(!fromFloor)$('stars').innerHTML=`<small>★ ${totalStars()} / ${MAXF*3} STARS</small>`; }
let menuCurve=null, menuU=0;
function title(){ state='title'; show('title'); $('hud').classList.add('hide'); $('touch').classList.add('hide'); $('locker').classList.remove('on'); $('alarm').classList.remove('on'); $('static').style.opacity=0; post.uniforms.uS.value=0; A.siren(false); A.buzz(0);
  $('best').textContent=(save.floor>1?`Continue from floor ${save.floor} · `:'')+`● ${save.coins} · ★ ${totalStars()}`; $('play').textContent=save.floor>1?'CONTINUE':'PLAY';
  if(TOUCH)$('helpDesk').textContent='Left stick move · drag right side to look · USE to hide in lockers';
  buildFloor(Math.max(3,save.floor)); const w=world; const far=w.open.slice().sort((a,b)=>w.dm[b[1]*w.S+b[0]]-w.dm[a[1]*w.S+a[0]])[0]; const path=[[1,1],...(bfs(w.G,1,1,far[0],far[1])||[])].slice(0,22);
  menuCurve=new THREE.CatmullRomCurve3(path.map(([x,y])=>new THREE.Vector3(W2(x),1.6,W2(y))),false,'catmullrom',0.3); menuU=0; player.inv=1e9; player.light=true; player.hidden=null; }
function startFloor(f){
  buildFloor(f); Object.assign(player,{pitch:0,bat:1,sta:1,light:true,inv:2.5,revived:false,cards:0,coins:0,cans:2+save.up.cans,hidden:null,time:0,spotted:0,shake:0}); player.pos.set(W2(1),1.6,W2(1));
  player.yaw=!isWall(world.G,2,1)?-Math.PI/2:Math.PI; $('bLight').classList.add('on'); $('locker').classList.remove('on'); $('static').style.opacity=0; post.uniforms.uS.value=0;
  state='play'; show(null); $('hud').classList.remove('hide'); $('touch').classList.toggle('hide',!TOUCH); hud(); try{ renderer.compile(scene,camera); }catch(e){} titleCard(f);
  SDK.gameplayStart(); lockPointer(); msgT=0; $('msg').style.opacity=0;
}
function lockPointer(){ if(!TOUCH&&canvas.requestPointerLock){ try{const p=canvas.requestPointerLock(); if(p&&p.catch)p.catch(()=>{});}catch(e){} } }
function caught(g){ if(state!=='play')return; state='caught'; A.caught(); A.static(1.6); SDK.gameplayStop(); world.catcher=g; world.caughtT=0; g.state='attack'; if(g.acts)playAnim(g,'attack',0.1); player.shake=1;
  if(player.hidden){ player.hidden=null; $('locker').classList.remove('on'); }
  setTimeout(()=>{ if(state!=='caught')return; if(document.pointerLockElement)document.exitPointerLock(); glitch(()=>{ show('dead'); $('static').style.opacity=0; post.uniforms.uS.value=0; $('hud').classList.add('hide'); $('touch').classList.add('hide'); $('alarm').classList.remove('on'); A.siren(false); A.buzz(0); $('deadInfo').textContent=`Floor ${world.f} — ${zoneName(world.f)} · ● ${player.coins} this floor`; $('revive').classList.toggle('hide',player.revived); }); },1700); }
const starsFor=()=>[1, player.spotted===0?1:0, player.time<60+world.f*20?1:0];
async function floorDone(){ state='done'; const w=world; A.gate(); w.exit.opening=true; SDK.gameplayStop(); SDK.happytime(); if(document.pointerLockElement)document.exitPointerLock();
  const st=starsFor(), ns=st.reduce((a,b)=>a+b,0); save.stars[w.f]=Math.max(save.stars[w.f]||0,ns);
  const bonus=20+w.f*5+ns*10; save.coins+=player.coins+bonus; run.time+=player.time; run.spotted+=player.spotted; run.coins+=player.coins+bonus; run.floors++;
  save.floor=Math.min(MAXF,w.f+1); save.best=Math.max(save.best,w.f); persist();
  await wait(1300); $('hud').classList.add('hide'); $('touch').classList.add('hide'); $('alarm').classList.remove('on'); A.siren(false); A.buzz(0);
  await glitch(()=>{ if(w.f>=MAXF){ show('win'); const tm=Math.round(run.time); $('winStats').innerHTML=`<span>Floors cleared</span><b data-n="${run.floors}">0</b><span>Total time</span><b>${Math.floor(tm/60)}:${String(tm%60).padStart(2,'0')}</b><span>Stars</span><b data-n="${totalStars()}">0</b><span>Coins earned</span><b data-n="${run.coins}">0</b><span>Times spotted</span><b data-n="${run.spotted}">0</b>`; countUp($('winStats')); save.floor=1; persist(); A.win(); }
    else { renderShop(true); show('shop'); $('scoins').textContent='● '+save.coins+'  (+'+(player.coins+bonus)+')';
      $('stars').innerHTML='<span>★</span><span>★</span><span>★</span>'+`<small>ESCAPED · ${player.spotted?'SPOTTED '+player.spotted+'×':'UNSEEN'} · ${Math.floor(player.time)}s / ${60+w.f*20}s</small>`;
      st.forEach((v,i)=>{ if(v)setTimeout(()=>{ $('stars').children[i].classList.add('on'); A.star(i); },400+i*350); }); } }); }
function countUp(el){ el.querySelectorAll('b[data-n]').forEach(b=>{ const n=+b.dataset.n; let t=0; const iv=setInterval(()=>{ t+=0.05; b.textContent=Math.round(n*Math.min(1,t)); if(t>=1)clearInterval(iv); },30); }); }
async function elevatorTo(f){ const e=$('elev'); e.classList.remove('hide'); await wait(30); e.classList.add('closed'); A.creak(); await wait(700); e.classList.add('shake'); A.hum(2.2);
  show(null); $('enum').textContent=f-1; const adP=SDK.midgame(); for(let i=0;i<6;i++){ await wait(220); if(i===3)$('enum').textContent=f; }
  await adP; startFloor(f); e.classList.remove('shake'); A.ding(); await wait(500); e.classList.remove('closed'); await wait(750); e.classList.add('hide'); }
SDK.setAdHooks({onStart(){A.adMute(true);},onEnd(){A.adMute(false);}});
$('play').onclick=()=>{ A.init(); run.time=run.spotted=run.coins=run.floors=0; glitch(()=>startFloor(save.floor)); };
$('shopBtn').onclick=()=>{ A.init(); renderShop(false); show('shop'); };
$('shopBack').onclick=()=>title();
$('nextFloor').onclick=async()=>{ $('nextFloor').disabled=true; await elevatorTo(save.floor); $('nextFloor').disabled=false; };
$('retry').onclick=()=>glitch(()=>startFloor(world.f));
$('menu').onclick=()=>glitch(()=>title()); $('winMenu').onclick=()=>glitch(()=>title());
$('revive').onclick=async()=>{ const r=await SDK.rewarded(); if(r==='ok'||r===true){ revive(); } else { $('revive').textContent='AD UNAVAILABLE'; setTimeout(()=>$('revive').textContent='▶ CONTINUE (AD)',1500);} };
function revive(){ player.revived=true; player.inv=4; player.pos.set(W2(1),1.6,W2(1)); for(const g of world.guards){ if(g.type==='cam'){g.meter=0;continue;} g.state=g.boss?'hunt':'patrol'; g.meter=0; g.path=[]; g.sawHide=false; g.pos.set(W2(g.home[0]),0,W2(g.home[1])); }
  state='play'; show(null); $('hud').classList.remove('hide'); $('touch').classList.toggle('hide',!TOUCH); SDK.gameplayStart(); lockPointer(); msg('SECOND CHANCE',1.5); }
$('pause').onclick=()=>pause(); $('resume').onclick=()=>{ state='play'; show(null); SDK.gameplayStart(); lockPointer(); }; $('quit').onclick=()=>glitch(()=>title());
$('mute').onclick=()=>{ $('mute').textContent=A.toggle()?'🔇':'🔊'; };
function pause(){ if(state!=='play')return; state='paused'; show('paused'); SDK.gameplayStop(); A.siren(false); A.buzz(0); }
document.addEventListener('pointerlockchange',()=>{ if(!document.pointerLockElement&&state==='play'&&!TOUCH)pause(); });
addEventListener('keydown',e=>{ keys[e.code]=true; if(state!=='play')return; if(e.code==='KeyF')toggleLight(); if(e.code==='KeyE')inp.use=true; if(e.code==='KeyG'||e.code==='KeyQ')inp.throw=true; if(e.code==='Escape'||e.code==='KeyP')pause(); });
addEventListener('keyup',e=>{keys[e.code]=false;});
canvas.addEventListener('mousedown',e=>{ if(state==='play'&&e.button===2)inp.throw=true; }); canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('click',()=>{ if(state==='play'&&!TOUCH&&!document.pointerLockElement)lockPointer(); });
addEventListener('mousemove',e=>{ if(state==='play'&&document.pointerLockElement){ player.yaw-=e.movementX*0.0022; player.pitch=Math.max(-1.3,Math.min(1.3,player.pitch-e.movementY*0.0022)); } });
function toggleLight(){ if(player.bat<=0.02&&!player.light)return; player.light=!player.light; A.click(); $('bLight').classList.toggle('on',player.light); }
const stick={id:null,x:0,y:0,cx:0,cy:0}, look={id:null,x:0,y:0}; const sEl=$('stick'), kEl=$('knob');
addEventListener('touchstart',e=>{ if(state!=='play')return; for(const t of e.changedTouches){ if(t.target.closest&&t.target.closest('button'))continue; if(t.clientX<innerWidth*0.45&&stick.id===null){ const r=sEl.getBoundingClientRect(); stick.id=t.identifier; stick.cx=r.left+r.width/2; stick.cy=r.top+r.height/2; moveStick(t);} else if(look.id===null){look.id=t.identifier;look.x=t.clientX;look.y=t.clientY;} } },{passive:false});
function moveStick(t){ let dx=t.clientX-stick.cx,dy=t.clientY-stick.cy; const l=Math.hypot(dx,dy),m=55; if(l>m){dx*=m/l;dy*=m/l;} stick.x=dx/m; stick.y=dy/m; kEl.style.transform=`translate(${dx}px,${dy}px)`; }
addEventListener('touchmove',e=>{ if(state==='play')e.preventDefault(); for(const t of e.changedTouches){ if(t.identifier===stick.id)moveStick(t); else if(t.identifier===look.id){ player.yaw-=(t.clientX-look.x)*0.006; player.pitch=Math.max(-1.2,Math.min(1.2,player.pitch-(t.clientY-look.y)*0.005)); look.x=t.clientX; look.y=t.clientY; } } },{passive:false});
addEventListener('touchend',e=>{ for(const t of e.changedTouches){ if(t.identifier===stick.id){stick.id=null;stick.x=stick.y=0;kEl.style.transform='';} if(t.identifier===look.id)look.id=null; } });
addEventListener('touchcancel',()=>{stick.id=null;stick.x=stick.y=0;look.id=null;kEl.style.transform='';});
const tb=(id,down)=>{ const b=$(id); b.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();down();},{passive:false}); b.addEventListener('mousedown',down); };
tb('bLight',()=>toggleLight()); tb('bUse',()=>{inp.use=true;}); tb('bThrow',()=>{inp.throw=true;}); tb('bRun',()=>{inp.run=!inp.run; $('bRun').classList.toggle('on',inp.run);});
const tmp=new THREE.Vector3();
let heat=0, flick=0, flickT=0, dangerV=0;
function noiseEvent(x,z,radius){ for(const g of world.guards){ if(g.type==='cam'||g.type==='drone')continue; if(['chase','attack','alert'].includes(g.state))continue; if(Math.hypot(g.pos.x-x,g.pos.z-z)<radius){ g.state='sus'; g.lastSeen=new THREE.Vector3(x,0,z); g.path=[]; g.timer=7; } } }
function raiseAlarm(x,z){ const w=world; if(w.alarm<=0){ player.spotted++; A.alert(); msg('ALARM!',1.2); } w.alarm=Math.max(w.alarm,8); for(const g of w.guards){ if(g.type==='cam'||g.type==='drone')continue; if(['patrol','search','sus'].includes(g.state)){ g.state='sus'; g.lastSeen=new THREE.Vector3(x,0,z); g.path=[]; g.timer=8; } } }
function throwCan(){ const P=player; if(P.cans<=0||P.hidden){ A.denied(); return; } P.cans--; hud(); pop('cans'); const m=single('can'); world.group.add(m); const dir=new THREE.Vector3(); camera.getWorldDirection(dir);
  world.cans.push({m,p:camera.position.clone().addScaledVector(dir,0.4),v:dir.multiplyScalar(11).add(new THREE.Vector3(0,3,0)),b:0,life:5}); A.click(); }
const solidAt=(x,z)=>{ const tx=Math.round(x/T),ty=Math.round(z/T); if(isWall(world.G,tx,ty))return true; const d=doorAt(tx,ty); return d&&d.o<0.6&&Math.abs(d.hz?x-W2(tx):z-W2(ty))<0.2; };
function updateCans(dt){ for(let i=world.cans.length-1;i>=0;i--){ const c=world.cans[i]; c.life-=dt; if(c.life<=0){ world.cans.splice(i,1); continue; } if(c.rest)continue;
    c.v.y-=12*dt; const nx=c.p.x+c.v.x*dt, nz=c.p.z+c.v.z*dt;
    if(solidAt(nx,c.p.z)){ c.v.x*=-0.4; bounce(c); } else c.p.x=nx; if(solidAt(c.p.x,nz)){ c.v.z*=-0.4; bounce(c); } else c.p.z=nz;
    c.p.y+=c.v.y*dt; if(c.p.y>2.9){ c.p.y=2.9; c.v.y=-Math.abs(c.v.y)*0.4; } if(c.p.y<0.05){ c.p.y=0.05; if(Math.abs(c.v.y)>1.5){ c.v.y*=-0.4; c.v.x*=0.6; c.v.z*=0.6; bounce(c);} else { c.v.set(0,0,0); c.rest=true; c.m.rotation.set(Math.PI/2,0,Math.random()*6); } }
    c.m.position.copy(c.p); if(!c.rest)c.m.rotation.x+=dt*12; } }
function bounce(c){ c.b++; const d=c.p.distanceTo(camera.position); A.clang(Math.max(0.15,1-d/20)); puff(c.p.x,0.1,c.p.z,4,0x6a6058,0.2); burstSparks(c.p.x,c.p.y,c.p.z,4,0xffd080,1.5); if(c.b===1){ noiseEvent(c.p.x,c.p.z,11); msg('*CLANG*',0.8); } }
function playAnim(g,name,fade=0.25){ if(!g.acts||g.cur===name)return; const a=g.acts[name]; if(!a)return; const prev=g.cur&&g.acts[g.cur]; a.reset().setEffectiveWeight(1).play(); if(prev)prev.crossFadeTo(a,fade,false); g.cur=name; }
function assignLights(w,pos){ const s=w.srcs.slice().sort((a,b)=>a.p.distanceToSquared(pos)-b.p.distanceToSquared(pos)); w.lp.forEach((l,i)=>{ const q=s[i]; l.userData.s=q; if(q){ l.position.copy(q.p); l.color.copy(q.c); l.distance=q.d; } }); }
function lightTick(w,dt){ const al=w.alarm>0; const pulse=0.55+0.45*Math.sin(w.t*(al?7:3.1));
  for(const l of w.lp){ const q=l.userData.s; if(!q){l.intensity=0;continue;} let I=q.i; if(q.kind==='red')I*=(0.6+0.4*pulse)*(al?1.6:1); else if(q.kind==='tube')I*=Math.random()<0.07?0.1:1; else if(q.kind==='screen')I*=0.8+Math.random()*0.3; else if(q.kind==='reactor')I*=0.8+0.2*Math.sin(w.t*2); l.intensity=I; }
  if(MAT.wscreen)MAT.wscreen.emissiveIntensity=Math.random()<0.05?0.4:2.2+Math.sin(w.t*30)*0.3; if(MAT.redlamp)MAT.redlamp.emissiveIntensity=4+4*pulse; w.exitLight.intensity=3+Math.sin(w.t*4);
  for(const b of w.brokens){ b.t-=dt; if(b.t<=0){ b.t=0.6+Math.random()*3; const d=Math.hypot(b.x-player.pos.x,b.z-player.pos.z); if(d<16){ burstSparks(b.x+0.45,2.65,b.z,10+Math.random()*10,0xffc070,2.5); if(state==='play')A.zap(Math.max(0,1-d/14)*0.8); } } }
  for(const v of w.vents){ const d=Math.hypot(v.x-player.pos.x,v.z-player.pos.z); if(d>15)continue; v.t-=dt; if(v.t<-2.5)v.t=3+Math.random()*4; if(v.t<0&&Math.random()<0.6){ smoke.emit(v.x,2.3,v.z,v.nx*1.4+(Math.random()-.5)*0.3,-0.2+Math.random()*0.3,v.nz*1.4+(Math.random()-.5)*0.3,1.6,0.3,C(0x9a9a98),0,3); if(state==='play'&&Math.random()<0.02)A.hiss(Math.max(0,1-d/12)*0.6); } }
  if(w.exit.opening){ w.exit.open=Math.min(1,w.exit.open+dt*0.9); w.exit.gate.position.y=w.exit.open*2.6; if(Math.random()<0.4)burstSparks(w.exit.gate.position.x,2.7,w.exit.gate.position.z,3,0xa0ffc0,2); } mechTick(w,dt); }
function update(dt){
  const w=world; w.t+=dt; const P=player; P.time+=dt;
  let mx=0,mz=0; if(keys.KeyW||keys.ArrowUp)mz-=1; if(keys.KeyS||keys.ArrowDown)mz+=1; if(keys.KeyA||keys.ArrowLeft)mx-=1; if(keys.KeyD||keys.ArrowRight)mx+=1;
  mx+=stick.x; mz+=stick.y; const ml=Math.hypot(mx,mz); if(ml>1){mx/=ml;mz/=ml;}
  let moving=false, running=false;
  if(P.hidden){ if(inp.use){ const lk=P.hidden; P.hidden=null; $('locker').classList.remove('on'); P.pos.set(lk.px,1.6,lk.pz); A.creak(); inp.use=false; } }
  else {
    const wantRun=(keys.ShiftLeft||keys.ShiftRight||inp.run)&&ml>0.3; const staMax=4+save.up.sta*1.6; running=wantRun&&P.sta>0.02;
    P.sta=Math.max(0,Math.min(1,P.sta+(running?-dt/staMax:dt/(staMax*1.4)))); if(P.sta<=0.02&&inp.run){ inp.run=false; $('bRun').classList.remove('on'); }
    const spd=(running?5.0:2.7)*(1+save.up.shoes*0.07); const s=Math.sin(P.yaw),c=Math.cos(P.yaw);
    const vx=(mx*c+mz*s)*spd, vz=(-mx*s+mz*c)*spd;
    if(!blocked(P.pos.x+vx*dt,P.pos.z,0.3))P.pos.x+=vx*dt; if(!blocked(P.pos.x,P.pos.z+vz*dt,0.3))P.pos.z+=vz*dt;
    moving=ml>0.1; if(moving){ P.bob+=dt*spd*2.2; P.stepT-=dt*spd; if(P.stepT<=0){ P.stepT=1.6; A.step(running,1-save.up.quiet*0.15); if(running)puff(P.pos.x,0.05,P.pos.z,2,0x5a5048,0.18); } }
  }
  const noise=moving?(running?7.5:2.6)*(1-save.up.quiet*0.17):0;
  const batMax=50+save.up.bat*28; if(P.light&&!P.hidden){ P.bat=Math.max(0,P.bat-dt/batMax); if(P.bat<=0){P.light=false;$('bLight').classList.remove('on');msg('BATTERY DEAD',1.5);} } else P.bat=Math.min(1,P.bat+dt/(batMax*2.5));
  P.shake=Math.max(0,P.shake-dt*1.8); const sh=P.shake*P.shake*0.08;
  camera.position.set(P.pos.x+(Math.random()-.5)*sh,1.6+Math.sin(P.bob)*0.045*(moving?1:0)*(running?1.6:1)+(Math.random()-.5)*sh,P.pos.z+(Math.random()-.5)*sh);
  camera.rotation.set(P.pitch+(Math.random()-.5)*sh*0.5,P.yaw,Math.sin(P.bob*0.5)*0.01*(running?2:1));
  if(viewModel){ viewModel.visible=!P.hidden; viewModel.position.set(0.24+Math.sin(P.bob*0.5)*0.012*(moving?1:0),-0.24+Math.abs(Math.cos(P.bob*0.5))*0.012*(moving?1:0),-0.42); }
  flickT-=dt; if(flickT<=0){ flickT=0.05+Math.random()*(P.bat<0.25?0.4:Math.max(0.3,3-heat*2.5)); flick=Math.random()<(0.12+heat*0.4+(P.bat<0.25?0.4:0))?Math.random()*0.8:0; if(flick>0.3&&P.light)A.flicker(); }
  const li=(P.light&&!P.hidden)?(1-flick)*(0.55+0.45*Math.min(1,P.bat*3)):0; const lens=1+save.up.lens*0.15; const near=Math.max(0.35,Math.min(1,rayLen(P.pos.x,P.pos.z,P.yaw+Math.PI,3)/2.5)); flash.intensity=FL_I*li*lens*near; flash.distance=24*lens; beamMat.uniforms.uI.value=0.06*li; dustMat.uniforms.uOn.value=li; if(lensMat)lensMat.emissiveIntensity=li*0.35;
  P.inv=Math.max(0,P.inv-dt);
  if(Math.floor(w.t*2.5)!==Math.floor((w.t-dt)*2.5))assignLights(w,P.pos);
  lightTick(w,dt);
  for(const d of w.doors){ const dx=W2(d.x),dz=W2(d.y); let near=Math.hypot(P.pos.x-dx,P.pos.z-dz)<3; for(const g of w.guards)if(g.type!=='cam'&&Math.hypot(g.pos.x-dx,g.pos.z-dz)<2.6)near=true; const prev=d.o; d.o+=((near?1:0)-d.o)*Math.min(1,dt*4);
    if(prev<0.1&&d.o>=0.1&&Math.hypot(P.pos.x-dx,P.pos.z-dz)<10){ A.door(); puff(dx,0.1,dz,5,0x707070,0.3); burstSparks(dx,2.5,dz,6,0xffd090,1.5); } const off=d.o*2.35; if(d.hz)d.leaf.position.set(dx,0,dz+off); else d.leaf.position.set(dx+off,0,dz); }
  for(let i=w.coins.length-1;i>=0;i--){ const cn=w.coins[i]; cn.rotation.y+=dt*2.5; cn.position.y=0.9+Math.sin(w.t*2+i)*0.08; if(Math.hypot(cn.position.x-P.pos.x,cn.position.z-P.pos.z)<0.9){ w.group.remove(cn); w.coins.splice(i,1); P.coins+=5; A.coin(); burstSparks(cn.position.x,0.9,cn.position.z,8,0xffd040,1.2); hud(); pop('coins'); } }
  for(let i=w.pick.length-1;i>=0;i--){ const k=w.pick[i]; k.m.rotation.y+=dt; if(Math.hypot(k.m.position.x-P.pos.x,k.m.position.z-P.pos.z)<0.9){ if(k.type==='can'&&P.cans>=2+save.up.cans)continue; w.group.remove(k.m); w.pick.splice(i,1); if(k.type==='bat'){ P.bat=Math.min(1,P.bat+0.45); msg('+BATTERY',1); } else { P.cans++; msg('+CAN',1); hud(); pop('cans'); } A.pick(); } }
  let prompt=''; const U=TOUCH?'USE':'[E]';
  for(const cd of w.cards){ if(cd.got)continue; cd.mesh.position.y=1.55+Math.sin(w.t*2.5)*0.05; cd.mesh.rotation.y+=dt; if(Math.hypot(cd.x-P.pos.x,cd.z-P.pos.z)<1.6&&!P.hidden){ prompt=U+' TAKE KEYCARD'; if(inp.use){ cd.got=true; inp.use=false; w.group.remove(cd.mesh); P.cards++; A.pick(); burstSparks(cd.mesh.position.x,1.55,cd.mesh.position.z,40,0xffc030,3); const gf=$('goldflash'); gf.style.transition='none'; gf.style.opacity=1; requestAnimationFrame(()=>{gf.style.transition='opacity .6s';gf.style.opacity=0;}); hud(); msg(P.cards>=w.ncard?'EXIT UNLOCKED':'KEYCARD '+P.cards+'/'+w.ncard,1.6); } } }
  if(!P.hidden&&!prompt)for(const lk of w.lockers){ if(Math.hypot(lk.px-P.pos.x,lk.pz-P.pos.z)<1.2){ prompt=U+' HIDE IN LOCKER'; if(inp.use){ inp.use=false; P.hidden=lk; $('locker').classList.add('on'); A.creak(); P.pos.set(lk.x+Math.sin(lk.ry)*0.05,1.6,lk.z+Math.cos(lk.ry)*0.05); P.yaw=lk.ry+Math.PI; P.pitch=0; for(const g of w.guards){ if(g.state==='chase'&&w.t-g.lastSaw<1.0&&g.pos.distanceTo(tmp.set(P.pos.x,0,P.pos.z))<7)g.sawHide=true; } } break; } }
  if(P.hidden)prompt=U+' LEAVE LOCKER';
  if(!P.hidden&&Math.hypot(w.exit.x-P.pos.x,w.exit.z-P.pos.z)<1.8&&!w.exit.opening){ if(P.cards>=w.ncard){ prompt=U+' OPEN EXIT'; if(inp.use){ floorDone(); } } else { prompt='LOCKED · NEED '+(w.ncard-P.cards)+' KEYCARD'+(w.ncard-P.cards>1?'S':''); if(inp.use)A.denied(); } }
  if(inp.throw)throwCan(); inp.use=false; inp.throw=false; $('prompt').textContent=prompt; $('prompt').style.opacity=prompt?1:0;
  updateCans(dt);
  let maxMeter=0,nearD=99,chasing=false,droneD=99;
  for(const g of w.guards){ if(state!=='play')break; if(g.type==='cam')updateCam(g,dt); else if(g.type==='drone'){ updateDrone(g,dt); droneD=Math.min(droneD,Math.hypot(P.pos.x-g.pos.x,P.pos.z-g.pos.z)); } else { updateGuard(g,dt,noise); nearD=Math.min(nearD,Math.hypot(P.pos.x-g.pos.x,P.pos.z-g.pos.z)); }
    maxMeter=Math.max(maxMeter,g.meter||0); if(g.state==='chase'||g.state==='alert')chasing=true; }
  if(state!=='play')return;
  A.buzz(Math.max(0,1-droneD/12));
  w.alarm=Math.max(0,w.alarm-dt); $('alarm').classList.toggle('on',w.alarm>0||chasing); $('alarmTxt').classList.toggle('on',w.alarm>0); A.siren(w.alarm>0);
  heat=Math.max(chasing?1:0,Math.max(0,1-nearD/12)*0.7,maxMeter*0.8,w.alarm>0?0.5:0);
  A.heart(dt,heat); dangerV+=((chasing?0.5+0.25*Math.sin(w.t*8):maxMeter*0.4)-dangerV)*Math.min(1,dt*5); $('danger').style.opacity=dangerV;
  $('eye').style.opacity=maxMeter>0.02||chasing?1:0; if($('eye').firstElementChild)$('eye').firstElementChild.style.width=(chasing?100:maxMeter*100)+'%';
  $('bat').style.width=(P.bat*100)+'%'; $('sta').style.width=(P.sta*100)+'%'; const tm=Math.floor(P.time); $('time').textContent=Math.floor(tm/60)+':'+String(tm%60).padStart(2,'0');
  post.uniforms.uD.value=Math.min(1.2,heat*0.8+maxMeter*0.5);
  if(w.exit.opening)P.shake=Math.max(P.shake,0.25);
}
function percept(ex,ez,range,fov,yaw){ const P=player; if(P.inv>0||P.hidden)return false; const dx=P.pos.x-ex,dz=P.pos.z-ez,dist=Math.hypot(dx,dz); let ang=Math.atan2(dx,dz)-yaw; ang=Math.atan2(Math.sin(ang),Math.cos(ang)); return dist<range&&Math.abs(ang)<fov&&losClear(ex,ez,P.pos.x,P.pos.z); }
function drawCone(g,ox,oz,yaw,range,fov,dt){ g.coneT-=dt; const d=Math.hypot(ox-player.pos.x,oz-player.pos.z); if(d>26){g.cone.visible=false;return;} if(g.coneT>0)return; g.coneT=0.06; g.cone.visible=true;
  const a=g.cone.geometry.attributes.position, arr=a.array; arr[0]=ox; arr[1]=0.04; arr[2]=oz; for(let i=0;i<=g.cone.NR;i++){ const an=yaw-fov+2*fov*i/g.cone.NR; const l=rayLen(ox,oz,an,range); arr[(i+1)*3]=ox+Math.sin(an)*l; arr[(i+1)*3+1]=0.04; arr[(i+1)*3+2]=oz+Math.cos(an)*l; } a.needsUpdate=true; }
function updateGuard(g,dt,noise){
  const w=world,P=player,G=w.G; const pp=new THREE.Vector3(P.pos.x,0,P.pos.z); const dist=Math.hypot(pp.x-g.pos.x,pp.z-g.pos.z);
  if(g.state==='attack'){ g.mixer.update(dt); return; }
  const range=(world.dark?0.6:1)*g.range*(P.light?1.25:0.7)*(g.state==='chase'||g.state==='hunt'?1.4:1)*(w.alarm>0&&w.f<MAXF?1.15:1);
  const see=percept(g.pos.x,g.pos.z,range,g.fov,g.yaw+(g.headYaw||0));
  const hear=P.inv<=0&&!P.hidden&&dist<noise*(g.type==='heavy'?0.8:1)&&g.state!=='chase';
  if(see){ g.meter=Math.min(1,g.meter+dt*(1.0+2.5*(1-dist/range))*(P.light?1.3:0.9)*(g.boss?2:1)); g.lastSeen=pp.clone(); g.lastSaw=w.t; }
  else g.meter=Math.max(0,g.meter-dt*(g.state==='chase'?0.12:0.25));
  if(hear&&(g.state==='patrol'||g.state==='search'||g.state==='hunt')){ g.state='sus'; g.lastSeen=pp.clone(); g.timer=4; g.path=[]; A.sus(); }
  if(g.state!=='chase'&&g.state!=='alert'&&g.meter>=1){ g.state='alert'; g.timer=0.7; playAnim(g,'alert',0.1); A.alert(); P.spotted++; P.shake=Math.max(P.shake,0.5); msg('SPOTTED!',1); }
  else if((g.state==='patrol'||g.state==='hunt')&&g.meter>0.35){ g.state='sus'; g.timer=4; g.path=[]; A.sus(); }
  if(g.state==='chase'&&g.meter<=0.25&&!g.sawHide){ g.state='search'; g.timer=6; g.path=[]; }
  if(P.hidden&&g.state==='chase'&&!g.sawHide){ g.state='search'; g.timer=6; g.path=[]; g.meter=0.3; }
  const gtx=Math.round(g.pos.x/T),gty=Math.round(g.pos.z/T); let speed=g.spd, look=null, anim='walk';
  if(g.state==='alert'){ g.timer-=dt; speed=0; const tgt=Math.atan2(pp.x-g.pos.x,pp.z-g.pos.z); g.yaw+=Math.atan2(Math.sin(tgt-g.yaw),Math.cos(tgt-g.yaw))*Math.min(1,dt*6); if(g.timer<=0){ g.state='chase'; g.repath=0; } anim='alert'; }
  else if(g.state==='chase'){ speed=g.cspd; anim='run'; g.repath-=dt; const tgtP=g.sawHide&&P.hidden?new THREE.Vector3(P.hidden.px,0,P.hidden.pz):(see?pp:(g.lastSeen||pp));
    if(g.repath<=0||!g.path.length){ g.repath=0.4; g.path=bfs(G,gtx,gty,Math.round(tgtP.x/T),Math.round(tgtP.z/T))||[]; }
    if(see&&dist<3.2){ g.path=[]; look=pp; }
    if(g.sawHide&&P.hidden&&Math.hypot(P.hidden.px-g.pos.x,P.hidden.pz-g.pos.z)<1.4){ msg('PULLED OUT!',1.5); caught(g); return; }
    if(!P.hidden&&dist<1.05*(g.scale||1)&&P.inv<=0&&see){ caught(g); return; } }
  else if(g.state==='hunt'){ speed=g.spd; g.repath-=dt; if(g.repath<=0||!g.path.length){ g.repath=1.2; const t=P.hidden?{x:P.hidden.px+(Math.random()-.5)*12,z:P.hidden.pz+(Math.random()-.5)*12}:P.pos; g.path=bfs(G,gtx,gty,Math.round(t.x/T),Math.round(t.z/T))||[]; } }
  else if(g.state==='sus'||g.state==='search'){ speed=g.spd*1.2; g.timer-=dt; if(!g.path.length&&g.lastSeen){ g.path=bfs(G,gtx,gty,Math.round(g.lastSeen.x/T),Math.round(g.lastSeen.z/T))||[]; g.lastSeen=null; } if(!g.path.length)anim='search'; if(g.timer<=0){ g.state=g.boss?'hunt':'patrol'; g.path=[]; g.sawHide=false; } }
  else { if(!g.path.length){ anim='idle'; g.look-=dt; if(g.look<=0){ const t=w.open[Math.floor(Math.random()*w.open.length)]; if(Math.abs(t[0]-gtx)+Math.abs(t[1]-gty)<14)g.path=bfs(G,gtx,gty,t[0],t[1])||[]; g.look=1.5+Math.random()*2; } } }
  let moving=false;
  if(look){ const tgt=Math.atan2(look.x-g.pos.x,look.z-g.pos.z); g.yaw+=Math.atan2(Math.sin(tgt-g.yaw),Math.cos(tgt-g.yaw))*Math.min(1,dt*8); const v=Math.min(speed*dt,Math.max(0,dist-0.9)); const nx=g.pos.x+Math.sin(g.yaw)*v, nz=g.pos.z+Math.cos(g.yaw)*v; if(!blocked(nx,nz,0.25)){g.pos.x=nx; g.pos.z=nz;} moving=v>0.001; }
  else if(g.path.length&&speed>0){ const [nx,ny]=g.path[0]; const tx=W2(nx),tz=W2(ny); const ddx=tx-g.pos.x,ddz=tz-g.pos.z,dd=Math.hypot(ddx,ddz);
    if(dd<0.15)g.path.shift(); else { const tgt=Math.atan2(ddx,ddz); const da=Math.atan2(Math.sin(tgt-g.yaw),Math.cos(tgt-g.yaw)); g.yaw+=da*Math.min(1,dt*(g.state==='chase'?10:5)); const v=Math.min(dd,speed*dt*(Math.abs(da)>1.2?0.3:1)); g.pos.x+=ddx/dd*v; g.pos.z+=ddz/dd*v; moving=true; } }
  if(anim==='alert'){} else if(!moving&&anim!=='search')anim='idle'; else if(moving&&(anim==='idle'||anim==='search'))anim='walk';
  playAnim(g,anim); const a=g.acts[g.cur]; if(a&&(g.cur==='walk'||g.cur==='run'))a.timeScale=Math.max(0.5,speed/(g.cur==='run'?3.4:1.3)); g.mixer.update(dt);
  g.headYaw=g.cur==='search'?Math.sin(w.t*1.6)*0.6:0;
  g.m.position.copy(g.pos); g.m.rotation.y=g.yaw;
  if(moving){ g.stepT-=dt*speed; if(g.stepT<=0){ g.stepT=g.mdl==='walker'?1.3:1.7; const v=Math.max(0,1-dist/16)*(losClear(g.pos.x,g.pos.z,pp.x,pp.z)?1:0.4); A.gstep(v*(g.mdl==='walker'?1:1.6)); if(g.mdl!=='walker'){ P.shake=Math.max(P.shake,v*0.45); puff(g.pos.x,0.05,g.pos.z,2,0x605850,0.25); } } }
  drawCone(g,g.pos.x,g.pos.z,g.yaw+(g.headYaw||0),range,g.fov,dt);
  const hot=g.state==='chase'||g.state==='alert'||g.boss; g.cone.material.color.setHex(hot?0xff1808:g.state==='patrol'?(g.meter>0.05?0xc05018:0x806020):0xa04010); g.cone.material.opacity=hot?0.12:0.05+g.meter*0.1;
}
function updateDrone(g,dt){ const w=world,P=player,G=w.G; const gtx=Math.round(g.pos.x/T),gty=Math.round(g.pos.z/T);
  const tr=g.state==='track'; const lx=tr?P.pos.x:g.pos.x+Math.sin(g.yaw)*2.2, lz=tr?P.pos.z:g.pos.z+Math.cos(g.yaw)*2.2;
  const inSpot=state==='play'&&P.inv<=0&&!P.hidden&&Math.hypot(P.pos.x-lx,P.pos.z-lz)<1.5&&losClear(g.pos.x,g.pos.z,P.pos.x,P.pos.z);
  if(inSpot)g.meter=Math.min(1,g.meter+dt*2.2); else g.meter=Math.max(0,g.meter-dt*0.4);
  if(g.meter>=1&&!tr){ g.state='track'; g.timer=6; raiseAlarm(P.pos.x,P.pos.z); A.beep(); }
  if(g.state==='track'){ g.timer-=dt; if(inSpot){ g.timer=Math.max(g.timer,3); w.alarm=Math.max(w.alarm,6); for(const o of w.guards)if((o.state==='sus'||o.state==='search')&&o.type!=='cam'&&o.type!=='drone'){ o.lastSeen=new THREE.Vector3(P.pos.x,0,P.pos.z); o.timer=Math.max(o.timer,5); if(!o.path.length)o.path=[]; } }
    const tgt=Math.atan2(P.pos.x-g.pos.x,P.pos.z-g.pos.z); g.yaw+=Math.atan2(Math.sin(tgt-g.yaw),Math.cos(tgt-g.yaw))*Math.min(1,dt*4);
    const d=Math.hypot(P.pos.x-g.pos.x,P.pos.z-g.pos.z); if(d>2.5&&losClear(g.pos.x,g.pos.z,P.pos.x,P.pos.z)){ const v=g.cspd*dt; const nx=g.pos.x+Math.sin(g.yaw)*v,nz=g.pos.z+Math.cos(g.yaw)*v; if(!blocked(nx,nz,0.3)){g.pos.x=nx;g.pos.z=nz;} }
    if(g.timer<=0){ g.state='patrol'; g.path=[]; } }
  else { if(!g.path.length){ const t=w.open[Math.floor(Math.random()*w.open.length)]; if(Math.abs(t[0]-gtx)+Math.abs(t[1]-gty)<16)g.path=bfs(G,gtx,gty,t[0],t[1])||[]; }
    if(g.path.length){ const [nx,ny]=g.path[0]; const tx=W2(nx),tz=W2(ny),ddx=tx-g.pos.x,ddz=tz-g.pos.z,dd=Math.hypot(ddx,ddz); if(dd<0.2)g.path.shift(); else { const tgt=Math.atan2(ddx,ddz); g.yaw+=Math.atan2(Math.sin(tgt-g.yaw),Math.cos(tgt-g.yaw))*Math.min(1,dt*3); const v=Math.min(dd,g.spd*dt); g.pos.x+=ddx/dd*v; g.pos.z+=ddz/dd*v; } } }
  const y=g.y+Math.sin(w.t*2+g.phase)*0.12; g.m.position.set(g.pos.x,y,g.pos.z); g.m.rotation.set(0.15,g.yaw,Math.sin(w.t*1.5)*0.05); for(const r of g.rotors)r.rotation.y+=dt*40;
  const l=Math.hypot(lx-g.pos.x,lz-g.pos.z); g.beam.position.set(g.pos.x,y-0.1,g.pos.z); g.beam.lookAt(lx,0,lz); g.beam.rotateX(-Math.PI/2); g.beam.scale.set(1,Math.hypot(l,y)/2.6,1);
  g.spot.position.set(lx,0.05,lz); const red=g.state==='track'||g.meter>0.3; g.spot.material.color.setHex(red?0xff3020:0xfff0c0); g.beam.material.uniforms.uC.value.setHex(red?0xff4030:0xfff0c8); }
function updateCam(g,dt){ const P=player; g.phase+=dt*0.55; g.yaw=g.baseYaw+Math.sin(g.phase)*0.85; if(g.head)g.head.rotation.y=g.yaw-g.baseYaw;
  const see=state==='play'&&percept(g.pos.x,g.pos.z,g.range*(P.light?1.15:0.8),g.fov,g.yaw);
  if(see){ g.meter=Math.min(1,g.meter+dt*1.5); g.phase-=dt*0.5; g.beepT-=dt; if(g.beepT<=0){ g.beepT=0.35; A.beep(); } } else g.meter=Math.max(0,g.meter-dt*0.35);
  if(g.meter>=1){ raiseAlarm(P.pos.x,P.pos.z); g.meter=0.6; }
  drawCone(g,g.pos.x,g.pos.z,g.yaw,g.range,g.fov,dt); g.cone.material.color.setHex(g.meter>0.05?0xff3010:0x3060a0); g.cone.material.opacity=0.04+g.meter*0.12; }
function updateEyes(){ let n=0; for(const g of world.guards){ if(n>=40)break; let x,y,z,c; if(g.type==='cam'){ x=g.pos.x+Math.sin(g.yaw)*0.33; y=2.47; z=g.pos.z+Math.cos(g.yaw)*0.33; c=0xff2010; } else if(g.type==='drone'){ x=g.pos.x+Math.sin(g.yaw)*0.35; y=g.m.position.y-0.04; z=g.pos.z+Math.cos(g.yaw)*0.35; c=0xfff0d0; } else { const s=g.scale||1, hy=(g.mdl==='walker'?1.84:2.17)*s; x=g.pos.x+Math.sin(g.yaw)*0.2*s; y=hy; z=g.pos.z+Math.cos(g.yaw)*0.2*s; c=g.eyeC||(g.type==='walker'?0xff2010:0xff6010); }
    eyeP[n*3]=x; eyeP[n*3+1]=y; eyeP[n*3+2]=z; const cc=C(c); eyeC[n*3]=cc.r; eyeC[n*3+1]=cc.g; eyeC[n*3+2]=cc.b; n++; } eyeGeo.setDrawRange(0,n); eyeGeo.attributes.position.needsUpdate=true; eyeGeo.attributes.color.needsUpdate=true; }
function menuUpdate(dt){ const w=world; w.t+=dt; if(!menuCurve)return; menuU+=dt*0.022; if(menuU>0.97)menuU=0;
  const p=menuCurve.getPointAt(menuU), q=menuCurve.getPointAt(Math.min(1,menuU+0.03)); camera.position.copy(p); camera.position.y+=Math.sin(w.t*1.3)*0.04; tmp.copy(q); tmp.y=1.45; camera.lookAt(tmp);
  player.pos.set(p.x,1.6,p.z); flash.intensity=FL_I*(Math.random()<0.03?0.2:1); beamMat.uniforms.uI.value=0.06*flash.intensity/FL_I; dustMat.uniforms.uOn.value=1;
  if(Math.floor(w.t*2)!==Math.floor((w.t-dt)*2))assignLights(w,player.pos); lightTick(w,dt);
  for(const g of w.guards){ if(g.type==='cam')updateCam(g,dt); else if(g.type==='drone')updateDrone(g,dt); else updateGuard(g,dt,0); } }
let last=performance.now(), fps=60, lowT=0;
function frame(){ requestAnimationFrame(frame); const n=performance.now(); let dt=Math.min(0.05,(n-last)/1000); last=n; fps=fps*0.95+(1/Math.max(dt,0.001))*0.05;
  if(world){
    if(state==='play')update(dt);
    else if(state==='title')menuUpdate(dt);
    else if(state==='done'){ world.t+=dt; lightTick(world,dt); }
    else if(state==='caught'&&world.catcher){ const g=world.catcher, w=world, P=player; w.caughtT+=dt; lightTick(w,dt);
      const fx=-Math.sin(P.yaw), fz=-Math.cos(P.yaw);
      if(g.type!=='drone'&&g.type!=='cam'){ const tx=P.pos.x+fx*0.9, tz=P.pos.z+fz*0.9; g.pos.x+=(tx-g.pos.x)*Math.min(1,dt*7); g.pos.z+=(tz-g.pos.z)*Math.min(1,dt*7); g.yaw=Math.atan2(P.pos.x-g.pos.x,P.pos.z-g.pos.z); g.m.position.copy(g.pos); g.m.rotation.y=g.yaw; g.mixer.update(dt);
        const hy=(g.mdl==='walker'?1.75:2.0)*(g.scale||1); P.pitch+=(Math.atan2(hy-1.6,0.9)-P.pitch)*Math.min(1,dt*6); }
      const sh=0.07*Math.max(0,1-w.caughtT*0.5); camera.position.set(P.pos.x+(Math.random()-.5)*sh,1.6+(Math.random()-.5)*sh,P.pos.z); camera.rotation.set(P.pitch,P.yaw,Math.sin(n*0.05)*0.05);
      const s=Math.min(1,w.caughtT/1.5); post.uniforms.uS.value=s*0.7; post.uniforms.uD.value=1.2; $('static').style.opacity=s*0.55; $('danger').style.opacity=0.9; flash.intensity=FL_I*(Math.random()<0.3?0.1:1); }
    sparks.update(dt); smoke.update(dt); updateEyes();
    if(msgT>0){ msgT-=dt; if(msgT<=0)$('msg').style.opacity=0; }
  }
  if(Q>0&&state==='play'&&!window.BB_NOAUTO){ if(fps<36)lowT+=dt; else lowT=Math.max(0,lowT-dt); if(lowT>3){ Q--; applyQuality(); lowT=0; } }
  const tt=n/1000; post.uniforms.uT.value=tt; dustMat.uniforms.uT.value=tt; camera.updateMatrixWorld(); dustMat.uniforms.uCam.value.copy(camera.position);
  flash.getWorldPosition(dustMat.uniforms.uL.value); camera.getWorldDirection(dustMat.uniforms.uDir.value);
  if(Q>0)composer.render(); else renderer.render(scene,camera);
}
(async()=>{
  resize(); const sdkP=SDK.initSDK(); SDK.loadingStart();
  try{ await loadAssets(); }catch(e){ $('play').textContent='LOAD ERROR'; console.error(e); return; }
  await sdkP; const sv=SDK.loadData('bb_save'); if(sv){ save=Object.assign({},DEF,sv); save.up=Object.assign({},DEF.up,sv.up||{}); save.stars=sv.stars||{}; }
  applyQuality(); title(); SDK.loadingStop(); $('play').disabled=false; frame();
})();
window.BB={get state(){return state;},player,keys,inp,get world(){return world;},get fps(){return fps;},sdkLog:SDK.sdkLog,startFloor,spawnGuard,glitch,elevatorTo,titleCard,caught,floorDone,THREE,camera,get quality(){return Q;},setQuality(q){Q=q;applyQuality();},get save(){return save;}};
