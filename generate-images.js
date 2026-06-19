#!/usr/bin/env node
// Executa UMA VEZ: node generate-images.js
// Gera public/images/original.svg (gabarito do Master) e public/images/modified.svg (imagem dos jogadores)
'use strict';

const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'public', 'images');

/* ── Dimensões ───────────────────────────────────────────────────────────── */
const W = 1400, H = 480;
const ROWS = 6, COLS = 14;
const CW = W / COLS;   // 100 px por coluna
const RH = H / ROWS;   //  80 px por linha

/* ── Paletas ─────────────────────────────────────────────────────────────── */
const SHIRT = {
  white:  '#f0f0f0',
  yellow: '#f0c040',
  navy:   '#1a3a6e',
  green:  '#1c7a38',
};
const SKIN        = ['#f7d6b0','#e8a96a','#c98040','#8d5524','#5c3010'];
const HAIR        = ['#1a0800','#5c3010','#a04010','#c0392b','#d4a800','none','none'];
const SHIRTS_LIST = ['white','yellow','navy','green'];
const HATS_LIST   = [null,null,null,null,'cap-navy','cap-green','cap-yellow','afro','diamond','foam'];

/* ── Seeded pseudo-random (XORSHIFT) ─────────────────────────────────────── */
let _s = 0;
function srand(s) { _s = s >>> 0; }
function rand() {
  _s ^= _s << 13; _s ^= _s >> 17; _s ^= _s << 5;
  return (_s >>> 0) / 4294967296;
}
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function prob(p)   { return rand() < p; }

/* ── Crowd builder ───────────────────────────────────────────────────────── */
function buildCrowd() {
  srand(0xCAFEBABE);
  return Array.from({ length: ROWS * COLS }, (_, i) => ({
    row:        Math.floor(i / COLS),
    col:        i % COLS,
    skin:       pick(SKIN),
    hair:       pick(HAIR),
    shirt:      pick(SHIRTS_LIST),
    hat:        pick(HATS_LIST),
    sunglasses: prob(0.14),
    flag:       prob(0.07),   // true = bandeira Brazil normal
    mouth:      Math.floor(rand() * 3), // 0=neutro 1=aberta 2=sorriso
  }));
}

/* ── 7 diferenças ────────────────────────────────────────────────────────────
   oval = valor na imagem ORIGINAL (forçado)
   nval = valor na imagem MODIFICADA (o "erro" a encontrar)             */
const DIFFS = [
  { row:0, col:11, prop:'flag',       oval: true,         nval: 'inv'       }, // bandeira invertida
  { row:1, col:4,  prop:'hat',        oval: null,         nval: 'ball'      }, // chapéu bola amarela
  { row:2, col:13, prop:'hat',        oval: 'cap-navy',   nval: 'cap-green' }, // boné azul → verde
  { row:3, col:1,  prop:'shirt',      oval: 'white',      nval: 'yellow'    }, // camisa branca → amarela
  { row:3, col:9,  prop:'shirt',      oval: 'green',      nval: 'navy'      }, // camisa verde → azul
  { row:4, col:12, prop:'sunglasses', oval: false,        nval: true        }, // óculos aparecem
  { row:5, col:5,  prop:'hat',        oval: 'cap-yellow', nval: 'cap-navy'  }, // boné amarelo → azul
];

function applyOriginal(crowd) {
  DIFFS.forEach(d => { crowd[d.row * COLS + d.col][d.prop] = d.oval; });
}
function applyModified(crowd) {
  DIFFS.forEach(d => { crowd[d.row * COLS + d.col][d.prop] = d.nval; });
}

/* ── Coordenadas para server.js (impressas no console ao rodar) ──────────── */
const ERRORS_JS = DIFFS.map(d => ({
  x: parseFloat(((d.col * CW + CW / 2) / W).toFixed(4)),
  y: parseFloat(((d.row * RH + RH / 2) / H).toFixed(4)),
  r: 0.05,
  label: labelFor(d),
}));
function labelFor(d) {
  const labels = {
    'flag':       'Bandeira invertida',
    'hat-ball':   'Chapéu bola amarela',
    'hat-cap-green': 'Boné azul→verde',
    'shirt-yellow':  'Camisa branca→amarela',
    'shirt-navy':    'Camisa verde→azul',
    'sunglasses': 'Óculos aparecem',
    'hat-cap-navy':  'Boné amarelo→azul',
  };
  const key = d.prop === 'hat' ? `hat-${d.nval}` : d.prop;
  return labels[key] || `${d.prop} r${d.row}c${d.col}`;
}

