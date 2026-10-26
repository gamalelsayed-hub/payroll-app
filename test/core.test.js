// اختبارات ببيانات وهمية فقط (لا توجد بيانات موظفين حقيقية في المستودع)
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core.js');

const emp = (o) => ({ id: o.empNo, branch: '1001', payByCard: true, active: true, housing: 0, ...o });

test('سطر ملف البنك: 194 بايت بالتنسيق المطلوب', () => {
  const bytes = C.buildBankFile([{
    empNo: '1234', cardNo: '1111222233334444555', name: 'احمد محمد', nationalId: '2000000001',
    amount: 241667, basic: 60000, housing: 0, other: 190000, deductions: 8333,
  }], '20260929');
  assert.strictEqual(bytes.length, 196);
  assert.deepStrictEqual([...bytes.slice(194)], [0x0d, 0x0a]);
  const line = Buffer.from(bytes.slice(0, 194));
  assert.strictEqual(line.slice(0, 36).toString('latin1'), '000000001234000001111222233334444555');
  // "احمد" بترميز Windows-1256
  assert.deepStrictEqual([...line.slice(36, 40)], [0xc7, 0xcd, 0xe3, 0xcf]);
  assert.strictEqual(line.slice(36 + 9, 86).toString('latin1'), ' '.repeat(41));
  assert.strictEqual(line.slice(86).toString('latin1'),
    '2000000001' + '000000000241667' + '20260929' + '2000000' + ' '.repeat(20) +
    '000000060000' + '000000000000' + '000000190000' + '000000008333');
});

test('قراءة ملف البنك تعيد نفس البيانات', () => {
  const rec = { empNo: '77', cardNo: '9999888877776666555', name: 'سارة علي', nationalId: '1000000002', amount: 400000, basic: 400000, housing: 0, other: 0, deductions: 0 };
  const [r] = C.parseBankFile(C.buildBankFile([rec], '20261029'));
  assert.deepStrictEqual(r, { ...rec, valueDate: '20261029' });
});

test('أحرف غير مدعومة تظهر "?" وأشكال العرض تتحول', () => {
  assert.deepStrictEqual(C.encodeCp1256('a​b'), [0x61, 0x3f, 0x62]);
  assert.deepStrictEqual(C.encodeCp1256('ﷲ'), C.encodeCp1256('الله'));
  assert.deepStrictEqual(C.unencodableChars('علي​'), ['​']);
});

test('رفض المبالغ غير المتوازنة والحقول الطويلة', () => {
  assert.throws(() => C.buildBankFile([{ empNo: '1', cardNo: '1', name: 'x', nationalId: '1', amount: 1, basic: 2, housing: 0, other: 0, deductions: 0 }], '20260101'));
  assert.throws(() => C.buildRecord({ empNo: '1', cardNo: '1', name: 'x', nationalId: '12345678901', amount: 0, valueDate: '20260101', basic: 0, housing: 0, other: 0, deductions: 0 }));
});

test('حساب الراتب بأيام العمل (تناسب مع أيام الشهر)', () => {
  const data = { ...C.emptyData(), employees: [emp({ empNo: '5', basic: 60000, other: 240000 })] };
  const r = C.computeLine(data, data.employees[0], '2026-10', { days: 8 });
  assert.strictEqual(r.basic, 15484);
  assert.strictEqual(r.other, 61935);
  assert.strictEqual(r.net, 77419);
});

test('السلف: خصم القسط وتناقص الرصيد بعد الاعتماد', () => {
  const e = emp({ empNo: '9', basic: 100000, other: 50000 });
  const data = { ...C.emptyData(), employees: [e], loans: [{ id: 'L1', empId: e.id, amount: 120000, installment: 50000, startMonth: '2026-10' }] };
  assert.strictEqual(C.computeLine(data, e, '2026-09', {}).loanTotal, 0);
  let r = C.computeLine(data, e, '2026-10', {});
  assert.strictEqual(r.loanTotal, 50000);
  data.runs['2026-10'] = { status: 'closed', lines: { [e.id]: { loanDeductions: r.loanDeductions } }, snapshot: [] };
  data.runs['2026-11'] = { status: 'closed', lines: { [e.id]: { loanDeductions: { L1: 50000 } } }, snapshot: [] };
  r = C.computeLine(data, e, '2026-12', {});
  assert.strictEqual(r.loanTotal, 20000); // آخر قسط = الباقي فقط
  assert.strictEqual(r.net, 130000);
  assert.strictEqual(C.loanRemaining(data, data.loans[0]), 20000);
});

test('ملف البنك يستبعد غير أصحاب البطاقات والصافي صفر ويرتب حسب الفرع', () => {
  const data = { ...C.emptyData(), employees: [
    emp({ empNo: '3', branch: '1002', basic: 1000 }),
    emp({ empNo: '2', branch: '1001', basic: 1000 }),
    emp({ empNo: '1', branch: '1001', basic: 1000, payByCard: false }),
    emp({ empNo: '4', branch: '1001', basic: 0 }),
  ] };
  const recs = C.bankRecords(C.computeRun(data, '2026-10'));
  assert.deepStrictEqual(recs.map((r) => r.empNo), ['2', '3']);
});

