/*
 * قارئ نصوص PDF مبسّط (يعمل في العملية الرئيسية لـ Electron عبر Node).
 * يكفي لكشوفات الرواتب المطبوعة من النظام عبر "Microsoft Print to PDF":
 * خطوط CID بترميز Identity-H مع جداول ToUnicode، ومحتوى مضغوط FlateDecode.
 * يعيد كل مقطع نصي مع موضعه على الصفحة: { page, x, y, w, str }
 */
'use strict';

const zlib = require('zlib');

// ---------- قراءة كائنات الملف ----------
function readObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    objs.set(Number(m[1]), { start, end });
    re.lastIndex = end;
  }
  return { s, buf, objs };
}

function objText(doc, num) {
  const o = doc.objs.get(num);
  return o ? doc.s.slice(o.start, o.end) : '';
}

function streamBytes(doc, num) {
  const o = doc.objs.get(num);
  if (!o) return Buffer.alloc(0);
  const text = doc.s.slice(o.start, o.end);
  const k = text.indexOf('stream');
  let p = o.start + k + 6;
  if (doc.s[p] === '\r') p++;
  if (doc.s[p] === '\n') p++;
  const dict = text.slice(0, k);
  const lenM = /\/Length\s+(\d+)(\s+0\s+R)?/.exec(dict);
  let len = lenM ? Number(lenM[1]) : -1;
  if (lenM && lenM[2]) len = Number(objText(doc, len).trim());
  if (len < 0) len = doc.s.indexOf('endstream', p) - p;
  const raw = doc.buf.subarray(p, p + len);
  return /\/FlateDecode/.test(dict) ? zlib.inflateSync(raw) : raw;
}

// قيمة مفتاح داخل قاموس: مرجع "n 0 R" أو قيمة مباشرة
function refOf(dictText, key) {
  const m = new RegExp('/' + key + '\\s+(\\d+)\\s+0\\s+R').exec(dictText);
  return m ? Number(m[1]) : null;
}

// ---------- الخطوط ----------
function parseToUnicode(text) {
  const map = new Map();
  const hex = (h) => parseInt(h, 16);
  const utf16 = (h) => {
    const codes = [];
    for (let i = 0; i < h.length; i += 4) codes.push(hex(h.slice(i, i + 4)));
    return String.fromCharCode(...codes);
  };
  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(hex(m[1]), utf16(m[2]));
  }
  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g)) {
      const a = hex(m[1]), b = hex(m[2]);
      if (m[3][0] === '[') {
        const list = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1]);
        for (let c = a; c <= b; c++) map.set(c, utf16(list[c - a] || ''));
      } else {
        const base = hex(m[3].slice(1, -1));
        for (let c = a; c <= b; c++) map.set(c, String.fromCharCode(base + c - a));
      }
    }
  }
  return map;
}

function parseWidths(text) {
  const widths = new Map();
  const tokens = text.replace(/[[\]]/g, (c) => ` ${c} `).trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] === '[' || tokens[i] === ']') { i++; continue; }
    const first = Number(tokens[i]);
    if (tokens[i + 1] === '[') {
      i += 2;
      let c = first;
      while (i < tokens.length && tokens[i] !== ']') widths.set(c++, Number(tokens[i++]));
      i++;
    } else {
      const last = Number(tokens[i + 1]), w = Number(tokens[i + 2]);
      for (let c = first; c <= last; c++) widths.set(c, w);
      i += 3;
    }
  }
  return widths;
}

function loadFont(doc, fontText) {
  const tu = refOf(fontText, 'ToUnicode');
  const toUni = tu != null ? parseToUnicode(streamBytes(doc, tu).toString('latin1')) : new Map();
  let widths = new Map();
  let dw = 1000;
  const wRef = refOf(fontText, 'W');
  const wInline = /\/W\s*(\[[\s\S]*?\]\s*\])/.exec(fontText);
  if (wRef != null) widths = parseWidths(objText(doc, wRef));
  else if (wInline) widths = parseWidths(wInline[1]);
  const dwM = /\/DW\s+(\d+)/.exec(fontText);
  if (dwM) dw = Number(dwM[1]);
  const twoByte = /Identity-H|Identity-V/.test(fontText);
  return { toUni, widths, dw, twoByte };
}

function pageFonts(doc, pageText) {
  let res = pageText;
  const rRef = refOf(pageText, 'Resources');
  if (rRef != null) res = objText(doc, rRef);
  let fontDict = '';
  const fRef = refOf(res, 'Font');
  if (fRef != null) fontDict = objText(doc, fRef);
  else { const m = /\/Font\s*<<([\s\S]*?)>>/.exec(res); fontDict = m ? m[1] : ''; }
  const fonts = {};
  for (const m of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+0\s+R/g)) fonts[m[1]] = loadFont(doc, objText(doc, Number(m[2])));
  return fonts;
}

