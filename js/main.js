// Boot: load fonts + scene, wire scroll -> camera, on-screen beats, minimap, navigation, picking.
import { createMuseum } from './scene.js';
import { HALLS, HERO, TEXTS, EXHIBITS, BEATS } from './data.js';
import { createUI, h } from './ui.js';
import { renderChat } from './chat.js';

const $ = (id) => document.getElementById(id);
const intro = $('intro'), enterBtn = $('enter'), bar = $('bar');
const where = $('where'), card = $('card'), lower = $('lower'), beat = $('beat'), more = $('more'), map = $('map');
const dock = $('dock'), tip = $('tip'), rail = $('rail'), menu = $('menu'), space = $('scroll-space');

// ---- which version to run -------------------------------------------------------------------
// high = everything; low = no floor mirrors, lower resolution; lite = ultra-light for old laptops
// (small images, no lamps, glows or post-processing). Order of authority:
//   1. ?q=high|low|lite in the address (manual choice)   2. what a speed test decided on an earlier visit
//   3. a guess from the hardware, which the speed test then confirms or corrects (see boot()).
const MODES = ['lite', 'low', 'high'];
const forced = MODES.includes(new URLSearchParams(location.search).get('q')) ? new URLSearchParams(location.search).get('q') : null;
const remembered = (() => { try { const v = JSON.parse(localStorage.getItem('abm:mode') || 'null'); return v && MODES.includes(v.mode) && Date.now() - v.t < 30 * 864e5 ? v.mode : null; } catch { return null; } })();
function guessMode() {
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info'); gpu = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl?.getParameter(gl.RENDERER) || '');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL info: fall back to memory and cores */ }
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  const weakGpu = /intel[^,]*\b(hd|uhd) graphics|\bgma\b|mali-[4t]|adreno \(tm\) [2-5]\d\d|powervr|geforce (gt |gtx |)?[2-7]\d\dm?\b|radeon (hd|r[2-5])\b/i.test(gpu);
  if (software || (mem <= 4 && cores <= 4) || (weakGpu && (mem <= 4 || cores <= 2))) return 'lite';
  if (weakGpu || cores <= 4 || matchMedia('(max-width: 820px)').matches) return 'low';
  return 'high';
}
const mode = forced || remembered || guessMode();
const lite = mode === 'lite', lowPower = mode !== 'high';
const remember = (m) => { try { localStorage.setItem('abm:mode', JSON.stringify({ mode: m, t: Date.now() })); } catch { /* private window */ } };
const SEG_VH = 0.62;                                  // scroll distance per camera stop, in viewport heights
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

