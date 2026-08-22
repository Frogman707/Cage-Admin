/* ============================================================
   Agent Admin — CAGE ADMIN 5.0
   Scoped-down SPA for a single agent (에이전트) to manage only
   their own downline (parentAgent === CURRENT_STAFF.agentCode).
   Shares the same Firestore collections as partner-admin/cage:
   members, memberLedger, partners, memberActionLogs.
   ============================================================ */

let db = null;
let CURRENT_STAFF = null; // {id, pw, name, agentCode, role:'agent'}
let CURRENT_VIEW = 'member';

/* ---------------- icons ---------------- */
const ICONS = {
  dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 19a5 5 0 0 1 6.5-3.2"/></svg>',
  pulse:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
  wallet:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="6" width="19" height="14" rx="2"/><path d="M2.5 10h19"/><circle cx="17" cy="14.5" r="1.2"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
};
function ic(name){ return `<span class="ic">${ICONS[name]||ICONS.doc}</span>`; }

/* ---------------- nav structure — exactly the 6 requested sections ---------------- */
const NAV_GROUPS = [
  {id:'member', labelKey:'navMember', icon:'users', single:true},
  {id:'account', labelKey:'navAccount', icon:'wallet', single:true},
  {id:'betHistory', labelKey:'navBetHistory', icon:'pulse', single:true},
  {id:'settlementReport', labelKey:'navSettlement', icon:'doc', single:true},
  {id:'realtime', labelKey:'navRealtime', icon:'dashboard', single:true},
  {id:'myinfo', labelKey:'navMyInfo', icon:'user', single:true},
];

function buildNav(){
  const nav = document.getElementById('navBar');
  let html = '';
  NAV_GROUPS.forEach(g=>{
    html += `<button class="nav-single" id="navbtn-${g.id}" onclick="switchView('${g.id}')">${ic(g.icon)}<span data-i18n="${g.labelKey}">${t(g.labelKey)}</span></button>`;
  });
  nav.innerHTML = html + `
    <div class="nav-foot">
      Agent Ops<br>CAGE ADMIN 5.0
      <div class="nav-foot-btns">
        <button onclick="confirmSeed()" data-i18n="seedDemoData">${t('seedDemoData')}</button>
      </div>
    </div>`;
}
function setActiveNav(viewId){
  document.querySelectorAll('.nav-single.active').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('navbtn-'+viewId);
  if (btn) btn.classList.add('active');
}

/* ---------------- boot / auth ---------------- */
window.addEventListener('DOMContentLoaded', ()=>{
  db = cageInitFirebase();
  buildNav();
  document.getElementById('loginLangRow').innerHTML = langSwitcherHtml('loginLangSwitch');
  setInterval(()=>{ document.getElementById('clockTxt').textContent = fmtDt(new Date()); }, 1000);
  ensureDefaultStaff();
  document.getElementById('loginId').addEventListener('input', e=>{ e.target.value = e.target.value.toUpperCase(); });
  document.getElementById('loginPw').addEventListener('keydown', e=>{ if (e.key==='Enter') doLogin(); });
  clearLoginInputs();
  setTimeout(clearLoginInputs, 350);
});
function onLangChange(){
  buildNav();
  if (CURRENT_STAFF){ setActiveNav(CURRENT_VIEW); switchView(CURRENT_VIEW); }
}
window.addEventListener('pageshow', clearLoginInputs);
function clearLoginInputs(){
  document.getElementById('loginId').value = '';
  document.getElementById('loginPw').value = '';
  document.getElementById('loginErr').style.display = 'none';
}

async function ensureDefaultStaff(){
  try{
    const snap = await db.collection('agentStaff').limit(1).get();
    if (snap.empty){
      await db.collection('agentStaff').doc('ADMIN').set({id:'ADMIN', pw:'0000', name:'VIP88 에이전트', agentCode:'VIP88', role:'agent', createdAt: new Date().toISOString()});
    } else {
      // One-time self-heal / migration: a site loaded before the ADMIN-doc-id change shipped
      // would have already created the demo staff doc under the old id 'agent' (possibly still
      // carrying the even older SEVIP88 code) - and the emptiness check above only ever fires
      // once, so a stale doc would otherwise never pick this up on its own.
      const legacyDoc = await db.collection('agentStaff').doc('agent').get();
      if (legacyDoc.exists){
        const data = legacyDoc.data();
        await db.collection('agentStaff').doc('ADMIN').set({
          ...data, id:'ADMIN',
          agentCode: data.agentCode === 'SEVIP88' ? 'VIP88' : data.agentCode,
          name: data.agentCode === 'SEVIP88' ? 'VIP88 에이전트' : data.name,
        }, {merge:true});
        await db.collection('agentStaff').doc('agent').delete();
      } else {
        const doc = await db.collection('agentStaff').doc('ADMIN').get();
        if (doc.exists && doc.data().agentCode === 'SEVIP88'){
          await db.collection('agentStaff').doc('ADMIN').set({agentCode:'VIP88', name:'VIP88 에이전트'}, {merge:true});
        }
      }
    }
  }catch(e){ /* offline first load — fine, login falls back to local default below */ }
}

