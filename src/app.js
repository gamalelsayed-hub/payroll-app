/* global PayrollCore */
'use strict';

const C = PayrollCore;
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// في المتصفح العادي (للتجربة) نستخدم التخزين المحلي بدلاً من ملفات الجهاز
const bridge = window.api || {
  loadData: async () => localStorage.getItem('payroll-data'),
  saveData: async (json) => { localStorage.setItem('payroll-data', json); return true; },
  openDataFolder: async () => alert('متاح في نسخة سطح المكتب فقط'),
  saveFile: async (name, bytes) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = name; a.click();
    return name;
  },
  openFile: (filters) => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = filters.flatMap((f) => f.extensions.map((x) => '.' + x)).join(',');
    inp.onchange = async () => {
      const f = inp.files[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    inp.click();
  }),
  savePdf: async () => { alert('حفظ PDF متاح في نسخة سطح المكتب. استخدم الطباعة.'); return null; },
  showFile: async () => {},
};

let data = C.emptyData();
const ui = { view: 'dashboard', month: currentMonth(), empSearch: '', empBranch: '', empFilter: 'active', loanFilter: 'active' };

// ---------- أدوات عامة ----------
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function currentMonth() { return today().slice(0, 7); }
function monthLabel(ym) { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; }
function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (h) => C.fmt(h);
const moneyOrDash = (h) => (h ? C.fmt(h) : '-');
const inputMoney = (h) => (h ? C.fromHalalas(h).toFixed(2).replace(/\.00$/, '') : '');
const parseMoney = (v) => C.toHalalas(String(v || '').replace(/,/g, ''));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const empById = (id) => data.employees.find((e) => e.id === id);
const branchName = (code) => (data.branches.find((b) => b.code === code) || {}).name || '';
const branchLabel = (code) => (code ? `${code} ${branchName(code)}`.trim() : 'بدون فرع');

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => bridge.saveData(JSON.stringify(data, null, 1)).catch((e) => toast('تعذر الحفظ: ' + e.message)), 200);
}

function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function openModal(html, wide) {
  const box = $('#modalBox');
  box.className = 'modal-box' + (wide ? ' wide' : '');
  box.innerHTML = html;
  $('#modal').classList.remove('hidden');
  const first = box.querySelector('input, select, textarea');
  if (first) first.focus();
  return box;
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; }

function confirmBox(msg, okLabel = 'تأكيد') {
  return new Promise((resolve) => {
    const box = openModal(`<h2>تأكيد</h2><p>${msg}</p>
      <div class="modal-actions"><button class="btn primary" id="cOk">${esc(okLabel)}</button><button class="btn" id="cNo">إلغاء</button></div>`);
    $('#cOk', box).onclick = () => { closeModal(); resolve(true); };
    $('#cNo', box).onclick = () => { closeModal(); resolve(false); };
  });
}

// ---------- البطاقات والتنبيهات ----------
function cardAlerts() {
  const t = today();
  const list = data.employees.filter((e) => e.active !== false && e.payByCard !== false)
    .map((e) => ({ e, st: C.cardStatus(e, t) }));
  return {
    expired: list.filter((x) => x.st.code === 'expired'),
    thisMonth: list.filter((x) => x.st.code === 'thisMonth'),
    nextMonth: list.filter((x) => x.st.code === 'nextMonth'),
    unknown: list.filter((x) => x.st.code === 'unknown'),
  };
}

function renderAlertBadge() {
  const a = cardAlerts();
  const n = a.expired.length + a.thisMonth.length;
  $('#alertBadge').innerHTML = n ? `<span class="pill" id="badgeGo">⚠ ${n} بطاقة منتهية أو تنتهي هذا الشهر</span>` : '';
  const b = $('#badgeGo');
  if (b) b.onclick = () => { ui.empFilter = 'cardAlert'; go('employees'); };
  $('#companyName').textContent = data.settings.companyName || '';
}

function cardBadge(e) {
  const st = C.cardStatus(e, today());
  return `<span class="badge ${st.code}">${esc(st.label)}</span>`;
}

// ---------- التنقل ----------
const views = {};
function go(view) {
  ui.view = view;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  render();
}
function render() {
  renderAlertBadge();
  views[ui.view]($('#view'));
}

