// Hall V — "Виртуалды сұхбат". Two answer engines:
//  1) if the site is served by server.mjs with an API key, questions go to /api/chat (a real language model
//     grounded in the museum's fact base);
//  2) otherwise a built-in matcher answers from the same fact base (works offline, on any static host).
import { KB, KB_SUGGEST, EXHIBITS } from './data.js';
import { h } from './ui.js';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„.,!?;:()\[\]—–\-\/]+/g, ' ').replace(/\s+/g, ' ').trim();

export function localAnswer(question) {
  const q = norm(question); if (!q) return null;
  const words = q.split(' ');
  let best = null, bestScore = 0;
  for (const e of KB) {
    let score = 0;
    for (const raw of e.k) {
      const k = norm(raw); if (!k) continue;
      let hit;
      if (k.includes(' ')) hit = q.includes(k);                         // phrase
      else if (k.length <= 3) hit = words.includes(k);                  // tiny stems must be whole words
      else hit = words.some((w) => w.startsWith(k));                    // stem prefix
      if (hit) score += 1 + k.length / 5;
    }
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore >= 1.6 ? best : null;
}

let aiAvailable = null;
async function probe() {
  if (aiAvailable != null) return aiAvailable;
  try {
    const r = await fetch('api/health', { signal: AbortSignal.timeout(2500) });
    aiAvailable = r.ok && (await r.json()).ai === true;
  } catch { aiAvailable = false; }
  return aiAvailable;
}

// dock = compact panel that floats over the 3D museum (hall V); otherwise the full section used inside a sheet
export function renderChat({ dock = false, onClose } = {}) {
  const log = h('div', { class: 'chat__log', 'aria-live': 'polite' });
  const status = h('small', null, 'Музейдің дерек қоры бойынша жауап береді');
  const input = h('input', { type: 'text', placeholder: 'Сұрағыңды жаз…', maxlength: 300, 'aria-label': 'Сұрақ' });
  const history = [];
  const say = (text, who) => { const m = h('div', { class: `msg msg--${who}` }, text); log.append(m); log.scrollTop = log.scrollHeight; return m; };

  probe().then((ai) => { if (ai) status.textContent = 'Жасанды интеллект · музей дерегіне сүйенеді'; });

  async function ask(text) {
    const q = text.trim().slice(0, 300); if (!q) return;
    input.value = ''; say(q, 'me');
    const bubble = say('', 'bot'); bubble.classList.add('typing');
    let answer = null;
    if (await probe()) {
      try {
        const r = await fetch('api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, history: history.slice(-6) }), signal: AbortSignal.timeout(30000) });
        if (r.ok) { const j = await r.json(); if (typeof j.answer === 'string' && j.answer) answer = j.answer.slice(0, 4000); }
      } catch { /* fall back to the built-in base below */ }
    }
    if (!answer) {
      await new Promise((res) => setTimeout(res, 450 + Math.random() * 500));
      const hit = localAnswer(q);
      answer = hit ? hit.a : 'Бұл сұраққа музей дерегінен нақты жауап таба алмадым. Мен тек Әлихан Бөкейханның өмірі, еңбектері және Алаш қозғалысы туралы тексерілген деректерге сүйенемін. Сұрағыңды басқаша қойып көр немесе төмендегі тақырыптардың бірін таңда.';
    }
    bubble.classList.remove('typing'); bubble.textContent = answer; log.scrollTop = log.scrollHeight;
    history.push({ q, a: answer });
  }

  const form = h('form', { class: 'chat__form', onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, h('button', { class: 'btn btn--gold btn--sm', type: 'submit' }, 'Жіберу'));
  const sug = h('div', { class: 'chat__sug' }, KB_SUGGEST.map((s) => h('button', { type: 'button', onclick: () => ask(s) }, s)));
  say(dock ? 'Сәлем! Сұрағыңды осы жерге жаз немесе төмендегі тақырыпты таңда. Мен музейдің тексерілген дерегіне сүйеніп жауап беремін.' : 'Сәлем! Мен — музейдің виртуалды көмекшісімін. Әлихан Бөкейханның өмірі, еңбектері, «Қазақ» газеті, Алаш партиясы мен Алашорда туралы сұрай бер. Жауаптарым музейдің тексерілген дерегіне сүйенеді.', 'bot');

  const head = h('div', { class: 'chat__head' }, h('img', { src: EXHIBITS.portrait_1908.img, alt: '' }), h('div', null, h('b', null, 'Виртуалды көмекші'), status),
    dock && h('button', { class: 'chat__x', 'aria-label': 'Жасыру', onclick: () => onClose?.() }, '–'));
  if (dock) {
    const el = h('div', { class: 'chat chat--dock' }, head, log, h('div', null, sug, form));
    el.focusInput = () => input.focus({ preventScroll: true });
    return el;
  }
  return h('section', { class: 's-sec', style: 'margin-top:26px' },
    h('div', { class: 'chat' }, head, log, h('div', null, sug, form)),
    h('p', { class: 'note', style: 'margin-top:16px' }, h('b', null, 'Ескерту. '), 'Көмекші Әлихан Бөкейханның атынан сөйлемейді және оның сөзін ойдан шығармайды: ол тек дереккөзбен расталған мәліметті жеткізеді. Маңызды деректі әрқашан залдағы экспонаттармен салыстырып тексер.'));
}
