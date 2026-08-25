/* ============================================================
   Partner Admin — CAGE ADMIN 5.0
   Single-file SPA engine: login, nav, generic list/detail views,
   bespoke dashboards, Firestore CRUD, demo data seeding.
   ============================================================ */

let db = null;
let CURRENT_STAFF = null;
let CURRENT_VIEW = 'dashboard';
let CASINO_FILTER = 'ALL';
/* SOLAIRE and MIDORI are branches of the business the same as the other two - Cage Admin has
   carried them in its own branch list all along - so they belong in every casino picker here as
   well. ONLINE is not a floor; it stays in the list because members are registered under it. */
const CASINOS = ['NUSTAR','HANN','SOLAIRE','MIDORI','ONLINE'];

/* ---------------- the tables each branch runs ----------------
   Ten speed and ten avatar per branch, id <branch code><S|A><nn> - NUS01..NUS10 for NuStar speed,
   NUA01..NUA10 for its avatar tables, and so on. This is the only place they are written down:
   the avatar and speed apps, Cage Admin's game-start screen and its 아바타·스피드 테이블 관리 all
   read them back out of the tables collection.
   ONLINE has no floor, so it has no tables. */
const BRANCH_TABLE_CODES = {NUSTAR:'NU', HANN:'HN', SOLAIRE:'SL', MIDORI:'MI'};
const BRANCH_TABLE_KINDS = [{type:'speed', letter:'S', word:'Speed'}, {type:'avatar', letter:'A', word:'Avatar'}];
const BRANCH_TABLES_PER_KIND = 10;
function branchTableDefs(){
  const out = [];
  Object.entries(BRANCH_TABLE_CODES).forEach(([casino, code])=>{
    BRANCH_TABLE_KINDS.forEach(({type, letter, word})=>{
      for (let i = 1; i <= BRANCH_TABLES_PER_KIND; i++){
        const no = String(i).padStart(2, '0');
        out.push({id:`${code}${letter}${no}`, name:`${casino} ${word} ${no}`, type, casino});
      }
    });
  });
  return out;
}

/* ---------------- icons ---------------- */
const ICONS = {
  dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 19a5 5 0 0 1 6.5-3.2"/></svg>',
  pulse:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
  wallet:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="6" width="19" height="14" rx="2"/><path d="M2.5 10h19"/><circle cx="17" cy="14.5" r="1.2"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 9h7M8.5 13h7M8.5 17h4"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10M11 20V4M18 20v-7"/></svg>',
  table:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
  gamepad:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 9h10a4 4 0 0 1 4 4.3c-.15 1.9-1.7 3.2-3.4 2.5L14 14h-4l-3.6 1.8C4.7 16.5 3.15 15.2 3 13.3A4 4 0 0 1 7 9z"/><path d="M8.5 11v3M7 12.5h3M16.5 12h.01M18.5 13.5h.01"/></svg>',
  bank:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10l9-6 9 6"/><path d="M4 10v9M9 10v9M15 10v9M20 10v9"/><path d="M2.5 21h19"/></svg>',
  headset:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M20 19a4 4 0 0 1-4 3h-2"/></svg>',
  shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>',
  card:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 9.5h19"/></svg>'
};
function ic(name){ return `<span class="ic">${ICONS[name]||ICONS.doc}</span>`; }

/* ---------------- nav structure (58 leaf screens across 12 groups, mirrors the 51-screen reference set) ---------------- */
const NAV_GROUPS = [
  {id:'dashboard', label:'대시보드', icon:'dashboard', single:true},
  {id:'myinfo', label:'내 정보 관리', icon:'user', single:true},
  {id:'realtime', label:'실시간 접속자', icon:'pulse', single:true},
  {id:'account', label:'계정 관리', icon:'wallet', single:true},
  {id:'settlementReport', label:'파트너 정산 리포트', icon:'doc', single:true},
  {id:'member', label:'회원 관리', icon:'users', children:[
    {id:'userList', label:'유저 리스트'},
    {id:'betHistory', label:'베팅내역'},
    {id:'payoutHistory', label:'지급내역'},
    {id:'pointAccum', label:'포인트 누적 내역'},
    {id:'pointConversion', label:'포인트 전환 리스트'},
    {id:'shareMgmt', label:'쉐어 관리'},
    {id:'depositMgmt', label:'디파짓 관리'},
    {id:'shareAccumList', label:'쉐어 누적 리스트'},
    {id:'shareSettingLog', label:'쉐어 설정 로그'},
    {id:'dailyReport', label:'데일리 리포트'},
  ]},
  {id:'stats', label:'통계', icon:'chart', children:[
    {id:'marketRatio', label:'마켓비율'},
    {id:'depositWithdrawStats', label:'입출금 내역'},
    {id:'performanceCompare', label:'실적 비교'},
    {id:'realtimeRisk', label:'실시간 위험 감지'},
    {id:'highBet', label:'고액 베팅'},
    {id:'leaderboard', label:'리더보드'},
    {id:'memberActivity', label:'회원 활동'},
    {id:'signupStatus', label:'회원가입 현황'},
    {id:'bettingStatus', label:'베팅현황'},
  ]},
  {id:'table', label:'테이블 관리', icon:'table', children:[
    {id:'tableList', label:'테이블 관리'},
    {id:'tableBetHistory', label:'테이블 베팅 총 금액(24H)'},
    {id:'avatarGameList', label:'아바타 게임 관리'},
    {id:'avatarRequests', label:'아바타 대리베팅 신청'},
    {id:'roundEdit', label:'게임 라운드 수정'},
    {id:'chatLog', label:'채팅 로그'},
    {id:'bankerCutBets', label:'뱅커 절사 베팅내역'},
    {id:'avatarMissFix', label:'아바타 미스 수정'},
    {id:'tableVideo', label:'게임 테이블 영상'},
    {id:'roundEditSettle', label:'게임 라운드 수정 정산'},
  ]},
  {id:'wallet', label:'월렛 관리', icon:'bank', children:[
    {id:'depositWithdrawList', label:'입출금 리스트'},
    {id:'walletTransferList', label:'월렛 이체 리스트'},
    {id:'walletConversionList', label:'월렛 전환 리스트'},
  ]},
  {id:'cs', label:'고객센터', icon:'headset', children:[
    {id:'tickerNotice', label:'한줄 공지'},
    {id:'notice', label:'공지사항'},
    {id:'guide', label:'이용안내'},
    {id:'bannedWords', label:'금지어 설정'},
    {id:'inquiry1on1', label:'일대일 문의'},
    {id:'inGameNotice', label:'인게임 공지'},
    {id:'csContact', label:'고객센터 연락처 관리'},
  ]},
  {id:'admin', label:'관리자 관리', icon:'shield', children:[
    {id:'moveAffiliation', label:'소속이동'},
    {id:'fullMemberConversion', label:'정회원 전환 리스트'},
    {id:'signupSmsVerify', label:'가입 인증문자 확인'},
    {id:'blacklist', label:'블랙리스트'},
    {id:'memberActionLog', label:'회원 액션 로그'},
    {id:'adminLog', label:'관리자 로그'},
    {id:'sharePartnerMgmt', label:'쉐어 파트너 관리'},
    {id:'subJunketMgmt', label:'서브 정켓 관리'},
    {id:'eventMgmt', label:'이벤트 관리'},
    {id:'fieldSignupList', label:'현장가입 리스트'},
  ]},
  {id:'payment', label:'결제 관리', icon:'card', children:[
    {id:'cageTransferHistory', label:'케이지 이체 내역'},
    {id:'dailySettlement', label:'일자별 정산'},
    {id:'paymentProcessList', label:'결제 처리 리스트'},
    {id:'paymentMgmt', label:'결제 관리'},
  ]},
];

function buildNav(){
  const nav = document.getElementById('navBar');
  let html = '';
  NAV_GROUPS.forEach(g=>{
    if (g.single){
      html += `<button class="nav-single" id="navbtn-${g.id}" onclick="switchView('${g.id}')">${ic(g.icon)}<span>${g.label}</span></button>`;
    } else {
      html += `<div class="nav-group" id="navgrp-${g.id}">
        <button class="nav-group-head" onclick="toggleNavGroup('${g.id}')">${ic(g.icon)}<span>${g.label}</span><span class="chev">▸</span></button>
        <div class="nav-sub">${g.children.map(c=>`<button id="navbtn-${c.id}" onclick="switchView('${c.id}')">${c.label}</button>`).join('')}</div>
      </div>`;
    }
  });
  nav.innerHTML = html + `
    <div class="nav-foot">
      Partner Cage Ops<br>CAGE ADMIN 5.0
      <div class="nav-foot-btns">
        <button onclick="confirmCreateBranchTables()">지점 테이블 생성</button>
        <button onclick="confirmSeed()">데모 데이터 생성</button>
        <button onclick="confirmWipe()">데이터 초기화</button>
      </div>
    </div>`;
}
function toggleNavGroup(id){
  const el = document.getElementById('navgrp-'+id);
  const wasOpen = el.classList.contains('open');
  document.querySelectorAll('.nav-group.open').forEach(g=>g.classList.remove('open'));
  if (!wasOpen) el.classList.add('open');
}
function findGroupOf(viewId){
  for (const g of NAV_GROUPS){ if (g.single && g.id===viewId) return g.id; if (g.children && g.children.some(c=>c.id===viewId)) return g.id; }
  return null;
}
function setActiveNav(viewId){
  document.querySelectorAll('.nav-single.active,.nav-sub button.active').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('navbtn-'+viewId);
  if (btn) btn.classList.add('active');
  const gid = findGroupOf(viewId);
  document.querySelectorAll('.nav-group.open').forEach(g=>g.classList.remove('open'));
  if (gid){ const g = document.getElementById('navgrp-'+gid); if (g) g.classList.add('open'); }
}

/* ---------------- boot / auth ---------------- */
window.addEventListener('DOMContentLoaded', ()=>{
  db = cageInitFirebase();
  buildNav();
  document.getElementById('loginLangRow').innerHTML = langSwitcherHtml('loginLangSwitch');
  setInterval(()=>{ document.getElementById('clockTxt').textContent = fmtDt(new Date()); }, 1000);
  ensureDefaultStaff();
  document.getElementById('loginPw').addEventListener('keydown', e=>{ if (e.key==='Enter') doLogin(); });
  clearLoginInputs();
  // Browsers autofill saved passwords asynchronously, after the page has already painted -
  // clearing once on load isn't enough. Nuke it again shortly after, and once more if the
  // page is restored from bfcache (browser back/forward), which skips DOMContentLoaded.
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
    const snap = await db.collection('partnerStaff').limit(1).get();
    if (snap.empty){
      await db.collection('partnerStaff').doc('admin').set({id:'admin', pw:'0000', name:'Eric', role:'master', createdAt: new Date().toISOString()});
    }
  }catch(e){ /* offline first load — fine, login falls back to local default below */ }
}

async function doLogin(){
  const id = document.getElementById('loginId').value.trim() || 'admin';
  const pw = document.getElementById('loginPw').value.trim() || '0000';
  let staff = null;
  try{
    // case-insensitive match: don't rely on the Firestore doc id's exact
    // casing, compare every staff doc's id against the (uppercased) input.
    const snap = await db.collection('partnerStaff').get();
    const found = snap.docs.find(d => String(d.id).toUpperCase() === id.toUpperCase());
    if (found) staff = found.data();
  }catch(e){}
  if (!staff && id.toUpperCase()==='ADMIN' && pw==='0000') staff = {id:'admin', name:'Eric', role:'master'};
  if (!staff || String(staff.pw ?? '0000') !== pw){
    document.getElementById('loginErr').style.display='block';
    return;
  }
  document.getElementById('loginErr').style.display='none';
  CURRENT_STAFF = staff;
  document.getElementById('login-gate').style.display='none';
  document.getElementById('topbar').style.display='flex';
  document.getElementById('shell').style.display='flex';
  document.getElementById('staffNameTxt').textContent = staff.name || staff.id;
  document.getElementById('hdrLangRow').innerHTML = langSwitcherHtml('hdrLangSwitch');
  startLiveSync();
  switchView('dashboard');
}
function doLogout(){
  stopLiveSync();
  CURRENT_STAFF = null;
  document.getElementById('login-gate').style.display='flex';
  document.getElementById('topbar').style.display='none';
  document.getElementById('shell').style.display='none';
  clearLoginInputs();
}
/* ---------------- view dispatch ---------------- */
async function switchView(viewId){
  // Tear down the previous screen's live list subscription (if any) before mounting the next one -
  // otherwise navigating away from a mountListView() screen would leave its onSnapshot listener
  // running forever in the background (a real leak, and it'd keep calling renderListBody() against
  // a #listBody that no longer exists - harmless since that's a no-op, but the live Firestore
  // listener itself doesn't stop just because nothing reads its output anymore).
  if (LIST_UNSUB){ LIST_UNSUB(); LIST_UNSUB = null; }
  CURRENT_VIEW = viewId;
  setActiveNav(viewId);
  const main = document.getElementById('mainArea');
  main.innerHTML = `<div class="loading-wrap"><div class="spin"></div></div>`;
  try{
    const fn = VIEW_RENDERERS[viewId] || renderComingSoon;
    const html = await fn(viewId);
    main.innerHTML = html;
  }catch(e){
    console.error(e);
    main.innerHTML = `<div class="card"><h3>오류</h3><p style="color:var(--danger);">${escapeHtml(e.message||String(e))}</p></div>`;
  }
}
function renderComingSoon(){ return `<div class="card"><h3>준비 중</h3><p class="hint">이 화면은 준비 중입니다.</p></div>`; }
function pageHead(title, sub){
  return `<h2 class="page-title">${title}</h2>${sub?`<p class="page-sub">${sub}</p>`:''}`;
}

/* ---------------- generic helpers ---------------- */
function pill(status, map){
  const cls = (map && map[status]) || 'mute';
  return `<span class="pill ${cls}">${escapeHtml(status??'—')}</span>`;
}
async function fetchAll(coll){
  const snap = await db.collection(coll).get();
  return snap.docs.map(d=>({id:d.id, ...d.data()}));
}
let MEMBER_CACHE = null, BALANCE_CACHE = null, TABLE_CACHE = null;
let LEDGER_CACHE = null, CAGE_LEDGER_CACHE = null;
async function getMembers(force){
  if (!MEMBER_CACHE || force) MEMBER_CACHE = await fetchAll('members');
  return MEMBER_CACHE;
}
async function getTables(force){
  if (!TABLE_CACHE || force) TABLE_CACHE = await fetchAll('tables');
  return TABLE_CACHE;
}
async function getLedger(force){
  if (!LEDGER_CACHE || force) LEDGER_CACHE = await fetchAll('memberLedger');
  return LEDGER_CACHE;
}
// the cage's own book, which is where a cage account's money actually is - see accountBalanceMap
async function getCageLedger(force){
  if (!CAGE_LEDGER_CACHE || force) CAGE_LEDGER_CACHE = await fetchAll('ledger');
  return CAGE_LEDGER_CACHE;
}
async function getBalances(force){
  if (BALANCE_CACHE && !force) return BALANCE_CACHE;
  // the member list is read, not re-read: every caller that forces a balance has either just
  // read the members itself or come through invalidateCaches(), and forcing here made the
  // member screens fetch the whole collection twice to draw once
  const [rows, cageRows, members] = await Promise.all([
    getLedger(force), getCageLedger(force), getMembers(),
  ]);
  BALANCE_CACHE = accountBalanceMap(rows, cageRows, members);
  return BALANCE_CACHE;
}
function invalidateCaches(){
  MEMBER_CACHE=null; BALANCE_CACHE=null; TABLE_CACHE=null; LEDGER_CACHE=null; CAGE_LEDGER_CACHE=null;
}

/* ---- live sync ----
   A balance moves at the cage window or at the table, not on this screen. Money changes repaint
   the numbers where they stand, so a search box keeps its text and an open form is not disturbed;
   a change to the member records themselves - a branch, a nickname, a block applied at the cage -
   redraws the view once the screen is nobody's to finish with. */
let LIVE_UNSUB = null, LIVE_RETRY = null;
function startLiveSync(){
  stopLiveSync();
  LIVE_UNSUB = watchCollections(db, ['members','memberLedger','ledger'], async changed=>{
    invalidateCaches();
    repaintBalances(await getBalances(true));
    if (changed.has('members')) redrawWhenFree();
  });
}
function stopLiveSync(){
  clearTimeout(LIVE_RETRY); LIVE_RETRY = null;
  if (LIVE_UNSUB){ LIVE_UNSUB(); LIVE_UNSUB = null; }
}
function redrawWhenFree(){
  clearTimeout(LIVE_RETRY);
  if (uiIsBusy()){ LIVE_RETRY = setTimeout(redrawWhenFree, 1500); return; }
  switchView(CURRENT_VIEW);
}

