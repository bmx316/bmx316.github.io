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
  document.documentElement.classList.add('js');
  $('#yr').textContent = new Date().getFullYear();

  /* Nav */
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('stuck', scrollY > innerHeight * 0.75);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* Reveal on scroll */
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach((el, i) => { el.style.transitionDelay = (i % 4) * 60 + 'ms'; io.observe(el); });
  } else $$('.reveal').forEach(el => el.classList.add('in'));

  /* Hero: cycling asks */
  const asks = [
    ['Sort my inbox before I wake up.', 'By 7am: six emails that need you, drafts already written, the rest filed.'],
    ['Write the quote while I’m still on the job site.', 'Photos and a voice note in, a clean itemized quote out, ready for you to approve.'],
    ['Turn this napkin sketch into something I can 3D print.', 'A real 3D model you can spin around, tweak, and send to the printer.'],
    ['Make my products look like a magazine shoot.', 'Phone snapshots become clean product photos and a short video for social.'],
    ['Keep the whole family’s calendar straight.', 'One shared plan for the week, with reminders that go to the right person.'],
    ['Give me one page that tells me how the business did today.', 'Sales, bookings, and loose ends on a single dashboard every morning.']
  ];
  const askText = $('#askText'), askAnswer = $('#askAnswer');
  if (!reduced) {
    let i = 0;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    (async function loop() {
      await sleep(4200);
      for (;;) {
        i = (i + 1) % asks.length;
        const [q, a] = asks[i];
        askAnswer.classList.add('hide');
        for (let n = askText.textContent.length; n >= 0; n -= 3) { askText.textContent = askText.textContent.slice(0, n); await sleep(12); }
        const full = '“' + q + '”';
        for (let n = 1; n <= full.length; n++) { askText.textContent = full.slice(0, n); await sleep(28); }
        await sleep(350);
        askAnswer.textContent = a; askAnswer.classList.remove('hide');
        await sleep(4600);
      }
    })();
  }

  /* Hero: water */
  const cv = $('#water'), ctx = cv.getContext('2d');
  const layers = [
    { c: 'rgba(31,110,116,.55)', y: .30, a: 9,  l: 340, s: .35 },
    { c: 'rgba(19,80,90,.75)',   y: .44, a: 12, l: 260, s: -.5 },
    { c: 'rgba(12,56,66,.9)',    y: .58, a: 10, l: 420, s: .7 },
    { c: '#08202a',              y: .72, a: 13, l: 300, s: -.9 },
    { c: '#f6f1e7',              y: .90, a: 8,  l: 520, s: .55 }
  ];
  let W = 0, H = 0;
  const size = () => {
    const d = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  const draw = t => {
    ctx.clearRect(0, 0, W, H);
    for (const L of layers) {
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 12; x += 12) {
        const y = H * L.y + Math.sin(x / L.l * 6.283 + t * L.s) * L.a + Math.sin(x / (L.l * .37) * 6.283 - t * L.s * 1.6) * L.a * .3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = L.c; ctx.fill();
    }
    // sun glitter on the water
    const sx = W * .68;
    for (let k = 0; k < 9; k++) {
      const y = H * (.33 + k * .045), w = 70 - k * 5 + Math.sin(t * 1.3 + k) * 14;
      ctx.fillStyle = `rgba(255,226,160,${.28 - k * .026})`;
      ctx.fillRect(sx - w / 2 + Math.sin(t * .9 + k * 1.7) * 8, y, w, 2);
    }
  };
  size(); draw(0);
  addEventListener('resize', () => { size(); draw(0); });
  if (!reduced) {
    let on = true;
    new IntersectionObserver(([e]) => { on = e.isIntersecting; }).observe(cv);
    const tick = ms => { if (on) draw(ms / 1000); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  /* Persona explorer */
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
      <div class="first-step"><div>A good first step<b>${p.step[0]} · ${p.step[1]}</b></div><a class="btn btn-small" href="#contact">Let’s talk</a></div>`;
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
    renderChips();
  });
  renderChips();

  /* Calculator */
  const ranges = $$('#sliders input');
  const calc = () => {
    let total = 0;
    ranges.forEach(r => {
      total += +r.value;
      r.style.setProperty('--p', (r.value / r.max * 100) + '%');
      $(`[data-out="${r.dataset.k}"]`).textContent = r.value + ' hrs/wk';
    });
    const wk = total / 3, yr = Math.round(wk * 48);
    $('#hrsYear').textContent = yr;
    $('#hrsWeek').textContent = (Math.round(wk * 10) / 10).toString();
    $('#workWeeks').textContent = (Math.round(yr / 40 * 10) / 10).toString();
  };
  ranges.forEach(r => r.addEventListener('input', calc)); calc();

  /* Contact */
  const direct = $('#direct'), bits = [];
  if (CONFIG.phone) bits.push(`Call or text <a href="tel:${CONFIG.phone.replace(/[^\d+]/g, '')}">${CONFIG.phone}</a>`);
  if (CONFIG.email) bits.push(`Email <a href="mailto:${CONFIG.email}">${CONFIG.email}</a>`);
  direct.innerHTML = bits.join('<br>');

  const form = $('#hello'), note = $('#formNote');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = Object.fromEntries(new FormData(form));
    const body = `Hi Troy,\n\n${d.msg}\n\nThis is for: ${d.who === 'Home' ? 'me or my family' : 'my business'}${d.town ? '\nTown: ' + d.town : ''}\nBest way to reach me: ${d.reach}\n\n${d.name}`;
    note.className = 'form-note';
    if (CONFIG.email) {
      location.href = `mailto:${CONFIG.email}?subject=${encodeURIComponent('AI help for ' + d.name)}&body=${encodeURIComponent(body)}`;
      note.textContent = 'Your email app should open with the message ready. Just press send.';
    } else {
      note.classList.add('box');
      note.textContent = body;
      navigator.clipboard?.writeText(body).then(() => {
        note.textContent = body + '\n\n(Copied to your clipboard.)';
      }).catch(() => {});
    }
  });
})();