function pagesInOrder(doc) {
  const rootRef = /\/Root\s+(\d+)\s+0\s+R/.exec(doc.s);
  const out = [];
  const walk = (num) => {
    const t = objText(doc, num);
    if (/\/Type\s*\/Pages\b/.test(t)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(t);
      for (const k of (kids ? kids[1] : '').matchAll(/(\d+)\s+0\s+R/g)) walk(Number(k[1]));
    } else if (/\/Type\s*\/Page\b/.test(t)) out.push(num);
  };
  if (rootRef) walk(refOf(objText(doc, Number(rootRef[1])), 'Pages'));
  return out;
}

// ---------- تفسير محتوى الصفحة ----------
function tokenize(src) {
  const tokens = [];
  const re = /\s*(<<|>>|\[|\]|<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|\/[^\s/<>[\]()]+|[^\s/<>[\]()]+)/g;
  let m;
  while ((m = re.exec(src))) tokens.push(m[1]);
  return tokens;
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

function runContent(src, fonts, page, out) {
  const tokens = tokenize(src);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, size = 0, leading = 0;
  let operands = [];
  const showText = (codes) => {
    if (!font) return;
    let str = '', adv = 0;
    for (const c of codes) {
      if (typeof c === 'object') { adv -= c.kern / 1000 * size; continue; }
      str += font.toUni.get(c) || '';
      adv += ((font.widths.has(c) ? font.widths.get(c) : font.dw) / 1000) * size;
    }
    const m = mul(tm, ctm);
    const scale = Math.hypot(m[0], m[1]);
    if (str.trim()) out.push({ page, x: m[4], y: m[5], w: adv * scale, str });
    tm = mul([1, 0, 0, 1, adv, 0], tm);
  };
  const decode = (tok) => {
    const codes = [];
    if (tok[0] === '<') {
      const h = tok.slice(1, -1).replace(/\s/g, '');
      const step = font && font.twoByte ? 4 : 2;
      for (let i = 0; i < h.length; i += step) codes.push(parseInt(h.slice(i, i + step), 16));
    } else {
      const body = tok.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) =>
        /[0-7]/.test(e[0]) ? String.fromCharCode(parseInt(e, 8)) : { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[e] || e);
      for (let i = 0; i < body.length; i++) codes.push(body.charCodeAt(i));
    }
    return codes;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '[') {
      const arr = [];
      while (++i < tokens.length && tokens[i] !== ']') {
        const x = tokens[i];
        if (x[0] === '<' || x[0] === '(') arr.push(...decode(x));
        else arr.push({ kern: Number(x) });
      }
      operands.push(arr);
      continue;
    }
    if (/^[-+.\d]/.test(t) || t[0] === '/' || t[0] === '<' || t[0] === '(') { operands.push(t); continue; }
    const n = (k) => Number(operands[operands.length - k]);
    switch (t) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
      case 'cm': ctm = mul([n(6), n(5), n(4), n(3), n(2), n(1)], ctm); break;
      case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': font = fonts[String(operands[operands.length - 2]).slice(1)] || null; size = n(1); break;
      case 'TL': leading = n(1); break;
      case 'Tm': tm = tlm = [n(6), n(5), n(4), n(3), n(2), n(1)]; break;
      case 'Td': tm = tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm); break;
      case 'TD': leading = -n(1); tm = tlm = mul([1, 0, 0, 1, n(2), n(1)], tlm); break;
      case 'T*': tm = tlm = mul([1, 0, 0, 1, 0, -leading], tlm); break;
      case 'Tj': showText(decode(operands[operands.length - 1])); break;
      case 'TJ': showText(operands[operands.length - 1]); break;
      default: break;
    }
    operands = [];
  }
}

function extractItems(buffer) {
  const doc = readObjects(Buffer.from(buffer));
  const items = [];
  pagesInOrder(doc).forEach((num, idx) => {
    const pageText = objText(doc, num);
    const mb = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(pageText);
    const height = mb ? Number(mb[4]) : 842;
    const fonts = pageFonts(doc, pageText);
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(pageText);
    const refs = contents ? [...contents[1].matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1])) : [];
    const src = refs.map((r) => streamBytes(doc, r).toString('latin1')).join('\n');
    const pageItems = [];
    runContent(src, fonts, idx + 1, pageItems);
    // نحول y لتكون من أعلى الصفحة
    for (const it of pageItems) items.push({ ...it, y: height - it.y });
  });
  return items;
}

module.exports = { extractItems };
