// Hall sheets (the detailed content of each section) and the exhibit lightbox.
// All DOM is built with h(): text goes in as text nodes, never as HTML, so visitor input cannot inject markup.
import { HALLS, EXHIBITS, TIMELINE, ALASH, SCHOLAR, TODAY, SOURCES } from './data.js';
import { renderQuiz } from './tasks.js';
import { renderChat } from './chat.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem('abm:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('abm:' + k, JSON.stringify(v)); } catch { /* private mode: keep working without persistence */ } },
};

const sec = (title, sub, ...kids) => h('section', { class: 's-sec' }, h('div', { class: 'orn' }), h('h3', null, title), sub && h('p', { class: 'sub' }, sub), ...kids);
const note = (text) => h('p', { class: 'note' }, h('b', null, 'Дерек туралы ескерту. '), text);
const figure = (id, open) => {
  const e = EXHIBITS[id];
  return h('figure', { onclick: () => open(id), tabindex: 0, role: 'button', onkeydown: (ev) => ev.key === 'Enter' && open(id) },
    h('img', { src: e.img, alt: e.title, loading: 'lazy' }), h('figcaption', null, h('b', null, e.title), h('small', null, e.date)));
};

// ---------------------------------------------------------------------------------------------
export function createUI({ onClose }) {
  const sheet = document.getElementById('sheet'), body = document.getElementById('sheet-body'), scrim = document.getElementById('scrim');
  const lb = document.getElementById('lightbox'), lbBody = document.getElementById('lb-body');
  let lbList = [], lbIndex = 0, lastFocus = null;

  function lock() { document.body.classList.toggle('is-locked', sheet.classList.contains('is-on') || lb.classList.contains('is-on') || document.getElementById('menu').classList.contains('is-on')); onClose?.(); }

  // ---- lightbox ----
  function openExhibit(id, list) {
    if (!EXHIBITS[id]) return;
    lbList = list && list.includes(id) ? list : Object.keys(EXHIBITS); lbIndex = lbList.indexOf(id);
    drawExhibit(); lb.classList.add('is-on'); lb.setAttribute('aria-hidden', 'false'); lock();
    document.getElementById('lb-close').focus({ preventScroll: true });
  }
  function drawExhibit() {
    const id = lbList[lbIndex], e = EXHIBITS[id];
    const step = (d) => { lbIndex = (lbIndex + d + lbList.length) % lbList.length; drawExhibit(); };
    lbBody.replaceChildren(
      h('div', { class: 'lb-img' }, h('img', { src: e.img, alt: e.title, class: e.light ? 'light' : '' })),
      h('div', { class: 'lb-txt' },
        h('p', { class: 'kicker' }, `Экспонат ${lbIndex + 1} / ${lbList.length}`),
        h('h3', null, e.title), h('p', { class: 'date' }, e.date),
        h('p', null, e.desc),
        h('h5', null, 'Тарихи маңызы'), h('p', null, e.why),
        h('p', { class: 'src' }, 'Дереккөз: ', e.src),
        h('div', { class: 'lb-nav' }, h('button', { class: 'btn btn--sm', onclick: () => step(-1) }, '← Алдыңғы'), h('button', { class: 'btn btn--sm', onclick: () => step(1) }, 'Келесі →'))));
  }
  function closeExhibit() { lb.classList.remove('is-on'); lb.setAttribute('aria-hidden', 'true'); lock(); }
  document.getElementById('lb-close').addEventListener('click', closeExhibit);
  lb.addEventListener('click', (e) => { if (e.target === lb) closeExhibit(); });

  // ---- sheet ----
  function hero(hall, kicker) {
    return h('header', { class: 's-hero' },
      hall.mural && h('img', { src: hall.mural.img, alt: '' }),
      h('div', null, h('p', { class: 'kicker' }, kicker), h('h2', null, hall.title), h('p', null, hall.lead)),
      hall.mural && h('span', { class: 'ai' }, 'Сурет: ', hall.mural.label, ' · ', hall.mural.sub));
  }
  const renderers = {
    life(hall) {
      const tags = ['Барлығы', ...new Set(TIMELINE.map((t) => t.tag))];
      const list = h('div', { class: 'tl' });
      const draw = (tag) => list.replaceChildren(...TIMELINE.filter((t) => tag === 'Барлығы' || t.tag === tag).map((t) =>
        h('article', { class: 'tl-item' },
          h('div', null, h('span', { class: 'y' }, t.y), h('span', { class: 'tg' }, t.tag), h('h4', null, t.t), h('p', null, t.d), t.note && note(t.note)),
          t.img && h('figure', { onclick: () => openExhibit(t.img), title: 'Экспонатты ашу' }, h('img', { src: EXHIBITS[t.img].img, alt: EXHIBITS[t.img].title, loading: 'lazy' })))));
      const filter = h('div', { class: 'tl-filter' }, tags.map((t, i) => h('button', { class: i ? '' : 'is-active', onclick: (e) => { filter.querySelectorAll('button').forEach((b) => b.classList.remove('is-active')); e.currentTarget.classList.add('is-active'); draw(t); } }, t)));
      draw('Барлығы');
      return [
        sec('Бір қарағанда', null, h('div', { class: 'grid grid--3' },
          tile('Туған жері', 'Семей облысы, Қарқаралы уезі, Тоқырауын болысы — қазіргі Қарағанды облысының Ақтоғай ауданы.'),
          tile('Білімі', 'Қарқаралы мектептері → Омбы техникалық училищесі (1886–1890) → Санкт-Петербург Орман институты (1890–1894).'),
          tile('Қызметі', 'Ғалым-статистик, публицист, I Мемлекеттік Дума депутаты, Алаш партиясының жетекшісі, Алашорда төрағасы.'))),
        sec('Өмір хронологиясы', 'Туғаннан бастап ақталғанға дейінгі негізгі оқиғалар. Кезеңді таңдап, сүзгіден өткізуге болады; суретті бассаң — экспонат ашылады.', filter, list),
        sec('Соңғы сөзі', null, h('div', { class: 'quote' }, h('blockquote', null, 'Кеңес өкіметін «жақсы көрмейді, бірақ мойындайды».'), h('cite', null, 'Сот хаттамасындағы жазба · Мәскеу, 1937 жылғы 27 қыркүйек (орыс тілінен аударма)'))),
      ];
    },
    alash() {
      return [
        sec('Себеп пен салдар', 'Тарихи оқиғаны түсіну үшін оның неден туғанын және неге әкелгенін қатар қарау керек.',
          h('div', { class: 'flow' },
            h('div', { class: 'col' }, h('h4', null, 'Себептері'), h('ul', null, ALASH.causes.map(([k, v]) => h('li', null, h('b', null, k + '. '), v)))),
            h('div', { class: 'arrow' }, '→'),
            h('div', { class: 'col' }, h('h4', null, 'Нәтижелері'), h('ul', null, ALASH.results.map((r) => h('li', null, r)))))),
        sec('Қозғалыстың жолы', '1905 жылғы петициядан 1920 жылғы таратылуға дейін.',
          h('div', { class: 'steps' }, ALASH.steps.map((s) => h('article', { class: 'step' }, h('div', { class: 'd' }, s.date), h('div', null, h('h4', null, s.title), h('p', null, s.text), s.note && note(s.note)))))),
        sec('Алаш партиясының бағдарламасы', '1917 жылғы 21 қарашада «Қазақ» газетінде жарияланған жобаның он бөлімі. Бөлімді басып, мазмұнын аш.',
          h('div', { class: 'prog' }, ALASH.program.map(([n, t, d], i) => h('details', i === 0 ? { open: true } : null, h('summary', null, h('i', null, n), t), h('p', null, d))))),
        sec(ALASH.kadet.title, ALASH.kadet.intro,
          h('div', { class: 'grid grid--3' }, ALASH.kadet.reasons.map(([k, v], i) => h('div', { class: 'tile' }, h('span', { class: 'y' }, `${i + 1}-себеп`), h('h4', null, k), h('p', null, v))))),
        sec('Алашорда және оның аумағы', null, h('div', { class: 'split' },
          h('div', null,
            h('dl', { class: 'dl' },
              dl('Атауы', 'Уақытша Ұлт Кеңесі — «Алашорда»'), dl('Құрылған күні', '1917 жылғы желтоқсан, Екінші жалпықазақ съезі'),
              dl('Төрағасы', 'Әлихан Бөкейхан'), dl('Құрамы', '25 мүше; 10 орын өзге халық өкілдеріне'),
              dl('Орталығы', 'Семей — Алаш қаласы (Заречная Слобода)'), dl('Батыс бөлімі', 'Жымпиты; жетекшісі Жаһанша Досмұхамедұлы'),
              dl('Таратылуы', '1920 жылғы наурыз, Қазревком шешімі')),
            h('div', { style: 'margin-top:18px;display:flex;gap:10px;flex-wrap:wrap' },
              h('button', { class: 'btn btn--sm', onclick: () => openExhibit('alashorda_letter_1918') }, 'Төрағаның хатын көру'),
              h('button', { class: 'btn btn--sm', onclick: () => openExhibit('chair_1918') }, 'Төрағаның портреті'))),
          h('img', { src: EXHIBITS.map_alash_1918.img, alt: EXHIBITS.map_alash_1918.title, loading: 'lazy', onclick: () => openExhibit('map_alash_1918') })),
          note('Карта — бүгінгі автор жасаған шартты реконструкция, тарихи құжат емес.')),
        sec('Талдау сұрақтары', 'Өз бетіңше ойлан немесе сыныпта талқыла.', h('div', { class: 'grid grid--2' },
          tile('Себеп', 'Қозғалыстың басты талабы неге жер мәселесінен басталды? 1905 жылғы петиция мен 1917 жылғы бағдарламаны салыстыр.'),
          tile('Таңдау', 'Алаш қайраткерлері неге қарулы күрес емес, съезд, партия, сайлау жолын таңдады?'),
          tile('Тартыс', 'Екінші съезде автономияны дереу жариялау мәселесінде делегаттар неге екіге бөлінді?'),
          tile('Нәтиже', 'Алашорда таратылса да, оның қай идеялары кейін жүзеге асты?'))),
      ];
    },
    scholar() {
      return [
        sec('Ғылыми еңбектері', 'Экспедиция дәптерінен энциклопедия бетіне дейін.', h('div', { class: 'grid grid--2' }, SCHOLAR.works.map((w) => h('div', { class: 'tile' }, h('span', { class: 'y' }, w.y), h('h4', null, w.t), h('p', null, w.d))))),
        sec('Далалық зерттеуші', null, h('div', { class: 'split' },
          h('div', null, h('p', { style: 'color:var(--cream-2)' }, 'Бөкейхан шешімді дерекке сүйеніп қабылдайтын саясаткер болды. Щербина экспедициясында ол ауыл-ауылды аралап, әр шаруашылықтың малын, жерін, көші-қон жолын есепке алды. Осы тәжірибе оны қазақ жерінің жай-күйін ең терең білетін маманға айналдырды: кейін Думада да, баспасөзде де ол жер мәселесін нақты сандармен дәлелдеді.'),
            h('div', { style: 'margin-top:16px' }, h('button', { class: 'btn btn--sm', onclick: () => openExhibit('shcherbina') }, 'Ф. Щербина туралы'))),
          h('img', { src: EXHIBITS.dudin_1899.img, alt: EXHIBITS.dudin_1899.title, loading: 'lazy', onclick: () => openExhibit('dudin_1899') })),
          h('p', { class: 'sub', style: 'margin-top:8px' }, 'Сурет: қол диірмен тартқан жастар, Қарқаралы өңірі, 1899 жыл. Фото: С. М. Дудин.')),
        sec('«Қазақ» газеті (1913–1918)', 'Алаш зиялыларының ұлттық баспасөзді дамытудағы басты ісі.', h('div', { class: 'split' },
          h('dl', { class: 'dl' }, SCHOLAR.qazaq.map(([k, v]) => dl(k, v))),
          h('div', null, h('img', { src: EXHIBITS.qazaq_no7_1913.img, alt: EXHIBITS.qazaq_no7_1913.title, loading: 'lazy', onclick: () => openExhibit('qazaq_no7_1913') }),
            h('img', { src: EXHIBITS.trio_1913.img, alt: EXHIBITS.trio_1913.title, loading: 'lazy', style: 'margin-top:14px', onclick: () => openExhibit('trio_1913') }))),
          note('Газеттің жалпы саны (265 не 266), таралымы және жабылған айы (1918 жылғы наурыз не қыркүйек) деректерде әртүрлі көрсетіледі.')),
        sec('Аудармалары', 'Ғылым мен әдебиетті ана тілінде сөйлету.', h('div', { class: 'grid grid--3' }, SCHOLAR.translations.map(([k, v]) => tile(k, v)))),
        sec('Бүркеншік аттары', 'Патша цензурасы мен кеңестік бақылау жағдайында ол көп мақаласына өз атын қоймаған.', h('div', { class: 'tags' }, SCHOLAR.pseudonyms.map((p) => h('span', null, p)))),
        sec('Жазған басылымдары', null, h('div', { class: 'tags' }, h('span', null, 'Қазақ'), SCHOLAR.press.map((p) => h('span', null, p)))),
      ];
    },
    docs() {
      const ids = ['duma_1906', 'bulla_1906', 'tauride_1906', 'duma_hall', 'vyborg_appeal', 'vyborg_deputies_1906', 'prison_1908', 'portrait_1908', 'omsk_1902', 'koyandy', 'dudin_1899', 'trio_1913', 'qazaq_no7_1913', 'orenburg_caravanserai', 'chair_1918', 'alash_semey_1918', 'alashorda_letter_1918', 'alash_1926', 'nkvd_1937', 'donskoye', 'signature', 'baitursynuly_1913', 'dulatuly_1916', 'shcherbina', 'stamp_2016', 'works_9vol'];
      return [
        sec('Деректі материалдар', 'Фотосуреттер, газет беттері, үндеулер мен ресми хаттар. Әр құжатты басып, оның сипаттамасын, тарихи маңызын және сақталған қорын оқы.',
          h('div', { class: 'gal' }, ids.map((id) => figure(id, (x) => openExhibit(x, ids))))),
        sec('Құжатпен қалай жұмыс істейміз?', null, h('div', { class: 'grid grid--3' },
          tile('1. Кім, қашан, қайда?', 'Құжаттың авторын, жасалған күнін және орнын анықта. Мысалы, 1908 жылғы түрме суретінің түсірілген орны әлі күнге талас тудырады.'),
          tile('2. Не үшін жасалған?', 'Үндеу халыққа, хат мекемеге, портрет естелікке арналады. Мақсаты мазмұнына әсер етеді.'),
          tile('3. Қаншалықты сенімді?', 'Түпнұсқа ма, көшірме ме? Қай мұрағатта сақтаулы? Өзге дерекпен сәйкес келе ме?'))),
      ];
    },
    talk(hall, root) { return [renderChat(root)]; },
    quiz() { return [renderQuiz()]; },
    today() {
      const wall = h('div', { class: 'wall' });
      const drawWall = () => {
        const items = store.get('opinions', []);
        wall.replaceChildren(...items.map((o, i) => h('article', null, o.text, h('footer', null, h('span', null, `${o.name || 'Оқушы'} · ${o.date}`), h('button', { onclick: () => { const a = store.get('opinions', []); a.splice(i, 1); store.set('opinions', a); drawWall(); } }, 'өшіру')))));
      };
      const name = h('input', { class: 'field', placeholder: 'Атың, сыныбың (міндетті емес)', maxlength: 60, style: 'flex:1;min-width:200px' });
      const text = h('textarea', { class: 'field', placeholder: 'Өз ойыңды жаз…', maxlength: 700 });
      const count = h('small', null, '0 / 700');
      text.addEventListener('input', () => { count.textContent = `${text.value.length} / 700`; });
      const submit = () => {
        const t = text.value.trim(); if (t.length < 10) { text.focus(); count.textContent = 'Кемінде бір-екі сөйлем жаз'; return; }
        const a = store.get('opinions', []); a.unshift({ name: name.value.trim().slice(0, 60), text: t.slice(0, 700), date: new Date().toLocaleDateString('kk-KZ') });
        store.set('opinions', a.slice(0, 60)); text.value = ''; count.textContent = '0 / 700'; drawWall();
      };
      drawWall();
      return [
        sec('Бес идея: кеше және бүгін', 'Алаш бағдарламасындағы ойлар мен олардың бүгінгі мәні.', h('div', { class: 'grid' }, TODAY.ideas.map((i) => h('article', { class: 'idea' }, h('h4', null, i.k), h('div', null, h('small', null, 'Алаш заманында'), h('p', null, i.then)), h('div', null, h('small', null, 'Бүгінгі ұрпаққа'), h('p', null, i.now)))))),
        sec('Мұраның оралуы', 'Ондаған жыл аталмаған есім бүгін қалай ұлықталып отыр?', h('dl', { class: 'dl' }, TODAY.legacy.map(([k, v]) => dl(k, v)))),
        h('section', { class: 's-sec bigq' }, h('p', { class: 'kicker' }, 'Сенің пікірің'), h('h3', null, `«${TODAY.question}»`),
          h('div', { class: 'form' }, text, h('div', { class: 'row' }, name, count, h('button', { class: 'btn btn--gold', onclick: submit }, 'Пікірімді қалдыру')),
            h('small', null, 'Пікірлер осы құрылғының жадында сақталады. Мұғалім сыныппен бірге оқып, талқылай алады.')),
          wall),
      ];
    },
  };
  function tile(t, d) { return h('div', { class: 'tile' }, h('h4', null, t), h('p', null, d)); }
  function dl(k, v) { return h('div', null, h('dt', null, k), h('dd', null, v)); }

  async function sourcesSheet() {
    let credits = {};
    try { credits = await (await fetch('assets/archive/credits.json')).json(); } catch { /* offline file:// preview */ }
    return [
      h('header', { class: 's-hero', style: 'min-height:240px' }, h('div', null, h('p', { class: 'kicker' }, 'Анықтама'), h('h2', null, 'Дереккөздер'), h('p', null, 'Музейдегі мәтіндер ашық дереккөздер бойынша тексерілді. Дереккөздер бір-бірімен келіспеген жерде екі нұсқа да көрсетілді.'))),
      h('div', { class: 's-body' },
        sec('Мәтін дереккөздері', null, h('ul', { class: 'srcs' }, SOURCES.map(([t, u]) => h('li', null, t, h('small', null, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, decodeURI(u))))))),
        sec('Фотосуреттер мен құжаттар', 'Wikimedia Commons қорынан алынған. Лицензиясы мен авторы әр файлдың бетінде көрсетілген.', h('ul', { class: 'srcs' },
          Object.values(credits).map((c) => h('li', null, c.title.replace(/^File:/, ''), h('small', null, `${c.license}${c.artist ? ' · ' + c.artist.slice(0, 90) : ''} · `, h('a', { href: c.page, target: '_blank', rel: 'noopener noreferrer' }, 'Commons беті')))))),
        sec('Суреттер туралы', null, h('p', { class: 'note' }, 'Музей қабырғаларындағы барлық сурет — шынайы фотосуреттер мен құжаттар: тарихи ашық хаттар, мұрағат суреттері және бүгінгі фотографтардың еңбегі. Жасанды интеллектпен тек әрлеу материалдары жасалған: еден мәрмәрі, қабырға тасы, ою-өрнек жолағы, едендегі медальон және сырмақ бейнесі (Seedream 5.5, Ideogram 4.5).')),
        sec('Техникалық негіз', null, h('p', { class: 'sub' }, '3D көрініс — three.js (MIT). Қаріптер — Cormorant Garamond, Golos Text (SIL OFL).'))),
    ];
  }

  async function openSheet(id) {
    lastFocus = document.activeElement;
    if (id === 'sources') body.replaceChildren(...await sourcesSheet());
    else {
      const hall = HALLS.find((x) => x.id === id); if (!hall) return;
      const inner = h('div', { class: 's-body' });
      inner.append(...renderers[id](hall, inner));
      body.replaceChildren(hero(hall, `${hall.num} зал`), inner);
    }
    body.scrollTop = 0; sheet.classList.add('is-on'); scrim.classList.add('is-on'); sheet.setAttribute('aria-hidden', 'false'); lock();
    document.getElementById('sheet-close').focus({ preventScroll: true });
  }
  function closeSheet() { sheet.classList.remove('is-on'); scrim.classList.remove('is-on'); sheet.setAttribute('aria-hidden', 'true'); lock(); lastFocus?.focus?.({ preventScroll: true }); }
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);

  return {
    openSheet, closeSheet, openExhibit, closeExhibit, lock,
    get busy() { return sheet.classList.contains('is-on') || lb.classList.contains('is-on'); },
    escape() { if (lb.classList.contains('is-on')) closeExhibit(); else if (sheet.classList.contains('is-on')) closeSheet(); else return false; return true; },
  };
}
