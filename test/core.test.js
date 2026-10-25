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
