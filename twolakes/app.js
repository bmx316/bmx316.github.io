/* Two Lakes AI */
(() => {
  // ---- Contact details: fill these in and the site wires them up everywhere. ----
  const CONFIG = {
    email: '',   // e.g. 'hello@yourdomain.com'
    phone: ''    // e.g. '(952) 555-0100'
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  document.documentElement.classList.add('js');
  $('#yr').textContent = new Date().getFullYear();

  /* ---------- Reveal ---------- */
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -12% 0px' });
    $$('[data-reveal]').forEach(el => io.observe(el));
  } else $$('[data-reveal]').forEach(el => el.classList.add('in'));

  /* ---------- Time of day, driven by scroll ---------- */
  const stops = $$('[data-hour]');
  let anchors = [];
  const measure = () => {
    anchors = stops.map(el => {
      const r = el.getBoundingClientRect();
      return { y: r.top + scrollY + r.height / 2, h: +el.dataset.hour, dim: +el.dataset.dim, scrim: +el.dataset.scrim };
    });
  };
  const stateAt = y => {
    if (y <= anchors[0].y) return anchors[0];
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (y <= b.y) {
        let t = (y - a.y) / Math.max(1, b.y - a.y); t = t * t * (3 - 2 * t);
        return { h: lerp(a.h, b.h, t), dim: lerp(a.dim, b.dim, t), scrim: lerp(a.scrim, b.scrim, t) };
      }
    }
    return anchors[anchors.length - 1];
  };
  const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
  // hour, sky top, horizon, sun colour, sun x, sun y, stars, moon
  const KEYS = [
    [5.0,  '#04060e', '#12142a', '#000000', .72, .28, 1,  0],
    [5.6,  '#0a1030', '#7a3558', '#52201c', .72, .34, .7, 0],
    [6.3,  '#1d3566', '#f08a5a', '#ff9648', .72, .41, .1, 0],
    [7.2,  '#2a5a98', '#f2b888', '#ffd49a', .73, .52, 0,  0],
    [9.5,  '#1f6cba', '#8cc4e6', '#fff0d0', .75, .80, 0,  0],
    [13.0, '#1763b6', '#86c2ea', '#fff4dc', .76, 1.2, 0,  0],
    [16.5, '#2262aa', '#c4d2c4', '#ffe6b0', .75, .74, 0,  0],
    [18.6, '#34508e', '#f2b46c', '#ffc070', .73, .56, 0,  0],
    [20.0, '#3a3676', '#f6884e', '#ff8a40', .72, .45, 0,  0],
    [20.6, '#272260', '#ec5a50', '#ff5e34', .72, .40, .1, 0],
    [21.3, '#100f34', '#63315e', '#3a1024', .72, .34, .55, .2],
    [22.4, '#070a20', '#1a1c3c', '#000000', .72, .28, .9, .8],
    [24.0, '#03050c', '#0c1226', '#000000', .72, .28, 1,  1]
  ].map(k => ({ h: k[0], top: hex(k[1]), hor: hex(k[2]), sun: hex(k[3]), sx: k[4], sy: k[5], stars: k[6], moon: k[7] }));
  const skyAt = h => {
    h = clamp(h, KEYS[0].h, KEYS[KEYS.length - 1].h);
    let i = 1; while (i < KEYS.length - 1 && KEYS[i].h < h) i++;
    const a = KEYS[i - 1], b = KEYS[i], t = (h - a.h) / (b.h - a.h), m = (x, y) => x.map((v, j) => lerp(v, y[j], t));
    return { top: m(a.top, b.top), hor: m(a.hor, b.hor), sun: m(a.sun, b.sun), sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t), stars: lerp(a.stars, b.stars, t), moon: lerp(a.moon, b.moon, t) };
  };
  const clockEl = $('#clock'), nav = $('#nav');
  const fmt = h => {
    h = h % 24; let hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const ap = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12;
    return `${hh}:${String(mm).padStart(2, '0')} ${ap}`;
  };

  /* ---------- The lake (WebGL) ---------- */
  const cv = $('#scene');
  const gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const FRAG = `
precision highp float;
uniform vec2 uRes,uSunPos,uMouse,uMoonPos;uniform float uT,uStars,uMoon,uDim,uScrim;uniform vec3 uTop,uHor,uSun;
const float H=.40;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*noise(p);p*=2.03;a*=.5;}return s;}
float tree(float x){return H+.006+.03*fbm(vec2(x*1.7,3.))*smoothstep(-.2,.6,sin(x*1.3+1.))+.007*noise(vec2(x*60.,1.))+.004*noise(vec2(x*160.,7.));}
vec3 sky(vec2 uv,float asp){
  float g=clamp((uv.y-H)/(1.-H),0.,1.);
  vec3 c=mix(uHor,uTop,pow(g,.6));
  vec2 d=vec2((uv.x-uSunPos.x)*asp,uv.y-uSunPos.y);float r=length(d);
  c+=uSun*(.6*exp(-r*r*16.)+.3*exp(-r*3.));
  c+=uSun*.25*exp(-abs(uv.y-H)*14.)*exp(-abs(d.x)*1.6);
  float cl=fbm(vec2(uv.x*asp*1.3+uT*.006,uv.y*8.));
  cl=smoothstep(.5,.82,cl)*smoothstep(H+.02,H+.3,uv.y)*(1.-smoothstep(.75,1.,uv.y));
  c=mix(c,mix(uHor,vec3(1.),.2)+uSun*.3,cl*.4);
  float lit=smoothstep(.02,.3,uSun.r);
  c+=vec3(1.,.9,.7)*lit*(.9*exp(-r*r*260.)+.35*exp(-r*r*40.));
  c=mix(c,max(c,vec3(1.9,1.75,1.5)),smoothstep(.05,.036,r)*lit);
  vec2 md=vec2((uv.x-uMoonPos.x)*asp,uv.y-uMoonPos.y);float mr=length(md);
  c+=uMoon*(vec3(.9,.93,1.)*smoothstep(.034,.03,mr)*(.85+.15*noise(md*60.))+vec3(.35,.42,.6)*.35*exp(-mr*7.));
  return c;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;float asp=uRes.x/uRes.y;vec3 col;
  vec3 shore=mix(vec3(.008,.014,.02),uHor*.16,.55);
  if(uv.y>=H){
    col=sky(uv,asp);
    vec2 g=uv*vec2(asp,1.)*110.;vec2 id=floor(g);float s=hash(id);
    vec2 o=vec2(hash(id+3.1),hash(id+7.7))-.5;
    float st=step(.975,s)*smoothstep(.22,0.,length(fract(g)-.5-o*.5))*(.55+.45*sin(uT*1.7+s*90.));
    col+=st*uStars*smoothstep(H,H+.22,uv.y)*vec3(.9,.95,1.);
    if(uv.y<tree(uv.x*asp))col=shore;
  }else{
    float d=(H-uv.y)/H;float z=1./(d+.06);
    vec2 w=vec2((uv.x-.5)*asp*z,z);
    float n=noise(w*vec2(2.,5.)+vec2(uT*.12,uT*.45))*.6+noise(w*vec2(5.,14.)-vec2(uT*.2,uT*.7))*.4;
    vec2 m=vec2((uv.x-uMouse.x)*asp,(uv.y-uMouse.y)*2.6);float ml=length(m);
    n+=sin(ml*64.-uT*5.)*exp(-ml*8.)*.7*step(uMouse.y,H);
    vec2 ruv=vec2(uv.x+(n-.5)*.035*(d+.12),H+(H-uv.y)*1.2+(n-.5)*.12*(d+.08));
    ruv.y=max(ruv.y,H+.002);
    vec3 refl=sky(ruv,asp);
    if(ruv.y<tree(ruv.x*asp))refl=mix(refl,shore,.88);
    vec3 deep=mix(uTop*.3,vec3(.006,.02,.035),.55);
    col=mix(refl*.85,deep,.2+.5*d);
    float gx=abs((uv.x-uSunPos.x)*asp);
    float n2=noise(w*vec2(7.,46.)+vec2(uT*.3,uT*1.1))*.65+noise(w*vec2(15.,90.)-vec2(uT*.2,uT*.9))*.35;
    float fade=1.-.75*smoothstep(.25,1.,d);
    float gli=smoothstep(.03+.2*d,0.,gx)*pow(n2,4.)*5.*fade*smoothstep(H-.07,H+.04,uSunPos.y);
    float mx=abs((uv.x-uMoonPos.x)*asp);
    gli+=smoothstep(.015+.1*d,0.,mx)*pow(n2,5.)*3.*fade*uMoon;
    col+=(uSun+uMoon*vec3(.5,.6,.8))*gli;
    col+=uHor*.12*exp(-d*30.);
  }
  col*=1.-uScrim*.62*smoothstep(.85,.05,uv.x);
  col*=1.-uDim;
  vec2 v=uv-.5;col*=1.-dot(v,v)*.55;
  col+=(hash(gl_FragCoord.xy+fract(uT)*100.)-.5)*.035;
  gl_FragColor=vec4(col,1.);
}`;
  let U = null;
  if (gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    const fs = sh(gl.FRAGMENT_SHADER, FRAG); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      U = {}; ['uRes', 'uSunPos', 'uMouse', 'uMoonPos', 'uT', 'uStars', 'uMoon', 'uDim', 'uScrim', 'uTop', 'uHor', 'uSun'].forEach(n => U[n] = gl.getUniformLocation(pr, n));
    } else { console.warn(gl.getShaderInfoLog(fs)); cv.style.display = 'none'; }
  } else cv.style.display = 'none';

  const mouse = { x: .5, y: 2, tx: .5, ty: 2 };
  addEventListener('pointermove', e => { mouse.tx = e.clientX / innerWidth; mouse.ty = 1 - e.clientY / innerHeight; }, { passive: true });
  const resize = () => {
    const d = Math.min(devicePixelRatio || 1, innerWidth < 800 ? 1.25 : 1.5);
    cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d);
    if (gl) gl.viewport(0, 0, cv.width, cv.height);
    measure();
  };
  let cur = null;
  const frame = ms => {
    const target = stateAt(scrollY + innerHeight / 2);
    if (!cur || reduced) cur = { ...target };
    else { cur.h = lerp(cur.h, target.h, .08); cur.dim = lerp(cur.dim, target.dim, .08); cur.scrim = lerp(cur.scrim, target.scrim, .08); }
    clockEl.textContent = fmt(cur.h);
    nav.classList.toggle('stuck', scrollY > 40);
    if (U) {
      const s = skyAt(cur.h), narrow = innerWidth < 900;
      mouse.x = lerp(mouse.x, mouse.tx, .08); mouse.y = lerp(mouse.y, mouse.ty, .08);
      gl.uniform2f(U.uRes, cv.width, cv.height);
      gl.uniform1f(U.uT, reduced ? 0 : ms / 1000);
      gl.uniform3fv(U.uTop, s.top); gl.uniform3fv(U.uHor, s.hor); gl.uniform3fv(U.uSun, s.sun);
      gl.uniform2f(U.uSunPos, s.sx, narrow ? s.sy + Math.max(0, s.sy - .5) * 3 : s.sy);
      gl.uniform2f(U.uMoonPos, narrow ? .84 : .9, narrow ? .9 : .84);
      gl.uniform2f(U.uMouse, mouse.x, mouse.y);
      gl.uniform1f(U.uStars, s.stars); gl.uniform1f(U.uMoon, narrow ? s.moon * .5 : s.moon);
      gl.uniform1f(U.uDim, narrow ? Math.max(cur.dim, cur.scrim * .45) : cur.dim);
      gl.uniform1f(U.uScrim, narrow ? 0 : cur.scrim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!reduced) requestAnimationFrame(frame);
  };
  resize();
  addEventListener('resize', resize);
  addEventListener('load', measure);
  document.fonts?.ready.then(measure);
  if (reduced) { addEventListener('scroll', () => frame(0), { passive: true }); frame(0); }
  else requestAnimationFrame(frame);

  /* ---------- Before / after ---------- */
  const cmp = $('#cmp'), cmpBox = cmp.parentElement;
  const setCmp = () => cmpBox.style.setProperty('--x', cmp.value + '%');
  cmp.addEventListener('input', setCmp); setCmp();

  /* ---------- Wireframe knob ---------- */
  const wc = $('#wire'), w2 = wc.getContext('2d');
  const SEG = 72, rings = [], edges = [];
  const ring = (rf, z) => { const s = rings.length; for (let i = 0; i < SEG; i++) { const a = i / SEG * Math.PI * 2, r = rf(a); rings.push([Math.cos(a) * r, Math.sin(a) * r, z]); } return s; };
  const loop = s => { for (let i = 0; i < SEG; i++) edges.push([s + i, s + (i + 1) % SEG]); };
  const link = (a, b, step) => { for (let i = 0; i < SEG; i += step) edges.push([a + i, b + i]); };
  const lobed = a => 1 + .11 * Math.cos(a * 9), hole = () => .3, mid = () => .62;
  const A = ring(lobed, -.34), B = ring(lobed, .34), C = ring(mid, .46), D = ring(hole, .46), E = ring(hole, -.34);
  [A, B, C, D, E].forEach(loop); link(A, B, 2); link(B, C, 4); link(C, D, 6); link(D, E, 8);
  let ry = .6, rx = -1.05, vy = .006, drag = null;
  wc.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; wc.setPointerCapture(e.pointerId); wc.style.cursor = 'grabbing'; });
  wc.addEventListener('pointermove', e => { if (!drag) return; ry += (e.clientX - drag.x) * .01; rx = clamp(rx + (e.clientY - drag.y) * .01, -1.5, -.2); drag = { x: e.clientX, y: e.clientY }; });
  const end = () => { drag = null; wc.style.cursor = 'grab'; };
  wc.addEventListener('pointerup', end); wc.addEventListener('pointercancel', end);
  let wireOn = false;
  new IntersectionObserver(([e]) => { wireOn = e.isIntersecting; }).observe(wc);
  const drawWire = () => {
    const W = wc.width, Hh = wc.height, S = Hh * .36;
    w2.clearRect(0, 0, W, Hh);
    const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    const P = rings.map(([x, y, z]) => {
      const x1 = x * cy - y * sy, y1 = x * sy + y * cy;      // spin about the knob's axis
      const y2 = y1 * cx - z * sx, z2 = y1 * sx + z * cx;    // tilt toward the viewer
      const p = 3.4 / (3.4 + z2);
      return [W / 2 + x1 * S * p, Hh / 2 + y2 * S * p, z2];
    });
    w2.lineWidth = 1.6;
    for (const [a, b] of edges) {
      const za = (P[a][2] + P[b][2]) / 2, al = clamp(.62 - za * .5, .1, 1);
      w2.strokeStyle = `rgba(255,190,110,${al})`;
      w2.beginPath(); w2.moveTo(P[a][0], P[a][1]); w2.lineTo(P[b][0], P[b][1]); w2.stroke();
    }
  };
  const wireTick = () => { if (wireOn) { if (!drag) ry += vy; drawWire(); } requestAnimationFrame(wireTick); };
  drawWire(); if (!reduced) requestAnimationFrame(wireTick);
  else wc.addEventListener('pointermove', drawWire);

  /* ---------- Persona explorer ---------- */
  const P = {
    home: [
      { n: 'Busy family', t: 'A calmer week for a busy family', step: ['AI setup, at your place', '$199 flat'], i: [
        ['One calendar that runs itself', 'School emails, practices, and appointments pulled into one plan, with reminders to the right person.'],
        ['Dinner, lists, and errands handled', 'A week of meals from what’s in the fridge, a grocery list, and a shopping agent that finds the best price.'],
        ['Homework help that teaches', 'An assistant set up to explain and quiz, not just hand over answers.']] },
      { n: 'Retiree', t: 'Confident with AI, at your own pace', step: ['One-on-one AI help', '$125 / hour'], i: [
        ['Ask anything, out loud', 'Talk to your phone like a patient friend: letters, recipes, travel plans, how to fix the thing.'],
        ['Spot scams and fakes', 'Learn how to tell an edited photo or a suspicious message before it costs you.'],
        ['Paperwork made plain', 'Long letters, statements, and forms explained in a paragraph you can trust and check.']] },
      { n: 'Solo pro', t: 'A one-person shop with a full back office', step: ['AI setup, at your place', '$199 flat'], i: [
        ['An assistant for email and calendar', 'Triage, replies drafted in your voice, and meetings booked without the back-and-forth.'],
        ['Research in minutes', 'A cited brief on a client, a market, or a decision, ready before your coffee is.'],
        ['The right plan, not three', 'One AI subscription that fits how you work, connected to the tools you already use.']] },
      { n: 'Maker', t: 'From idea to object, faster', step: ['Maker and 3D/CAD session', 'By quote'], i: [
        ['Sketch to 3D model', 'A drawing or a description becomes CAD you can edit, print, or cut.'],
        ['Laser and metal-cut designs', 'Clean cut files for signs, brackets, and art without wrestling the software.'],
        ['Scan a room, get a floor plan', 'Walk around with your phone’s LiDAR and come away with a usable plan.']] }
    ],
    work: [
      { n: 'Contractor', t: 'A contractor’s week, with AI', step: ['Small-business AI audit', '$750'], i: [
        ['Quotes from the job site', 'Photos and a voice note become an itemized quote, waiting for your approval.'],
        ['Follow-ups that never slip', 'Every lead gets a timely reply, and every finished job gets a review request.'],
        ['A morning dashboard', 'Today’s jobs, unpaid invoices, and open bids on one page.']] },
      { n: 'Salon', t: 'A fuller book with less front-desk time', step: ['Small-business AI audit', '$750'], i: [
        ['Fewer no-shows', 'Friendly reminders and easy rebooking that sound like you, not a robot.'],
        ['Social posts from your own photos', 'Before-and-afters turned into a week of posts and a short video.'],
        ['Messages answered after hours', 'Common questions get a helpful reply, and anything unusual waits for you.']] },
      { n: 'Shop', t: 'A small shop that sells like a big one', step: ['Websites and marketing content', 'By quote'], i: [
        ['Product photos without a studio', 'Phone shots become clean, consistent images for your site and marketplace listings.'],
        ['Listings that get found', 'Titles and descriptions written for both shoppers and the AI agents that now shop for them.'],
        ['A simple online store', 'A site that takes payments, built in days by describing what you want.']] },
      { n: 'Restaurant', t: 'More time in the kitchen, less in the office', step: ['Custom automations', '$1,500 – $4,000'], i: [
        ['Reviews answered thoughtfully', 'Drafted replies to every review, ready for a quick read and send.'],
        ['Specials and menus on the fly', 'Tonight’s special becomes a printed insert, a post, and a website update at once.'],
        ['A daily numbers summary', 'Sales, covers, and notes from last night in your inbox each morning.']] },
      { n: 'Real estate', t: 'Listings and follow-up on autopilot', step: ['Custom automations', '$1,500 – $4,000'], i: [
        ['Listing copy and visuals', 'Descriptions, floor plans from a phone scan, and short video walkthroughs.'],
        ['Every lead answered fast', 'Inquiries get a personal first reply and land on your calendar.'],
        ['Market briefs for clients', 'A clear, sourced neighborhood summary you review and send under your name.']] },
      { n: 'Marina', t: 'A smoother season on the water', step: ['Small-business AI audit', '$750'], i: [
        ['Slip and service requests sorted', 'Messages triaged into bookings, service tickets, and questions.'],
        ['Seasonal messages sent on time', 'Launch, haul-out, and storage reminders that go out without a scramble.'],
        ['One view of the busy weekend', 'Reservations, staff, and weather on a single page.']] }
    ]
  };
  const chips = $('#chips'), card = $('#personaCard');
  let mode = 'home';
  const showPersona = p => {
    card.innerHTML = `<h3>${p.t}</h3><ol>${p.i.map(([b, s]) => `<li><b>${b}</b><span>${s}</span></li>`).join('')}</ol>
      <div class="first"><div><small>A good first step</small><b>${p.step[0]} · ${p.step[1]}</b></div><a class="btn btn-s" href="#contact">Let’s talk</a></div>`;
  };
  const renderChips = () => {
    chips.innerHTML = '';
    P[mode].forEach((p, idx) => {
      const b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = p.n; b.setAttribute('aria-pressed', idx === 0);
      b.onclick = () => { $$('.chip', chips).forEach(c => c.setAttribute('aria-pressed', c === b)); showPersona(p); };
      chips.append(b);
    });
    showPersona(P[mode][0]);
  };
  $$('.seg button').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$('.seg button').forEach(x => x.setAttribute('aria-selected', x === b));
    renderChips(); measure();
  });
  renderChips();

  /* ---------- Calculator ---------- */
  const ranges = $$('#sliders input'), yrEl = $('#hrsYear');
  let shown = 0, goal = 0, anim = 0;
  const roll = () => {
    shown = Math.abs(goal - shown) < 1 ? goal : lerp(shown, goal, .18);
    yrEl.textContent = Math.round(shown);
    anim = shown === goal ? 0 : requestAnimationFrame(roll);
  };
  const calc = () => {
    let total = 0;
    ranges.forEach(r => {
      total += +r.value;
      r.style.setProperty('--p', (r.value / r.max * 100) + '%');
      $(`[data-out="${r.dataset.k}"]`).textContent = r.value + ' hrs/wk';
    });
    const wk = total / 3; goal = Math.round(wk * 48);
    $('#hrsWeek').textContent = (Math.round(wk * 10) / 10).toString();
    $('#workWeeks').textContent = (Math.round(goal / 40 * 10) / 10).toString();
    if (reduced) { shown = goal; yrEl.textContent = goal; } else if (!anim) anim = requestAnimationFrame(roll);
  };
  ranges.forEach(r => r.addEventListener('input', calc)); calc();

  /* ---------- Contact ---------- */
  const bits = [];
  if (CONFIG.phone) bits.push(`Call or text <a href="tel:${CONFIG.phone.replace(/[^\d+]/g, '')}">${CONFIG.phone}</a>`);
  if (CONFIG.email) bits.push(`Email <a href="mailto:${CONFIG.email}">${CONFIG.email}</a>`);
  $('#direct').innerHTML = bits.join('<br>');
  const form = $('#hello'), note = $('#formNote');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = Object.fromEntries(new FormData(form));
    const body = `Hi Troy,\n\n${d.msg}\n\nThis is for: ${d.who === 'Home' ? 'me or my family' : 'my business'}${d.town ? '\nTown: ' + d.town : ''}\nBest way to reach me: ${d.reach}\n\n${d.name}`;
    note.className = 'note';
    if (CONFIG.email) {
      location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent('AI help for ' + d.name)}&body=${encodeURIComponent(body)}`;
      note.textContent = 'Your email app should open with the message ready. Just press send.';
    } else {
      note.classList.add('box'); note.textContent = body;
      navigator.clipboard?.writeText(body).then(() => { note.textContent = body + '\n\n(Copied to your clipboard.)'; }).catch(() => {});
    }
    measure();
  });
})();
