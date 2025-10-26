/* Particle Universe — PezzaliAPP Cosmos
 * WebGPU (se disponibile) con milioni di particelle, fallback Canvas2D "lite".
 * Audio-reactive con Web Audio API. PWA offline.
 * MIT 2025
 */
(()=>{
  'use strict';

  const canvas = document.getElementById('view');
  const DPR = Math.min(2, (window.devicePixelRatio||1));
  let W=0,H=0, running=true;
  let backend = 'detecting', partCount = 0;
  const elBackend = document.getElementById('backend');
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

  let audioEnabled=false, audioLevel=0;
  let micStream=null, analyser=null, dataArray=null;

  let frames=0, last=performance.now(), lastFps=last, fps=0;

  function resize(){
    W = Math.floor(window.innerWidth);
    H = Math.floor(window.innerHeight);
    canvas.width = Math.floor(W*DPR);
    canvas.height = Math.floor(H*DPR);
    canvas.style.width = W+'px';
    canvas.style.height = H+'px';
  }
  window.addEventListener('resize', resize, {passive:true});
  resize();

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
    if(!document.fullscreenElement){ if(elem.requestFullscreen) elem.requestFullscreen(); }
    else { if(document.exitFullscreen) document.exitFullscreen();}
  });
  let deferredPrompt=null;
  window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; elInstall.style.display='inline-block'; });
  elInstall.addEventListener('click', ()=> deferredPrompt && deferredPrompt.prompt());

  function nextMode(){ modeIndex=(modeIndex+1)%MODES.length; elMode.textContent = MODES[modeIndex]; }

  const THEMES=[
    {bg:'#060a12', a:'#7bd1ff', b:'#2dd4bf', c:'#a78bfa'},
    {bg:'#02080f', a:'#ffd07a', b:'#ff8f5a', c:'#f0abfc'},
    {bg:'#08130f', a:'#7bffd4', b:'#37f0a4', c:'#60a5fa'},
  ];
  let themeIndex=0;
  function applyTheme(){
    document.documentElement.style.setProperty('--bg', THEMES[themeIndex].bg);
  }
  function cycleTheme(){ themeIndex=(themeIndex+1)%THEMES.length; applyTheme(); }
  applyTheme();

  // Audio
  async function toggleMic(){
    if(audioEnabled){
      audioEnabled=false;
      elMic.textContent='🎤';
      if(micStream){ micStream.getTracks().forEach(t=>t.stop()); micStream=null; }
      analyser=null; dataArray=null;
    } else {
      try{
        micStream = await navigator.mediaDevices.getUserMedia({audio:true});
        const ac = new (window.AudioContext||window.webkitAudioContext)();
        const src = ac.createMediaStreamSource(micStream);
        analyser = ac.createAnalyser();
        analyser.fftSize = 512;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        src.connect(analyser);
        audioEnabled=true;
        elMic.textContent='🎤 ON';
      }catch(err){
        console.warn('Mic denied', err);
      }
    }
  }
  elMic.addEventListener('click', toggleMic);

  function sampleAudio(){
    if(analyser && dataArray){
      analyser.getByteFrequencyData(dataArray);
      // Focus su banda 100–2k Hz
      let sum=0, n=0;
      for(let i=4;i<40 && i<dataArray.length;i++){ sum+=dataArray[i]; n++; }
      const v = (sum/(n*255));
      audioLevel = Math.min(1, v*1.8);
    } else {
      audioLevel = 0.0;
    }
  }

  // RENDERERS
  let renderer=null;
  (async function init(){
    if(navigator.gpu){
      try{
        renderer = await initWebGPU();
      }catch(e){
        console.warn('WebGPU failed, fallback', e);
      }
    }
    if(!renderer){
      renderer = initCanvasFallback();
    }
    backend = renderer.backend;
    partCount = renderer.count;
    elBackend.textContent = backend;
    elPart.textContent = String(partCount);
    loop();
  })();

  // WebGPU IMPLEMENTATION (compute + render)
  async function initWebGPU(){
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({device, format, alphaMode:'opaque'});

    const COUNT = 1000000; // 1M
    const BUF_SIZE = COUNT*4*4; // vec4f
    const posBuf = device.createBuffer({size:BUF_SIZE, usage:GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    const velBuf = device.createBuffer({size:BUF_SIZE, usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});

    // Seed
    {
      const seed = new Float32Array(COUNT*4);
      const vseed = new Float32Array(COUNT*4);
      for(let i=0;i<COUNT;i++){
        const a = Math.random()*Math.PI*2;
        const r = Math.sqrt(Math.random())*0.45;
        seed[i*4+0] = (Math.cos(a)*r);
        seed[i*4+1] = (Math.sin(a)*r);
        seed[i*4+2] = (Math.random()*2-1)*0.02;
        seed[i*4+3] = Math.random()*Math.PI*2;
        vseed[i*4+0] = 0.0; vseed[i*4+1] = 0.0; vseed[i*4+2] = 0.0; vseed[i*4+3] = 0.0;
      }
      device.queue.writeBuffer(posBuf,0,seed.buffer);
      device.queue.writeBuffer(velBuf,0,vseed.buffer);
    }

    const uniformBuf = device.createBuffer({size: 4*8, usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});

    const compMod = device.createShaderModule({code:`
struct Part { p: vec4f; v: vec4f; };
@group(0) @binding(0) var<storage, read_write> pos: array<Part>;
@group(0) @binding(1) var<uniform> U: vec4f;
@group(0) @binding(2) var<uniform> U2: vec4f;
fn hash(n: f32) -> f32 { return fract(sin(n)*43758.5453); }
fn noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let a = hash(dot(i, vec2f(127.1,311.7)));
  let b = hash(dot(i+vec2f(1,0), vec2f(127.1,311.7)));
  let c = hash(dot(i+vec2f(0,1), vec2f(127.1,311.7)));
  let d = hash(dot(i+vec2f(1,1), vec2f(127.1,311.7)));
  let u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u){
  let i = gid.x;
  if (i >= arrayLength(&pos)) { return; }
  var P = pos[i].p;
  var V = pos[i].v;
  let time = U.x; let dt = U.y; let aspect = U.z; let mode = U.w;
  let touch = U2.xy; let audio = U2.z;
  var target = vec3f(0.0);
  if (mode < 0.5) {
    let a = (hash(f32(i))*6.283 + time*0.05);
    let r = sqrt(fract(hash(f32(i)*1.23)))*0.6;
    target = vec3f(cos(a)*r, sin(a)*r/aspect, 0.0);
  } else if (mode < 1.5) {
    let a = (f32(i)%1000.0)/1000.0*6.283 + time*0.06;
    target = vec3f(cos(a)*0.55, sin(a)*0.55/aspect, 0.0);
  } else if (mode < 2.5) {
    let u = fract(hash(f32(i)*3.1)); let v = fract(hash(f32(i)*5.7));
    let th = acos(1.0 - 2.0*u);
    let ph = 6.283*v;
    let x = sin(th)*cos(ph)*0.55;
    let y = sin(th)*sin(ph)*0.55;
    target = vec3f(x, y/aspect, 0.0);
  } else if (mode < 3.5) {
    let t = (f32(i)%2000.0)/2000.0*10.0 + time*0.4;
    let r = 0.1 + 0.5*(t/10.0);
    target = vec3f(r*cos(t), r*sin(t)/aspect, 0.0);
  } else {
    let x = (f32(i)%2000.0)/2000.0*2.0-1.0;
    let y = sin(x*8.0 + time*2.0)*0.25;
    target = vec3f(x*0.7, y/aspect, 0.0);
  }
  let n = noise(P.xy*4.0 + time*0.2);
  let flow = vec2f(cos(n*6.283), sin(n*6.283))*0.2;
  let dir = target - P.xyz;
  let att = normalize(dir+1e-5)*0.6;
  let tpos = vec3f(touch.x*2.0-1.0, (1.0-touch.y)*2.0-1.0, 0.0);
  let d2 = max(distance(P.xyz, tpos), 0.001);
  let attract = (tpos - P.xyz) / (d2*d2) * 0.08;
  let burst = (audio)*0.5;
  V.xy += (att.xy + flow + attract.xy) * dt * (1.0 + burst);
  V.xy *= 0.985;
  P.xy += V.xy * dt;
  if (P.x < -1.2) { P.x = 1.2; }
  if (P.x >  1.2) { P.x = -1.2; }
  if (P.y < -1.2) { P.y = 1.2; }
  if (P.y >  1.2) { P.y = -1.2; }
  pos[i].p = P;
  pos[i].v = V;
}`});
    const vertMod = device.createShaderModule({code:`
struct Part { p: vec4f; v: vec4f; };
@group(0) @binding(0) var<storage, read> pos: array<Part>;
@group(0) @binding(1) var<uniform> U: vec4f;
struct VSOut { @builtin(position) pos: vec4f, @location(0) t: f32; };
@vertex
fn main(@builtin(instance_index) i: u32) -> VSOut{
  var out: VSOut;
  let P = pos[i].p;
  out.pos = vec4f(P.x, P.y, 0.0, 1.0);
  out.t = fract(P.w*0.159);
  return out;
}`});
    const fragMod = device.createShaderModule({code:`
@group(0) @binding(2) var<uniform> Col: vec4f;
@fragment
fn main(@location(0) t: f32) -> @location(0) vec4f{
  let glow = 0.9 - abs(t-0.5);
  let col = mix(vec3f(Col.x, Col.y, Col.z), vec3f(1.0,1.0,1.0), glow*0.2);
  return vec4f(col, 0.75);
}`});

    const pipelineCompute = device.createComputePipeline({layout:'auto', compute:{module:compMod, entryPoint:'main'}});
    const pipelineRender = device.createRenderPipeline({
      layout:'auto',
      vertex:{module:vertMod, entryPoint:'main'},
      fragment:{module:fragMod, entryPoint:'main', targets:[{format}]},
      primitive:{topology:'point-list'}
    });

    const uniformBuf = device.createBuffer({size: 4*8, usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bindCompute = device.createBindGroup({
      layout:pipelineCompute.getBindGroupLayout(0),
      entries:[
        {binding:0, resource:{buffer:posBuf}},
        {binding:1, resource:{buffer:uniformBuf}},
        {binding:2, resource:{buffer:uniformBuf, offset:16, size:16}},
      ]
    });
    const bindRender = device.createBindGroup({
      layout:pipelineRender.getBindGroupLayout(0),
      entries:[
        {binding:0, resource:{buffer:posBuf}},
        {binding:1, resource:{buffer:uniformBuf}},
        {binding:2, resource:{buffer:uniformBuf, offset:32, size:16}},
      ]
    });

    function hexToRgb(h){ const x=parseInt(h.slice(1),16); return [(x>>16&255)/255,(x>>8&255)/255,(x&255)/255]; }

    function frame(){
      if(!running){ requestAnimationFrame(frame); return; }
      const now = performance.now();
      const dt = Math.min(0.033, (now-last)/1000);
      last = now;
      frames++;
      if(now-lastFps>500){
        fps = Math.round(frames*1000/(now-lastFps));
        frames=0; lastFps=now;
        elFps.textContent = String(fps);
      }
      sampleAudio();

      const time = now*0.001;
      const aspect = W/H;
      const u = new Float32Array([time, dt, aspect, modeIndex]);
      const u2 = new Float32Array([touch.x, touch.y, audioLevel, 0]);
      const c = hexToRgb(THEMES[themeIndex].a);
      const col = new Float32Array([c[0], c[1], c[2], 1]);
      const encoder = device.createCommandEncoder();
      const queue = device.queue;
      queue.writeBuffer(uniformBuf, 0, u.buffer);
      queue.writeBuffer(uniformBuf, 16, u2.buffer);
      queue.writeBuffer(uniformBuf, 32, col.buffer);

      { const pass = encoder.beginComputePass(); pass.setPipeline(pipelineCompute); pass.setBindGroup(0, bindCompute); pass.dispatchWorkgroups(Math.ceil(COUNT/256)); pass.end(); }
      {
        const view = ctx.getCurrentTexture().createView();
        const pass = encoder.beginRenderPass({colorAttachments:[{view, clearValue:{r:0,g:0,b:0,a:1}, loadOp:'clear', storeOp:'store'}]});
        pass.setPipeline(pipelineRender);
        pass.setBindGroup(0, bindRender);
        pass.draw(COUNT,1,0,0);
        pass.end();
      }
      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { backend:'WebGPU', count:COUNT };
  }

  // Canvas2D FALLBACK
  function initCanvasFallback(){
    const ctx = canvas.getContext('2d');
    const COUNT = Math.min(60000, Math.floor((W*H)/5));
    const P = new Float32Array(COUNT*4); // x,y,vx,vy
    for(let i=0;i<COUNT;i++){
      P[i*4+0] = Math.random()*W;
      P[i*4+1] = Math.random()*H;
      P[i*4+2] = (Math.random()*2-1)*0.2;
      P[i*4+3] = (Math.random()*2-1)*0.2;
    }
    function hex(h){ return [int(h[1:3],16),int(h[3:5],16),int(h[5:7],16)] }
    function frame(){
      if(!running){ requestAnimationFrame(frame); return; }
      const now = performance.now();
      const dt = Math.min(0.033, (now-last)/1000);
      last = now;
      frames++;
      if(now-lastFps>500){
        fps = Math.round(frames*1000/(now-lastFps));
        frames=0; lastFps=now;
        elFps.textContent = String(fps);
      }
      sampleAudio();

      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#060a12';
      ctx.fillRect(0,0,W,H);

      const col = THEMES[themeIndex];
      // physics
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
      ctx.globalCompositeOperation='lighter';
      for(let i=0;i<COUNT;i++){
        const idx=i*4;
        const x=P[idx], y=P[idx+1];
        const r = 0.6 + ((i%1000)/1000)*0.8 + audioLevel*0.8;
        const k = i%3;
        if(k===0) ctx.fillStyle='rgba(123,209,255,0.6)';
        else if(k===1) ctx.fillStyle='rgba(45,212,191,0.6)';
        else ctx.fillStyle='rgba(167,139,250,0.6)';
        ctx.beginPath(); ctx.arc(x,y,r,0,6.283); ctx.fill();
      }
      ctx.globalCompositeOperation='source-over';
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { backend:'Canvas2D (Lite)', count:COUNT };
  }

  function loop(){ /* renderer has own loop */ }

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }
})();