async function boot() {
  // canvas text needs the web fonts (incl. Kazakh glyphs) before the scene draws its labels
  try {
    await Promise.all(['600 60px "Cormorant Garamond"', '700 60px "Cormorant Garamond"', 'italic 500 60px "Cormorant Garamond"', '400 30px "Golos Text"', '600 30px "Golos Text"']
      .map((f) => document.fonts.load(f, 'ӘЛИХАН БӨКЕЙХАН әғқңөұүһі')));
  } catch { /* fall back to system serif */ }

  let museum;
  try {
    museum = await createMuseum({ canvas: $('gl'), halls: HALLS, hero: HERO, texts: TEXTS, lowPower, lite, onLoad: (p) => { bar.style.width = `${Math.round(p * 100)}%`; } });
  } catch (err) {
    console.error(err);
    enterBtn.textContent = '3D көрініс іске қосылмады';
    intro.querySelector('.intro__hint').textContent = 'Браузеріңде WebGL қосулы екенін тексер немесе залдарды мәзір арқылы аш.';
    museum = null;
  }
  // Speed test: measure what a frame really costs on this machine and correct the guess.
  // Too slow -> reload once into the ultra-light version; a bit slow -> drop mirrors/resolution on the spot;
  // an ultra-light start on a machine that turns out to be fast -> step up. The result is remembered for next time.
  let verdict = mode;
  if (museum && !forced) {
    let switched = false; try { switched = sessionStorage.getItem('abm:switched') === '1'; } catch { /* ignore */ }
    const ms = Number(new URLSearchParams(location.search).get('bench')) || museum.bench();     // ?bench=<ms> fakes the result, for testing the switch
    if (!lite && ms > 40) verdict = 'lite';
    else if (lite && ms < 1.5 && !remembered) verdict = 'low';
    else if (mode === 'high' && ms > 18) { museum.lowerQuality(); if (ms > 28) museum.lowerQuality(); verdict = 'low'; }
    else if (mode === 'low' && ms > 26) museum.lowerQuality();
    remember(verdict);
    if ((verdict === 'lite') !== lite && !switched) {                 // needs a different build of the scene: reload once
      try { sessionStorage.setItem('abm:switched', '1'); } catch { /* ignore */ }
      enterBtn.textContent = verdict === 'lite' ? 'Жеңіл нұсқа қосылуда…' : 'Жүктелуде…';
      location.reload(); return;
    }
  }
  const ui = createUI({ onClose: () => museum?.setPaused(ui?.busy) });
  window.__museum = museum; window.__ui = ui;                 // handy in the console for debugging

  // ---- camera stops -> scroll geometry ----
  const keys = museum ? museum.keys : [{ hall: 0, kind: 'title', mod: 'rot' }];
  const N = keys.length;
  const setSpace = () => { space.style.height = `${Math.round(window.innerHeight * (1 + SEG_VH * (N - 1)))}px`; };
  setSpace(); window.addEventListener('resize', setSpace);
  const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;
  const progress = () => (maxScroll() > 0 ? window.scrollY / maxScroll() : 0);
  const keyIndex = (hall, kind) => keys.findIndex((k) => k.hall === hall && k.kind === kind);
  const goKey = (i, smooth = true) => window.scrollTo({ top: (i / (N - 1)) * maxScroll(), behavior: smooth ? 'smooth' : 'auto' });
  const goHall = (hall) => { closeMenu(); ui.closeSheet(); goKey(hall === 0 ? 1 : hall > HALLS.length ? N - 1 : keyIndex(hall, 'left')); };
  const hallOf = (key) => (key.mod?.startsWith('h') ? HALLS[key.hall - 1] : null);
  const sheetLabel = (hl) => (hl.id === 'talk' ? 'Сұхбатты бастау' : hl.id === 'quiz' ? 'Тапсырмаларды ашу' : 'Толық экспозиция');

  // ---- rail + menu ----
  const stops = [{ hall: 0, num: '◆', label: 'Кіреберіс' }, ...HALLS.map((x, i) => ({ hall: i + 1, num: x.num, label: x.title })), { hall: HALLS.length + 1, num: '✦', label: 'Болашаққа' }];
  rail.append(...stops.map((s) => h('button', { 'aria-label': s.label, dataset: { hall: s.hall }, onclick: () => goHall(s.hall) }, h('span', { class: 'lbl' }, s.label), h('span', { class: 'num' }, h('span', null, s.num)))));
  menu.append(h('ol', null, stops.map((s) => h('li', null, h('button', { onclick: () => goHall(s.hall) }, h('span', { class: 'n' }, s.hall === 0 ? '00' : s.hall > HALLS.length ? '✦' : s.num), h('span', { class: 't' }, s.label),
    h('span', { class: 'o' }, s.hall >= 1 && s.hall <= HALLS.length ? HALLS[s.hall - 1].short : ''))))));
  function closeMenu() { menu.classList.remove('is-on'); menu.setAttribute('aria-hidden', 'true'); ui.lock(); }
  $('btn-halls').addEventListener('click', () => { const on = menu.classList.toggle('is-on'); menu.setAttribute('aria-hidden', String(!on)); ui.lock(); });
  menu.addEventListener('click', (e) => { if (e.target === menu) closeMenu(); });
  $('btn-sources').addEventListener('click', () => { closeMenu(); ui.openSheet('sources'); });
  $('home').addEventListener('click', () => goKey(0));

  // ---- minimap: the plan of the museum with a dot where you are ----
  let dot = null, mapBox = null;
  if (museum?.plan?.length) {
    const NS = 'http://www.w3.org/2000/svg', el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const xs = museum.plan.flatMap((r) => [r.r[0], r.r[1]]), zs = museum.plan.flatMap((r) => [r.r[2], r.r[3]]);
    mapBox = { x: Math.min(...xs) - 4, z: Math.min(...zs) - 4, w: Math.max(...xs) - Math.min(...xs) + 8, h: Math.max(...zs) - Math.min(...zs) + 8 };
    const svg = el('svg', { viewBox: `${mapBox.x} ${mapBox.z} ${mapBox.w} ${mapBox.h}`, role: 'img', 'aria-label': 'Музей жоспары' });
    for (const r of museum.plan) {
      const hl = r.kind === 'hall' ? HALLS[r.hall - 1] : null;
      const fill = hl ? hex(hl.color) : r.kind === 'rotunda' ? '#c9a25f' : r.kind === 'stairs' ? '#8d7f6a' : r.kind === 'terrace' ? '#d79aa6' : '#5c4d3d';
      const rect = el('rect', { x: r.r[0], y: r.r[2], width: r.r[1] - r.r[0], height: r.r[3] - r.r[2], rx: 1.2, fill, class: `room room--${r.kind}${r.lv >= 1 ? ' is-upper' : ''}` });
      if (hl || r.kind === 'rotunda' || r.kind === 'terrace') { rect.style.cursor = 'pointer'; rect.addEventListener('click', () => goHall(r.kind === 'terrace' ? HALLS.length + 1 : r.hall)); }
      svg.append(rect);
      if (r.kind === 'stairs') for (let k = 1; k < 6; k++) {                    // tread lines
        const wide = r.r[1] - r.r[0] > r.r[3] - r.r[2];
        svg.append(wide ? el('line', { x1: r.r[0] + (r.r[1] - r.r[0]) * k / 6, x2: r.r[0] + (r.r[1] - r.r[0]) * k / 6, y1: r.r[2] + 2, y2: r.r[3] - 2, class: 'tread' })
          : el('line', { y1: r.r[2] + (r.r[3] - r.r[2]) * k / 6, y2: r.r[2] + (r.r[3] - r.r[2]) * k / 6, x1: r.r[0] + 2, x2: r.r[1] - 2, class: 'tread' }));
      }
      if (hl) { const t = el('text', { x: (r.r[0] + r.r[1]) / 2, y: (r.r[2] + r.r[3]) / 2 + 2.6, class: 'num' }); t.textContent = hl.num; svg.append(t); }
    }
    dot = el('circle', { r: 2.6, class: 'me' }); svg.append(el('circle', { r: 5.5, class: 'me-halo' }), dot);
    map.append(svg, h('span', { id: 'map-level' }, '1-қабат'));
  }

  // ---- the only card left: the finale ----
  const btn = (label, fn, gold) => h('button', { class: `btn btn--sm${gold ? ' btn--gold' : ''}`, onclick: fn }, label);
  const finale = () => [h('p', { class: 'kicker' }, 'Сапар аяқталды'), h('h2', null, 'Ендігі сөз — сенікі'),
    h('p', null, 'Бір ғасыр бұрын Алаш арыстары көздеген ел бүгін осы даланың төрінде тұр. Оның ертеңі — бүгінгі ұрпақтың білімі мен мінезінде.'),
    h('p', { class: 'credit' }, 'Көрініс: Әулиетау, Қарағанды облысы. Фото: Astrobond, CC BY-SA 4.0'),
    h('div', { class: 'actions' }, btn('Білімді тексер', () => ui.openSheet('quiz'), true), btn('Пікір қалдыру', () => ui.openSheet('today')), btn('Дереккөздер', () => ui.openSheet('sources')), btn('Басына оралу', () => goKey(0)))];

  // ---- HUD: beats surface by themselves as the camera reaches each stop ----
  const fitBig = (el) => {                                   // the giant word always spans the block, whatever its length
    const len = Math.max(3, [...el.textContent].length), vw = window.innerWidth;
    el.style.fontSize = `${Math.round(Math.max(44, Math.min(vw * 0.15, (Math.min(vw, 1500) * 0.7) / (len * 0.58), 210)))}px`;
  };
  window.addEventListener('resize', () => fitBig(beat.children[0]));
  let shownKey = -1, shownHall = -2, entered = false, moreHall = null;
  // Hall V: the interview opens right on top of the museum instead of on a separate page
  // It opens by itself on arriving in hall V, and from anywhere with the «Сұхбат» button in the top bar.
  let dockOpen = false, inTalk = false, chatEl = null;
  const openDock = (focus) => { dockOpen = true; if (!chatEl) { chatEl = renderChat({ dock: true, onClose: () => { dockOpen = false; } }); dock.append(chatEl); } if (focus) setTimeout(() => chatEl.focusInput(), 350); };
  const openHall = (hl) => { if (hl.id === 'talk') openDock(true); else ui.openSheet(hl.id); };
  $('btn-talk').addEventListener('click', () => { closeMenu(); ui.closeSheet(); if (dockOpen) dockOpen = false; else openDock(true); });
  more.addEventListener('click', () => moreHall && openHall(moreHall));
  function hud() {
    const p = museum ? museum.progress : progress();
    const kf = p * (N - 1), k = Math.round(kf), dist = Math.abs(kf - k), key = keys[k];
    $('progress').style.width = `${(p * 100).toFixed(2)}%`;
    if (k !== shownKey) {
      shownKey = k;
      const isFinal = key.kind === 'final';
      if (isFinal) { card.replaceChildren(...finale()); card.dataset.side = 'center'; card.dataset.has = '1'; } else delete card.dataset.has;
      map.classList.toggle('is-off', isFinal);
      const b = entered ? BEATS[`${key.mod}:${key.kind}`] : null;
      beat.dataset.has = b ? '1' : '';
      if (b) {
        beat.children[0].textContent = b[0]; beat.children[1].textContent = b[1]; beat.children[2].textContent = b[2];
        beat.children[0].style.display = b[0] ? '' : 'none';
        fitBig(beat.children[0]);
        beat.classList.remove('is-in'); void beat.offsetWidth; beat.classList.add('is-in');      // replay the entrance
      }
      const hl = hallOf(key), isEnter = key.kind === 'enter' && hl;
      if (isEnter) { lower.children[0].textContent = `${hl.num} зал`; lower.children[1].textContent = hl.title; lower.children[2].textContent = hl.lead; }
      lower.dataset.on = isEnter ? '1' : '';
      moreHall = hl && key.kind !== 'enter' ? hl : null;
      const talk = !!hl && hl.id === 'talk' && key.kind !== 'enter';
      if (talk && !inTalk) openDock(false);                                   // arriving in the hall: the chat surfaces by itself
      if (!talk && inTalk) dockOpen = false;                                 // walking on: it steps aside
      inTalk = talk;
      if (moreHall) more.textContent = `${sheetLabel(moreHall)} ↗`;
    }
    card.classList.toggle('is-on', !!card.dataset.has && dist < 0.4 && entered);
    beat.style.opacity = beat.dataset.has && entered ? String(Math.min(1, Math.max(0, 1.7 - dist / 0.24))) : '0';
    const dockOn = dockOpen && entered && !ui.busy;
    dock.classList.toggle('is-on', dockOn); document.body.classList.toggle('has-dock', dockOn);
    more.classList.toggle('is-on', !!moreHall && entered && !ui.busy && !dockOn);
    lower.style.opacity = lower.dataset.on && entered ? String(Math.min(1, Math.max(0, 1.5 - dist / 0.3))) : '0';
    lower.style.transform = `translateY(${(kf - k) * -24}px)`;
    const tag = `${key.hall}:${key.mod}`;
    if (tag !== shownHall) {
      shownHall = tag; rail.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.hall) === key.hall));
      const hl = HALLS[key.hall - 1], inHall = key.mod?.startsWith('h');
      document.documentElement.style.setProperty('--hall', hl ? hex(hl.color) : '#c9a25f');
      const name = key.mod === 'rot' ? ['Кіреберіс', 'Шаңырақ залы'] : key.mod === 'end' ? ['Финал', 'Дала төрі'] : inHall ? [`${hl.num} зал`, hl.title]
        : key.mod?.startsWith('s') ? ['Баспалдақ', TEXTS.transit[key.mod].line] : ['Бұрыштық зал', TEXTS.transit[key.mod].big];
      where.replaceChildren(h('i'), h('b', null, name[0]), h('span', null, name[1]));
    }
    if (dot && museum) {
      const w = museum.where(); dot.setAttribute('cx', w.x); dot.setAttribute('cy', w.z);
      dot.previousSibling.setAttribute('cx', w.x); dot.previousSibling.setAttribute('cy', w.z);
      $('map-level').textContent = w.y > 5.2 ? '2-қабат' : w.y > 3.2 ? 'баспалдақ' : '1-қабат';
    }
    $('scrollhint').style.opacity = entered && p < 0.008 ? '1' : '0';
    requestAnimationFrame(hud);
  }
  requestAnimationFrame(hud);

  // ---- scroll -> camera, pointer -> exhibits ----
  const sync = () => museum?.setProgress(progress());
  window.addEventListener('scroll', sync, { passive: true });
  const hallIds = (hl) => (hl ? [hl.mural, ...hl.frames, hl.vitrine].filter((f) => f && EXHIBITS[f.id]).map((f) => f.id) : undefined);
  window.addEventListener('pointermove', (e) => {
    if (!museum) return; museum.setPointer(e.clientX, e.clientY);
    if (!entered || ui.busy || e.target.closest?.('[data-ui]') || e.pointerType === 'touch') { tip.classList.remove('is-on'); document.body.style.cursor = ''; return; }
    const hit = museum.pick(e.clientX, e.clientY);
    document.body.style.cursor = hit ? 'pointer' : '';
    if (hit) {
      const e2 = EXHIBITS[hit.id];
      tip.replaceChildren(h('b', null, hit.kind === 'exhibit' ? e2?.title ?? hit.label : 'Ашу'), h('small', null, hit.kind === 'exhibit' ? `${e2?.date ?? ''} · толығырақ` : 'Басу'));
      tip.style.left = `${Math.min(e.clientX + 16, window.innerWidth - 270)}px`; tip.style.top = `${e.clientY + 18}px`;
    }
    tip.classList.toggle('is-on', !!hit);
  });
  let down = null;
  window.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  window.addEventListener('pointerup', (e) => {
    if (!museum || !entered || !down || ui.busy || e.target.closest?.('[data-ui]')) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 600) return;
    const hit = museum.pick(e.clientX, e.clientY); if (!hit) return;
    if (hit.kind === 'exhibit') ui.openExhibit(hit.id, hallIds(HALLS[hit.hall - 1]));
    else if (hit.hall >= 1) openHall(HALLS[hit.hall - 1]);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!ui.escape()) { if (dockOpen) dockOpen = false; else closeMenu(); } return; }
    if (!entered || ui.busy || menu.classList.contains('is-on') || e.target.matches?.('input, textarea')) return;
    const cur = Math.round(progress() * (N - 1));
    if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); goKey(Math.min(N - 1, cur + 1)); }
    if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); goKey(Math.max(0, cur - 1)); }
  });
  document.addEventListener('visibilitychange', () => museum?.setPaused(document.hidden || ui.busy));

  // ---- start ----
  { // let the visitor switch between the full and the light version from the first screen
    const sw = $('mode'), u = new URL(location.href); u.searchParams.set('q', lite ? 'high' : 'lite'); u.searchParams.delete('skipintro');
    const label = lite ? 'жеңіл нұсқа' : verdict === 'low' || lowPower ? 'орташа сапа' : 'толық сапа';
    sw.href = u.pathname + u.search; sw.textContent = `${forced ? 'Таңдалған' : 'Автоматты таңдалды'}: ${label} · ${lite ? 'толық нұсқаға өту' : 'жеңіл нұсқаны ашу'}`;
  }
  museum?.start();
  window.scrollTo(0, 0);
  enterBtn.disabled = false; enterBtn.textContent = 'Музейге кіру';
  bar.parentElement.style.opacity = '0';
  const enter = () => {
    if (entered) return; entered = true;
    intro.classList.add('is-hidden'); document.body.classList.remove('is-intro');
    shownKey = -1; sync();
    setTimeout(() => { if (window.scrollY < 4) goKey(1); }, 500);     // glide to the portrait so the first seconds already move
  };
  enterBtn.addEventListener('click', enter);
  if (new URLSearchParams(location.search).has('skipintro')) enter();
  const deep = HALLS.findIndex((x) => `#${x.id}` === location.hash);    // deep link: #life, #alash … opens that hall
  if (deep >= 0) { enter(); setTimeout(() => goHall(deep + 1), 700); }
}
boot();
