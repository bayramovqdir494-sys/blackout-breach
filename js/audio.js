// Procedural Web Audio: ambience drone, heartbeat, steps, stings
let ctx=null,master=null,sfx=null,amb=null,muted=false,adMuted=false,NB=null,hbNext=0,hbRate=0,started=false;
function g(){ if(master) master.gain.value=(muted||adMuted)?0:0.9; }
const now=()=>ctx?ctx.currentTime:0;
function noise(t,dur,freq,vol,type='lowpass',q=1){ if(!ctx)return; const s=ctx.createBufferSource(); s.buffer=NB; const f=ctx.createBiquadFilter(); f.type=type; f.frequency.value=freq; f.Q.value=q; const gg=ctx.createGain(); gg.gain.setValueAtTime(vol,t); gg.gain.exponentialRampToValueAtTime(.001,t+dur); s.connect(f).connect(gg).connect(sfx); s.start(t,Math.random()*0.5); s.stop(t+dur); }
function tone(t,dur,f0,f1,vol,type='sine'){ if(!ctx)return; const o=ctx.createOscillator(); o.type=type; o.frequency.setValueAtTime(f0,t); o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur); const gg=ctx.createGain(); gg.gain.setValueAtTime(0.0001,t); gg.gain.exponentialRampToValueAtTime(vol,t+0.01); gg.gain.exponentialRampToValueAtTime(.0001,t+dur); o.connect(gg).connect(sfx); o.start(t); o.stop(t+dur+0.02); }
function ambience(){ amb=ctx.createGain(); amb.gain.value=0.5; amb.connect(master);
  for(const [f,v] of [[41,.18],[61.7,.08],[82.5,.04]]){ const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; const fl=ctx.createBiquadFilter(); fl.type='lowpass'; fl.frequency.value=140; const gg=ctx.createGain(); gg.gain.value=v;
    const l=ctx.createOscillator(); l.frequency.value=0.07+Math.random()*0.1; const lg=ctx.createGain(); lg.gain.value=v*0.6; l.connect(lg).connect(gg.gain); l.start(); o.connect(fl).connect(gg).connect(amb); o.start(); }
  const s=ctx.createBufferSource(); s.buffer=NB; s.loop=true; const fl=ctx.createBiquadFilter(); fl.type='bandpass'; fl.frequency.value=380; fl.Q.value=0.6; const gg=ctx.createGain(); gg.gain.value=0.05; s.connect(fl).connect(gg).connect(amb); s.start(); }