/* generic list-view engine, driven by config */
let LIST_STATE = {};
// Set by mountListView while a list screen is mounted; torn down by switchView() on navigation.
let LIST_UNSUB = null;
// Previously this did a single fetchAll() and never looked at the collection again - a screen
// stayed frozen at whatever it looked like on the moment of navigation until the staff member
// manually hit 새로고침 (or switched away and back). Converted to a live onSnapshot subscription so
// all ~40 screens built on this shared engine update in real time - a new deposit request, an
// approval from another terminal, a status change, etc. now appear without any manual action.
// Scope note: only the row DATA is live. cfg.stats() (the summary stat cards above the table) is
// still computed once at initial mount, same as before - re-rendering those live would mean
// regenerating the whole shell (including the search input), which would drop whatever the staff
// member is mid-typing into the search box on every incoming snapshot. Stats catch up next time the
// screen is (re)mounted.
async function mountListView(cfg){
  LIST_STATE = {cfg, rows: [], filtered: [], page:1, pageSize:20, q:'', activeFilters:{}};
  let resolveFirst;
  const firstSnapshot = new Promise(res=>{ resolveFirst = res; });
  LIST_UNSUB = db.collection(cfg.coll).onSnapshot(snap=>{
    let docs = snap.docs.map(d=>({id:d.id, ...d.data()}));
    if (cfg.extraFilter) docs = docs.filter(cfg.extraFilter);
    if (CASINO_FILTER!=='ALL' && cfg.casinoField) docs = docs.filter(d=>d[cfg.casinoField]===CASINO_FILTER);
    let rows = cfg.mapRow ? docs.map(cfg.mapRow) : docs;
    if (cfg.sortKey) rows.sort((a,b)=> cfg.sortDir==='asc' ? (a[cfg.sortKey]>b[cfg.sortKey]?1:-1) : (a[cfg.sortKey]<b[cfg.sortKey]?1:-1));
    LIST_STATE.rows = rows;
    reapplyListFilters();
    if (resolveFirst){ resolveFirst(); resolveFirst = null; }
  }, err=>{
    console.error('mountListView onSnapshot error:', cfg.coll, err);
    if (resolveFirst){ resolveFirst(); resolveFirst = null; } // don't hang the view forever on a permission/offline error
  });
  await firstSnapshot;
  setTimeout(renderListBody, 0); // #listBody only exists once switchView() commits this HTML to the DOM
  return renderListShell();
}
function renderListShell(){
  const {cfg} = LIST_STATE;
  const stats = cfg.stats ? cfg.stats(LIST_STATE.rows) : null;
  let statHtml = '';
  if (stats){
    statHtml = `<div class="grid grid-${Math.min(stats.length,6)}" style="margin-bottom:16px;">` +
      stats.map(s=>`<div class="stat-card${s.danger?' danger':''}"><div class="lbl">${s.label}</div><div class="val">${s.value}</div>${s.delta?`<div class="delta ${s.delta>=0?'pos':'neg'}">${fmtSigned(s.delta)}</div>`:''}</div>`).join('') +
      `</div>`;
  }
  return `
    ${pageHead(cfg.title, cfg.sub)}
    ${statHtml}
    <div class="card">
      <div class="toolbar">
        ${cfg.search!==false ? `<div class="field search-box"><input id="listSearch" placeholder="${cfg.searchPh||'검색어를 입력하세요'}" oninput="onListSearch(this.value)"></div>` : ''}
        ${(cfg.filters||[]).map(f=>`
          <div class="field"><label>${f.label}</label><select onchange="onListFilter('${f.key}', this.value)"><option value="">전체</option>${f.options.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></div>
        `).join('')}
        <div class="toolbar-right">
          ${cfg.onCreate ? `<button class="btn btn-gold btn-sm" onclick="${cfg.onCreate}">+ 생성</button>` : ''}
          <button class="btn btn-sm" onclick="switchView(CURRENT_VIEW)">새로고침</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>${cfg.columns.map(c=>`<th>${c.label}</th>`).join('')}${cfg.rowActions?'<th>관리</th>':''}</tr></thead>
          <tbody id="listBody"></tbody>
        </table>
      </div>
      <div class="pager" id="listPager"></div>
    </div>
  `;
}
function onListSearch(q){
  LIST_STATE.q = q.toLowerCase();
  applyListFilters();
}
LIST_STATE.activeFilters = {};
function onListFilter(key, val){
  LIST_STATE.activeFilters = LIST_STATE.activeFilters || {};
  if (val) LIST_STATE.activeFilters[key] = val; else delete LIST_STATE.activeFilters[key];
  applyListFilters();
}
function applyListFilters(){
  LIST_STATE.page = 1;
  reapplyListFilters();
}
// Recomputes `filtered` from the current rows/search/filter state without resetting the page - used
// both by applyListFilters() (which resets the page itself, for an actual user search/filter
// action) and by mountListView()'s onSnapshot handler (an incoming live update shouldn't yank a
// staff member back to page 1 while they're browsing page 3).
function reapplyListFilters(){
  const {cfg, rows, q, activeFilters} = LIST_STATE;
  let out = rows;
  if (q) out = out.filter(r => (cfg.searchFields||[]).some(f => String(r[f]??'').toLowerCase().includes(q)));
  Object.entries(activeFilters||{}).forEach(([k,v])=>{ out = out.filter(r=> String(r[k])===v); });
  LIST_STATE.filtered = out;
  const pageCount = Math.max(1, Math.ceil(out.length/LIST_STATE.pageSize));
  if (LIST_STATE.page > pageCount) LIST_STATE.page = pageCount;
  renderListBody();
}
function renderListBody(){
  const {cfg, filtered, page, pageSize} = LIST_STATE;
  const start = (page-1)*pageSize;
  const pageRows = filtered.slice(start, start+pageSize);
  const tbody = document.getElementById('listBody');
  if (!tbody) return;
  if (!pageRows.length){
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${cfg.columns.length+(cfg.rowActions?1:0)}">데이터가 없습니다</td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map(row=>{
      const cells = cfg.columns.map(c=>`<td>${renderCell(row,c)}</td>`).join('');
      const clickAttr = cfg.rowClick ? ` class="row-click" onclick="${cfg.rowClick}('${row.id}')"` : '';
      const actions = cfg.rowActions ? `<td>${cfg.rowActions(row)}</td>` : '';
      return `<tr${clickAttr}>${cells}${actions}</tr>`;
    }).join('');
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length/pageSize));
  const pager = document.getElementById('listPager');
  let pagerHtml = `<button ${page<=1?'disabled':''} onclick="gotoListPage(${page-1})">‹</button>`;
  for (let i=1;i<=pageCount;i++){
    if (pageCount>9 && Math.abs(i-page)>3 && i!==1 && i!==pageCount){ if (i===2||i===pageCount-1) pagerHtml+=`<span style="color:var(--ink-faint);">…</span>`; continue; }
    pagerHtml += `<button class="${i===page?'active':''}" onclick="gotoListPage(${i})">${i}</button>`;
  }
  pagerHtml += `<button ${page>=pageCount?'disabled':''} onclick="gotoListPage(${page+1})">›</button>`;
  pager.innerHTML = pagerHtml;
}
function gotoListPage(p){ LIST_STATE.page = p; renderListBody(); }
function renderCell(row, c){
  if (c.render) return c.render(row);
  const v = row[c.key];
  // `live:true` on a money column marks the cell as a member's balance, so the live sync can
  // rewrite it where it stands when money moves at the cage or the table (see repaintBalances)
  if (c.type==='money') return `<span class="num ${Number(v)<0?'neg':Number(v)>0?'pos':''}"${c.live?` data-bal="${escapeHtml(row.id)}"`:''}>${fmtNum(v)}</span>`;
  if (c.type==='dt') return fmtDt(v);
  if (c.type==='date') return fmtDate(v);
  if (c.type==='pill') return pill(v, c.pillMap||{});
  if (c.type==='phone') return maskPhone(v);
  return escapeHtml(v ?? '—');
}

/* ---------------- moving a member's money ----------------
   Every place this panel credits or debits a member goes through here. The memberLedger row is
   the record of the movement and the panel's own book; for an account opened at a cage the
   movement itself belongs in the cage's book, because that book IS that account's balance. A
   memberLedger row on its own was a receipt for a payment the customer never received - the
   number the cage, the player's screen and this panel all read never moved. */
async function creditMember({memberId, casino, amount, category, memo, extra}){
  const signed = Number(amount)||0;
  await db.collection('memberLedger').doc(uuidv4()).set({
    memberId, amount: signed, category, memo,
    ...(casino ? {casino} : {}), ...(extra||{}),
    staff: CURRENT_STAFF?.id||'—', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
  });
  const target = (await getMembers()).find(m=>m.id===memberId);
  if (isCageAccountMember(target)) await cageLedgerWrite(db, {
    accountId: memberId, casino: casino || target.casino,
    type: signed < 0 ? 'OUT' : 'IN', amount: signed,
    memo, staff: CURRENT_STAFF?.id||'—',
  });
}

/* ---------------- balance adjust modal (reused by many screens) ---------------- */
let BALANCE_CTX = null;
function openBalanceModal(memberId, mode, label){
  BALANCE_CTX = {memberId, mode};
  document.getElementById('balanceModalTitle').textContent = label || (mode==='deposit' ? '보유금 지급' : '보유금 차감');
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
  await creditMember({
    memberId: BALANCE_CTX.memberId, amount: signed,
    category: BALANCE_CTX.mode==='withdraw' ? 'withdraw' : 'deposit',
    memo: memo || (BALANCE_CTX.mode==='withdraw' ? '보유금 차감' : '보유금 지급'),
  });
  await db.collection('memberActionLogs').doc(uuidv4()).set({
    memberId: BALANCE_CTX.memberId, action: `${BALANCE_CTX.mode==='withdraw'?'차감':'지급'} ${fmtNum(amt)}`,
    staff: CURRENT_STAFF?.id||'—', dt: new Date().toISOString()
  });
  closeModal('modal-balance');
  toast('처리되었습니다');
  invalidateCaches();
  switchView(CURRENT_VIEW);
}

/* ---------------- confirm modal helper ---------------- */
function askConfirm(title, body, onOk){
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  const btn = document.getElementById('confirmOkBtn');
  btn.onclick = async ()=>{ closeModal('modal-confirm'); await onOk(); };
  openModal('modal-confirm');
}
function confirmSeed(){
  askConfirm('데모 데이터 생성', '회원, 거래, 테이블, 라운드 등 데모 데이터를 Firestore에 생성합니다. 계속할까요?', seedDemoData);
}
function confirmWipe(){
  askConfirm('데이터 초기화', '이 사이트가 생성한 모든 데모 컬렉션을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?', wipeDemoData);
}
function confirmCreateBranchTables(){
  const defs = branchTableDefs();
  const branches = Object.keys(BRANCH_TABLE_CODES).join(', ');
  askConfirm('지점 테이블 생성',
    `${branches} 각 지점에 스피드 ${BRANCH_TABLES_PER_KIND}개 · 아바타 ${BRANCH_TABLES_PER_KIND}개, 모두 ${defs.length}개의 테이블을 만듭니다. ` +
    '이미 있는 테이블은 이름과 타입만 맞추고 베팅 한도·슈 번호·영업 상태는 그대로 둡니다. 계속할까요?',
    createBranchTables);
}
/* Safe to run again: an existing table keeps whatever limits, shoe number and open/closed state
   staff have set on it, and only has its identity (name, type, casino) brought back into line.
   Only a table being created for the first time gets the defaults. */
async function createBranchTables(){
  toast('지점 테이블 생성 중...');
  const defs = branchTableDefs();
  const existing = new Set((await getTables(true)).map(t=>t.id));
  const batch = db.batch();
  let made = 0;
  defs.forEach(d=>{
    const data = existing.has(d.id) ? d : {...d, status:'open', betMin:5000, betMax:3000000, shoeNo:1};
    if (!existing.has(d.id)) made++;
    batch.set(db.collection('tables').doc(d.id), data, {merge:true});
  });
  try {
    await batch.commit();
  } catch (e) {
    console.error('createBranchTables failed:', e);
    toast('지점 테이블 생성에 실패했습니다', true);
    return;
  }
  toast(`지점 테이블 ${defs.length}개 반영 완료 (신규 ${made}개)`);
  invalidateCaches();
  switchView(CURRENT_VIEW);
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function renderDashboard(){
  const members = await getMembers(true);
  const balances = await getBalances(true);
  const ledger = await fetchAll('memberLedger');
  const rounds = await fetchAll('rounds');
  const partners = await fetchAll('partners');
  const totalMembers = members.length;
  const todayStr = fmtDate(new Date());
  const todaySignups = members.filter(m=> fmtDate(m.createdAt)===todayStr).length;
  const byType = {정회원:0,준회원:0,관리회원:0,멀티회원:0};
  members.forEach(m=> byType[m.memberType] = (byType[m.memberType]||0)+1);
  const totalBalance = Object.values(balances).reduce((s,b)=>s+b.balance,0);
  const totalPoints = Object.values(balances).reduce((s,b)=>s+b.points,0);
  const totalComp = Object.values(balances).reduce((s,b)=>s+(b.comp||0),0);
  const isToday = d => fmtDate(d)===todayStr;
  const balanceDeltaToday = ledger.filter(l=>isToday(l.createdAt) && ['deposit','withdraw','bet','payout'].includes(l.category)).reduce((s,l)=>s+l.amount,0);
  const pointsDeltaToday = ledger.filter(l=>isToday(l.createdAt) && ['point_earn','point_convert'].includes(l.category)).reduce((s,l)=>s+l.amount,0);

  // last 16 days signup series, split by member type (matches reference's two paired signup charts)
  const days = [...Array(16)].map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(15-i)); return fmtDate(d); });
  const dayLabels = days.map(d=>d.slice(5));
  const seriesFor = type => days.map(d => members.filter(m=>m.memberType===type && fmtDate(m.createdAt)===d).length);

  // today's hourly activity series (00~23h)
  const hours = [...Array(24)].map((_,h)=>String(h).padStart(2,'0')+':00');
  const todayLedger = ledger.filter(l=>isToday(l.createdAt));
  const uniqueByHour = hours.map((_,h)=> new Set(todayLedger.filter(l=>new Date(l.createdAt).getHours()===h).map(l=>l.memberId)).size);
  const betCountByHour = hours.map((_,h)=> todayLedger.filter(l=>l.category==='bet' && new Date(l.createdAt).getHours()===h).length);
  const betAmountByHour = hours.map((_,h)=> -todayLedger.filter(l=>l.category==='bet' && new Date(l.createdAt).getHours()===h).reduce((s,l)=>s+l.amount,0)/1000);

  setTimeout(()=>{
    const c1 = document.getElementById('dashSignup1'); if (c1) svgBarChart(c1, dayLabels, [{data:seriesFor('정회원'), color:'var(--danger)'},{data:seriesFor('준회원'), color:'#4A9FD8'}]);
    const c2 = document.getElementById('dashSignup2'); if (c2) svgBarChart(c2, dayLabels, [{data:seriesFor('관리회원'), color:'var(--jade)'},{data:seriesFor('멀티회원'), color:'var(--ink-faint)'}]);
    const c3 = document.getElementById('dashActivityDaily'); if (c3) svgLineChart(c3, dayLabels, [{data:days.map(d=>new Set(ledger.filter(l=>fmtDate(l.createdAt)===d).map(l=>l.memberId)).size),color:'#4A9FD8'},{data:days.map(d=>ledger.filter(l=>l.category==='bet'&&fmtDate(l.createdAt)===d).length),color:'var(--brass)'},{data:days.map(d=>-ledger.filter(l=>l.category==='bet'&&fmtDate(l.createdAt)===d).reduce((s,l)=>s+l.amount,0)/1000),color:'var(--jade)'}]);
    const c4 = document.getElementById('dashActivityHourly'); if (c4) svgLineChart(c4, hours, [{data:uniqueByHour,color:'#4A9FD8'},{data:betCountByHour,color:'var(--brass)'},{data:betAmountByHour,color:'var(--jade)'}]);
  }, 0);

  const metric = (label, val) => `<div class="dash-metric"><div class="lbl">${label}</div><div class="val">${fmtNum(val)}</div><div class="mini-bar"></div></div>`;
  const legend = `<div style="display:flex;gap:14px;margin-top:8px;font-size:11px;color:var(--ink-dim);"><span><span style="color:#4A9FD8;">●</span> 유니크 유저</span><span><span style="color:var(--brass);">●</span> 베팅건수</span><span><span style="color:var(--jade);">●</span> 베팅금액</span></div>`;

  return `
    ${pageHead('대시보드', '파트너 전체 현황 요약 · '+ fmtDt(new Date()))}
    <div class="grid grid-2" style="margin-bottom:18px;">
      <div class="card dash-summary-card">
        <h3>총회원</h3>
        <div class="dash-big-val">${fmtNum(totalMembers)}</div>
        <div class="hint">오늘 가입한 회원 ${todaySignups}</div>
        <div class="dash-metric-row">
          ${metric('정회원', byType.정회원)}${metric('준회원', byType.준회원)}${metric('관리회원', byType.관리회원)}${metric('멀티회원', byType.멀티회원)}${metric('파트너', partners.length)}
        </div>
      </div>
      <div class="card dash-summary-card">
        <h3>총 보유금</h3>
        <div class="dash-big-val">PHP ${fmtNum(totalBalance)} <span class="delta ${balanceDeltaToday>=0?'pos':'neg'}">(${balanceDeltaToday>=0?'▲':'▼'}${fmtNum(Math.abs(balanceDeltaToday))})</span></div>
        <div class="hint">어제 수치와 비교</div>
        <div class="dash-metric-row">
          <div class="dash-metric"><div class="lbl">총 포인트</div><div class="val">${fmtNum(totalPoints)} <span class="delta ${pointsDeltaToday>=0?'pos':'neg'}">(${pointsDeltaToday>=0?'▲':'▼'}${fmtNum(Math.abs(pointsDeltaToday))})</span></div><div class="mini-bar"></div></div>
          <div class="dash-metric"><div class="lbl">총 쿱프</div><div class="val">${fmtNum(totalComp)}</div><div class="mini-bar"></div></div>
        </div>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card"><h3>회원가입 현황(정회원,준회원)</h3><div class="hint">${dayLabels[0]} ~ ${dayLabels[dayLabels.length-1]}</div><div id="dashSignup1"></div></div>
      <div class="card"><h3>회원가입 현황(관리회원,멀티회원)</h3><div class="hint">${dayLabels[0]} ~ ${dayLabels[dayLabels.length-1]}</div><div id="dashSignup2"></div></div>
    </div>
    <div class="grid grid-2" style="margin-top:14px;">
      <div class="card"><h3>유저활동 (날짜별)</h3><div class="hint">${dayLabels[0]} ~ ${dayLabels[dayLabels.length-1]}</div><div id="dashActivityDaily"></div>${legend}</div>
      <div class="card"><h3>유저활동 (시간별)</h3><div class="hint">${todayStr} 00:00 ~ 23:00</div><div id="dashActivityHourly"></div>${legend}</div>
    </div>
    <div class="grid grid-2" style="margin-top:14px;">
      <div class="card"><h3>테이블 현황</h3>
        <table><thead><tr><th>테이블</th><th>타입</th><th>카지노</th><th>상태</th><th>진행 라운드</th></tr></thead><tbody>
        ${(await getTables(true)).slice(0,8).map(t=>{
          const cnt = rounds.filter(r=>r.tableId===t.id).length;
          return `<tr><td>${t.name}</td><td>${t.type==='avatar'?'아바타':'스피드'}</td><td>${t.casino}</td><td>${pill(t.status,{open:'ok',closed:'mute'})}</td><td class="num">${fmtNum(cnt)}</td></tr>`;
        }).join('') || `<tr class="empty-row"><td colspan="5">데이터 없음 — 데모 데이터를 생성하세요</td></tr>`}
        </tbody></table>
      </div>
      <div class="card"><h3>최근 관리자 활동</h3>
        <table><thead><tr><th>시간</th><th>관리자</th><th>액션</th></tr></thead><tbody>
        ${(await fetchAll('adminLogs')).sort((a,b)=>new Date(b.dt)-new Date(a.dt)).slice(0,8).map(l=>`<tr><td>${fmtDt(l.dt)}</td><td>${l.staff}</td><td>${l.action}</td></tr>`).join('') || `<tr class="empty-row"><td colspan="3">데이터 없음</td></tr>`}
        </tbody></table>
      </div>
    </div>
  `;
}

