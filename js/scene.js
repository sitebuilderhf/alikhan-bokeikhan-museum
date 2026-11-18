// 3D museum: a domed rotunda (the dome is a yurt roof with a shanyrak oculus) that opens into
// an enfilade of seven halls and ends on a terrace over the steppe. The camera rides a spline
// driven by scroll progress; framed exhibits are pickable.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DISPLAY = '"Cormorant Garamond", "Times New Roman", serif';
const TEXT = '"Golos Text", system-ui, sans-serif';

// ---- dimensions (metres) ---------------------------------------------------------------
const ROT = { half: 14, H: 12, colR: 8.7, domeR: 8.1 };
const HALL = { L: 26, W: 14, H: 9, T: 1.4 };
const EYE = 2.35;
const hallMid = (i) => -ROT.half - (i - 0.5) * HALL.L;      // i = 1..7
const portalZ = (i) => -ROT.half - i * HALL.L;               // i = 0..7
const END_Z = portalZ(7);

// quality knobs set once per page by createMuseum (ultra-light mode shrinks generated textures)
const CFG = { text: 1, lm: 1024 };

// ---- small canvas helpers --------------------------------------------------------------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function glowTexture() {
  const c = canvas(256, 256), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,236,200,1)'); g.addColorStop(0.35, 'rgba(255,220,170,.45)'); g.addColorStop(1, 'rgba(255,210,160,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return canvasTex(c);
}
function rayTexture() {
  const c = canvas(128, 512), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, 'rgba(255,238,205,.95)'); g.addColorStop(0.55, 'rgba(255,226,180,.35)'); g.addColorStop(1, 'rgba(255,220,170,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 512);
  x.globalCompositeOperation = 'destination-in';
  const h = x.createLinearGradient(0, 0, 128, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.5, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = h; x.fillRect(0, 0, 128, 512);
  return canvasTex(c);
}
// Painted "wall washer" light: black base with warm scallops, used as an additive lightMap.
function wallLightmap(aspect, spots, wash = 0.16) {
  const W = CFG.lm, H = Math.max(64, Math.round(W / aspect));
  const c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'lighter';
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(255,214,165,${wash * 1.5})`); g.addColorStop(0.55, `rgba(255,210,160,${wash})`); g.addColorStop(1, `rgba(255,200,150,${wash * 0.25})`);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (const s of spots) {
    x.save(); x.translate(s.u * W, 0); x.scale(s.w ?? 1, 1);
    const r = H * (s.r ?? 1.0);
    const rg = x.createRadialGradient(0, H * 0.06, 0, 0, H * 0.3, r);
    const a = s.a ?? 0.9;
    rg.addColorStop(0, `rgba(255,228,186,${a})`); rg.addColorStop(0.4, `rgba(255,214,165,${a * 0.5})`); rg.addColorStop(1, 'rgba(255,200,150,0)');
    x.fillStyle = rg; x.fillRect(-r * 2, 0, r * 4, H);
    x.restore();
  }
  const t = canvasTex(c); t.channel = 1; return t;
}
function brass(x, y0, y1) {
  const g = x.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#f6e3b4'); g.addColorStop(0.5, '#d9b673'); g.addColorStop(1, '#a8803f');
  return g;
}
// Multi-line text on a transparent canvas. lines: [{t, size, font, weight, color, ls, italic, gap}]
function textTexture(lines0, { width: width0 = 1024, pad: pad0 = 24, align = 'center', bg = null, plate = false } = {}) {
  const S = CFG.text, width = Math.round(width0 * S), pad = pad0 * S;       // everything scales together in ultra-light mode
  const lines = S === 1 ? lines0 : lines0.map((l) => ({ ...l, size: l.size * S, ls: (l.ls ?? 0) * S, gap: (l.gap ?? 0) * S }));
  const probe = canvas(8, 8).getContext('2d');
  const laid = [];
  let h = pad;
  for (const l of lines) {
    const font = `${l.italic ? 'italic ' : ''}${l.weight ?? 600} ${l.size}px ${l.font ?? DISPLAY}`;
    probe.font = font; if ('letterSpacing' in probe) probe.letterSpacing = `${l.ls ?? 0}px`;
    const words = String(l.t).split(' '); const rows = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (probe.measureText(test).width > width - pad * 2 && cur) { rows.push(cur); cur = w; } else cur = test;
    }
    if (cur) rows.push(cur);
    for (const r of rows) { h += (l.gap ?? 0); laid.push({ ...l, font, row: r, y: h + l.size * 0.82 }); h += l.size * 1.18; }
  }
  h += pad;
  const c = canvas(width, Math.ceil(h)), x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
  if (plate) {                                              // museum plaque: dark plate, double brass border
    const g = x.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#1d1814'); g.addColorStop(1, '#0d0a08');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = '#e3c88e'; x.lineWidth = 7; x.strokeRect(9, 9, c.width - 18, c.height - 18);
    x.strokeStyle = 'rgba(227,200,142,.55)'; x.lineWidth = 2; x.strokeRect(24, 24, c.width - 48, c.height - 48);
  }
  for (const l of laid) {
    x.font = l.font; if ('letterSpacing' in x) x.letterSpacing = `${l.ls ?? 0}px`;
    x.textAlign = align; x.textBaseline = 'alphabetic';
    x.fillStyle = l.color === 'brass' ? brass(x, l.y - l.size, l.y) : (l.color ?? '#f1e7d3');
    const px = align === 'center' ? width / 2 : pad;
    x.fillText(l.row, px, l.y);
  }
  const t = canvasTex(c); t.userData = { aspect: c.width / c.height };
  return t;
}
function textPlane(lines, worldWidth, opts = {}) {
  const tex = textTexture(lines, opts);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(worldWidth, worldWidth / tex.userData.aspect),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 })
  );
  m.userData.h = worldWidth / tex.userData.aspect;
  return m;
}

function posterTexture(p) {
  const W = 900, H = 1240, c = canvas(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#12474c'); g.addColorStop(1, '#0a2a2e');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#c9a25f'; x.lineWidth = 5; x.strokeRect(36, 36, W - 72, H - 72); x.lineWidth = 1.5; x.strokeRect(52, 52, W - 104, H - 104);
  x.textAlign = 'center';
  x.fillStyle = '#d9b673'; x.font = `500 34px ${TEXT}`; if ('letterSpacing' in x) x.letterSpacing = '10px'; x.fillText(p.kicker, W / 2, 170);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  x.fillStyle = brass(x, 220, 330); x.font = `600 104px ${DISPLAY}`;
  const words = p.title.split(' '); let rows = [], cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > W - 150 && cur) { rows.push(cur); cur = w; } else cur = t; } rows.push(cur);
  let y = 320; for (const r of rows) { x.fillText(r, W / 2, y); y += 112; }
  x.fillStyle = '#c9a25f'; x.fillRect(W / 2 - 60, y - 50, 120, 3);
  x.fillStyle = '#f1e7d3'; x.font = `400 46px ${TEXT}`; y += 50;
  for (const l of p.lines) { x.fillText(l, W / 2, y); y += 78; }
  // call-to-action pill
  x.font = `600 40px ${TEXT}`; const tw = x.measureText(p.cta).width + 110, bx = W / 2 - tw / 2, by = H - 220;
  x.fillStyle = '#c9a25f'; x.beginPath(); x.roundRect(bx, by, tw, 92, 46); x.fill();
  x.fillStyle = '#10201f'; x.fillText(p.cta + '  →', W / 2, by + 60);
  return canvasTex(c);
}

// ----------------------------------------------------------------------------------------
export async function createMuseum({ canvas: dom, halls, hero, texts, onLoad, lowPower = false, lite = false }) {
  if (lite) { lowPower = true; CFG.text = 0.55; CFG.lm = 384; }
  const renderer = new THREE.WebGLRenderer({ canvas: dom, antialias: false, powerPreference: 'high-performance' });
  const maxDpr = lite ? 1 : lowPower ? 1.25 : 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setSize(window.innerWidth || 1280, window.innerHeight || 720, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0907);
  scene.fog = new THREE.FogExp2(0x100b08, 0.012);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.2;

  const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.3, 1400);
  camera.layers.enable(1);                                  // layer 1 = floor finish and decals (kept out of the mirror pass)

  // ---- textures -------------------------------------------------------------------------
  let loaded = 0, total = 0;
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const load = (url0, { srgb = true, wrap = false } = {}) => {
    const url = lite ? url0.replace(/^assets\/(archive|gen)\//, 'assets/lite/$1/') : url0;      // smaller copies for weak machines
    total++;
    return new Promise((res) => loader.load(url, (t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = lite ? 1 : Math.min(8, maxAniso);
      if (wrap) t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
      loaded++; onLoad?.(loaded / total); res(t);
    }, undefined, () => { console.warn('texture failed', url); loaded++; onLoad?.(loaded / total); res(null); }));
  };
  const imgs = new Set();
  for (const h of halls) {
    if (h.mural) imgs.add(h.mural.img);
    for (const f of [...(h.frames || []), ...(h.leftFrames || [])]) if (f.img) imgs.add(f.img);
    if (h.vitrine) imgs.add(h.vitrine.img);
  }
  imgs.add(hero.img); if (hero.side) imgs.add(hero.side.img);
  for (const t of Object.values(texts.transit || {})) if (t.vitrine) imgs.add(t.vitrine.img);
  const P = {
    stone: load('assets/gen/wall_stone.jpg', { wrap: true }),
    marble: load('assets/gen/marble_floor.jpg', { wrap: true }),
    frieze: load('assets/gen/ornament_frieze.jpg'),
    medallion: load('assets/gen/floor_medallion.jpg'),
    syrmak: load('assets/gen/syrmak.jpg'),
    steppe: load('assets/archive/aulietau.jpg'),
  };
  const PI_ = {}; for (const u of imgs) PI_[u] = load(u);
  const T = {}; for (const k in P) T[k] = await P[k];
  const IMG = {}; for (const u in PI_) IMG[u] = await PI_[u];
  T.frieze.wrapS = THREE.RepeatWrapping;
  const GLOW = glowTexture(), RAY = rayTexture();

  // ---- materials ------------------------------------------------------------------------
  const M = {
    stone: new THREE.MeshStandardMaterial({ map: T.stone, roughness: 0.92, metalness: 0, color: 0xcfc4b2 }),
    stoneDark: new THREE.MeshStandardMaterial({ map: T.stone, roughness: 0.85, color: 0x6f6657 }),
    basalt: new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.38, metalness: 0.25 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb8904f, roughness: 0.3, metalness: 1 }),
    walnut: new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.55, metalness: 0.1 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.95 }),
    mat: new THREE.MeshStandardMaterial({ color: 0xe9e0cd, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    sky: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.8, 0.58) }),
    glass: new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, envMapIntensity: 2.5, depthWrite: false }),
  };
  const litStone = (lm, intensity = 4.6) => {
    const m = M.stone.clone(); m.lightMap = lm; m.lightMapIntensity = intensity; return m;
  };
  // Anything laid flat on another surface (glows, friezes, labels, pictures in frames, floor finish) is pulled
  // toward the camera in depth so it can never z-fight the surface underneath, at any distance.
  const lift = (m, k = 1) => { m.polygonOffset = true; m.polygonOffsetFactor = -2 * k; m.polygonOffsetUnits = -8 * k; return m; };
  const additive = (map, opacity, color = 0xffffff) => lift(new THREE.MeshBasicMaterial({
    map, transparent: true, opacity, color, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }), 2);
  const LAMP = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.18, 0.74) });   // glowing strip of a picture light
  const FLOOR_Y = 0.06;                                      // mirror plane sits above every object's underside
  // Floor layers are separated by real height instead (a depth offset on a surface seen at a grazing angle would creep up the walls).
  const onFloor = (o, order) => { o.layers.set(1); o.renderOrder = order; o.material.polygonOffset = false; return o; };

  const root = new THREE.Group(); scene.add(root);
  const pickables = [];
  const shimmer = []; // god rays that breathe
  const mods = [];                                       // rooms in route order; only those near the visitor are drawn
  const rotG = new THREE.Group(); root.add(rotG); mods.push({ id: 'rot', g: rotG });
  const add = (o, parent = rotG) => { parent.add(o); return o; };

  // Flat wall with tiled stone (uv) + stretched lightmap (uv1).
  const TILE = 4.2;
  function wall(w, h, lm, intensity) {
    const g = new THREE.PlaneGeometry(w, h);
    g.setAttribute('uv1', g.attributes.uv.clone());
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / TILE, uv.getY(i) * h / TILE);
    return new THREE.Mesh(g, lm ? litStone(lm, intensity) : M.stone);
  }
  // Wall slab with an arched opening.
  function archWall(w, h, aw, ah, thick, mat = M.stone) {
    const s = new THREE.Shape();
    const r = aw / 2, sy = ah - r;
    s.moveTo(-w / 2, 0); s.lineTo(-r, 0); s.lineTo(-r, sy); s.absarc(0, sy, r, Math.PI, 0, true); s.lineTo(r, 0);
    s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 40 });
    g.translate(0, 0, -thick / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / TILE, uv.getY(i) / TILE);
    const grp = new THREE.Group(); grp.add(new THREE.Mesh(g, mat));
    // brass trim on both faces
    for (const sgn of [1, -1]) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(r + 0.1, 0.06, 8, 64, Math.PI), M.brass);
      arc.position.set(0, sy, sgn * (thick / 2 + 0.02)); grp.add(arc);
      for (const sx of [1, -1]) {
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.12, sy, 0.12), M.brass);
        jamb.position.set(sx * (r + 0.1), sy / 2, sgn * (thick / 2 + 0.02)); grp.add(jamb);
      }
    }
    return grp;
  }
  function glow(w, h, opacity = 0.35) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), additive(GLOW, opacity)); if (lite) m.visible = false; return m; }

  // Framed picture. Built facing +Z, origin at picture centre on the wall plane.
  function frame({ tex, id, hall, maxH = 2.5, maxW = 3.5, label, sub, big = false, poster = false }) {
    const g = new THREE.Group();
    const a = tex?.image ? tex.image.width / tex.image.height : 0.75;
    let h = maxH, w = h * a; if (w > maxW) { w = maxW; h = w / a; }
    const mt = (big || poster) ? 0 : 0.2, fr = big ? 0.16 : 0.11;
    const ow = w + (mt + fr) * 2, oh = h + (mt + fr) * 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(ow, oh, 0.12), big ? M.brass : M.walnut); body.position.z = 0.06; g.add(body);
    if (!big && !poster) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w + mt * 2 + 0.05, h + mt * 2 + 0.05, 0.03), M.brass); lip.position.z = 0.125; g.add(lip);
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(w + mt * 2, h + mt * 2), M.mat); mat.position.z = 0.145; g.add(mat);
    }
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lift(new THREE.MeshBasicMaterial({ map: tex, color: big ? 0xf4f0ea : 0xddd7cc }), 2));
    pic.position.z = (big || poster) ? 0.13 : 0.152; g.add(pic);
    if (id) { pic.userData = { kind: poster ? 'open' : 'exhibit', id, hall, label }; pickables.push(pic); }
    const halo = glow(ow * 1.9, oh * 1.7, big ? 0.16 : 0.24); halo.position.set(0, oh * 0.12, 0.02); g.add(halo);
    if (!lite) { // brass picture light above the frame
      const ly = oh / 2 + 0.2, bw = Math.min(ow * 0.62, 5.2);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, bw, 10), M.brass); bar.rotation.z = Math.PI / 2; bar.position.set(0, ly, 0.38); g.add(bar);
      for (const sx of big ? [-1, 1] : [0]) { const stem = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.38), M.brass); stem.position.set(sx * bw * 0.3, ly, 0.19); g.add(stem); }
      const led = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.94, 0.02, 0.04), LAMP); led.position.set(0, ly - 0.045, 0.38); g.add(led);
    }
    if (label) {
      // Large, high-contrast caption plaque: readable from the middle of the hall.
      const pw = big ? 7.2 : Math.max(3.4, Math.min(ow * 1.25, 3.9)), px = big ? 1900 : 1000;
      const tex = textTexture([
        { t: label, size: big ? 78 : 76, weight: 700, color: '#fff3d2' },
        ...(sub ? [{ t: sub.toUpperCase(), size: big ? 40 : 38, font: TEXT, weight: 600, color: '#f0cf85', ls: 5, gap: 14 }] : []),
      ], { width: px, pad: 46, plate: true });
      const ph = pw / tex.userData.aspect;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.07, ph + 0.07, 0.05), M.brass);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), lift(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 2));
      const py = -oh / 2 - 0.16 - ph / 2;
      plate.position.set(0, py, 0.03); face.position.set(0, py, 0.058); g.add(plate, face);
      const wash = glow(pw * 1.5, ph * 2.4, 0.16); wash.position.set(0, py, 0.016); g.add(wash);
    }
    g.userData = { w: ow, h: oh };
    return g;
  }

  // ---- detailing kit: the things that make a wall read as architecture --------------------
  const panelTex = (() => {                      // walnut wainscot with raised panels, one panel per 2.05 m
    const c = canvas(512, 256), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#4a2e1b'); g.addColorStop(1, '#27170d'); x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 90; i++) {               // grain
      x.strokeStyle = i % 2 ? 'rgba(255,214,160,.045)' : 'rgba(0,0,0,.07)'; x.lineWidth = 1 + (i % 3);
      const y = (i * 37) % 256; x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(170, y + (i % 7) - 3, 340, y - (i % 5) + 2, 512, y); x.stroke();
    }
    const inset = (m, a, b) => { x.lineWidth = 6; x.strokeStyle = b; x.strokeRect(m, m, 512 - 2 * m, 256 - 2 * m); x.lineWidth = 2.5; x.strokeStyle = a; x.strokeRect(m + 5, m + 5, 512 - 2 * m - 10, 256 - 2 * m - 10); };
    inset(22, 'rgba(255,214,150,.32)', 'rgba(0,0,0,.6)'); inset(48, 'rgba(0,0,0,.45)', 'rgba(255,214,150,.2)');
    const t = canvasTex(c); t.wrapS = THREE.RepeatWrapping; return t;
  })();
  const dadoMat = new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.55, metalness: 0.05, emissive: 0xffffff, emissiveMap: panelTex, emissiveIntensity: 0.22 });
  const warmMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.18, 0.74) });       // lamp glass, LED strips
  const velvet = new THREE.MeshStandardMaterial({ color: 0x7c1622, roughness: 1 });
  const roundelMat = lift(new THREE.MeshBasicMaterial({ map: T.medallion, color: 0x9a9184 }), 2);
  const DADO = 0.86;
  // Lower wall panelling, brass rail, plinth and a stepped cornice. Built facing +Z with the wall plane at z = 0.
  function wallKit(parent, len, H, { dado = true, cornice = true } = {}) {
    const k = new THREE.Group(); parent.add(k);
    if (dado) {
      const g = new THREE.PlaneGeometry(len, DADO); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 2.05);
      const d = new THREE.Mesh(g, dadoMat); d.position.set(0, DADO / 2, 0.05); k.add(d);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.13), M.brass); cap.position.set(0, DADO + 0.035, 0.065); k.add(cap);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 0.15), M.basalt); plinth.position.set(0, 0.1, 0.075); k.add(plinth);
    }
    if (cornice && !lite) {
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 0.36), M.stoneDark); c1.position.set(0, H - 0.2, 0.18); k.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.2), M.brass); c2.position.set(0, H - 0.44, 0.1); k.add(c2);
    }
    return k;
  }
  const sconceG = { plate: new THREE.BoxGeometry(0.18, 0.56, 0.05), arm: new THREE.BoxGeometry(0.05, 0.05, 0.26), globe: new THREE.SphereGeometry(0.13, 18, 12), cup: new THREE.CylinderGeometry(0.09, 0.05, 0.1, 14) };
  function sconce(parent, x, y, z = 0) {         // brass wall lamp with a soft wash on the wall
    const s = new THREE.Group(); if (lite) return s;
    const pl = new THREE.Mesh(sconceG.plate, M.brass); pl.position.z = 0.025; s.add(pl);
    const ar = new THREE.Mesh(sconceG.arm, M.brass); ar.position.set(0, 0.06, 0.15); s.add(ar);
    const cu = new THREE.Mesh(sconceG.cup, M.brass); cu.position.set(0, 0.12, 0.27); s.add(cu);
    const gl = new THREE.Mesh(sconceG.globe, warmMat); gl.position.set(0, 0.28, 0.27); s.add(gl);
    const wash = glow(2.4, 3.8, 0.34); wash.position.set(0, 0.7, 0.03); s.add(wash);
    s.position.set(x, y, z); parent.add(s); return s;
  }
  function roundel(parent, x, y, r = 1.2, z = 0.04) {  // carved ornament rosette in a brass ring
    if (lite) return;
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 64), roundelMat); d.position.set(x, y, z); parent.add(d);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 8, 64), M.brass); ring.position.set(x, y, z + 0.02); parent.add(ring);
    const g2 = glow(r * 4.4, r * 4.4, 0.2); g2.position.set(x, y + r * 0.3, z - 0.02); parent.add(g2);
  }
  const ringG = new THREE.TorusGeometry(1.25, 0.055, 10, 72), bandG2 = new THREE.TorusGeometry(1.19, 0.028, 8, 72);
  function chandelier(parent, x, y, z, H) {      // brass ring pendant with a glowing inner band
    if (lite) return;
    const c = new THREE.Group();
    const ring = new THREE.Mesh(ringG, M.brass); ring.rotation.x = Math.PI / 2; c.add(ring);
    const band = new THREE.Mesh(bandG2, warmMat); band.rotation.x = Math.PI / 2; band.position.y = -0.05; c.add(band);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2, rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, H - y, 6), M.brass);
      rod.position.set(Math.cos(a) * 1.25, (H - y) / 2, Math.sin(a) * 1.25); c.add(rod);
    }
    const g2 = glow(7, 7, 0.1); g2.rotation.x = Math.PI / 2; g2.position.y = -0.12; c.add(g2);
    c.position.set(x, y, z); parent.add(c);
  }
  const postG = new THREE.LatheGeometry([[0, 0], [0.17, 0], [0.17, 0.035], [0.045, 0.07], [0.035, 0.9], [0.065, 0.93], [0.065, 0.99], [0, 1.02]].map(([a, b]) => new THREE.Vector2(a, b)), 18);
  function barrier(parent, x, z0, z1, n = 5) {   // brass posts with a velvet rope along local z
    if (lite) return;
    for (let i = 0; i < n; i++) {
      const z = z0 + (z1 - z0) * i / (n - 1), p = new THREE.Mesh(postG, M.brass); p.position.set(x, 0, z); parent.add(p);
      if (i) {
        const zp = z0 + (z1 - z0) * (i - 1) / (n - 1);
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0.94, zp), new THREE.Vector3(x, 0.66, (z + zp) / 2), new THREE.Vector3(x, 0.94, z));
        parent.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.024, 6), velvet));
      }
    }
  }
  function wallText(parent, lines, worldW, x, y, opts) { if (lite) return null; const t = textPlane(lines, worldW, opts); t.position.set(x, y, 0.05); parent.add(t); return t; }

  // ---- rotunda --------------------------------------------------------------------------
  {
    const R = ROT;
    const lmSide = wallLightmap(28 / R.H, [{ u: 0.14, a: 0.8, w: 1.3 }, { u: 0.5, a: 0.95, w: 2.2 }, { u: 0.86, a: 0.8, w: 1.3 }], 0.2);
    const back = add(wall(28, R.H, lmSide)); back.position.set(0, R.H / 2, R.half); back.rotation.y = Math.PI;
    const left = add(wall(28, R.H, lmSide)); left.position.set(-R.half, R.H / 2, 0); left.rotation.y = Math.PI / 2;
    const right = add(wall(28, R.H, lmSide)); right.position.set(R.half, R.H / 2, 0); right.rotation.y = -Math.PI / 2;
    const front = add(archWall(28, R.H, 5.2, 6.6, HALL.T)); front.position.z = portalZ(0);

    // ceiling with a round opening for the dome
    const cs = new THREE.Shape(); cs.moveTo(-14, -14); cs.lineTo(14, -14); cs.lineTo(14, 14); cs.lineTo(-14, 14); cs.lineTo(-14, -14);
    const hole = new THREE.Path(); hole.absarc(0, 0, R.domeR, 0, Math.PI * 2, true); cs.holes.push(hole);
    const ceil = add(new THREE.Mesh(new THREE.ShapeGeometry(cs, 64), M.ceiling)); ceil.rotation.x = Math.PI / 2; ceil.position.y = R.H;

    // dome = yurt roof: ribs (uyq) rising to the shanyrak ring and a bright oculus
    const domeH = 0.86, ocR = 1.9, th0 = Math.asin(ocR / R.domeR);
    const dome = add(new THREE.Mesh(
      new THREE.SphereGeometry(R.domeR, 64, 24, 0, Math.PI * 2, th0, Math.PI / 2 - th0),
      new THREE.MeshStandardMaterial({ color: 0xbfae93, roughness: 0.95, side: THREE.BackSide, map: T.stone })));
    dome.scale.y = domeH; dome.position.y = R.H;
    const topY = R.H + Math.cos(th0) * R.domeR * domeH;
    for (let i = 0; i < 28; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(R.domeR - 0.07, 0.05, 6, 28, Math.PI / 2 - th0), M.brass);
      const piv = new THREE.Group(); piv.add(rib); piv.rotation.y = (i / 28) * Math.PI * 2; piv.scale.y = domeH; piv.position.y = R.H; add(piv);
    }
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(ocR, 0.13, 10, 64), M.brass)); ring.rotation.x = Math.PI / 2; ring.position.y = topY;
    for (const rot of [0, Math.PI / 2]) for (const off of [-0.45, 0, 0.45]) {     // crossed, bowed bars of the shanyrak
      const half = Math.sqrt(ocR * ocR - off * off);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-half, 0, off), new THREE.Vector3(0, 0.55, off), new THREE.Vector3(half, 0, off));
      const bar = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.05, 6), M.brass);
      bar.rotation.y = rot; bar.position.y = topY; add(bar);
    }
    const oc = add(new THREE.Mesh(new THREE.CircleGeometry(ocR * 1.6, 48), M.sky)); oc.rotation.x = Math.PI / 2; oc.position.y = topY + 0.9;
    // entablature ring carrying the ornament frieze
    const fr = T.frieze.clone(); fr.wrapS = THREE.RepeatWrapping; fr.repeat.set(14, 1); fr.needsUpdate = true;
    const band = add(new THREE.Mesh(new THREE.CylinderGeometry(R.domeR, R.domeR, 1.1, 96, 1, true),
      new THREE.MeshBasicMaterial({ map: fr, side: THREE.BackSide, color: 0xd9d2c4 }))); band.position.y = R.H - 0.05;
    const lipA = add(new THREE.Mesh(new THREE.TorusGeometry(R.domeR, 0.09, 8, 96), M.brass)); lipA.rotation.x = Math.PI / 2; lipA.position.y = R.H - 0.6;
    const lipB = add(new THREE.Mesh(new THREE.TorusGeometry(R.domeR, 0.09, 8, 96), M.brass)); lipB.rotation.x = Math.PI / 2; lipB.position.y = R.H + 0.5;
    const arch = add(new THREE.Mesh(new THREE.CylinderGeometry(R.colR + 0.75, R.colR + 0.75, 0.9, 96, 1, true), M.stoneDark)); arch.position.y = R.H - 0.45;

    // colonnade
    const colTex = T.stone.clone(); colTex.repeat.set(2, 3); colTex.needsUpdate = true;
    const colMat = new THREE.MeshStandardMaterial({ map: colTex, roughness: 0.8, color: 0xd9cfbd });
    const shaftG = new THREE.CylinderGeometry(0.46, 0.54, R.H - 1.9, 28), baseG = new THREE.CylinderGeometry(0.76, 0.82, 0.5, 28),
      capG = new THREE.CylinderGeometry(0.78, 0.5, 0.55, 28), bandG = new THREE.TorusGeometry(0.5, 0.045, 8, 28);
    for (let i = 0; i < 12; i++) {
      const a = (i + 0.5) / 12 * Math.PI * 2, x = Math.cos(a) * R.colR, z = Math.sin(a) * R.colR;
      const sh = add(new THREE.Mesh(shaftG, colMat)); sh.position.set(x, 0.5 + (R.H - 1.9) / 2, z);
      const b = add(new THREE.Mesh(baseG, M.basalt)); b.position.set(x, 0.25, z);
      const c = add(new THREE.Mesh(capG, M.brass)); c.position.set(x, R.H - 1.4 + 0.27, z);
      const t = add(new THREE.Mesh(bandG, M.brass)); t.rotation.x = Math.PI / 2; t.position.set(x, 0.62, z);
      const gl = add(onFloor(glow(2.2, 2.2, 0.1), 3)); gl.rotation.x = -Math.PI / 2; gl.position.set(x, FLOOR_Y + 0.03, z);
    }

    // floor medallion
    const med = add(new THREE.Mesh(new THREE.CircleGeometry(7.2, 96),
      lift(new THREE.MeshStandardMaterial({ map: T.medallion, roughness: 0.25, metalness: 0.15, transparent: true, opacity: lowPower ? 1 : 0.86, color: 0xb9b2a6 }), 2)));
    med.rotation.x = -Math.PI / 2; med.position.y = FLOOR_Y + 0.02; onFloor(med, 2);
    const pool = add(glow(15, 15, 0.12)); pool.rotation.x = -Math.PI / 2; pool.position.y = FLOOR_Y + 0.03; onFloor(pool, 3);

    // central stele with the portrait
    const SZ = -1.6;
    const stele = add(new THREE.Mesh(new THREE.BoxGeometry(3.7, 7.2, 0.8), M.basalt)); stele.position.set(0, 3.6, SZ);
    const plinth = add(new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.35, 1.6), M.basalt)); plinth.position.set(0, 0.175, SZ);
    const edge = add(new THREE.Mesh(new THREE.BoxGeometry(3.74, 0.05, 0.84), M.brass)); edge.position.set(0, 7.2, SZ);
    const pf = add(frame({ tex: IMG[hero.img], id: hero.id, hall: 0, maxH: 3.25, maxW: 2.7, label: null })); pf.position.set(0, 4.35, SZ + 0.4);
    const name = add(textPlane([
      { t: texts.heroName, size: 92, weight: 600, color: 'brass', ls: 10 },
      { t: texts.heroYears, size: 44, font: TEXT, weight: 400, color: '#cdb07a', ls: 14, gap: 10 },
    ], 3.2, { width: 1100 })); name.position.set(0, 1.55, SZ + 0.41);
    const quote = add(textPlane([
      { t: texts.quote, size: 66, weight: 500, italic: true, color: '#efe3c8' },
      { t: texts.quoteBy, size: 32, font: TEXT, weight: 400, color: '#c8ab72', ls: 6, gap: 26 },
    ], 3.0, { width: 1000, pad: 30 })); quote.position.set(0, 4.0, SZ - 0.41); quote.rotation.y = Math.PI;

    // light shaft from the shanyrak onto the stele
    const shaft = add(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 4.4, topY, 40, 1, true), additive(RAY, 0.13)));
    shaft.position.set(0, topY / 2, -0.4); shimmer.push({ m: shaft.material, base: 0.13, ph: 0 });

    // title over the portal + side wall dressing
    const lint = add(textPlane([{ t: texts.portalTitle, size: 70, weight: 600, color: 'brass', ls: 16 }], 9, { width: 1800 }));
    lint.position.set(0, 8.3, portalZ(0) + HALL.T / 2 + 0.04);
    const fr2 = T.frieze.clone(); fr2.wrapS = THREE.RepeatWrapping; fr2.repeat.set(9, 1); fr2.needsUpdate = true;
    const friezeMat = lift(new THREE.MeshBasicMaterial({ map: fr2, color: 0xb9b2a4 }));
    for (const [x, z, ry] of [[-R.half + 0.03, 0, Math.PI / 2], [R.half - 0.03, 0, -Math.PI / 2], [0, R.half - 0.03, Math.PI]]) {
      const f = add(new THREE.Mesh(new THREE.PlaneGeometry(28, 1.0), friezeMat)); f.position.set(x, R.H - 1.5, z); f.rotation.y = ry;
    }
    const syrMat = lift(new THREE.MeshStandardMaterial({ map: T.syrmak, roughness: 1, color: 0xd8d0c4 }), 3);
    const hang = (x, z, ry) => {
      const s = add(new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.1), syrMat)); s.position.set(x, 4.6, z); s.rotation.y = ry;
      const g2 = add(glow(7, 9, 0.18)); g2.position.set(x, 5.2, z); g2.rotation.y = ry; g2.translateZ(-0.02);
    };
    hang(R.half - 0.06, -7, -Math.PI / 2); hang(R.half - 0.06, 7, -Math.PI / 2);
    // panelling, cornice, wall lamps and rosettes round the hall; a welcome text between the carpets
    for (const [x, z, ry] of [[-R.half, 0, Math.PI / 2], [R.half, 0, -Math.PI / 2], [0, R.half, Math.PI]]) {
      const kit = wallKit(rotG, 28, R.H); kit.position.set(x, 0, z); kit.rotation.y = ry;
      for (const u of [-11.6, -3.6, 3.6, 11.6]) sconce(kit, u, 4.6);
      if (x < 0) { roundel(kit, -8.6, 5.2, 1.5); roundel(kit, 8.6, 5.2, 1.5); }
      if (x > 0) wallText(kit, [
        { t: texts.welcome[0], size: 44, font: TEXT, weight: 600, color: '#f0cf85', ls: 10 },
        { t: texts.welcome[1], size: 118, weight: 600, color: 'brass', gap: 18 },
        { t: texts.welcome[2], size: 46, weight: 500, italic: true, color: '#efe3c8', gap: 20 },
      ], 4.2, 0, 5.2, { width: 1100, pad: 20 });
    }
    for (const sx of [-1, 1]) { sconce(rotG, sx * 5.4, 4.4, portalZ(0) + HALL.T / 2 + 0.01); }
    hang(-9, portalZ(0) + HALL.T / 2 + 0.05, 0); hang(9, portalZ(0) + HALL.T / 2 + 0.05, 0);
    if (hero.side && IMG[hero.side.img]) {
      const sf = add(frame({ tex: IMG[hero.side.img], id: hero.side.id, hall: 0, maxH: 4.4, maxW: 7.4, label: hero.side.label, sub: hero.side.sub }));
      sf.position.set(-R.half + 0.02, 4.9, 0); sf.rotation.y = Math.PI / 2;
    }
  }

  { // the first hall is entered straight from the rotunda: its title sits under the museum title on that portal
    const lt = add(textPlane([{ t: `${halls[0].num} · ${halls[0].title}`.toUpperCase(), size: 60, weight: 600, color: '#d9c08a', ls: 12 }], 6.4, { width: 1900 }));
    lt.position.set(0, 7.35, portalZ(0) + HALL.T / 2 + 0.04);
  }

  // ---- plan: rooms are modules chained one after another ----------------------------------
  // Each module is built in its own group: entrance at local z = 0, walking direction local -Z.
  // The chain turns at corner pavilions and changes level on staircases, so the route is a
  // two-storey loop instead of one straight corridor.
  const RISE = 4.5, TALL = HALL.H + RISE, Li = HALL.L - HALL.T;
  const floorRects = [[], []];                   // world [x0, x1, z0, z1] per level (0 = ground, 1 = upper)
  const plan = [];                               // footprint of every room, for the minimap
  const keys = [];
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  let cursor = { x: 0, y: 0, z: portalZ(0), yaw: 0 };
  function begin(id) {
    const g = new THREE.Group(); g.position.set(cursor.x, cursor.y, cursor.z); g.rotation.y = cursor.yaw;
    root.add(g); g.updateMatrixWorld(true); mods.push({ id, g }); return g;
  }
  function advance(g, lx, ly, lz, dyaw = 0) { const v = V([lx, ly, lz]).applyMatrix4(g.matrixWorld); cursor = { x: v.x, y: v.y, z: v.z, yaw: cursor.yaw + dyaw }; }
  function worldRect(g, x0, x1, z0, z1, ly = 0) {
    const a = V([x0, ly, z0]).applyMatrix4(g.matrixWorld), b = V([x1, ly, z1]).applyMatrix4(g.matrixWorld);
    return { r: [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z)], lv: Math.round(a.y / RISE) };
  }
  function floorRect(g, x0, x1, z0, z1, ly = 0, meta) { const w = worldRect(g, x0, x1, z0, z1, ly); floorRects[w.lv].push(w.r); if (meta) plan.push({ ...w, ...meta }); return w.lv; }
  // optional mp / mt: framing for portrait (phone) screens
  const K = (g, p, t, meta, mp, mt) => { const w = (a) => V(a).applyMatrix4(g.matrixWorld); keys.push({ p: w(p), t: w(t), mp: w(mp || p), mt: w(mt || t), ...meta }); };

  const hallFriezeTex = T.frieze.clone(); hallFriezeTex.wrapS = THREE.RepeatWrapping; hallFriezeTex.repeat.set(8, 1); hallFriezeTex.needsUpdate = true;
  const hallFrieze = lift(new THREE.MeshBasicMaterial({ map: hallFriezeTex, color: 0xb9b2a4 }));
  const cornerFriezeTex = T.frieze.clone(); cornerFriezeTex.wrapS = THREE.RepeatWrapping; cornerFriezeTex.repeat.set(4.4, 1); cornerFriezeTex.needsUpdate = true;
  const cornerFrieze = lift(new THREE.MeshBasicMaterial({ map: cornerFriezeTex, color: 0xb9b2a4 }));
  const syrSmall = lift(new THREE.MeshStandardMaterial({ map: T.syrmak, roughness: 1, color: 0xcfc7ba }), 3);
  const beamG = new THREE.BoxGeometry(HALL.W, 0.55, 0.45), pilG = new THREE.BoxGeometry(0.42, HALL.H - 1.9, 1.0),
    pilCapG = new THREE.BoxGeometry(0.56, 0.32, 1.2), pilSlimG = new THREE.BoxGeometry(0.3, HALL.H - 1.9, 0.56), pilSlimCapG = new THREE.BoxGeometry(0.42, 0.28, 0.72),
    longBeamG = new THREE.BoxGeometry(0.4, 0.5, Li), inlayG = new THREE.BoxGeometry(0.07, 0.012, Li);
  const painted = (color, lm, k = 3.1) => new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0, lightMap: lm, lightMapIntensity: k });

  // entrance wall of a module: arch, brass title above it, felt carpets either side (seen from the previous room)
  function entry(g, { h = HALL.H, aw = 5.2, ah = 6.6, title = null, dress = true } = {}) {
    g.add(archWall(HALL.W, h, aw, ah, HALL.T));
    if (title) {
      const lt = textPlane([{ t: title.toUpperCase(), size: 60, weight: 600, color: 'brass', ls: 12 }], aw > 6 ? 6.2 : 7.2, { width: 1900 });
      lt.position.set(0, aw > 6 ? 8.15 : 7.75, HALL.T / 2 + 0.04); g.add(lt);
    }
    if (dress) for (const sx of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 3.45), syrSmall); s.position.set(sx * 4.9, 3.6, HALL.T / 2 + 0.05); g.add(s);
      const g2 = glow(4.6, 6, 0.26); g2.position.set(sx * 4.9, 4.1, HALL.T / 2 + 0.03); g.add(g2);
    }
  }
  // glass case with a document or photograph
  function vitrine(ex, hall) {
    const v = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.95, 1.15), M.basalt); base.position.y = 0.475; v.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.04, 1.19), M.brass); top.position.y = 0.97; v.add(top);
    const glassG = new THREE.BoxGeometry(1.6, 0.6, 1.05);
    const glass = new THREE.Mesh(glassG, M.glass); glass.position.y = 1.29; glass.renderOrder = 5; v.add(glass);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glassG), new THREE.LineBasicMaterial({ color: 0xc9a25f, transparent: true, opacity: 0.8 })); edges.position.y = 1.29; v.add(edges);
    const tex = IMG[ex.img], a = tex.image.width / tex.image.height;
    let dw = 1.3, dh = dw / a; if (dh > 0.86) { dh = 0.86; dw = dh * a; }
    const doc = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), new THREE.MeshBasicMaterial({ map: tex, color: 0xf5efe2 }));
    doc.rotation.x = -Math.PI / 2 + 0.22; doc.position.set(0, 1.1, 0.02); v.add(doc);
    doc.userData = { kind: 'exhibit', id: ex.id, hall, label: ex.label }; pickables.push(doc);
    const g1 = glow(2.6, 2.0, 0.34); g1.rotation.x = -Math.PI / 2; g1.position.y = 1.0; v.add(g1);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.0), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, alphaMap: GLOW }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = FLOOR_Y + 0.025; onFloor(sh, 3); v.add(sh);
    return v;
  }

  // ---- gallery hall ---------------------------------------------------------------------
  function buildHall(h, i, { entryH = HALL.H, noEntry = false, mod }) {
    const g = begin(mod); const add = (o) => { g.add(o); return o; };
    if (!noEntry) entry(g, { h: entryH, title: `${h.num} · ${h.title}` });
    const zc = -HALL.L / 2, z0 = -HALL.T / 2, fz = (f) => z0 - f * Li;      // fraction from the entrance -> local z
    const rightFrames = h.frames || [], leftFrames = h.leftFrames || [];
    const spread = (n, a = 0.2, b = 0.8) => Array.from({ length: n }, (_, k) => n === 1 ? 0.5 : a + (b - a) * k / (n - 1));
    const rf = spread(rightFrames.length, 0.22, 0.78), lf = spread(leftFrames.length, 0.16, 0.84);

    // side walls: gallery paint lit by pools of warm light
    const lmL = wallLightmap(Li / HALL.H, h.mural ? [{ u: 0.5, w: 2.6, a: 1.0, r: 1.15 }] : lf.map((u) => ({ u, a: 0.9, w: 1.1 })), 0.05);
    const lmR = wallLightmap(Li / HALL.H, rf.map((u) => ({ u: 1 - u, a: 1.0, w: 1.2 })), 0.05);
    const L = add(wall(Li, HALL.H, lmL)); L.position.set(-HALL.W / 2, HALL.H / 2, zc); L.rotation.y = Math.PI / 2;
    const R = add(wall(Li, HALL.H, lmR)); R.position.set(HALL.W / 2, HALL.H / 2, zc); R.rotation.y = -Math.PI / 2;
    if (h.color) { L.material = painted(h.color, lmL); R.material = painted(h.color, lmR); }

    // ceiling with a slim lantern, beams
    const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(HALL.W, HALL.L), M.ceiling)); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, HALL.H, zc);
    const sky = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, Li - 6), M.sky)); sky.rotation.x = Math.PI / 2; sky.position.set(0, HALL.H - 0.06, zc);
    for (const sx of [-1, 1]) { const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, Li - 6), M.brass)); rail.position.set(sx * 0.82, HALL.H - 0.15, zc); }
    for (let k = 0; k <= 6; k++) { const b = add(new THREE.Mesh(beamG, M.walnut)); b.position.set(0, HALL.H - 0.27, z0 - 1.6 - k * (Li - 3.2) / 6); }

    // pilasters, frieze, skirting
    for (const sx of [-1, 1]) {
      for (const f of [0.03, 0.97]) {
        const p = add(new THREE.Mesh(pilG, M.stoneDark)); p.position.set(sx * (HALL.W / 2 - 0.21), (HALL.H - 1.9) / 2, fz(f));
        const c = add(new THREE.Mesh(pilCapG, M.brass)); c.position.set(sx * (HALL.W / 2 - 0.26), HALL.H - 1.9 + 0.16, fz(f));
      }
      const fr = add(new THREE.Mesh(new THREE.PlaneGeometry(Li, 0.95), hallFrieze)); fr.position.set(sx * (HALL.W / 2 - 0.04), HALL.H - 1.1, zc); fr.rotation.y = -sx * Math.PI / 2;
      // panelling, cornice, coffer beam and a brass line in the floor along each wall
      const kit = wallKit(g, Li, HALL.H); kit.position.set(sx * HALL.W / 2, 0, zc); kit.rotation.y = -sx * Math.PI / 2;
      const lb = add(new THREE.Mesh(longBeamG, M.walnut)); lb.position.set(sx * 3.6, HALL.H - 0.25, zc);
      const il = add(new THREE.Mesh(inlayG, M.brass)); il.position.set(sx * (HALL.W / 2 - 1.0), FLOOR_Y + 0.02, zc); onFloor(il, 2);
      const u = (f) => (sx < 0 ? (f - 0.5) : (0.5 - f)) * Li;          // fraction from the entrance -> position along this wall
      if (sx < 0) {                                                      // left wall: rosette, lamp, big picture, lamp, rosette
        if (h.mural) { roundel(kit, u(0.145), 4.7, 1.25); roundel(kit, u(0.855), 4.7, 1.25); sconce(kit, u(0.268), 5.3); sconce(kit, u(0.732), 5.3); }
      } else {                                                           // right wall: wall text at the entrance, lamps and slim pilasters between frames, facts at the far end
        wallText(kit, [
          { t: h.num, size: 230, weight: 500, color: 'brass' },
          { t: h.title, size: 74, weight: 700, color: '#fff3d2', gap: 6 },
          { t: h.lead, size: 34, font: TEXT, weight: 400, color: '#eadfc6', gap: 22 },
        ], 2.3, u(0.098), 4.25, { width: 760, pad: 16, align: 'left' });
        wallText(kit, [
          { t: 'ҮШ ДЕРЕК', size: 34, font: TEXT, weight: 600, color: '#f0cf85', ls: 8 },
          ...h.facts.map((f, n) => ({ t: f, size: 40, weight: 600, color: '#fff3d2', gap: n ? 20 : 26 })),
        ], 2.05, u(0.908), 4.0, { width: 700, pad: 34, plate: true });
        const fs = rf.length <= 3 ? rf : [];
        for (let n = 0; n + 1 < fs.length; n++) {
          const fm = (fs[n] + fs[n + 1]) / 2;
          const p = new THREE.Mesh(pilSlimG, M.stoneDark); p.rotation.y = Math.PI / 2; p.position.set(u(fm), (HALL.H - 1.9) / 2, 0.15); kit.add(p);
          const c = new THREE.Mesh(pilSlimCapG, M.brass); c.rotation.y = Math.PI / 2; c.position.set(u(fm), HALL.H - 1.9 + 0.14, 0.2); kit.add(c);
          sconce(kit, u(fm), 4.6, 0.3);
        }
      }
    }
    // pendant lights and a rope line in front of the big picture
    chandelier(g, 0, 6.5, fz(0.27), HALL.H); chandelier(g, 0, 6.5, fz(0.73), HALL.H);
    if (h.mural) barrier(g, -HALL.W / 2 + 1.5, zc + 5.4, zc - 5.4, 5);
    for (const sx of [-1, 1]) sconce(g, sx * 4.9, 4.6, -HALL.T / 2 - 0.001).rotation.y = Math.PI;        // lamps flanking the arch you came through

    // left wall: one large photograph; right wall: framed photographs and documents
    if (h.mural && IMG[h.mural.img]) {
      const m = add(frame({ tex: IMG[h.mural.img], id: h.mural.id, hall: i, maxH: 4.9, maxW: 9.2, big: true, label: h.mural.label, sub: h.mural.sub }));
      m.position.set(-HALL.W / 2 + 0.02, 4.72, zc); m.rotation.y = Math.PI / 2;
    }
    leftFrames.forEach((f, k) => {
      const tex = f.poster ? posterTexture(f.poster) : IMG[f.img]; if (!tex) return;
      const fm = add(frame({ tex, id: f.id, hall: i, label: f.label, sub: f.sub, maxH: f.maxH ?? (f.poster ? 2.9 : 2.5), maxW: f.maxW ?? 3.4, poster: !!f.poster }));
      fm.position.set(-HALL.W / 2 + 0.02, 3.95, fz(lf[k])); fm.rotation.y = Math.PI / 2;
    });
    rightFrames.forEach((f, k) => {
      const tex = f.poster ? posterTexture(f.poster) : IMG[f.img]; if (!tex) return;
      const fm = add(frame({ tex, id: f.id, hall: i, label: f.label, sub: f.sub, maxH: f.maxH ?? (f.poster ? 2.9 : 2.5), maxW: f.maxW ?? 3.4, poster: !!f.poster }));
      fm.position.set(HALL.W / 2 - 0.02, 3.95, fz(rf[k])); fm.rotation.y = -Math.PI / 2;
    });
    if (h.vitrine && IMG[h.vitrine.img]) { const v = add(vitrine(h.vitrine, i)); v.position.set(4.9, 0, fz(0.13)); v.rotation.y = -0.5; }

    // soft pools on the floor, faint shafts from the lantern
    for (const f of [0.22, 0.5, 0.78]) { const p = add(glow(8, 6.5, lowPower ? 0.03 : 0.06)); p.rotation.x = -Math.PI / 2; p.position.set(0, FLOOR_Y + 0.03, fz(f)); onFloor(p, 3); }
    for (let k = 0; k < 4; k++) {
      const ray = add(new THREE.Mesh(new THREE.PlaneGeometry(2.2, HALL.H * 1.12), additive(RAY, 0.04)));
      ray.position.set(-1.1 + (k % 2) * 0.5, HALL.H * 0.47, fz(0.2 + k * 0.2)); ray.rotation.set(0, 0.5 + k * 0.35, -0.3);
      shimmer.push({ m: ray.material, base: 0.04, ph: i * 2 + k });
    }

    const lv = floorRect(g, -7, 7, 0, -HALL.L, 0, { kind: 'hall', hall: i });
    const meta = (kind) => ({ hall: i, kind, mod, lv });
    K(g, [0, EYE, 0.5], [0, 3.0, -14], meta('enter'));
    K(g, [4.4, EYE, zc + 2.6], [-7, 3.9, zc - 2.2], meta('left'), [5.6, EYE, zc + 0.6], [-7, 2.2, zc]);
    K(g, [0.8, EYE, zc + 0.4], [5.6, 3.2, -HALL.L + 1.5], meta('mid'), [0, EYE, zc + 2], [0, 2.4, -HALL.L]);
    K(g, [-3.2, EYE, zc + 1.2], [7, 3.0, zc - 4.6], meta('right'), [-5.6, EYE, zc + 0.4], [7, 1.6, zc]);
    K(g, [0, EYE, -HALL.L + 5.5], [0, 3.0, -HALL.L - 12], meta('exit'));
    advance(g, 0, 0, -HALL.L);
  }

  // ---- grand staircase (dir +1 climbs, -1 descends) ---------------------------------------
  function buildStairs(dir, cfg, { hall, mod }) {
    const g = begin(mod), SL = 18;
    entry(g, { h: dir > 0 ? TALL : HALL.H });
    // The flight is modelled climbing toward -Z; a descending stair is the same geometry turned around.
    const inner = new THREE.Group(); if (dir < 0) { inner.rotation.y = Math.PI; inner.position.set(0, -RISE, -SL); }
    g.add(inner); inner.updateMatrixWorld(true);
    const add = (o) => { inner.add(o); return o; };
    const N = 14, tread = 0.38, rise = RISE / (2 * N), zA = -2.4, zLand = zA - N * tread, zB = zLand - 2.4, zTop = zB - N * tread;
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x2b2520, roughness: 0.55, metalness: 0.1 });
    const carpet = new THREE.MeshStandardMaterial({ color: 0x8c1f2b, roughness: 0.95 });
    const block = (zStart, len, top) => {                     // full-width tread + red runner with brass edging
      const zm = zStart - len / 2;
      const s = add(new THREE.Mesh(new THREE.BoxGeometry(HALL.W, top, len), stepMat)); s.position.set(0, top / 2, zm);
      const c = add(new THREE.Mesh(new THREE.BoxGeometry(3.4, top + 0.02, len), carpet)); c.position.set(0, (top + 0.02) / 2, zm + 0.02);
      for (const sx of [-1, 1]) { const e = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, top + 0.035, len), M.brass)); e.position.set(sx * 1.75, (top + 0.035) / 2, zm + 0.03); }
    };
    for (let k = 0; k < N; k++) block(zA - k * tread, tread, (k + 1) * rise);
    block(zLand, 2.4, N * rise);
    for (let k = 0; k < N; k++) block(zB - k * tread, tread, (N + k + 1) * rise);
    block(zTop, SL + zTop, RISE);
    { const c = add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.03, 2.4 - HALL.T / 2), carpet)); c.position.set(0, FLOOR_Y + 0.03, (zA - HALL.T / 2) / 2); }
    // walls, ceiling, lantern
    const wl = SL - HALL.T, zc = -SL / 2;
    const lm = wallLightmap(wl / TALL, [{ u: 0.5, w: 2.4, a: 0.95, r: 0.9 }, { u: 0.12, a: 0.4 }, { u: 0.88, a: 0.4 }], 0.05);
    for (const sx of [-1, 1]) {
      const w = add(wall(wl, TALL, lm)); w.material = painted(cfg.color, lm, 3.4); w.position.set(sx * HALL.W / 2, TALL / 2, zc); w.rotation.y = -sx * Math.PI / 2;
      const fr = add(new THREE.Mesh(new THREE.PlaneGeometry(wl, 0.95), hallFrieze)); fr.position.set(sx * (HALL.W / 2 - 0.04), TALL - 1.1, zc); fr.rotation.y = -sx * Math.PI / 2;
      // brass handrail following the flight
      const a = V([sx * 6.72, 1.05, zA]), b = V([sx * 6.72, RISE + 1.05, zTop]), d = b.clone().sub(a);
      const rail = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, d.length(), 10), M.brass));
      rail.position.copy(a).addScaledVector(d, 0.5); rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    }
    const stepY = (z) => (z > zA ? 0 : z > zLand ? Math.ceil((zA - z) / tread) * rise : z > zB ? N * rise : z > zTop ? (N + Math.ceil((zB - z) / tread)) * rise : RISE);
    for (const sx of [-1, 1]) {                    // cornice, lamps climbing with the flight, rosettes beside the carpet wall
      const kit = wallKit(inner, wl, TALL, { dado: false }); kit.position.set(sx * HALL.W / 2, 0, zc); kit.rotation.y = -sx * Math.PI / 2;
      for (const z of [-3.4, -7.2, -11.2, -14.9]) sconce(kit, sx < 0 ? zc - z : z - zc, stepY(z) + 3.3);
      if (sx > 0) { roundel(kit, -4.6, 6.1, 1.0); roundel(kit, 4.6, 9.4, 1.0); }
    }
    chandelier(inner, 0, 10.2, -5.4, TALL); chandelier(inner, 0, 10.9, -12.4, TALL);
    const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(HALL.W, SL), M.ceiling)); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, TALL, zc);
    const sky = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, SL - 6), M.sky)); sky.rotation.x = Math.PI / 2; sky.position.set(0, TALL - 0.06, zc);
    // statement in brass on the wall beside the flight
    const txt = add(textPlane([
      { t: cfg.big, size: 190, weight: 600, color: 'brass', ls: 6 },
      { t: cfg.line, size: 62, weight: 500, italic: true, color: '#efe3c8', gap: 18 },
    ], 8.6, { width: 1700, pad: 30 }));
    txt.position.set(-HALL.W / 2 + 0.06, 8.3, zc); txt.rotation.y = Math.PI / 2;
    const s = add(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.8), syrSmall)); s.position.set(HALL.W / 2 - 0.06, 8.2, zc); s.rotation.y = -Math.PI / 2;
    const sg = add(glow(7, 9, 0.24)); sg.position.set(HALL.W / 2 - 0.04, 8.6, zc); sg.rotation.y = -Math.PI / 2;
    const ray = add(new THREE.Mesh(new THREE.PlaneGeometry(3.4, TALL * 1.05), additive(RAY, 0.06))); ray.position.set(0, TALL * 0.5, zc); ray.rotation.set(0, 0.4, -0.25);
    shimmer.push({ m: ray.material, base: 0.06, ph: hall * 3 });

    floorRect(inner, -7, 7, 0, zA, 0); floorRect(inner, -7, 7, zTop, -SL, RISE);
    plan.push({ ...worldRect(g, -7, 7, 0, -SL, 0), lv: 0.5, kind: 'stairs', hall });
    const meta = (kind) => ({ hall, kind, mod, lv: 'both' });
    K(g, [0, EYE, 0.5], [0, dir > 0 ? 4.4 : -0.6, -14], meta('stair0'));
    K(g, [0, dir * RISE / 2 + EYE, -9.0], [dir > 0 ? -5.5 : 5.5, dir * RISE / 2 + (dir > 0 ? 4.6 : 6.2), -15], meta('stair1'), [0, dir * RISE / 2 + EYE, -9.0], [0, dir * RISE / 2 + 2.2, -22]);
    K(g, [0, dir * RISE + EYE, -16.9], [0, dir * RISE + 3.0, -30], meta('stair2'));
    advance(g, 0, dir * RISE, -SL);
  }

  // ---- corner pavilion: the route turns 90 degrees (turn +1 = left, -1 = right) -----------
  function buildCorner(turn, cfg, { entryH = HALL.H, hall, mod }) {
    const g = begin(mod), S = HALL.W; const add = (o) => { g.add(o); return o; };
    entry(g, { h: entryH });
    const lmFar = wallLightmap(S / HALL.H, [{ u: 0.5, w: 1.7, a: 1.0, r: 1.1 }], 0.03);
    const far = add(wall(S, HALL.H, lmFar)); far.material = painted(cfg.color, lmFar, 3.6); far.position.set(0, HALL.H / 2, -S);
    const sl = S - HALL.T / 2, lmSide = wallLightmap(sl / HALL.H, [{ u: 0.5, w: 1.3, a: 0.85 }], 0.03);
    const side = add(wall(sl, HALL.H, lmSide)); side.material = painted(cfg.color, lmSide, 3.4); side.position.set(turn * S / 2, HALL.H / 2, -(S + HALL.T / 2) / 2); side.rotation.y = -turn * Math.PI / 2;
    const f1 = add(new THREE.Mesh(new THREE.PlaneGeometry(S, 0.95), cornerFrieze)); f1.position.set(0, HALL.H - 1.1, -S + 0.04);
    const f2 = add(new THREE.Mesh(new THREE.PlaneGeometry(sl, 0.95), cornerFrieze)); f2.position.set(turn * (S / 2 - 0.04), HALL.H - 1.1, -(S + HALL.T / 2) / 2); f2.rotation.y = -turn * Math.PI / 2;
    const sy = add(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.8), syrSmall)); sy.position.set(turn * (S / 2 - 0.06), 4.3, -S / 2); sy.rotation.y = -turn * Math.PI / 2;
    const sg = add(glow(7, 9, 0.24)); sg.position.set(turn * (S / 2 - 0.04), 4.8, -S / 2); sg.rotation.y = -turn * Math.PI / 2;
    { // panelling, cornice and lamps on both closed walls
      const kf = wallKit(g, S, HALL.H); kf.position.set(0, 0, -S);
      sconce(kf, -5.4, 4.3); sconce(kf, 5.4, 4.3);
      const ks = wallKit(g, sl, HALL.H); ks.position.set(turn * S / 2, 0, -(S + HALL.T / 2) / 2); ks.rotation.y = -turn * Math.PI / 2;
      sconce(ks, -4.4, 4.3); sconce(ks, 4.4, 4.3);
      for (const sx of [-1, 1]) sconce(g, sx * 4.9, 4.6, -HALL.T / 2 - 0.001).rotation.y = Math.PI;
    }
    // the wall you walk towards carries one sentence in brass
    const txt = add(textPlane([
      { t: cfg.big, size: 210, weight: 600, color: 'brass', ls: 10 },
      { t: cfg.line, size: 64, weight: 500, italic: true, color: '#efe3c8', gap: 22 },
      { t: cfg.by, size: 34, font: TEXT, weight: 500, color: '#c8ab72', ls: 6, gap: 24 },
    ], 9.4, { width: 1800, pad: 30 }));
    txt.position.set(0, 5.3, -S + 0.06);
    // ceiling with a round oculus; its beam falls on the showcase under the inscription
    const PZ = -S + 3.0;
    const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(S, S), M.ceiling)); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, HALL.H, -S / 2);
    const oc = add(new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), M.sky)); oc.rotation.x = Math.PI / 2; oc.position.set(0, HALL.H - 0.06, PZ);
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.09, 8, 64), M.brass)); ring.rotation.x = Math.PI / 2; ring.position.set(0, HALL.H - 0.08, PZ);
    const beam = add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.5, HALL.H - 1.0, 40, 1, true), additive(RAY, 0.12))); beam.position.set(0, (HALL.H + 1.0) / 2, PZ);
    shimmer.push({ m: beam.material, base: 0.12, ph: hall * 5 });
    if (cfg.vitrine && IMG[cfg.vitrine.img]) { const v = add(vitrine(cfg.vitrine, hall)); v.position.set(0, 0, PZ); }
    const med = add(new THREE.Mesh(new THREE.CircleGeometry(4.2, 72), new THREE.MeshStandardMaterial({ map: T.medallion, roughness: 0.3, metalness: 0.15, transparent: true, opacity: lowPower ? 1 : 0.86, color: 0xb9b2a6 })));
    med.rotation.x = -Math.PI / 2; med.position.set(0, FLOOR_Y + 0.02, -S / 2); onFloor(med, 2);
    const pool = add(glow(8, 8, 0.16)); pool.rotation.x = -Math.PI / 2; pool.position.set(0, FLOOR_Y + 0.03, PZ); onFloor(pool, 3);

    const lv = floorRect(g, -7, 7, 0, -S, 0, { kind: 'corner', hall });
    const meta = (kind) => ({ hall, kind, mod, lv });
    K(g, [turn * 1.6, EYE, -3.4], [0, 4.2, -S], meta('corner0'), [0, EYE, -2.4], [0, 3.0, -S]);
    K(g, [turn * 1.2, EYE, -6.6], [-turn * S, 3.0, -S / 2 - 0.4], meta('corner1'));
    advance(g, -turn * S / 2, 0, -S / 2, turn * Math.PI / 2);
  }

  // ---- terrace over the steppe ------------------------------------------------------------
  function buildTerrace({ entryH = HALL.H, hall, mod }) {
    const g = begin(mod); const add = (o) => { g.add(o); return o; };
    entry(g, { h: entryH, aw: 7.4, ah: 7.3, title: texts.finalePortal, dress: false });
    // real panorama on the far side (arc centred on local -Z; texture flipped because it is seen from inside)
    const arc = 2.2, panoR = 150, panoH = panoR * arc / (T.steppe.image.width / T.steppe.image.height);
    T.steppe.wrapS = THREE.RepeatWrapping; T.steppe.repeat.x = -1; T.steppe.offset.x = 1;
    const pano = add(new THREE.Mesh(new THREE.CylinderGeometry(panoR, panoR, panoH, 64, 1, true, Math.PI - arc / 2, arc),
      new THREE.MeshBasicMaterial({ map: T.steppe, side: THREE.BackSide, fog: false, color: new THREE.Color(0.98, 0.98, 0.98) })));
    pano.position.set(0, EYE - 0.1 * panoH, -10);                    // horizon of the photograph at eye level
    { const c = canvas(4, 256), x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#000'); gr.addColorStop(0.22, '#fff'); gr.addColorStop(1, '#fff'); x.fillStyle = gr; x.fillRect(0, 0, 4, 256);
      pano.material.alphaMap = canvasTex(c, false); pano.material.transparent = true; }
    const skyCol = new THREE.Color(0.8, 0.72, 0.78);                // sampled from the top of the photograph
    try {
      const c = canvas(16, 16), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(T.steppe.image, 0, 0, 16, 16);
      const d = x.getImageData(0, 1, 16, 1).data; let r = 0, gg = 0, b = 0;
      for (let k = 0; k < d.length; k += 4) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; }
      skyCol.setRGB(r / 16 / 255, gg / 16 / 255, b / 16 / 255, THREE.SRGBColorSpace);
    } catch { /* keep the default */ }
    const skyDome = add(new THREE.Mesh(new THREE.SphereGeometry(520, 32, 16), new THREE.MeshBasicMaterial({ color: skyCol, side: THREE.BackSide, fog: false })));
    skyDome.position.set(0, 0, -10);
    const top = add(new THREE.Mesh(new THREE.BoxGeometry(26, 0.16, 0.34), M.basalt)); top.position.set(0, 1.08, -13.5);
    for (let k = -12; k <= 12; k++) { const p = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 10), M.brass)); p.position.set(k * 1.05, 0.5, -13.5); }
    for (const sx of [-1, 1]) { const w2 = add(wall(14, HALL.H, null)); w2.material = M.stoneDark; w2.position.set(sx * 13, HALL.H / 2, -7); w2.rotation.y = -sx * Math.PI / 2; }
    const lv = floorRect(g, -13, 13, 0, -14.1, 0, { kind: 'terrace', hall });
    K(g, [0, EYE, -3.5], [2, 4.5, -60], { hall, kind: 'terrace', mod, lv });
    K(g, [0, EYE + 0.2, -11.2], [9, 5.2, -90], { hall, kind: 'final', mod, lv });
  }

  // ---- the route ------------------------------------------------------------------------
  floorRects[0].push([-ROT.half, ROT.half, -ROT.half, ROT.half]); plan.push({ r: [-ROT.half, ROT.half, -ROT.half, ROT.half], lv: 0, kind: 'rotunda', hall: 0 });
  const R0 = { hall: 0, mod: 'rot', lv: 0 };
  K(root, [0, 3.0, 9.9], [0, 4.7, -1.6], { ...R0, kind: 'title' }, [0, 3.0, 9.9], [0, 3.6, -1.6]);
  K(root, [1.5, 2.6, 6.2], [2.2, 4.1, -1.6], { ...R0, kind: 'portrait' }, [0, 2.6, 7.6], [0, 2.7, -1.6]);
  K(root, [7.0, 2.5, 2.0], [-2.5, 4.8, -3.5], { ...R0, kind: 'side' });
  K(root, [1.2, 2.4, -4.6], [-0.6, 3.6, -30], { ...R0, kind: 'exit' });
  const tr = texts.transit;
  const route = [
    ['hall', 0], ['stairs', +1, tr.s1], ['hall', 1], ['corner', +1, tr.c1], ['hall', 2], ['corner', +1, tr.c2], ['hall', 3],
    ['stairs', -1, tr.s2], ['hall', 4], ['corner', -1, tr.c3], ['hall', 5], ['stairs', +1, tr.s3], ['hall', 6], ['terrace'],
  ];
  let lastHall = 0, prevKind = 'rotunda', prevDir = 0;
  route.forEach(([kind, a, cfg], n) => {
    const entryH = (kind === 'stairs' && a > 0) || (prevKind === 'stairs' && prevDir < 0) ? TALL : HALL.H;
    if (kind === 'hall') { lastHall = a + 1; buildHall(halls[a], a + 1, { entryH, noEntry: n === 0, mod: `h${a + 1}` }); }
    else if (kind === 'stairs') buildStairs(a, cfg, { hall: lastHall, mod: cfg.id });
    else if (kind === 'corner') buildCorner(a, cfg, { entryH, hall: lastHall, mod: cfg.id });
    else buildTerrace({ entryH, hall: halls.length + 1, mod: 'end' });
    prevKind = kind; prevDir = kind === 'stairs' ? a : 0;
  });
  // which floor mirrors are needed at each key (both around staircases)
  keys.forEach((k, i) => {
    const s = new Set();
    for (const j of [i - 1, i, i + 1]) { const q = keys[j]; if (!q) continue; if (q.lv === 'both') { s.add(0); s.add(1); } else s.add(q.lv); }
    k.lvs = s; k.mi = mods.findIndex((m) => m.id === k.mod);
  });

  // ---- floors: one mirror + one marble sheet per level, cut to the rooms of that level ----
  function sheet(rects, scaleUv) {
    const pos = [], uv = [], idx = [];
    rects.forEach(([x0, x1, z0, z1], n) => {
      pos.push(x0, -z0, 0, x1, -z0, 0, x1, -z1, 0, x0, -z1, 0);               // local XY; rotated onto the floor below
      uv.push(x0 / scaleUv, -z0 / scaleUv, x1 / scaleUv, -z0 / scaleUv, x1 / scaleUv, -z1 / scaleUv, x0 / scaleUv, -z1 / scaleUv);
      const b = n * 4; idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals(); return geo;
  }
  const reflectors = [null, null];
  const marbleMat = new THREE.MeshStandardMaterial({
    map: T.marble, roughness: lowPower ? 0.7 : 0.5, metalness: 0.0, color: 0xa9a39a,
    transparent: !lowPower, opacity: lowPower ? 1 : 0.74, envMapIntensity: 0.7,
  });
  [0, 1].forEach((lv) => {
    const y = lv * RISE + FLOOR_Y;
    if (!lowPower) {
      const rf = new Reflector(sheet(floorRects[lv], 7), {
        textureWidth: Math.min(1400, window.innerWidth || 1280), textureHeight: Math.min(900, window.innerHeight || 720), color: 0x8a8a8a, clipBias: 0, multisample: 0,
      });
      rf.rotation.x = -Math.PI / 2; rf.position.y = y; rf.renderOrder = -1; rf.frustumCulled = false; root.add(rf); reflectors[lv] = rf;
    }
    const m = new THREE.Mesh(sheet(floorRects[lv], 7), marbleMat); m.rotation.x = -Math.PI / 2; m.position.y = y + 0.01; m.frustumCulled = false; root.add(onFloor(m, 1));
  });

  // ---- lights: low ambient, warm fill travelling with the visitor -------------------------
  scene.add(new THREE.HemisphereLight(0xffe9cc, 0x2a1f18, lite ? 0.62 : 0.36));
  const sunL = new THREE.DirectionalLight(0xffdcae, 0.28); sunL.position.set(-3, 12, 4); scene.add(sunL);
  const lamp = new THREE.PointLight(0xffdcb0, 7, 18, 1.4); if (!lite) scene.add(lamp);      // no per-pixel point light on weak GPUs

  // ---- camera path ----------------------------------------------------------------------
  const posCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.p), false, 'catmullrom', 0.5);
  const tgtCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.t), false, 'catmullrom', 0.5);
  const posCurveM = new THREE.CatmullRomCurve3(keys.map((k) => k.mp), false, 'catmullrom', 0.5);
  const tgtCurveM = new THREE.CatmullRomCurve3(keys.map((k) => k.mt), false, 'catmullrom', 0.5);
  let tall = false;

  // ---- post -----------------------------------------------------------------------------
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  let composer, bloom, grade;
  if (lite) {                                              // ultra-light: straight to the screen, no bloom or grading passes
    root.traverse((o) => { if (o.isMesh && o.material?.blending === THREE.AdditiveBlending) o.visible = false; });   // light shafts and glows off
    composer = { render: () => renderer.render(scene, camera), setSize() {} };
    bloom = { strength: 0 }; grade = { uniforms: { uTime: { value: 0 }, uFade: { value: 0 } } };
  } else {
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: lowPower ? 0 : 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(2, size.x / 2), Math.max(2, size.y / 2)), 0.16, 0.6, 1.0);
    composer.addPass(bloom);
    grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uFade; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 q = vUv-0.5; float v = smoothstep(0.92,0.25,length(q*vec2(1.0,1.15)));
        c.rgb *= mix(0.6,1.0,v); float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722)); c.rgb = max(mix(vec3(l), c.rgb, 1.16), 0.0);
        c.rgb += (h(vUv*vec2(1920.0,1080.0)+uTime)-0.5)*0.014;
        c.rgb = mix(c.rgb, vec3(1.0,0.96,0.9), uFade); gl_FragColor = c; }`,
  });
    composer.addPass(grade);
    composer.addPass(new OutputPass());
  }

  // ---- state ----------------------------------------------------------------------------
  const state = { target: 0, cur: 0, mx: 0, my: 0, smx: 0, smy: 0, hover: null, running: true, focus: null };
  const tmpP = new THREE.Vector3(), tmpT = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const clock = { last: performance.now(), elapsedTime: 0, getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; this.elapsedTime += Math.min(d, 0.1); return d; }, start() { this.last = performance.now(); } };
  const ray = new THREE.Raycaster(); ray.far = 26;
  const ndc = new THREE.Vector2();

  function place(u) {
    (tall ? posCurveM : posCurve).getPoint(u, tmpP); (tall ? tgtCurveM : tgtCurve).getPoint(u, tmpT);
    dir.subVectors(tmpT, tmpP).normalize(); right.crossVectors(dir, up).normalize();
    const time = clock.elapsedTime;
    tmpP.y += Math.sin(time * 0.8) * 0.018;
    tmpT.addScaledVector(right, state.smx * 1.1).addScaledVector(up, -state.smy * 0.6);
    camera.position.copy(tmpP); camera.lookAt(tmpT);
    lamp.position.copy(tmpP).addScaledVector(dir, 2.5); lamp.position.y = tmpP.y + 1.85;
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;                                  // hidden tab / zero-size pane: keep the last good size
    renderer.setSize(w, h, false); composer.setSize(w, h);
    tall = w / h < 0.8;
    camera.aspect = w / h; camera.fov = w / h < 0.8 ? 82 : w / h < 1.2 ? 70 : w / h < 1.6 ? 62 : 56; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  function tick() {
    if (!state.running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1), time = clock.elapsedTime;
    state.cur += (state.target - state.cur) * (1 - Math.exp(-dt * 3.4));
    state.smx += (state.mx - state.smx) * (1 - Math.exp(-dt * 4)); state.smy += (state.my - state.smy) * (1 - Math.exp(-dt * 4));
    place(THREE.MathUtils.clamp(state.cur, 0, 1));
    grade.uniforms.uTime.value = time % 10;
    for (const s of shimmer) s.m.opacity = s.base * (0.75 + 0.25 * Math.sin(time * 0.5 + s.ph));
    // whiteout as the visitor steps onto the terrace, then clears
    const kf = state.cur * (keys.length - 1), tIdx = keys.length - 2;
    cull(kf);
    grade.uniforms.uFade.value = Math.max(0, 1 - Math.abs(kf - (tIdx - 0.5)) / 0.45) * 0.22;
    const r0 = performance.now(); composer.render(dt); const cpu = performance.now() - r0;
    // adaptive quality: if frames stay slow for a couple of seconds, step down (resolution first, then the floor mirrors)
    // (a browser that throttles a background tab also gives long frames, but then the render itself stays cheap)
    slow = dt > 0.034 && cpu > 9 ? slow + 1 : Math.max(0, slow - 2);
    if (slow > 110 && quality > 0) { slow = 0; degrade(); }
  }
  // draw only the rooms around the visitor, and only the floor mirrors of the level(s) in view
  function cull(kf) {
    const k0 = keys[Math.max(0, Math.min(keys.length - 1, Math.floor(kf)))], k1 = keys[Math.min(keys.length - 1, Math.floor(kf) + 1)];
    for (const lv of [0, 1]) if (reflectors[lv]) reflectors[lv].visible = quality > 0 && (k0.lvs.has(lv) || k1.lvs.has(lv));
    const reach = lite ? 1 : 2;
    for (let i = 0; i < mods.length; i++) mods[i].g.visible = Math.abs(i - k0.mi) <= reach || Math.abs(i - k1.mi) <= reach;
  }
  let quality = lite ? 0 : 2, slow = 0;                               // 2 = full, 1 = lower resolution, 0 = no mirrors
  function degrade() {
    quality--;
    if (quality === 1) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.1)); bloom.strength = 0.14; }
    else { renderer.setPixelRatio(1); marbleMat.transparent = false; marbleMat.opacity = 1; marbleMat.roughness = 0.6; marbleMat.needsUpdate = true; }
    resize();
  }

  function pick(clientX, clientY) {
    ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false).find((h) => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; });
    return hit ? hit.object.userData : null;
  }

  return {
    keys: keys.map((k) => ({ hall: k.hall, kind: k.kind, mod: k.mod })),
    plan,
    where() { return { x: camera.position.x, y: camera.position.y, z: camera.position.z }; },
    start() { clock.start(); tick(); },
    setProgress(p) { state.target = THREE.MathUtils.clamp(p, 0, 1); },
    jump(p) { state.target = state.cur = THREE.MathUtils.clamp(p, 0, 1); },
    get progress() { return state.cur; },
    setPointer(x, y) { state.mx = (x / window.innerWidth) * 2 - 1; state.my = (y / window.innerHeight) * 2 - 1; },
    pick,
    setPaused(v) { if (v === !state.running) return; state.running = !v; if (!v) { clock.getDelta(); tick(); } },
    renderOnce() { cull(state.cur * (keys.length - 1)); place(state.cur); composer.render(0.016); },
    renderFrom(p, t) { camera.position.set(...p); camera.lookAt(...t); composer.render(0.016); },
    get quality() { return quality; },
    lowerQuality() { if (quality > 0) degrade(); return quality; },
    // Real cost of a frame in milliseconds (GPU included), measured synchronously at two busy viewpoints.
    // Independent of requestAnimationFrame, so a throttled background tab does not distort it.
    bench(frames = 6) {
      const gl = renderer.getContext(); let total = 0, n = 0;
      for (const kf of [1, 10]) {
        const u = kf / (keys.length - 1); cull(kf); place(u); composer.render(0.016); gl.finish();      // warm-up: shaders, texture uploads
        const t0 = performance.now(); for (let i = 0; i < frames; i++) { composer.render(0.016); gl.finish(); }
        total += performance.now() - t0; n += frames;
      }
      cull(state.cur * (keys.length - 1)); place(state.cur);
      return total / n;
    },
    debug: { scene, camera, renderer },
  };
}
