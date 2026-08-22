/* ============================================================
   Agent Admin — CAGE ADMIN 5.0
   Scoped-down SPA for a single agent (에이전트) to manage only
   their own downline (parentAgent === CURRENT_STAFF.agentCode).
   Shares the same Firestore collections as partner-admin/cage:
   members, memberLedger, partners, memberActionLogs.
   ============================================================ */

let db = null;
let CURRENT_STAFF = null; // {id, pw, name, agentCode, role:'agent'}
let CURRENT_VIEW = 'dashboard';

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
  {id:'member', label:'회원관리', icon:'users', single:true},
  {id:'account', label:'계정관리', icon:'wallet', single:true},
  {id:'betHistory', label:'베팅내역', icon:'pulse', single:true},
  {id:'settlementReport', label:'정산리포트', icon:'doc', single:true},
  {id:'realtime', label:'실시간접속자', icon:'dashboard', single:true},
  {id:'myinfo', label:'내정보 변경', icon:'user', single:true},
];

function buildNav(){
  const nav = document.getElementById('navBar');
  let html = '';
  NAV_GROUPS.forEach(g=>{
    html += `<button class="nav-single" id="navbtn-${g.id}" onclick="switchView('${g.id}')">${ic(g.icon)}<span>${g.label}</span></button>`;
  });
  nav.innerHTML = html + `
    <div class="nav-foot">
      Agent Ops<br>CAGE ADMIN 5.0
      <div class="nav-foot-btns">
        <button onclick="confirmSeed()">데모 데이터 생성</button>
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
  setInterval(()=>{ document.getElementById('clockTxt').textContent = fmtDt(new Date()); }, 1000);
  ensureDefaultStaff();
  document.getElementById('loginPw').addEventListener('keydown', e=>{ if (e.key==='Enter') doLogin(); });
  clearLoginInputs();
  setTimeout(clearLoginInputs, 350);
});
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
      await db.collection('agentStaff').doc('agent').set({id:'agent', pw:'0000', name:'SEVIP88 에이전트', agentCode:'SEVIP88', role:'agent', createdAt: new Date().toISOString()});
    }
  }catch(e){ /* offline first load — fine, login falls back to local default below */ }
}

async function doLogin(){
  const id = document.getElementById('loginId').value.trim() || 'agent';
  const pw = document.getElementById('loginPw').value.trim() || '0000';
  let staff = null;
  try{
    const doc = await db.collection('agentStaff').doc(id).get();
    if (doc.exists) staff = doc.data();
  }catch(e){}
  if (!staff && id==='agent' && pw==='0000') staff = {id:'agent', name:'SEVIP88 에이전트', agentCode:'SEVIP88', role:'agent'};
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
    const fn = VIEW_RENDERERS[viewId] || (()=>`<div class="card"><h3>준비 중</h3></div>`);
    const html = await fn();
    main.innerHTML = html;
  }catch(e){
    console.error(e);
    main.innerHTML = `<div class="card"><h3>오류</h3><p style="color:var(--danger);">${escapeHtml(e.message||String(e))}</p></div>`;
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

/* ============================================================
   회원관리 — 하부 회원 리스트 + 하부회원 생성
   (member doc IS the avatar/speed game login credential — one
   creation covers both game types, per shared/game-engine.js)
   ============================================================ */
async function renderMember(){
  const members = await getMembers(true);
  const balances = await getBalances(true);
  return `
    ${pageHead('회원관리', '하부 회원 리스트 · 게임용(아바타/스피드) 아이디는 이 화면 또는 케이지에서 생성할 수 있습니다.')}
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">총 하부회원</div><div class="val">${members.length}</div></div>
      <div class="stat-card"><div class="lbl">정상</div><div class="val">${members.filter(m=>m.status==='정상').length}</div></div>
      <div class="stat-card"><div class="lbl">정지</div><div class="val">${members.filter(m=>m.status==='정지').length}</div></div>
      <div class="stat-card"><div class="lbl">보유금 합계</div><div class="val">${fmtNum(Object.entries(balances).filter(([id])=>members.some(m=>m.id===id)).reduce((s,[,b])=>s+b.balance,0))}</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="field search-box"><input id="memberSearch" placeholder="ID/닉네임 검색" oninput="filterMemberTable(this.value)"></div>
        <div class="toolbar-right"><button class="btn btn-gold btn-sm" onclick="openCreateSubMemberForm()">+ 하부회원 생성</button></div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>ID</th><th>닉네임</th><th>전화번호</th><th>카지노</th><th>회원유형</th><th>보유금</th><th>가입일</th><th>상태</th>
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
    <td>${fmtDate(m.createdAt)}</td><td>${pill(m.status,{정상:'ok',정지:'bad',블랙리스트:'bad'})}</td>
  </tr>`).join('') || `<tr class="empty-row"><td colspan="8">하부회원이 없습니다</td></tr>`;
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
  document.getElementById('formModalTitle').textContent = '하부회원 생성 (게임용 아바타/스피드 아이디)';
  document.getElementById('formModalBody').innerHTML = `
    <p class="hint" style="margin:-4px 0 12px;">신규 접수는 플로어를 통해 현장에서 받고 상위 계정 생성·변경은 케이지에서 처리합니다. 이 화면에서는 하부 게임용 로그인(아바타/스피드 공용)만 생성합니다.</p>
    <div class="row"><div class="field"><label>게임용 ID</label><input id="nfId" placeholder="영문/숫자"></div><div class="field"><label>초기 비밀번호</label><input id="nfPw" value="0000"></div></div>
    <div class="row"><div class="field"><label>닉네임</label><input id="nfNick"></div><div class="field"><label>전화번호</label><input id="nfPhone"></div></div>
    <div class="row"><div class="field"><label>카지노</label><select id="nfCasino"><option>NUSTAR</option><option>HANN</option><option>ONLINE</option></select></div>
      <div class="field"><label>회원유형</label><select id="nfType"><option>정회원</option><option>준회원</option></select></div></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const id = document.getElementById('nfId').value.trim().toUpperCase();
    if (!id){ toast('ID를 입력하세요', true); return; }
    await db.collection('members').doc(id).set({
      id, loginId:id, nickname: document.getElementById('nfNick').value, phone: document.getElementById('nfPhone').value,
      casino: document.getElementById('nfCasino').value, parentAgent: myAgentCode(), agentCode: myAgentCode(),
      memberType: document.getElementById('nfType').value, status:'정상', betMax:1000000, betMin:5000,
      pw: document.getElementById('nfPw').value || '0000', withdrawPw:'0000',
      createdAt: new Date().toISOString(), lastLoginAt: null,
    });
    await logAction(id, '하부회원 생성 (에이전트 어드민)');
    closeModal('modal-form'); toast('하부회원(게임용 아이디)이 생성되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
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
  return `
    ${pageHead('계정관리', '하부 계정의 자금·요율·베팅한도·접속·비밀번호를 관리합니다.')}
    <div class="card">
      <div class="toolbar">
        <div class="field search-box"><input id="acctSearch" placeholder="ID/닉네임 검색" oninput="filterAcctTable(this.value)"></div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>아이디</th><th>닉네임</th><th>보유금액</th><th>자금관리</th><th>요율</th><th>배팅한도</th><th>접속상태</th><th>비밀번호</th>
      </tr></thead><tbody id="acctBody">
      ${rows2Html(members, balances)}
      </tbody></table></div>
    </div>
  `;
  function rows2Html(){ return acctRowsHtml(members, balances); }
}
function acctRowsHtml(rows, balances){
  return rows.map(m=>acctRowHtml(m, balances[m.id]?.balance||0)).join('') || `<tr class="empty-row"><td colspan="8">하부회원이 없습니다</td></tr>`;
}
function acctRowHtml(m, bal){
  const blocked = m.accessBlocked === true;
  return `<tr id="acctrow-${m.id}">
    <td>${escapeHtml(m.id)}</td><td>${escapeHtml(m.nickname||'—')}</td>
    <td><span class="num ${bal<0?'neg':bal>0?'pos':''}">${fmtNum(bal)}</span></td>
    <td>
      <button class="btn btn-xs btn-jade" onclick="openBalanceModal('${m.id}','deposit','자금 이체')">이체</button>
      <button class="btn btn-xs btn-danger" onclick="openBalanceModal('${m.id}','withdraw','자금 회수')">회수</button>
    </td>
    <td><span class="rate-badge">${fmtRate(m.agentRate)}%</span> <button class="btn btn-xs" onclick="editAgentRate('${m.id}',${Number(m.agentRate)||0})">수정</button></td>
    <td><span class="num">${fmtNum(m.betMin||0)}~${fmtNum(m.betMax||0)}</span> <button class="btn btn-xs" onclick="editBetLimit('${m.id}',${Number(m.betMin)||0},${Number(m.betMax)||0})">수정</button></td>
    <td>${blocked?`<span class="pill bad">차단</span> <button class="btn btn-xs btn-jade" onclick="toggleAccess('${m.id}',false)">허용</button>`:`<span class="pill ok">허용</span> <button class="btn btn-xs btn-danger" onclick="toggleAccess('${m.id}',true)">차단</button>`}</td>
    <td><button class="btn btn-xs" onclick="openChangeMemberPw('${m.id}')">변경</button></td>
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
  document.getElementById('formModalTitle').textContent = `하부 요율 변경 · ${id}`;
  document.getElementById('formModalBody').innerHTML = `<div class="field"><label>요율(%)</label><input id="arInput" value="${cur}"></div>`;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('members').doc(id).set({agentRate:Number(document.getElementById('arInput').value)||0}, {merge:true});
    await logAction(id, '하부 요율 변경');
    closeModal('modal-form'); toast('요율이 변경되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
const BET_LIMIT_PRESETS = [
  {label:'Tier 1', min:5000, max:300000},
  {label:'Tier 2', min:5000, max:500000},
  {label:'Tier 3', min:5000, max:1000000},
];
function editBetLimit(id, curMin, curMax){
  document.getElementById('formModalTitle').textContent = `베팅한도 변경 · ${id}`;
  document.getElementById('formModalBody').innerHTML = `
    <div class="table-wrap"><table class="limit-table"><thead><tr><th>선택</th><th>최소</th><th>최대</th></tr></thead><tbody>
      ${BET_LIMIT_PRESETS.map((p,i)=>`<tr><td><input type="radio" name="blPreset" value="${i}" ${curMax===p.max&&curMin===p.min?'checked':''}></td><td>${fmtNum(p.min)}</td><td>${fmtNum(p.max)}</td></tr>`).join('')}
      <tr><td><input type="radio" name="blPreset" value="custom" ${!BET_LIMIT_PRESETS.some(p=>p.max===curMax&&p.min===curMin)?'checked':''}></td>
        <td><input id="blMin" value="${curMin}" style="width:90px;"></td><td><input id="blMax" value="${curMax}" style="width:90px;"></td></tr>
    </tbody></table></div>
    <p class="hint" style="margin-top:8px;">선택 값 1건만 적용됩니다.</p>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const sel = document.querySelector('input[name="blPreset"]:checked')?.value;
    let min = curMin, max = curMax;
    if (sel==='custom' || sel===undefined){ min = rawNum(document.getElementById('blMin').value); max = rawNum(document.getElementById('blMax').value); }
    else { const p = BET_LIMIT_PRESETS[Number(sel)]; min = p.min; max = p.max; }
    if (!max || max<min){ toast('한도 값을 확인하세요', true); return; }
    await db.collection('members').doc(id).set({betMin:min, betMax:max}, {merge:true});
    await logAction(id, `베팅한도 변경 → ${fmtNum(min)}~${fmtNum(max)}`);
    closeModal('modal-form'); toast('베팅한도가 변경되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function toggleAccess(id, block){
  await db.collection('members').doc(id).set({accessBlocked:block, status: block?'정지':'정상'}, {merge:true});
  await logAction(id, block?'접속 차단':'접속 허용');
  toast(block?'접속이 차단되었습니다':'접속이 허용되었습니다');
  invalidateCaches(); switchView(CURRENT_VIEW);
}
function openChangeMemberPw(id){
  document.getElementById('formModalTitle').textContent = `비밀번호 변경 · ${id}`;
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>새 비밀번호</label><input id="mpwInput" placeholder="8-16자 영문/숫자/특수문자"></div>
    <p class="hint">8-16자, 영문·숫자·특수문자를 포함해 입력하세요.</p>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const pw = document.getElementById('mpwInput').value.trim();
    if (pw.length<4){ toast('비밀번호를 확인하세요', true); return; }
    await db.collection('members').doc(id).set({pw}, {merge:true});
    await logAction(id, '비밀번호 변경 (에이전트)');
    closeModal('modal-form'); toast('비밀번호가 변경되었습니다'); invalidateCaches();
  };
  openModal('modal-form');
}

/* ---------------- balance adjust modal (자금 이체 / 자금 회수, reused for 회원관리+계정관리) ---------------- */
let BALANCE_CTX = null;
function openBalanceModal(memberId, mode, label){
  BALANCE_CTX = {memberId, mode};
  document.getElementById('balanceModalTitle').textContent = label || (mode==='deposit' ? '자금 이체' : '자금 회수');
  document.getElementById('balanceModalSub').textContent = `대상 회원: ${memberId}`;
  document.getElementById('balanceAmt').value = '';
  document.getElementById('balanceMemo').value = '';
  openModal('modal-balance');
}
async function submitBalanceAdjust(){
  const amt = rawNum(document.getElementById('balanceAmt').value);
  if (!amt){ toast('금액을 입력하세요', true); return; }
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
  toast('처리되었습니다');
  invalidateCaches();
  switchView(CURRENT_VIEW);
}

/* ============================================================
   베팅내역
   ============================================================ */
async function renderBetHistory(){
  const ledger = (await myLedger(true)).filter(l=>l.category==='bet' || l.category==='payout');
  const bets = ledger.filter(l=>l.category==='bet');
  const payouts = ledger.filter(l=>l.category==='payout');
  const userCount = new Set(bets.map(l=>l.memberId)).size;
  const totalBet = bets.reduce((s,l)=>s+Math.abs(Number(l.amount)||0),0);
  const totalPayout = payouts.reduce((s,l)=>s+(Number(l.amount)||0),0);
  const winLoss = totalPayout - totalBet;
  const rows = ledger.sort((a,b)=>new Date(b.createdAt&&b.createdAt.toDate?b.createdAt.toDate():b.clientCreatedAt||b.createdAt)-new Date(a.createdAt&&a.createdAt.toDate?a.createdAt.toDate():a.clientCreatedAt||a.createdAt));
  return `
    ${pageHead('베팅내역', '하부 회원의 베팅/페이아웃 내역')}
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">배팅유저수</div><div class="val">${userCount}</div></div>
      <div class="stat-card"><div class="lbl">배팅건수</div><div class="val">${bets.length}</div></div>
      <div class="stat-card"><div class="lbl">총 배팅금액</div><div class="val">${fmtNum(totalBet)}</div></div>
      <div class="stat-card${winLoss<0?' danger':''}"><div class="lbl">윈로스</div><div class="val">${fmtSigned(winLoss)}</div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table><thead><tr><th>일시</th><th>ID</th><th>구분</th><th>금액</th><th>메모</th></tr></thead><tbody>
      ${rows.slice(0,200).map(l=>`<tr><td>${fmtDt(l.clientCreatedAt||l.dt)}</td><td>${escapeHtml(l.memberId)}</td><td>${l.category==='bet'?'배팅':'페이아웃'}</td><td><span class="num ${Number(l.amount)<0?'neg':'pos'}">${fmtNum(l.amount)}</span></td><td>${escapeHtml(l.memo||'—')}</td></tr>`).join('') || `<tr class="empty-row"><td colspan="5">데이터가 없습니다</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   정산리포트
   ============================================================ */
async function renderSettlementReport(){
  const members = await getMembers(true);
  const ledger = await myLedger(true);
  const byMember = {};
  members.forEach(m=>{ byMember[m.id] = {m, deposit:0, withdraw:0, bet:0, payout:0}; });
  ledger.forEach(l=>{
    const row = byMember[l.memberId]; if (!row) return;
    if (l.category==='deposit') row.deposit += Number(l.amount)||0;
    if (l.category==='withdraw') row.withdraw += Number(l.amount)||0;
    if (l.category==='bet') row.bet += Math.abs(Number(l.amount)||0);
    if (l.category==='payout') row.payout += Number(l.amount)||0;
  });
  const rows = Object.values(byMember).filter(r=>r.deposit||r.withdraw||r.bet||r.payout);
  const totalDeposit = rows.reduce((s,r)=>s+r.deposit,0);
  const totalWithdraw = rows.reduce((s,r)=>s+Math.abs(r.withdraw),0);
  const totalWinLoss = rows.reduce((s,r)=>s+(r.payout-r.bet),0);
  const totalRolling = rows.reduce((s,r)=>s+r.bet,0);
  const totalComm = rows.reduce((s,r)=>s+r.bet*((r.m.agentRate||0)/100),0);
  return `
    ${pageHead('정산리포트', '하부 회원 입출금/윈로스/롤링 정산 현황')}
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">입금</div><div class="val">${fmtNum(totalDeposit)}</div></div>
      <div class="stat-card"><div class="lbl">출금</div><div class="val">${fmtNum(totalWithdraw)}</div></div>
      <div class="stat-card${totalWinLoss<0?' danger':''}"><div class="lbl">윈로스</div><div class="val">${fmtSigned(totalWinLoss)}</div></div>
      <div class="stat-card"><div class="lbl">롤링커미션</div><div class="val">${fmtNum(totalComm)}</div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table><thead><tr>
        <th>ID</th><th>닉네임</th><th>상위어카운트</th><th>입금</th><th>출금</th><th>롤링</th><th>윈로스</th><th>요율</th><th>내수익금</th>
      </tr></thead><tbody>
      ${rows.map(r=>`<tr>
        <td>${escapeHtml(r.m.id)}</td><td>${escapeHtml(r.m.nickname||'—')}</td><td>${escapeHtml(r.m.parentAgent||'—')}</td>
        <td><span class="num pos">${fmtNum(r.deposit)}</span></td><td><span class="num neg">${fmtNum(Math.abs(r.withdraw))}</span></td>
        <td><span class="num">${fmtNum(r.bet)}</span></td>
        <td><span class="num ${(r.payout-r.bet)<0?'neg':'pos'}">${fmtSigned(r.payout-r.bet)}</span></td>
        <td>${fmtRate(r.m.agentRate)}%</td>
        <td><span class="num">${fmtNum(r.bet*((r.m.agentRate||0)/100))}</span></td>
      </tr>`).join('') || `<tr class="empty-row"><td colspan="9">정산 데이터가 없습니다</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   실시간접속자
   ============================================================ */
async function renderRealtime(){
  const members = await getMembers(true);
  const now = Date.now();
  const online = members.filter(m => m.lastLoginAt && (now - new Date(m.lastLoginAt).getTime()) < 1000*60*60*6 && !m.accessBlocked);
  return `
    ${pageHead('실시간접속자', '최근 6시간 이내 로그인 기준 (데모)')}
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">총 접속자</div><div class="val">${online.length}</div></div>
      <div class="stat-card"><div class="lbl">총 하부회원</div><div class="val">${members.length}</div></div>
    </div>
    <div class="card"><h3>접속중 회원</h3>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>닉네임</th><th>카지노</th><th>회원유형</th><th>최근접속</th><th>상태</th></tr></thead><tbody>
      ${online.length ? online.sort((a,b)=>new Date(b.lastLoginAt)-new Date(a.lastLoginAt)).map(m=>`
        <tr><td>${escapeHtml(m.id)}</td><td>${escapeHtml(m.nickname||'—')}</td><td>${escapeHtml(m.casino)}</td><td>${escapeHtml(m.memberType)}</td><td>${fmtDt(m.lastLoginAt)}</td><td><span class="badge-dot"></span> 온라인</td></tr>
      `).join('') : `<tr class="empty-row"><td colspan="6">접속 중인 회원이 없습니다</td></tr>`}
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
    ${pageHead('내정보 변경')}
    <div class="grid grid-2">
      <div class="card"><h3>계정 정보</h3>
        <div class="field"><label>ID</label><input value="${escapeHtml(s.id||'')}" disabled></div>
        <div class="field"><label>이름</label><input id="myName" value="${escapeHtml(s.name||'')}"></div>
        <div class="field"><label>에이전트 코드</label><input value="${escapeHtml(s.agentCode||'')}" disabled></div>
        <div class="field"><label>상위어카운트</label><input value="${escapeHtml(myPartner.parentCode||'—')}" disabled></div>
        <div class="field"><label>쉐어율</label><input value="${myPartner.shareRate!=null?myPartner.shareRate+'%':'—'}" disabled></div>
        <button class="btn btn-gold" onclick="saveMyInfo()">저장</button>
      </div>
      <div class="card"><h3>비밀번호 변경</h3>
        <div class="field"><label>현재 비밀번호</label><input type="password" id="curPw"></div>
        <div class="field"><label>새 비밀번호</label><input type="password" id="newPw"></div>
        <div class="field"><label>새 비밀번호 확인</label><input type="password" id="newPw2"></div>
        <button class="btn btn-gold" onclick="changeMyPw()">변경</button>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px;">
      <div class="stat-card"><div class="lbl">총 하부회원</div><div class="val">${members.length}</div></div>
      <div class="stat-card"><div class="lbl">하부 보유금 합계</div><div class="val">${fmtNum(totalBal)}</div></div>
    </div>
    <div class="card" style="margin-top:16px;"><h3>최근 자금 이동 내역</h3>
      <div class="table-wrap"><table><thead><tr><th>일시</th><th>ID</th><th>구분</th><th>금액</th></tr></thead><tbody>
      ${ledger.slice(0,15).map(l=>`<tr><td>${fmtDt(l.clientCreatedAt||l.dt)}</td><td>${escapeHtml(l.memberId)}</td><td>${l.category}</td><td><span class="num ${Number(l.amount)<0?'neg':'pos'}">${fmtNum(l.amount)}</span></td></tr>`).join('') || `<tr class="empty-row"><td colspan="4">데이터가 없습니다</td></tr>`}
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
  toast('저장되었습니다');
}
async function changeMyPw(){
  const cur = document.getElementById('curPw').value, n1 = document.getElementById('newPw').value, n2 = document.getElementById('newPw2').value;
  if (String(CURRENT_STAFF.pw ?? '0000') !== cur){ toast('현재 비밀번호가 일치하지 않습니다', true); return; }
  if (!n1 || n1 !== n2){ toast('새 비밀번호를 확인해주세요', true); return; }
  await db.collection('agentStaff').doc(CURRENT_STAFF.id).set({pw:n1}, {merge:true});
  CURRENT_STAFF.pw = n1;
  toast('비밀번호가 변경되었습니다');
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
  askConfirm('데모 데이터 생성', `${myAgentCode()} 소속 하부회원 데모 데이터를 Firestore에 생성합니다. 계속할까요?`, seedDemoData);
}
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randPick(arr){ return arr[randInt(0, arr.length-1)]; }
function randDateWithin(daysAgoMax){ const d = new Date(); d.setDate(d.getDate() - randInt(0,daysAgoMax)); d.setHours(randInt(0,23), randInt(0,59)); return d.toISOString(); }
async function seedDemoData(){
  toast('데모 데이터 생성 중...');
  const agentCode = myAgentCode();
  let batch = db.batch();
  let ops = 0;
  const flush = async ()=>{ if (ops>0){ await batch.commit(); batch = db.batch(); ops = 0; } };
  const set = (coll, id, data) => { batch.set(db.collection(coll).doc(id), data); ops++; if (ops>=400) flush(); };

  const nicknames = ['용용용','Eeyeyete','홈미르크','두산에너빌리티','아꼬케이','GDragon','레오123','HANYING','Danny','메이드킹'];
  const casinos = ['NUSTAR','HANN','ONLINE'];
  const types = ['정회원','정회원','정회원','준회원'];
  const memberIds = [];
  for (let i=1;i<=12;i++){
    const casino = randPick(casinos);
    const id = `${agentCode.slice(0,3).toUpperCase()}${String(1000+i)}`;
    memberIds.push(id);
    set('members', id, {
      id, loginId:id, pw:'0000', nickname: randPick(nicknames)+i, phone:`010${randInt(1000,9999)}${randInt(1000,9999)}`,
      casino, agentCode, parentAgent: agentCode, memberType: randPick(types), status: i%9===0?'정지':'정상',
      accessBlocked: i%9===0, agentRate: randPick([0.8,1.0,1.2,1.45]),
      betMax: randPick([500000,1000000,3000000]), betMin: 5000, withdrawPw:'0000',
      createdAt: randDateWithin(180), lastLoginAt: Math.random()>.4 ? randDateWithin(1) : null,
    });
  }
  memberIds.forEach(mid=>{
    const casino = randPick(casinos);
    for (let i=0;i<randInt(1,3);i++) set('memberLedger', uuidv4(), {memberId:mid, casino, amount: randInt(5,50)*10000, category:'deposit', memo:'자금 이체', staff:CURRENT_STAFF?.id||'agent', createdAt: randDateWithin(30), clientCreatedAt: randDateWithin(30)});
    for (let i=0;i<randInt(0,2);i++) set('memberLedger', uuidv4(), {memberId:mid, casino, amount: -randInt(3,30)*10000, category:'withdraw', memo:'자금 회수', staff:CURRENT_STAFF?.id||'agent', createdAt: randDateWithin(30), clientCreatedAt: randDateWithin(30)});
    for (let i=0;i<randInt(2,6);i++){
      const betAmt = randInt(5,80)*1000;
      set('memberLedger', uuidv4(), {memberId:mid, casino, amount:-betAmt, category:'bet', createdAt: randDateWithin(10), clientCreatedAt: randDateWithin(10)});
      if (Math.random()>.45) set('memberLedger', uuidv4(), {memberId:mid, casino, amount: Math.round(betAmt*randPick([0,1.95,2.9])), category:'payout', createdAt: randDateWithin(10), clientCreatedAt: randDateWithin(10)});
    }
  });
  await flush();
  toast('데모 데이터가 생성되었습니다');
  invalidateCaches();
  switchView(CURRENT_VIEW);
}