/* ============================================================
   내 정보 관리 (myinfo)
   ============================================================ */
async function renderMyInfo(){
  const s = CURRENT_STAFF || {};
  return `
    ${pageHead('내 정보 관리')}
    <div class="grid grid-2">
      <div class="card"><h3>계정 정보</h3>
        <div class="field"><label>ID</label><input value="${s.id||''}" disabled></div>
        <div class="field"><label>이름</label><input id="myName" value="${s.name||''}"></div>
        <div class="field"><label>권한</label><input value="${s.role==='master'?'마스터':'운영자'}" disabled></div>
        <button class="btn btn-gold" onclick="saveMyInfo()">저장</button>
      </div>
      <div class="card"><h3>비밀번호 변경</h3>
        <div class="field"><label>현재 비밀번호</label><input type="password" id="curPw"></div>
        <div class="field"><label>새 비밀번호</label><input type="password" id="newPw"></div>
        <div class="field"><label>새 비밀번호 확인</label><input type="password" id="newPw2"></div>
        <button class="btn btn-gold" onclick="changeMyPw()">변경</button>
      </div>
    </div>
  `;
}
async function saveMyInfo(){
  const name = document.getElementById('myName').value.trim();
  if (!name) return;
  await db.collection('partnerStaff').doc(CURRENT_STAFF.id).set({name}, {merge:true});
  CURRENT_STAFF.name = name;
  document.getElementById('staffNameTxt').textContent = name;
  toast('저장되었습니다');
}
async function changeMyPw(){
  const cur = document.getElementById('curPw').value, n1 = document.getElementById('newPw').value, n2 = document.getElementById('newPw2').value;
  if (String(CURRENT_STAFF.pw ?? '0000') !== cur){ toast('현재 비밀번호가 일치하지 않습니다', true); return; }
  if (!n1 || n1 !== n2){ toast('새 비밀번호를 확인해주세요', true); return; }
  await db.collection('partnerStaff').doc(CURRENT_STAFF.id).set({pw:n1}, {merge:true});
  CURRENT_STAFF.pw = n1;
  toast('비밀번호가 변경되었습니다');
}

/* ============================================================
   실시간 접속자 (realtime)
   ============================================================ */
