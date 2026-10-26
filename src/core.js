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
    // line.fixed: مبالغ الشهر مستوردة من كشف النظام أو معدلة يدوياً لهذا الشهر فقط
    const fx = line.fixed;
    const basic = fx ? fx.basic || 0 : prorate(emp.basic || 0);
    const housing = fx ? fx.housing || 0 : prorate(emp.housing || 0);
    const allowances = line.noAllowances ? [] : computeAllowances(data, emp, ym).filter((a) => a.payWith === 'salary' && a.amount > 0);
    const allowanceTotal = allowances.reduce((a, x) => a + x.amount, 0);
    const other = (fx ? fx.other || 0 : prorate(emp.other || 0)) + (line.bonus || 0) + allowanceTotal;

    const loanDeductions = {};
    let loanTotal = 0;
    const loans = (data.loans || []).filter((l) => l.empId === emp.id && l.startMonth <= ym)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let systemAdv = fx && fx.adv != null ? fx.adv : null; // سلف كشف النظام تُوزع على سلف البرنامج إن وجدت
    for (const loan of loans) {
      const remaining = loanRemaining(data, loan, ym);
      if (remaining <= 0) continue;
      const override = (line.loanOverrides || {})[loan.id];
      let amt;
      if (systemAdv != null && override == null) amt = Math.min(systemAdv, remaining);
      else amt = override != null ? override : loan.paused ? 0 : Math.min(loan.installment, remaining);
      amt = Math.max(0, Math.min(amt, remaining));
      if (systemAdv != null && override == null) systemAdv -= amt;
      if (amt) { loanDeductions[loan.id] = amt; loanTotal += amt; }
    }
    if (systemAdv) loanTotal += systemAdv; // سلف في كشف النظام غير مسجلة في البرنامج
    const extraDed = (fx ? fx.otherDed || 0 : 0) + (line.extraDed || 0);
    const gross = basic + housing + other;
    const deductions = loanTotal + extraDed;
    const net = gross - deductions;
    return {
      days, mdays, basic, housing, other, bonus: line.bonus || 0, allowances, allowanceTotal, gross, loanDeductions, loanTotal,
      extraDed, extraDedNote: line.extraDedNote || '', deductions, net, fixed: !!fx,
      transferred: line.transferred || '', noBank: !!line.noBank,
    };
  }

  // ---------- المستحقات الأخرى (بدلات ومكافآت وأوفر تايم) ----------
  const FREQ_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };

  // هل يستحق هذا النوع في هذا الشهر؟ (للمكافآت الدورية)
  function allowanceDue(type, ym) {
    const m = Number(ym.slice(5, 7));
    if (!type.frequency || type.frequency === 'monthly') return true;
    if (Array.isArray(type.months) && type.months.length) return type.months.map(Number).includes(m);
    const step = FREQ_MONTHS[type.frequency] || 1;
    return m % step === 0;
  }

  function allowanceApplies(type, emp) {
    const own = (emp.allowances || {})[type.id];
    if (own && own.enabled === false) return false;
    if (type.scope === 'branches') return (type.branches || []).includes(emp.branch) || !!(own && own.enabled);
    if (type.scope === 'employees') return !!(own && own.enabled);
    return true;
  }

  // مستحقات الموظف في شهر: [{typeId, name, kind, amount, days, rate, payWith, note}]
  function computeAllowances(data, emp, ym) {
    const types = ((data.settings || {}).allowanceTypes || []).filter((t) => t.active !== false);
    const run = ((data.allowanceRuns || {})[ym] || {});
    const out = [];
    for (const t of types) {
      if (!allowanceDue(t, ym) || !allowanceApplies(t, emp)) continue;
      const L = ((run.lines || {})[t.id] || {})[emp.id] || {};
      if (L.excluded) continue;
      const own = (emp.allowances || {})[t.id] || {};
      const base = own.amount != null && own.amount !== '' ? own.amount : t.amount || 0;
      let amount, days = null, rate = null;
      if (t.kind === 'manual') amount = L.amount || 0;
      else if (t.kind === 'daily') {
        rate = base;
        days = L.days != null && L.days !== '' ? Number(L.days) : t.days != null && t.days !== '' ? Number(t.days) : daysInMonth(ym);
        amount = L.amount != null ? L.amount : Math.round(rate * days);
      } else amount = L.amount != null ? L.amount : base;
      out.push({ typeId: t.id, name: t.name, kind: t.kind, amount, days, rate, payWith: t.payWith || 'separate', note: L.note || '', transferred: L.transferred || '' });
    }
    return out;
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
      const L = run && run.lines && run.lines[e.id];
      if (L && L.excluded) return false;
      // الموظف الموقوف يدخل فقط إذا كان له سطر صريح في هذا الشهر (مثل كشف مستورد)
      return e.active !== false || !!(L && L.fixed);
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
      .filter((r) => r.emp.payByCard !== false && r.net > 0 && !r.noBank)
      .map((r) => ({
        empNo: r.emp.empNo, cardNo: r.emp.cardNo, name: r.emp.name, nationalId: r.emp.nationalId,
        amount: r.net, basic: r.basic, housing: r.housing, other: r.other, deductions: r.deductions,
        department: r.emp.department || 0,
      }));
  }

  // سجلات ملف البنك لمستحقات منفصلة: [{emp, amount}] — المبلغ كاملاً في خانة البدلات الأخرى
  function allowanceBankRecords(items) {
    return items
      .filter((x) => x.emp.payByCard !== false && x.amount > 0 && !x.noBank)
      .map((x) => ({
        empNo: x.emp.empNo, cardNo: x.emp.cardNo, name: x.emp.name, nationalId: x.emp.nationalId,
        amount: x.amount, basic: 0, housing: 0, other: x.amount, deductions: 0, department: x.emp.department || 0,
      }));
  }

  // مشاكل تمنع أو تستدعي الانتباه قبل التصدير
  function validateRecords(rows, valueDate) {
    const problems = [];
    for (const r of rows) {
      const e = r.emp;
      if (e.payByCard === false || r.net <= 0 || r.noBank) continue;
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

  // ---------- قراءة كشف رواتب النظام (PDF) ----------
  // النص العربي في الـ PDF مخزن بترتيب العرض (معكوس): نعيده للترتيب الصحيح
  function visualToLogical(str) {
    const s = String(str || '');
    if (!/[\u0600-\u06FF\uFB50-\uFEFF]/.test(s)) return s.trim();
    const rev = [...s].reverse().join('');
    // الأرقام داخل النص العربي تبقى بترتيبها
    return normalizeArabic(rev.replace(/[0-9.,]+/g, (d) => [...d].reverse().join(''))).replace(/\s+/g, ' ').trim();
  }

  const REPORT_COLUMNS = [
    ['basic', /الراتب الاساسي|الراتب الأساسي/], ['housing', /بدل سكن/], ['other', /بدلات اخرى|بدلات أخرى/],
    ['earn', /اجمالي الاستحقاق|إجمالي الاستحقاق/], ['adv', /^سلف$/], ['ded', /اجمالي الاستقطاع|إجمالي الاستقطاع/],
    ['net', /صافي الراتب/], ['year', /^السنة$/], ['month', /^الشهر$/], ['empNo', /رقم الموظ/], ['name', /اسم الموظف/],
  ];

  // items: [{page, x, y, w, str}] من قارئ الـ PDF
  function parseSystemReport(items) {
    const cols = {};
    const norm = items.map((it) => ({ ...it, cx: it.x + it.w / 2, text: visualToLogical(it.str) }));
    for (const it of norm) {
      for (const [key, re] of REPORT_COLUMNS) if (!(key in cols) && re.test(it.text)) cols[key] = it.cx;
    }
    const missing = ['basic', 'other', 'net', 'empNo'].filter((k) => !(k in cols));
    if (missing.length) throw new Error('الملف ليس كشف رواتب من النظام (لم يتم العثور على أعمدة الكشف)');
    // ترتيب الأسطر حسب الصفحة ثم الارتفاع
    const lines = [];
    for (const it of [...norm].sort((a, b) => a.page - b.page || a.y - b.y)) {
      const last = lines[lines.length - 1];
      if (last && last.page === it.page && Math.abs(last.y - it.y) <= 3) last.items.push(it);
      else lines.push({ page: it.page, y: it.y, items: [it] });
    }
    const near = (line, key, tol) => {
      if (!(key in cols)) return null;
      let best = null;
      for (const it of line.items) {
        const d = Math.abs(it.cx - cols[key]);
        if (d <= tol && (!best || d < best.d)) best = { it, d };
      }
      return best && best.it;
    };
    const num = (it) => (it ? Number(String(it.str).replace(/[,\s]/g, '')) : 0);
    const isNum = (it) => it && /^\s*[\d,]+(\.\d+)?\s*$/.test(it.str);
    const rows = [], problems = [], branches = {};
    let branch = '', reportTotal = null;
    for (const line of lines) {
      const texts = line.items.map((i) => i.text).join(' ');
      if (/رقم الفرع/.test(texts) && !/إجمالي|اجمالي/.test(texts)) {
        const code = line.items.find((i) => /^\d{3,6}$/.test(i.str.trim()));
        if (code) {
          branch = code.str.trim();
          const nm = line.items.filter((i) => i !== code && !/رقم الفرع|^:$/.test(i.text)).map((i) => i.text).join(' ').trim();
          if (nm) branches[branch] = nm;
        }
        continue;
      }
      if (/الإجمالي الكلي|الاجمالي الكلي/.test(texts)) {
        const n = near(line, 'net', 30);
        if (isNum(n)) reportTotal = toHalalas(num(n));
        continue;
      }
      const e = near(line, 'empNo', 14);
      if (!e || !/^\d{1,12}$/.test(e.str.trim())) continue;
      const get = (k) => { const it = near(line, k, 18); return isNum(it) ? toHalalas(num(it)) : 0; };
      const nameIt = near(line, 'name', 80) || line.items.filter((i) => /[\u0600-\u06FF]/.test(i.text)).sort((a, b) => b.w - a.w)[0];
      const yIt = near(line, 'year', 10), mIt = near(line, 'month', 8);
      const r = {
        empNo: String(Number(e.str.trim())), name: nameIt ? nameIt.text.replace(/\s*\.\s*$/, '') : '', branch,
        year: yIt ? Number(yIt.str) : null, month: mIt ? Number(mIt.str) : null,
        basic: get('basic'), housing: get('housing'), other: get('other'), earn: get('earn'), adv: get('adv'), ded: get('ded'), net: get('net'),
      };
      if (r.basic + r.housing + r.other !== r.earn) problems.push(`${r.empNo}: إجمالي الاستحقاق لا يساوي مجموع البنود`);
      if (r.earn - r.ded !== r.net) problems.push(`${r.empNo}: الصافي لا يساوي الاستحقاق ناقص الاستقطاع`);
      if (r.adv > r.ded) problems.push(`${r.empNo}: السلف أكبر من إجمالي الاستقطاع`);
      rows.push(r);
    }
    const total = rows.reduce((a, r) => a + r.net, 0);
    if (reportTotal != null && reportTotal !== total) problems.push(`مجموع الصافي (${fmt(total)}) لا يساوي الإجمالي الكلي في الكشف (${fmt(reportTotal)})`);
    const months = [...new Set(rows.filter((r) => r.year && r.month).map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`))];
    return { rows, branches, months, total, reportTotal, problems };
  }

  // ---------- ملف بطاقات الرواتب من البنك (Excel) ----------
  // rows: صفوف الورقة الأولى. الأعمدة: رقم البطاقة، هوية الموظف، الاسم، الرصيد، الحالة، [تاريخ الانتهاء]
  function parseCardsSheet(rows) {
    const head = (rows[0] || []).map((h) => String(h || ''));
    const find = (re, def) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : def; };
    const iCard = find(/البطاقة/, 0), iEmp = find(/هوية|الموظف|الرقم الوظيفي/, 1), iName = find(/اسم/, 2);
    const iBal = find(/المبلغ|الرصيد/, 3), iStatus = find(/الحالة/, 4), iExp = find(/انتهاء|تاريخ/, 5);
    const toDate = (v) => {
      if (v == null || v === '') return '';
      if (typeof v === 'number') {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
        return d.toISOString().slice(0, 10);
      }
      const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(v) || /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(v);
      if (!m) return '';
      return m[1].length === 4 ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    };
    return rows.slice(1).filter((r) => r && digits(r[iCard]).length >= 16).map((r) => ({
      cardNo: digits(r[iCard]), empNo: String(Number(digits(r[iEmp]) || 0)), name: String(r[iName] || '').trim(),
      balance: toHalalas(r[iBal]), status: String(r[iStatus] || '').trim(), expiry: toDate(r[iExp]),
    }));
  }

  // مطابقة سطر بطاقة بموظف: برقم البطاقة ثم بالرقم الوظيفي (والترقيم القديم بدون 1000)
  function matchCard(employees, c) {
    return employees.find((e) => e.cardNo && e.cardNo === c.cardNo) ||
      employees.find((e) => e.empNo === c.empNo) ||
      (Number(c.empNo) < 1000 ? employees.find((e) => e.empNo === String(Number(c.empNo) + 1000)) : null) || null;
  }

  function emptyData() {
    return { version: 1, settings: { companyName: '', opCode: '2', allowanceTypes: [] }, branches: [], employees: [], loans: [], runs: {}, allowanceRuns: {} };
  }

  return {
    encodeCp1256, decodeCp1256, unencodableChars, normalizeArabic,
    toHalalas, fromHalalas, fmt, daysInMonth, digits,
    LAYOUT, RECORD_LENGTH, buildRecord, buildBankFile, parseBankFile,
    loanPaid, loanRemaining, computeLine, computeRun, runEmployees, sortEmployees,
    bankRecords, validateRecords, cardStatus, emptyData, runFromBankFile,
    computeAllowances, allowanceBankRecords, parseCardsSheet, matchCard, allowanceDue, allowanceApplies, parseSystemReport, visualToLogical,
  };
});
