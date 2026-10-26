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
  openFiles: (filters) => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.accept = filters.flatMap((f) => f.extensions.map((x) => '.' + x)).join(',');
    inp.onchange = async () => resolve(await Promise.all([...inp.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
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
    ${allowanceTypes().length ? `<div class="card" style="margin-top:14px"><h2>المستحقات الثابتة</h2>
      <p class="sub" style="margin:0 0 8px">حدد ما يستحقه الموظف. اترك المبلغ فارغاً لاستخدام المبلغ الافتراضي للنوع.</p>
      <table><thead><tr><th>مشمول</th><th>النوع</th><th>الحساب</th><th>المبلغ للموظف</th></tr></thead><tbody>
      ${allowanceTypes().map((t) => { const own = (e.allowances || {})[t.id] || {}; const on = C.allowanceApplies(t, e); return `<tr>
        <td><input type="checkbox" data-fal="${t.id}" ${on ? 'checked' : ''} style="width:auto"></td><td>${esc(t.name)}${t.active === false ? ' <span class="hint">(موقوف)</span>' : ''}</td>
        <td>${KIND_LABELS[t.kind] || ''}${t.kind === 'fixed' ? ' — ' + FREQ_LABELS[t.frequency || 'monthly'] : ''}</td>
        <td>${t.kind === 'manual' ? '<span class="hint">يُدخل كل شهر من صفحة المستحقات</span>' : `<input type="number" step="0.01" data-faa="${t.id}" value="${own.amount != null && own.amount !== '' ? inputMoney(own.amount) : ''}" placeholder="${inputMoney(t.amount) || '0'}">${t.kind === 'daily' ? ' <span class="hint">لليوم</span>' : ''}`}</td></tr>`; }).join('')}
      </tbody></table></div>` : ''}
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
    const al = { ...(e.allowances || {}) };
    for (const t of allowanceTypes()) {
      const cb = $(`[data-fal="${t.id}"]`, box);
      if (!cb) continue;
      const own = { ...(al[t.id] || {}) };
      // مشمول تلقائياً بالنوع (الكل أو فرعه) فلا نحتاج تفعيلاً خاصاً، وإلا نحفظ الاختيار
      const byScope = t.scope === 'all' || (t.scope === 'branches' && (t.branches || []).includes(upd.branch));
      if (cb.checked) { if (byScope) delete own.enabled; else own.enabled = true; } else own.enabled = false;
      const amt = $(`[data-faa="${t.id}"]`, box);
      if (amt) { if (amt.value.trim() === '') delete own.amount; else own.amount = parseMoney(amt.value); }
      al[t.id] = own;
    }
    upd.allowances = al;
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
  if (closed) rows = run.snapshot.map((r) => ({ ...r, line: { ...(r.line || {}), ...(run.lines[r.emp.id] || {}) } }));
  else {
    rows = C.sortEmployees(data.employees.filter((e) => e.active !== false || (run.lines[e.id] && run.lines[e.id].fixed)))
      .map((emp) => ({ emp, ...C.computeLine(data, emp, ym, run.lines[emp.id]), line: run.lines[emp.id] || {} }));
    // المستبعدون في آخر الجدول
    rows = rows.filter((r) => !r.line.excluded).concat(rows.filter((r) => r.line.excluded));
  }
  const included = rows.filter((r) => !(r.line && r.line.excluded));
  const sum = (k) => included.reduce((a, r) => a + (r[k] || 0), 0);
  const bank = C.bankRecords(included);
  const nonCard = included.filter((r) => r.emp.payByCard === false && r.net > 0);
  const hasAllow = included.some((r) => r.allowanceTotal);

  const payCell = (r) => {
    if (r.emp.payByCard !== false) return `<span class="badge ok" title="ضمن ملف البنك">بطاقة</span>${r.line.noBank ? ' <span class="badge unknown">خارج الملف</span>' : ''}`;
    const t = r.line.transferred || r.transferred;
    return `<label class="check" title="لمن ليس له بطاقة"><input type="checkbox" data-k="transferred" data-id="${r.emp.id}" ${t ? 'checked' : ''} style="width:auto"> تم التحويل</label>${t ? `<div class="hint">${esc(t)}</div>` : ''}`;
  };

  let lastBranch = null;
  const body = rows.map((r, i) => {
    const e = r.emp, L = r.line || {};
    const ex = !!L.excluded;
    let g = '';
    if (!ex && e.branch !== lastBranch) { lastBranch = e.branch; g = `<tr class="group"><td colspan="17">${esc(branchLabel(e.branch))}</td></tr>`; }
    if (ex && lastBranch !== '__ex') { lastBranch = '__ex'; g = '<tr class="group"><td colspan="17">غير مشمولين في مسير هذا الشهر</td></tr>'; }
    const dis = ex ? 'disabled' : '';
    const baseOther = r.other - (r.bonus || 0) - (r.allowanceTotal || 0);
    const amountCells = closed ? `
        <td class="num">${money(r.basic)}</td><td class="num">${money(r.housing)}</td><td class="num">${money(baseOther)}</td>
        <td class="num">${moneyOrDash(r.allowanceTotal)}</td>
        <td class="num">${r.fixed ? '—' : r.days}</td><td class="num">${moneyOrDash(r.bonus)}</td>
        <td class="num">${moneyOrDash(r.loanTotal)}</td><td class="num">${moneyOrDash(r.extraDed)}</td><td>${esc(r.extraDedNote || '')}</td>` : `
        <td><input type="number" step="0.01" data-k="basic" data-id="${e.id}" value="${inputMoney(r.basic)}" ${dis}></td>
        <td><input type="number" step="0.01" data-k="housing" data-id="${e.id}" value="${inputMoney(r.housing)}" ${dis}></td>
        <td><input type="number" step="0.01" data-k="other" data-id="${e.id}" value="${inputMoney(baseOther)}" ${dis}></td>
        <td class="num" title="${esc((r.allowances || []).map((a) => a.name + ': ' + money(a.amount)).join('\n'))}">${moneyOrDash(r.allowanceTotal)}</td>
        <td>${r.fixed ? '<span class="hint">من الكشف</span>' : `<input type="number" min="0" max="${r.mdays}" data-k="days" data-id="${e.id}" value="${L.days == null || L.days === '' ? '' : L.days}" placeholder="${r.mdays}" style="width:56px" ${dis}>`}</td>
        <td><input type="number" step="0.01" data-k="bonus" data-id="${e.id}" value="${inputMoney(L.bonus)}" ${dis}></td>
        <td><input type="number" step="0.01" data-k="loan" data-id="${e.id}" value="${inputMoney(r.loanTotal)}" ${ex || (!data.loans.some((l) => l.empId === e.id) && !(L.fixed && L.fixed.adv != null)) ? 'disabled' : ''} title="قسط السلف لهذا الشهر"></td>
        <td><input type="number" step="0.01" data-k="extraDed" data-id="${e.id}" value="${inputMoney(r.extraDed)}" ${dis}></td>
        <td><input type="text" class="wide" data-k="extraDedNote" data-id="${e.id}" value="${esc(L.extraDedNote || '')}" placeholder="سبب الخصم" ${dis}></td>`;
    return `${g}<tr class="${ex ? 'muted' : ''}">
      <td>${closed ? i + 1 : `<input type="checkbox" data-k="include" data-id="${e.id}" ${ex ? '' : 'checked'} title="ضمن مسير هذا الشهر" style="width:auto">`}</td>
      <td>${esc(e.empNo)}</td><td>${esc(e.name)}${e.active === false ? ' <span class="badge unknown">موقوف</span>' : ''}${L.fixed && !closed ? ' <span class="badge none" title="مبالغ هذا الشهر مأخوذة من كشف النظام أو معدلة لهذا الشهر فقط">مبالغ الشهر</span>' : ''}</td>
      ${amountCells}
      <td class="num">${money(r.gross)}</td><td class="num">${moneyOrDash(r.deductions)}</td><td class="num"><b>${money(r.net)}</b></td>
      <td>${ex ? '' : payCell(r)}</td>
      <td><button class="btn small" data-slip="${e.id}" ${ex ? 'disabled' : ''}>قسيمة</button></td></tr>`;
  }).join('');

  el.innerHTML = `
    <h1>مسير الرواتب</h1>
    <p class="sub">استورد كشف رواتب النظام أو احسب من ملفات الموظفين، عدّل ما تحتاجه، ثم صدّر ملف البنك واعتمد المسير.</p>
    <div class="toolbar">
      <button class="btn" id="pPrev">→ السابق</button>
      <input type="month" id="pMonth" value="${ym}">
      <button class="btn" id="pNext">التالي ←</button>
      <b style="margin-inline-start:8px">${monthLabel(ym)}</b>
      ${closed ? `<span class="badge closed">معتمد ${esc(run.closedAt || '')}</span>` : '<span class="badge draft">مسودة</span>'}
      ${run.source ? `<span class="badge none" title="${esc(run.source)}">من كشف النظام</span>` : ''}
      <span class="spacer"></span>
      ${closed ? '' : '<button class="btn" id="pImport">استيراد كشف رواتب النظام (PDF)</button>'}
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
      <div class="stat"><div class="label">بدون بطاقة (${nonCard.length}) — تم تحويل ${nonCard.filter((r) => r.line.transferred || r.transferred).length}</div><div class="value">${money(nonCard.reduce((a, r) => a + r.net, 0))}</div></div>
    </div>
    ${hasAllow ? '<div class="alert info">عمود «مستحقات مع الراتب» يأتي من شاشة المستحقات (الأنواع المضبوطة لتُصرف مع الراتب) ويضاف للبدلات الأخرى في ملف البنك.</div>' : ''}
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>الرقم</th><th>الاسم</th><th>الأساسي</th><th>السكن</th><th>بدلات أخرى</th><th class="num">مستحقات مع الراتب</th>
      <th>أيام العمل</th><th>إضافي/مكافأة</th><th>السلف</th><th>خصومات أخرى</th><th>سبب الخصم</th>
      <th class="num">إجمالي الاستحقاق</th><th class="num">الاستقطاع</th><th class="num">الصافي</th><th>الصرف</th><th></th></tr></thead>
      <tbody>${body || '<tr><td colspan="17" class="empty">لا يوجد موظفون</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3">الإجمالي</td><td class="num">${money(sum('basic'))}</td><td class="num">${money(sum('housing'))}</td>
      <td class="num">${money(included.reduce((a, r) => a + r.other - (r.bonus || 0) - (r.allowanceTotal || 0), 0))}</td><td class="num">${moneyOrDash(sum('allowanceTotal'))}</td>
      <td></td><td class="num">${moneyOrDash(sum('bonus'))}</td><td class="num">${moneyOrDash(sum('loanTotal'))}</td><td class="num">${moneyOrDash(sum('extraDed'))}</td><td></td>
      <td class="num">${money(sum('gross'))}</td><td class="num">${money(sum('deductions'))}</td><td class="num">${money(sum('net'))}</td><td></td><td></td></tr></tfoot>
    </table></div>
    <div class="card" style="margin-top:16px"><h2>المرفقات (الكشف الموقّع وغيره)</h2><div id="pAttach"></div></div>`;

  renderAttachments($('#pAttach', el), () => getRun(ym, true), `رواتب/${ym}`);
  $('#pMonth', el).onchange = (ev) => { if (ev.target.value) { ui.month = ev.target.value; render(); } };
  $('#pPrev', el).onclick = () => { ui.month = shiftMonth(ym, -1); render(); };
  $('#pNext', el).onclick = () => { ui.month = shiftMonth(ym, 1); render(); };
  const pi = $('#pImport', el); if (pi) pi.onclick = importSystemReports;
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
    if (!(await confirmBox('إلغاء اعتماد المسير؟ يصبح مسودة قابلة للتعديل، وتُعاد أقساط السلف لهذا الشهر غير مسددة.', 'إلغاء الاعتماد'))) return;
    const r = data.runs[ym];
    // نحفظ مبالغ الشهر كما كانت حتى لا تتغير بإلغاء الاعتماد
    for (const row of r.snapshot || []) {
      const L = (r.lines[row.emp.id] = r.lines[row.emp.id] || {});
      delete L.loanDeductions;
      if (!L.fixed) L.fixed = { basic: row.basic, housing: row.housing, other: row.other - (row.bonus || 0) - (row.allowanceTotal || 0) };
      if (L.fixed.adv == null && !Object.keys(row.loanDeductions || {}).length && row.loanTotal) L.fixed.adv = row.loanTotal;
    }
    r.status = 'draft';
    delete r.snapshot; delete r.closedAt;
    save(); render(); toast('أصبح المسير مسودة');
  };

  // "تم التحويل" متاح حتى بعد الاعتماد
  $$('input[data-k="transferred"]', el).forEach((inp) => {
    inp.onchange = () => {
      const r = getRun(ym, true);
      const L = (r.lines[inp.dataset.id] = r.lines[inp.dataset.id] || {});
      L.transferred = inp.checked ? today() : '';
      const snap = (r.snapshot || []).find((x) => x.emp.id === inp.dataset.id);
      if (snap) snap.transferred = L.transferred;
      save(); render();
    };
  });
  if (closed) return;
  $$('input[data-k]:not([data-k="transferred"])', el).forEach((inp) => {
    inp.onchange = () => {
      const r = getRun(ym, true);
      const id = inp.dataset.id;
      const L = (r.lines[id] = r.lines[id] || {});
      const k = inp.dataset.k;
      if (k === 'include') L.excluded = !inp.checked;
      else if (k === 'days') L.days = inp.value === '' ? null : Number(inp.value);
      else if (k === 'extraDedNote') L.extraDedNote = inp.value;
      else if (k === 'loan') {
        if (L.fixed && L.fixed.adv != null) { L.fixed.adv = parseMoney(inp.value); delete L.loanOverrides; }
        else setLoanOverride(id, ym, L, parseMoney(inp.value));
      } else if (k === 'extraDed') {
        // خصومات الكشف المستورد + أي خصم يدوي = القيمة المدخلة
        if (L.fixed) L.fixed.otherDed = 0;
        L.extraDed = parseMoney(inp.value);
      } else if (k === 'basic' || k === 'housing' || k === 'other') {
        if (!L.fixed) {
          const cur = C.computeLine(data, empById(id), ym, L);
          L.fixed = { basic: cur.basic, housing: cur.housing, other: cur.other - (cur.bonus || 0) - (cur.allowanceTotal || 0) };
        }
        L.fixed[k] = parseMoney(inp.value);
      } else L[k] = parseMoney(inp.value);
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

// قائمة المشمولين في ملف البنك مع إمكانية إخراج موظف من الملف قبل التصدير
function bankListHtml(items, key) {
  return `<div class="table-wrap" style="max-height:38vh"><table>
    <thead><tr><th>في الملف</th><th>الرقم</th><th>الاسم</th><th>رقم البطاقة</th><th>البطاقة</th><th class="num">المبلغ</th></tr></thead><tbody>
    ${items.map((x) => `<tr class="${x.noBank ? 'muted' : ''}"><td><input type="checkbox" data-${key}="${x.emp.id}" ${x.noBank ? '' : 'checked'} style="width:auto"></td>
      <td>${esc(x.emp.empNo)}</td><td>${esc(x.emp.name)}</td><td>${esc(x.emp.cardNo)}</td><td>${cardBadge(x.emp)}</td><td class="num">${money(x.amount)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">لا يوجد</td></tr>'}
    </tbody></table></div>`;
}

function exportBankDialog(ym) {
  const run = getRun(ym) || {};
  const closed = run.status === 'closed';
  const rows = C.computeRun(data, ym).map((r) => (closed ? { ...r, noBank: !!(run.lines[r.emp.id] || {}).noBank } : r));
  const recs = C.bankRecords(rows);
  const [y, m] = ym.split('-');
  const defDate = run.payDate || (ym === currentMonth() ? today() : `${ym}-${String(C.daysInMonth(ym) - 1).padStart(2, '0')}`);
  const cardRows = rows.filter((r) => r.emp.payByCard !== false && r.net > 0).map((r) => ({ emp: r.emp, amount: r.net, noBank: r.noBank }));
  const box = openModal(`
    <h2>تصدير ملف البنك — ${monthLabel(ym)}</h2>
    <div class="grid2">
      <div class="field"><label>تاريخ التحويل (يظهر داخل الملف)</label><input type="date" id="xDate" value="${defDate}"></div>
      <div class="field"><label>اسم الملف</label><input type="text" id="xName" value="رواتب شهر ${Number(m)}-${y}.txt"></div>
    </div>
    <div class="kv" style="margin:14px 0"><div>عدد البطاقات</div><div><b>${recs.length}</b></div>
      <div>إجمالي المبلغ</div><div><b>${money(recs.reduce((a, r) => a + r.amount, 0))}</b> ريال</div>
      <div>لا يدخلون الملف</div><div>${rows.filter((r) => r.emp.payByCard === false).length} بدون بطاقة (يُسجل لهم «تم التحويل» من جدول المسير)، ${rows.filter((r) => r.emp.payByCard !== false && r.net <= 0).length} بصافي صفر، ${cardRows.filter((x) => x.noBank).length} أخرجتهم من الملف</div></div>
    <p class="sub" style="margin:0 0 6px">راجع القائمة: أزل العلامة لإخراج موظف من الملف. لتعديل راتب موظف عدّله في جدول المسير ثم صدّر مرة أخرى.</p>
    ${bankListHtml(cardRows, 'nobank')}
    <div id="xProblems" style="margin-top:10px"></div>
    ${!closed ? '<label class="check"><input type="checkbox" id="xClose" checked> اعتماد المسير بعد التصدير (لتسجيل أقساط السلف كمسددة)</label>' : ''}
    <div class="modal-actions"><button class="btn primary" id="xGo">تصدير</button><button class="btn" id="xCancel">إلغاء</button></div>`, true);
  $$('[data-nobank]', box).forEach((cb) => (cb.onchange = () => {
    const r = getRun(ym, true);
    const L = (r.lines[cb.dataset.nobank] = r.lines[cb.dataset.nobank] || {});
    L.noBank = !cb.checked;
    save(); render(); exportBankDialog(ym);
  }));
  const check = () => {
    const probs = C.validateRecords(rows, $('#xDate', box).value);
    const errs = probs.filter((p) => p.level === 'error'), warns = probs.filter((p) => p.level === 'warn');
    $('#xProblems', box).innerHTML =
      (errs.length ? `<div class="alert error"><b>يجب تصحيح التالي قبل التصدير (أو أخرج الموظف من الملف):</b><ul>${errs.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : '') +
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
    n(r.basic), n(r.housing), n(r.other), n(r.gross), n(r.loanTotal), n(r.extraDed), n(r.deductions), n(r.net), payLabel(r),
  ].map((v, i) => (i === 3 || i === 4 ? v : q(v))).join(',')));
  const bytes = new TextEncoder().encode('﻿' + lines.join('\r\n'));
  bridge.saveFile(`مسير رواتب ${ym}.csv`, bytes, [{ name: 'Excel CSV', extensions: ['csv'] }]).then((p) => p && toast('تم الحفظ: ' + p));
}

// ---------- الكشوفات (طباعة / PDF) ----------
function payLabel(r) {
  if (r.emp.payByCard !== false) return r.noBank || (r.line || {}).noBank ? 'خارج ملف البنك' : 'بطاقة';
  return r.transferred || (r.line || {}).transferred ? 'تم التحويل' : 'تحويل';
}
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
      ${keys.map((k) => `<td class="n">${r[k] ? money(r[k]) : ''}</td>`).join('')}<td>${payLabel(r)}</td></tr>`).join('')}
    <tr class="t"><td colspan="4">إجمالي الفرع ${esc(g.branch || '')}</td>${tot(g.rows)}<td></td></tr>`).join('');
  return reportShell(`مسير رواتب ${ym}`, `${reportHead(`كشف مسير رواتب شهر ${monthLabel(ym)}`)}
    <table><thead><tr><th>م</th><th>الرقم</th><th>اسم الموظف</th><th class="n">الأيام</th><th class="n">الأساسي</th><th class="n">بدل السكن</th><th class="n">بدلات أخرى</th>
    <th class="n">إجمالي الاستحقاق</th><th class="n">السلف</th><th class="n">خصومات أخرى</th><th class="n">إجمالي الاستقطاع</th><th class="n">صافي الراتب</th><th>الصرف</th></tr></thead>
    <tbody>${body}<tr class="gt"><td colspan="4">الإجمالي الكلي (${rows.length} موظف)</td>${tot(rows)}<td></td></tr></tbody></table>
    <div class="sign"><div>المحاسب</div><div>المدير المالي</div><div>مدير العمليات</div><div>المدير العام</div></div>`, true);
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
        <tr><td>بدلات أخرى</td><td class="n">${money(r.other - (r.bonus || 0) - (r.allowanceTotal || 0))}</td></tr>
        ${(r.allowances || []).map((a) => `<tr><td>${esc(a.name)}${a.days != null ? ` (${a.days} يوم)` : ''}</td><td class="n">${money(a.amount)}</td></tr>`).join('')}
        ${r.bonus ? `<tr><td>إضافي / مكافأة</td><td class="n">${money(r.bonus)}</td></tr>` : ''}
        <tr class="t"><td>إجمالي الاستحقاق</td><td class="n">${money(r.gross)}</td></tr></table>
      <table><tr><th style="width:50%">الاستقطاعات</th><th class="n">المبلغ</th></tr>
        ${loanLines}
        ${r.extraDed ? `<tr><td>خصم${note ? ' - ' + esc(note) : ''}</td><td class="n">${money(r.extraDed)}</td></tr>` : ''}
        ${!loanLines && !r.extraDed ? '<tr><td colspan="2" class="muted">لا يوجد</td></tr>' : ''}
        <tr class="t"><td>إجمالي الاستقطاع</td><td class="n">${money(r.deductions)}</td></tr></table>
      <div class="net">صافي الراتب: ${money(r.net)} ريال${e.payByCard === false ? ` — ${r.transferred || (r.line || {}).transferred ? 'تم التحويل' : 'لم يتم التحويل بعد'}` : ''}</div>
      ${(() => { const sep = C.computeAllowances(data, e, ym).filter((a) => a.payWith !== 'salary' && a.amount > 0); return sep.length ? `<table><tr><th style="width:50%">مستحقات أخرى تُصرف منفصلة هذا الشهر</th><th class="n">المبلغ</th></tr>
        ${sep.map((a) => `<tr><td>${esc(a.name)}${a.days != null ? ` (${a.days} يوم)` : ''}${a.note ? ' - ' + esc(a.note) : ''}</td><td class="n">${money(a.amount)}</td></tr>`).join('')}
        <tr class="t"><td>الإجمالي</td><td class="n">${money(sep.reduce((x, a) => x + a.amount, 0))}</td></tr></table>` : ''; })()}
      ${loansLeft ? `<p class="muted">رصيد السلف المتبقي: ${money(loansLeft)} ريال</p>` : ''}
      <div class="sign"><div>توقيع الموظف</div><div>المحاسب</div></div></div>`;
  }).join('');
  return reportShell(`قسائم رواتب ${ym}`, slips || '<p>لا توجد بيانات</p>');
}

function employeeStatementHtml(empId, from, to) {
  const e = empById(empId);
  const months = Object.keys(data.runs).filter((ym) => ym >= from && ym <= to).sort();
  if (to === currentMonth() && !months.includes(to) && from <= to) months.push(to);
  const rows = months.map((ym) => ({ ym, r: C.computeRun(data, ym).find((x) => x.emp.id === empId), st: (data.runs[ym] || {}).status })).filter((x) => x.r)
    .map((x) => ({ ...x, sep: C.computeAllowances(data, x.r.emp, x.ym).filter((a) => a.payWith !== 'salary').reduce((a, b) => a + b.amount, 0) }));
  const keys = ['basic', 'housing', 'other', 'gross', 'loanTotal', 'extraDed', 'deductions', 'net'];
  const loans = data.loans.filter((l) => l.empId === empId);
  return reportShell(`كشف ${e.name}`, `${reportHead('كشف رواتب موظف')}
    <table><tr><th>الرقم الوظيفي</th><td>${esc(e.empNo)}</td><th>الاسم</th><td>${esc(e.name)}</td><th>الفرع</th><td>${esc(branchLabel(e.branch))}</td></tr>
    <tr><th>رقم الهوية</th><td>${esc(e.nationalId)}</td><th>بطاقة الراتب</th><td>${esc(e.cardNo || '—')}</td><th>انتهاء البطاقة</th><td>${esc(e.cardExpiry || '—')}</td></tr></table>
    <p class="muted">الفترة: من ${monthLabel(from)} إلى ${monthLabel(to)}</p>
    <table><thead><tr><th>الشهر</th><th class="n">الأيام</th><th class="n">الأساسي</th><th class="n">السكن</th><th class="n">بدلات أخرى</th><th class="n">إجمالي الاستحقاق</th>
    <th class="n">السلف</th><th class="n">خصومات أخرى</th><th class="n">إجمالي الاستقطاع</th><th class="n">الصافي</th><th class="n">مستحقات منفصلة</th><th>الحالة</th></tr></thead><tbody>
    ${rows.map(({ ym, r, st, sep }) => `<tr><td>${monthLabel(ym)}</td><td class="n">${r.days}</td>${keys.map((k) => `<td class="n">${r[k] ? money(r[k]) : ''}</td>`).join('')}<td class="n">${sep ? money(sep) : ''}</td><td>${st === 'closed' ? 'معتمد' : 'مسودة'}</td></tr>`).join('') || '<tr><td colspan="12">لا توجد مسيرات في هذه الفترة</td></tr>'}
    <tr class="gt"><td colspan="2">الإجمالي</td>${keys.map((k) => `<td class="n">${money(rows.reduce((a, x) => a + (x.r[k] || 0), 0))}</td>`).join('')}<td class="n">${money(rows.reduce((a, x) => a + x.sep, 0))}</td><td></td></tr></tbody></table>
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
    <div class="toolbar"><button class="btn primary" id="rSys">استيراد كشوفات رواتب النظام (PDF)</button><button class="btn" id="rImport">استيراد مسير شهر سابق من ملف البنك (txt)</button>
      <span class="sub" style="margin:0">لإضافة الشهور السابقة للأرشيف والكشوفات</span></div>
    <div class="card"><h2>المسيرات الشهرية</h2>
      <div class="table-wrap"><table><thead><tr><th>الشهر</th><th>الحالة</th><th class="num">عدد الموظفين</th><th class="num">إجمالي الاستحقاق</th><th class="num">الاستقطاع</th><th class="num">الصافي</th><th></th></tr></thead><tbody>
      ${months.map((ym) => {
        const rows = C.computeRun(data, ym);
        const s = (k) => rows.reduce((a, r) => a + r[k], 0);
        const st = (data.runs[ym] || {}).status;
        const src = (data.runs[ym] || {}).source;
        return `<tr><td>${monthLabel(ym)}${src ? `<div class="hint">${esc(src)}</div>` : ''}</td><td>${st === 'closed' ? '<span class="badge closed">معتمد</span>' : '<span class="badge draft">مسودة</span>'}</td>
        <td class="num">${rows.length}</td><td class="num">${money(s('gross'))}</td><td class="num">${money(s('deductions'))}</td><td class="num">${money(s('net'))}</td>
        <td><div class="row-actions"><button class="btn small" data-sheet="${ym}">كشف المسير</button><button class="btn small" data-slips="${ym}">قسائم الرواتب</button><button class="btn small" data-open="${ym}">فتح</button></div></td></tr>`;
      }).join('')}</tbody></table></div></div>
    <div class="card"><h2>كشف موظف (شهر بشهر)</h2>
      <div class="toolbar"><select id="rEmp" style="min-width:320px">${emps.map((e) => `<option value="${e.id}">${esc(e.empNo)} - ${esc(e.name)}</option>`).join('')}</select>
      <button class="btn primary" id="rStmt">عرض الكشف</button></div></div>`;
  $$('[data-sheet]', el).forEach((b) => (b.onclick = () => showReport(payrollSheetHtml(b.dataset.sheet), `مسير رواتب ${b.dataset.sheet}.pdf`, true)));
  $$('[data-slips]', el).forEach((b) => (b.onclick = () => showReport(payslipsHtml(b.dataset.slips), `قسائم رواتب ${b.dataset.slips}.pdf`)));
  $$('[data-open]', el).forEach((b) => (b.onclick = () => { ui.month = b.dataset.open; go('payroll'); }));
  $('#rImport', el).onclick = importPastRun;
  $('#rSys', el).onclick = importSystemReports;
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
    <div class="card"><h2>أنواع المستحقات</h2>
      <p class="sub">بدلات الطعام والمكافآت الدورية والأوفر تايم... حدد لكل نوع طريقة الحساب والتكرار والمشمولين، وتظهر في صفحة «المستحقات» كل شهر.</p>
      ${allowanceTypes().length ? `<table><thead><tr><th>الاسم</th><th>الحساب</th><th>المبلغ</th><th>التكرار</th><th>يشمل</th><th>الصرف</th><th>المشمولون</th><th></th></tr></thead><tbody>
      ${allowanceTypes().map((t, i) => `<tr class="${t.active === false ? 'muted' : ''}"><td>${esc(t.name)}</td><td>${KIND_LABELS[t.kind] || ''}</td>
        <td class="num">${t.kind === 'manual' ? '-' : money(t.amount) + (t.kind === 'daily' ? ' / يوم' : '')}</td><td>${t.kind === 'fixed' ? FREQ_LABELS[t.frequency || 'monthly'] : 'شهري'}</td>
        <td>${t.scope === 'branches' ? 'فروع: ' + esc((t.branches || []).join('، ')) : t.scope === 'employees' ? 'موظفون محددون' : 'الكل'}</td>
        <td>${t.payWith === 'salary' ? 'مع الراتب' : 'منفصل'}</td><td>${data.employees.filter((e) => e.active !== false && C.allowanceApplies(t, e)).length}</td>
        <td><button class="btn small" data-atedit="${i}">تعديل</button></td></tr>`).join('')}</tbody></table>` : '<p class="sub">لا توجد أنواع بعد. مثال: «بدل فطور» مبلغ ثابت 90 شهرياً، «بدل غداء» باليوم 10 ريال، «أوفر تايم» إدخال يدوي.</p>'}
      <button class="btn primary" id="atAdd" style="margin-top:8px">+ نوع مستحق</button>
    </div>
    <div class="card"><h2>الاستيراد</h2>
      <div class="toolbar" style="margin:0">
        <button class="btn primary" id="dSysPdf">استيراد كشوفات رواتب النظام (PDF) — للشهر الحالي أو شهور وسنين سابقة</button>
        <button class="btn" id="dCards">تحديث البطاقات من ملف البنك (Excel)</button>
      </div>
    </div>
    <div class="card"><h2>البيانات</h2>
      <p class="sub">تُحفظ البيانات تلقائياً في مجلد "المستندات\\برنامج الرواتب" مع نسخة احتياطية يومية.</p>
      <div class="toolbar">
        <button class="btn" id="dFolder">فتح مجلد البيانات</button>
        <button class="btn" id="dBackup">حفظ نسخة احتياطية</button>
        <button class="btn" id="dRestore">استعادة نسخة احتياطية</button>
        <button class="btn primary" id="dImport">استيراد الموظفين من ملف بنك سابق (txt)</button>
        <button class="btn" id="dImportRun">استيراد مسير شهر سابق (txt)</button>
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
  $('#dImportRun', el).onclick = importPastRun;
  $('#dSysPdf', el).onclick = importSystemReports;
  $('#dCards', el).onclick = importCardsFile;
  $('#atAdd', el).onclick = () => allowanceTypeForm(null);
  $$('[data-atedit]', el).forEach((b) => (b.onclick = () => allowanceTypeForm(allowanceTypes()[b.dataset.atedit])));
};

// استيراد مسير شهر سابق من ملف البنك كمسير معتمد (أرشيف)
async function importPastRun() {
  const f = await bridge.openFile([{ name: 'ملف البنك', extensions: ['txt'] }]);
  if (!f) return;
  let rows;
  try { rows = C.parseBankFile(f.bytes); } catch (err) { toast('تعذر قراءة الملف: ' + err.message, 6000); return; }
  if (!rows.length) { toast('الملف فارغ'); return; }
  const d = rows[0].valueDate;
  const guess = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : currentMonth();
  const unknown = rows.filter((r) => !data.employees.some((e) => e.empNo === r.empNo)).length;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const box = openModal(`<h2>استيراد مسير من ${esc(f.name)}</h2>
    <div class="grid2"><div class="field"><label>شهر المسير</label><input type="month" id="pmMonth" value="${guess}">
      <span class="hint">تم تحديده من تاريخ التحويل داخل الملف (${esc(d)})</span></div></div>
    <div class="kv" style="margin:14px 0"><div>عدد الموظفين</div><div><b>${rows.length}</b></div>
      <div>إجمالي المبلغ</div><div><b>${money(total)}</b> ريال</div>
      <div>غير موجودين في البرنامج</div><div>${unknown} ${unknown ? '(سيضافون كموظفين موقوفين، فعّلهم إن كانوا على رأس العمل)' : ''}</div></div>
    <div id="pmWarn"></div>
    <p class="sub">يُحفظ المسير معتمداً كما هو في الملف (الأساسي والبدلات والاستقطاع والصافي). الموظفون الذين صُرف لهم بغير البطاقة لا يكونون في ملف البنك.</p>
    <div class="modal-actions"><button class="btn primary" id="pmGo">استيراد</button><button class="btn" id="pmCancel">إلغاء</button></div>`);
  const warn = () => {
    const ym = $('#pmMonth', box).value;
    const r = data.runs[ym];
    $('#pmWarn', box).innerHTML = r ? `<div class="alert warn">يوجد مسير ${r.status === 'closed' ? 'معتمد' : 'مسودة'} لشهر ${monthLabel(ym)} وسيتم استبداله.</div>` : '';
  };
  $('#pmMonth', box).onchange = warn; warn();
  $('#pmCancel', box).onclick = closeModal;
  $('#pmGo', box).onclick = () => {
    const ym = $('#pmMonth', box).value;
    if (!ym) return;
    const { snapshot, added } = C.runFromBankFile(data, rows, ym, uid);
    data.employees.push(...added);
    data.runs[ym] = { status: 'closed', closedAt: today(), payDate: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, importedFrom: f.name, lines: {}, snapshot };
    save(); closeModal(); render();
    toast(`تم استيراد مسير ${monthLabel(ym)}: ${rows.length} موظف${added.length ? `، وأضيف ${added.length} موظف موقوف` : ''}`, 6000);
  };
}

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

// ---------- المرفقات ----------
// getOwner: دالة تعيد الكائن الذي يحمل قائمة attachments
function renderAttachments(box, getOwner, folder) {
  const draw = () => {
    const list = (getOwner().attachments || []);
    box.innerHTML = `${list.length ? `<table><tbody>${list.map((a, i) => `<tr><td>📎 ${esc(a.name)}</td><td class="hint">${esc(a.addedAt || '')}</td>
      <td><div class="row-actions"><button class="btn small" data-aopen="${i}">فتح</button><button class="btn small danger" data-adel="${i}">حذف</button></div></td></tr>`).join('')}</tbody></table>`
      : '<p class="sub" style="margin:0 0 8px">لا توجد مرفقات. يمكنك إرفاق الكشف الموقّع من الإدارة (PDF أو صورة).</p>'}
      <button class="btn small" data-aadd>+ إرفاق ملف</button>`;
    $('[data-aadd]', box).onclick = async () => {
      if (!bridge.addAttachments) { toast('الإرفاق متاح في نسخة سطح المكتب'); return; }
      const added = await bridge.addAttachments(folder);
      if (!added.length) return;
      const o = getOwner();
      o.attachments = (o.attachments || []).concat(added);
      save(); draw(); toast('تم إرفاق الملف');
    };
    $$('[data-aopen]', box).forEach((b) => (b.onclick = () => bridge.openAttachment && bridge.openAttachment(list[b.dataset.aopen].rel)));
    $$('[data-adel]', box).forEach((b) => (b.onclick = async () => {
      const a = list[b.dataset.adel];
      if (!(await confirmBox(`حذف المرفق ${esc(a.name)}؟`, 'حذف'))) return;
      if (bridge.removeAttachment) await bridge.removeAttachment(a.rel);
      const o = getOwner();
      o.attachments = o.attachments.filter((x) => x !== a);
      save(); render();
    }));
  };
  draw();
}

// ---------- استيراد كشف رواتب النظام (PDF) ----------
async function importSystemReports() {
  if (!bridge.extractPdf) { toast('استيراد PDF متاح في نسخة سطح المكتب'); return; }
  const files = await bridge.openFiles([{ name: 'كشف رواتب النظام', extensions: ['pdf'] }]);
  if (!files.length) return;
  const parsed = [];
  for (const f of files) {
    try {
      const rep = C.parseSystemReport(await bridge.extractPdf(f.bytes));
      if (rep.months.length !== 1) throw new Error(rep.months.length ? 'الكشف يحتوي أكثر من شهر' : 'لم يتم التعرف على شهر الكشف');
      parsed.push({ file: f.name, ym: rep.months[0], rep });
    } catch (err) {
      parsed.push({ file: f.name, error: err.message });
    }
  }
  const ok = parsed.filter((p) => !p.error).sort((a, b) => a.ym.localeCompare(b.ym));
  const latest = ok.length ? ok[ok.length - 1].ym : '';
  const cur = currentMonth();
  const box = openModal(`<h2>استيراد كشوفات رواتب النظام</h2>
    <div class="table-wrap"><table><thead><tr><th>الملف</th><th>الشهر</th><th class="num">الموظفين</th><th class="num">صافي الرواتب</th><th>مطابقة الإجمالي</th><th>جدد</th><th>الشهر في البرنامج</th><th>يُحفظ كـ</th></tr></thead><tbody>
    ${parsed.map((p, i) => p.error ? `<tr><td>${esc(p.file)}</td><td colspan="7" style="color:var(--danger)">${esc(p.error)}</td></tr>` : (() => {
      const nw = p.rep.rows.filter((r) => !data.employees.some((e) => e.empNo === r.empNo)).length;
      const run = data.runs[p.ym];
      const matchTotal = p.rep.reportTotal == null ? '—' : p.rep.reportTotal === p.rep.total ? '<span class="badge ok">مطابق</span>' : '<span class="badge expired">غير مطابق</span>';
      return `<tr><td>${esc(p.file)}</td><td>${monthLabel(p.ym)}</td><td class="num">${p.rep.rows.length}</td><td class="num">${money(p.rep.total)}</td><td>${matchTotal}</td><td>${nw || '-'}</td>
        <td>${run ? (run.status === 'closed' ? 'معتمد (سيُستبدل)' : 'مسودة (ستُستبدل)') : 'جديد'}</td>
        <td><select data-mode="${i}"><option value="draft" ${p.ym >= cur ? 'selected' : ''}>مسودة للمراجعة والتصدير</option><option value="archive" ${p.ym < cur ? 'selected' : ''}>أرشيف معتمد</option></select></td></tr>`;
    })()).join('')}
    </tbody></table></div>
    ${ok.some((p) => p.rep.problems.length) ? `<div class="alert warn" style="margin-top:10px"><b>ملاحظات على القراءة:</b><ul>${ok.flatMap((p) => p.rep.problems.map((x) => `<li>${monthLabel(p.ym)}: ${esc(x)}</li>`)).join('')}</ul></div>` : ''}
    <div style="margin-top:12px">
      <label class="check"><input type="checkbox" id="sysNew" checked> إضافة الموظفين غير الموجودين في البرنامج (بدون بطاقة حتى تضيف رقم البطاقة)</label>
      <label class="check"><input type="checkbox" id="sysProfile"> تحديث رواتب ملفات الموظفين (الأساسي والبدلات) من أحدث كشف</label>
    </div>
    <p class="sub">الموظفون الموجودون في البرنامج وغير موجودين في كشف الشهر يُستبعدون من مسير ذلك الشهر. السلف في الكشف تُخصم من أرصدة السلف المسجلة في البرنامج إن وجدت.</p>
    <div class="modal-actions"><button class="btn primary" id="sysGo" ${ok.length ? '' : 'disabled'}>استيراد</button><button class="btn" id="sysCancel">إلغاء</button></div>`, true);
  $('#sysCancel', box).onclick = closeModal;
  $('#sysGo', box).onclick = () => {
    const addNew = $('#sysNew', box).checked, upd = $('#sysProfile', box).checked;
    let added = 0;
    for (const p of ok) {
      const mode = $(`[data-mode="${parsed.indexOf(p)}"]`, box).value;
      for (const [code, name] of Object.entries(p.rep.branches)) {
        if (!data.branches.some((b) => b.code === code)) data.branches.push({ code, name });
      }
      const lines = {};
      const seen = new Set();
      for (const r of p.rep.rows) {
        let emp = data.employees.find((e) => e.empNo === r.empNo);
        if (!emp) {
          if (!addNew) continue;
          emp = { id: uid(), empNo: r.empNo, name: r.name, nationalId: '', branch: r.branch, cardNo: '', cardExpiry: '', payByCard: false,
            active: p.ym === latest || p.ym >= cur, basic: r.basic, housing: r.housing, other: r.other, mobile: '', notes: `أضيف من كشف النظام ${p.ym}` };
          data.employees.push(emp); added++;
        }
        if (r.branch && !emp.branch) emp.branch = r.branch;
        if (upd && p.ym === latest) Object.assign(emp, { basic: r.basic, housing: r.housing, other: r.other, branch: r.branch || emp.branch });
        seen.add(emp.id);
        lines[emp.id] = { fixed: { basic: r.basic, housing: r.housing, other: r.other, adv: r.adv, otherDed: r.ded - r.adv }, ...(mode === 'archive' ? { noAllowances: true } : {}) };
      }
      for (const e of data.employees) if (!seen.has(e.id)) lines[e.id] = { excluded: true };
      const old = data.runs[p.ym] || {};
      data.runs[p.ym] = { status: 'draft', payDate: old.payDate || '', lines, source: p.file, attachments: old.attachments || [] };
      if (mode === 'archive') closeRun(p.ym);
    }
    save(); closeModal();
    if (ok.length === 1 || latest >= cur) ui.month = latest;
    go('payroll');
    toast(`تم استيراد ${ok.length} كشف${added ? ` وإضافة ${added} موظف جديد (أكمل رقم الهوية والبطاقة من ملف الموظف)` : ''}`, 7000);
  };
}

// ---------- ملف بطاقات الرواتب (Excel من البنك) ----------
async function importCardsFile() {
  if (!bridge.readXlsx) { toast('متاح في نسخة سطح المكتب'); return; }
  const f = await bridge.openFile([{ name: 'ملف البطاقات', extensions: ['xlsx'] }]);
  if (!f) return;
  let cards;
  try { cards = C.parseCardsSheet(await bridge.readXlsx(f.bytes)); } catch (err) { toast('تعذر قراءة الملف: ' + err.message, 6000); return; }
  // عند تكرار الموظف نأخذ البطاقة الأحدث انتهاءً
  const byEmp = new Map(), unknown = [];
  for (const c of cards) {
    const e = C.matchCard(data.employees, c);
    if (!e) { unknown.push(c); continue; }
    const prev = byEmp.get(e.id);
    if (!prev || (c.cardNo === e.cardNo) || (!prev.c.expiry || (c.expiry && c.expiry > prev.c.expiry)) && prev.c.cardNo !== e.cardNo) byEmp.set(e.id, { e, c });
  }
  const changes = [...byEmp.values()];
  const cardChanges = changes.filter(({ e, c }) => e.cardNo !== c.cardNo);
  const missing = data.employees.filter((e) => e.active !== false && e.payByCard !== false && !cards.some((c) => c.cardNo === e.cardNo));
  const box = openModal(`<h2>تحديث البطاقات من ${esc(f.name)}</h2>
    <div class="kv" style="margin-bottom:12px"><div>عدد البطاقات في الملف</div><div><b>${cards.length}</b></div>
      <div>مطابقة لموظفين</div><div>${changes.length}</div><div>تواريخ انتهاء في الملف</div><div>${cards.some((c) => c.expiry) ? 'نعم، سيتم تحديثها' : 'لا يوجد عمود تاريخ انتهاء'}</div></div>
    ${cardChanges.length ? `<h3>أرقام بطاقات مختلفة عن البرنامج</h3><div class="table-wrap" style="max-height:30vh"><table><thead><tr><th>تحديث</th><th>الموظف</th><th>البطاقة في البرنامج</th><th>البطاقة في الملف</th><th>الانتهاء</th><th>الحالة</th></tr></thead><tbody>
      ${cardChanges.map(({ e, c }, i) => `<tr><td><input type="checkbox" data-cc="${i}" ${!e.cardNo ? 'checked' : ''} style="width:auto"></td><td>${esc(e.empNo)} - ${esc(e.name)}</td><td>${esc(e.cardNo || '—')}</td><td>${esc(c.cardNo)}</td><td>${esc(c.expiry || '—')}</td><td>${esc(c.status)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="alert info">أرقام البطاقات في الملف مطابقة للبرنامج.</div>'}
    ${missing.length ? `<div class="alert warn" style="margin-top:10px"><b>موظفون على بطاقات وبطاقاتهم غير موجودة في الملف (ربما أُقفلت):</b><ul>${missing.map((e) => `<li>${esc(e.empNo)} - ${esc(e.name)} (${esc(e.cardNo)})</li>`).join('')}</ul></div>` : ''}
    ${unknown.length ? `<div class="alert info"><b>بطاقات لموظفين غير موجودين في البرنامج:</b><ul>${unknown.map((c) => `<li>${esc(c.empNo)} - ${esc(c.name)} (${esc(c.cardNo)})</li>`).join('')}</ul></div>` : ''}
    <div class="modal-actions"><button class="btn primary" id="cdGo">تحديث</button><button class="btn" id="cdCancel">إلغاء</button></div>`, true);
  $('#cdCancel', box).onclick = closeModal;
  $('#cdGo', box).onclick = () => {
    let n = 0;
    for (const { e, c } of changes) {
      const i = cardChanges.findIndex((x) => x.e === e);
      const takeCard = i < 0 || $(`[data-cc="${i}"]`, box).checked;
      if (!takeCard) continue;
      // لا يدخل ملف البنك إلا إذا اكتمل رقم الهوية
      if (e.cardNo !== c.cardNo) { e.cardNo = c.cardNo; if (String(e.nationalId || '').length === 10) e.payByCard = true; }
      if (c.expiry) e.cardExpiry = c.expiry;
      e.cardStatus = c.status;
      e.cardBalance = c.balance;
      n++;
    }
    save(); closeModal(); render();
    toast(`تم تحديث بيانات ${n} بطاقة`);
  };
}

// ---------- المستحقات الأخرى ----------
const KIND_LABELS = { fixed: 'مبلغ ثابت', daily: 'باليوم', manual: 'إدخال يدوي كل شهر' };
const FREQ_LABELS = { monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', annual: 'سنوي' };
const allowanceTypes = () => (data.settings.allowanceTypes = data.settings.allowanceTypes || []);
function getAllowRun(ym, create) {
  data.allowanceRuns = data.allowanceRuns || {};
  if (!data.allowanceRuns[ym] && create) data.allowanceRuns[ym] = { lines: {}, attachments: {} };
  return data.allowanceRuns[ym];
}

// كل موظف نشط ومستحقاته في نوع معين لشهر معين
function allowanceRowsFor(type, ym) {
  const run = getAllowRun(ym) || { lines: {} };
  const L = (run.lines || {})[type.id] || {};
  return C.sortEmployees(data.employees.filter((e) => e.active !== false && C.allowanceApplies(type, e))).map((emp) => {
    const line = L[emp.id] || {};
    const a = line.excluded ? null : C.computeAllowances({ ...data, settings: { ...data.settings, allowanceTypes: [type] } }, emp, ym)[0];
    return { emp, line, amount: a ? a.amount : 0, days: a ? a.days : null, rate: a ? a.rate : null, excluded: !!line.excluded, noBank: !!line.noBank, transferred: line.transferred || '' };
  });
}

views.allowances = (el) => {
  const ym = ui.month;
  const types = allowanceTypes().filter((t) => t.active !== false);
  if (!types.length) {
    el.innerHTML = `<h1>المستحقات</h1><p class="sub">بدلات الطعام والمكافآت الدورية والأوفر تايم وغيرها.</p>
      <div class="alert info">لا توجد أنواع مستحقات بعد. أضفها من <a href="#" id="goSet">الفروع والإعدادات ← أنواع المستحقات</a>، وحدد لكل نوع طريقة الحساب والموظفين أو الفروع المشمولين.</div>`;
    $('#goSet', el).onclick = (ev) => { ev.preventDefault(); go('settings'); };
    return;
  }
  if (!ui.allowTab || (ui.allowTab !== 'all' && !types.some((t) => t.id === ui.allowTab))) ui.allowTab = types[0].id;
  const due = types.filter((t) => C.allowanceDue(t, ym));
  const tabs = `<div class="tabs">${types.map((t) => `<button class="tab ${ui.allowTab === t.id ? 'active' : ''}" data-tab="${t.id}">${esc(t.name)}${C.allowanceDue(t, ym) ? '' : ' <span class="hint">(غير مستحق هذا الشهر)</span>'}</button>`).join('')}
    <button class="tab ${ui.allowTab === 'all' ? 'active' : ''}" data-tab="all">ملخص الشهر</button></div>`;
  const head = `<h1>المستحقات</h1>
    <p class="sub">المبالغ الثابتة تنزل تلقائياً كل شهر حسب الإعدادات وملف كل موظف، ويمكنك تعديلها لهذا الشهر. الأوفر تايم وما شابهه يُدخل يدوياً.</p>
    <div class="toolbar"><button class="btn" id="aPrev">→ السابق</button><input type="month" id="aMonth" value="${ym}"><button class="btn" id="aNext">التالي ←</button>
    <b style="margin-inline-start:8px">${monthLabel(ym)}</b></div>${tabs}`;

  let content = '';
  if (ui.allowTab === 'all') {
    const emps = C.sortEmployees(data.employees.filter((e) => e.active !== false));
    const matrix = emps.map((e) => ({ e, vals: due.map((t) => { const a = C.computeAllowances({ ...data, settings: { ...data.settings, allowanceTypes: [t] } }, e, ym)[0]; return a ? a.amount : 0; }) }))
      .filter((x) => x.vals.some((v) => v));
    content = `<div class="toolbar"><span class="spacer"></span><button class="btn" id="aAllPdf">طباعة / PDF</button><button class="btn" id="aAllCsv">Excel</button><button class="btn primary" id="aAllBank">ملف بنك لكل المستحقات المنفصلة</button></div>
      <div class="table-wrap"><table><thead><tr><th>الرقم</th><th>الاسم</th>${due.map((t) => `<th class="num">${esc(t.name)}${t.payWith === 'salary' ? '<div class="hint">مع الراتب</div>' : ''}</th>`).join('')}<th class="num">الإجمالي</th></tr></thead><tbody>
      ${matrix.map((x) => `<tr><td>${esc(x.e.empNo)}</td><td>${esc(x.e.name)}</td>${x.vals.map((v) => `<td class="num">${moneyOrDash(v)}</td>`).join('')}<td class="num"><b>${money(x.vals.reduce((a, v) => a + v, 0))}</b></td></tr>`).join('') || `<tr><td colspan="${due.length + 3}" class="empty">لا توجد مستحقات هذا الشهر</td></tr>`}
      </tbody><tfoot><tr><td colspan="2">الإجمالي</td>${due.map((t, i) => `<td class="num">${money(matrix.reduce((a, x) => a + x.vals[i], 0))}</td>`).join('')}<td class="num">${money(matrix.reduce((a, x) => a + x.vals.reduce((b, v) => b + v, 0), 0))}</td></tr></tfoot></table></div>`;
  } else {
    const t = types.find((x) => x.id === ui.allowTab);
    const isDue = C.allowanceDue(t, ym);
    const rows = isDue ? allowanceRowsFor(t, ym) : [];
    const inc = rows.filter((r) => !r.excluded);
    const total = inc.reduce((a, r) => a + r.amount, 0);
    const bankItems = inc.filter((r) => r.emp.payByCard !== false && r.amount > 0);
    content = `<div class="kv" style="margin-bottom:10px"><div>طريقة الحساب</div><div>${KIND_LABELS[t.kind] || ''}${t.kind === 'daily' ? ` — ${money(t.amount)} لليوم` : t.kind === 'fixed' ? ` — ${money(t.amount)} (${FREQ_LABELS[t.frequency || 'monthly']})` : ''}</div>
      <div>الصرف</div><div>${t.payWith === 'salary' ? 'مع راتب الشهر (يظهر في مسير الرواتب ويدخل ملف بنك الرواتب)' : 'منفصل بملف بنك خاص'}</div></div>
      ${!isDue ? '<div class="alert info">هذا النوع غير مستحق في هذا الشهر حسب التكرار المحدد في الإعدادات.</div>' : `
      <div class="toolbar"><span>${inc.length} موظف — الإجمالي <b>${money(total)}</b></span><span class="spacer"></span>
        <button class="btn" id="aPdf">طباعة الكشف / PDF</button><button class="btn" id="aCsv">Excel</button>
        ${t.payWith === 'salary' ? '' : `<button class="btn primary" id="aBank" ${bankItems.length ? '' : 'disabled'}>تصدير ملف البنك (${bankItems.length})</button>`}</div>
      <div class="table-wrap"><table><thead><tr><th></th><th>الرقم</th><th>الاسم</th><th>الفرع</th>${t.kind === 'daily' ? '<th>الأيام</th><th class="num">المعدل</th>' : ''}<th>المبلغ</th><th>ملاحظة</th>${t.payWith === 'salary' ? '' : '<th>الصرف</th>'}</tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.excluded ? 'muted' : ''}"><td><input type="checkbox" data-ak="include" data-id="${r.emp.id}" ${r.excluded ? '' : 'checked'} style="width:auto"></td>
        <td>${esc(r.emp.empNo)}</td><td>${esc(r.emp.name)}</td><td>${esc(branchLabel(r.emp.branch))}</td>
        ${t.kind === 'daily' ? `<td><input type="number" min="0" max="31" data-ak="days" data-id="${r.emp.id}" value="${r.line.days != null ? r.line.days : ''}" placeholder="${r.days != null ? r.days : ''}" style="width:56px" ${r.excluded ? 'disabled' : ''}></td><td class="num">${money(r.rate)}</td>` : ''}
        <td><input type="number" step="0.01" data-ak="amount" data-id="${r.emp.id}" value="${r.line.amount != null ? inputMoney(r.line.amount) : ''}" placeholder="${inputMoney(r.amount) || '0'}" ${r.excluded ? 'disabled' : ''}></td>
        <td><input type="text" class="wide" data-ak="note" data-id="${r.emp.id}" value="${esc(r.line.note || '')}" ${r.excluded ? 'disabled' : ''}></td>
        ${t.payWith === 'salary' ? '' : `<td>${r.excluded ? '' : r.emp.payByCard !== false ? '<span class="badge ok">بطاقة</span>' : `<label class="check"><input type="checkbox" data-ak="transferred" data-id="${r.emp.id}" ${r.transferred ? 'checked' : ''} style="width:auto"> تم التحويل</label>`}</td>`}
      </tr>`).join('') || '<tr><td colspan="9" class="empty">لا يوجد موظفون مشمولون. حدد الموظفين أو الفروع من إعدادات هذا النوع أو من ملف الموظف.</td></tr>'}
      </tbody><tfoot><tr><td colspan="${t.kind === 'daily' ? 6 : 4}">الإجمالي</td><td class="num">${money(total)}</td><td colspan="2"></td></tr></tfoot></table></div>
      <div class="card" style="margin-top:16px"><h2>المرفقات (الكشف الموقّع من الإدارة)</h2><div id="aAttach"></div></div>`}`;
  }
  el.innerHTML = head + content;
  $('#aMonth', el).onchange = (ev) => { if (ev.target.value) { ui.month = ev.target.value; render(); } };
  $('#aPrev', el).onclick = () => { ui.month = shiftMonth(ym, -1); render(); };
  $('#aNext', el).onclick = () => { ui.month = shiftMonth(ym, 1); render(); };
  $$('[data-tab]', el).forEach((b) => (b.onclick = () => { ui.allowTab = b.dataset.tab; render(); }));
  if (ui.allowTab === 'all') {
    $('#aAllPdf', el).onclick = () => showReport(allowanceSheetHtml(ym, null), `مستحقات ${ym}.pdf`, true);
    $('#aAllCsv', el).onclick = () => exportAllowanceCsv(ym, null);
    $('#aAllBank', el).onclick = () => exportAllowanceBank(ym, null);
    return;
  }
  const t = types.find((x) => x.id === ui.allowTab);
  if (!C.allowanceDue(t, ym)) return;
  renderAttachments($('#aAttach', el), () => { const r = getAllowRun(ym, true); r.attachments = r.attachments || {}; return (r.attachments[t.id] = r.attachments[t.id] || {}); }, `مستحقات/${ym}/${t.name}`);
  $('#aPdf', el).onclick = () => showReport(allowanceSheetHtml(ym, t.id), `${t.name} ${ym}.pdf`, true);
  $('#aCsv', el).onclick = () => exportAllowanceCsv(ym, t.id);
  const ab = $('#aBank', el); if (ab) ab.onclick = () => exportAllowanceBank(ym, t.id);
  $$('[data-ak]', el).forEach((inp) => (inp.onchange = () => {
    const run = getAllowRun(ym, true);
    const lines = (run.lines[t.id] = run.lines[t.id] || {});
    const L = (lines[inp.dataset.id] = lines[inp.dataset.id] || {});
    const k = inp.dataset.ak;
    if (k === 'include') L.excluded = !inp.checked;
    else if (k === 'transferred') L.transferred = inp.checked ? today() : '';
    else if (k === 'note') L.note = inp.value;
    else if (k === 'days') { L.days = inp.value === '' ? null : Number(inp.value); delete L.amount; }
    else if (k === 'amount') { if (inp.value === '') delete L.amount; else L.amount = parseMoney(inp.value); }
    save(); render();
  }));
};

// عناصر المستحقات لشهر (لنوع واحد أو كل الأنواع المنفصلة)
function allowanceItems(ym, typeId) {
  const types = allowanceTypes().filter((t) => t.active !== false && C.allowanceDue(t, ym) && (typeId ? t.id === typeId : t.payWith !== 'salary'));
  const byEmp = new Map();
  for (const t of types) {
    for (const r of allowanceRowsFor(t, ym)) {
      if (r.excluded || !r.amount) continue;
      const x = byEmp.get(r.emp.id) || { emp: r.emp, amount: 0, parts: [], noBank: false, transferred: r.transferred };
      x.amount += r.amount;
      x.parts.push({ name: t.name, amount: r.amount, days: r.days, note: r.line.note || '' });
      byEmp.set(r.emp.id, x);
    }
  }
  return { types, items: [...byEmp.values()] };
}

function allowanceSheetHtml(ym, typeId) {
  const { types, items } = allowanceItems(ym, typeId);
  const title = typeId ? `كشف ${types[0] ? types[0].name : ''} — ${monthLabel(ym)}` : `كشف المستحقات الأخرى — ${monthLabel(ym)}`;
  let seq = 0;
  return reportShell(title, `${reportHead(title)}
    <table><thead><tr><th>م</th><th>الرقم</th><th>اسم الموظف</th><th>الفرع</th>${typeId ? '<th>البيان</th>' : types.map((t) => `<th class="n">${esc(t.name)}</th>`).join('')}<th class="n">المبلغ</th><th>الصرف</th><th>توقيع المستلم</th></tr></thead><tbody>
    ${items.map((x) => `<tr><td>${++seq}</td><td>${esc(x.emp.empNo)}</td><td>${esc(x.emp.name)}</td><td>${esc(branchLabel(x.emp.branch))}</td>
      ${typeId ? `<td>${esc(x.parts.map((p) => (p.days != null ? `${p.days} يوم` : '') + (p.note ? ' ' + p.note : '')).join(' ').trim())}</td>` : types.map((t) => { const p = x.parts.find((q) => q.name === t.name); return `<td class="n">${p ? money(p.amount) : ''}</td>`; }).join('')}
      <td class="n">${money(x.amount)}</td><td>${x.emp.payByCard === false ? (x.transferred ? 'تم التحويل' : 'تحويل') : 'بطاقة'}</td><td style="min-width:90px"></td></tr>`).join('')}
    <tr class="gt"><td colspan="${typeId ? 5 : 4 + types.length}">الإجمالي (${items.length} موظف)</td><td class="n">${money(items.reduce((a, x) => a + x.amount, 0))}</td><td colspan="2"></td></tr></tbody></table>
    <div class="sign"><div>المحاسب</div><div>المدير المالي</div><div>مدير العمليات</div><div>المدير العام</div></div>`, true);
}

function exportAllowanceCsv(ym, typeId) {
  const { types, items } = allowanceItems(ym, typeId);
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const n = (h) => C.fromHalalas(h).toFixed(2);
  const head = ['الفرع', 'الرقم الوظيفي', 'الاسم', 'رقم البطاقة', ...types.map((t) => t.name), 'الإجمالي', 'الصرف'];
  const lines = [head.map(q).join(',')].concat(items.map((x) => [q(branchLabel(x.emp.branch)), q(x.emp.empNo), q(x.emp.name), `="${x.emp.cardNo || ''}"`,
    ...types.map((t) => { const p = x.parts.find((z) => z.name === t.name); return q(p ? n(p.amount) : ''); }), q(n(x.amount)), q(x.emp.payByCard === false ? 'تحويل' : 'بطاقة')].join(',')));
  const name = typeId ? `${types[0].name} ${ym}.csv` : `مستحقات ${ym}.csv`;
  bridge.saveFile(name, new TextEncoder().encode('﻿' + lines.join('\r\n')), [{ name: 'Excel CSV', extensions: ['csv'] }]).then((p) => p && toast('تم الحفظ: ' + p));
}

function exportAllowanceBank(ym, typeId) {
  const { types, items } = allowanceItems(ym, typeId);
  const run = getAllowRun(ym, true);
  run.noBank = run.noBank || {};
  const key = typeId || 'all';
  const noBank = (run.noBank[key] = run.noBank[key] || {});
  const list = items.filter((x) => x.emp.payByCard !== false).map((x) => ({ ...x, noBank: !!noBank[x.emp.id] }));
  const recs = C.allowanceBankRecords(list);
  const label = typeId ? types[0].name : 'مستحقات';
  const [y, m] = ym.split('-');
  const box = openModal(`<h2>ملف البنك — ${esc(label)} ${monthLabel(ym)}</h2>
    <div class="grid2"><div class="field"><label>تاريخ التحويل</label><input type="date" id="abDate" value="${today()}"></div>
    <div class="field"><label>اسم الملف</label><input type="text" id="abName" value="${esc(label)} ${Number(m)}-${y}.txt"></div></div>
    <div class="kv" style="margin:12px 0"><div>عدد البطاقات</div><div><b>${recs.length}</b></div><div>الإجمالي</div><div><b>${money(recs.reduce((a, r) => a + r.amount, 0))}</b> ريال</div>
    <div>بدون بطاقة</div><div>${items.filter((x) => x.emp.payByCard === false).length} (يُسجل لهم «تم التحويل» من الجدول)</div></div>
    <p class="sub" style="margin:0 0 6px">المبلغ يوضع في خانة «البدلات الأخرى» في ملف البنك. أزل العلامة لإخراج موظف من الملف.</p>
    ${bankListHtml(list, 'abnb')}
    <div id="abProblems" style="margin-top:10px"></div>
    <div class="modal-actions"><button class="btn primary" id="abGo">تصدير</button><button class="btn" id="abCancel">إلغاء</button></div>`, true);
  $$('[data-abnb]', box).forEach((cb) => (cb.onchange = () => { noBank[cb.dataset.abnb] = !cb.checked; save(); exportAllowanceBank(ym, typeId); }));
  const rowsForCheck = list.map((x) => ({ emp: x.emp, net: x.amount, noBank: x.noBank }));
  const probs = C.validateRecords(rowsForCheck, today()).filter((p) => p.level === 'error');
  $('#abProblems', box).innerHTML = probs.length ? `<div class="alert error"><b>يجب التصحيح قبل التصدير:</b><ul>${probs.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : '';
  $('#abGo', box).disabled = !!probs.length || !recs.length;
  $('#abCancel', box).onclick = closeModal;
  $('#abGo', box).onclick = async () => {
    let bytes;
    try { bytes = C.buildBankFile(recs, $('#abDate', box).value.replace(/-/g, '')); } catch (err) { toast(err.message, 6000); return; }
    const p = await bridge.saveFile($('#abName', box).value, bytes, [{ name: 'ملف البنك', extensions: ['txt'] }]);
    if (!p) return;
    run.exported = run.exported || {};
    run.exported[key] = new Date().toLocaleString('en-GB');
    save(); closeModal(); toast('تم حفظ ملف البنك: ' + p, 6000); bridge.showFile(p);
  };
}

// إعدادات نوع مستحق
function allowanceTypeForm(type) {
  const isNew = !type;
  const t = type || { id: uid(), name: '', kind: 'fixed', amount: 0, days: '', frequency: 'monthly', months: [], scope: 'all', branches: [], payWith: 'separate', active: true };
  const box = openModal(`<h2>${isNew ? 'نوع مستحق جديد' : 'تعديل: ' + esc(t.name)}</h2>
    <div class="grid2">
      <div class="field"><label>الاسم</label><input type="text" id="atName" value="${esc(t.name)}" placeholder="مثال: بدل فطور، بدل غداء، مكافأة ربع سنوية، أوفر تايم"></div>
      <div class="field"><label>طريقة الحساب</label><select id="atKind">${Object.entries(KIND_LABELS).map(([k, l]) => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field" id="atAmountF"><label id="atAmountL">المبلغ الافتراضي</label><input type="number" step="0.01" id="atAmount" value="${inputMoney(t.amount)}"><span class="hint">يمكن تغييره لكل موظف من ملفه</span></div>
      <div class="field" id="atDaysF"><label>عدد الأيام الافتراضي في الشهر</label><input type="number" id="atDays" value="${t.days == null ? '' : t.days}" placeholder="أيام الشهر"><span class="hint">مثلاً 25 أو 26 يوم عمل، ويعدل لكل موظف كل شهر</span></div>
      <div class="field" id="atFreqF"><label>التكرار</label><select id="atFreq">${Object.entries(FREQ_LABELS).map(([k, l]) => `<option value="${k}" ${(t.frequency || 'monthly') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field" id="atMonthsF"><label>أشهر الاستحقاق (اختياري)</label><input type="text" id="atMonths" value="${esc((t.months || []).join(','))}" placeholder="مثال: 3,6,9,12"><span class="hint">إذا تُرك فارغاً: ربعي = 3،6،9،12 — نصف سنوي = 6،12 — سنوي = 12</span></div>
      <div class="field"><label>يشمل</label><select id="atScope"><option value="all" ${t.scope === 'all' ? 'selected' : ''}>كل الموظفين</option><option value="branches" ${t.scope === 'branches' ? 'selected' : ''}>فروع محددة</option><option value="employees" ${t.scope === 'employees' ? 'selected' : ''}>موظفون محددون (من ملف كل موظف)</option></select></div>
      <div class="field"><label>الصرف</label><select id="atPay"><option value="separate" ${t.payWith !== 'salary' ? 'selected' : ''}>منفصل (ملف بنك وكشف خاص)</option><option value="salary" ${t.payWith === 'salary' ? 'selected' : ''}>مع راتب الشهر</option></select></div>
      <div class="field" id="atBranchesF" style="grid-column: span 2"><label>الفروع</label><div style="display:flex;flex-wrap:wrap;gap:8px 16px">${data.branches.map((b) => `<label class="check"><input type="checkbox" data-atb="${esc(b.code)}" ${(t.branches || []).includes(b.code) ? 'checked' : ''} style="width:auto"> ${esc(b.code)} ${esc(b.name)}</label>`).join('')}</div></div>
      <div class="field" id="atEmpsF" style="grid-column: span 2"><label>الموظفون</label><div style="max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px">${C.sortEmployees(data.employees.filter((e) => e.active !== false)).map((e) => { const own = (e.allowances || {})[t.id] || {}; return `<label class="check"><input type="checkbox" data-ate="${e.id}" ${own.enabled ? 'checked' : ''} style="width:auto"> ${esc(e.empNo)} - ${esc(e.name)}</label>`; }).join('')}</div></div>
      <label class="check"><input type="checkbox" id="atActive" ${t.active !== false ? 'checked' : ''} style="width:auto"> فعّال</label>
    </div>
    <div class="modal-actions"><button class="btn primary" id="atSave">حفظ</button><button class="btn" id="atCancel">إلغاء</button>
    ${isNew ? '' : '<span style="flex:1"></span><button class="btn danger" id="atDel">حذف النوع</button>'}</div>`, true);
  const sync = () => {
    const k = $('#atKind', box).value, sc = $('#atScope', box).value;
    $('#atAmountL', box).textContent = k === 'daily' ? 'المعدل لليوم' : k === 'manual' ? 'لا يوجد مبلغ افتراضي (يُدخل كل شهر)' : 'المبلغ الافتراضي';
    $('#atAmount', box).disabled = k === 'manual';
    $('#atDaysF', box).style.display = k === 'daily' ? '' : 'none';
    $('#atFreqF', box).style.display = k === 'fixed' ? '' : 'none';
    $('#atMonthsF', box).style.display = k === 'fixed' && $('#atFreq', box).value !== 'monthly' ? '' : 'none';
    $('#atBranchesF', box).style.display = sc === 'branches' ? '' : 'none';
    $('#atEmpsF', box).style.display = sc === 'employees' ? '' : 'none';
  };
  ['#atKind', '#atScope', '#atFreq'].forEach((s) => ($(s, box).onchange = sync)); sync();
  $('#atCancel', box).onclick = closeModal;
  const del = $('#atDel', box);
  if (del) del.onclick = async () => {
    if (!(await confirmBox(`حذف نوع المستحق ${esc(t.name)}؟ لن تظهر مبالغه في الشهور القادمة.`, 'حذف'))) return;
    data.settings.allowanceTypes = allowanceTypes().filter((x) => x.id !== t.id);
    save(); render();
  };
  $('#atSave', box).onclick = () => {
    const name = $('#atName', box).value.trim();
    if (!name) { toast('أدخل اسم النوع'); return; }
    const kind = $('#atKind', box).value;
    const upd = {
      ...t, name, kind, amount: kind === 'manual' ? 0 : parseMoney($('#atAmount', box).value),
      days: $('#atDays', box).value === '' ? '' : Number($('#atDays', box).value),
      frequency: kind === 'fixed' ? $('#atFreq', box).value : 'monthly',
      months: $('#atMonths', box).value.split(/[,،\s]+/).map(Number).filter((x) => x >= 1 && x <= 12),
      scope: $('#atScope', box).value, branches: $$('[data-atb]', box).filter((c) => c.checked).map((c) => c.dataset.atb),
      payWith: $('#atPay', box).value, active: $('#atActive', box).checked,
    };
    if (upd.scope === 'employees') {
      for (const cb of $$('[data-ate]', box)) {
        const e = empById(cb.dataset.ate);
        e.allowances = e.allowances || {};
        const own = (e.allowances[t.id] = e.allowances[t.id] || {});
        if (cb.checked) own.enabled = true; else delete own.enabled;
      }
    }
    if (isNew) allowanceTypes().push(upd); else Object.assign(t, upd);
    save(); closeModal(); render(); toast('تم حفظ نوع المستحق');
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