/* ── Helpers de cor ──────────────────────────────────────────────────────── */
function h2(n) { return Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0'); }
function darken(hex, amt) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `#${h2(r-amt)}${h2(g-amt)}${h2(b-amt)}`;
}

/* ── Renderizador de pessoa ──────────────────────────────────────────────── */
function personSVG(p, ox, oy) {
  const parts = [];
  const cx = ox + 50; // centro x da célula

  // Barra de cadeira (topo da célula)
  parts.push(`<rect x="${ox}" y="${oy}" width="${CW}" height="16" fill="#a8a8a8" rx="1"/>`);

  // Corpo / camisa
  const sc = SHIRT[p.shirt] || '#ccc';
  parts.push(`<rect x="${ox+23}" y="${oy+42}" width="54" height="38" fill="${sc}" rx="7"/>`);
  // sombra de gola
  parts.push(`<polygon points="${cx},${oy+53} ${cx-10},${oy+42} ${cx+10},${oy+42}" fill="${darken(sc,18)}" opacity="0.4"/>`);

  // Cabeça
  parts.push(`<circle cx="${cx}" cy="${oy+33}" r="20" fill="${p.skin}"/>`);

  // Cabelo (só se não tiver chapéu tampando)
  if (p.hair !== 'none' && p.hat == null) {
    parts.push(`<ellipse cx="${cx}" cy="${oy+17}" rx="20" ry="9" fill="${p.hair}"/>`);
  }

  // Olhos
  parts.push(`<circle cx="${cx-7}" cy="${oy+32}" r="2.4" fill="#1a1a1a"/>`);
  parts.push(`<circle cx="${cx+7}" cy="${oy+32}" r="2.4" fill="#1a1a1a"/>`);
  parts.push(`<circle cx="${cx-6}" cy="${oy+31}" r="0.9" fill="#fff"/>`);
  parts.push(`<circle cx="${cx+8}" cy="${oy+31}" r="0.9" fill="#fff"/>`);

  // Óculos de sol
  if (p.sunglasses === true) {
    parts.push(`<rect x="${cx-14}" y="${oy+29}" width="11" height="7" rx="3" fill="#0d0d1a" opacity="0.88"/>`);
    parts.push(`<rect x="${cx+3}"  y="${oy+29}" width="11" height="7" rx="3" fill="#0d0d1a" opacity="0.88"/>`);
    parts.push(`<line x1="${cx-3}" y1="${oy+32}" x2="${cx+3}"  y2="${oy+32}" stroke="#0d0d1a" stroke-width="1.2"/>`);
    parts.push(`<line x1="${cx-25}" y1="${oy+32}" x2="${cx-14}" y2="${oy+32}" stroke="#0d0d1a" stroke-width="1"/>`);
    parts.push(`<line x1="${cx+14}" y1="${oy+32}" x2="${cx+25}" y2="${oy+32}" stroke="#0d0d1a" stroke-width="1"/>`);
  }

  // Boca
  const my = oy + 39;
  if (p.mouth === 1) {
    parts.push(`<ellipse cx="${cx}" cy="${my}" rx="4.5" ry="3.5" fill="#8b1a1a"/>`);
  } else if (p.mouth === 2) {
    parts.push(`<path d="M${cx-5},${my-1} Q${cx},${my+4} ${cx+5},${my-1}" stroke="#555" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
  } else {
    parts.push(`<line x1="${cx-4}" y1="${my}" x2="${cx+4}" y2="${my}" stroke="#777" stroke-width="1.4" stroke-linecap="round"/>`);
  }

  // Chapéus / adereços de cabeça
  const ht = p.hat;
  if (ht === 'cap-navy' || ht === 'cap-green' || ht === 'cap-yellow') {
    const cc = ht === 'cap-navy' ? '#1a3a6e' : ht === 'cap-green' ? '#1c7a38' : '#f0c040';
    parts.push(`<rect x="${cx-19}" y="${oy+9}" width="38" height="16" rx="8" fill="${cc}"/>`);
    parts.push(`<ellipse cx="${cx}" cy="${oy+24}" rx="25" ry="5" fill="${cc}"/>`);
    parts.push(`<ellipse cx="${cx}" cy="${oy+24}" rx="25" ry="5" fill="none" stroke="${darken(cc,20)}" stroke-width="1"/>`);
    // logo/detalhe no boné
    parts.push(`<circle cx="${cx}" cy="${oy+15}" r="4" fill="${darken(cc,10)}" opacity="0.5"/>`);
  } else if (ht === 'afro') {
    parts.push(`<circle cx="${cx}" cy="${oy+14}" r="23" fill="#1c7a38"/>`);
    parts.push(`<circle cx="${cx-9}"  cy="${oy+7}"  r="5" fill="#155a28"/>`);
    parts.push(`<circle cx="${cx+9}"  cy="${oy+6}"  r="5" fill="#155a28"/>`);
    parts.push(`<circle cx="${cx}"    cy="${oy+4}"  r="5" fill="#155a28"/>`);
    parts.push(`<circle cx="${cx-15}" cy="${oy+14}" r="4" fill="#155a28"/>`);
    parts.push(`<circle cx="${cx+15}" cy="${oy+13}" r="4" fill="#155a28"/>`);
  } else if (ht === 'ball') {
    // Bola de futebol amarela (chapéu diferença)
    parts.push(`<circle cx="${cx}" cy="${oy+12}" r="16" fill="#f0c040"/>`);
    parts.push(`<circle cx="${cx}" cy="${oy+12}" r="16" fill="none" stroke="#c09010" stroke-width="1.2"/>`);
    parts.push(`<path d="M${cx-9},${oy+8}  Q${cx},${oy+4}  ${cx+9},${oy+8}"  stroke="#c09010" stroke-width="1.2" fill="none"/>`);
    parts.push(`<path d="M${cx-11},${oy+14} Q${cx},${oy+20} ${cx+11},${oy+14}" stroke="#c09010" stroke-width="1.2" fill="none"/>`);
    parts.push(`<line x1="${cx}" y1="${oy-4}" x2="${cx}" y2="${oy+28}" stroke="#c09010" stroke-width="1" opacity="0.5"/>`);
  } else if (ht === 'diamond') {
    parts.push(`<polygon points="${cx},${oy+2} ${cx+14},${oy+13} ${cx},${oy+22} ${cx-14},${oy+13}" fill="#f0c040" stroke="#c09010" stroke-width="1.5"/>`);
    parts.push(`<polygon points="${cx},${oy+2} ${cx+14},${oy+13} ${cx},${oy+22} ${cx-14},${oy+13}" fill="none" stroke="#fff" stroke-width="0.5" opacity="0.3"/>`);
  } else if (ht === 'foam') {
    const fx = cx + 18;
    parts.push(`<rect x="${fx-4}" y="${oy+14}" width="8" height="34" rx="3" fill="#f0c040"/>`);
    parts.push(`<rect x="${fx-9}" y="${oy+8}"  width="18" height="12" rx="4" fill="#f0c040"/>`);
  }

  // Bandeirinha (no palito)
  if (p.flag === true || p.flag === 'inv') {
    const inv = p.flag === 'inv';
    const fx = ox + 72, fy = oy + 16;
    parts.push(`<line x1="${fx}" y1="${fy}" x2="${fx}" y2="${fy+32}" stroke="#6B3A2A" stroke-width="2.5"/>`);
    if (inv) {
      // Cores invertidas (diferença do erro 1)
      parts.push(`<rect x="${fx+1}" y="${fy}"    width="18" height="6" fill="#3a67c0"/>`);
      parts.push(`<rect x="${fx+1}" y="${fy+6}"  width="18" height="6" fill="#FFDF00"/>`);
      parts.push(`<rect x="${fx+1}" y="${fy+12}" width="18" height="5" fill="#009c3b"/>`);
    } else {
      parts.push(`<rect x="${fx+1}" y="${fy}"    width="18" height="6" fill="#009c3b"/>`);
      parts.push(`<rect x="${fx+1}" y="${fy+6}"  width="18" height="6" fill="#FFDF00"/>`);
      parts.push(`<rect x="${fx+1}" y="${fy+12}" width="18" height="5" fill="#3a67c0"/>`);
    }
  }

  return parts.join('');
}

/* ── Confetes (mesmos em ambas as imagens) ───────────────────────────────── */
function confetti() {
  srand(0xC0FF33EE);
  const colors = ['#f0c040','#3a67c0','#1c7a38','#ffffff','#f0c040','#3a67c0'];
  const parts = [];
  for (let i = 0; i < 110; i++) {
    const x  = rand() * W;
    const y  = rand() * H;
    const s  = (2.5 + rand() * 4).toFixed(1);
    const c  = pick(colors);
    const op = (0.35 + rand() * 0.45).toFixed(2);
    const angle = Math.floor(rand() * 60) - 30;
    parts.push(
      `<rect x="${(x - s/2).toFixed(1)}" y="${(y - s/2).toFixed(1)}" ` +
      `width="${s}" height="${s}" fill="${c}" opacity="${op}" ` +
      `transform="rotate(${angle},${x.toFixed(0)},${y.toFixed(0)})"/>`
    );
  }
  return parts.join('');
}

/* ── Builder do SVG completo ─────────────────────────────────────────────── */
function buildSVG(crowd) {
  const parts = [];

  // Fundo
  parts.push(`<rect width="${W}" height="${H}" fill="#dcdcdc"/>`);

  // Confetes decorativos
  parts.push(confetti());

  // Pessoas
  for (const p of crowd) {
    parts.push(personSVG(p, p.col * CW, p.row * RH));
  }

  // Linhas divisórias verticais leves
  for (let c = 1; c < COLS; c++) {
    parts.push(`<line x1="${c*CW}" y1="0" x2="${c*CW}" y2="${H}" stroke="#b8b8b8" stroke-width="0.5" opacity="0.35"/>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`,
    parts.join(''),
    `</svg>`,
  ].join('\n');
}

/* ── Gabarito com marcações vermelhas (somente para o Master ver) ────────── */
function buildGabaritoSVG(crowd) {
  const parts = [];

  parts.push(`<rect width="${W}" height="${H}" fill="#dcdcdc"/>`);
  parts.push(confetti());

  for (const p of crowd) {
    parts.push(personSVG(p, p.col * CW, p.row * RH));
  }

  for (let c = 1; c < COLS; c++) {
    parts.push(`<line x1="${c*CW}" y1="0" x2="${c*CW}" y2="${H}" stroke="#b8b8b8" stroke-width="0.5" opacity="0.35"/>`);
  }

  // Marcações dos 7 erros em vermelho
  ERRORS_JS.forEach((e, i) => {
    const px = e.x * W, py = e.y * H;
    const r  = e.r * W;
    parts.push(
      `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" ` +
      `fill="none" stroke="#ff2020" stroke-width="3" opacity="0.9"/>`
    );
    parts.push(
      `<text x="${px.toFixed(1)}" y="${(py - r - 4).toFixed(1)}" ` +
      `font-family="Arial" font-size="14" font-weight="bold" fill="#ff2020" ` +
      `text-anchor="middle">${i+1}</text>`
    );
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`,
    parts.join(''),
    `</svg>`,
  ].join('\n');
}

/* ── Run ─────────────────────────────────────────────────────────────────── */
fs.mkdirSync(OUT, { recursive: true });

// Imagem original (sem diferenças) — gabarito do Master
const origCrowd = buildCrowd();
applyOriginal(origCrowd);
fs.writeFileSync(path.join(OUT, 'original.svg'), buildSVG(origCrowd));

// Imagem modificada (com 7 erros) — o que os jogadores veem
const modiCrowd = buildCrowd();
applyOriginal(modiCrowd);
applyModified(modiCrowd);
fs.writeFileSync(path.join(OUT, 'modified.svg'), buildSVG(modiCrowd));

// Gabarito anotado (com círculos vermelhos) — servido só ao Master via token
fs.writeFileSync(path.join(OUT, 'gabarito-annotated.svg'), buildGabaritoSVG(origCrowd));

console.log('✅  Imagens geradas em public/images/');
console.log('    • original.svg           (referência limpa)');
console.log('    • modified.svg           (com 7 erros — o que jogadores veem)');
console.log('    • gabarito-annotated.svg (com círculos vermelhos — Master)');

console.log('\n📌  ERRORS para server.js (já atualizados automaticamente pelo script):');
ERRORS_JS.forEach((e, i) => {
  const d = DIFFS[i];
  console.log(`  { x: ${e.x}, y: ${e.y}, r: ${e.r}, label: '${e.label}' },`);
});

console.log('\n🔎  7 diferenças entre original e modificada:');
DIFFS.forEach((d, i) => {
  console.log(`  ${i+1}. Linha ${d.row+1}, coluna ${d.col+1} → ${d.prop}: ${JSON.stringify(d.oval)} → ${JSON.stringify(d.nval)}`);
});