async function doLogin(){
  const id = document.getElementById('loginId').value.trim().toUpperCase() || 'ADMIN';
  const pw = document.getElementById('loginPw').value.trim() || '0000';
  let staff = null;
  try{
    // case-insensitive match: don't rely on the Firestore doc id's exact
    // casing, compare every staff doc's id against the (uppercased) input.
    const snap = await db.collection('agentStaff').get();
    const found = snap.docs.find(d => String(d.id).toUpperCase() === id);
    if (found) staff = found.data();
  }catch(e){}
  if (!staff && id==='ADMIN' && pw==='0000') staff = {id:'ADMIN', name:'VIP88 에이전트', agentCode:'VIP88', role:'agent'};
  if (!staff || String(staff.pw ?? '0000') !== pw){
    document.getElementById('loginErr').style.display='block';
    return;
  }
  document.getElementById('loginErr').style.display='none';
  CURRENT_STAFF = staff;
  document.getElementById('login-gate').style.display='none';
  document.getElementById('topbar').style.display='flex';
  document.getElementById('shell').style.display='flex';
  document.getElementById('staffNameTxt').textContent = `${staff.name || staff.id} (${staff.agentCode})`;
  document.getElementById('hdrLangRow').innerHTML = langSwitcherHtml('hdrLangSwitch');
  switchView('member');
}
function doLogout(){
  CURRENT_STAFF = null;
  document.getElementById('login-gate').style.display='flex';
  document.getElementById('topbar').style.display='none';
  document.getElementById('shell').style.display='none';
  clearLoginInputs();
}

/* ---------------- view router ---------------- */
async function switchView(viewId){
  CURRENT_VIEW = viewId;
  setActiveNav(viewId);
  const main = document.getElementById('mainArea');
  main.innerHTML = `<div class="loading-wrap"><div class="spin"></div></div>`;
  try{
    const fn = VIEW_RENDERERS[viewId] || (()=>`<div class="card"><h3>${t('comingSoon')}</h3></div>`);
    const html = await fn();
    main.innerHTML = html;
  }catch(e){
    console.error(e);
    main.innerHTML = `<div class="card"><h3>${t('errorLabel')}</h3><p style="color:var(--danger);">${escapeHtml(e.message||String(e))}</p></div>`;
  }
}
function pageHead(title, sub){
  return `<h2 class="page-title">${title}</h2>${sub?`<p class="page-sub">${sub}</p>`:''}`;
}
function pill(status, map){
  const cls = (map && map[status]) || 'mute';
  return `<span class="pill ${cls}">${escapeHtml(status??'—')}</span>`;
}

/* ---------------- data access, scoped to CURRENT_STAFF.agentCode ---------------- */
async function fetchAll(coll){
  const snap = await db.collection(coll).get();
  return snap.docs.map(d=>({id:d.id, ...d.data()}));
}
let MEMBER_CACHE = null, BALANCE_CACHE = null, LEDGER_CACHE = null;
function myAgentCode(){ return CURRENT_STAFF?.agentCode; }
async function getMembers(force){
  if (!MEMBER_CACHE || force) MEMBER_CACHE = await fetchAll('members');
  return MEMBER_CACHE.filter(m=>m.parentAgent===myAgentCode());
}
async function getLedger(force){
  if (!LEDGER_CACHE || force) LEDGER_CACHE = await fetchAll('memberLedger');
  return LEDGER_CACHE;
}
async function getBalances(force){
  if (BALANCE_CACHE && !force) return BALANCE_CACHE;
  const rows = await getLedger(force);
  const map = {};
  rows.forEach(r=>{
    const m = map[r.memberId] || (map[r.memberId] = {balance:0, points:0, deposit:0, withdraw:0, bet:0, payout:0});
    if (r.category==='point_earn' || r.category==='point_convert') m.points += Number(r.amount)||0;
    else m.balance += Number(r.amount)||0;
    if (r.category==='deposit') m.deposit += Number(r.amount)||0;
    if (r.category==='withdraw') m.withdraw += Number(r.amount)||0;
    if (r.category==='bet') m.bet += Number(r.amount)||0;
    if (r.category==='payout') m.payout += Number(r.amount)||0;
  });
  BALANCE_CACHE = map;
  return map;
}
function invalidateCaches(){ MEMBER_CACHE=null; BALANCE_CACHE=null; LEDGER_CACHE=null; }
async function myLedger(force){
  const memberIds = new Set((await getMembers(force)).map(m=>m.id));
  return (await getLedger(force)).filter(r=>memberIds.has(r.memberId));
}
function ledgerDate(l){
  const raw = l.clientCreatedAt || l.dt || (l.createdAt && l.createdAt.toDate ? l.createdAt.toDate() : l.createdAt);
  return new Date(raw);
}
function dateInputStr(d){ return d.toISOString().slice(0,10); }
function inRangeFilter(startId, endId){
  const start = document.getElementById(startId).value;
  const end = document.getElementById(endId).value;
  const startD = start ? new Date(start+'T00:00:00') : null;
  const endD = end ? new Date(end+'T23:59:59.999') : null;
  return l => { const d = ledgerDate(l); return (!startD || d>=startD) && (!endD || d<=endD); };
}

/* ============================================================
   회원관리 — 하부 회원 리스트 + 하부회원 생성
   (member doc IS the avatar/speed game login credential — one
   creation covers both game types, per shared/game-engine.js)
   ============================================================ */
