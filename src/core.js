/*
 * منطق الرواتب وملف البنك (بدون واجهة) — يعمل في المتصفح وفي Node للاختبارات.
 * كل المبالغ داخلياً بالهللة (أعداد صحيحة) لتفادي أخطاء الكسور العشرية.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PayrollCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- ترميز Windows-1256 ----------
  // الحروف من 0x80 إلى 0xFF بالترتيب
  const CP1256_HIGH =
    '€پ‚ƒ„…†‡ˆ‰ٹ‹Œچژڈ' +
    'گ‘’“”•–—ک™ڑ›œ‌‍ں' +
    ' ،¢£¤¥¦§¨©ھ«¬­®¯' +
    '°±²³´µ¶·¸¹؛»¼½¾؟' +
    'ہءآأؤإئابةتثجحخد' +
    'ذرزسشصض×طظعغـفقك' +
    'àلâمنهوçèéêëىيîï' +
    'ًٌٍَôُِ÷ّùْûü‎‏ے';
  const ENC = new Map();
  const DEC = [];
  for (let i = 0; i < 128; i++) { ENC.set(String.fromCharCode(i), i); DEC[i] = String.fromCharCode(i); }
  for (let i = 0; i < 128; i++) { ENC.set(CP1256_HIGH[i], 0x80 + i); DEC[0x80 + i] = CP1256_HIGH[i]; }
  const QMARK = 0x3f;

  // أشكال العرض العربية (مثل ﷲ و ﻻ) تتحول للحروف العادية قبل الترميز
  function normalizeArabic(s) {
    return String(s || '').replace(/[ﭐ-﷿ﹰ-﻿]/g, (c) => c.normalize('NFKC'));
  }

  function encodeCp1256(str) {
    const s = normalizeArabic(str);
    const out = [];
    for (const ch of s) { const b = ENC.get(ch); out.push(b === undefined ? QMARK : b); }
    return out;
  }

  function decodeCp1256(bytes) {
    let s = '';
    for (const b of bytes) s += DEC[b];
    return s;
  }

  // أحرف لا يمكن كتابتها في ملف البنك (ستظهر "?")
  function unencodableChars(str) {
    const bad = new Set();
    for (const ch of normalizeArabic(str)) if (!ENC.has(ch)) bad.add(ch);
    return [...bad];
  }

  // ---------- أدوات المبالغ والتواريخ ----------
  const toHalalas = (v) => Math.round((Number(v) || 0) * 100);
  const fromHalalas = (h) => (h || 0) / 100;
  const fmt = (h) => fromHalalas(h).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');

  function padNum(value, width, field) {
    const s = digits(value);
    if (s.length > width) throw new Error(`القيمة "${value}" أطول من ${width} خانة (${field})`);
    return s.padStart(width, '0');
  }

  // ---------- تخطيط سطر ملف البنك (194 بايت + CRLF) ----------
  // مستنتج من ملف التحميل المقبول لدى البنك (Payroll Cards File Upload)
  const LAYOUT = [
    ['empNo', 12], ['cardNo', 24], ['name', 50], ['nationalId', 10], ['amount', 15],
    ['valueDate', 8], ['opCode', 1], ['department', 5], ['bioPin', 1], ['reserved', 20],
    ['basic', 12], ['housing', 12], ['other', 12], ['deductions', 12],
  ];
  const RECORD_LENGTH = LAYOUT.reduce((a, [, w]) => a + w, 0); // 194

  function buildRecord(r) {
    const bytes = [];
    const pushAscii = (s) => { for (const c of s) bytes.push(c.charCodeAt(0)); };
    pushAscii(padNum(r.empNo, 12, 'الرقم الوظيفي'));
    pushAscii(padNum(r.cardNo, 24, 'رقم البطاقة'));
    const name = encodeCp1256(String(r.name || '').trim()).slice(0, 50);
    while (name.length < 50) name.push(0x20);
    bytes.push(...name);
    pushAscii(padNum(r.nationalId, 10, 'رقم الهوية'));
    pushAscii(padNum(r.amount, 15, 'المبلغ'));
    pushAscii(padNum(r.valueDate, 8, 'التاريخ'));
    pushAscii(String(r.opCode || '2').slice(0, 1));
    pushAscii(padNum(r.department || 0, 5, 'الإدارة'));
    pushAscii('0');
    pushAscii(' '.repeat(20));
    pushAscii(padNum(r.basic, 12, 'الأساسي'));
    pushAscii(padNum(r.housing, 12, 'السكن'));
    pushAscii(padNum(r.other, 12, 'بدلات أخرى'));
    pushAscii(padNum(r.deductions, 12, 'الاستقطاع'));
    if (bytes.length !== RECORD_LENGTH) throw new Error('طول السطر غير صحيح');
    return bytes;
  }

  // records: [{empNo, cardNo, name, nationalId, amount, basic, housing, other, deductions}] بالهللة
  function buildBankFile(records, valueDate) {
    const out = [];
    for (const r of records) {
      if (r.basic + r.housing + r.other - r.deductions !== r.amount)
        throw new Error(`المبلغ لا يساوي (الأساسي + السكن + الأخرى - الاستقطاع) للموظف ${r.empNo}`);
      out.push(...buildRecord({ ...r, valueDate }), 0x0d, 0x0a);
    }
    return Uint8Array.from(out);
  }

  function parseBankFile(bytes) {
    const rows = [];
    const all = Array.from(bytes);
    let start = 0;
    while (start < all.length) {
      let end = all.indexOf(0x0a, start);
      if (end < 0) end = all.length;
      let line = all.slice(start, end);
      if (line[line.length - 1] === 0x0d) line = line.slice(0, -1);
      start = end + 1;
      if (!line.length) continue;
      if (line.length < RECORD_LENGTH) throw new Error(`سطر قصير في الملف (${line.length} بايت)`);
      const rec = {};
      let pos = 0;
      for (const [key, w] of LAYOUT) {
        const part = line.slice(pos, pos + w);
        pos += w;
        rec[key] = key === 'name' ? decodeCp1256(part).trim() : String.fromCharCode(...part);
      }
      rows.push({
        empNo: String(Number(rec.empNo)),
        cardNo: rec.cardNo.slice(-19),
        name: rec.name,
        nationalId: rec.nationalId,
        amount: Number(rec.amount),
        valueDate: rec.valueDate,
        basic: Number(rec.basic),
        housing: Number(rec.housing),
        other: Number(rec.other),
        deductions: Number(rec.deductions),
      });
    }
    return rows;
  }

  // ---------- السلف ----------
  // ما تم خصمه من السلفة في المسيرات المعتمدة
  function loanPaid(data, loanId, exceptMonth) {
    let paid = 0;
    for (const [ym, run] of Object.entries(data.runs || {})) {
      if (ym === exceptMonth || run.status !== 'closed') continue;
      for (const line of Object.values(run.lines || {})) paid += (line.loanDeductions || {})[loanId] || 0;
    }
    return paid;
  }

  function loanRemaining(data, loan, exceptMonth) {
    return Math.max(0, loan.amount - loanPaid(data, loan.id, exceptMonth));
  }

  // ---------- حساب سطر الراتب ----------
  function computeLine(data, emp, ym, line) {
    line = line || {};
    const mdays = daysInMonth(ym);
    const days = line.days == null || line.days === '' ? mdays : Math.max(0, Math.min(mdays, Number(line.days)));
    const prorate = (h) => (days >= mdays ? h : Math.round((h * days) / mdays));
    const basic = prorate(emp.basic || 0);
    const housing = prorate(emp.housing || 0);
    const other = prorate(emp.other || 0) + (line.bonus || 0);

    const loanDeductions = {};
    let loanTotal = 0;
    for (const loan of (data.loans || []).filter((l) => l.empId === emp.id)) {
      if (loan.startMonth > ym) continue;
      const remaining = loanRemaining(data, loan, ym);
      if (remaining <= 0) continue;
      const override = (line.loanOverrides || {})[loan.id];
      let amt = override != null ? override : loan.paused ? 0 : Math.min(loan.installment, remaining);
      amt = Math.max(0, Math.min(amt, remaining));
      if (amt) { loanDeductions[loan.id] = amt; loanTotal += amt; }
    }
    const extraDed = line.extraDed || 0;
    const gross = basic + housing + other;
    const deductions = loanTotal + extraDed;
    const net = gross - deductions;
    return { days, mdays, basic, housing, other, bonus: line.bonus || 0, gross, loanDeductions, loanTotal, extraDed, extraDedNote: line.extraDedNote || '', deductions, net };
  }

  function sortEmployees(list) {
    return [...list].sort((a, b) =>
      String(a.branch || '').localeCompare(String(b.branch || ''), 'en', { numeric: true }) ||
      String(a.empNo).localeCompare(String(b.empNo), 'en', { numeric: true }));
  }

  // الموظفون المشمولون في مسير شهر معيّن
  function runEmployees(data, ym) {
    const run = (data.runs || {})[ym];
    return sortEmployees(data.employees.filter((e) => {
      if (run && run.lines && run.lines[e.id] && run.lines[e.id].excluded) return false;
      return e.active !== false;
    }));
  }

  function computeRun(data, ym) {
    const run = (data.runs || {})[ym] || { lines: {} };
    if (run.status === 'closed' && run.snapshot) return run.snapshot;
    return runEmployees(data, ym).map((emp) => ({ emp, ...computeLine(data, emp, ym, (run.lines || {})[emp.id]) }));
  }

  // السجلات التي تذهب لملف البنك: موظفو البطاقات بصافي أكبر من صفر
  function bankRecords(rows) {
    return rows
      .filter((r) => r.emp.payByCard !== false && r.net > 0)
      .map((r) => ({
        empNo: r.emp.empNo, cardNo: r.emp.cardNo, name: r.emp.name, nationalId: r.emp.nationalId,
        amount: r.net, basic: r.basic, housing: r.housing, other: r.other, deductions: r.deductions,
        department: r.emp.department || 0,
      }));
  }

  // مشاكل تمنع أو تستدعي الانتباه قبل التصدير
  function validateRecords(rows, valueDate) {
    const problems = [];
    for (const r of rows) {
      const e = r.emp;
      if (e.payByCard === false || r.net <= 0) continue;
      const who = `${e.empNo} - ${e.name}`;
      if (r.net < 0) problems.push({ level: 'error', msg: `${who}: الصافي سالب` });
      if (digits(e.cardNo).length !== 19) problems.push({ level: 'error', msg: `${who}: رقم البطاقة يجب أن يكون 19 رقماً` });
      if (digits(e.nationalId).length !== 10) problems.push({ level: 'error', msg: `${who}: رقم الهوية يجب أن يكون 10 أرقام` });
      if (!digits(e.empNo) || digits(e.empNo).length > 12) problems.push({ level: 'error', msg: `${who}: الرقم الوظيفي غير صحيح` });
      const bad = unencodableChars(e.name);
      if (bad.length) problems.push({ level: 'warn', msg: `${who}: الاسم يحتوي أحرفاً ستظهر "?" في ملف البنك` });
      if (normalizeArabic(e.name).trim().length > 50) problems.push({ level: 'warn', msg: `${who}: الاسم أطول من 50 حرفاً وسيتم قصه` });
      const st = cardStatus(e, valueDate);
      if (st.code === 'expired') problems.push({ level: 'warn', msg: `${who}: البطاقة منتهية (${e.cardExpiry})` });
    }
    return problems;
  }

  // ---------- حالة البطاقة ----------
  // today بصيغة YYYY-MM-DD أو YYYYMMDD
  function cardStatus(emp, today) {
    const t = String(today).replace(/-/g, '');
    const tIso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    if (emp.payByCard === false) return { code: 'none', label: 'لا يصرف على بطاقة' };
    if (!emp.cardExpiry) return { code: 'unknown', label: 'تاريخ الانتهاء غير مسجل' };
    const exp = emp.cardExpiry;
    if (exp < tIso) return { code: 'expired', label: 'منتهية' };
    if (exp.slice(0, 7) === tIso.slice(0, 7)) return { code: 'thisMonth', label: 'تنتهي هذا الشهر' };
    const next = new Date(Number(t.slice(0, 4)), Number(t.slice(4, 6)), 1); // أول الشهر القادم
    const nextYm = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    if (exp.slice(0, 7) === nextYm) return { code: 'nextMonth', label: 'تنتهي الشهر القادم' };
    return { code: 'ok', label: 'سارية' };
  }

  // تحويل ملف بنك لشهر سابق إلى مسير معتمد (للأرشيف والكشوفات)
  // يعيد صفوف المسير والموظفين غير الموجودين (يضافون موقوفين)
  function runFromBankFile(data, rows, ym, newId) {
    const mdays = daysInMonth(ym);
    const added = [];
    const snapshot = rows.map((r) => {
      let emp = data.employees.find((e) => e.empNo === r.empNo);
      if (!emp) {
        emp = {
          id: newId(), empNo: r.empNo, name: r.name, nationalId: r.nationalId, branch: '', cardNo: r.cardNo, cardExpiry: '',
          payByCard: true, active: false, basic: r.basic, housing: r.housing, other: r.other, mobile: '',
          notes: `أضيف من ملف بنك شهر ${ym}`,
        };
        added.push(emp);
      }
      const snapEmp = { ...JSON.parse(JSON.stringify(emp)), name: r.name, cardNo: r.cardNo, nationalId: r.nationalId };
      return {
        emp: snapEmp, days: mdays, mdays, basic: r.basic, housing: r.housing, other: r.other, bonus: 0,
        gross: r.basic + r.housing + r.other, loanDeductions: {}, loanTotal: 0, extraDed: r.deductions,
        extraDedNote: r.deductions ? 'استقطاع (من ملف البنك)' : '', deductions: r.deductions, net: r.amount, line: {},
      };
    });
    // نحافظ على ترتيب الملف الأصلي ليُعاد تصديره كما هو
    return { snapshot, added };
  }

  function emptyData() {
    return { version: 1, settings: { companyName: '', opCode: '2' }, branches: [], employees: [], loans: [], runs: {} };
  }

  return {
    encodeCp1256, decodeCp1256, unencodableChars, normalizeArabic,
    toHalalas, fromHalalas, fmt, daysInMonth, digits,
    LAYOUT, RECORD_LENGTH, buildRecord, buildBankFile, parseBankFile,
    loanPaid, loanRemaining, computeLine, computeRun, runEmployees, sortEmployees,
    bankRecords, validateRecords, cardStatus, emptyData, runFromBankFile,
  };
});
