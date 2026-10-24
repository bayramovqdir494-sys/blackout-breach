// CrazyGames SDK v3 wrapper - robust: init is never dropped on timeout, gameplayStart is queued.
let SDK=null, active=false, ready=false, wantPlay=false, sent=false, lastMid=-1e9, adHooks={onStart(){},onEnd(){}};
export const sdkLog=[]; const note=m=>sdkLog.push(m);
let initP=null;
export function initSDK(){
  if(initP) return initP;
  const root=window.CrazyGames;
  if(!root||!root.SDK){note('missing');ready=true;return initP=Promise.resolve(false);}
  const real=Promise.resolve().then(()=>root.SDK.init()).then(()=>{
    SDK=root.SDK; active=['crazygames','local'].includes(SDK.environment); ready=true; note('init:'+SDK.environment); flush(); return active;
  }).catch(e=>{note('init-fail');ready=true;return false;});
  // UI waits at most 4s, but the real init keeps going and flushes queued calls when done
  return initP=Promise.race([real,new Promise(r=>setTimeout(()=>{note('init-slow');r(false);},4000))]);
}
function call(m){ if(!active||!SDK.game||!SDK.game[m])return; try{SDK.game[m]();note(m);}catch(e){note(m+'-err');} }
function flush(){ if(!active)return; if(wantPlay&&!sent){call('gameplayStart');sent=true;} }
let loading=false;
export function loadingStart(){ loading=true; call('loadingStart'); }
export function loadingStop(){ if(!loading&&!active){} call('loadingStop'); }
export function gameplayStart(){ wantPlay=true; if(sent)return; if(active){call('gameplayStart');sent=true;} else note('gs-queued'); }
export function gameplayStop(){ wantPlay=false; if(!sent)return; sent=false; call('gameplayStop'); }
export const happytime=()=>call('happytime');
export function setAdHooks(h){adHooks=h;}
function ad(type){
  return new Promise(res=>{
    if(!active||!SDK.ad){note('ad-skip:'+type);res(type==='rewarded'?'unavailable':'skip');return;}
    let done=false; const fin=v=>{if(done)return;done=true;adHooks.onEnd();res(v);};
    try{SDK.ad.requestAd(type,{adStarted:()=>{note('adStart:'+type);adHooks.onStart();},adFinished:()=>fin('ok'),adError:()=>fin('error')});}
    catch(e){fin('error');}
  });
}
export async function midgame(){ const n=performance.now(); if(n-lastMid<90000){note('mid-cooldown');return 'cooldown';} lastMid=n; return ad('midgame'); }
export const rewarded=()=>ad('rewarded');
export function saveData(k,v){ const s=JSON.stringify(v); try{ if(active&&SDK.data)SDK.data.setItem(k,s);}catch(e){} try{localStorage.setItem(k,s);}catch(e){} }
export function loadData(k){ let s=null; try{ if(active&&SDK.data)s=SDK.data.getItem(k);}catch(e){} if(!s){try{s=localStorage.getItem(k);}catch(e){}} try{return s?JSON.parse(s):null;}catch(e){return null;} }