async function renderMember(){
  const members = await getMembers(true);
  const balances = await getBalances(true);
  return `
    ${pageHead(t('memberTitle'), t('memberSub'))}
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">${t('statTotalDownline')}</div><div class="val">${members.length}</div></div>
      <div class="stat-card"><div class="lbl">${t('statActive')}</div><div class="val">${members.filter(m=>m.status==='정상').length}</div></div>
      <div class="stat-card"><div class="lbl">${t('statSuspended')}</div><div class="val">${members.filter(m=>m.status==='정지').length}</div></div>
      <div class="stat-card"><div class="lbl">${t('statBalanceSum')}</div><div class="val">${fmtNum(Object.entries(balances).filter(([id])=>members.some(m=>m.id===id)).reduce((s,[,b])=>s+b.balance,0))}</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="field search-box"><input id="memberSearch" placeholder="${t('searchIdNickPh')}" oninput="filterMemberTable(this.value)"></div>
        <div class="toolbar-right"><button class="btn btn-gold btn-sm" onclick="openCreateSubMemberForm()">${t('createSubMemberBtn')}</button></div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>${t('colId')}</th><th>${t('colNick')}</th><th>${t('colPhone')}</th><th>${t('colCasino')}</th><th>${t('colMemberType')}</th><th>${t('colBalance')}</th><th>${t('colJoined')}</th><th>${t('colLastLogin')}</th><th>${t('colStatus')}</th>
      </tr></thead><tbody id="memberBody">
      ${memberRowsHtml(members, balances)}
      </tbody></table></div>
    </div>
  `;
}
function memberRowsHtml(rows, balances){
  return rows.map(m=>`<tr>
    <td>${escapeHtml(m.id)}</td><td>${escapeHtml(m.nickname||'—')}</td><td>${maskPhone(m.phone)}</td>
    <td>${escapeHtml(m.casino||'—')}</td><td>${escapeHtml(m.memberType||'—')}</td>
    <td><span class="num">${fmtNum(balances[m.id]?.balance||0)}</span></td>
    <td>${fmtDate(m.createdAt)}</td><td>${m.lastLoginAt?fmtDt(m.lastLoginAt):'—'}</td><td>${pill(m.status,{정상:'ok',정지:'bad',블랙리스트:'bad'})}</td>
  </tr>`).join('') || `<tr class="empty-row"><td colspan="9">${t('noSubMembers')}</td></tr>`;
}
function filterMemberTable(q){
  q = q.toLowerCase();
  getMembers().then(async members=>{
    const rows = members.filter(m=>!q || m.id.toLowerCase().includes(q) || (m.nickname||'').toLowerCase().includes(q));
    const balances = await getBalances();
    document.getElementById('memberBody').innerHTML = memberRowsHtml(rows, balances);
  });
}
function openCreateSubMemberForm(){
  document.getElementById('formModalTitle').textContent = t('createSubMemberTitle');
  document.getElementById('formModalBody').innerHTML = `
    <p class="hint" style="margin:-4px 0 12px;">${t('createSubMemberHint')}</p>
    <div class="row"><div class="field"><label>${t('gameIdLabel')}</label><input id="nfId" placeholder="영문/숫자"></div><div class="field"><label>${t('initialPwLabel')}</label><input id="nfPw" value="0000"></div></div>
    <div class="row"><div class="field"><label>${t('colNick')}</label><input id="nfNick"></div><div class="field"><label>${t('colPhone')}</label><input id="nfPhone"></div></div>
    <div class="row"><div class="field"><label>${t('colCasino')}</label><select id="nfCasino"><option>NUSTAR</option><option>HANN</option><option>ONLINE</option></select></div>
      <div class="field"><label>${t('colMemberType')}</label><select id="nfType"><option>아바타아이디</option><option>스피드아이디</option></select></div></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const id = document.getElementById('nfId').value.trim().toUpperCase();
    if (!id){ toast(t('enterIdErr'), true); return; }
    if (!/^[A-Z0-9]+$/.test(id)){ toast(t('idFormatErr'), true); return; }
    if ((await db.collection('members').doc(id).get()).exists){ toast(t('idDuplicateErr'), true); return; }
    await db.collection('members').doc(id).set({
      id, loginId:id, nickname: document.getElementById('nfNick').value, phone: document.getElementById('nfPhone').value,
      casino: document.getElementById('nfCasino').value, parentAgent: myAgentCode(), agentCode: myAgentCode(),
      memberType: document.getElementById('nfType').value, status:'정상', betMax:1000000, betMin:5000,
      pw: document.getElementById('nfPw').value || '0000', withdrawPw:'0000',
      createdAt: new Date().toISOString(), lastLoginAt: null,
    });
    await logAction(id, '하부회원 생성 (에이전트 어드민)');
    closeModal('modal-form'); toast(t('subMemberCreated')); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function logAction(memberId, action){
  await db.collection('memberActionLogs').doc(uuidv4()).set({memberId, action, staff:CURRENT_STAFF?.id||'—', dt:new Date().toISOString()});
}

/* ============================================================
   계정관리 — 하부리스트 / 요율변경 / 베팅한도 / 접속차단·허용
   / 비밀번호 변경 / 자금 이체·회수
   ============================================================ */
async function renderAccount(){
  const members = await getMembers(true);
  const balances = await getBalances(true);
  window.__acctRows = members;
  const myBal = balances[myAgentCode()]?.balance || 0;
  return `
    ${pageHead(t('accountTitle'), t('accountSub'))}
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">${t('myAccountBalance')}</div><div class="val">${fmtNum(myBal)}</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="field search-box"><input id="acctSearch" placeholder="${t('searchIdNickPh')}" oninput="filterAcctTable(this.value)"></div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>${t('colId')}</th><th>${t('colNick')}</th><th>${t('colBalance')}</th><th>${t('colFundMgmt')}</th><th>${t('colRate')}</th><th>${t('colBetLimit')}</th><th>${t('colAccessStatus')}</th><th>${t('colPassword')}</th>
      </tr></thead><tbody id="acctBody">
      ${rows2Html(members, balances)}
      </tbody></table></div>
    </div>
  `;
  function rows2Html(){ return acctRowsHtml(members, balances); }
}
function acctRowsHtml(rows, balances){
  return rows.map(m=>acctRowHtml(m, balances[m.id]?.balance||0)).join('') || `<tr class="empty-row"><td colspan="8">${t('noSubMembers')}</td></tr>`;
}
function acctRowHtml(m, bal){
  const blocked = m.accessBlocked === true;
  return `<tr id="acctrow-${m.id}">
    <td>${escapeHtml(m.id)}</td><td>${escapeHtml(m.nickname||'—')}</td>
    <td><span class="num ${bal<0?'neg':bal>0?'pos':''}">${fmtNum(bal)}</span></td>
    <td>
      <button class="btn btn-xs btn-jade" onclick="openBalanceModal('${m.id}','deposit',t('fundTransferTitle'))">${t('transferBtn')}</button>
      <button class="btn btn-xs btn-danger" onclick="openBalanceModal('${m.id}','withdraw',t('fundRecallTitle'))">${t('recallBtn')}</button>
    </td>
    <td><span class="rate-badge">${fmtRate(m.agentRate)}%</span> <button class="btn btn-xs" onclick="editAgentRate('${m.id}',${Number(m.agentRate)||0})">${t('editBtn')}</button></td>
    <td><span class="num">${fmtNum(m.betMin||0)}~${fmtNum(m.betMax||0)}</span> <button class="btn btn-xs" onclick="editBetLimit('${m.id}',${Number(m.betMin)||0},${Number(m.betMax)||0})">${t('editBtn')}</button></td>
    <td>${blocked?`<span class="pill bad">${t('statusBlocked')}</span> <button class="btn btn-xs btn-jade" onclick="toggleAccess('${m.id}',false)">${t('allowBtn')}</button>`:`<span class="pill ok">${t('statusAllowed')}</span> <button class="btn btn-xs btn-danger" onclick="toggleAccess('${m.id}',true)">${t('blockBtn')}</button>`}</td>
    <td><button class="btn btn-xs" onclick="openChangeMemberPw('${m.id}')">${t('changeBtn')}</button></td>
  </tr>`;
}
function fmtRate(r){ const n = Number(r)||0; return n.toFixed(2).replace(/\.?0+$/,'')||'0'; }
function filterAcctTable(q){
  q = q.toLowerCase();
  getMembers().then(async members=>{
    const rows = members.filter(m=>!q || m.id.toLowerCase().includes(q) || (m.nickname||'').toLowerCase().includes(q));
    const balances = await getBalances();
    document.getElementById('acctBody').innerHTML = acctRowsHtml(rows, balances);
  });
}
function editAgentRate(id, cur){
  document.getElementById('formModalTitle').textContent = t('editRateTitle',{id});
  document.getElementById('formModalBody').innerHTML = `<div class="field"><label>${t('rateLabel')}</label><input id="arInput" value="${cur}"></div>`;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('members').doc(id).set({agentRate:Number(document.getElementById('arInput').value)||0}, {merge:true});
    await logAction(id, '하부 요율 변경');
    closeModal('modal-form'); toast(t('rateChanged')); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
const BET_LIMIT_PRESETS = [
  {label:'Tier 1', min:5000, max:300000},
  {label:'Tier 2', min:5000, max:500000},
  {label:'Tier 3', min:5000, max:1000000},
];
function editBetLimit(id, curMin, curMax){
  document.getElementById('formModalTitle').textContent = t('editBetLimitTitle',{id});
  document.getElementById('formModalBody').innerHTML = `
    <div class="table-wrap"><table class="limit-table"><thead><tr><th>${t('colSelect')}</th><th>${t('colMin')}</th><th>${t('colMax')}</th></tr></thead><tbody>
      ${BET_LIMIT_PRESETS.map((p,i)=>`<tr><td><input type="radio" name="blPreset" value="${i}" ${curMax===p.max&&curMin===p.min?'checked':''}></td><td>${fmtNum(p.min)}</td><td>${fmtNum(p.max)}</td></tr>`).join('')}
      <tr><td><input type="radio" name="blPreset" value="custom" ${!BET_LIMIT_PRESETS.some(p=>p.max===curMax&&p.min===curMin)?'checked':''}></td>
        <td><input id="blMin" value="${curMin}" style="width:90px;"></td><td><input id="blMax" value="${curMax}" style="width:90px;"></td></tr>
    </tbody></table></div>
    <p class="hint" style="margin-top:8px;">${t('betLimitHint')}</p>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const sel = document.querySelector('input[name="blPreset"]:checked')?.value;
    let min = curMin, max = curMax;
    if (sel==='custom' || sel===undefined){ min = rawNum(document.getElementById('blMin').value); max = rawNum(document.getElementById('blMax').value); }
    else { const p = BET_LIMIT_PRESETS[Number(sel)]; min = p.min; max = p.max; }
    if (!max || max<min){ toast(t('betLimitInvalidErr'), true); return; }
    await db.collection('members').doc(id).set({betMin:min, betMax:max}, {merge:true});
    await logAction(id, `베팅한도 변경 → ${fmtNum(min)}~${fmtNum(max)}`);
    closeModal('modal-form'); toast(t('betLimitChanged')); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function toggleAccess(id, block){
  await db.collection('members').doc(id).set({accessBlocked:block, status: block?'정지':'정상'}, {merge:true});
  await logAction(id, block?'접속 차단':'접속 허용');
  toast(block?t('accessBlockedToast'):t('accessAllowedToast'));
  invalidateCaches(); switchView(CURRENT_VIEW);
}
function openChangeMemberPw(id){
  document.getElementById('formModalTitle').textContent = t('changePwTitle',{id});
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>${t('newPwLabel')}</label><input id="mpwInput" placeholder="${t('newPwPh')}"></div>
    <p class="hint">${t('newPwHint')}</p>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const pw = document.getElementById('mpwInput').value.trim();
    if (pw.length<4){ toast(t('pwCheckErr'), true); return; }
    await db.collection('members').doc(id).set({pw}, {merge:true});
    await logAction(id, '비밀번호 변경 (에이전트)');
    closeModal('modal-form'); toast(t('pwChangedToast')); invalidateCaches();
  };
  openModal('modal-form');
}

