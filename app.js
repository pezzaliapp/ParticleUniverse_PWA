/* Particle Universe — LITE (Canvas-only)
 * Obiettivo: farlo girare OVUNQUE (iOS vecchi compresi). Niente WebGPU.
 * MIT 2025
 */
(()=>{
  'use strict';

  const canvas = document.getElementById('view');
  const DPR = Math.min(2, (window.devicePixelRatio||1));
  let W=0,H=0, running=true;
  const elPart = document.getElementById('part');
  const elFps = document.getElementById('fps');
  const elMode = document.getElementById('modeName');
  const elPlay = document.getElementById('btnPlay');
  const elMic = document.getElementById('btnMic');
  const elModeBtn = document.getElementById('btnMode');
  const elThemeBtn = document.getElementById('btnTheme');
  const elFullscreen = document.getElementById('btnFullscreen');
  const elInstall = document.getElementById('btnInstall');

  const MODES = ['Galaxy','Ring','Sphere','Spiral','Waves'];
  let modeIndex = 0;

  let audioLevel=0, analyser=null, dataArray=null, micStream=null;

  let frames=0, last=performance.now(), lastFps=last, fps=0;

  // --- FULLSCREEN RESIZE FIX ---
  function resize(){
    // occorre lasciare spazio a header/footer e forzare il canvas in posizione fissa
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    const headerH = header ? header.offsetHeight : 0;
    const footerH = footer ? footer.offsetHeight : 0;

    W = window.innerWidth;
    H = Math.max(0, window.innerHeight - headerH - footerH);

    canvas.style.position = 'fixed';
    canvas.style.top = headerH + 'px';
    canvas.style.left = '0';
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    canvas.width  = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
  }
  // su alcuni browser il layout si stabilizza con un piccolo delay
  const queuedResize = () => setTimeout(resize, 100);
  window.addEventListener('resize', queuedResize, {passive:true});
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  // chiamata iniziale (due volte per sicurezza su macOS/iOS)
  resize(); setTimeout(resize, 0);
  // --- /FULLSCREEN RESIZE FIX ---

  // Input
  let touch = {active:false, x:0.5, y:0.5};
  canvas.addEventListener('pointerdown', e=>{touch.active=true; updatePoint(e)});
  window.addEventListener('pointerup', ()=> touch.active=false);
  canvas.addEventListener('pointermove', e=>{ if(touch.active) updatePoint(e) });
  canvas.addEventListener('dblclick', ()=> nextMode());
  function updatePoint(e){
    const r = canvas.getBoundingClientRect();
    touch.x = (e.clientX - r.left)/W;
    touch.y = (e.clientY - r.top)/H;
  }

  // UI
  elPlay.addEventListener('click', ()=>{ running=!running; elPlay.textContent = running?'⏸︎':'▶︎'; });
  elModeBtn.addEventListener('click', nextMode);
  elThemeBtn.addEventListener('click', cycleTheme);
  elFullscreen.addEventListener('click', ()=>{
    const elem = document.documentElement;
    if(!document.fullscreenElement){ elem.requestFullscreen && elem.requestFullscreen(); }
    else { document.exitFullscreen && document.exitFullscreen(); }
  });
  let deferredPrompt=null;
  window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; elInstall.style.display='inline-block'; });
  elInstall.addEventListener('click', ()=> deferredPrompt && deferredPrompt.prompt());

  function nextMode(){ modeIndex=(modeIndex+1)%MODES.length; elMode.textContent = MODES[modeIndex]; }

  const THEMES=[
    {bg:'#060a12', a:[123,209,255], b:[45,212,191], c:[167,139,250]},
    {bg:'#02080f', a:[255,208,122], b:[255,143,90], c:[240,171,252]},
    {bg:'#08130f', a:[123,255,212], b:[55,240,164], c:[96,165,250]},
  ];
  let themeIndex=0;
  function applyTheme(){ document.documentElement.style.setProperty('--bg', THEMES[themeIndex].bg); }
  function cycleTheme(){ themeIndex=(themeIndex+1)%THEMES.length; applyTheme(); }
  applyTheme();

  // Audio (opzionale, non blocca)
  async function toggleMic(){
    if(micStream){
      micStream.getTracks().forEach(t=>t.stop()); micStream=null; analyser=null; dataArray=null;
      elMic.textContent='🎤';
      return;
    }
    try{
      micStream = await navigator.mediaDevices.getUserMedia({audio:true});
      const ac = new (window.AudioContext||window.webkitAudioContext)();
      const src = ac.createMediaStreamSource(micStream);
      analyser = ac.createAnalyser(); analyser.fftSize=512;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser);
      elMic.textContent='🎤 ON';
    }catch(err){ console.warn('Mic denied', err); }
  }
  elMic.addEventListener('click', toggleMic);
  function sampleAudio(){
    if(!analyser || !dataArray){ audioLevel=0; return; }
    analyser.getByteFrequencyData(dataArray);
    let sum=0, n=0;
    for(let i=4;i<40 && i<dataArray.length;i++){ sum+=dataArray[i]; n++; }
    audioLevel = Math.min(1, (sum/(n*255))*1.8);
  }

  // Canvas renderer
  const ctx = canvas.getContext('2d');
  const COUNT = Math.min(60000, Math.floor((W*H)/5)); // scala con pixel
  const P = new Float32Array(COUNT*4); // x,y,vx,vy
  for(let i=0;i<COUNT;i++){
    P[i*4+0] = Math.random()*W;
    P[i*4+1] = Math.random()*H;
    P[i*4+2] = (Math.random()*2-1)*0.2;
    P[i*4+3] = (Math.random()*2-1)*0.2;
  }
  elPart.textContent = String(COUNT);

  function frame(){
    if(!running){ requestAnimationFrame(frame); return; }
    const now = performance.now();
    const dt = Math.min(0.033, (now-last)/1000);
    last = now;
    frames++;
    if(now-lastFps>500){ fps = Math.round(frames*1000/(now-lastFps)); frames=0; lastFps=now; elFps.textContent = String(fps); }
    sampleAudio();

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#060a12';
    ctx.fillRect(0,0,W,H);

    const boost = 1 + audioLevel*1.5;
    for(let i=0;i<COUNT;i++){
      const idx=i*4;
      let x=P[idx], y=P[idx+1], vx=P[idx+2], vy=P[idx+3];
      if(MODES[modeIndex]==='Galaxy'){
        const cx=W*0.5, cy=H*0.5;
        const dx=x-cx, dy=y-cy, d=Math.hypot(dx,dy)+1e-3;
        const ang = Math.atan2(dy,dx) + 1.2;
        vx += (-dx/d*0.2 + Math.cos(ang)*0.04)*boost;
        vy += (-dy/d*0.2 + Math.sin(ang)*0.04)*boost;
      }else if(MODES[modeIndex]==='Ring'){
        const cx=W*0.5, cy=H*0.5;
        const dx=x-cx, dy=y-cy; const r=Math.hypot(dx,dy)+1e-3;
        const dr = (Math.min(W,H)*0.28 - r)*0.002;
        vx += (dx/r*dr - dy/r*0.02)*boost;
        vy += (dy/r*dr + dx/r*0.02)*boost;
      }else if(MODES[modeIndex]==='Sphere'){
        const cx=W*0.5, cy=H*0.5;
        const dx=x-cx, dy=y-cy; const r=Math.hypot(dx,dy)+1e-3;
        vx += (-dx/r*0.12)*boost; vy += (-dy/r*0.12)*boost;
      }else if(MODES[modeIndex]==='Spiral'){
        const cx=W*0.5, cy=H*0.5;
        const dx=x-cx, dy=y-cy; const r=Math.hypot(dx,dy)+1e-3;
        const ang = Math.atan2(dy,dx) + r*0.002 + now*0.0008;
        vx += (Math.cos(ang)*0.06 - dx/r*0.04)*boost;
        vy += (Math.sin(ang)*0.06 - dy/r*0.04)*boost;
      }else{ // Waves
        const nx = x/W*8 + now*0.0008;
        const ny = y/H*8;
        vx += Math.sin(nx*6.283)*0.04*boost;
        vy += Math.cos(ny*6.283)*0.04*boost;
      }
      if(touch.active){
        const tx = touch.x*W, ty = touch.y*H;
        const dx=x-tx, dy=y-ty; const d=Math.hypot(dx,dy)+1e-3;
        vx += (-dx/d*d*0.00006)*boost;
        vy += (-dy/d*d*0.00006)*boost;
      }
      vx*=0.985; vy*=0.985; x+=vx; y+=vy;
      if(x<0) x+=W; if(x>=W) x-=W;
      if(y<0) y+=H; if(y>=H) y-=H;
      P[idx]=x; P[idx+1]=y; P[idx+2]=vx; P[idx+3]=vy;
    }
    // draw
    const A = THEMES[themeIndex].a, B = THEMES[themeIndex].b, C = THEMES[themeIndex].c;
    ctx.globalCompositeOperation='lighter';
    for(let i=0;i<COUNT;i++){
      const idx=i*4;
      const x=P[idx], y=P[idx+1];
      const r = 0.6 + ((i%1000)/1000)*0.8 + audioLevel*0.8;
      const k = (i%3===0?A:(i%3===1?B:C));
      ctx.fillStyle = `rgba(${k[0]},${k[1]},${k[2]},0.6)`;
      ctx.beginPath(); ctx.arc(x,y,r,0,6.283); ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // PWA SW (solo se HTTPS/localhost)
  if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }
})();