test('حالة البطاقة', () => {
  const t = '2026-10-25';
  assert.strictEqual(C.cardStatus({ cardExpiry: '2026-10-31' }, t).code, 'thisMonth');
  assert.strictEqual(C.cardStatus({ cardExpiry: '2026-11-30' }, t).code, 'nextMonth');
  assert.strictEqual(C.cardStatus({ cardExpiry: '2026-06-30' }, t).code, 'expired');
  assert.strictEqual(C.cardStatus({ cardExpiry: '2028-01-31' }, t).code, 'ok');
  assert.strictEqual(C.cardStatus({ cardExpiry: '' }, t).code, 'unknown');
  assert.strictEqual(C.cardStatus({ cardExpiry: '2027-01-31' }, '2026-12-10').code, 'nextMonth');
});

test('استيراد مسير سابق من ملف البنك يعيد إنتاج نفس الملف', () => {
  const recs = [
    { empNo: '20', cardNo: '1111222233334444555', name: 'خالد', nationalId: '2000000003', amount: 250000, basic: 60000, housing: 0, other: 200000, deductions: 10000 },
    { empNo: '10', cardNo: '1111222233334444666', name: 'منى', nationalId: '1000000004', amount: 400000, basic: 400000, housing: 0, other: 0, deductions: 0 },
  ];
  const file = C.buildBankFile(recs, '20260830');
  const data = { ...C.emptyData(), employees: [emp({ empNo: '10', name: 'منى', basic: 1, branch: '1002' })] };
  let n = 0;
  const { snapshot, added } = C.runFromBankFile(data, C.parseBankFile(file), '2026-08', () => 'new' + ++n);
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].active, false);
  data.employees.push(...added);
  data.runs['2026-08'] = { status: 'closed', lines: {}, snapshot };
  const again = C.buildBankFile(C.bankRecords(C.computeRun(data, '2026-08')), '20260830');
  // نفس ترتيب الملف الأصلي
  assert.deepStrictEqual([...again], [...file]);
  assert.strictEqual(C.computeRun(data, '2026-08').reduce((a, r) => a + r.net, 0), 650000);
});

// كشف النظام: النص العربي مخزن معكوساً في الـ PDF
const vis = (s) => [...s].reverse().join('');
const it = (page, y, cx, str) => ({ page, y, x: cx - 10, w: 20, str });

test('قراءة كشف رواتب النظام من مقاطع الـ PDF', () => {
  const cols = { net: 50, ded: 100, adv: 150, earn: 200, other: 250, housing: 300, basic: 350, month: 400, year: 430, name: 500, empNo: 600 };
  const items = [
    it(1, 40, cols.net, vis('صافي الراتب')), it(1, 40, cols.ded, vis('اجمالي الاستقطاع')), it(1, 40, cols.adv, vis('سلف')),
    it(1, 40, cols.earn, vis('اجمالي الاستحقاق')), it(1, 40, cols.other, vis('بدلات اخرى')), it(1, 40, cols.housing, vis('بدل سكن')),
    it(1, 40, cols.basic, vis('الراتب الاساسي')), it(1, 40, cols.month, vis('الشهر')), it(1, 40, cols.year, vis('السنة')),
    it(1, 40, cols.name, vis('اسم الموظف')), it(1, 40, cols.empNo, vis('رقم الموظف')),
    it(1, 60, 560, vis('رقم الفرع')), it(1, 60, 520, '1001'), it(1, 60, 480, vis('فرع تجريبي')),
    it(1, 80, cols.empNo, '1010'), it(1, 80, cols.name, vis('موظف اول')), it(1, 80, cols.year, '2026'), it(1, 80, cols.month, '10'),
    it(1, 80, cols.basic, '3,000.00'), it(1, 80, cols.other, '1,000.00'), it(1, 80, cols.earn, '4,000.00'),
    it(1, 80, cols.adv, '500.00'), it(1, 80, cols.ded, '500.00'), it(1, 80, cols.net, '3,500.00'),
    it(1, 100, cols.empNo, '1011'), it(1, 101, cols.name, vis('موظف ثاني')), it(1, 100, cols.year, '2026'), it(1, 100, cols.month, '10'),
    it(1, 100, cols.basic, '2,000.00'), it(1, 100, cols.housing, '500.00'), it(1, 100, cols.earn, '2,500.00'), it(1, 100, cols.net, '2,500.00'),
    it(1, 120, 500, vis('الإجمالي الكلي')), it(1, 120, cols.net, '6,000.00'),
  ];
  const rep = C.parseSystemReport(items);
  assert.deepStrictEqual(rep.problems, []);
  assert.strictEqual(rep.rows.length, 2);
  assert.deepStrictEqual(rep.months, ['2026-10']);
  assert.strictEqual(rep.total, 600000);
  assert.strictEqual(rep.reportTotal, 600000);
  assert.strictEqual(rep.branches['1001'], 'فرع تجريبي');
  const [a, b] = rep.rows;
  assert.deepStrictEqual([a.empNo, a.name, a.branch, a.basic, a.other, a.adv, a.ded, a.net], ['1010', 'موظف اول', '1001', 300000, 100000, 50000, 50000, 350000]);
  assert.deepStrictEqual([b.empNo, b.housing, b.net], ['1011', 50000, 250000]);
  // ملف غير معروف
  assert.throws(() => C.parseSystemReport([it(1, 10, 10, 'abc')]));
});