export const A={
  init(){ if(ctx){ if(ctx.state==='suspended')ctx.resume(); return; } try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){return;}
    master=ctx.createGain(); master.connect(ctx.destination); sfx=ctx.createGain(); sfx.gain.value=0.8; sfx.connect(master); g();
    NB=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate); const d=NB.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1; ambience(); },
  toggle(){ muted=!muted; g(); return muted; }, adMute(v){ adMuted=v; g(); }, isMuted:()=>muted,
  step(run,q){ const t=now(); noise(t,0.09,run?900:600,(run?0.22:0.12)*q,'lowpass'); tone(t,0.06,90,60,0.06*q); },
  drip(v){ if(v<0.03)return; const t=now(); tone(t,0.09,1400+Math.random()*600,500,0.12*v); },
  laser(){ const t=now(); tone(t,0.25,1800,900,0.08,'sawtooth'); },
  power(off){ const t=now(); tone(t,off?0.9:0.5,off?220:60,off?40:240,0.25,'sawtooth'); noise(t,0.4,800,0.15,'lowpass'); },
  gstep(v){ if(v<0.02)return; const t=now(); tone(t,0.12,70,45,0.35*v,'square'); noise(t,0.07,2400,0.12*v,'bandpass',4); tone(t+0.04,0.18,420,300,0.04*v,'sawtooth'); },
  heart(dt,intensity){ if(!ctx)return; hbRate=intensity; if(intensity<0.05)return; hbNext-=dt; if(hbNext<=0){ const t=now(),v=0.25+0.5*intensity; tone(t,0.12,62,40,v); tone(t+0.16,0.12,56,38,v*0.7); hbNext=1.1-0.65*intensity; } },
  alert(){ const t=now(); tone(t,0.5,880,860,0.18,'square'); tone(t+0.18,0.6,660,640,0.14,'square'); noise(t,0.6,300,0.3); },
  sus(){ const t=now(); tone(t,0.3,500,700,0.08,'triangle'); },
  pick(){ const t=now(); [660,990,1320].forEach((f,i)=>tone(t+i*0.07,0.22,f,f,0.12,'triangle')); },
  coin(){ const t=now(); tone(t,0.12,1200,1800,0.08,'triangle'); },
  door(){ const t=now(); noise(t,0.6,700,0.2,'bandpass',1.5); tone(t,0.5,120,80,0.08,'sawtooth'); },
  click(){ const t=now(); noise(t,0.03,3000,0.15,'highpass'); },
  denied(){ const t=now(); tone(t,0.25,180,170,0.15,'square'); },
  caught(){ const t=now(); noise(t,1.4,1600,0.6,'bandpass',0.7); tone(t,1.2,300,60,0.3,'sawtooth'); tone(t,1.2,317,63,0.25,'sawtooth'); },
  win(){ const t=now(); [392,523,659,784].forEach((f,i)=>tone(t+i*0.12,0.5,f,f,0.12,'triangle')); },
  clang(v=1){ const t=now(); tone(t,0.25,1800,1500,0.12*v,'triangle'); tone(t,0.3,2650,2400,0.06*v,'triangle'); noise(t,0.08,4000,0.2*v,'bandpass',3); },
  zap(v=1){ if(v<0.03)return; const t=now(); noise(t,0.12,6000,0.25*v,'highpass'); tone(t,0.08,1200,300,0.06*v,'sawtooth'); },
  hiss(v=1){ if(v<0.03)return; const t=now(); noise(t,1.2,5000,0.12*v,'highpass'); },
  gate(){ const t=now(); tone(t,1.2,60,90,0.25,'sawtooth'); noise(t,1.2,400,0.3,'lowpass'); [523,784].forEach((f,i)=>tone(t+0.9+i*0.12,0.5,f,f,0.12,'triangle')); },
  ding(){ const t=now(); tone(t,1.2,1046,1046,0.15,'sine'); tone(t+0.25,1.4,784,784,0.13,'sine'); },
  hum(d=2){ const t=now(); tone(t,d,55,58,0.25,'sawtooth'); noise(t,d,200,0.2,'lowpass'); },
  static(d=1){ const t=now(); noise(t,d,3000,0.45,'bandpass',0.4); },
  beep(){ const t=now(); tone(t,0.12,1400,1400,0.08,'square'); },
  creak(){ const t=now(); tone(t,0.4,180,120,0.08,'sawtooth'); noise(t,0.3,900,0.12,'bandpass',4); },
  star(i){ const t=now(); tone(t,0.4,660*Math.pow(1.26,i),660*Math.pow(1.26,i),0.14,'triangle'); },
  buzz(v){ if(!ctx)return; if(!this._bz){ const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=180; const f=ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=900; const g2=ctx.createGain(); g2.gain.value=0; o.connect(f).connect(g2).connect(sfx); o.start(); this._bz=g2; this._bo=o; } this._bz.gain.value=0.05*v; this._bo.frequency.value=170+v*40; },
  siren(on){ if(!ctx)return; if(!this._sr){ const o=ctx.createOscillator(); o.type='square'; const l=ctx.createOscillator(); l.frequency.value=0.8; const lg=ctx.createGain(); lg.gain.value=180; l.connect(lg).connect(o.frequency); o.frequency.value=620; const f=ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=1500; const g2=ctx.createGain(); g2.gain.value=0; o.connect(f).connect(g2).connect(sfx); o.start(); l.start(); this._sr=g2; } this._sr.gain.setTargetAtTime(on?0.035:0,now(),0.2); },
  flicker(){ const t=now(); noise(t,0.05,5000,0.06,'highpass'); },
};