/* ---------------- balance adjust modal (자금 이체 / 자금 회수, reused for 회원관리+계정관리) ---------------- */
let BALANCE_CTX = null;
function openBalanceModal(memberId, mode, label){
  BALANCE_CTX = {memberId, mode};
  document.getElementById('balanceModalTitle').textContent = label || (mode==='deposit' ? t('fundTransferTitle') : t('fundRecallTitle'));
  document.getElementById('balanceModalSub').textContent = `${t('targetMemberLabel')} ${memberId}`;
  document.getElementById('balanceAmt').value = '';
  document.getElementById('balanceMemo').value = '';
  document.getElementById('balanceWithdrawPw').value = '';
  document.getElementById('balanceWithdrawPwField').style.display = mode==='withdraw' ? '' : 'none';
  openModal('modal-balance');
}
async function submitBalanceAdjust(){
  const amt = rawNum(document.getElementById('balanceAmt').value);
  if (!amt){ toast(t('amountRequiredErr'), true); return; }
  if (BALANCE_CTX.mode==='withdraw'){
    const enteredPw = document.getElementById('balanceWithdrawPw').value.trim();
    const members = await getMembers();
    const target = members.find(m=>m.id===BALANCE_CTX.memberId);
    const actualPw = target ? String(target.withdrawPw ?? '0000') : '0000';
    if (!enteredPw || enteredPw !== actualPw){ toast(t('withdrawPwErr'), true); return; }
  }
  const memo = document.getElementById('balanceMemo').value;
  const signed = BALANCE_CTX.mode==='withdraw' ? -Math.abs(amt) : Math.abs(amt);
  await db.collection('memberLedger').doc(uuidv4()).set({
    memberId: BALANCE_CTX.memberId, amount: signed,
    category: BALANCE_CTX.mode==='withdraw' ? 'withdraw' : 'deposit',
    memo, staff: CURRENT_STAFF?.id||'—', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
  });
  await logAction(BALANCE_CTX.memberId, `${BALANCE_CTX.mode==='withdraw'?'자금 회수':'자금 이체'} ${fmtNum(amt)}`);
  closeModal('modal-balance');
  toast(t('processedToast'));
  invalidateCaches();
  switchView(CURRENT_VIEW);
}