// ---------- الرئيسية ----------
views.dashboard = (el) => {
  const active = data.employees.filter((e) => e.active !== false);
  const ym = currentMonth();
  const rows = C.computeRun(data, ym);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const bankNet = C.bankRecords(rows).reduce((a, r) => a + r.amount, 0);
  const loansLeft = data.loans.reduce((a, l) => a + C.loanRemaining(data, l), 0);
  const a = cardAlerts();
  const run = data.runs[ym];

  const alertRows = (items, title) => items.length ? `
    <div class="alert ${title.cls}"><b>${title.text} (${items.length})</b>
      <ul>${items.map(({ e }) => `<li>${esc(e.empNo)} - ${esc(e.name)} — البطاقة ${esc(e.cardNo)} — تنتهي ${esc(e.cardExpiry)}</li>`).join('')}</ul>
    </div>` : '';

  el.innerHTML = `
    <h1>الرئيسية</h1>
    <p class="sub">${esc(data.settings.companyName || '')} — اليوم ${today()}</p>
    ${!data.employees.length ? `<div class="alert info"><b>مرحباً!</b> لا يوجد موظفون بعد. يمكنك
      <a href="#" id="goImport">استيراد ملف البنك لشهر سابق أو استعادة نسخة بيانات</a> من شاشة الإعدادات، أو إضافة الموظفين يدوياً.</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="label">الموظفون النشطون</div><div class="value">${active.length}</div></div>
      <div class="stat"><div class="label">على بطاقات الرواتب</div><div class="value">${active.filter((e) => e.payByCard !== false).length}</div></div>
      <div class="stat"><div class="label">صافي رواتب ${monthLabel(ym)}</div><div class="value">${money(net)}</div></div>
      <div class="stat"><div class="label">مبلغ ملف البنك لهذا الشهر</div><div class="value">${money(bankNet)}</div></div>
      <div class="stat"><div class="label">أرصدة السلف المتبقية</div><div class="value">${money(loansLeft)}</div></div>
    </div>
    <div class="card">
      <h2>تنبيهات بطاقات الرواتب</h2>
      ${alertRows(a.expired, { cls: 'error', text: 'بطاقات منتهية' })}
      ${alertRows(a.thisMonth, { cls: 'error', text: 'بطاقات تنتهي خلال هذا الشهر' })}
      ${alertRows(a.nextMonth, { cls: 'warn', text: 'بطاقات تنتهي الشهر القادم' })}
      ${a.unknown.length ? `<div class="alert info">${a.unknown.length} موظف بدون تاريخ انتهاء بطاقة مسجل. <a href="#" id="goUnknown">عرضهم</a></div>` : ''}
      ${!a.expired.length && !a.thisMonth.length && !a.nextMonth.length && !a.unknown.length ? '<div class="alert info">لا توجد تنبيهات.</div>' : ''}
    </div>
    <div class="card">
      <h2>مسير ${monthLabel(ym)}</h2>
      <p>الحالة: ${run && run.status === 'closed' ? '<span class="badge closed">معتمد</span>' : '<span class="badge draft">مسودة</span>'}
      ${run && run.exportedAt ? ` — آخر تصدير لملف البنك: ${esc(run.exportedAt)}` : ''}</p>
      <button class="btn primary" id="goPayroll">فتح مسير الشهر</button>
    </div>`;
  const gi = $('#goImport', el); if (gi) gi.onclick = (ev) => { ev.preventDefault(); go('settings'); };
  const gu = $('#goUnknown', el); if (gu) gu.onclick = (ev) => { ev.preventDefault(); ui.empFilter = 'cardUnknown'; go('employees'); };
  $('#goPayroll', el).onclick = () => { ui.month = ym; go('payroll'); };
};

// ---------- الموظفون ----------
function loanBalance(empId) {
  return data.loans.filter((l) => l.empId === empId).reduce((a, l) => a + C.loanRemaining(data, l), 0);
}

views.employees = (el) => {
  const t = today();
  const q = ui.empSearch.trim();
  let list = C.sortEmployees(data.employees).filter((e) => {
    if (ui.empBranch && e.branch !== ui.empBranch) return false;
    const st = C.cardStatus(e, t).code;
    if (ui.empFilter === 'active' && e.active === false) return false;
    if (ui.empFilter === 'inactive' && e.active !== false) return false;
    if (ui.empFilter === 'cardAlert' && !(e.active !== false && ['expired', 'thisMonth', 'nextMonth'].includes(st))) return false;
    if (ui.empFilter === 'cardUnknown' && !(e.active !== false && st === 'unknown')) return false;
    if (q && ![e.empNo, e.name, e.nationalId, e.cardNo].some((v) => String(v || '').includes(q))) return false;
    return true;
  });
  el.innerHTML = `
    <h1>الموظفون</h1>
    <p class="sub">ملف كل موظف: الراتب الأساسي والبدلات وبطاقة الراتب وتاريخ انتهائها.</p>
    <div class="toolbar">
      <input type="search" id="eSearch" placeholder="بحث بالاسم أو الرقم أو الهوية أو البطاقة" value="${esc(ui.empSearch)}" style="width:300px">
      <select id="eBranch"><option value="">كل الفروع</option>${data.branches.map((b) => `<option value="${esc(b.code)}" ${ui.empBranch === b.code ? 'selected' : ''}>${esc(b.code)} ${esc(b.name)}</option>`).join('')}</select>
      <select id="eFilter">
        ${[['active', 'النشطون'], ['inactive', 'الموقوفون'], ['all', 'الكل'], ['cardAlert', 'تنبيهات البطاقات'], ['cardUnknown', 'بدون تاريخ انتهاء']]
          .map(([v, l]) => `<option value="${v}" ${ui.empFilter === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <span class="spacer"></span>
      <span>${list.length} موظف</span>
      <button class="btn primary" id="eAdd">+ موظف جديد</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>الرقم</th><th>الاسم</th><th>الفرع</th><th>رقم الهوية</th><th>رقم البطاقة</th><th>انتهاء البطاقة</th><th></th>
      <th class="num">الأساسي</th><th class="num">السكن</th><th class="num">بدلات أخرى</th><th class="num">الإجمالي</th><th class="num">رصيد السلف</th><th></th></tr></thead>
      <tbody>${list.map((e) => `<tr class="${e.active === false ? 'muted' : ''}">
        <td>${esc(e.empNo)}</td><td>${esc(e.name)}${e.active === false ? ' <span class="badge unknown">موقوف</span>' : ''}</td>
        <td>${esc(branchLabel(e.branch))}</td><td>${esc(e.nationalId)}</td>
        <td>${e.payByCard === false ? '—' : esc(e.cardNo)}</td><td>${esc(e.cardExpiry || '')}</td><td>${cardBadge(e)}</td>
        <td class="num">${money(e.basic)}</td><td class="num">${money(e.housing)}</td><td class="num">${money(e.other)}</td>
        <td class="num">${money((e.basic || 0) + (e.housing || 0) + (e.other || 0))}</td>
        <td class="num">${moneyOrDash(loanBalance(e.id))}</td>
        <td><div class="row-actions"><button class="btn small" data-edit="${e.id}">تعديل</button><button class="btn small" data-stmt="${e.id}">كشف الموظف</button></div></td>
      </tr>`).join('') || '<tr><td colspan="13" class="empty">لا يوجد موظفون</td></tr>'}</tbody>
    </table></div>`;
  const s = $('#eSearch', el);
  s.oninput = () => { ui.empSearch = s.value; const pos = s.selectionStart; render(); const n = $('#eSearch'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#eBranch', el).onchange = (ev) => { ui.empBranch = ev.target.value; render(); };
  $('#eFilter', el).onchange = (ev) => { ui.empFilter = ev.target.value; render(); };
  $('#eAdd', el).onclick = () => employeeForm();
  $$('[data-edit]', el).forEach((b) => (b.onclick = () => employeeForm(empById(b.dataset.edit))));
  $$('[data-stmt]', el).forEach((b) => (b.onclick = () => employeeStatementDialog(b.dataset.stmt)));
};

function employeeForm(emp) {
  const isNew = !emp;
  const e = emp || { id: uid(), empNo: '', name: '', nationalId: '', branch: '', cardNo: '', cardExpiry: '', payByCard: true, active: true, basic: 0, housing: 0, other: 0, mobile: '', notes: '', joinDate: '' };
  const loans = data.loans.filter((l) => l.empId === e.id);
  const box = openModal(`
    <h2>${isNew ? 'موظف جديد' : 'ملف الموظف: ' + esc(e.name)}</h2>
    <div class="grid3">
      <div class="field"><label>الرقم الوظيفي *</label><input type="text" id="fEmpNo" value="${esc(e.empNo)}"></div>
      <div class="field" style="grid-column: span 2"><label>الاسم (كما هو مسجل في البنك) *</label><input type="text" id="fName" value="${esc(e.name)}" maxlength="50"></div>
      <div class="field"><label>رقم الهوية / الإقامة</label><input type="text" id="fNid" value="${esc(e.nationalId)}" maxlength="10"></div>
      <div class="field"><label>الفرع</label><select id="fBranch"><option value="">—</option>${data.branches.map((b) => `<option value="${esc(b.code)}" ${b.code === e.branch ? 'selected' : ''}>${esc(b.code)} ${esc(b.name)}</option>`).join('')}</select></div>
      <div class="field"><label>الجوال</label><input type="text" id="fMobile" value="${esc(e.mobile)}"></div>
      <div class="field"><label>الراتب الأساسي</label><input type="number" step="0.01" id="fBasic" value="${inputMoney(e.basic)}"></div>
      <div class="field"><label>بدل السكن</label><input type="number" step="0.01" id="fHousing" value="${inputMoney(e.housing)}"></div>
      <div class="field"><label>بدلات أخرى</label><input type="number" step="0.01" id="fOther" value="${inputMoney(e.other)}"></div>
      <div class="field"><label>طريقة الصرف</label><select id="fPay"><option value="card" ${e.payByCard !== false ? 'selected' : ''}>بطاقة رواتب (ضمن ملف البنك)</option><option value="other" ${e.payByCard === false ? 'selected' : ''}>أخرى (لا يدخل ملف البنك)</option></select></div>
      <div class="field"><label>رقم بطاقة الراتب (19 رقم)</label><input type="text" id="fCard" value="${esc(e.cardNo)}" maxlength="19"></div>
      <div class="field"><label>تاريخ انتهاء البطاقة</label><input type="date" id="fExp" value="${esc(e.cardExpiry)}"></div>
      <div class="field"><label>تاريخ التعيين</label><input type="date" id="fJoin" value="${esc(e.joinDate || '')}"></div>
      <div class="field"><label>الحالة</label><select id="fActive"><option value="1" ${e.active !== false ? 'selected' : ''}>على رأس العمل</option><option value="0" ${e.active === false ? 'selected' : ''}>موقوف / منتهي</option></select></div>
      <div class="field" style="grid-column: span 3"><label>ملاحظات</label><input type="text" id="fNotes" value="${esc(e.notes)}"></div>
    </div>
    ${!isNew ? `<div class="card" style="margin-top:14px"><h2>السلف</h2>
      ${loans.length ? `<table><thead><tr><th>التاريخ</th><th class="num">المبلغ</th><th class="num">القسط</th><th class="num">المتبقي</th><th>ملاحظة</th></tr></thead><tbody>
      ${loans.map((l) => `<tr><td>${esc(l.date)}</td><td class="num">${money(l.amount)}</td><td class="num">${money(l.installment)}</td><td class="num">${money(C.loanRemaining(data, l))}</td><td>${esc(l.note)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="sub">لا توجد سلف.</p>'}
      <button class="btn" id="fLoan">+ سلفة جديدة لهذا الموظف</button></div>` : ''}
    <div id="fErr"></div>
    <div class="modal-actions">
      <button class="btn primary" id="fSave">حفظ</button>
      <button class="btn" id="fCancel">إلغاء</button>
      ${!isNew ? '<span class="spacer" style="flex:1"></span><button class="btn danger" id="fDel">حذف الموظف</button>' : ''}
    </div>`, true);
  $('#fCancel', box).onclick = closeModal;
  const fl = $('#fLoan', box); if (fl) fl.onclick = () => loanForm(null, e.id);
  const fd = $('#fDel', box);
  if (fd) fd.onclick = async () => {
    const used = Object.values(data.runs).some((r) => r.status === 'closed' && (r.snapshot || []).some((x) => x.emp.id === e.id));
    const msg = used ? 'هذا الموظف موجود في مسيرات معتمدة سابقة. يفضل إيقافه بدلاً من الحذف. هل تريد الحذف نهائياً؟' : `حذف الموظف ${esc(e.name)} نهائياً؟`;
    if (!(await confirmBox(msg, 'حذف'))) return;
    data.employees = data.employees.filter((x) => x.id !== e.id);
    data.loans = data.loans.filter((l) => l.empId !== e.id);
    save(); render(); toast('تم حذف الموظف');
  };
  $('#fSave', box).onclick = () => {
    const v = (id) => $('#' + id, box).value.trim();
    const upd = {
      ...e, empNo: C.digits(v('fEmpNo')), name: v('fName').replace(/[\u200b\ufeff]/g, ''), nationalId: C.digits(v('fNid')), branch: v('fBranch'), mobile: v('fMobile'),
      basic: parseMoney(v('fBasic')), housing: parseMoney(v('fHousing')), other: parseMoney(v('fOther')),
      payByCard: v('fPay') === 'card', cardNo: C.digits(v('fCard')), cardExpiry: v('fExp'), joinDate: v('fJoin'),
      active: v('fActive') === '1', notes: v('fNotes'),
    };
    const errs = [];
    if (!upd.empNo) errs.push('الرقم الوظيفي مطلوب');
    if (!upd.name) errs.push('الاسم مطلوب');
    if (data.employees.some((x) => x.id !== e.id && x.empNo === upd.empNo)) errs.push('الرقم الوظيفي مستخدم لموظف آخر');
    if (upd.payByCard) {
      if (upd.cardNo.length !== 19) errs.push('رقم البطاقة يجب أن يكون 19 رقماً');
      if (upd.nationalId.length !== 10) errs.push('رقم الهوية يجب أن يكون 10 أرقام');
      if (!upd.cardExpiry) errs.push('يفضل إدخال تاريخ انتهاء البطاقة لتصلك التنبيهات');
    }
    const blocking = errs.filter((x) => !x.startsWith('يفضل'));
    if (blocking.length) { $('#fErr', box).innerHTML = `<div class="alert error" style="margin-top:12px">${blocking.map(esc).join('<br>')}</div>`; return; }
    if (isNew) data.employees.push(upd);
    else Object.assign(e, upd);
    save(); closeModal(); render();
    toast(errs.length ? 'تم الحفظ. ' + errs.join('، ') : 'تم حفظ ملف الموظف');
  };
}

// ---------- السلف ----------
views.loans = (el) => {
  const list = data.loans.map((l) => ({ l, e: empById(l.empId), rem: C.loanRemaining(data, l) }))
    .filter((x) => x.e && (ui.loanFilter === 'all' || (ui.loanFilter === 'active' ? x.rem > 0 : x.rem === 0)))
    .sort((a, b) => String(b.l.date).localeCompare(String(a.l.date)));
  el.innerHTML = `
    <h1>السلف</h1>
    <p class="sub">تُخصم الأقساط تلقائياً في مسير كل شهر ابتداءً من شهر بداية الخصم، ويقل الرصيد عند اعتماد المسير.</p>
    <div class="toolbar">
      <select id="lFilter">${[['active', 'السلف القائمة'], ['done', 'السلف المسددة'], ['all', 'الكل']].map(([v, t]) => `<option value="${v}" ${ui.loanFilter === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="spacer"></span>
      <button class="btn primary" id="lAdd">+ سلفة جديدة</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>الموظف</th><th>تاريخ السلفة</th><th class="num">مبلغ السلفة</th><th class="num">القسط الشهري</th><th>بداية الخصم</th><th class="num">المسدد</th><th class="num">المتبقي</th><th>الحالة</th><th>ملاحظة</th><th></th></tr></thead>
      <tbody>${list.map(({ l, e, rem }) => `<tr>
        <td>${esc(e.empNo)} - ${esc(e.name)}</td><td>${esc(l.date)}</td>
        <td class="num">${money(l.amount)}</td><td class="num">${money(l.installment)}</td><td>${esc(monthLabel(l.startMonth))}</td>
        <td class="num">${money(l.amount - rem)}</td><td class="num">${money(rem)}</td>
        <td>${rem === 0 ? '<span class="badge ok">مسددة</span>' : l.paused ? '<span class="badge nextMonth">موقوفة مؤقتاً</span>' : '<span class="badge draft">قائمة</span>'}</td>
        <td>${esc(l.note)}</td>
        <td><div class="row-actions"><button class="btn small" data-ledit="${l.id}">تعديل</button>
        ${rem > 0 ? `<button class="btn small" data-lpause="${l.id}">${l.paused ? 'استئناف الخصم' : 'إيقاف الخصم'}</button>` : ''}</div></td>
      </tr>`).join('') || '<tr><td colspan="10" class="empty">لا توجد سلف</td></tr>'}</tbody>
    </table></div>`;
  $('#lFilter', el).onchange = (ev) => { ui.loanFilter = ev.target.value; render(); };
  $('#lAdd', el).onclick = () => loanForm();
  $$('[data-ledit]', el).forEach((b) => (b.onclick = () => loanForm(data.loans.find((l) => l.id === b.dataset.ledit))));
  $$('[data-lpause]', el).forEach((b) => (b.onclick = () => {
    const l = data.loans.find((x) => x.id === b.dataset.lpause); l.paused = !l.paused; save(); render();
  }));
};

function loanForm(loan, empId) {
  const isNew = !loan;
  const l = loan || { id: uid(), empId: empId || '', date: today(), amount: 0, installment: 0, startMonth: currentMonth(), note: '', paused: false };
  const paid = isNew ? 0 : C.loanPaid(data, l.id);
  const emps = C.sortEmployees(data.employees.filter((e) => e.active !== false || e.id === l.empId));
  const box = openModal(`
    <h2>${isNew ? 'سلفة جديدة' : 'تعديل سلفة'}</h2>
    <div class="grid2">
      <div class="field" style="grid-column: span 2"><label>الموظف</label><select id="lEmp" ${paid ? 'disabled' : ''}>
        <option value="">— اختر —</option>${emps.map((e) => `<option value="${e.id}" ${e.id === l.empId ? 'selected' : ''}>${esc(e.empNo)} - ${esc(e.name)}</option>`).join('')}</select></div>
      <div class="field"><label>تاريخ السلفة</label><input type="date" id="lDate" value="${esc(l.date)}"></div>
      <div class="field"><label>مبلغ السلفة</label><input type="number" step="0.01" id="lAmount" value="${inputMoney(l.amount)}"></div>
      <div class="field"><label>القسط الشهري</label><input type="number" step="0.01" id="lInst" value="${inputMoney(l.installment)}"><span class="hint" id="lHint"></span></div>
      <div class="field"><label>يبدأ الخصم من شهر</label><input type="month" id="lStart" value="${esc(l.startMonth)}"></div>
      <div class="field" style="grid-column: span 2"><label>ملاحظة</label><input type="text" id="lNote" value="${esc(l.note)}"></div>
    </div>
    ${paid ? `<p class="sub" style="margin-top:10px">تم سداد ${money(paid)} من هذه السلفة في مسيرات معتمدة.</p>` : ''}
    <div id="lErr"></div>
    <div class="modal-actions"><button class="btn primary" id="lSave">حفظ</button><button class="btn" id="lCancel">إلغاء</button>
    ${!isNew && !paid ? '<span style="flex:1"></span><button class="btn danger" id="lDel">حذف السلفة</button>' : ''}</div>`);
  const hint = () => {
    const a = parseMoney($('#lAmount', box).value), i = parseMoney($('#lInst', box).value);
    $('#lHint', box).textContent = a && i ? `عدد الأقساط تقريباً: ${Math.ceil(a / i)} شهر` : '';
  };
  $('#lAmount', box).oninput = hint; $('#lInst', box).oninput = hint; hint();
  $('#lCancel', box).onclick = closeModal;
  const del = $('#lDel', box);
  if (del) del.onclick = () => { data.loans = data.loans.filter((x) => x.id !== l.id); save(); closeModal(); render(); toast('تم حذف السلفة'); };
  $('#lSave', box).onclick = () => {
    const upd = {
      ...l, empId: $('#lEmp', box).value || l.empId, date: $('#lDate', box).value, amount: parseMoney($('#lAmount', box).value),
      installment: parseMoney($('#lInst', box).value), startMonth: $('#lStart', box).value, note: $('#lNote', box).value.trim(),
    };
    const errs = [];
    if (!upd.empId) errs.push('اختر الموظف');
    if (upd.amount <= 0) errs.push('أدخل مبلغ السلفة');
    if (upd.installment <= 0) errs.push('أدخل القسط الشهري');
    if (!upd.startMonth) errs.push('أدخل شهر بداية الخصم');
    if (upd.amount < paid) errs.push('المبلغ أقل من المسدد فعلاً');
    if (errs.length) { $('#lErr', box).innerHTML = `<div class="alert error" style="margin-top:12px">${errs.join('<br>')}</div>`; return; }
    if (isNew) data.loans.push(upd); else Object.assign(l, upd);
    save(); closeModal(); render(); toast('تم حفظ السلفة');
  };
}

// ---------- مسير الرواتب ----------
function getRun(ym, create) {
  if (!data.runs[ym] && create) data.runs[ym] = { status: 'draft', payDate: '', lines: {} };
  return data.runs[ym];
}

views.payroll = (el) => {
  const ym = ui.month;
  const run = getRun(ym) || { status: 'draft', lines: {} };
  const closed = run.status === 'closed';
  let rows;
  if (closed) rows = run.snapshot;
  else {
    rows = C.sortEmployees(data.employees.filter((e) => e.active !== false))
      .map((emp) => ({ emp, ...C.computeLine(data, emp, ym, run.lines[emp.id]), line: run.lines[emp.id] || {} }));
  }
  const included = rows.filter((r) => !(r.line && r.line.excluded));
  const sum = (k) => included.reduce((a, r) => a + (r[k] || 0), 0);
  const bank = C.bankRecords(included);

  let lastBranch = null;
  const body = rows.map((r, i) => {
    const e = r.emp, L = r.line || {};
    let g = '';
    if (e.branch !== lastBranch) { lastBranch = e.branch; g = `<tr class="group"><td colspan="14">${esc(branchLabel(e.branch))}</td></tr>`; }
    const ex = !!L.excluded;
    const cells = closed ? `
        <td class="num">${r.days}</td><td class="num">${moneyOrDash(r.bonus)}</td>
        <td class="num">${moneyOrDash(r.loanTotal)}</td><td class="num">${moneyOrDash(r.extraDed)}</td><td>${esc(r.extraDedNote || '')}</td>` : `
        <td><input type="number" min="0" max="${r.mdays}" data-k="days" data-id="${e.id}" value="${L.days == null || L.days === '' ? '' : L.days}" placeholder="${r.mdays}" style="width:60px" ${ex ? 'disabled' : ''}></td>
        <td><input type="number" step="0.01" data-k="bonus" data-id="${e.id}" value="${inputMoney(L.bonus)}" ${ex ? 'disabled' : ''}></td>
        <td><input type="number" step="0.01" data-k="loan" data-id="${e.id}" value="${inputMoney(r.loanTotal)}" ${ex || !data.loans.some((l) => l.empId === e.id) ? 'disabled' : ''} title="قسط السلف لهذا الشهر"></td>
        <td><input type="number" step="0.01" data-k="extraDed" data-id="${e.id}" value="${inputMoney(L.extraDed)}" ${ex ? 'disabled' : ''}></td>
        <td><input type="text" class="wide" data-k="extraDedNote" data-id="${e.id}" value="${esc(L.extraDedNote || '')}" placeholder="سبب الخصم" ${ex ? 'disabled' : ''}></td>`;
    return `${g}<tr class="${ex ? 'muted' : ''}">
      <td>${closed ? i + 1 : `<input type="checkbox" data-k="include" data-id="${e.id}" ${ex ? '' : 'checked'} title="ضمن مسير هذا الشهر" style="width:auto">`}</td>
      <td>${esc(e.empNo)}</td><td>${esc(e.name)} ${e.payByCard === false ? '<span class="badge none">بدون بطاقة</span>' : ''}</td>
      <td class="num">${money(r.basic)}</td><td class="num">${money(r.housing)}</td><td class="num">${money(r.other)}</td>
      ${cells}
      <td class="num">${money(r.gross)}</td><td class="num">${moneyOrDash(r.deductions)}</td><td class="num"><b>${money(r.net)}</b></td>
      <td><button class="btn small" data-slip="${e.id}">قسيمة</button></td></tr>`;
  }).join('');

  el.innerHTML = `
    <h1>مسير الرواتب</h1>
    <p class="sub">عدّل أيام العمل والإضافات والخصومات لكل موظف، ثم صدّر ملف البنك واعتمد المسير.</p>
    <div class="toolbar">
      <button class="btn" id="pPrev">→ السابق</button>
      <input type="month" id="pMonth" value="${ym}">
      <button class="btn" id="pNext">التالي ←</button>
      <b style="margin-inline-start:8px">${monthLabel(ym)}</b>
      ${closed ? `<span class="badge closed">معتمد ${esc(run.closedAt || '')}</span>` : '<span class="badge draft">مسودة</span>'}
      <span class="spacer"></span>
      <button class="btn primary" id="pExport">تصدير ملف البنك</button>
      <button class="btn" id="pSheet">طباعة المسير</button>
      <button class="btn" id="pSlips">قسائم الرواتب</button>
      <button class="btn" id="pCsv">Excel</button>
      ${closed ? '<button class="btn" id="pReopen">إلغاء الاعتماد</button>' : '<button class="btn" id="pClose">اعتماد المسير</button>'}
    </div>
    <div class="stats">
      <div class="stat"><div class="label">عدد الموظفين في المسير</div><div class="value">${included.length}</div></div>
      <div class="stat"><div class="label">إجمالي الاستحقاق</div><div class="value">${money(sum('gross'))}</div></div>
      <div class="stat"><div class="label">إجمالي الاستقطاع</div><div class="value">${money(sum('deductions'))}</div></div>
      <div class="stat"><div class="label">صافي الرواتب</div><div class="value">${money(sum('net'))}</div></div>
      <div class="stat"><div class="label">ملف البنك (${bank.length} بطاقة)</div><div class="value">${money(bank.reduce((a, r) => a + r.amount, 0))}</div></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>الرقم</th><th>الاسم</th><th class="num">الأساسي</th><th class="num">السكن</th><th class="num">بدلات أخرى</th>
      <th>أيام العمل</th><th>إضافي/مكافأة</th><th>قسط السلف</th><th>خصومات أخرى</th><th>سبب الخصم</th>
      <th class="num">إجمالي الاستحقاق</th><th class="num">الاستقطاع</th><th class="num">الصافي</th><th></th></tr></thead>
      <tbody>${body || '<tr><td colspan="15" class="empty">لا يوجد موظفون</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3">الإجمالي</td><td class="num">${money(sum('basic'))}</td><td class="num">${money(sum('housing'))}</td><td class="num">${money(sum('other'))}</td>
      <td></td><td class="num">${moneyOrDash(sum('bonus'))}</td><td class="num">${moneyOrDash(sum('loanTotal'))}</td><td class="num">${moneyOrDash(sum('extraDed'))}</td><td></td>
      <td class="num">${money(sum('gross'))}</td><td class="num">${money(sum('deductions'))}</td><td class="num">${money(sum('net'))}</td><td></td></tr></tfoot>
    </table></div>`;

  $('#pMonth', el).onchange = (ev) => { if (ev.target.value) { ui.month = ev.target.value; render(); } };
  $('#pPrev', el).onclick = () => { ui.month = shiftMonth(ym, -1); render(); };
  $('#pNext', el).onclick = () => { ui.month = shiftMonth(ym, 1); render(); };
  $('#pExport', el).onclick = () => exportBankDialog(ym);
  $('#pSheet', el).onclick = () => showReport(payrollSheetHtml(ym), `مسير رواتب ${ym}.pdf`, true);
  $('#pSlips', el).onclick = () => showReport(payslipsHtml(ym), `قسائم رواتب ${ym}.pdf`);
  $('#pCsv', el).onclick = () => exportCsv(ym);
  $$('[data-slip]', el).forEach((b) => (b.onclick = () => {
    const emp = rows.find((r) => r.emp.id === b.dataset.slip).emp;
    showReport(payslipsHtml(ym, [b.dataset.slip]), `قسيمة راتب ${emp.empNo} ${ym}.pdf`);
  }));
  const pc = $('#pClose', el);
  if (pc) pc.onclick = async () => {
    if (!(await confirmBox(`اعتماد مسير ${monthLabel(ym)}؟ سيتم تثبيت المبالغ وتسجيل أقساط السلف كمسددة. يمكن إلغاء الاعتماد لاحقاً.`, 'اعتماد'))) return;
    closeRun(ym); render(); toast('تم اعتماد المسير');
  };
  const pr = $('#pReopen', el);
  if (pr) pr.onclick = async () => {
    if (!(await confirmBox('إلغاء اعتماد المسير؟ سيعاد حسابه من ملفات الموظفين الحالية، وستُعاد أقساط السلف لهذا الشهر غير مسددة.', 'إلغاء الاعتماد'))) return;
    const r = data.runs[ym];
    r.status = 'draft';
    delete r.snapshot; delete r.closedAt;
    save(); render(); toast('أصبح المسير مسودة');
  };

  if (closed) return;
  $$('input[data-k]', el).forEach((inp) => {
    inp.onchange = () => {
      const r = getRun(ym, true);
      const L = (r.lines[inp.dataset.id] = r.lines[inp.dataset.id] || {});
      const k = inp.dataset.k;
      if (k === 'include') L.excluded = !inp.checked;
      else if (k === 'days') L.days = inp.value === '' ? null : Number(inp.value);
      else if (k === 'extraDedNote') L.extraDedNote = inp.value;
      else if (k === 'loan') setLoanOverride(inp.dataset.id, ym, L, parseMoney(inp.value));
      else L[k] = parseMoney(inp.value);
      save(); render();
    };
  });
};

// توزيع قسط السلف المدخل يدوياً على سلف الموظف (الأقدم أولاً)
function setLoanOverride(empId, ym, L, total) {
  const loans = data.loans.filter((l) => l.empId === empId && l.startMonth <= ym && C.loanRemaining(data, l, ym) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  L.loanOverrides = {};
  let left = total;
  for (const l of loans) {
    const amt = Math.min(left, C.loanRemaining(data, l, ym));
    L.loanOverrides[l.id] = amt;
    left -= amt;
  }
  if (left > 0) toast('القسط المدخل أكبر من رصيد السلف المتبقي، تم الاكتفاء بالرصيد');
}

function closeRun(ym) {
  const r = getRun(ym, true);
  r.snapshot = C.computeRun(data, ym).map((row) => ({
    ...row, emp: JSON.parse(JSON.stringify(row.emp)), line: r.lines[row.emp.id] || {}, extraDedNote: (r.lines[row.emp.id] || {}).extraDedNote || '',
  }));
  for (const row of r.snapshot) {
    r.lines[row.emp.id] = { ...(r.lines[row.emp.id] || {}), loanDeductions: row.loanDeductions };
  }
  r.status = 'closed';
  r.closedAt = today();
  save();
}

function exportBankDialog(ym) {
  const run = getRun(ym) || {};
  const rows = C.computeRun(data, ym);
  const recs = C.bankRecords(rows);
  const [y, m] = ym.split('-');
  const defDate = run.payDate || (ym === currentMonth() ? today() : `${ym}-${String(C.daysInMonth(ym) - 1).padStart(2, '0')}`);
  const box = openModal(`
    <h2>تصدير ملف البنك — ${monthLabel(ym)}</h2>
    <div class="grid2">
      <div class="field"><label>تاريخ التحويل (يظهر داخل الملف)</label><input type="date" id="xDate" value="${defDate}"></div>
      <div class="field"><label>اسم الملف</label><input type="text" id="xName" value="رواتب شهر ${Number(m)}-${y}.txt"></div>
    </div>
    <div class="kv" style="margin:14px 0"><div>عدد البطاقات</div><div><b>${recs.length}</b></div>
      <div>إجمالي المبلغ</div><div><b>${money(recs.reduce((a, r) => a + r.amount, 0))}</b> ريال</div>
      <div>لا يدخلون الملف</div><div>${rows.filter((r) => r.emp.payByCard === false).length} بدون بطاقة، ${rows.filter((r) => r.emp.payByCard !== false && r.net <= 0).length} بصافي صفر</div></div>
    <div id="xProblems"></div>
    ${run.status !== 'closed' ? '<label class="check"><input type="checkbox" id="xClose" checked> اعتماد المسير بعد التصدير (لتسجيل أقساط السلف كمسددة)</label>' : ''}
    <div class="modal-actions"><button class="btn primary" id="xGo">تصدير</button><button class="btn" id="xCancel">إلغاء</button></div>`);
  const check = () => {
    const probs = C.validateRecords(rows, $('#xDate', box).value);
    const errs = probs.filter((p) => p.level === 'error'), warns = probs.filter((p) => p.level === 'warn');
    $('#xProblems', box).innerHTML =
      (errs.length ? `<div class="alert error"><b>يجب تصحيح التالي قبل التصدير:</b><ul>${errs.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : '') +
      (warns.length ? `<div class="alert warn"><b>تنبيهات:</b><ul>${warns.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : '');
    $('#xGo', box).disabled = !!errs.length || !recs.length;
  };
  $('#xDate', box).onchange = check; check();
  $('#xCancel', box).onclick = closeModal;
  $('#xGo', box).onclick = async () => {
    const date = $('#xDate', box).value;
    let bytes;
    try { bytes = C.buildBankFile(recs, date.replace(/-/g, '')); } catch (err) { toast(err.message, 6000); return; }
    const closeAfter = $('#xClose', box) && $('#xClose', box).checked;
    const p = await bridge.saveFile($('#xName', box).value, bytes, [{ name: 'ملف البنك', extensions: ['txt'] }]);
    if (!p) return;
    const r = getRun(ym, true);
    r.payDate = date;
    r.exportedAt = new Date().toLocaleString('en-GB');
    if (closeAfter) closeRun(ym);
    save(); closeModal(); render();
    toast('تم حفظ ملف البنك: ' + p, 6000);
    bridge.showFile(p);
  };
}

function exportCsv(ym) {
  const rows = C.computeRun(data, ym);
  const head = ['الفرع', 'الرقم الوظيفي', 'الاسم', 'رقم الهوية', 'رقم البطاقة', 'أيام العمل', 'الأساسي', 'السكن', 'بدلات أخرى', 'إجمالي الاستحقاق', 'قسط السلف', 'خصومات أخرى', 'إجمالي الاستقطاع', 'الصافي', 'طريقة الصرف'];
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const n = (h) => C.fromHalalas(h).toFixed(2);
  const lines = [head.map(q).join(',')].concat(rows.map((r) => [
    branchLabel(r.emp.branch), r.emp.empNo, r.emp.name, `="${r.emp.nationalId || ''}"`, `="${r.emp.cardNo || ''}"`, r.days,
    n(r.basic), n(r.housing), n(r.other), n(r.gross), n(r.loanTotal), n(r.extraDed), n(r.deductions), n(r.net), r.emp.payByCard === false ? 'أخرى' : 'بطاقة',
  ].map((v, i) => (i === 3 || i === 4 ? v : q(v))).join(',')));
  const bytes = new TextEncoder().encode('﻿' + lines.join('\r\n'));
  bridge.saveFile(`مسير رواتب ${ym}.csv`, bytes, [{ name: 'Excel CSV', extensions: ['csv'] }]).then((p) => p && toast('تم الحفظ: ' + p));
}

// ---------- الكشوفات (طباعة / PDF) ----------
function reportShell(title, inner, landscape) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
    body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; font-size: 11px; color: #111; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f6b5c; padding-bottom: 6px; margin-bottom: 10px; }
    .head h1 { font-size: 16px; margin: 0; } .head .co { font-size: 13px; font-weight: 700; color: #0f6b5c; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { border: 1px solid #c9ced6; padding: 4px 6px; text-align: right; }
    th { background: #eef3f2; font-size: 10px; }
    td.n, th.n { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; }
    tr.g td { background: #e3f2ef; font-weight: 700; }
    tr.t td { background: #f4f6f9; font-weight: 700; }
    tr.gt td { background: #0f6b5c; color: #fff; font-weight: 700; }
    .sign { display: flex; justify-content: space-between; margin-top: 40px; gap: 20px; }
    .sign div { flex: 1; text-align: center; border-top: 1px solid #555; padding-top: 4px; }
    .slip { page-break-after: always; border: 1px solid #c9ced6; border-radius: 6px; padding: 14px; margin-bottom: 14px; }
    .slip:last-child { page-break-after: auto; }
    .slip .info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 14px; margin-bottom: 10px; }
    .slip .info span { color: #555; }
    .net { font-size: 14px; font-weight: 700; text-align: center; background: #e3f2ef; padding: 8px; border-radius: 4px; }
    .muted { color: #666; }
  </style></head><body>${inner}</body></html>`;
}

function reportHead(title) {
  return `<div class="head"><div><div class="co">${esc(data.settings.companyName || '')}</div><h1>${esc(title)}</h1></div><div class="muted">تاريخ الطباعة: ${today()}</div></div>`;
}

function payrollSheetHtml(ym) {
  const rows = C.computeRun(data, ym);
  const groups = [];
  for (const r of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.branch !== r.emp.branch) groups.push((g = { branch: r.emp.branch, rows: [] }));
    g.rows.push(r);
  }
  const keys = ['basic', 'housing', 'other', 'gross', 'loanTotal', 'extraDed', 'deductions', 'net'];
  const tot = (list) => keys.map((k) => `<td class="n">${money(list.reduce((a, r) => a + (r[k] || 0), 0))}</td>`).join('');
  let seq = 0;
  const body = groups.map((g) => `
    <tr class="g"><td colspan="13">الفرع: ${esc(branchLabel(g.branch))}</td></tr>
    ${g.rows.map((r) => `<tr><td>${++seq}</td><td>${esc(r.emp.empNo)}</td><td>${esc(r.emp.name)}</td><td class="n">${r.days}</td>
      ${keys.map((k) => `<td class="n">${r[k] ? money(r[k]) : ''}</td>`).join('')}<td>${r.emp.payByCard === false ? 'أخرى' : 'بطاقة'}</td></tr>`).join('')}
    <tr class="t"><td colspan="4">إجمالي الفرع ${esc(g.branch || '')}</td>${tot(g.rows)}<td></td></tr>`).join('');
  return reportShell(`مسير رواتب ${ym}`, `${reportHead(`كشف مسير رواتب شهر ${monthLabel(ym)}`)}
    <table><thead><tr><th>م</th><th>الرقم</th><th>اسم الموظف</th><th class="n">الأيام</th><th class="n">الأساسي</th><th class="n">بدل السكن</th><th class="n">بدلات أخرى</th>
    <th class="n">إجمالي الاستحقاق</th><th class="n">السلف</th><th class="n">خصومات أخرى</th><th class="n">إجمالي الاستقطاع</th><th class="n">صافي الراتب</th><th>الصرف</th></tr></thead>
    <tbody>${body}<tr class="gt"><td colspan="4">الإجمالي الكلي (${rows.length} موظف)</td>${tot(rows)}<td></td></tr></tbody></table>
    <div class="sign"><div>المحاسب</div><div>المدير المالي</div><div>المدير العام</div></div>`, true);
}

function payslipsHtml(ym, empIds) {
  const rows = C.computeRun(data, ym).filter((r) => !empIds || empIds.includes(r.emp.id));
  const slips = rows.map((r) => {
    const e = r.emp;
    const loanLines = Object.entries(r.loanDeductions || {}).map(([id, amt]) => {
      const l = data.loans.find((x) => x.id === id);
      return `<tr><td>قسط سلفة${l && l.note ? ' - ' + esc(l.note) : ''}</td><td class="n">${money(amt)}</td></tr>`;
    }).join('');
    const loansLeft = data.loans.filter((l) => l.empId === e.id).reduce((a, l) => a + C.loanRemaining(data, l), 0);
    const note = r.extraDedNote || '';
    return `<div class="slip">${reportHead(`قسيمة راتب شهر ${monthLabel(ym)}`)}
      <div class="info"><div><span>الرقم الوظيفي:</span> ${esc(e.empNo)}</div><div><span>الاسم:</span> ${esc(e.name)}</div><div><span>الفرع:</span> ${esc(branchLabel(e.branch))}</div>
      <div><span>رقم الهوية:</span> ${esc(e.nationalId)}</div><div><span>بطاقة الراتب:</span> ${e.payByCard === false ? '—' : esc(e.cardNo)}</div><div><span>أيام العمل:</span> ${r.days} من ${r.mdays}</div></div>
      <table><tr><th style="width:50%">الاستحقاقات</th><th class="n">المبلغ</th></tr>
        <tr><td>الراتب الأساسي</td><td class="n">${money(r.basic)}</td></tr>
        <tr><td>بدل السكن</td><td class="n">${money(r.housing)}</td></tr>
        <tr><td>بدلات أخرى</td><td class="n">${money(r.other - (r.bonus || 0))}</td></tr>
        ${r.bonus ? `<tr><td>إضافي / مكافأة</td><td class="n">${money(r.bonus)}</td></tr>` : ''}
        <tr class="t"><td>إجمالي الاستحقاق</td><td class="n">${money(r.gross)}</td></tr></table>
      <table><tr><th style="width:50%">الاستقطاعات</th><th class="n">المبلغ</th></tr>
        ${loanLines}
        ${r.extraDed ? `<tr><td>خصم${note ? ' - ' + esc(note) : ''}</td><td class="n">${money(r.extraDed)}</td></tr>` : ''}
        ${!loanLines && !r.extraDed ? '<tr><td colspan="2" class="muted">لا يوجد</td></tr>' : ''}
        <tr class="t"><td>إجمالي الاستقطاع</td><td class="n">${money(r.deductions)}</td></tr></table>
      <div class="net">صافي الراتب: ${money(r.net)} ريال</div>
      ${loansLeft ? `<p class="muted">رصيد السلف المتبقي: ${money(loansLeft)} ريال</p>` : ''}
      <div class="sign"><div>توقيع الموظف</div><div>المحاسب</div></div></div>`;
  }).join('');
  return reportShell(`قسائم رواتب ${ym}`, slips || '<p>لا توجد بيانات</p>');
}

function employeeStatementHtml(empId, from, to) {
  const e = empById(empId);
  const months = Object.keys(data.runs).filter((ym) => ym >= from && ym <= to).sort();
  if (to === currentMonth() && !months.includes(to) && from <= to) months.push(to);
  const rows = months.map((ym) => ({ ym, r: C.computeRun(data, ym).find((x) => x.emp.id === empId), st: (data.runs[ym] || {}).status })).filter((x) => x.r);
  const keys = ['basic', 'housing', 'other', 'gross', 'loanTotal', 'extraDed', 'deductions', 'net'];
  const loans = data.loans.filter((l) => l.empId === empId);
  return reportShell(`كشف ${e.name}`, `${reportHead('كشف رواتب موظف')}
    <table><tr><th>الرقم الوظيفي</th><td>${esc(e.empNo)}</td><th>الاسم</th><td>${esc(e.name)}</td><th>الفرع</th><td>${esc(branchLabel(e.branch))}</td></tr>
    <tr><th>رقم الهوية</th><td>${esc(e.nationalId)}</td><th>بطاقة الراتب</th><td>${esc(e.cardNo || '—')}</td><th>انتهاء البطاقة</th><td>${esc(e.cardExpiry || '—')}</td></tr></table>
    <p class="muted">الفترة: من ${monthLabel(from)} إلى ${monthLabel(to)}</p>
    <table><thead><tr><th>الشهر</th><th class="n">الأيام</th><th class="n">الأساسي</th><th class="n">السكن</th><th class="n">بدلات أخرى</th><th class="n">إجمالي الاستحقاق</th>
    <th class="n">السلف</th><th class="n">خصومات أخرى</th><th class="n">إجمالي الاستقطاع</th><th class="n">الصافي</th><th>الحالة</th></tr></thead><tbody>
    ${rows.map(({ ym, r, st }) => `<tr><td>${monthLabel(ym)}</td><td class="n">${r.days}</td>${keys.map((k) => `<td class="n">${r[k] ? money(r[k]) : ''}</td>`).join('')}<td>${st === 'closed' ? 'معتمد' : 'مسودة'}</td></tr>`).join('') || '<tr><td colspan="11">لا توجد مسيرات في هذه الفترة</td></tr>'}
    <tr class="gt"><td colspan="2">الإجمالي</td>${keys.map((k) => `<td class="n">${money(rows.reduce((a, x) => a + (x.r[k] || 0), 0))}</td>`).join('')}<td></td></tr></tbody></table>
    ${loans.length ? `<h3>السلف</h3><table><tr><th>التاريخ</th><th class="n">المبلغ</th><th class="n">القسط</th><th class="n">المسدد</th><th class="n">المتبقي</th><th>ملاحظة</th></tr>
      ${loans.map((l) => `<tr><td>${esc(l.date)}</td><td class="n">${money(l.amount)}</td><td class="n">${money(l.installment)}</td><td class="n">${money(C.loanPaid(data, l.id))}</td><td class="n">${money(C.loanRemaining(data, l))}</td><td>${esc(l.note)}</td></tr>`).join('')}</table>` : ''}`, true);
}

function employeeStatementDialog(empId, root) {
  const e = empById(empId);
  const all = Object.keys(data.runs).sort();
  const from = all[0] || currentMonth();
  const box = openModal(`<h2>كشف رواتب: ${esc(e.empNo)} - ${esc(e.name)}</h2>
    <div class="grid2"><div class="field"><label>من شهر</label><input type="month" id="sFrom" value="${from}"></div>
    <div class="field"><label>إلى شهر</label><input type="month" id="sTo" value="${currentMonth()}"></div></div>
    <div class="modal-actions"><button class="btn primary" id="sGo">عرض الكشف</button><button class="btn" id="sCancel">إلغاء</button></div>`);
  $('#sCancel', box).onclick = closeModal;
  $('#sGo', box).onclick = () => {
    const f = $('#sFrom', box).value, t = $('#sTo', box).value;
    showReport(employeeStatementHtml(empId, f, t), `كشف موظف ${e.empNo}.pdf`, true);
  };
}

function showReport(html, pdfName, landscape) {
  const box = openModal(`<div class="toolbar"><b>معاينة</b><span class="spacer"></span>
    <button class="btn primary" id="rPdf">حفظ PDF</button><button class="btn" id="rPrint">طباعة</button><button class="btn" id="rClose">إغلاق</button></div>
    <iframe class="preview" id="rFrame"></iframe>`, true);
  const fr = $('#rFrame', box);
  fr.srcdoc = html;
  $('#rClose', box).onclick = closeModal;
  $('#rPrint', box).onclick = () => fr.contentWindow.print();
  $('#rPdf', box).onclick = async () => {
    const p = await bridge.savePdf(html, pdfName, landscape);
    if (p) { toast('تم حفظ الملف: ' + p, 6000); bridge.showFile(p); }
  };
}

views.reports = (el) => {
  const months = Object.keys(data.runs).sort().reverse();
  if (!months.includes(currentMonth())) months.unshift(currentMonth());
  const emps = C.sortEmployees(data.employees);
  el.innerHTML = `
    <h1>الكشوفات</h1>
    <p class="sub">كشوفات قابلة للطباعة والحفظ PDF.</p>
    <div class="card"><h2>المسيرات الشهرية</h2>
      <div class="table-wrap"><table><thead><tr><th>الشهر</th><th>الحالة</th><th class="num">عدد الموظفين</th><th class="num">إجمالي الاستحقاق</th><th class="num">الاستقطاع</th><th class="num">الصافي</th><th></th></tr></thead><tbody>
      ${months.map((ym) => {
        const rows = C.computeRun(data, ym);
        const s = (k) => rows.reduce((a, r) => a + r[k], 0);
        const st = (data.runs[ym] || {}).status;
        return `<tr><td>${monthLabel(ym)}</td><td>${st === 'closed' ? '<span class="badge closed">معتمد</span>' : '<span class="badge draft">مسودة</span>'}</td>
        <td class="num">${rows.length}</td><td class="num">${money(s('gross'))}</td><td class="num">${money(s('deductions'))}</td><td class="num">${money(s('net'))}</td>
        <td><div class="row-actions"><button class="btn small" data-sheet="${ym}">كشف المسير</button><button class="btn small" data-slips="${ym}">قسائم الرواتب</button><button class="btn small" data-open="${ym}">فتح</button></div></td></tr>`;
      }).join('')}</tbody></table></div></div>
    <div class="card"><h2>كشف موظف (شهر بشهر)</h2>
      <div class="toolbar"><select id="rEmp" style="min-width:320px">${emps.map((e) => `<option value="${e.id}">${esc(e.empNo)} - ${esc(e.name)}</option>`).join('')}</select>
      <button class="btn primary" id="rStmt">عرض الكشف</button></div></div>`;
  $$('[data-sheet]', el).forEach((b) => (b.onclick = () => showReport(payrollSheetHtml(b.dataset.sheet), `مسير رواتب ${b.dataset.sheet}.pdf`, true)));
  $$('[data-slips]', el).forEach((b) => (b.onclick = () => showReport(payslipsHtml(b.dataset.slips), `قسائم رواتب ${b.dataset.slips}.pdf`)));
  $$('[data-open]', el).forEach((b) => (b.onclick = () => { ui.month = b.dataset.open; go('payroll'); }));
  const rs = $('#rStmt', el); if (rs) rs.onclick = () => { const v = $('#rEmp', el).value; if (v) employeeStatementDialog(v); };
};

// ---------- الفروع والإعدادات ----------
views.settings = (el) => {
  el.innerHTML = `
    <h1>الفروع والإعدادات</h1>
    <div class="card"><h2>بيانات الشركة</h2>
      <div class="grid2"><div class="field"><label>اسم الشركة (يظهر في الكشوفات)</label><input type="text" id="sCo" value="${esc(data.settings.companyName)}"></div></div>
    </div>
    <div class="card"><h2>الفروع</h2>
      <table><thead><tr><th>رقم الفرع</th><th>اسم الفرع</th><th>عدد الموظفين</th><th></th></tr></thead><tbody>
      ${data.branches.map((b, i) => `<tr><td><input type="text" data-bc="${i}" value="${esc(b.code)}"></td><td><input type="text" class="wide" data-bn="${i}" value="${esc(b.name)}" style="width:240px"></td>
        <td>${data.employees.filter((e) => e.branch === b.code).length}</td><td><button class="btn small danger" data-bdel="${i}">حذف</button></td></tr>`).join('')}
      </tbody></table>
      <button class="btn" id="bAdd" style="margin-top:8px">+ فرع</button>
    </div>
    <div class="card"><h2>البيانات</h2>
      <p class="sub">تُحفظ البيانات تلقائياً في مجلد "المستندات\\برنامج الرواتب" مع نسخة احتياطية يومية.</p>
      <div class="toolbar">
        <button class="btn" id="dFolder">فتح مجلد البيانات</button>
        <button class="btn" id="dBackup">حفظ نسخة احتياطية</button>
        <button class="btn" id="dRestore">استعادة نسخة احتياطية</button>
        <button class="btn primary" id="dImport">استيراد الموظفين من ملف بنك سابق (txt)</button>
      </div>
    </div>`;
  $('#sCo', el).onchange = (ev) => { data.settings.companyName = ev.target.value.trim(); save(); renderAlertBadge(); };
  $$('[data-bc]', el).forEach((inp) => (inp.onchange = () => {
    const b = data.branches[inp.dataset.bc], old = b.code;
    b.code = inp.value.trim();
    data.employees.forEach((e) => { if (e.branch === old) e.branch = b.code; });
    save(); render();
  }));
  $$('[data-bn]', el).forEach((inp) => (inp.onchange = () => { data.branches[inp.dataset.bn].name = inp.value.trim(); save(); }));
  $$('[data-bdel]', el).forEach((btn) => (btn.onclick = async () => {
    const b = data.branches[btn.dataset.bdel];
    if (data.employees.some((e) => e.branch === b.code)) { toast('لا يمكن حذف فرع عليه موظفون'); return; }
    data.branches.splice(btn.dataset.bdel, 1); save(); render();
  }));
  $('#bAdd', el).onclick = () => { data.branches.push({ code: '', name: '' }); save(); render(); };
  $('#dFolder', el).onclick = () => bridge.openDataFolder();
  $('#dBackup', el).onclick = async () => {
    const p = await bridge.saveFile(`نسخة رواتب ${today()}.json`, new TextEncoder().encode(JSON.stringify(data, null, 1)), [{ name: 'JSON', extensions: ['json'] }]);
    if (p) toast('تم حفظ النسخة: ' + p);
  };
  $('#dRestore', el).onclick = async () => {
    const f = await bridge.openFile([{ name: 'نسخة احتياطية', extensions: ['json'] }]);
    if (!f) return;
    let d;
    try { d = JSON.parse(new TextDecoder().decode(f.bytes)); } catch { toast('الملف غير صالح'); return; }
    if (!d || !Array.isArray(d.employees)) { toast('الملف ليس نسخة من برنامج الرواتب'); return; }
    if (data.employees.length && !(await confirmBox(`استبدال كل البيانات الحالية ببيانات الملف (${d.employees.length} موظف)؟`, 'استبدال'))) return;
    data = Object.assign(C.emptyData(), d);
    save(); render(); toast('تمت استعادة البيانات');
  };
  $('#dImport', el).onclick = importBankFile;
};

async function importBankFile() {
  const f = await bridge.openFile([{ name: 'ملف البنك', extensions: ['txt'] }]);
  if (!f) return;
  let rows;
  try { rows = C.parseBankFile(f.bytes); } catch (err) { toast('تعذر قراءة الملف: ' + err.message, 6000); return; }
  const existing = rows.filter((r) => data.employees.some((e) => e.empNo === r.empNo));
  const box = openModal(`<h2>استيراد من ${esc(f.name)}</h2>
    <p>عدد السجلات: <b>${rows.length}</b> — جدد: <b>${rows.length - existing.length}</b> — موجودون مسبقاً: <b>${existing.length}</b></p>
    <label class="check"><input type="checkbox" id="iCard" checked> تحديث رقم البطاقة ورقم الهوية والاسم للموظفين الموجودين</label>
    <label class="check"><input type="checkbox" id="iSal"> تحديث الراتب (أساسي/سكن/أخرى) للموظفين الموجودين</label>
    <p class="sub">الموظفون الجدد يُضافون بالراتب الموجود في الملف. أدخل الفرع وتاريخ انتهاء البطاقة لاحقاً من ملف كل موظف.</p>
    <div class="modal-actions"><button class="btn primary" id="iGo">استيراد</button><button class="btn" id="iCancel">إلغاء</button></div>`);
  $('#iCancel', box).onclick = closeModal;
  $('#iGo', box).onclick = () => {
    const upCard = $('#iCard', box).checked, upSal = $('#iSal', box).checked;
    let added = 0, updated = 0;
    for (const r of rows) {
      const e = data.employees.find((x) => x.empNo === r.empNo);
      if (!e) {
        data.employees.push({ id: uid(), empNo: r.empNo, name: r.name, nationalId: r.nationalId, branch: '', cardNo: r.cardNo, cardExpiry: '', payByCard: true, active: true,
          basic: r.basic, housing: r.housing, other: r.other, mobile: '', notes: '' });
        added++;
      } else {
        if (upCard) Object.assign(e, { cardNo: r.cardNo, nationalId: r.nationalId, name: r.name });
        if (upSal) Object.assign(e, { basic: r.basic, housing: r.housing, other: r.other });
        if (upCard || upSal) updated++;
      }
    }
    save(); closeModal(); render();
    toast(`تمت إضافة ${added} وتحديث ${updated} موظف`);
  };
}

// ---------- التشغيل ----------
$$('#nav button').forEach((b) => (b.onclick = () => go(b.dataset.view)));
$('#modal').addEventListener('mousedown', (ev) => { if (ev.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });

(async function init() {
  try {
    const raw = await bridge.loadData();
    if (raw) data = Object.assign(C.emptyData(), JSON.parse(raw));
  } catch (err) {
    toast('تعذر قراءة ملف البيانات: ' + err.message, 8000);
  }
  render();
})();