async function renderRealtime(){
  const members = await getMembers(true);
  const now = Date.now();
  const online = members.filter(m => m.lastLoginAt && (now - new Date(m.lastLoginAt).getTime()) < 1000*60*60*6);
  const byCasino = {};
  CASINOS.forEach(c=>byCasino[c]=online.filter(m=>m.casino===c).length);
  return `
    ${pageHead('실시간 접속자', '최근 6시간 이내 로그인 기준 (데모)')}
    <div class="grid grid-4" style="margin-bottom:16px;">
      <div class="stat-card"><div class="lbl">총 접속자</div><div class="val">${fmtNum(online.length)}</div></div>
      ${CASINOS.map(c=>`<div class="stat-card"><div class="lbl">${c}</div><div class="val">${fmtNum(byCasino[c])}</div></div>`).join('')}
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
   계정 관리 (account) — bespoke interactive list
   ============================================================ */
async function renderAccount(){
  const members = await getMembers(true);
  const balances = await getBalances(true);
  const rows = members.filter(m=>CASINO_FILTER==='ALL'||m.casino===CASINO_FILTER);
  window.__acctRows = rows;
  return `
    ${pageHead('계정 관리')}
    <div class="card">
      <div class="toolbar">
        <div class="field search-box"><input id="acctSearch" placeholder="ID/닉네임 검색" oninput="filterAcctTable(this.value)"></div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>아이디</th><th>닉네임</th><th>보유금액</th><th>보유금액 관리</th><th>베팅최대금액</th><th>베팅최소금액</th><th>비밀번호 관리</th><th>상태관리</th>
      </tr></thead><tbody id="acctBody">
      ${rows.map(m=>acctRowHtml(m, balances[m.id]?.balance||0)).join('') || `<tr class="empty-row"><td colspan="8">데이터가 없습니다</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}
function acctRowHtml(m, bal){
  return `<tr id="acctrow-${m.id}">
    <td>${escapeHtml(m.id)}</td><td>${escapeHtml(m.nickname||'—')}</td>
    <td><span class="num ${bal<0?'neg':bal>0?'pos':''}" data-bal="${escapeHtml(m.id)}">${fmtNum(bal)}</span></td>
    <td><button class="btn btn-xs btn-jade" onclick="openBalanceModal('${m.id}','deposit','보유금 추가')">+ 추가</button>
        <button class="btn btn-xs btn-danger" onclick="openBalanceModal('${m.id}','withdraw','보유금 차감')">− 차감</button></td>
    <td><span class="num">${fmtNum(m.betMax||0)}</span></td>
    <td><span class="num">${fmtNum(m.betMin||0)}</span></td>
    <td><button class="btn btn-xs" onclick="resetMemberPw('${m.id}')">비밀번호 초기화</button></td>
    <td>${m.status==='정상'?`<button class="btn btn-xs btn-danger" onclick="toggleMemberStatus('${m.id}','정지')">정지</button>`:`<button class="btn btn-xs btn-jade" onclick="toggleMemberStatus('${m.id}','정상')">정상화</button>`} <span class="pill ${m.status==='정상'?'ok':'bad'}">${m.status}</span></td>
  </tr>`;
}
function filterAcctTable(q){
  q = q.toLowerCase();
  const rows = (window.__acctRows||[]).filter(m => !q || m.id.toLowerCase().includes(q) || (m.nickname||'').toLowerCase().includes(q));
  getBalances().then(balances=>{
    document.getElementById('acctBody').innerHTML = rows.map(m=>acctRowHtml(m, balances[m.id]?.balance||0)).join('') || `<tr class="empty-row"><td colspan="8">데이터가 없습니다</td></tr>`;
  });
}
async function resetMemberPw(id){
  await db.collection('members').doc(id).set({pw:'0000'}, {merge:true});
  await db.collection('memberActionLogs').doc(uuidv4()).set({memberId:id, action:'비밀번호 초기화', staff:CURRENT_STAFF?.id||'—', dt:new Date().toISOString()});
  toast(`${id}의 비밀번호가 초기화되었습니다 (0000)`);
}
async function toggleMemberStatus(id, status){
  await db.collection('members').doc(id).set({status}, {merge:true});
  await db.collection('memberActionLogs').doc(uuidv4()).set({memberId:id, action:`상태변경 → ${status}`, staff:CURRENT_STAFF?.id||'—', dt:new Date().toISOString()});
  toast('상태가 변경되었습니다');
  invalidateCaches();
  switchView(CURRENT_VIEW);
}

/* ============================================================
   파트너 정산 리포트 (settlementReport)
   ============================================================ */
async function renderSettlementReport(){
  const partners = await fetchAll('partners');
  const shareLedger = await fetchAll('shareLedger');
  const byPartner = {};
  shareLedger.forEach(s=>{ byPartner[s.partnerCode] = (byPartner[s.partnerCode]||0) + Number(s.amount||0); });
  const rows = partners.map(p=>({...p, accum: byPartner[p.id]||0}));
  return mountListView({
    title:'파트너 정산 리포트', sub:'파트너(에이전트)별 쉐어 정산 누계',
    coll:'partners', search:true, searchFields:['id','name'], searchPh:'파트너 코드 검색',
    columns:[
      {key:'id', label:'파트너 코드'}, {key:'name', label:'이름'}, {key:'parentCode', label:'상위코드'},
      {key:'shareRate', label:'쉐어율', render:r=>`${r.shareRate}%`}, {key:'accum', label:'정산누계', type:'money'},
      {key:'status', label:'상태', type:'pill', pillMap:{active:'ok', inactive:'mute'}},
    ],
    mapRow: p => ({...p, accum: byPartner[p.id]||0}),
    stats: rs => [
      {label:'파트너 수', value: fmtNum(rs.length)},
      {label:'정산 누계 합계', value: fmtNum(rs.reduce((s,r)=>s+r.accum,0))},
    ],
  });
}

/* ============================================================
   MEMBER GROUP
   ============================================================ */
async function renderUserList(){
  const balances = await getBalances(true);
  return mountListView({
    title:'유저 리스트', sub:'전체 회원 목록',
    coll:'members', casinoField:'casino', search:true, searchFields:['id','nickname','phone'], searchPh:'ID/닉네임/전화번호 검색',
    filters:[
      {key:'parentAgent', label:'에이전트', options:['VIP88','NUSTARMS']},
      {key:'memberType', label:'회원유형', options:['정회원','준회원','관리회원','멀티회원']},
      {key:'status', label:'로그인 상태', options:['정상','정지','블랙리스트']},
    ],
    onCreate:'openCreateMemberForm()',
    columns:[
      {key:'id', label:'ID'}, {key:'casino', label:'CASINO'}, {key:'id', label:'어카운트'}, {key:'nickname', label:'닉네임'},
      {key:'phone', label:'핸드폰 번호', type:'phone'}, {key:'telegram', label:'텔레그램 주소', render:r=>r.telegram||'—'},
      {key:'memberType', label:'회원유형'}, {key:'parentAgent', label:'상위 어카운트'},
      {key:'winLoss', label:'윈로스', type:'money'}, {key:'balance', label:'보유금', type:'money', live:true},
      {key:'rolling', label:'롤링', type:'money'}, {key:'rollingComm', label:'롤링 커미션', type:'money'},
      {key:'netRevenue', label:'내 수익금', type:'money'}, {key:'points', label:'보유 포인트', type:'money'},
      {key:'depositPhp', label:'입금 PHP', type:'money'}, {key:'withdrawPhp', label:'출금 PHP', type:'money'},
      {key:'status', label:'상태', type:'pill', pillMap:{정상:'ok', 정지:'bad', 블랙리스트:'bad'}},
      {key:'createdAt', label:'가입일', type:'date'},
    ],
    mapRow: m => {
      const b = balances[m.id] || {balance:0, points:0, deposit:0, withdraw:0, bet:0, payout:0};
      const rolling = -b.bet;
      const rollingComm = rolling * 0.015;
      const winLoss = b.payout + b.bet;
      return {...m, balance:b.balance, points:b.points, rolling, rollingComm, winLoss, netRevenue:-winLoss, depositPhp:b.deposit, withdrawPhp:-b.withdraw};
    },
    rowClick: 'openMemberDetail',
    sortKey:'createdAt', sortDir:'desc',
    stats: rs => [
      {label:'총회원', value: fmtNum(rs.length)},
      {label:'정회원', value: fmtNum(rs.filter(r=>r.memberType==='정회원').length)},
      {label:'준회원', value: fmtNum(rs.filter(r=>r.memberType==='준회원').length)},
      {label:'관리회원', value: fmtNum(rs.filter(r=>r.memberType==='관리회원').length)},
      {label:'멀티회원', value: fmtNum(rs.filter(r=>r.memberType==='멀티회원').length)},
      {label:'정상회원', value: fmtNum(rs.filter(r=>r.status==='정상').length)},
      {label:'정지회원', value: fmtNum(rs.filter(r=>r.status!=='정상').length), danger:true},
    ],
  });
}
function openCreateMemberForm(){
  document.getElementById('formModalTitle').textContent = '회원 생성';
  document.getElementById('formModalBody').innerHTML = `
    <div class="row"><div class="field"><label>ID</label><input id="nfId"></div><div class="field"><label>닉네임</label><input id="nfNick"></div></div>
    <div class="row"><div class="field"><label>전화번호</label><input id="nfPhone"></div><div class="field"><label>카지노</label><select id="nfCasino">${CASINOS.map(c=>`<option>${c}</option>`).join('')}</select></div></div>
    <div class="row"><div class="field"><label>상위 에이전트</label><input id="nfAgent" value="VIP88"></div><div class="field"><label>회원유형</label><select id="nfType"><option>정회원</option><option>준회원</option><option>관리회원</option><option>멀티회원</option></select></div></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const id = document.getElementById('nfId').value.trim().toUpperCase();
    if (!id){ toast('ID를 입력하세요', true); return; }
    await db.collection('members').doc(id).set({
      id, nickname: document.getElementById('nfNick').value, phone: document.getElementById('nfPhone').value,
      casino: document.getElementById('nfCasino').value, parentAgent: document.getElementById('nfAgent').value,
      memberType: document.getElementById('nfType').value, status:'정상', betMax:1000000, betMin:5000,
      pw:'0000', withdrawPw:'0000', createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(),
    });
    closeModal('modal-form'); toast('회원이 생성되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}

async function openMemberDetail(memberId){
  const m = (await getMembers()).find(x=>x.id===memberId) || {};
  const balances = await getBalances();
  const bal = balances[memberId] || {balance:0, points:0};
  document.getElementById('detailTitle').textContent = `회원 상세정보 · ${memberId}`;
  document.getElementById('detailSub').textContent = `${m.nickname||''} · ${m.casino||''} · ${m.memberType||''}`;
  const tabs = ['상세 회원정보','어카운트 정보','베팅내역','입출금','포인트 누적 내역','활동내역','접속내역','문의내역'];
  document.getElementById('detailTabs').innerHTML = tabs.map((t,i)=>`<button class="${i===0?'active':''}" onclick="switchDetailTab(this,'${memberId}','${t}')">${t}</button>`).join('');
  await renderDetailTab(memberId, tabs[0]);
  openModal('modal-detail');
}
function switchDetailTab(btn, memberId, tab){
  document.querySelectorAll('#detailTabs button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderDetailTab(memberId, tab);
}
async function renderDetailTab(memberId, tab){
  const body = document.getElementById('detailBody');
  body.innerHTML = `<div class="spin"></div>`;
  const m = (await getMembers()).find(x=>x.id===memberId) || {};
  const ledger = (await fetchAll('memberLedger')).filter(l=>l.memberId===memberId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  let html = '';
  if (tab==='상세 회원정보'){
    html = `<div class="kv-grid">
      <span>ID</span><b>${escapeHtml(m.id)}</b><span>닉네임</span><b>${escapeHtml(m.nickname||'—')}</b>
      <span>전화번호</span><b>${maskPhone(m.phone)}</b><span>텔레그램</span><b>${escapeHtml(m.telegram||'—')}</b>
      <span>카지노</span><b>${escapeHtml(m.casino)}</b><span>상위 에이전트</span><b>${escapeHtml(m.parentAgent||'—')}</b>
      <span>회원유형</span><b>${escapeHtml(m.memberType)}</b><span>상태</span><b>${escapeHtml(m.status)}</b>
      <span>베팅최대금액</span><b>${fmtNum(m.betMax)}</b><span>베팅최소금액</span><b>${fmtNum(m.betMin)}</b>
      <span>가입일</span><b>${fmtDt(m.createdAt)}</b><span>최근접속</span><b>${fmtDt(m.lastLoginAt)}</b>
    </div>`;
  } else if (tab==='어카운트 정보'){
    const b = (await getBalances())[memberId] || {};
    html = `<div class="kv-grid">
      <span>보유금</span><b class="num">${fmtNum(b.balance||0)}</b><span>보유 포인트</span><b class="num">${fmtNum(b.points||0)}</b>
      <span>누적입금</span><b class="num">${fmtNum(b.deposit||0)}</b><span>누적출금</span><b class="num">${fmtNum(-b.withdraw||0)}</b>
      <span>누적베팅</span><b class="num">${fmtNum(-b.bet||0)}</b><span>누적 페이아웃</span><b class="num">${fmtNum(b.payout||0)}</b>
    </div>`;
  } else if (tab==='베팅내역'){
    const rows = ledger.filter(l=>l.category==='bet'||l.category==='payout');
    html = simpleTable(['시간','구분','테이블','금액'], rows.map(r=>[fmtDt(r.createdAt), r.category==='bet'?'베팅':'페이아웃', r.relatedTableId||'—', `<span class="num ${r.amount<0?'neg':'pos'}">${fmtSigned(r.amount)}</span>`]));
  } else if (tab==='입출금'){
    const rows = ledger.filter(l=>l.category==='deposit'||l.category==='withdraw');
    html = simpleTable(['시간','구분','금액','메모','처리자'], rows.map(r=>[fmtDt(r.createdAt), r.category==='deposit'?'입금':'출금', `<span class="num ${r.amount<0?'neg':'pos'}">${fmtSigned(r.amount)}</span>`, r.memo||'—', r.staff||'—']));
  } else if (tab==='포인트 누적 내역'){
    const rows = ledger.filter(l=>l.category==='point_earn'||l.category==='point_convert');
    html = simpleTable(['시간','구분','포인트'], rows.map(r=>[fmtDt(r.createdAt), r.category==='point_earn'?'적립':'전환', `<span class="num ${r.amount<0?'neg':'pos'}">${fmtSigned(r.amount)}</span>`]));
  } else if (tab==='활동내역'){
    const rows = (await fetchAll('memberActionLogs')).filter(l=>l.memberId===memberId).sort((a,b)=>new Date(b.dt)-new Date(a.dt));
    html = simpleTable(['시간','액션','처리자'], rows.map(r=>[fmtDt(r.dt), r.action, r.staff]));
  } else if (tab==='접속내역'){
    html = simpleTable(['시간','IP','기기'], [[fmtDt(m.lastLoginAt), '203.0.113.'+((memberId.charCodeAt(2)||50)%255), 'Web/Chrome']]);
  } else if (tab==='문의내역'){
    const rows = (await fetchAll('inquiries')).filter(l=>l.memberId===memberId).sort((a,b)=>new Date(b.dt)-new Date(a.dt));
    html = simpleTable(['시간','제목','상태'], rows.map(r=>[fmtDt(r.dt), r.title, pill(r.status,{대기:'warn','답변완료':'ok'})]));
  }
  body.innerHTML = html || `<p class="hint">데이터가 없습니다</p>`;
}
function simpleTable(headers, rows){
  if (!rows.length) return `<p class="hint">데이터가 없습니다</p>`;
  return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function renderBetHistory(){
  const rounds = await fetchAll('rounds');
  const roundMap = {}; rounds.forEach(r=>roundMap[r.id]=r);
  return mountListView({
    title:'베팅내역', sub:'전체 회원 베팅 내역',
    coll:'memberLedger', extraFilter:l=>l.category==='bet', search:true, searchFields:['memberId'], searchPh:'회원ID 검색',
    columns:[
      {key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'relatedTableId', label:'테이블'},
      {key:'result', label:'결과', render:r=>{ const rd = roundMap[r.relatedRoundId]; return rd ? pill(rd.result==='player'?'플레이어':rd.result==='banker'?'뱅커':'타이', {플레이어:'ok', 뱅커:'bad', 타이:'warn'}) : '—'; }},
      {key:'amount', label:'베팅금액', type:'money'},
    ],
    sortKey:'createdAt', sortDir:'desc',
    stats: rs => [{label:'베팅 건수', value: fmtNum(rs.length)}, {label:'베팅 총액', value: fmtNum(-rs.reduce((s,r)=>s+r.amount,0))}],
  });
}
async function renderPayoutHistory(){
  return mountListView({
    title:'지급내역', sub:'승리 페이아웃 지급 내역',
    coll:'memberLedger', extraFilter:l=>l.category==='payout', search:true, searchFields:['memberId'], searchPh:'회원ID 검색',
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'relatedTableId', label:'테이블'}, {key:'amount', label:'지급금액', type:'money'}],
    sortKey:'createdAt', sortDir:'desc',
    stats: rs => [{label:'지급 건수', value: fmtNum(rs.length)}, {label:'지급 총액', value: fmtNum(rs.reduce((s,r)=>s+r.amount,0))}],
  });
}
async function renderPointAccum(){
  return mountListView({
    title:'포인트 누적 내역', coll:'memberLedger', extraFilter:l=>l.category==='point_earn', search:true, searchFields:['memberId'],
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'amount', label:'적립 포인트', type:'money'}, {key:'memo', label:'사유'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}
async function renderPointConversion(){
  return mountListView({
    title:'포인트 전환 리스트', coll:'memberLedger', extraFilter:l=>l.category==='point_convert', search:true, searchFields:['memberId'],
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'amount', label:'전환금액', type:'money'}, {key:'memo', label:'비고'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}
async function renderShareMgmt(){
  return mountListView({
    title:'쉐어 관리', sub:'파트너 쉐어율 설정', coll:'partners', search:true, searchFields:['id','name'], onCreate:'openCreatePartnerForm()',
    columns:[{key:'id', label:'코드'}, {key:'name', label:'이름'}, {key:'parentCode', label:'상위코드'}, {key:'level', label:'레벨'}, {key:'shareRate', label:'쉐어율(%)'}, {key:'status', label:'상태', type:'pill', pillMap:{active:'ok', inactive:'mute'}}],
    rowActions: r => `<button class="btn btn-xs" onclick="editShareRate('${r.id}', ${r.shareRate})">쉐어 파트너 설정</button>`,
  });
}
function openCreatePartnerForm(){
  document.getElementById('formModalTitle').textContent = '파트너 생성';
  document.getElementById('formModalBody').innerHTML = `
    <div class="row"><div class="field"><label>파트너 코드</label><input id="pfCode"></div><div class="field"><label>이름</label><input id="pfName"></div></div>
    <div class="row"><div class="field"><label>상위코드</label><input id="pfParent" value="MAIN"></div><div class="field"><label>쉐어율(%)</label><input id="pfRate" value="0.5"></div></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const code = document.getElementById('pfCode').value.trim().toUpperCase();
    if (!code) { toast('코드를 입력하세요', true); return; }
    await db.collection('partners').doc(code).set({id:code, name:document.getElementById('pfName').value, parentCode:document.getElementById('pfParent').value, shareRate:Number(document.getElementById('pfRate').value)||0, level:1, status:'active', createdAt:new Date().toISOString()});
    closeModal('modal-form'); toast('파트너가 생성되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
function editShareRate(code, cur){
  document.getElementById('formModalTitle').textContent = `쉐어 파트너 설정 · ${code}`;
  document.getElementById('formModalBody').innerHTML = `<div class="field"><label>쉐어율(%)</label><input id="srInput" value="${cur}"></div>`;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('partners').doc(code).set({shareRate:Number(document.getElementById('srInput').value)||0}, {merge:true});
    closeModal('modal-form'); toast('쉐어율이 변경되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function renderDepositMgmt(){
  return mountListView({
    title:'디파짓 관리', sub:'회원 디파짓 요청 내역', coll:'depositRequests', search:true, searchFields:['memberId'],
    filters:[{key:'status', label:'상태', options:['대기','승인','거절']}],
    columns:[{key:'dt', label:'요청시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'amount', label:'금액', type:'money'}, {key:'method', label:'방법'}, {key:'status', label:'상태', type:'pill', pillMap:{대기:'warn', 승인:'ok', 거절:'bad'}}],
    rowActions: r => r.status==='대기' ? `<button class="btn btn-xs btn-jade" onclick="approveDeposit('${r.id}')">승인</button> <button class="btn btn-xs btn-danger" onclick="rejectDeposit('${r.id}')">거절</button>` : '—',
    sortKey:'dt', sortDir:'desc',
  });
}
// Approve/reject read the request's current status and flip it inside a single transaction, so
// a double-click or two staff acting on the same request at once can't both pass the '대기' check
// and both append a memberLedger credit (or leave the request in a contradictory state).
async function approveDeposit(id){
  const ref = db.collection('depositRequests').doc(id);
  let d;
  try {
    await db.runTransaction(async tx=>{
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('NOT_FOUND');
      d = doc.data();
      if (d.status !== '대기') throw new Error('ALREADY_PROCESSED');
      tx.set(ref, {status:'승인'}, {merge:true});
    });
  } catch (e) {
    if (e.message === 'ALREADY_PROCESSED'){ toast('이미 처리된 요청입니다'); switchView(CURRENT_VIEW); return; }
    if (e.message === 'NOT_FOUND'){ toast('요청을 찾을 수 없습니다'); switchView(CURRENT_VIEW); return; }
    throw e;
  }
  await creditMember({memberId:d.memberId, amount:Math.abs(d.amount), category:'deposit', memo:'디파짓 승인'});
  toast('승인되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
}
async function rejectDeposit(id){
  const ref = db.collection('depositRequests').doc(id);
  try {
    await db.runTransaction(async tx=>{
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('NOT_FOUND');
      if (doc.data().status !== '대기') throw new Error('ALREADY_PROCESSED');
      tx.set(ref, {status:'거절'}, {merge:true});
    });
  } catch (e) {
    if (e.message === 'ALREADY_PROCESSED'){ toast('이미 처리된 요청입니다'); switchView(CURRENT_VIEW); return; }
    if (e.message === 'NOT_FOUND'){ toast('요청을 찾을 수 없습니다'); switchView(CURRENT_VIEW); return; }
    throw e;
  }
  toast('거절되었습니다'); switchView(CURRENT_VIEW);
}
async function renderShareAccumList(){
  return mountListView({
    title:'쉐어 누적 리스트', coll:'shareLedger', search:true, searchFields:['partnerCode'],
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'partnerCode', label:'파트너 코드'}, {key:'category', label:'구분'}, {key:'amount', label:'금액', type:'money'}, {key:'memo', label:'메모'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}
async function renderShareSettingLog(){
  return mountListView({
    title:'쉐어 설정 로그', coll:'adminLogs', extraFilter:l=>String(l.action||'').includes('쉐어'), search:true, searchFields:['staff'],
    columns:[{key:'dt', label:'시간', type:'dt'}, {key:'staff', label:'관리자'}, {key:'action', label:'액션'}, {key:'target', label:'대상'}],
    sortKey:'dt', sortDir:'desc',
  });
}
async function renderDailyReport(){
  const ledger = await fetchAll('memberLedger');
  const days = [...Array(14)].map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(13-i)); return fmtDate(d); }).reverse();
  const rows = days.map(day=>{
    const dayRows = ledger.filter(l=>fmtDate(l.createdAt)===day);
    return {
      id: day, day,
      deposit: dayRows.filter(l=>l.category==='deposit').reduce((s,l)=>s+l.amount,0),
      withdraw: -dayRows.filter(l=>l.category==='withdraw').reduce((s,l)=>s+l.amount,0),
      bet: -dayRows.filter(l=>l.category==='bet').reduce((s,l)=>s+l.amount,0),
      payout: dayRows.filter(l=>l.category==='payout').reduce((s,l)=>s+l.amount,0),
      users: new Set(dayRows.map(l=>l.memberId)).size,
    };
  });
  rows.forEach(r=> r.winloss = r.bet - r.payout);
  return `
    ${pageHead('데일리 리포트')}
    <div class="card"><div class="table-wrap"><table><thead><tr><th>일자</th><th>순유저</th><th>입금</th><th>출금</th><th>베팅액</th><th>페이아웃</th><th>윈로스</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${r.day}</td><td class="num">${fmtNum(r.users)}</td><td class="num pos">${fmtNum(r.deposit)}</td><td class="num neg">${fmtNum(r.withdraw)}</td><td class="num">${fmtNum(r.bet)}</td><td class="num">${fmtNum(r.payout)}</td><td class="num ${r.winloss>=0?'pos':'neg'}">${fmtSigned(r.winloss)}</td></tr>`).join('')}
    </tbody></table></div></div>
  `;
}

/* ============================================================
   STATS GROUP (single component, 9 sub-tabs)
   ============================================================ */
const STATS_TABS = ['마켓비율','입출금 내역','실적 비교','실시간 위험 감지','고액 베팅','리더보드','회원 활동','회원가입 현황','베팅현황'];
async function renderStatsTab(tabId){
  setTimeout(()=>renderStatsBody(tabId), 0);
  return `
    ${pageHead('통계')}
    <div class="tabs-mini">${STATS_TABS.map(t=>{
      const vid = statsTabToViewId(t);
      return `<button class="${vid===tabId?'active':''}" onclick="switchView('${vid}')">${t}</button>`;
    }).join('')}</div>
    <div id="statsBody"><div class="spin"></div></div>
  `;
}
function statsTabToViewId(t){
  return {마켓비율:'marketRatio', '입출금 내역':'depositWithdrawStats', '실적 비교':'performanceCompare', '실시간 위험 감지':'realtimeRisk', '고액 베팅':'highBet', 리더보드:'leaderboard', '회원 활동':'memberActivity', '회원가입 현황':'signupStatus', 베팅현황:'bettingStatus'}[t];
}
async function renderStatsBody(tabId){
  const body = document.getElementById('statsBody');
  if (!body) return;
  const ledger = await fetchAll('memberLedger');
  const members = await getMembers();
  const rounds = await fetchAll('rounds');
  let html = '';
  if (tabId==='marketRatio'){
    const tables = await getTables();
    const tableType = {}; tables.forEach(t=>tableType[t.id]=t.type);
    const scopes = [{key:'all', label:'전체 게임'}, {key:'speed', label:'스피드'}, {key:'avatar', label:'아바타'}, {key:'live', label:'라이브'}, {key:'highpay', label:'하이피'}];
    const outcomes = ['player','banker','tie'];
    const outcomeLabel = {player:'플레이어', banker:'뱅커', tie:'타이'};
    const scopeRoundResults = scopes.map(sc => {
      const rs = rounds.filter(r => sc.key==='all' ? true : tableType[r.tableId]===sc.key);
      const counts = outcomes.map(o => rs.filter(r=>r.result===o).length);
      return {sc, rs, segments: outcomes.map((o,i)=>({label:outcomeLabel[o], value:counts[i], color: o==='player'?'#4A9FD8':o==='banker'?'var(--danger)':'var(--jade)'}))};
    });
    html = `<div class="grid" style="grid-template-columns:repeat(5,1fr);gap:14px;">
      ${scopeRoundResults.map(({sc,segments})=>`<div class="card"><h3>${sc.label}</h3><div id="donut-${sc.key}"></div></div>`).join('')}
    </div>
    <div class="table-wrap" style="margin-top:14px;"><table><thead><tr><th>종목</th>
      ${outcomes.map(o=>`<th colspan="4" style="text-align:center;">${outcomeLabel[o]}</th>`).join('')}
      </tr><tr><th></th>${outcomes.map(()=>`<th>베팅금액</th><th>베팅건수</th><th>수익</th><th>환수율</th>`).join('')}</tr></thead><tbody>
      ${scopes.map(sc=>{
        const betsInScope = ledger.filter(l=>l.category==='bet' && (sc.key==='all' || tableType[l.relatedTableId]===sc.key));
        const cells = outcomes.map(o=>{
          const bets = betsInScope.filter(l=>l.betType===o);
          const betAmt = -bets.reduce((s,l)=>s+l.amount,0);
          const betCnt = bets.length;
          const rMap = {}; rounds.forEach(r=>rMap[r.id]=r);
          const grossReturn = bets.reduce((s,l)=>{
            const r = rMap[l.relatedRoundId];
            if (!r || r.result!==o) return s;
            const amt = -l.amount;
            return s + (o==='tie' ? amt*9 : Math.round(amt*1.95));
          },0);
          const profit = betAmt - grossReturn;
          const rtp = betAmt ? (profit/betAmt*100) : 0;
          return `<td class="num">${fmtNum(betAmt)}</td><td class="num">${fmtNum(betCnt)}</td><td class="num ${profit>=0?'pos':'neg'}">${fmtSigned(profit)}</td><td class="num ${rtp>=0?'pos':'neg'}">${rtp.toFixed(2)}%</td>`;
        }).join('');
        return `<tr><td>${sc.label}</td>${cells}</tr>`;
      }).join('')}
      </tbody></table></div>`;
    setTimeout(()=>{ scopeRoundResults.forEach(({sc,segments})=>{ const el=document.getElementById('donut-'+sc.key); if (el) svgDonutChart(el, segments); }); },0);
  } else if (tabId==='depositWithdrawStats'){
    const dep = ledger.filter(l=>l.category==='deposit').reduce((s,l)=>s+l.amount,0);
    const wd = -ledger.filter(l=>l.category==='withdraw').reduce((s,l)=>s+l.amount,0);
    html = `<div class="grid grid-3">
      <div class="stat-card"><div class="lbl">누적 입금</div><div class="val">${fmtNum(dep)}</div></div>
      <div class="stat-card"><div class="lbl">누적 출금</div><div class="val">${fmtNum(wd)}</div></div>
      <div class="stat-card ${dep-wd>=0?'':'danger'}"><div class="lbl">순입금</div><div class="val">${fmtSigned(dep-wd)}</div></div>
    </div>`;
  } else if (tabId==='performanceCompare'){
    const byCasino = CASINOS.map(c=>{
      const rows = ledger.filter(l=>l.casino===c);
      const bet = -rows.filter(l=>l.category==='bet').reduce((s,l)=>s+l.amount,0);
      const payout = rows.filter(l=>l.category==='payout').reduce((s,l)=>s+l.amount,0);
      return {c, bet, payout, winloss:bet-payout};
    });
    html = simpleTable(['카지노','베팅액','페이아웃','윈로스'], byCasino.map(r=>[r.c, fmtNum(r.bet), fmtNum(r.payout), `<span class="num ${r.winloss>=0?'pos':'neg'}">${fmtSigned(r.winloss)}</span>`]));
  } else if (tabId==='realtimeRisk'){
    const bigBets = ledger.filter(l=>l.category==='bet' && Math.abs(l.amount)>=500000).slice(0,15);
    html = `<div class="card" style="background:rgba(217,105,90,.06);border-color:var(--danger-dim);margin-bottom:14px;"><h3>실시간 위험 감지</h3><p class="hint">고액 베팅 · 짧은 시간 반복 베팅 등 이상 패턴을 감지합니다 (데모 임계값: 500,000 이상).</p></div>` +
      simpleTable(['시간','회원ID','테이블','베팅액'], bigBets.map(l=>[fmtDt(l.createdAt), l.memberId, l.relatedTableId||'—', `<span class="num neg">${fmtNum(-l.amount)}</span>`]));
  } else if (tabId==='highBet'){
    const bigBets = ledger.filter(l=>l.category==='bet').sort((a,b)=>a.amount-b.amount).slice(0,20);
    html = simpleTable(['시간','회원ID','테이블','베팅액'], bigBets.map(l=>[fmtDt(l.createdAt), l.memberId, l.relatedTableId||'—', `<span class="num neg">${fmtNum(-l.amount)}</span>`]));
  } else if (tabId==='leaderboard'){
    const memberByAgent = {};
    members.forEach(m=>{ memberByAgent[m.parentAgent] = (memberByAgent[m.parentAgent]||0)+1; });
    const byAgent = key => {
      const acc = {};
      ledger.filter(l=>l.category===key).forEach(l=>{
        const m = members.find(x=>x.id===l.memberId);
        const agent = m ? m.parentAgent : null;
        if (!agent) return;
        acc[agent] = (acc[agent]||0) + Math.abs(l.amount);
      });
      return Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,15);
    };
    const rollingByAgent = () => {
      const acc = {};
      ledger.filter(l=>l.category==='bet').forEach(l=>{
        const m = members.find(x=>x.id===l.memberId);
        const agent = m ? m.parentAgent : null;
        if (!agent) return;
        acc[agent] = (acc[agent]||0) + Math.abs(l.amount)*0.015;
      });
      return Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,15);
    };
    const panel = (title, headers, rows) => `<div class="card"><h3>${title}</h3><input class="search-inline" placeholder="검색" style="margin-bottom:8px;">
      <div class="table-wrap" style="max-height:280px;"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${rows.length ? rows.map((r,i)=>`<tr><td>${i+1}</td>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('') : `<tr class="empty-row"><td colspan="${headers.length}">데이터 없음</td></tr>`}
      </tbody></table></div></div>`;
    html = `<div class="grid grid-2">
      ${panel('회원모집', ['파트너','직속회원'], Object.entries(memberByAgent).sort((a,b)=>b[1]-a[1]).map(([a,c])=>[a, fmtNum(c)]))}
      ${panel('입금금액', ['파트너','입금금액'], byAgent('deposit').map(([a,v])=>[a, fmtNum(v)]))}
    </div>
    <div class="grid grid-2" style="margin-top:14px;">
      ${panel('베팅금액', ['파트너','베팅금액'], byAgent('bet').map(([a,v])=>[a, fmtNum(v)]))}
      ${panel('롤링', ['파트너','롤링'], rollingByAgent().map(([a,v])=>[a, fmtNum(v)]))}
    </div>`;
  } else if (tabId==='memberActivity'){
    const days = [...Array(14)].map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(13-i)); return fmtDate(d); });
    const series = days.map(d=>new Set(ledger.filter(l=>fmtDate(l.createdAt)===d).map(l=>l.memberId)).size);
    html = `<div class="card"><h3>일별 활동 유저 수</h3><div id="actChart"></div></div>`;
    setTimeout(()=>{ const el=document.getElementById('actChart'); if(el) svgLineChart(el, days.map(d=>d.slice(5)), [{data:series, color:'var(--brass)'}]); },0);
  } else if (tabId==='signupStatus'){
    const days = [...Array(14)].map((_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(13-i)); return fmtDate(d); });
    const series = days.map(d=>members.filter(m=>fmtDate(m.createdAt)===d).length);
    html = `<div class="card"><h3>일별 회원가입 현황</h3><div id="signChart"></div></div>`;
    setTimeout(()=>{ const el=document.getElementById('signChart'); if(el) svgBarChart(el, days.map(d=>d.slice(5)), [{data:series, color:'var(--jade)'}]); },0);
  } else if (tabId==='bettingStatus'){
    const byType = {};
    rounds.forEach(r=> byType[r.tableType] = (byType[r.tableType]||0)+1);
    html = `<div class="grid grid-2">
      <div class="stat-card"><div class="lbl">아바타 라운드</div><div class="val">${fmtNum(byType.avatar||0)}</div></div>
      <div class="stat-card"><div class="lbl">스피드 라운드</div><div class="val">${fmtNum(byType.speed||0)}</div></div>
    </div>`;
  }
  body.innerHTML = html;
}

/* ============================================================
   TABLE GROUP
   ============================================================ */
async function renderTableList(){
  return mountListView({
    title:'테이블 관리', coll:'tables', search:true, searchFields:['id','name'], onCreate:'openCreateTableForm()',
    filters:[{key:'type', label:'타입', options:['avatar','speed']}],
    columns:[{key:'id', label:'테이블ID'}, {key:'name', label:'이름'}, {key:'type', label:'타입', render:r=>r.type==='avatar'?'아바타':'스피드'}, {key:'casino', label:'카지노'}, {key:'betMin', label:'최소베팅', type:'money'}, {key:'betMax', label:'최대베팅', type:'money'}, {key:'status', label:'상태', type:'pill', pillMap:{open:'ok', closed:'mute'}}],
    rowActions: r => `<button class="btn btn-xs" onclick="editTableSettings('${r.id}')">테이블 설정</button>`,
  });
}
/* Deleting a table is not deleting its history: rounds and 베팅내역 are their own records, keyed
   by table id, and they stay. What goes is the table itself - so a table that is still open
   disappears out from under whoever is at it on the avatar/speed site, which the confirmation
   says in as many words rather than leaving staff to find out. */
async function deleteTable(id){
  /* Read the table itself rather than the cached list. Whether it is open is the whole of what
     the warning below turns on, and staff open and close tables from two other screens - a cache
     filled before that would warn about a table that has since closed and, the way that matters,
     stay quiet about one that has since opened. */
  const t = await db.collection('tables').doc(id).get()
    .then(d=>d.exists ? d.data() : null)
    .catch(e=>{ console.error('deleteTable read failed:', e); return null; });
  if (!t){ toast('테이블을 찾을 수 없습니다', true); invalidateCaches(); return; }
  const label = t.name ? `${id} · ${t.name}` : id;
  askConfirm('테이블 삭제',
    `${label} 테이블을 삭제합니다. ` +
    (t.status === 'open'
      ? '이 테이블은 지금 영업중이라 아바타·스피드 로비에서 곧바로 사라집니다. '
      : '') +
    '지난 라운드와 베팅내역은 그대로 남습니다. 되돌릴 수 없습니다. 계속할까요?',
    async ()=>{
      try {
        await db.collection('tables').doc(id).delete();
      } catch (e) {
        console.error('deleteTable failed:', e);
        toast('테이블 삭제에 실패했습니다', true);
        return;
      }
      invalidateCaches();
      closeModal('modal-form');   // the settings it was pressed from describe a table that is gone
      toast(`${id} 테이블이 삭제되었습니다`);
    });
}
/* 테이블ID is picked, not typed. Every branch's ids are already decided - ten speed and ten
   avatar, NUS01 and its siblings - so a free-text field could only produce a table with an id
   nothing else on the site knows, or a typo. The list is that branch's ids of that type, less
   the ones that already exist.
   Only branches that have a floor are offered: ONLINE has no tables. */
function tableCreateIdOptions(casino, type, existingIds){
  return branchTableDefs()
    .filter(d=>d.casino===casino && d.type===type && !existingIds.has(d.id));
}
function refreshCreateTableIds(){
  const casino = document.getElementById('tfCasino').value;
  const type = document.getElementById('tfType').value;
  const free = tableCreateIdOptions(casino, type, TABLE_CREATE_EXISTING);
  const sel = document.getElementById('tfId');
  sel.innerHTML = free.map(d=>`<option value="${d.id}">${d.id}</option>`).join('');
  sel.disabled = !free.length;
  const hint = document.getElementById('tfIdHint');
  hint.style.display = free.length ? 'none' : '';
  hint.textContent = '이 지점의 해당 타입 테이블은 이미 모두 만들어져 있습니다.';
  syncCreateTableName();
}
function syncCreateTableName(){
  const id = document.getElementById('tfId').value;
  const def = branchTableDefs().find(d=>d.id===id);
  document.getElementById('tfName').value = def ? def.name : '';
}
let TABLE_CREATE_EXISTING = new Set();
async function openCreateTableForm(){
  TABLE_CREATE_EXISTING = new Set((await getTables(true)).map(t=>t.id));
  const branches = Object.keys(BRANCH_TABLE_CODES);
  document.getElementById('formModalTitle').textContent = '테이블 생성';
  document.getElementById('formModalBody').innerHTML = `
    <div class="row"><div class="field"><label>카지노</label><select id="tfCasino" onchange="refreshCreateTableIds()">${branches.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="field"><label>타입</label><select id="tfType" onchange="refreshCreateTableIds()"><option value="speed">스피드</option><option value="avatar">아바타</option></select></div></div>
    <div class="row"><div class="field"><label>테이블ID</label><select id="tfId" onchange="syncCreateTableName()"></select><div class="hint" id="tfIdHint" style="display:none;"></div></div><div class="field"><label>이름</label><input id="tfName"></div></div>
    <div class="row"><div class="field"><label>최소베팅</label><input id="tfMin" value="5,000" oninput="formatNumInput(this)"></div><div class="field"><label>최대베팅</label><input id="tfMax" value="3,000,000" oninput="formatNumInput(this)"></div></div>
  `;
  refreshCreateTableIds();
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const id = document.getElementById('tfId').value;
    if (!id){ toast('만들 수 있는 테이블ID가 없습니다', true); return; }
    await db.collection('tables').doc(id).set({id, name:document.getElementById('tfName').value, type:document.getElementById('tfType').value, casino:document.getElementById('tfCasino').value, betMin:rawNum(document.getElementById('tfMin').value), betMax:rawNum(document.getElementById('tfMax').value), status:'open', shoeNo:1});
    closeModal('modal-form'); toast('테이블이 생성되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function editTableSettings(id){
  /* Read the table itself, not the cached list. This form saves back what it shows, so a stale
     limit here is a stale limit written over a newer one - and staff change these from Cage
     Admin's own table panel too. */
  const t = await db.collection('tables').doc(id).get()
    .then(d=>d.exists ? d.data() : null)
    .catch(e=>{ console.error('editTableSettings read failed:', e); return null; });
  if (!t){ toast('테이블을 찾을 수 없습니다', true); invalidateCaches(); return; }
  document.getElementById('formModalTitle').textContent = `테이블 설정 · ${id}`;
  /* 삭제 lives here rather than on the row: it is the one action on this screen that cannot be
     undone, and a row's worth of buttons is where a mis-click costs the least to make. Opening
     the table's own settings first is a step, and it is the step that shows which table this is. */
  document.getElementById('formModalBody').innerHTML = `
    <div class="row"><div class="field"><label>카지노</label><input value="${escapeHtml(t.casino||'—')}" disabled></div><div class="field"><label>타입</label><input value="${t.type==='speed'?'스피드':'아바타'}" disabled></div></div>
    <div class="row"><div class="field"><label>최소베팅</label><input id="etMin" value="${fmtNum(t.betMin||0)}" oninput="formatNumInput(this)"></div><div class="field"><label>최대베팅</label><input id="etMax" value="${fmtNum(t.betMax||0)}" oninput="formatNumInput(this)"></div></div>
    <div class="field"><label>상태</label><select id="etStatus"><option value="open" ${t.status==='open'?'selected':''}>운영중</option><option value="closed" ${t.status==='closed'?'selected':''}>마감</option></select></div>
    <button class="btn btn-danger btn-block" style="margin-top:14px;" onclick="deleteTable('${id}')">이 테이블 삭제</button>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('tables').doc(id).set({betMin:rawNum(document.getElementById('etMin').value), betMax:rawNum(document.getElementById('etMax').value), status:document.getElementById('etStatus').value}, {merge:true});
    closeModal('modal-form'); toast('저장되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function renderTableBetHistory(){
  return mountListView({
    title:'테이블 베팅내역', coll:'memberLedger', extraFilter:l=>l.category==='bet', search:true, searchFields:['relatedTableId'], searchPh:'테이블ID 검색',
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'relatedTableId', label:'테이블'}, {key:'memberId', label:'회원ID'}, {key:'amount', label:'베팅금액', type:'money'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}

/* ============================================================
   AVATAR GAME GROUP
   ============================================================ */
async function renderAvatarGameList(){
  const tables = (await getTables(true)).filter(t=>t.type==='avatar');
  return `
    ${pageHead('아바타 게임 관리')}
    <div class="tabs-mini">
      <button class="active">아바타 게임 관리</button>
      <button onclick="openAvatarGameSettings()">아바타 게임 설정</button>
      <button onclick="openAvatarDetailSettings()">아바타 설정</button>
    </div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>테이블</th><th>카지노</th><th>슈번호</th><th>상태</th><th>베팅한도</th></tr></thead><tbody>
    ${tables.map(t=>`<tr><td>${t.name}</td><td>${t.casino}</td><td class="num">${t.shoeNo||1}</td><td>${pill(t.status,{open:'ok',closed:'mute'})}</td><td class="num">${fmtNum(t.betMin)} ~ ${fmtNum(t.betMax)}</td></tr>`).join('') || `<tr class="empty-row"><td colspan="5">아바타 테이블이 없습니다</td></tr>`}
    </tbody></table></div></div>
  `;
}
function openAvatarGameSettings(){
  document.getElementById('formModalTitle').textContent = '아바타 게임 설정';
  document.getElementById('formModalBody').innerHTML = `
    <div class="row"><div class="field"><label>베팅 타이머(초)</label><input id="agTimer" value="30"></div><div class="field"><label>최대 동시 테이블</label><input id="agMaxTable" value="6"></div></div>
    <div class="field"><label>딜러 커미션(%)</label><input id="agComm" value="5"></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('cageConfigPartner').doc('avatarGame').set({timer:Number(document.getElementById('agTimer').value), maxTable:Number(document.getElementById('agMaxTable').value), commission:Number(document.getElementById('agComm').value)}, {merge:true});
    closeModal('modal-form'); toast('저장되었습니다');
  };
  openModal('modal-form');
}
function openAvatarDetailSettings(){
  document.getElementById('formModalTitle').textContent = '아바타 상세 설정';
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>아바타 스킨</label><select><option>클래식</option><option>모던</option></select></div>
    <div class="field"><label>테마</label><select><option>다크</option><option>라이트</option></select></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = ()=>{ closeModal('modal-form'); toast('저장되었습니다'); };
  openModal('modal-form');
}
function betSideLabel(side){ return side==='player'?'플레이어':side==='banker'?'뱅커':'타이'; }
async function renderAvatarRequests(){
  const tables = await getTables();
  const tableMap = {}; tables.forEach(t=>tableMap[t.id]=t);
  return mountListView({
    title:'아바타 대리베팅 신청', sub:'회원이 신청한 대리베팅을 승인(담당 아바타 배정)하면, 승인 기간 동안 매 라운드 지정된 베팅이 자동으로 집행됩니다.',
    coll:'avatarRequests', search:true, searchFields:['memberId','tableId'], searchPh:'회원ID/테이블ID 검색',
    filters:[{key:'status', label:'상태', options:['대기','진행중','종료']}],
    columns:[
      {key:'requestedAt', label:'신청시간', type:'dt'},
      {key:'memberId', label:'회원ID'},
      {key:'tableId', label:'테이블', render:r=>tableMap[r.tableId]?.name || r.tableId},
      {key:'casino', label:'카지노'},
      {key:'buyin', label:'바이인', type:'money'},
      /* A request carries a buy-in and nothing else now - the player gives the instruction at the
         table, round by round. Older rows still have the standing one, so it is shown where it
         exists rather than the column being dropped and their history with it. */
      {key:'betSide', label:'베팅지시',
       render:r=>r.betSide ? `${betSideLabel(r.betSide)} ${fmtNum(r.betAmount)}` : '테이블에서 직접'},
      {key:'avatarStaffId', label:'담당 아바타', render:r=>r.avatarStaffId || '—'},
      {key:'status', label:'상태', type:'pill', pillMap:{'대기':'warn','진행중':'ok','종료':'mute'}},
    ],
    rowActions: r => {
      if (r.status==='대기') return `<button class="btn btn-xs btn-gold" onclick="openApproveAvatarRequestModal('${r.id}')">승인</button> <button class="btn btn-xs btn-danger" onclick="rejectAvatarRequest('${r.id}')">거절</button>`;
      if (r.status==='진행중') return `<button class="btn btn-xs btn-danger" onclick="endAvatarRequestByAdmin('${r.id}')">강제 종료</button>`;
      return `<span class="hint">종료됨</span>`;
    },
    sortKey:'requestedAt', sortDir:'desc',
  });
}
function openApproveAvatarRequestModal(id){
  document.getElementById('formModalTitle').textContent = '아바타 대리베팅 승인';
  document.getElementById('formModalBody').innerHTML = `
    <p class="hint">담당 아바타(직원) ID를 입력하면 신청을 승인하고 대리베팅을 시작합니다.</p>
    <div class="field"><label>담당 아바타 ID</label><input id="apStaffId" placeholder="${CURRENT_STAFF?.id||'STAFF01'}" value="${CURRENT_STAFF?.id||''}"></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    const staffId = document.getElementById('apStaffId').value.trim() || CURRENT_STAFF?.id || 'STAFF';
    await db.collection('avatarRequests').doc(id).set({status:'진행중', avatarStaffId:staffId, approvedAt:new Date().toISOString()}, {merge:true});
    await db.collection('adminLogs').doc(uuidv4()).set({staff:CURRENT_STAFF?.id||'—', action:`아바타 대리베팅 승인 (담당:${staffId})`, target:id, dt:new Date().toISOString()});
    closeModal('modal-form'); toast('승인되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function rejectAvatarRequest(id){
  await db.collection('avatarRequests').doc(id).set({status:'종료', endedAt:new Date().toISOString()}, {merge:true});
  await db.collection('adminLogs').doc(uuidv4()).set({staff:CURRENT_STAFF?.id||'—', action:'아바타 대리베팅 거절', target:id, dt:new Date().toISOString()});
  toast('거절되었습니다'); switchView(CURRENT_VIEW);
}
async function endAvatarRequestByAdmin(id){
  await db.collection('avatarRequests').doc(id).set({status:'종료', endedAt:new Date().toISOString()}, {merge:true});
  await db.collection('adminLogs').doc(uuidv4()).set({staff:CURRENT_STAFF?.id||'—', action:'아바타 대리베팅 강제 종료', target:id, dt:new Date().toISOString()});
  toast('종료되었습니다'); switchView(CURRENT_VIEW);
}
async function renderRoundEdit(){
  return mountListView({
    title:'게임 라운드 수정', sub:'특수 케이스(오배당, 엔젤아이 인식오류, 셔플로 인한 결과 미반영 등)는 라운드 취소로 베팅을 전액 환불 처리합니다.',
    coll:'rounds', search:true, searchFields:['tableId'], searchPh:'테이블ID 검색',
    columns:[
      {key:'startedAt', label:'시간', type:'dt'}, {key:'tableId', label:'테이블'}, {key:'roundNo', label:'라운드'},
      {key:'result', label:'결과', render:r=>pill(r.result==='player'?'플레이어':r.result==='banker'?'뱅커':'타이',{플레이어:'ok',뱅커:'bad',타이:'warn'})},
      {key:'cancelled', label:'상태', render:r=>r.cancelled ? pill('취소됨',{'취소됨':'bad'}) : pill('정상',{정상:'ok'})},
    ],
    rowActions: r => r.cancelled ? `<span class="hint">환불완료</span>` : `<button class="btn btn-xs" onclick="openRoundEditModal('${r.id}','${r.result}')">결과 수정</button> <button class="btn btn-xs btn-danger" onclick="openRoundCancelModal('${r.id}','${r.tableId}')">라운드 취소</button>`,
    sortKey:'startedAt', sortDir:'desc',
  });
}
function openRoundEditModal(id, cur){
  document.getElementById('formModalTitle').textContent = `라운드 결과 수정 · ${id.slice(0,8)}`;
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>결과</label><select id="reResult"><option value="player" ${cur==='player'?'selected':''}>플레이어</option><option value="banker" ${cur==='banker'?'selected':''}>뱅커</option><option value="tie" ${cur==='tie'?'selected':''}>타이</option></select></div>
    <div class="field"><label>수정사유</label><textarea id="reReason"></textarea></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('rounds').doc(id).set({result:document.getElementById('reResult').value, editedBy:CURRENT_STAFF?.id||'—', editedReason:document.getElementById('reReason').value}, {merge:true});
    await db.collection('adminLogs').doc(uuidv4()).set({staff:CURRENT_STAFF?.id||'—', action:'게임 라운드 수정', target:id, dt:new Date().toISOString()});
    closeModal('modal-form'); toast('수정되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
function openRoundCancelModal(roundId, tableId){
  document.getElementById('formModalTitle').textContent = `라운드 취소 · ${roundId.slice(0,8)}`;
  document.getElementById('formModalBody').innerHTML = `
    <p class="hint">이 라운드에 걸린 모든 베팅을 전액 환불하고(지급된 페이아웃은 회수), 라운드를 취소 상태로 표시합니다.</p>
    <div class="field"><label>취소 사유</label><select id="rcReason">
      <option value="딜링 오류 (카드 뒤집힘/오배당)">딜링 오류 (카드 뒤집힘/오배당)</option>
      <option value="엔젤아이 인식 오류">엔젤아이 인식 오류</option>
      <option value="장비 이상으로 인한 재셔플">장비 이상으로 인한 재셔플</option>
      <option value="기타">기타</option>
    </select></div>
    <div class="checkbox-row" style="margin-top:10px;"><input type="checkbox" id="rcNotice" checked> 해당 테이블에 인게임 공지 등록</div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{ await submitRoundCancel(roundId, tableId); };
  openModal('modal-form');
}
async function submitRoundCancel(roundId, tableId){
  const reason = document.getElementById('rcReason').value;
  const pushNotice = document.getElementById('rcNotice').checked;
  const roundRef = db.collection('rounds').doc(roundId);
  // Claim the cancellation atomically first (transaction: read cancelled -> flip it) before
  // touching any ledger rows. Only one concurrent call can win this flip from false to true, so a
  // double-click or two staff cancelling the same round at once can no longer both refund/claw
  // back the same bets - the loser sees ALREADY_CANCELLED and does nothing further.
  try {
    await db.runTransaction(async tx=>{
      const doc = await tx.get(roundRef);
      if (doc.exists && doc.data().cancelled) throw new Error('ALREADY_CANCELLED');
      tx.set(roundRef, {cancelled:true, cancelReason:reason, cancelledBy:CURRENT_STAFF?.id||'—', cancelledAt:new Date().toISOString()}, {merge:true});
    });
  } catch (e) {
    if (e.message === 'ALREADY_CANCELLED'){ toast('이미 취소된 라운드입니다'); closeModal('modal-form'); return; }
    throw e;
  }
  // single equality filter (relatedRoundId) only - avoids needing a composite Firestore index
  const snap = await db.collection('memberLedger').where('relatedRoundId','==',roundId).get();
  let refunded = 0, clawedBack = 0;
  for (const d of snap.docs){
    const r = d.data();
    if (r.category==='bet'){
      await creditMember({memberId:r.memberId, casino:r.casino, amount:Math.abs(r.amount), category:'correction', memo:`라운드 취소 환불 (${reason})`, extra:{relatedRoundId:roundId, relatedTableId:tableId}});
      refunded += Math.abs(r.amount);
    } else if (r.category==='payout'){
      await creditMember({memberId:r.memberId, casino:r.casino, amount:-Math.abs(r.amount), category:'correction', memo:`라운드 취소 페이아웃 회수 (${reason})`, extra:{relatedRoundId:roundId, relatedTableId:tableId}});
      clawedBack += Math.abs(r.amount);
    }
  }
  if (pushNotice){
    await db.collection('inGameNotices').doc(uuidv4()).set({text:`[${tableId}] 라운드 취소 안내: ${reason}로 인해 해당 라운드가 취소되어 베팅이 전액 환불되었습니다.`, tableType:'all', active:true, dt:new Date().toISOString()});
  }
  await db.collection('adminLogs').doc(uuidv4()).set({staff:CURRENT_STAFF?.id||'—', action:`라운드 취소 (환불 ${fmtNum(refunded)}, 회수 ${fmtNum(clawedBack)})`, target:roundId, dt:new Date().toISOString()});
  closeModal('modal-form');
  toast('라운드가 취소되고 베팅이 환불되었습니다');
  invalidateCaches();
  switchView(CURRENT_VIEW);
}
async function renderChatLog(){
  return mountListView({
    title:'채팅 내역', coll:'chatMessages', search:true, searchFields:['nickname','text'], searchPh:'닉네임/내용 검색',
    columns:[{key:'dt', label:'시간', type:'dt'}, {key:'tableId', label:'테이블'}, {key:'nickname', label:'닉네임'}, {key:'text', label:'내용'}],
    sortKey:'dt', sortDir:'desc',
  });
}
async function renderBankerCutBets(){
  return mountListView({
    title:'뱅커 절사 베팅내역', sub:'뱅커 6번째 카드 절삭(Commission-free) 규칙 적용 베팅', coll:'memberLedger', extraFilter:l=>l.category==='bet' && l.betType==='banker',
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'relatedTableId', label:'테이블'}, {key:'amount', label:'베팅금액', type:'money'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}
async function renderAvatarMissFix(){
  return mountListView({
    title:'아바타 미스 수정', coll:'avatarMissCorrections', search:true, searchFields:['roundId'],
    columns:[{key:'dt', label:'시간', type:'dt'}, {key:'roundId', label:'라운드ID'}, {key:'before', label:'수정 전'}, {key:'after', label:'수정 후'}, {key:'reason', label:'사유'}, {key:'staff', label:'처리자'}],
    sortKey:'dt', sortDir:'desc',
  });
}
async function renderTableVideo(){
  const tables = (await getTables(true)).filter(t=>t.type==='avatar' || t.type==='speed');
  return `
    ${pageHead('게임 테이블 영상', '실 영상 대신 데모 플레이스홀더가 표시됩니다')}
    <div class="video-wall">
    ${tables.map(t=>`
      <div class="video-tile"><div class="feed"><div class="felt"></div><div class="dot"></div>
        <div class="meta"><span><b>${t.name}</b> · ${t.type==='avatar'?'아바타':'스피드'}</span><span>SHOE #${t.shoeNo||1}</span></div>
      </div></div>
    `).join('') || `<p class="hint">테이블이 없습니다</p>`}
    </div>
  `;
}
async function renderRoundEditSettle(){
  return mountListView({
    title:'게임 라운드 수정 정산', sub:'라운드 결과 수정에 따른 재정산 내역', coll:'rounds', extraFilter:r=>!!r.editedBy,
    columns:[{key:'startedAt', label:'라운드 시간', type:'dt'}, {key:'tableId', label:'테이블'}, {key:'result', label:'수정된 결과'}, {key:'editedBy', label:'수정자'}, {key:'editedReason', label:'사유'}],
    sortKey:'startedAt', sortDir:'desc',
  });
}

/* ============================================================
   WALLET GROUP
   ============================================================ */
async function renderDepositWithdrawList(){
  return mountListView({
    title:'입출금 리스트', coll:'memberLedger', extraFilter:l=>l.category==='deposit'||l.category==='withdraw', search:true, searchFields:['memberId'],
    filters:[{key:'category', label:'구분', options:['deposit','withdraw']}],
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'category', label:'구분', render:r=>r.category==='deposit'?'입금':'출금'}, {key:'amount', label:'금액', type:'money'}, {key:'staff', label:'처리자'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}
async function renderWalletTransferList(){
  return mountListView({
    title:'월렛 이체 리스트', coll:'memberLedger', extraFilter:l=>l.category==='transfer', search:true, searchFields:['memberId'],
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'relatedAccountId', label:'상대'}, {key:'amount', label:'금액', type:'money'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}
async function renderWalletConversionList(){
  return mountListView({
    title:'월렛 전환 리스트', coll:'memberLedger', extraFilter:l=>l.category==='point_convert', search:true, searchFields:['memberId'],
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'amount', label:'전환액', type:'money'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}

/* ============================================================
   CS GROUP
   ============================================================ */
async function renderTickerNotice(){
  return mountListView({
    title:'한줄 공지', coll:'tickerNotices', search:true, searchFields:['text'], onCreate:'openTickerForm()',
    columns:[{key:'dt', label:'등록일', type:'dt'}, {key:'text', label:'내용'}, {key:'active', label:'노출', type:'pill', pillMap:{true:'ok', false:'mute'}, render:r=>pill(r.active?'노출':'비노출', {노출:'ok','비노출':'mute'})}],
    rowActions: r => `<button class="btn btn-xs" onclick="toggleTicker('${r.id}', ${!r.active})">${r.active?'숨기기':'노출'}</button>`,
  });
}
function openTickerForm(){
  document.getElementById('formModalTitle').textContent = '한줄 공지 설정';
  document.getElementById('formModalBody').innerHTML = `<div class="field"><label>내용</label><input id="tnText"></div>`;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('tickerNotices').doc(uuidv4()).set({text:document.getElementById('tnText').value, active:true, dt:new Date().toISOString()});
    closeModal('modal-form'); toast('등록되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function toggleTicker(id, val){ await db.collection('tickerNotices').doc(id).set({active:val}, {merge:true}); switchView(CURRENT_VIEW); }

async function renderNotice(){
  return mountListView({
    title:'공지사항', coll:'notices', search:true, searchFields:['title'], onCreate:'openNoticeForm()',
    columns:[{key:'dt', label:'등록일', type:'dt'}, {key:'title', label:'제목'}, {key:'pinned', label:'고정', render:r=>r.pinned?'📌':''}, {key:'staff', label:'작성자'}],
    rowClick:'openNoticeForm2', sortKey:'dt', sortDir:'desc',
  });
}
function openNoticeForm(){ openNoticeForm2(null); }
async function openNoticeForm2(id){
  let n = {};
  if (id) n = (await fetchAll('notices')).find(x=>x.id===id) || {};
  document.getElementById('formModalTitle').textContent = id ? '공지사항 글수정작성' : '공지사항 작성';
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>제목</label><input id="noTitle" value="${escapeHtml(n.title||'')}"></div>
    <div class="field"><label>내용</label><textarea id="noBody" rows="6">${escapeHtml(n.body||'')}</textarea></div>
    <div class="checkbox-row"><input type="checkbox" id="noPin" ${n.pinned?'checked':''}> 상단 고정</div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('notices').doc(id||uuidv4()).set({title:document.getElementById('noTitle').value, body:document.getElementById('noBody').value, pinned:document.getElementById('noPin').checked, staff:CURRENT_STAFF?.id||'—', dt: n.dt || new Date().toISOString()});
    closeModal('modal-form'); toast('저장되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function renderGuide(){
  const doc = await db.collection('noticeGuide').doc('single').get();
  const body = doc.exists ? doc.data().body : '이용안내 내용을 입력하세요.';
  return `
    ${pageHead('이용안내')}
    <div class="card"><div class="field"><textarea id="guideBody" rows="16">${escapeHtml(body)}</textarea></div>
    <button class="btn btn-gold" onclick="saveGuide()">저장</button></div>
  `;
}
async function saveGuide(){
  await db.collection('noticeGuide').doc('single').set({body:document.getElementById('guideBody').value});
  toast('저장되었습니다');
}
async function renderBannedWords(){
  return mountListView({
    title:'금지어 설정', coll:'bannedWords', search:true, searchFields:['word'], onCreate:'openBannedWordForm()',
    columns:[{key:'dt', label:'등록일', type:'dt'}, {key:'word', label:'금지어'}],
    rowActions: r => `<button class="btn btn-xs btn-danger" onclick="deleteDoc('bannedWords','${r.id}')">삭제</button>`,
    sortKey:'dt', sortDir:'desc',
  });
}
function openBannedWordForm(){
  document.getElementById('formModalTitle').textContent = '금지어 추가';
  document.getElementById('formModalBody').innerHTML = `<div class="field"><label>금지어</label><input id="bwWord"></div>`;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('bannedWords').doc(uuidv4()).set({word:document.getElementById('bwWord').value, dt:new Date().toISOString()});
    closeModal('modal-form'); toast('등록되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function deleteDoc(coll, id){
  askConfirm('삭제', '정말 삭제하시겠습니까?', async ()=>{
    await db.collection(coll).doc(id).delete();
    toast('삭제되었습니다'); switchView(CURRENT_VIEW);
  });
}
async function renderInquiry1on1(){
  return mountListView({
    title:'일대일 문의', coll:'inquiries', search:true, searchFields:['title','memberId'], onCreate:'openInquiryForm()',
    filters:[{key:'status', label:'상태', options:['대기','답변완료']}],
    columns:[{key:'dt', label:'등록일', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'title', label:'제목'}, {key:'status', label:'상태', type:'pill', pillMap:{대기:'warn','답변완료':'ok'}}],
    rowClick:'openInquiryReply', sortKey:'dt', sortDir:'desc',
  });
}
function openInquiryForm(){
  document.getElementById('formModalTitle').textContent = '일대일 문의 작성';
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>회원ID</label><input id="iqMember"></div>
    <div class="field"><label>제목</label><input id="iqTitle"></div>
    <div class="field"><label>내용</label><textarea id="iqBody"></textarea></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('inquiries').doc(uuidv4()).set({memberId:document.getElementById('iqMember').value, title:document.getElementById('iqTitle').value, body:document.getElementById('iqBody').value, status:'대기', dt:new Date().toISOString()});
    closeModal('modal-form'); toast('등록되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function openInquiryReply(id){
  const q = (await fetchAll('inquiries')).find(x=>x.id===id) || {};
  document.getElementById('formModalTitle').textContent = `문의 답변 · ${q.title||''}`;
  document.getElementById('formModalBody').innerHTML = `
    <p class="hint">${escapeHtml(q.body||'')}</p>
    <div class="field"><label>답변</label><textarea id="iqReply" rows="5">${escapeHtml(q.reply||'')}</textarea></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('inquiries').doc(id).set({reply:document.getElementById('iqReply').value, status:'답변완료'}, {merge:true});
    closeModal('modal-form'); toast('답변이 등록되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function renderInGameNotice(){
  return mountListView({
    title:'인게임 공지', coll:'inGameNotices', search:true, searchFields:['text'], onCreate:'openInGameNoticeForm()',
    columns:[{key:'dt', label:'등록일', type:'dt'}, {key:'tableType', label:'적용', render:r=>r.tableType==='avatar'?'아바타':r.tableType==='speed'?'스피드':'전체'}, {key:'text', label:'내용'}, {key:'active', label:'상태', render:r=>pill(r.active?'노출':'비노출',{노출:'ok','비노출':'mute'})}],
  });
}
function openInGameNoticeForm(){
  document.getElementById('formModalTitle').textContent = '인게임 공지 등록';
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>적용 대상</label><select id="ignType"><option value="all">전체</option><option value="avatar">아바타</option><option value="speed">스피드</option></select></div>
    <div class="field"><label>내용</label><input id="ignText"></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('inGameNotices').doc(uuidv4()).set({tableType:document.getElementById('ignType').value, text:document.getElementById('ignText').value, active:true, dt:new Date().toISOString()});
    closeModal('modal-form'); toast('등록되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function renderCsContact(){
  return mountListView({
    title:'고객센터 연락처 관리', coll:'csContacts', search:true, searchFields:['label','value'], onCreate:'openCsContactForm()',
    columns:[{key:'channel', label:'채널'}, {key:'label', label:'라벨'}, {key:'value', label:'연락처'}, {key:'active', label:'상태', render:r=>pill(r.active?'사용':'미사용',{사용:'ok','미사용':'mute'})}],
    rowActions: r => `<button class="btn btn-xs btn-danger" onclick="deleteDoc('csContacts','${r.id}')">삭제</button>`,
  });
}
function openCsContactForm(){
  document.getElementById('formModalTitle').textContent = '고객센터 연락처 추가';
  document.getElementById('formModalBody').innerHTML = `
    <div class="row"><div class="field"><label>채널</label><select id="csChannel"><option value="telegram">Telegram</option><option value="kakao">Kakao</option><option value="whatsapp">WhatsApp</option><option value="line">Line</option></select></div>
    <div class="field"><label>라벨</label><input id="csLabel"></div></div>
    <div class="field"><label>연락처</label><input id="csValue"></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('csContacts').doc(uuidv4()).set({channel:document.getElementById('csChannel').value, label:document.getElementById('csLabel').value, value:document.getElementById('csValue').value, active:true});
    closeModal('modal-form'); toast('등록되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}

/* ============================================================
   ADMIN GROUP
   ============================================================ */
async function renderMoveAffiliation(){
  return mountListView({
    title:'소속이동', sub:'회원의 상위 에이전트를 변경합니다', coll:'members', search:true, searchFields:['id','nickname'],
    columns:[{key:'id', label:'ID'}, {key:'nickname', label:'닉네임'}, {key:'parentAgent', label:'현재 소속'}],
    rowActions: r => `<button class="btn btn-xs" onclick="openMoveAffiliationModal('${r.id}','${r.parentAgent||''}')">소속이동</button>`,
  });
}
function openMoveAffiliationModal(id, cur){
  document.getElementById('formModalTitle').textContent = `소속이동 · ${id}`;
  document.getElementById('formModalBody').innerHTML = `<div class="field"><label>새 상위 에이전트</label><input id="maAgent" value="${cur}"></div>`;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('members').doc(id).set({parentAgent:document.getElementById('maAgent').value}, {merge:true});
    await db.collection('memberActionLogs').doc(uuidv4()).set({memberId:id, action:'소속이동', staff:CURRENT_STAFF?.id||'—', dt:new Date().toISOString()});
    closeModal('modal-form'); toast('소속이 변경되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function renderFullMemberConversion(){
  return mountListView({
    title:'정회원 전환 리스트', coll:'members', extraFilter:m=>m.memberType==='준회원', search:true, searchFields:['id','nickname'],
    columns:[{key:'id', label:'ID'}, {key:'nickname', label:'닉네임'}, {key:'casino', label:'카지노'}, {key:'createdAt', label:'가입일', type:'date'}],
    rowActions: r => `<button class="btn btn-xs btn-jade" onclick="convertToFullMember('${r.id}')">정회원 전환</button>`,
  });
}
async function convertToFullMember(id){
  await db.collection('members').doc(id).set({memberType:'정회원'}, {merge:true});
  toast('정회원으로 전환되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW);
}
async function renderSignupSmsVerify(){
  return mountListView({
    title:'가입 인증문자 확인', coll:'members', search:true, searchFields:['id','phone'],
    columns:[{key:'id', label:'ID'}, {key:'phone', label:'전화번호', type:'phone'}, {key:'createdAt', label:'가입일', type:'dt'}, {key:'smsVerified', label:'인증상태', render:r=>pill(r.smsVerified?'인증완료':'미인증',{'인증완료':'ok','미인증':'warn'})}],
    rowActions: r => r.smsVerified ? '—' : `<button class="btn btn-xs btn-jade" onclick="verifySms('${r.id}')">인증처리</button>`,
  });
}
async function verifySms(id){ await db.collection('members').doc(id).set({smsVerified:true}, {merge:true}); toast('인증되었습니다'); invalidateCaches(); switchView(CURRENT_VIEW); }
async function renderBlacklist(){
  return mountListView({
    title:'블랙리스트', coll:'members', extraFilter:m=>m.status==='블랙리스트', search:true, searchFields:['id','nickname'],
    columns:[{key:'id', label:'ID'}, {key:'nickname', label:'닉네임'}, {key:'phone', label:'전화번호', type:'phone'}, {key:'casino', label:'카지노'}],
    rowActions: r => `<button class="btn btn-xs btn-jade" onclick="toggleMemberStatus('${r.id}','정상')">해제</button>`,
  });
}
async function renderMemberActionLog(){
  return mountListView({
    title:'회원 액션 로그', coll:'memberActionLogs', search:true, searchFields:['memberId','action'],
    columns:[{key:'dt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'action', label:'액션'}, {key:'staff', label:'처리자'}],
    sortKey:'dt', sortDir:'desc',
  });
}
async function renderAdminLog(){
  return mountListView({
    title:'관리자 로그', coll:'adminLogs', search:true, searchFields:['staff','action'],
    columns:[{key:'dt', label:'시간', type:'dt'}, {key:'staff', label:'관리자'}, {key:'action', label:'액션'}, {key:'target', label:'대상'}],
    sortKey:'dt', sortDir:'desc',
  });
}
async function renderSharePartnerMgmt(){
  return mountListView({
    title:'쉐어 파트너 관리', coll:'partners', search:true, searchFields:['id','name'],
    columns:[{key:'id', label:'코드'}, {key:'name', label:'이름'}, {key:'level', label:'레벨'}, {key:'shareRate', label:'쉐어율(%)'}, {key:'status', label:'상태', type:'pill', pillMap:{active:'ok', inactive:'mute'}}],
    rowActions: r => `<button class="btn btn-xs" onclick="editShareRate('${r.id}', ${r.shareRate})">쉐어 파트너 설정</button>`,
  });
}
async function renderSubJunketMgmt(){
  return mountListView({
    title:'서브 정켓 관리', coll:'partners', extraFilter:p=>p.level>1, search:true, searchFields:['id','name'],
    columns:[{key:'id', label:'코드'}, {key:'name', label:'이름'}, {key:'parentCode', label:'상위코드'}, {key:'shareRate', label:'쉐어율(%)'}],
  });
}
async function renderEventMgmt(){
  return mountListView({
    title:'이벤트 관리', coll:'events', search:true, searchFields:['title'], onCreate:'openEventForm()',
    columns:[{key:'title', label:'제목'}, {key:'startDt', label:'시작', type:'date'}, {key:'endDt', label:'종료', type:'date'}, {key:'active', label:'상태', render:r=>pill(r.active?'진행중':'종료',{진행중:'ok', 종료:'mute'})}],
  });
}
function openEventForm(){
  document.getElementById('formModalTitle').textContent = '이벤트 등록';
  document.getElementById('formModalBody').innerHTML = `
    <div class="field"><label>제목</label><input id="evTitle"></div>
    <div class="field"><label>내용</label><textarea id="evBody"></textarea></div>
    <div class="row"><div class="field"><label>시작일</label><input type="date" id="evStart"></div><div class="field"><label>종료일</label><input type="date" id="evEnd"></div></div>
  `;
  document.getElementById('formModalSubmitBtn').onclick = async ()=>{
    await db.collection('events').doc(uuidv4()).set({title:document.getElementById('evTitle').value, body:document.getElementById('evBody').value, startDt:document.getElementById('evStart').value, endDt:document.getElementById('evEnd').value, active:true});
    closeModal('modal-form'); toast('등록되었습니다'); switchView(CURRENT_VIEW);
  };
  openModal('modal-form');
}
async function renderFieldSignupList(){
  return mountListView({
    title:'현장가입 리스트 (어카운트 리스트)', coll:'members', extraFilter:m=>m.source==='field', search:true, searchFields:['id','nickname'],
    columns:[{key:'id', label:'ID'}, {key:'nickname', label:'닉네임'}, {key:'casino', label:'카지노'}, {key:'createdAt', label:'가입일', type:'dt'}],
  });
}

/* ============================================================
   PAYMENT GROUP
   ============================================================ */
async function renderCageTransferHistory(){
  return mountListView({
    title:'케이지 이체 내역', coll:'memberLedger', extraFilter:l=>l.category==='deposit'||l.category==='withdraw', search:true, searchFields:['memberId','staff'],
    columns:[{key:'createdAt', label:'시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'category', label:'구분', render:r=>r.category==='deposit'?'입금':'출금'}, {key:'amount', label:'금액', type:'money'}, {key:'staff', label:'처리자'}],
    sortKey:'createdAt', sortDir:'desc',
  });
}
async function renderDailySettlement(){
  return renderDailyReport();
}
async function renderPaymentProcessList(){
  return mountListView({
    title:'결제 처리 리스트', coll:'paymentRequests', extraFilter:p=>p.status==='대기', search:true, searchFields:['memberId'],
    columns:[{key:'dt', label:'요청시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'type', label:'구분'}, {key:'amount', label:'금액', type:'money'}, {key:'status', label:'상태', type:'pill', pillMap:{대기:'warn'}}],
    rowActions: r => `<button class="btn btn-xs btn-jade" onclick="processPayment('${r.id}','승인')">승인</button> <button class="btn btn-xs btn-danger" onclick="processPayment('${r.id}','거절')">거절</button>`,
    sortKey:'dt', sortDir:'desc',
  });
}
async function processPayment(id, status){
  // Reads the request fresh inside the transaction rather than off the cached fetchAll() list -
  // that cache can be stale, and the transaction is also what makes the status check + flip atomic
  // (see approveDeposit above for why: prevents a duplicate-credit race on double-click/two staff).
  const ref = db.collection('paymentRequests').doc(id);
  let p;
  try {
    await db.runTransaction(async tx=>{
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('NOT_FOUND');
      p = doc.data();
      if (p.status !== '대기') throw new Error('ALREADY_PROCESSED');
      tx.set(ref, {status}, {merge:true});
    });
  } catch (e) {
    if (e.message === 'ALREADY_PROCESSED'){ toast('이미 처리된 요청입니다'); switchView(CURRENT_VIEW); return; }
    if (e.message === 'NOT_FOUND'){ toast('요청을 찾을 수 없습니다'); switchView(CURRENT_VIEW); return; }
    throw e;
  }
  if (status==='승인' && p){
    await creditMember({memberId:p.memberId, amount: p.type==='출금' ? -Math.abs(p.amount) : Math.abs(p.amount), category: p.type==='출금'?'withdraw':'deposit', memo:'결제처리 승인'});
  }
  toast(`${status}되었습니다`); invalidateCaches(); switchView(CURRENT_VIEW);
}
async function renderPaymentMgmt(){
  return mountListView({
    title:'결제 관리', coll:'paymentRequests', search:true, searchFields:['memberId'],
    filters:[{key:'status', label:'상태', options:['대기','승인','거절']}],
    columns:[{key:'dt', label:'요청시간', type:'dt'}, {key:'memberId', label:'회원ID'}, {key:'type', label:'구분'}, {key:'amount', label:'금액', type:'money'}, {key:'status', label:'상태', type:'pill', pillMap:{대기:'warn', 승인:'ok', 거절:'bad'}}, {key:'staff', label:'처리자'}],
    sortKey:'dt', sortDir:'desc',
  });
}

/* ---------------- view registry ---------------- */
const VIEW_RENDERERS = {
  dashboard: renderDashboard, myinfo: renderMyInfo, realtime: renderRealtime, account: renderAccount, settlementReport: renderSettlementReport,
  userList: renderUserList, betHistory: renderBetHistory, payoutHistory: renderPayoutHistory, pointAccum: renderPointAccum, pointConversion: renderPointConversion,
  shareMgmt: renderShareMgmt, depositMgmt: renderDepositMgmt, shareAccumList: renderShareAccumList, shareSettingLog: renderShareSettingLog, dailyReport: renderDailyReport,
  marketRatio: renderStatsTab, depositWithdrawStats: renderStatsTab, performanceCompare: renderStatsTab, realtimeRisk: renderStatsTab, highBet: renderStatsTab,
  leaderboard: renderStatsTab, memberActivity: renderStatsTab, signupStatus: renderStatsTab, bettingStatus: renderStatsTab,
  tableList: renderTableList, tableBetHistory: renderTableBetHistory,
  avatarGameList: renderAvatarGameList, avatarRequests: renderAvatarRequests, roundEdit: renderRoundEdit, chatLog: renderChatLog, bankerCutBets: renderBankerCutBets, avatarMissFix: renderAvatarMissFix, tableVideo: renderTableVideo, roundEditSettle: renderRoundEditSettle,
  depositWithdrawList: renderDepositWithdrawList, walletTransferList: renderWalletTransferList, walletConversionList: renderWalletConversionList,
  tickerNotice: renderTickerNotice, notice: renderNotice, guide: renderGuide, bannedWords: renderBannedWords, inquiry1on1: renderInquiry1on1, inGameNotice: renderInGameNotice, csContact: renderCsContact,
  moveAffiliation: renderMoveAffiliation, fullMemberConversion: renderFullMemberConversion, signupSmsVerify: renderSignupSmsVerify, blacklist: renderBlacklist, memberActionLog: renderMemberActionLog, adminLog: renderAdminLog, sharePartnerMgmt: renderSharePartnerMgmt, subJunketMgmt: renderSubJunketMgmt, eventMgmt: renderEventMgmt, fieldSignupList: renderFieldSignupList,
  cageTransferHistory: renderCageTransferHistory, dailySettlement: renderDailySettlement, paymentProcessList: renderPaymentProcessList, paymentMgmt: renderPaymentMgmt,
};
// stats tabs need to know which sub-tab id was requested since they share one renderer signature
Object.keys({marketRatio:1,depositWithdrawStats:1,performanceCompare:1,realtimeRisk:1,highBet:1,leaderboard:1,memberActivity:1,signupStatus:1,bettingStatus:1}).forEach(id=>{
  VIEW_RENDERERS[id] = () => renderStatsTab(id);
});

/* ============================================================
   DEMO DATA SEED / WIPE
   ============================================================ */
const DEMO_COLLECTIONS = ['members','memberLedger','partners','shareLedger','tables','rounds','notices','tickerNotices','noticeGuide','bannedWords','inquiries','inGameNotices','csContacts','memberActionLogs','adminLogs','chatMessages','depositRequests','paymentRequests','events','avatarMissCorrections'];

function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randPick(arr){ return arr[randInt(0, arr.length-1)]; }
function randDateWithin(daysAgoMax){ const d = new Date(); d.setDate(d.getDate() - randInt(0,daysAgoMax)); d.setHours(randInt(0,23), randInt(0,59)); return d.toISOString(); }
const CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function randCards(n){ return [...Array(n)].map(()=> randPick(CARD_RANKS)+randPick(['♠','♥','♦','♣'])); }

async function seedDemoData(){
  toast('데모 데이터 생성 중...');
  let batch = db.batch();
  let ops = 0;
  const flush = async ()=>{ if (ops>0){ await batch.commit(); batch = db.batch(); ops = 0; } };
  const set = (coll, id, data) => { batch.set(db.collection(coll).doc(id), data); ops++; if (ops>=400) flush(); };

  // partners hierarchy
  const partners = [
    {id:'MAIN', name:'본사', parentCode:null, level:0, shareRate:0},
    {id:'VIP88', name:'VIP88 파트너', parentCode:'MAIN', level:1, shareRate:0.8},
    {id:'SEA0904', name:'SEA0904 서브', parentCode:'VIP88', level:2, shareRate:0.4},
    {id:'NUSTARMS', name:'nustarms 파트너', parentCode:'MAIN', level:1, shareRate:0.6},
    {id:'HANNVIP', name:'HANN VIP 파트너', parentCode:'MAIN', level:1, shareRate:0.5},
  ];
  partners.forEach(p => set('partners', p.id, {...p, casino: randPick(CASINOS), status:'active', createdAt: randDateWithin(200)}));
  partners.forEach(p => { for (let i=0;i<4;i++){ set('shareLedger', uuidv4(), {partnerCode:p.id, amount: randInt(1000,80000), category:'share_accum', memo:'롤링 쉐어 적립', createdAt: randDateWithin(30)}); } });

  /* tables — a handful of the branch tables above, not all 80: each one seeded here also gets 25
     rounds and their bets, so the whole set would be two thousand rounds of demo data. The full
     set is created by 지점 테이블 생성, which makes tables and nothing else. */
  const seededTableIds = ['HNA01','HNA02','NUA01','HNS01','HNS02','NUS01'];
  const tableDefs = branchTableDefs().filter(t=>seededTableIds.includes(t.id));
  tableDefs.forEach(t => set('tables', t.id, {...t, status:'open', betMin:5000, betMax:3000000, shoeNo: randInt(1,8)}));

  // members
  const agents = ['VIP88','SEA0904','NUSTARMS','HANNVIP'];
  const types = ['정회원','정회원','정회원','정회원','정회원','준회원','관리회원','멀티회원'];
  const nicknames = ['용용용','Eeyeyete','홈미르크','두산에너빌리티','아꼬케이','GDragon','레오123','HANYING','Danny','메이드킹','뽀삐','우주최강','달빛소년','골드핑거','실버베어','청춘예찬','바다사랑','들꽃향기','새벽별','황금돼지'];
  const memberIds = [];
  for (let i=1;i<=40;i++){
    const casino = randPick(CASINOS);
    const id = `PL${String(1000+i)}`;
    memberIds.push(id);
    let status = '정상';
    if (i%17===0) status = '블랙리스트'; else if (i%11===0) status = '정지';
    set('members', id, {
      id, loginId:id, pw:'0000', nickname: randPick(nicknames)+i, phone: `010${randInt(1000,9999)}${randInt(1000,9999)}`,
      telegram: Math.random()>.4 ? '@'+randPick(nicknames).toLowerCase()+i : null,
      casino, agentCode: randPick(agents), parentAgent: randPick(agents),
      memberType: randPick(types), status, vip: Math.random()>.85,
      betMax: randPick([500000,1000000,3000000]), betMin: 5000,
      withdrawPw:'0000', smsVerified: Math.random()>.2, source: Math.random()>.85 ? 'field' : 'online',
      createdAt: randDateWithin(180), lastLoginAt: randDateWithin(2),
    });
  }

  // member ledger + bets tied to rounds
  const roundsByTable = {};
  tableDefs.forEach(t=> roundsByTable[t.id] = []);
  let roundCounter = 0;
  tableDefs.forEach(t=>{
    for (let i=1;i<=25;i++){
      const rid = uuidv4();
      const result = randPick(['player','player','banker','banker','banker','tie']);
      const startedAt = randDateWithin(10);
      set('rounds', rid, {
        tableId:t.id, tableType:t.type, roundNo:i, shoeNo: t.shoeNo||1, phase:'result',
        playerCards: randCards(2), bankerCards: randCards(2),
        playerScore: randInt(0,9), bankerScore: randInt(0,9), result,
        playerPair: Math.random()>.9, bankerPair: Math.random()>.9,
        startedAt, resultAt: startedAt,
        editedBy: Math.random()>.93 ? 'admin' : null, editedReason: Math.random()>.93 ? '딜러 오조작 정정' : null,
      });
      roundsByTable[t.id].push(rid);
      roundCounter++;
    }
  });

  memberIds.forEach(mid=>{
    const casino = randPick(CASINOS);
    // deposits/withdrawals
    for (let i=0;i<randInt(1,3);i++) set('memberLedger', uuidv4(), {memberId:mid, casino, amount: randInt(5,50)*10000, category:'deposit', memo:'카드입금', staff:'admin', createdAt: randDateWithin(30)});
    for (let i=0;i<randInt(0,2);i++) set('memberLedger', uuidv4(), {memberId:mid, casino, amount: -randInt(3,30)*10000, category:'withdraw', memo:'출금요청', staff:'admin', createdAt: randDateWithin(30)});
    // bets + payouts against random tables
    for (let i=0;i<randInt(3,10);i++){
      const t = randPick(tableDefs);
      const rid = randPick(roundsByTable[t.id]);
      const betAmt = randPick([10000,20000,50000,100000,200000,500000]);
      const betType = randPick(['player','banker','tie']);
      set('memberLedger', uuidv4(), {memberId:mid, casino, amount: -betAmt, category:'bet', betType, relatedTableId:t.id, relatedRoundId:rid, staff:'system', createdAt: randDateWithin(10)});
      if (Math.random()>.45){
        const payout = betType==='tie' ? betAmt*9 : Math.round(betAmt*1.95);
        set('memberLedger', uuidv4(), {memberId:mid, casino, amount: payout, category:'payout', relatedTableId:t.id, relatedRoundId:rid, staff:'system', createdAt: randDateWithin(10)});
      }
    }
    // points
    for (let i=0;i<randInt(1,4);i++) set('memberLedger', uuidv4(), {memberId:mid, casino, amount: randInt(100,5000), category:'point_earn', memo:'베팅 적립', createdAt: randDateWithin(20)});
    if (Math.random()>.6) set('memberLedger', uuidv4(), {memberId:mid, casino, amount: -randInt(500,3000), category:'point_convert', memo:'포인트→보유금 전환', createdAt: randDateWithin(15)});
  });

  // chat messages
  for (let i=0;i<40;i++){
    const t = randPick(tableDefs.filter(t=>t.type==='avatar'));
    set('chatMessages', uuidv4(), {tableId:t.id, memberId:randPick(memberIds), nickname:randPick(nicknames), text: randPick(['베팅 완료!','뱅커 갑니다','오늘 컨디션 좋네요','타이 노려봅니다','굿럭 다들','아 아깝다']), dt: randDateWithin(3)});
  }
  // CS / content collections
  ['첫 입금 20% 보너스 이벤트 진행중','서버 점검 안내 (매주 화 04:00~05:00)','신규 회원 가입 이벤트 안내'].forEach(t=> set('notices', uuidv4(), {title:t, body:t+' 자세한 내용은 공지사항을 확인하세요.', pinned:Math.random()>.6, staff:'admin', dt: randDateWithin(20)}));
  ['🎉 첫 입금 20% 보너스 진행중!','⚠ 서버 점검 화요일 04:00~05:00','🔥 스피드 바카라 신규 오픈'].forEach(t=> set('tickerNotices', uuidv4(), {text:t, active:true, dt: randDateWithin(10)}));
  set('noticeGuide', 'single', {body:'CAGE ADMIN 파트너 사이트 이용안내\n\n1. 회원가입 후 카지노를 선택해 게임을 즐기실 수 있습니다.\n2. 입출금은 담당 에이전트를 통해 처리됩니다.\n3. 문의사항은 고객센터를 이용해주세요.'});
  ['시발','개새끼','병신','바보'].forEach(w=> set('bannedWords', uuidv4(), {word:w, dt: randDateWithin(60)}));
  for (let i=0;i<8;i++){
    const answered = Math.random()>.4;
    set('inquiries', uuidv4(), {memberId:randPick(memberIds), title:randPick(['출금 문의','보너스 문의','로그인 오류','베팅 취소 요청']), body:'문의 내용입니다.', reply: answered?'확인 후 처리해드렸습니다.':'', status: answered?'답변완료':'대기', dt: randDateWithin(15)});
  }
  ['입장 시 매너를 지켜주세요','베팅 시간은 30초입니다'].forEach(t=> set('inGameNotices', uuidv4(), {text:t, tableType:'all', active:true, dt: randDateWithin(10)}));
  [['telegram','고객센터','@cageadmin_cs'],['kakao','카카오톡 채널','@cageadmin'],['whatsapp','WhatsApp','+63-900-000-0000'],['line','Line','cageadmin_line']].forEach(([channel,label,value])=> set('csContacts', uuidv4(), {channel, label, value, active:true}));

  // logs
  for (let i=0;i<25;i++) set('memberActionLogs', uuidv4(), {memberId:randPick(memberIds), action: randPick(['보유금 지급 100,000','보유금 차감 50,000','상태변경 → 정상','비밀번호 초기화','소속이동']), staff:'admin', dt: randDateWithin(15)});
  for (let i=0;i<25;i++) set('adminLogs', uuidv4(), {staff: randPick(['admin','Eric','Jena']), action: randPick(['로그인','테이블 설정 변경','쉐어율 변경 VIP88','공지사항 등록','회원 생성']), target: randPick(memberIds), dt: randDateWithin(15)});

  // deposit / payment requests
  for (let i=0;i<10;i++) set('depositRequests', uuidv4(), {memberId:randPick(memberIds), amount: randInt(5,50)*10000, method:'계좌이체', status: i<3?'대기':randPick(['승인','거절']), dt: randDateWithin(7)});
  for (let i=0;i<10;i++) set('paymentRequests', uuidv4(), {memberId:randPick(memberIds), amount: randInt(3,30)*10000, type: randPick(['입금','출금']), status: i<4?'대기':randPick(['승인','거절']), dt: randDateWithin(7)});

  // events
  [['신규가입 웰컴 이벤트', randDateWithin(30), randDateWithin(-10)],['주말 스페셜 보너스', randDateWithin(10), randDateWithin(-3)]].forEach(([title])=> set('events', uuidv4(), {title, body:title+' 상세 내용', startDt: fmtDate(new Date()), endDt: fmtDate(new Date()), active:true}));

  // avatar miss corrections
  for (let i=0;i<4;i++){ const t = randPick(tableDefs.filter(t=>t.type==='avatar')); const rid = randPick(roundsByTable[t.id]); set('avatarMissCorrections', uuidv4(), {roundId:rid, before:'뱅커', after:'플레이어', staff:'admin', dt: randDateWithin(10), reason:'딜러 카드 인식 오류'}); }

  await flush();
  invalidateCaches();
  toast(`데모 데이터 생성 완료 (회원 ${memberIds.length}명, 라운드 ${roundCounter}개)`);
  switchView(CURRENT_VIEW);
}

async function wipeDemoData(){
  toast('데이터 초기화 중...');
  for (const coll of DEMO_COLLECTIONS){
    const snap = await db.collection(coll).get();
    let batch = db.batch(); let ops=0;
    for (const d of snap.docs){ batch.delete(d.ref); ops++; if (ops>=400){ await batch.commit(); batch=db.batch(); ops=0; } }
    if (ops>0) await batch.commit();
  }
  invalidateCaches();
  toast('초기화되었습니다');
  switchView(CURRENT_VIEW);
}