/* ============================================================
   베팅내역
   ============================================================ */
let BETHIST_RAW = [];
const BET_ROUND_CATEGORIES = ['bet','payout','winloss','rolling'];
function ledgerCategoryLabel(cat){
  if (cat==='bet') return t('categoryBet');
  if (cat==='payout') return t('categoryPayout');
  if (cat==='winloss') return t('statWinLoss');
  if (cat==='rolling') return t('colRolling');
  if (cat==='deposit') return t('statDeposit');
  if (cat==='withdraw') return t('statWithdraw');
  return cat;
}
async function renderBetHistory(){
  BETHIST_RAW = (await myLedger(true)).filter(l=>BET_ROUND_CATEGORIES.includes(l.category));
  const today = new Date(), monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate()-30);
  const html = `
    ${pageHead(t('betHistoryTitle'), t('betHistorySub'))}
    <div class="card" style="margin-bottom:16px;">
      <div class="toolbar">
        <div class="field"><label>${t('startDateLabel')}</label><input type="date" id="bhStart" value="${dateInputStr(monthAgo)}"></div>
        <div class="field"><label>${t('endDateLabel')}</label><input type="date" id="bhEnd" value="${dateInputStr(today)}"></div>
        <div class="toolbar-right"><button class="btn btn-gold btn-sm" onclick="applyBetHistoryFilter()">${t('searchBtn')}</button></div>
      </div>
    </div>
    <div id="bhStats" class="grid grid-4" style="margin-bottom:16px;"></div>
    <div class="card">
      <div class="table-wrap"><table><thead><tr>
        <th>${t('colDatetime')}</th><th>${t('colId')}</th><th>${t('colGameType')}</th><th>${t('colBetMarket')}</th><th>${t('colCategory')}</th><th>${t('colAmount')}</th><th>${t('colBeforeAmount')}</th><th>${t('colAfterAmount')}</th><th>${t('colMemo')}</th>
      </tr></thead><tbody id="bhBody"></tbody></table></div>
    </div>
  `;
  setTimeout(applyBetHistoryFilter, 0);
  return html;
}
function applyBetHistoryFilter(){
  const ledger = BETHIST_RAW.filter(inRangeFilter('bhStart','bhEnd'));
  const rounds = ledger.filter(l=>l.category==='bet' || l.category==='winloss');
  const userCount = new Set(rounds.map(l=>l.memberId)).size;
  const totalRolling = ledger.filter(l=>l.category==='rolling').reduce((s,l)=>s+Math.abs(Number(l.amount)||0),0)
    + ledger.filter(l=>l.category==='bet').reduce((s,l)=>s+Math.abs(Number(l.amount)||0),0);
  const totalWinLoss = ledger.filter(l=>l.category==='winloss').reduce((s,l)=>s+(Number(l.amount)||0),0)
    + ledger.filter(l=>l.category==='payout').reduce((s,l)=>s+(Number(l.amount)||0),0)
    - ledger.filter(l=>l.category==='bet').reduce((s,l)=>s+Math.abs(Number(l.amount)||0),0);
  document.getElementById('bhStats').innerHTML = `
    <div class="stat-card"><div class="lbl">${t('statBetUsers')}</div><div class="val">${userCount}</div></div>
    <div class="stat-card"><div class="lbl">${t('statBetCount')}</div><div class="val">${rounds.length}</div></div>
    <div class="stat-card"><div class="lbl">${t('colRolling')}</div><div class="val">${fmtNum(totalRolling)}</div></div>
    <div class="stat-card${totalWinLoss<0?' danger':''}"><div class="lbl">${t('statWinLoss')}</div><div class="val">${fmtSigned(totalWinLoss)}</div></div>
  `;
  const rows = ledger.slice().sort((a,b)=>ledgerDate(b)-ledgerDate(a));
  document.getElementById('bhBody').innerHTML = rows.slice(0,200).map(l=>`<tr>
    <td>${fmtDt(l.clientCreatedAt||l.dt)}</td><td>${escapeHtml(l.memberId)}</td>
    <td>${escapeHtml(l.gameType||'—')}</td><td>${escapeHtml(l.betMarket||'—')}</td>
    <td>${ledgerCategoryLabel(l.category)}</td>
    <td><span class="num ${Number(l.amount)<0?'neg':'pos'}">${fmtNum(l.amount)}</span></td>
    <td><span class="num">${l.beforeBalance!=null?fmtNum(l.beforeBalance):'—'}</span></td>
    <td><span class="num">${l.afterBalance!=null?fmtNum(l.afterBalance):'—'}</span></td>
    <td>${escapeHtml(l.memo||'—')}</td>
  </tr>`).join('') || `<tr class="empty-row"><td colspan="9">${t('noDataMsg')}</td></tr>`;
}

