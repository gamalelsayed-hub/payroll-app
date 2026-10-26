/*
 * قارئ Excel (xlsx) مبسّط بدون مكتبات: يقرأ أول ورقة ويعيد صفوفها كمصفوفات.
 * يكفي لملفات البنك مثل كشف بطاقات الرواتب.
 */
'use strict';

const zlib = require('zlib');

function unzip(buf) {
  // نبحث عن نهاية الدليل المركزي
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('الملف ليس ملف Excel صالح (xlsx)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  return (name) => {
    const f = files[name];
    if (!f) return null;
    const lnlen = buf.readUInt16LE(f.off + 26), lxlen = buf.readUInt16LE(f.off + 28);
    const start = f.off + 30 + lnlen + lxlen;
    const raw = buf.subarray(start, start + f.csize);
    return (f.method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
  };
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function readFirstSheet(buffer) {
  const get = unzip(Buffer.from(buffer));
  const shared = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) {
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(unescapeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  // أول ورقة حسب ترتيب الكتاب
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb);
    const rel = first && new RegExp(`<Relationship\\b[^>]*Id="${first[1]}"[^>]*Target="([^"]+)"`).exec(rels);
    const rel2 = first && new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${first[1]}"`).exec(rels);
    const target = (rel || rel2 || [])[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheet = get(sheetPath);
  if (!sheet) throw new Error('لم يتم العثور على ورقة في الملف');
  const rows = [];
  for (const rowXml of sheet.match(/<row\b[\s\S]*?<\/row>/g) || []) {
    const row = [];
    for (const c of rowXml.match(/<c\b[^>]*\/>|<c\b[\s\S]*?<\/c>/g) || []) {
      const ref = (/\br="([A-Z]+\d+)"/.exec(c) || [])[1];
      const type = (/\bt="([^"]+)"/.exec(c) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
      let val = null;
      if (type === 's') val = shared[Number(v)];
      else if (type === 'inlineStr') val = unescapeXml(((/<t[^>]*>([\s\S]*?)<\/t>/.exec(c) || [])[1]) || '');
      else if (type === 'str' || type === 'e') val = v != null ? unescapeXml(v) : null;
      else if (v != null) val = Number(v);
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => (x === undefined ? null : x)));
  }
  return rows;
}

module.exports = { readFirstSheet };