test('مسير بمبالغ ثابتة من الكشف: يتجاوز الملف ويوزع السلف', () => {
  const data = { ...C.emptyData(), employees: [emp({ empNo: '1', basic: 9999, other: 9999 })],
    loans: [{ id: 'L1', empId: '1', amount: 100000, installment: 20000, startMonth: '2026-01', date: '2026-01-01' }] };
  data.runs['2026-10'] = { status: 'draft', lines: { 1: { fixed: { basic: 300000, housing: 0, other: 100000, adv: 50000, otherDed: 10000 } } } };
  const [r] = C.computeRun(data, '2026-10');
  assert.strictEqual(r.gross, 400000);
  assert.strictEqual(r.loanTotal, 50000);
  assert.strictEqual(r.extraDed, 10000);
  assert.strictEqual(r.net, 340000);
  // موظف بدون بطاقة يمكن تسجيله «تم التحويل» ولا يدخل ملف البنك
  data.employees[0].payByCard = false;
  data.runs['2026-10'].lines[1].transferred = '2026-10-28';
  const rows = C.computeRun(data, '2026-10');
  assert.strictEqual(rows[0].transferred, '2026-10-28');
  assert.strictEqual(C.bankRecords(rows).length, 0);
});

test('المستحقات: ثابت وباليوم ويدوي ودوري وحسب الفرع أو الموظف', () => {
  const types = [
    { id: 'bf', name: 'فطور', kind: 'fixed', amount: 9000, scope: 'all', payWith: 'separate' },
    { id: 'ln', name: 'غداء', kind: 'daily', amount: 1000, days: 26, scope: 'branches', branches: ['1002'], payWith: 'salary' },
    { id: 'ot', name: 'أوفر تايم', kind: 'manual', scope: 'all' },
    { id: 'q', name: 'مكافأة ربعية', kind: 'fixed', amount: 50000, frequency: 'quarterly', scope: 'employees' },
  ];
  const a = emp({ empNo: '1', basic: 300000 });
  const b = emp({ empNo: '2', basic: 300000, branch: '1002', allowances: { bf: { amount: 12000 }, q: { enabled: true } } });
  const data = { ...C.emptyData(), employees: [a, b] };
  data.settings.allowanceTypes = types;
  data.allowanceRuns = { '2026-10': { lines: { ot: { 1: { amount: 33000 } }, ln: { 2: { days: 20 } } } } };
  const sum = (e, ym) => Object.fromEntries(C.computeAllowances(data, e, ym).map((x) => [x.typeId, x.amount]));
  assert.deepStrictEqual(sum(a, '2026-10'), { bf: 9000, ot: 33000 });
  assert.deepStrictEqual(sum(b, '2026-10'), { bf: 12000, ln: 20000, ot: 0 });
  assert.deepStrictEqual(sum(b, '2026-12'), { bf: 12000, ln: 26000, ot: 0, q: 50000 });
  // بدل الغداء مع الراتب يدخل في البدلات الأخرى
  const rb = C.computeRun(data, '2026-10').find((r) => r.emp.empNo === '2');
  assert.strictEqual(rb.other, 20000);
  assert.strictEqual(rb.net, 320000);
  // استبعاد الموظف من نوع
  b.allowances.bf.enabled = false;
  assert.ok(!('bf' in sum(b, '2026-10')));
  assert.ok(C.allowanceDue({ frequency: 'semiannual' }, '2026-06') && !C.allowanceDue({ frequency: 'semiannual' }, '2026-03'));
  assert.ok(C.allowanceDue({ frequency: 'annual', months: [3] }, '2026-03'));
  const recs = C.allowanceBankRecords([{ emp: a, amount: 9000 }, { emp: { ...a, payByCard: false }, amount: 5000 }, { emp: a, amount: 100, noBank: true }]);
  assert.deepStrictEqual(recs.map((r) => [r.amount, r.other, r.basic]), [[9000, 9000, 0]]);
});

test('ملف بطاقات البنك (Excel)', () => {
  const rows = [
    ['رقم البطاقة', 'هوية الموظف', 'اسم الموظف', 'المبلغ', 'الحالة', 'تاريخ الانتهاء'],
    ['1111222233334444555', '0045', 'تجربة', 12.5, 'نشطة', 46387],
    ['bad', '1', 'x', 0, '', ''],
  ];
  const cards = C.parseCardsSheet(rows);
  assert.strictEqual(cards.length, 1);
  assert.deepStrictEqual(cards[0], { cardNo: '1111222233334444555', empNo: '45', name: 'تجربة', balance: 1250, status: 'نشطة', expiry: '2026-12-31' });
  const emps = [emp({ empNo: '1045', basic: 1 })];
  assert.strictEqual(C.matchCard(emps, cards[0]), emps[0]);
});