/* ============================================================
   정산리포트
   ============================================================ */
let SETTLEMENT_RAW = {members:[], ledger:[]};
async function renderSettlementReport(){
  SETTLEMENT_RAW = { members: await getMembers(true), ledger: await myLedger(true) };
  const today = new Date(), monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate()-30);
  const html = `
    ${pageHead(t('settlementTitle'), t('settlementSub'))}
    <div class="card" style="margin-bottom:16px;">
      <div class="toolbar">
        <div class="field"><label>${t('startDateLabel')}</label><input type="date" id="stlStart" value="${dateInputStr(monthAgo)}"></div>
        <div class="field"><label>${t('endDateLabel')}</label><input type="date" id="stlEnd" value="${dateInputStr(today)}"></div>
        <div class="toolbar-right"><button class="btn btn-gold btn-sm" onclick="applySettlementFilter()">${t('searchBtn')}</button></div>
      </div>
    </div>
    <div id="stlStats" class="grid grid-5" style="margin-bottom:16px;"></div>
    <div class="card">
      <div class="table-wrap"><table><thead><tr>
        <th>${t('colId')}</th><th>${t('colNick')}</th><th>${t('colParentAccount')}</th><th>${t('statDeposit')}</th><th>${t('statWithdraw')}</th><th>${t('colRolling')}</th><th>${t('statWinLoss')}</th><th>${t('colRate')}</th><th>${t('colMyRevenue')}</th>
      </tr></thead><tbody id="stlBody"></tbody></table></div>
    </div>
  `;
  setTimeout(applySettlementFilter, 0);
  return html;
}
function applySettlementFilter(){
  const { members, ledger } = SETTLEMENT_RAW;
  const filtered = ledger.filter(inRangeFilter('stlStart','stlEnd'));
  const byMember = {};
  members.forEach(m=>{ byMember[m.id] = {m, deposit:0, withdraw:0, rolling:0, winloss:0}; });
  filtered.forEach(l=>{
    const row = byMember[l.memberId]; if (!row) return;
    const amt = Number(l.amount)||0;
    if (l.category==='deposit') row.deposit += amt;
    if (l.category==='withdraw') row.withdraw += amt;
    if (l.category==='bet'){ row.rolling += Math.abs(amt); row.winloss -= Math.abs(amt); }
    if (l.category==='payout') row.winloss += amt;
    if (l.category==='rolling') row.rolling += Math.abs(amt);
    if (l.category==='winloss') row.winloss += amt;
  });
  const rows = Object.values(byMember).filter(r=>r.deposit||r.withdraw||r.rolling||r.winloss);
  const totalDeposit = rows.reduce((s,r)=>s+r.deposit,0);
  const totalWithdraw = rows.reduce((s,r)=>s+Math.abs(r.withdraw),0);
  const totalWinLoss = rows.reduce((s,r)=>s+r.winloss,0);
  const totalRolling = rows.reduce((s,r)=>s+r.rolling,0);
  const totalComm = rows.reduce((s,r)=>s+r.rolling*((r.m.agentRate||0)/100),0);
  document.getElementById('stlStats').innerHTML = `
    <div class="stat-card"><div class="lbl">${t('statDeposit')}</div><div class="val">${fmtNum(totalDeposit)}</div></div>
    <div class="stat-card"><div class="lbl">${t('statWithdraw')}</div><div class="val">${fmtNum(totalWithdraw)}</div></div>
    <div class="stat-card${totalWinLoss<0?' danger':''}"><div class="lbl">${t('statWinLoss')}</div><div class="val">${fmtSigned(totalWinLoss)}</div></div>
    <div class="stat-card"><div class="lbl">${t('colRolling')}</div><div class="val">${fmtNum(totalRolling)}</div></div>
    <div class="stat-card"><div class="lbl">${t('statRollingComm')}</div><div class="val">${fmtNum(totalComm)}</div></div>
  `;
  document.getElementById('stlBody').innerHTML = rows.map(r=>`<tr>
    <td>${escapeHtml(r.m.id)}</td><td>${escapeHtml(r.m.nickname||'—')}</td><td>${escapeHtml(r.m.parentAgent||'—')}</td>
    <td><span class="num pos">${fmtNum(r.deposit)}</span></td><td><span class="num neg">${fmtNum(Math.abs(r.withdraw))}</span></td>
    <td><span class="num">${fmtNum(r.rolling)}</span></td>
    <td><span class="num ${r.winloss<0?'neg':'pos'}">${fmtSigned(r.winloss)}</span></td>
    <td>${fmtRate(r.m.agentRate)}%</td>
    <td><span class="num">${fmtNum(r.rolling*((r.m.agentRate||0)/100))}</span></td>
  </tr>`).join('') || `<tr class="empty-row"><td colspan="9">${t('noSettlementData')}</td></tr>`;
}

/* ============================================================
   실시간접속자
   ============================================================ */
