// Hall VI — "Білімді тексер": 10 test questions, 5 matching pairs, chronology, source analysis, true/false.
import { QUIZ } from './data.js';
import { h, store } from './ui.js';

const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const LETTERS = ['A', 'B', 'C', 'D'];

export function renderQuiz() {
  const results = store.get('quiz', {});               // { mcq: '8/10', ... }
  const TABS = [['mcq', '10 тест сұрағы'], ['match', 'Сәйкестендіру'], ['chrono', 'Хронология'], ['source', 'Деректі талдау'], ['tf', 'Ақиқат немесе жалған']];
  const pane = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const save = (k, v) => { results[k] = v; store.set('quiz', results); drawTabs(current); };
  let current = 'mcq';
  function drawTabs(active) {
    tabs.replaceChildren(...TABS.map(([k, t]) => h('button', { role: 'tab', class: k === active ? 'is-active' : '', onclick: () => show(k) }, t, results[k] && h('span', { class: 'ok' }, `· ${results[k]}`))));
  }
  function show(k) { current = k; drawTabs(k); pane.replaceChildren(VIEWS[k]()); }

  // one multiple-choice question; calls done(isRight) once answered
  function question(item, done, counter) {
    const fb = h('div');
    const opts = h('div', { class: 'opts' }, item.a.map((t, i) => h('button', { class: 'opt', onclick: (e) => {
      opts.querySelectorAll('button').forEach((b, j) => { b.disabled = true; if (j === item.c) b.classList.add('is-right'); });
      const ok = i === item.c; if (!ok) e.currentTarget.classList.add('is-wrong');
      fb.replaceChildren(h('p', { class: `fb ${ok ? 'good' : 'bad'}` }, h('b', null, ok ? 'Дұрыс! ' : 'Дұрыс емес. '), item.why));
      done(ok);
    } }, h('i', null, LETTERS[i]), t)));
    return h('div', null, counter && h('span', { class: 'cnt' }, counter), h('h4', null, item.q), opts, fb);
  }
  const finish = (title, score, total, again) => h('div', { class: 'q-card', style: 'text-align:center' },
    h('span', { class: 'cnt' }, title), h('div', { class: 'score' }, `${score} / ${total}`),
    h('p', { style: 'color:var(--cream-2);margin:10px 0 20px' }, score === total ? 'Тамаша! Барлығы дұрыс.' : score >= total * 0.7 ? 'Жақсы нәтиже. Қате кеткен тұстарды залдардан қайта қарап шық.' : 'Залдарды тағы бір аралап, қайта тапсырып көр.'),
    h('button', { class: 'btn', onclick: again }, 'Қайта тапсыру'));

  const VIEWS = {
    mcq() {
      const card = h('div', { class: 'q-card' }); let i = 0, score = 0;
      const step = () => {
        if (i >= QUIZ.mcq.length) { save('mcq', `${score}/${QUIZ.mcq.length}`); card.replaceWith(finish('Тест нәтижесі', score, QUIZ.mcq.length, () => show('mcq'))); return; }
        const next = h('button', { class: 'btn btn--gold', style: 'visibility:hidden', onclick: () => { i++; step(); } }, i === QUIZ.mcq.length - 1 ? 'Нәтижені көру' : 'Келесі сұрақ →');
        card.replaceChildren(question(QUIZ.mcq[i], (ok) => { if (ok) score++; next.style.visibility = 'visible'; next.focus({ preventScroll: true }); }, `Сұрақ ${i + 1} / ${QUIZ.mcq.length}`),
          h('div', { class: 'q-foot' }, h('span', { style: 'color:var(--muted);font-size:13px' }, `Дұрыс жауап: ${score}`), next));
      };
      step(); return card;
    },
    match() {
      const { left, right } = QUIZ.match; const order = shuffle(right.map((_, i) => i));
      const pairs = {}; let sel = null;                        // left index -> right index
      const grid = h('div', { class: 'match' }), fb = h('div');
      const draw = (checked) => {
        const kids = [];
        left.forEach((l, li) => {
          const ri = order[li];
          const lb = h('button', { class: sel === li ? 'is-sel' : '', onclick: () => { sel = li; draw(); } }, h('span', { class: 'pin' }, pairs[li] != null ? li + 1 : '·'), l);
          if (pairs[li] != null) lb.dataset.pair = '1';
          const owner = Object.keys(pairs).find((k) => pairs[k] === ri);
          const rb = h('button', { onclick: () => { if (sel == null) return; for (const k in pairs) if (pairs[k] === ri) delete pairs[k]; pairs[sel] = ri; sel = null; draw(); } }, h('span', { class: 'pin' }, owner != null ? Number(owner) + 1 : '·'), right[ri]);
          if (owner != null) rb.dataset.pair = '1';
          if (checked) { lb.classList.add(pairs[li] === li ? 'is-right' : 'is-wrong'); lb.disabled = rb.disabled = true; if (owner != null) rb.classList.add(Number(owner) === ri ? 'is-right' : 'is-wrong'); }
          kids.push(lb, rb);
        });
        grid.replaceChildren(...kids);
      };
      draw();
      const check = () => {
        if (Object.keys(pairs).length < left.length) { fb.replaceChildren(h('p', { class: 'fb bad' }, 'Алдымен барлық бес жұпты құрастыр: сол жақтан есімді, сосын оң жақтан қызметін таңда.')); return; }
        const score = left.filter((_, i) => pairs[i] === i).length; draw(true); save('match', `${score}/${left.length}`);
        fb.replaceChildren(h('p', { class: `fb ${score === left.length ? 'good' : 'bad'}` }, h('b', null, `${score} / ${left.length}. `), score === left.length ? 'Барлық жұп дұрыс.' : 'Қызылмен белгіленген жұптарды II және III залдан қайта қарап шық.'), h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => show('match') }, 'Қайта тапсыру')));
      };
      return h('div', { class: 'q-card' }, h('span', { class: 'cnt' }, '5 сәйкестендіру'), h('h4', null, 'Тұлғаны оның қызметімен сәйкестендір'),
        h('p', { style: 'color:var(--muted);font-size:13.5px;margin:-8px 0 18px' }, 'Сол жақтан есімді таңда, сосын оң жақтан оған сай қызметті бас.'), grid, fb,
        h('div', { class: 'q-foot' }, h('span'), h('button', { class: 'btn btn--gold', onclick: check }, 'Тексеру')));
    },
    chrono() {
      let items = shuffle(QUIZ.chrono.map((c, i) => ({ t: c[0], y: c[1], i }))); let checked = false, drag = null;
      const list = h('ol', { class: 'chrono', style: 'padding:0;margin:0' }), fb = h('div');
      const move = (from, to) => { if (to < 0 || to >= items.length || checked) return; const [x] = items.splice(from, 1); items.splice(to, 0, x); draw(); };
      const draw = () => list.replaceChildren(...items.map((it, pos) => {
        const li = h('li', { draggable: !checked, class: checked ? (it.i === pos ? 'is-right' : 'is-wrong') : '' },
          h('span', { class: 'ix' }, pos + 1), h('span', null, it.t), h('span', { class: 'yr' }, checked ? it.y : ''),
          h('span', { class: 'mv' }, h('button', { 'aria-label': 'Жоғары', onclick: () => move(pos, pos - 1) }, '▲'), h('button', { 'aria-label': 'Төмен', onclick: () => move(pos, pos + 1) }, '▼')));
        li.addEventListener('dragstart', () => { drag = pos; li.classList.add('is-drag'); });
        li.addEventListener('dragend', () => li.classList.remove('is-drag'));
        li.addEventListener('dragover', (e) => e.preventDefault());
        li.addEventListener('drop', (e) => { e.preventDefault(); if (drag != null) move(drag, pos); drag = null; });
        return li;
      }));
      draw();
      const check = () => { checked = true; draw(); const score = items.filter((it, pos) => it.i === pos).length; save('chrono', `${score}/${items.length}`);
        fb.replaceChildren(h('p', { class: `fb ${score === items.length ? 'good' : 'bad'}` }, h('b', null, `${score} / ${items.length} оқиға өз орнында. `), 'Жылдары оң жақта көрсетілді.'), h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: () => show('chrono') }, 'Қайта тапсыру'))); };
      return h('div', { class: 'q-card' }, h('span', { class: 'cnt' }, 'Тарихи хронология'), h('h4', null, 'Оқиғаларды ертесінен кешіне қарай орналастыр'),
        h('p', { style: 'color:var(--muted);font-size:13.5px;margin:-8px 0 18px' }, 'Жолды сүйреп апар немесе ▲ ▼ батырмаларын қолдан.'), list, fb,
        h('div', { class: 'q-foot' }, h('span'), h('button', { class: 'btn btn--gold', onclick: check }, 'Тексеру')));
    },
    source() {
      const S = QUIZ.source; let answered = 0, score = 0;
      const total = h('div');
      const qs = S.qs.map((q, i) => h('div', { class: 'q-card', style: 'margin-top:14px' }, question(q, (ok) => { answered++; if (ok) score++; if (answered === S.qs.length) { save('source', `${score}/${S.qs.length}`); total.replaceChildren(h('p', { class: 'fb good' }, h('b', null, `Нәтиже: ${score} / ${S.qs.length}. `), 'Енді төмендегі ашық сұраққа өз ойыңды жаз.')); } }, `${i + 1}-сұрақ`)));
      const ta = h('textarea', { class: 'field', maxlength: 900, placeholder: 'Жауабыңды осында жаз…' }); ta.value = store.get('source-open', '');
      const saved = h('small', { style: 'color:var(--muted)' }, '');
      ta.addEventListener('input', () => { store.set('source-open', ta.value.slice(0, 900)); saved.textContent = 'Сақталды'; });
      return h('div', null,
        h('div', { class: 'src-text' }, S.text, h('cite', null, S.cite)),
        h('p', { style: 'color:var(--muted);font-size:13.5px;margin:16px 0 0' }, 'Үзіндіні мұқият оқып, сұрақтарға жауап бер.'),
        ...qs, total,
        h('div', { class: 'q-card', style: 'margin-top:14px' }, h('span', { class: 'cnt' }, 'Ашық сұрақ'), h('h4', null, S.open), ta, h('div', { class: 'q-foot' }, saved, h('span', { style: 'color:var(--muted);font-size:13px' }, 'Жауап осы құрылғыда сақталады, мұғалімге көрсете аласың.'))));
    },
    tf() {
      let answered = 0, score = 0; const total = h('div');
      const items = QUIZ.tf.map((it) => {
        const fb = h('div');
        const btn = (val, label) => h('button', { onclick: (e) => {
          row.querySelectorAll('button').forEach((b) => (b.disabled = true));
          const ok = val === it.c; e.currentTarget.classList.add(ok ? 'is-right' : 'is-wrong'); answered++; if (ok) score++;
          fb.replaceChildren(h('p', { class: `fb ${ok ? 'good' : 'bad'}` }, h('b', null, it.c ? 'Ақиқат. ' : 'Жалған. '), it.why));
          if (answered === QUIZ.tf.length) { save('tf', `${score}/${QUIZ.tf.length}`); total.replaceChildren(h('div', { class: 'q-foot' }, h('p', { class: 'fb good', style: 'margin:0' }, h('b', null, `Нәтиже: ${score} / ${QUIZ.tf.length}`)), h('button', { class: 'btn', onclick: () => show('tf') }, 'Қайта тапсыру'))); }
        } }, label);
        const row = h('div', { class: 'row' }, btn(true, 'Ақиқат'), btn(false, 'Жалған'));
        return h('div', { class: 'tf-item' }, h('p', null, it.s), row, fb);
      });
      return h('div', { class: 'tf' }, ...items, total);
    },
  };

  show('mcq');
  return h('section', { class: 's-sec', style: 'margin-top:10px' }, tabs, pane);
}