async function renderRealtime(){
  const members = await getMembers(true);
  const now = Date.now();
  const online = members.filter(m => m.lastLoginAt && (now - new Date(m.lastLoginAt).getTime()) < 1000*60*60*6 && !m.accessBlocked);
  const casinos = ['NUSTAR','HANN','ONLINE'];
  const byCasino = {};
  casinos.forEach(c=>{ byCasino[c] = online.filter(m=>m.casino===c).length; });
  return `
    ${pageHead(t('realtimeTitle'), t('realtimeSub'))}
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">${t('statOnlineTotal')}</div><div class="val">${online.length}</div></div>
      ${casinos.map(c=>`<div class="stat-card"><div class="lbl">${c}</div><div class="val">${byCasino[c]}</div></div>`).join('')}
    </div>
    <div class="card"><h3>${t('onlineMembersTitle')}</h3>
      <div class="table-wrap"><table><thead><tr><th>${t('colId')}</th><th>${t('colNick')}</th><th>${t('colCasino')}</th><th>${t('colLocation')}</th><th>${t('colMemberType')}</th><th>${t('colLastLogin')}</th><th>${t('colStatus')}</th></tr></thead><tbody>
      ${online.length ? online.sort((a,b)=>new Date(b.lastLoginAt)-new Date(a.lastLoginAt)).map(m=>`
        <tr><td>${escapeHtml(m.id)}</td><td>${escapeHtml(m.nickname||'—')}</td><td>${escapeHtml(m.casino)}</td><td>${escapeHtml(m.currentTable||'—')}</td><td>${escapeHtml(m.memberType)}</td><td>${fmtDt(m.lastLoginAt)}</td><td><span class="badge-dot"></span> ${t('onlineLabel')}</td></tr>
      `).join('') : `<tr class="empty-row"><td colspan="7">${t('noOnlineMembers')}</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   내정보 변경
   ============================================================ */
async function renderMyInfo(){
  const s = CURRENT_STAFF || {};
  const members = await getMembers(true);
  const balances = await getBalances(true);
  const partners = await fetchAll('partners');
  const myPartner = partners.find(p=>p.id===s.agentCode) || {};
  const totalBal = members.reduce((sum,m)=>sum+(balances[m.id]?.balance||0),0);
  const ledger = (await myLedger(true)).slice().sort((a,b)=>new Date(b.clientCreatedAt||b.dt)-new Date(a.clientCreatedAt||a.dt));
  return `
    ${pageHead(t('myInfoTitle'))}
    <div class="grid grid-2">
      <div class="card"><h3>${t('accountInfoCard')}</h3>
        <div class="field"><label>${t('colId')}</label><input value="${escapeHtml(s.id||'')}" disabled></div>
        <div class="field"><label>${t('nameLabel')}</label><input id="myName" value="${escapeHtml(s.name||'')}"></div>
        <div class="field"><label>${t('agentCodeLabel')}</label><input value="${escapeHtml(s.agentCode||'')}" disabled></div>
        <div class="field"><label>${t('parentAccountLabel')}</label><input value="${escapeHtml(myPartner.parentCode||'—')}" disabled></div>
        <div class="field"><label>${t('shareRateLabel')}</label><input value="${myPartner.shareRate!=null?myPartner.shareRate+'%':'—'}" disabled></div>
        <button class="btn btn-gold" onclick="saveMyInfo()">${t('saveBtn')}</button>
      </div>
      <div class="card"><h3>${t('pwChangeCard')}</h3>
        <div class="field"><label>${t('currentPwLabel')}</label><input type="password" id="curPw"></div>
        <div class="field"><label>${t('newPwLabel')}</label><input type="password" id="newPw"></div>
        <div class="field"><label>${t('newPw2Label')}</label><input type="password" id="newPw2"></div>
        <button class="btn btn-gold" onclick="changeMyPw()">${t('changeBtn')}</button>
      </div>
    </div>
    <div class="grid grid-3" style="margin-top:16px;">
      <div class="stat-card"><div class="lbl">${t('statTotalDownline')}</div><div class="val">${members.length}</div></div>
      <div class="stat-card"><div class="lbl">${t('totalDownlineBalance')}</div><div class="val">${fmtNum(totalBal)}</div></div>
      <div class="stat-card"><div class="lbl">${t('avgBalance')}</div><div class="val">${fmtNum(members.length ? Math.round(totalBal/members.length) : 0)}</div></div>
    </div>
    <div class="card" style="margin-top:16px;"><h3>${t('recentFundMovement')}</h3>
      <div class="table-wrap"><table><thead><tr><th>${t('colDatetime')}</th><th>${t('colId')}</th><th>${t('colCategory')}</th><th>${t('colAmount')}</th></tr></thead><tbody>
      ${ledger.slice(0,15).map(l=>`<tr><td>${fmtDt(l.clientCreatedAt||l.dt)}</td><td>${escapeHtml(l.memberId)}</td><td>${ledgerCategoryLabel(l.category)}</td><td><span class="num ${Number(l.amount)<0?'neg':'pos'}">${fmtNum(l.amount)}</span></td></tr>`).join('') || `<tr class="empty-row"><td colspan="4">${t('noDataMsg')}</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}
async function saveMyInfo(){
  const name = document.getElementById('myName').value.trim();
  if (!name) return;
  await db.collection('agentStaff').doc(CURRENT_STAFF.id).set({name}, {merge:true});
  CURRENT_STAFF.name = name;
  document.getElementById('staffNameTxt').textContent = `${name} (${CURRENT_STAFF.agentCode})`;
  toast(t('savedToast'));
}
async function changeMyPw(){
  const cur = document.getElementById('curPw').value, n1 = document.getElementById('newPw').value, n2 = document.getElementById('newPw2').value;
  if (String(CURRENT_STAFF.pw ?? '0000') !== cur){ toast(t('pwMismatchErr'), true); return; }
  if (!n1 || n1 !== n2){ toast(t('pwConfirmErr'), true); return; }
  await db.collection('agentStaff').doc(CURRENT_STAFF.id).set({pw:n1}, {merge:true});
  CURRENT_STAFF.pw = n1;
  toast(t('pwChangedToast'));
}

const VIEW_RENDERERS = {
  member: renderMember, account: renderAccount, betHistory: renderBetHistory,
  settlementReport: renderSettlementReport, realtime: renderRealtime, myinfo: renderMyInfo,
};

/* ---------------- confirm modal helper + demo seed ---------------- */
function askConfirm(title, body, onOk){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  const btn = document.getElementById('confirmOkBtn');
  btn.onclick = async ()=>{ closeModal('modal-confirm'); await onOk(); };
  openModal('modal-confirm');
}
function confirmSeed(){
  askConfirm(t('seedConfirmTitle'), t('seedConfirmBody',{agent:myAgentCode()}), seedDemoData);
}
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randPick(arr){ return arr[randInt(0, arr.length-1)]; }
function randDateWithin(daysAgoMax){ const d = new Date(); d.setDate(d.getDate() - randInt(0,daysAgoMax)); d.setHours(randInt(0,23), randInt(0,59)); return d.toISOString(); }
async function seedDemoData(){
  toast(t('seedingInProgress'));
  const agentCode = myAgentCode();
  let batch = db.batch();
  let ops = 0;
  const flush = async ()=>{ if (ops>0){ await batch.commit(); batch = db.batch(); ops = 0; } };
  const set = (coll, id, data) => { batch.set(db.collection(coll).doc(id), data); ops++; if (ops>=400) flush(); };

  const nicknames = ['용용용','Eeyeyete','홈미르크','두산에너빌리티','아꼬케이','GDragon','레오123','HANYING','Danny','메이드킹'];
  const casinos = ['NUSTAR','HANN','ONLINE'];
  const casinoPrefix = {NUSTAR:'NU', HANN:'HN', ONLINE:'ON'};
  const types = ['어카운트','아바타아이디','스피드아이디'];
  const memberIds = [];
  for (let i=1;i<=12;i++){
    const casino = randPick(casinos);
    const id = `${agentCode.slice(0,3).toUpperCase()}${String(1000+i)}`;
    memberIds.push(id);
    const lastLoginAt = Math.random()>.4 ? randDateWithin(1) : null;
    set('members', id, {
      id, loginId:id, pw:'0000', nickname: randPick(nicknames)+i, phone:`010${randInt(1000,9999)}${randInt(1000,9999)}`,
      casino, agentCode, parentAgent: agentCode, memberType: randPick(types), status: i%9===0?'정지':'정상',
      accessBlocked: i%9===0, agentRate: randPick([0.8,1.0,1.2,1.45]),
      betMax: randPick([500000,1000000,3000000]), betMin: 5000, withdrawPw:'0000',
      createdAt: randDateWithin(180), lastLoginAt,
      currentTable: lastLoginAt ? `${casinoPrefix[casino]}-${randPick(['A','S'])}0${randInt(1,4)}` : null,
    });
  }
  const gameTypes = ['라이브','아바타','스피드'];
  const betMarkets = ['뱅커','플레이어','타이','뱅커페어','플레이어페어'];
  memberIds.forEach(mid=>{
    const casino = randPick(casinos);
    let bal = randInt(0,500)*1000;
    const pushEntry = (data, affectsBalance=true) => {
      const beforeBalance = bal;
      if (affectsBalance) bal += data.amount;
      set('memberLedger', uuidv4(), {memberId:mid, casino, beforeBalance, afterBalance:bal, createdAt: randDateWithin(30), clientCreatedAt: randDateWithin(30), ...data});
    };
    for (let i=0;i<randInt(1,3);i++) pushEntry({amount: randInt(5,50)*10000, category:'deposit', memo:'자금 이체', staff:CURRENT_STAFF?.id||'ADMIN'});
    for (let i=0;i<randInt(0,2);i++) pushEntry({amount: -randInt(3,30)*10000, category:'withdraw', memo:'자금 회수', staff:CURRENT_STAFF?.id||'ADMIN'});
    for (let i=0;i<randInt(2,6);i++){
      const gameType = randPick(gameTypes);
      const betMarket = randPick(betMarkets);
      const betAmt = randInt(5,80)*1000;
      if (gameType==='라이브'){
        const winLoss = Math.round(betAmt*(randPick([0,1.95,2.9])-1));
        pushEntry({amount: winLoss, category:'winloss', gameType, betMarket});
        pushEntry({amount: betAmt, category:'rolling', gameType, betMarket}, false);
      } else {
        pushEntry({amount:-betAmt, category:'bet', gameType, betMarket});
        if (Math.random()>.45) pushEntry({amount: Math.round(betAmt*randPick([0,1.95,2.9])), category:'payout', gameType, betMarket});
      }
    }
  });

  // agent's own account wallet — keyed by agentCode itself, aggregated by the
  // same unscoped getBalances() used for downline balances, so 계정관리's
  // "로그인 계정 잔액" card has non-zero demo data.
  {
    let myBal = randInt(50,300)*10000;
    for (let i=0;i<randInt(2,4);i++){
      const amt = randInt(10,80)*10000;
      const before = myBal; myBal += amt;
      set('memberLedger', uuidv4(), {memberId:agentCode, amount:amt, category:'deposit', memo:'본사 지급', staff:CURRENT_STAFF?.id||'ADMIN', beforeBalance:before, afterBalance:myBal, createdAt: randDateWithin(30), clientCreatedAt: randDateWithin(30)});
    }
    for (let i=0;i<randInt(1,3);i++){
      const amt = -randInt(5,40)*10000;
      const before = myBal; myBal += amt;
      set('memberLedger', uuidv4(), {memberId:agentCode, amount:amt, category:'withdraw', memo:'본사 회수', staff:CURRENT_STAFF?.id||'ADMIN', beforeBalance:before, afterBalance:myBal, createdAt: randDateWithin(30), clientCreatedAt: randDateWithin(30)});
    }
  }

  await flush();
  toast(t('seedDone'));
  invalidateCaches();
  switchView(CURRENT_VIEW);
}
