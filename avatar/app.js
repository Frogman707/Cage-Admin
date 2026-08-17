/* ============================================================
   Game site (Avatar + Speed, integrated) — CAGE ADMIN 5.0
   One login/session/balance shared across both game modes.
   Avatar = proxy/대리 betting: a member requests a dedicated
   avatar (staff, approved in Partner Admin) who places bets on
   their behalf each round per a saved instruction, tipped
   separately for avatar/dealer. Speed = several tables running
   simultaneously with a faster round cadence, self-service.
   Both persist every round/bet/payout/tip to Firestore via the
   shared engine in /shared/game-engine.js. UI text is driven by
   /shared/i18n.js (ko/zh/en/ja/vi).
   ============================================================ */

let db = null;
let MODE = null; // 'avatar' | 'speed' | null (picker)
const AVATAR_BETTING_SECONDS = 30, AVATAR_DEALING_SECONDS = 4, AVATAR_RESULT_SECONDS = 5;
const SPEED_BETTING_SECONDS = 15, SPEED_DEALING_SECONDS = 3, SPEED_RESULT_SECONDS = 3;

function betLabel(type){ return t(type); } // BET_LABEL keys (player/banker/tie/playerPair/bankerPair) match i18n dict keys 1:1
let MY_BET_LOG = []; // {tableName, roundNo, betType, amount, payout, mode, dt} newest first, shared across both modes

let STATE = { balance: 0, points: 0, selectedChip: CHIP_VALUES[0] };

/* ---------------- boot / auth ---------------- */
window.addEventListener('DOMContentLoaded', ()=>{
  db = cageInitFirebase();
  document.getElementById('liPw').addEventListener('keydown', e=>{ if (e.key==='Enter') onLogin(); });
  document.getElementById('loginLangRow').innerHTML = langSwitcherHtml('loginLangSwitch');
  clearLoginFields();
  // Browsers autofill saved passwords asynchronously, after the page has already painted -
  // clearing once on load isn't enough since the browser can still fill the field a moment
  // later. Nuke it again shortly after, and once more if the page is restored from bfcache
  // (browser back/forward), which re-applies autofill without re-running DOMContentLoaded.
  setTimeout(clearLoginFields, 350);
});
window.addEventListener('pageshow', clearLoginFields);

function showPane(name){
  document.getElementById('pane-login').style.display = name==='login' ? 'block' : 'none';
  document.getElementById('pane-signup').style.display = name==='signup' ? 'block' : 'none';
}
function clearLoginFields(){
  ['liId','liPw'].forEach(id=>{ const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('liErr').style.display = 'none';
  document.getElementById('suErr').style.display = 'none';
}

async function onLogin(){
  const id = document.getElementById('liId').value.trim();
  const pw = document.getElementById('liPw').value.trim();
  const err = document.getElementById('liErr');
  if (!id || !pw){ err.textContent = t('loginErrRequired'); err.style.display='block'; return; }
  const res = await playerLogin(db, id, pw);
  if (!res.ok){
    err.textContent = res.reason==='notfound' ? t('loginErrNotfound') : res.reason==='blocked' ? t('loginErrBlocked') : t('loginErrBadPw');
    err.style.display='block';
    return;
  }
  err.style.display='none';
  enterApp();
}

/* ---------------- signup: ID/PW auto-generation + Telegram + SMS verify ---------------- */
let SIGNUP_CODE = null;
let SIGNUP_VERIFIED = false;
function genSignupId(){
  const id = 'SE' + Math.floor(100000 + Math.random()*900000);
  const pw = Math.random().toString(36).slice(2, 8).toUpperCase();
  document.getElementById('suId').value = id;
  document.getElementById('suPw').value = pw;
}
function sendSignupCode(){
  const phone = document.getElementById('suPhone').value.trim();
  if (!phone){ toast(t('suErrRequired'), true); return; }
  SIGNUP_CODE = String(Math.floor(100000 + Math.random()*900000));
  SIGNUP_VERIFIED = false;
  document.getElementById('suCodeStatus').textContent = t('suCodeSent', {code: SIGNUP_CODE});
  toast(t('suCodeSent', {code: SIGNUP_CODE}));
}
function verifySignupCode(){
  const code = document.getElementById('suCode').value.trim();
  if (SIGNUP_CODE && code === SIGNUP_CODE){
    SIGNUP_VERIFIED = true;
    document.getElementById('suCodeStatus').textContent = '✓ ' + t('suCodeOk');
    toast(t('suCodeOk'));
  } else {
    toast(t('suCodeBad'), true);
  }
}
async function onSignup(){
  const id = document.getElementById('suId').value.trim();
  const pw = document.getElementById('suPw').value.trim();
  const nickname = document.getElementById('suNick').value.trim();
  const telegram = document.getElementById('suTelegram').value.trim();
  const phone = document.getElementById('suPhone').value.trim();
  const casino = document.getElementById('suCasino').value;
  const agentCode = document.getElementById('suAgent').value.trim() || 'DIRECT';
  const err = document.getElementById('suErr');
  if (!id || !pw){ err.textContent = t('suErrGenId'); err.style.display='block'; return; }
  if (!SIGNUP_VERIFIED){ err.textContent = t('suErrVerify'); err.style.display='block'; return; }
  if (!nickname || !telegram){ err.textContent = t('suErrRequired'); err.style.display='block'; return; }
  const res = await playerSignup(db, {id, pw, nickname, telegram, phone, casino, agentCode, smsVerified:true});
  if (!res.ok){ err.textContent = t('suErrDup'); err.style.display='block'; return; }
  err.style.display='none';
  toast(t('suSignupDone'));
  enterApp();
}

function onLogout(){
  stopAllLoops();
  PLAYER = null;
  MODE = null;
  MY_BET_LOG = [];
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-gate').style.display = 'flex';
  showPane('login');
  clearLoginFields(); // don't leave a previously-typed password sitting in the field
}
async function enterApp(){
  document.getElementById('login-gate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('hdrLangRow').innerHTML = langSwitcherHtml('hdrLangSwitch');
  document.getElementById('hdrNick').textContent = `${PLAYER.nickname} (${PLAYER.id})`;
  clearLoginFields();
  await refreshBalance();
  const requestedMode = new URLSearchParams(location.search).get('mode');
  if (requestedMode === 'speed') chooseSpeed();
  else if (requestedMode === 'avatar') chooseAvatar();
  else showPicker();
}
async function refreshBalance(){
  const b = await getPlayerBalance(db, PLAYER.id);
  STATE.balance = b.balance; STATE.points = b.points;
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
  document.getElementById('hdrPoints').textContent = fmtNum(STATE.points);
}
/* The chip artwork carries its own value on its face, so the tray needs no label of its own.
   This is still here for anywhere a chip's worth is written as text. */
function chipLabel(v){ if (v>=1000000) return (v/1000000)+'M'; if (v>=10000) return (v/10000)+'만'; if (v>=1000) return (v/1000)+'천'; return String(v); }
function selectChip(v){
  STATE.selectedChip = v;
  document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('selected', Number(c.dataset.chip)===v));
}
function renderMyBetHistory(){
  const el = document.getElementById('myBetHistory'); if (!el) return;
  if (!MY_BET_LOG.length){ el.innerHTML = `<span class="hint">${t('noBetsYet')}</span>`; return; }
  el.innerHTML = MY_BET_LOG.slice(0, 20).map(b=>{
    const net = b.payout - b.amount;
    const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    return `<div class="row"><span>[${escapeHtml(b.tableName)}] #${b.roundNo} ${betLabel(b.betType)} ${fmtNum(b.amount)}</span><span class="${cls}">${net===0 ? t('push') : fmtSigned(net)}</span></div>`;
  }).join('');
}

function toggleHeaderFavorite(){
  document.getElementById('favoriteBtn')?.classList.toggle('active');
}
function toggleCardFavorite(btn){
  btn.classList.toggle('active');
}
function toggleStageFullscreen(btn){
  const stage = btn.closest('.sd-stage');
  if (!stage) return;
  if (!document.fullscreenElement) stage.requestFullscreen?.().catch(()=>{});
  else document.exitFullscreen?.();
}

/* ---------------- game history bottom sheet (mobile-style, grouped by day) ---------------- */
function openGameHistory(){
  const activeBtn = document.querySelector('#historyTabs button.active') || document.querySelector('#historyTabs button');
  renderGameHistory(activeBtn, activeBtn?.dataset.mode || 'speed');
  openModal('modal-history');
}
function renderGameHistory(btn, mode){
  if (btn){
    document.querySelectorAll('#historyTabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    btn.dataset.mode = mode;
  }
  const body = document.getElementById('historyBody');
  const rows = MY_BET_LOG.filter(b=>b.mode===mode);
  if (!rows.length){ body.innerHTML = `<p class="hint" style="padding:20px 0;text-align:center;">${t('noHistory')}</p>`; return; }
  const byDay = {};
  rows.forEach(b=>{
    const day = fmtDate(b.dt);
    (byDay[day] = byDay[day] || []).push(b);
  });
  body.innerHTML = Object.entries(byDay).map(([day, list])=>{
    const totalBet = list.reduce((s,b)=>s+b.amount,0);
    const totalNet = list.reduce((s,b)=>s+(b.payout-b.amount),0);
    const rowsHtml = list.map(b=>{
      const net = b.payout - b.amount;
      const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
      return `<div class="history-row">
        <span class="t">${fmtDt(b.dt).slice(11)}</span>
        <span class="g">${escapeHtml(b.tableName)} · ${betLabel(b.betType)}</span>
        <span class="amt">${fmtNum(b.amount)}</span>
        <span class="wl ${cls}">${net===0?t('push'):fmtSigned(net)}</span>
      </div>`;
    }).join('');
    return `<div class="history-day">
      <div class="history-day-head"><span>${day}</span><span>${t('betLabel')} ${fmtNum(totalBet)} · <b class="${totalNet>=0?'pos':'neg'}">${fmtSigned(totalNet)}</b></span></div>
      ${rowsHtml}
    </div>`;
  }).join('');
}

/* ============================================================
   Navigation shell shared by both modes
   ============================================================ */
function stopAllLoops(){
  stopAvatarRoundLoop();
  if (SPEED.tick){ clearInterval(SPEED.tick); SPEED.tick = null; }
  SPEED.detailTableId = null;
  if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); AVATAR.chatUnsub = null; }
  // #viewAvatarTable holds a dynamically-built #myBetHistory / chip-tray that would otherwise
  // collide with the static ids reused inside #viewSpeedLobby once both are simultaneously in the DOM.
  const avTable = document.getElementById('viewAvatarTable'); if (avTable) avTable.innerHTML = '';
  const spTable = document.getElementById('viewSpeedTable'); if (spTable) spTable.innerHTML = '';
}
function showView(name){
  ['viewPicker','viewAvatarLobby','viewAvatarTable','viewSpeedLobby','viewSpeedTable'].forEach(id=>{
    document.getElementById(id).style.display = (id===name) ? 'block' : 'none';
  });
  document.getElementById('changeGameBtn').style.display = name==='viewPicker' ? 'none' : 'inline-block';
  document.getElementById('avatarLobbyBtn').style.display = name==='viewAvatarTable' ? 'inline-block' : 'none';
}
function showPicker(){
  stopAllLoops();
  MODE = null;
  showView('viewPicker');
}
async function chooseAvatar(){
  stopAllLoops();
  MODE = 'avatar';
  LOBBY_CASINO_FILTER = 'ALL'; LOBBY_SEARCH = '';
  showView('viewAvatarLobby');
  await goAvatarLobby();
}
async function chooseSpeed(){
  stopAllLoops();
  MODE = 'speed';
  LOBBY_CASINO_FILTER = 'ALL'; LOBBY_SEARCH = '';
  showView('viewSpeedLobby');
  await loadSpeedTables();
  renderMyBetHistory();
  SPEED.tick = setInterval(tickAllSpeedTables, 1000);
}

/* ---------------- lobby casino tabs + game-type filter + search (shared by avatar/speed) ---------------- */
/* Each house picks its table by its own mark, the way the reference lobby lists them: the logo
   over the name rather than the name alone.
   The marks are the operator's own logo files, traced to vector so they stay crisp at any size
   and carry no background of their own - HANN's monogram is three plain bars and is written out
   exactly as it measures; NuStar's and Solaire's are traced from the artwork. They are set in
   the houses' colours, lifted where a print mark would go muddy on the app's dark panel (HANN's
   slate, NuStar's maroon), and the "all games" sparkle is ours since no house owns it.
   To replace one with a newer file, drop it over shared/assets/logo-<house>.svg - nothing reads
   these but the tab. */
/* The ?v= is the mark's own version. Hosting serves an image out of cache for an hour unless
   it is told otherwise, so a corrected file went on being drawn from the old copy long after it
   shipped; the headers now make images revalidate, and bumping this number pulls a replacement
   through immediately rather than waiting the hour out. Bump it whenever a file here changes. */
const CASINO_MARK_SRC = {
  ALL: '../shared/assets/logo-all.svg?v=3',
  HANN: '../shared/assets/logo-hann.svg?v=3',
  NUSTAR: '../shared/assets/logo-nustar.svg?v=3',
  SOLAIRE: '../shared/assets/logo-solaire.svg?v=3',
};
const LOBBY_CASINOS = ['HANN','NUSTAR','SOLAIRE'];
const CASINO_LABELS = {ALL:'allCasinos', HANN:'casinoHann', NUSTAR:'casinoNustar', SOLAIRE:'casinoSolaire'};
let LOBBY_CASINO_FILTER = 'ALL';
let LOBBY_SEARCH = '';
function casinoTabsHtml(){
  return `<div class="casino-tabs">
    ${['ALL', ...LOBBY_CASINOS].map(c=>`<button class="casino-tab ${LOBBY_CASINO_FILTER===c?'active':''}" data-c="${c}" onclick="setLobbyCasinoFilter('${c}')"><span class="cl-mark"><img src="${CASINO_MARK_SRC[c]}" alt=""></span><span class="cl-name">${t(CASINO_LABELS[c])}</span></button>`).join('')}
  </div>`;
}
const GAME_TYPE_TABS = [
  {id:'all', label:'allGameTypes'},
  {id:'avatar', label:'gameTypeAvatar'},
  {id:'speed', label:'gameTypeSpeed'},
];
function gameTypeTabsHtml(activeType){
  return `<div class="game-type-tabs">
    ${GAME_TYPE_TABS.map(ty=>`<button class="game-type-tab ${activeType===ty.id?'active':''}" data-t="${ty.id}" onclick="setGameTypeFilter('${ty.id}')">${t(ty.label)}</button>`).join('')}
  </div>`;
}
function setGameTypeFilter(id){
  document.querySelectorAll('.game-type-tab').forEach(b=>b.classList.toggle('active', b.dataset.t===id));
  if (id==='avatar' && MODE!=='avatar') chooseAvatar();
  else if (id==='speed' && MODE!=='speed') chooseSpeed();
}
function lobbySearchHtml(){
  return `<div class="lobby-search-wrap">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
    <input class="lobby-search" id="lobbySearchInput" placeholder="${t('searchTablePh')}" value="${escapeHtml(LOBBY_SEARCH)}" oninput="setLobbySearch(this.value)">
  </div>`;
}
function setLobbyCasinoFilter(c){
  LOBBY_CASINO_FILTER = c;
  document.querySelectorAll('.casino-tab').forEach(b=>b.classList.toggle('active', b.dataset.c===c));
  applyLobbyTileFilter();
}
function setLobbySearch(v){
  LOBBY_SEARCH = v;
  applyLobbyTileFilter();
}
function applyLobbyTileFilter(){
  const q = LOBBY_SEARCH.trim().toLowerCase();
  document.querySelectorAll('.lobby-card[data-casino], .speed-tile[data-casino]').forEach(el=>{
    const casinoOk = LOBBY_CASINO_FILTER==='ALL' || el.dataset.casino===LOBBY_CASINO_FILTER;
    const nameOk = !q || (el.dataset.name||'').toLowerCase().includes(q);
    el.style.display = (casinoOk && nameOk) ? '' : 'none';
  });
}
function backToAvatarLobby(){
  stopAvatarRoundLoop();
  if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); AVATAR.chatUnsub = null; }
  goAvatarLobby();
}
function onLangChange(){
  // re-render whichever screen is currently visible so JS-generated text updates immediately
  if (MODE==='avatar'){
    if (document.getElementById('viewAvatarTable').style.display !== 'none' && AVATAR.table){
      if (AVATAR.request){
        document.getElementById('viewAvatarTable').innerHTML = avatarTableShellHtml();
        renderAvatarRoad(); renderAvatarTally(); renderMyBetHistory(); updateAvatarStatusPanel();
      } else {
        document.getElementById('viewAvatarTable').innerHTML = avatarPreviewShellHtml(avatarRequestStateForTable(AVATAR.previewTableId).state);
        renderAvatarRoad(); renderAvatarTally();
      }
    } else if (AVATAR.lobbyData){
      goAvatarLobby();
    }
  } else if (MODE==='speed'){
    const toolbar = document.getElementById('speedToolbar');
    if (toolbar && document.getElementById('viewSpeedLobby').style.display !== 'none') toolbar.innerHTML = casinoTabsHtml() + gameTypeTabsHtml('speed') + `<div class="lobby-toolbar">${lobbySearchHtml()}</div>`;
    Object.keys(SPEED.tables||{}).forEach(id=>{ renderSpeedTileStats(id); setSpeedTilePhaseText(id, SPEED.tstate[id].phase==='betting'?t('phaseBetting'):SPEED.tstate[id].phase==='dealing'?t('phaseDealing'):''); });
    if (SPEED.detailTableId) openSpeedTableDetail(SPEED.detailTableId, true);
  }
}

/* ============================================================
   AVATAR MODE — proxy/대리 betting
   A member requests a dedicated avatar for a table; once a staff
   member approves the request in Partner Admin, this client
   auto-places one bet per round per the member's saved
   instruction (still using the same round/settle engine as
   before), and shows a status panel (assigned avatar, tip
   totals) instead of a manual betting rail.
   ============================================================ */
let AVATAR = {
  table: null, phase: 'idle', secondsLeft: 0, roundNo: 1,
  bets: {player:0, banker:0, tie:0, playerPair:0, bankerPair:0},
  history: [], pairFlags: [], currentRoundId: null, timerHandle: null, chatUnsub: null,
  lobbyData: null, myRequests: [], request: null, tipTotals: {avatar:0, dealer:0},
};

async function goAvatarLobby(){
  stopAvatarRoundLoop();
  if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); AVATAR.chatUnsub = null; }
  showView('viewAvatarLobby');
  const lobby = document.getElementById('viewAvatarLobby');
  lobby.innerHTML = `
    <div class="lobby-wrap">
      <div class="lobby-title" data-i18n="avatarLobbyTitle">아바타 테이블</div>
      ${casinoTabsHtml()}
      ${gameTypeTabsHtml('avatar')}
      <div class="lobby-toolbar">
        ${lobbySearchHtml()}
        <label class="hint" style="margin:0 0 0 auto;" data-i18n="sortLabel">정렬</label>
        <select id="lobbySort" onchange="renderAvatarLobbyGrid(this.value)">
          <option value="popular" data-i18n="sortPopular">인기순 (베팅총액)</option>
          <option value="today" data-i18n="sortToday">오늘 베팅액순</option>
          <option value="hot" data-i18n="sortHot">좋은 흐름순</option>
          <option value="name" data-i18n="sortName">테이블명순</option>
        </select>
      </div>
      <div class="lobby-grid" id="lobbyGrid"><div class="spin"></div></div>
    </div>`;
  applyI18n(lobby);
  const [tableSnap, roundsSnap, betSnap, reqSnap, allReqSnap] = await Promise.all([
    db.collection('tables').where('type','==','avatar').get(),
    db.collection('rounds').where('tableType','==','avatar').get(),
    db.collection('memberLedger').where('category','==','bet').get(), // single equality filter only - no composite index needed
    db.collection('avatarRequests').where('memberId','==',PLAYER.id).get(),
    db.collection('avatarRequests').get(),
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  AVATAR.lobbyData = { tables, rounds: roundsSnap.docs.map(d=>d.data()), bets: betSnap.docs.map(d=>d.data()) };
  AVATAR.myRequests = reqSnap.docs.map(d=>({id:d.id, ...d.data()}));
  AVATAR.allRequests = allReqSnap.docs.map(d=>({id:d.id, ...d.data()}));
  if (!tables.length){ document.getElementById('lobbyGrid').innerHTML = `<p class="hint">${t('noAvatarTables')}</p>`; return; }
  renderAvatarLobbyGrid('popular');
}
function avatarRequestStateForTable(tableId){
  const todayStr = fmtDate(new Date());
  const reqs = AVATAR.myRequests.filter(r=>r.tableId===tableId).sort((a,b)=>new Date(b.requestedAt)-new Date(a.requestedAt));
  const active = reqs.find(r=>r.status==='진행중');
  if (active) return {state:'active', req:active};
  const pending = reqs.find(r=>r.status==='대기');
  if (pending) return {state:'pending', req:pending};
  const endedToday = reqs.find(r=>r.status==='종료' && fmtDate(r.requestedAt)===todayStr);
  if (endedToday) return {state:'full', req:endedToday};
  return {state:'none', req:null};
}
// Table-wide occupancy (everyone's requests, not just mine) - drives the
// 관전/금일 예약 완료 states shown on the lobby card overlay.
function avatarTableOccupancy(tableId){
  const todayStr = fmtDate(new Date());
  const all = (AVATAR.allRequests||[]).filter(r=>r.tableId===tableId);
  const activeOther = all.some(r=>r.status==='진행중' && r.memberId!==PLAYER.id);
  const todayCount = all.filter(r=>fmtDate(r.requestedAt)===todayStr && (r.status==='진행중'||r.status==='종료')).length;
  return {activeOther, todayCount};
}
// Clicking anywhere on the card opens the full-screen table view. With an active
// (approved) session that's the live proxy-betting session; otherwise it's a
// read-only preview of the table, with the 아바타 신청 action living inside it.
function handleAvatarCardClick(tableId){
  const {state} = avatarRequestStateForTable(tableId);
  if (state==='active') enterAvatarSession(tableId);
  else openAvatarTablePreview(tableId, state);
}
// Centered pill (or bottom bar, when fully reserved) overlaid on the table
// thumbnail showing the table's current availability at a glance.
function avatarCardStatusHtml(tableId){
  const {state} = avatarRequestStateForTable(tableId);
  if (state==='active') return `<span class="card-status reenter">↩ ${t('btnReenter')}</span>`;
  if (state==='pending') return `<span class="card-status pending">⏳ ${t('btnPending')}</span>`;
  const occ = avatarTableOccupancy(tableId);
  if (occ.todayCount >= 3) return `<span class="card-status full">✏️ ${t('btnFullToday')}</span>`;
  if (occ.activeOther) return `<span class="card-status spectate">🎥 ${t('btnSpectate')}</span>`;
  // A free table needs no call to action here - opening the card leads to the table, and the
  // 아바타 신청 action lives inside it.
  return '';
}

function renderAvatarLobbyGrid(sortMode){
  if (!AVATAR.lobbyData) return;
  const grid = document.getElementById('lobbyGrid');
  const rows = AVATAR.lobbyData.tables.map(t=>{
    const tableRounds = AVATAR.lobbyData.rounds.filter(r=>r.tableId===t.id).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
    const results = tableRounds.map(r=>r.result);
    const tableBets = AVATAR.lobbyData.bets.filter(b=>b.relatedTableId===t.id);
    return {t, results, wins: tableWinCounts(results), streak: trailingStreak(results), volume: tableBetVolume(tableBets)};
  });
  const sorted = rows.slice().sort((a,b)=>{
    if (sortMode==='today') return b.volume.today - a.volume.today;
    if (sortMode==='hot') return b.streak.len - a.streak.len;
    if (sortMode==='name') return a.t.name.localeCompare(b.t.name);
    return b.volume.total - a.volume.total; // popular (default)
  });
  grid.innerHTML = sorted.map(({t:tb, results, wins, streak, volume})=>{
    const cols = buildBigRoad(results.slice(-40));
    const isHot = streak.len >= 3;
    return `
    <div class="lobby-card" data-casino="${tb.casino}" data-name="${escapeHtml(tb.name).toLowerCase()}" onclick="handleAvatarCardClick('${tb.id}')" title="${t('openTable')}">
      <div class="thumb"></div>
      <div class="mini-road br-grid">${renderBigRoad(cols, 4) || `<span class="hint" style="font-size:10px;">${t('noRecord')}</span>`}</div>
      <div class="card-foot">
        <div class="card-line">
          <span class="name">${escapeHtml(tb.name)}</span>
          ${avatarCardStatusHtml(tb.id)}
          ${isHot ? `<span class="card-hot">🔥 ${streak.len}연속 ${streak.side==='player'?t('player'):t('banker')}</span>` : ''}
          <button class="card-favorite" onclick="event.stopPropagation();toggleCardFavorite(this)" title="${t('favorites')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.35-9.5-8.8C.7 7.9 2 4.5 5.4 4c2-.3 3.7.6 4.6 2.2C10.9 4.6 12.6 3.7 14.6 4c3.4.5 4.7 3.9 2.9 7.2C15 15.65 12 20 12 20z"/></svg></button>
        </div>
        <div class="card-line meta"><span class="limits">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</span><span class="counts">P <b>${wins.player}</b> · B <b>${wins.banker}</b> · T <b>${wins.tie}</b></span></div>
      </div>
    </div>`;
  }).join('');
  pinRoadsIn(grid);
  applyLobbyTileFilter();
}

/* ---------------- avatar request modal ---------------- */
let AVATAR_PENDING_TABLE = null;
function openAvatarRequestModal(tableId){
  AVATAR_PENDING_TABLE = tableId;
  document.getElementById('reqBuyin').value = '';
  document.getElementById('reqAmount').value = '';
  document.getElementById('reqSide').value = 'banker';
  openModal('modal-avatar-request');
}
async function submitAvatarRequest(){
  const buyin = rawNum(document.getElementById('reqBuyin').value);
  const betSide = document.getElementById('reqSide').value;
  const betAmount = rawNum(document.getElementById('reqAmount').value);
  if (!buyin || !betAmount){ toast(t('suErrRequired'), true); return; }
  const tbl = AVATAR.lobbyData.tables.find(x=>x.id===AVATAR_PENDING_TABLE);
  await db.collection('avatarRequests').doc(uuidv4()).set({
    memberId: PLAYER.id, tableId: AVATAR_PENDING_TABLE, casino: tbl?.casino || PLAYER.casino,
    buyin, betSide, betAmount, status:'대기', avatarStaffId:null,
    requestedAt: new Date().toISOString(), approvedAt:null, endedAt:null,
  });
  closeModal('modal-avatar-request');
  toast(t('requestSubmitted'));
  goAvatarLobby();
}

/* ---------------- avatar table preview (no approved session yet) ---------------- */
// Full-screen, read-only view of the table (felt + road map + recent results) with
// the 아바타 신청 action inside it, so entering a table never requires a request first.
async function openAvatarTablePreview(tableId, state){
  AVATAR.request = null;
  AVATAR.previewTableId = tableId;
  showView('viewAvatarTable');
  const view = document.getElementById('viewAvatarTable');
  view.innerHTML = `<div class="table-loading"><div class="spin-lg"></div><div>${t('connectingTable')}</div></div>`;

  const doc = await db.collection('tables').doc(tableId).get();
  AVATAR.table = {id:tableId, ...doc.data()};
  const roundsSnap = await db.collection('rounds').where('tableId','==',tableId).get();
  const rounds = roundsSnap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  AVATAR.history = rounds.map(r=>r.result);
  AVATAR.pairFlags = rounds.map(r=>({playerPair:!!r.playerPair, bankerPair:!!r.bankerPair}));

  view.innerHTML = avatarPreviewShellHtml(state ?? avatarRequestStateForTable(tableId).state);
  renderAvatarRoad();
  renderAvatarTally();
}
function avatarPreviewRequestPanelHtml(state){
  if (state==='pending') return `<div class="hint" style="margin-bottom:10px;">${t('btnPending')}</div><button class="btn btn-sm btn-block" disabled style="opacity:.6;">${t('btnPending')}</button>`;
  if (state==='full') return `<div class="hint" style="margin-bottom:10px;">${t('btnFullToday')}</div><button class="btn btn-sm btn-block" disabled style="opacity:.5;">${t('btnFullToday')}</button>`;
  return `<button class="btn btn-gold btn-block" onclick="openAvatarRequestModal('${AVATAR.previewTableId}')">${t('btnRequestAvatar')}</button>`;
}
function avatarPreviewShellHtml(state){
  const tb = AVATAR.table;
  return `
  <div class="speed-detail-wrap">
    <div class="speed-detail-grid">
      <div class="sd-stage">
        <button class="icon-btn speed-detail-close" onclick="backToAvatarLobby()" style="position:absolute;top:14px;left:14px;z-index:2;background:rgba(0,0,0,.55);color:#fff;border-color:rgba(255,255,255,.15);" data-i18n-title="backToList" title="목록으로">✕</button>
        <div class="sd-stage-top">
          <div class="sd-type-badge">AVATAR</div>
          <div class="sd-table-id-mini">${escapeHtml(tb.name)}</div>
          <div class="sd-limit-text">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</div>
        </div>
        <div class="sd-stage-icons">
          <button onclick="openGameHistory()" data-i18n-title="gameHistory" title="게임기록"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></button>
        </div>
        <div class="table-felt"></div>
      </div>
      ${avatarScoreboardHtml('avatar')}
      <div class="sd-bets avatar-side">
        <div class="card avatar-status-card">
          <h3 style="margin:0 0 12px;color:var(--brass);font-weight:700;font-size:14px;">${t('avatarStatusTitle')}</h3>
          <p class="hint" style="margin:0 0 12px;">${tb.casino} · ${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</p>
          ${avatarPreviewRequestPanelHtml(state)}
        </div>
      </div>
    </div>
  </div>`;
}
// Shared by the avatar preview/active-session shells and the Speed detail screen. Mirrors
// the board's own arrangement: tally + Bead Plate (육매) on the left, and on the right three
// full-width bands stacked down the panel - Big Road (본매), Big Eye Boy (빅아이), Small Road
// (스몰로드), Cockroach Road (카카로치) - with the P/B legend rail running the full height of
// the right edge. `idSuffix` picks the element ids (only one
// of 'avatar'/'detail' is ever mounted in its view at a time).
// .sd-board-row is display:contents everywhere except the phone, where it becomes the
// horizontal scroller that carries the board's two pages - roads, then the full Bead Plate.
function avatarScoreboardHtml(idSuffix){
  return `
    <div class="sd-board-row">
      <div class="sd-tally sd-graph-bg">
        <div class="sd-tally-head"><span>${t('dealsLabel')}</span><b id="tallycount-${idSuffix}">#1</b></div>
        <div class="sd-tally-body">
          <div class="sd-tally-list" id="tallylist-${idSuffix}"></div>
          <div class="bead-road" id="beadroad-${idSuffix}"></div>
        </div>
      </div>
      <div class="sd-road sd-graph-bg">
        <div class="sd-road-main">
          <div class="sd-road-band"><div class="br-grid" id="road-${idSuffix}"></div></div>
          <div class="sd-road-band"><div class="derived-road-grid" id="bigeye-${idSuffix}"></div></div>
          <div class="sd-road-band"><div class="derived-road-grid" id="smallroad-${idSuffix}"></div></div>
          <div class="sd-road-band"><div class="derived-road-grid" id="cockroach-${idSuffix}"></div></div>
        </div>
        <div class="sd-road-legend-rail">
          <div class="rail-badge player">P<span class="ring"></span><span class="dot"></span><span class="slash"></span></div>
          <div class="rail-badge banker">B<span class="ring"></span><span class="dot"></span><span class="slash"></span></div>
        </div>
      </div>
    </div>`;
}
function renderAvatarRoad(){
  const el = document.getElementById('road-avatar'); if (!el) return;
  const cols = buildBigRoad(AVATAR.history.slice(-90), (AVATAR.pairFlags||[]).slice(-90));
  paintRoad(el, renderBigRoad(cols, 6) || `<span class="hint">${t('noRecord')}</span>`);
  paintRoad(document.getElementById('bigeye-avatar'), renderDerivedRoad(deriveBigEyeBoy(cols)) || `<span class="hint">${t('noRecord')}</span>`);
  paintRoad(document.getElementById('smallroad-avatar'), renderDerivedRoad(deriveSmallRoad(cols), 'filled') || `<span class="hint">${t('noRecord')}</span>`);
  paintRoad(document.getElementById('cockroach-avatar'), renderDerivedRoad(deriveCockroachRoad(cols), 'diagonal') || `<span class="hint">${t('noRecord')}</span>`);
  // Bead Plate shows the recent window left-aligned, as the board does - grouping runs into
  // columns makes the full shoe far wider than the panel.
  paintRoad(document.getElementById('beadroad-avatar'), renderBeadRoad(AVATAR.history.slice(-BEAD_WINDOW), (AVATAR.pairFlags||[]).slice(-BEAD_WINDOW)) || `<span class="hint">${t('noRecord')}</span>`);
}
function renderAvatarTally(){
  const listEl = document.getElementById('tallylist-avatar');
  const countEl = document.getElementById('tallycount-avatar');
  if (!listEl && !countEl) return;
  const history = AVATAR.history;
  const pairFlags = AVATAR.pairFlags || [];
  const wins = tableWinCounts(history);
  const playerPairs = pairFlags.filter(p=>p && p.playerPair).length;
  const bankerPairs = pairFlags.filter(p=>p && p.bankerPair).length;
  if (countEl) countEl.textContent = '#' + (AVATAR.roundNo || 1);
  if (listEl){
    // P/B/T rows carry the result letter; the two pair rows are a plain grey bead marked
    // with the same corner dot the roads use (blue = player pair, red = banker pair).
    const row = (cls, letter, val) => `<div class="tl-row ${cls}"><span class="tl-badge">${letter}</span><b>${fmtNum(val)}</b></div>`;
    const pairRow = (side, val) => `<div class="tl-row pair ${side}"><span class="tl-badge"><i class="br-pair ${side}"></i></span><b>${fmtNum(val)}</b></div>`;
    listEl.innerHTML = row('player','P',wins.player) + row('banker','B',wins.banker) + row('tie','T',wins.tie) + pairRow('player',playerPairs) + pairRow('banker',bankerPairs);
  }
}

/* ---------------- avatar session (approved, proxy-betting in progress) ---------------- */
async function enterAvatarSession(tableId){
  const {req} = avatarRequestStateForTable(tableId);
  if (!req){ toast(t('btnPending'), true); return; }
  AVATAR.request = req;

  showView('viewAvatarTable');
  const view = document.getElementById('viewAvatarTable');
  view.innerHTML = `<div class="table-loading"><div class="spin-lg"></div><div>${t('connectingTable')}</div></div>`;

  const doc = await db.collection('tables').doc(tableId).get();
  AVATAR.table = {id:tableId, ...doc.data()};
  const roundsSnap = await db.collection('rounds').where('tableId','==',tableId).get();
  const rounds = roundsSnap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  AVATAR.history = rounds.map(r=>r.result);
  AVATAR.pairFlags = rounds.map(r=>({playerPair:!!r.playerPair, bankerPair:!!r.bankerPair}));
  AVATAR.roundNo = (Math.max(0, ...rounds.map(r=>r.roundNo||0)) || 0) + 1;
  await refreshTipTotals();

  view.innerHTML = avatarTableShellHtml();
  renderAvatarRoad();
  renderAvatarTally();
  renderMyBetHistory();
  updateAvatarStatusPanel();
  mountAvatarChat(tableId);
  startAvatarRoundLoop();
}
async function refreshTipTotals(){
  const snap = await db.collection('memberLedger').where('memberId','==',PLAYER.id).get(); // single equality
  let avatarTip = 0, dealerTip = 0;
  snap.forEach(d=>{
    const r = d.data();
    if (r.relatedRequestId !== AVATAR.request.id) return;
    if (r.category==='avatar_tip') avatarTip += Math.abs(r.amount);
    if (r.category==='dealer_tip') dealerTip += Math.abs(r.amount);
  });
  AVATAR.tipTotals = {avatar:avatarTip, dealer:dealerTip};
}
function updateAvatarStatusPanel(){
  const el = document.getElementById('avatarStatusGrid'); if (!el) return;
  const r = AVATAR.request;
  el.innerHTML = `
    <span>${t('assignedAvatar')}</span><b>${r.avatarStaffId ? escapeHtml(r.avatarStaffId) : t('unassigned')}</b>
    <span>${t('myInstruction')}</span><b>${betLabel(r.betSide)} ${fmtNum(r.betAmount)}</b>
    <span>${t('avatarTipTotal')}</span><b class="num">${fmtNum(AVATAR.tipTotals.avatar)}</b>
    <span>${t('dealerTipTotal')}</span><b class="num">${fmtNum(AVATAR.tipTotals.dealer)}</b>
  `;
}
function avatarTableShellHtml(){
  const tb = AVATAR.table;
  return `
  <div class="speed-detail-wrap">
    <div class="speed-detail-grid">
      <div class="sd-stage">
        <button class="icon-btn speed-detail-close" onclick="backToAvatarLobby()" style="position:absolute;top:14px;left:14px;z-index:2;background:rgba(0,0,0,.55);color:#fff;border-color:rgba(255,255,255,.15);" data-i18n-title="backToList" title="목록으로">✕</button>
        <div class="sd-stage-top">
          <div class="sd-type-badge">AVATAR</div>
          <div class="sd-table-id-mini">${escapeHtml(tb.name)}</div>
          <div class="sd-limit-text">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</div>
        </div>
        <div class="phase-banner" id="phase-avatar">${t('phaseBetting')}</div>
        <div class="sd-stage-icons">
          <button onclick="toggleStageFullscreen(this)" data-i18n-title="fullscreen" title="전체화면"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
          <button onclick="this.classList.toggle('muted')" data-i18n-title="mute" title="음소거">
            <svg class="icon-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/></svg>
            <svg class="icon-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M23 9l-6 6"/><path d="M17 9l6 6"/></svg>
          </button>
          <button onclick="this.classList.toggle('active')" data-i18n-title="viewToggle" title="화면 보기 전환"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button onclick="openTipModal()" data-i18n-title="giveTip" title="팁"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="5"/><path d="M9 21l3-4 3 4"/><path d="M12 21v-4"/></svg></button>
          <button onclick="openGameHistory()" data-i18n-title="gameHistory" title="게임기록"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></button>
        </div>
        <div class="table-felt">
          <div class="cards-area">
            <div class="hand player"><div class="cards" id="playerCardsAvatar"></div><div class="score" id="playerScoreAvatar"></div></div>
            <div class="hand banker"><div class="cards" id="bankerCardsAvatar"></div><div class="score" id="bankerScoreAvatar"></div></div>
          </div>
        </div>
        <div class="timer-ring-wrap" id="timerRingWrap"><svg width="64" height="64"><circle cx="32" cy="32" r="27" stroke="var(--line)" stroke-width="5" fill="none"/><circle id="timerArc" cx="32" cy="32" r="27" stroke="var(--jade)" stroke-width="5" fill="none" stroke-dasharray="169.6" stroke-dashoffset="0" stroke-linecap="round"/></svg><div class="txt" id="timer-avatar">30</div></div>
      </div>
      ${avatarScoreboardHtml('avatar')}
      <div class="sd-bets avatar-side">
        <div class="card avatar-status-card">
          <h3 style="margin:0 0 12px;color:var(--brass);font-weight:700;font-size:14px;">${t('avatarStatusTitle')}</h3>
          <div class="kv-grid" id="avatarStatusGrid"></div>
          <div class="row" style="gap:8px;margin-top:14px;">
            <button class="btn btn-gold btn-sm" onclick="openTipModal()">${t('giveTip')}</button>
            <button class="btn btn-sm" onclick="requestShoeChange()">${t('requestShoeChange')}</button>
            <button class="btn btn-sm btn-danger" onclick="endAvatarSession()">${t('endSession')}</button>
          </div>
        </div>
        <div class="card chat-panel">
          <h3>${t('chat')}</h3>
          <div class="chat-log" id="chatLog"></div>
          <div class="chat-input-row"><input id="chatInput" placeholder="${t('chatPh')}" onkeydown="if(event.key==='Enter')sendAvatarChat()"><button class="btn btn-sm btn-gold" onclick="sendAvatarChat()">${t('send')}</button></div>
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------------- tip / shoe-change / end-session ---------------- */
function openTipModal(){
  document.getElementById('tipAmount').value = '';
  document.getElementById('tipTarget').value = 'avatar';
  openModal('modal-tip');
}
async function submitTip(){
  const target = document.getElementById('tipTarget').value;
  const amount = rawNum(document.getElementById('tipAmount').value);
  if (!amount){ toast(t('suErrRequired'), true); return; }
  if (amount > STATE.balance){ toast(t('insufficientBalance'), true); return; }
  await db.collection('memberLedger').doc(uuidv4()).set({
    memberId: PLAYER.id, casino: PLAYER.casino, amount: -amount,
    category: target==='avatar' ? 'avatar_tip' : 'dealer_tip',
    relatedRequestId: AVATAR.request.id, relatedTableId: AVATAR.table.id,
    staff: 'member', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
  });
  STATE.balance -= amount;
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
  await refreshTipTotals();
  updateAvatarStatusPanel();
  closeModal('modal-tip');
  toast(t('tipSent'));
}
async function requestShoeChange(){
  await db.collection('avatarServiceRequests').doc(uuidv4()).set({
    requestId: AVATAR.request.id, tableId: AVATAR.table.id, memberId: PLAYER.id,
    type: 'shoe_change', dt: new Date().toISOString(),
  });
  toast(t('shoeChangeSent'));
}
async function endAvatarSession(){
  await db.collection('avatarRequests').doc(AVATAR.request.id).set({status:'종료', endedAt:new Date().toISOString()}, {merge:true});
  toast(t('sessionEnded'));
  backToAvatarLobby();
}

/* ---------------- round loop (auto-bets the member's saved instruction each round) ---------------- */
function avatarTotalBet(){ return Object.values(AVATAR.bets).reduce((a,b)=>a+b,0); }
function stopAvatarRoundLoop(){ if (AVATAR.timerHandle){ clearInterval(AVATAR.timerHandle); AVATAR.timerHandle = null; } }
function startAvatarRoundLoop(){
  stopAvatarRoundLoop();
  beginAvatarBettingPhase();
  AVATAR.timerHandle = setInterval(avatarTick, 1000);
}
function beginAvatarBettingPhase(){
  AVATAR.phase = 'betting';
  AVATAR.secondsLeft = AVATAR_BETTING_SECONDS;
  AVATAR.currentRoundId = uuidv4();
  AVATAR.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  AVATAR.bets[AVATAR.request.betSide] = AVATAR.request.betAmount;
  setAvatarPhaseBanner(t('phaseBetting'), AVATAR_BETTING_SECONDS);
  document.getElementById('playerCardsAvatar').innerHTML = ''; document.getElementById('bankerCardsAvatar').innerHTML = '';
  document.getElementById('playerScoreAvatar').textContent = ''; document.getElementById('bankerScoreAvatar').textContent = '';
}
function setAvatarPhaseBanner(text, secs){
  const el = document.getElementById('phase-avatar'); if (el) el.textContent = text;
  updateAvatarTimerRing(secs, secs);
}
function updateAvatarTimerRing(secLeft, secTotal){
  const txt = document.getElementById('timer-avatar'); if (txt) txt.textContent = secLeft;
  const arc = document.getElementById('timerArc');
  if (arc){ const c = 169.6; arc.style.strokeDashoffset = c * (1 - secLeft/secTotal); }
  const wrap = document.getElementById('timerRingWrap');
  if (wrap) wrap.classList.toggle('urgent', secLeft <= 5 && secLeft > 0);
}
async function avatarTick(){
  AVATAR.secondsLeft--;
  if (AVATAR.phase==='betting'){
    updateAvatarTimerRing(Math.max(0,AVATAR.secondsLeft), AVATAR_BETTING_SECONDS);
    if (AVATAR.secondsLeft <= 0) await beginAvatarDealingPhase();
  } else if (AVATAR.phase==='dealing'){
    if (AVATAR.secondsLeft <= 0) await beginAvatarResultPhase();
  } else if (AVATAR.phase==='result'){
    updateAvatarTimerRing(Math.max(0,AVATAR.secondsLeft), AVATAR_RESULT_SECONDS);
    if (AVATAR.secondsLeft <= 0) beginAvatarBettingPhase();
  }
}
async function beginAvatarDealingPhase(){
  AVATAR.phase = 'dealing';
  AVATAR.secondsLeft = AVATAR_DEALING_SECONDS;
  setAvatarPhaseBanner(t('phaseDealing'), AVATAR_DEALING_SECONDS);
  for (const [betType, amount] of Object.entries(AVATAR.bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId:AVATAR.table.id, roundId:AVATAR.currentRoundId, betType, amount, staff:'avatar'});
  }
  if (avatarTotalBet() > 0){
    STATE.balance -= avatarTotalBet();
    document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
    toast(t('avatarPlacedBet', {side: betLabel(AVATAR.request.betSide), amount: fmtNum(AVATAR.request.betAmount)}));
  }
  AVATAR._sim = simulateRound();
  await revealAvatarCards(AVATAR._sim);
}
/* The deck is a set of card faces rather than a drawn one: shared/assets/cards/<suit><rank>.png,
   suit as its initial and rank lowercased, so the seven of spades is s7 and the ace of hearts ha.
   card_back.png rides along with them for a face-down card. */
const CARD_SUIT_FILE = {'\u2660':'s', '\u2665':'h', '\u2666':'d', '\u2663':'c'};
function cardFaceUrl(card){
  return `../shared/assets/cards/${CARD_SUIT_FILE[card.suit]}${String(card.rank).toLowerCase()}.png`;
}
function cardHtml(card, index){
  const red = card.suit==='♥' || card.suit==='♦';
  // the third card of a hand goes down sideways, as it is dealt
  const third = index===2 ? ' third' : '';
  return `<div class="playing-card ${red?'red':'black'}${third}" data-rank="${card.rank}${card.suit}" style="background-image:url('${cardFaceUrl(card)}')"></div>`;
}
async function revealAvatarCards(sim){
  const pEl = document.getElementById('playerCardsAvatar'), bEl = document.getElementById('bankerCardsAvatar');
  for (const [side,i] of dealSequence(sim)){
    (side==='player'?pEl:bEl).insertAdjacentHTML('beforeend', cardHtml(sim[side].cards[i], i));
    await new Promise(r=>setTimeout(r, 260));
  }
  document.getElementById('playerScoreAvatar').textContent = sim.player.score;
  document.getElementById('bankerScoreAvatar').textContent = sim.banker.score;
}
async function beginAvatarResultPhase(){
  AVATAR.phase = 'result';
  AVATAR.secondsLeft = AVATAR_RESULT_SECONDS;
  const sim = AVATAR._sim;
  setAvatarPhaseBanner(sim.result==='player' ? t('phasePlayerWin') : sim.result==='banker' ? t('phaseBankerWin') : t('phaseTie'), AVATAR_RESULT_SECONDS);

  let totalPayout = 0;
  for (const [betType, amount] of Object.entries(AVATAR.bets)){
    if (amount <= 0) continue;
    const payout = await settleBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId:AVATAR.table.id, roundId:AVATAR.currentRoundId, betType, amount, resultInfo:sim});
    totalPayout += payout;
    MY_BET_LOG.unshift({tableName:AVATAR.table.name, roundNo:AVATAR.roundNo, betType, amount, payout, mode:'avatar', dt:new Date().toISOString()});
  }
  if (totalPayout > 0){ STATE.balance += totalPayout; toast(t('wonAmount', {amount: fmtNum(totalPayout)})); }
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
  refreshPointsQuiet();

  await writeRoundDoc(db, {tableId:AVATAR.table.id, tableType:'avatar', roundNo:AVATAR.roundNo, shoeNo:AVATAR.table.shoeNo||1, sim, startedAt:new Date(Date.now()-(AVATAR_BETTING_SECONDS+AVATAR_DEALING_SECONDS)*1000).toISOString()});
  AVATAR.history.push(sim.result);
  AVATAR.pairFlags.push({playerPair:!!sim.playerPair, bankerPair:!!sim.bankerPair});
  AVATAR.roundNo++;
  renderAvatarRoad();
  renderAvatarTally();
  renderMyBetHistory();
}
async function refreshPointsQuiet(){
  const b = await getPlayerBalance(db, PLAYER.id);
  STATE.points = b.points;
  document.getElementById('hdrPoints').textContent = fmtNum(STATE.points);
}
function mountAvatarChat(tableId){
  const log = document.getElementById('chatLog');
  if (AVATAR.chatUnsub) AVATAR.chatUnsub();
  // single equality filter only (no orderBy) - avoids needing a composite Firestore index; sort client-side.
  AVATAR.chatUnsub = db.collection('chatMessages').where('tableId','==',tableId).limit(200)
    .onSnapshot(snap=>{
      const msgs = snap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.dt)-new Date(b.dt)).slice(-30);
      log.innerHTML = msgs.map(m=>`<div class="msg"><b>${escapeHtml(m.nickname)}:</b> ${escapeHtml(m.text)}</div>`).join('') || `<span class="hint">${t('noChat')}</span>`;
      log.scrollTop = log.scrollHeight;
    }, err=>{ log.innerHTML = `<span class="hint">${t('noChat')}</span>`; });
}
async function sendAvatarChat(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !AVATAR.table) return;
  input.value = '';
  await db.collection('chatMessages').doc(uuidv4()).set({tableId:AVATAR.table.id, memberId:PLAYER.id, nickname:PLAYER.nickname, text, dt:new Date().toISOString()});
}

/* ============================================================
   SPEED MODE — several tables running simultaneously, self-service
   ============================================================ */
let SPEED = { tables:{}, tstate:{}, allBets:[], tick:null, detailTableId:null };


async function loadSpeedTables(){
  const grid = document.getElementById('speedGrid');
  const toolbar = document.getElementById('speedToolbar');
  if (toolbar) toolbar.innerHTML = casinoTabsHtml() + gameTypeTabsHtml('speed') + `<div class="lobby-toolbar">${lobbySearchHtml()}</div>`;
  grid.innerHTML = `<div class="table-loading" style="grid-column:1/-1;height:200px;"><div class="spin-lg"></div><div>${t('connectingTable')}</div></div>`;
  const [tableSnap, roundsSnap, betSnap] = await Promise.all([
    db.collection('tables').where('type','==','speed').get(),
    db.collection('rounds').where('tableType','==','speed').get(),
    db.collection('memberLedger').where('category','==','bet').get(),
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  if (!tables.length){ grid.innerHTML = `<p class="hint">${t('noSpeedTables')}</p>`; return; }
  const allRounds = roundsSnap.docs.map(d=>d.data());
  SPEED.allBets = betSnap.docs.map(d=>d.data());
  SPEED.tables = {}; SPEED.tstate = {};

  grid.innerHTML = tables.map(tb=>speedTileHtml(tb)).join('');
  applyLobbyTileFilter();
  tables.forEach(tb=>{
    SPEED.tables[tb.id] = tb;
    const rounds = allRounds.filter(r=>r.tableId===tb.id).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
    SPEED.tstate[tb.id] = {
      phase:'betting', secondsLeft: SPEED_BETTING_SECONDS - (Object.keys(SPEED.tstate).length*3)%SPEED_BETTING_SECONDS,
      roundNo: (Math.max(0, ...rounds.map(r=>r.roundNo||0))||0)+1,
      bets:{player:0, banker:0, tie:0, playerPair:0, bankerPair:0}, currentRoundId: uuidv4(),
      history: rounds.map(r=>r.result),
      pairFlags: rounds.map(r=>({playerPair:!!r.playerPair, bankerPair:!!r.bankerPair})),
    };
    renderSpeedTileRoad(tb.id);
    renderSpeedTileBets(tb.id);
    renderSpeedTileStats(tb.id);
  });
}
// Built from the same pieces as the avatar lobby card - same classes, same order - so the
// two selection screens render identically. The one Speed-specific bit is the countdown,
// which takes the slot the avatar card gives its request/state pill.
function speedTileHtml(tb){
  return `
  <div class="lobby-card speed-tile" id="tile-${tb.id}" data-casino="${tb.casino}" data-name="${escapeHtml(tb.name).toLowerCase()}" onclick="openSpeedTableDetail('${tb.id}')" title="${t('openTable')}">
    <div class="thumb"></div>
    <div class="mini-road br-grid" id="road-${tb.id}"></div>
    <div class="card-foot">
      <div class="card-line">
        <span class="name">${escapeHtml(tb.name)}</span>
        <span class="card-status live">⏱ <b id="timer-${tb.id}">15</b></span>
        <span class="card-hot" id="score-${tb.id}"></span>
        <span class="card-hot" id="hotbadge-${tb.id}"></span>
        <button class="card-favorite" onclick="event.stopPropagation();toggleCardFavorite(this)" title="${t('favorites')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.35-9.5-8.8C.7 7.9 2 4.5 5.4 4c2-.3 3.7.6 4.6 2.2C10.9 4.6 12.6 3.7 14.6 4c3.4.5 4.7 3.9 2.9 7.2C15 15.65 12 20 12 20z"/></svg></button>
      </div>
      <div class="card-line meta"><span class="limits">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</span><span class="counts" id="stats-${tb.id}"></span></div>
    </div>
  </div>`;
}

function renderSpeedTileRoad(tableId){
  const el = document.getElementById('road-'+tableId);
  if (el){
    const cols = buildBigRoad(SPEED.tstate[tableId].history.slice(-40), (SPEED.tstate[tableId].pairFlags||[]).slice(-40));
    paintRoad(el, renderBigRoad(cols, 4) || `<span class="hint" style="font-size:9px;">${t('noRecord')}</span>`);
  }
  if (SPEED.detailTableId===tableId) renderSpeedDetailRoad(tableId);
}
function renderSpeedDetailRoad(tableId){
  const history = SPEED.tstate[tableId].history;
  const pairFlags = SPEED.tstate[tableId].pairFlags || [];
  const cols = buildBigRoad(history.slice(-90), pairFlags.slice(-90));
  paintRoad(document.getElementById('road-detail'), renderBigRoad(cols, 6) || `<span class="hint">${t('noRecord')}</span>`);
  paintRoad(document.getElementById('bigeye-detail'), renderDerivedRoad(deriveBigEyeBoy(cols)) || `<span class="hint">${t('noRecord')}</span>`);
  paintRoad(document.getElementById('smallroad-detail'), renderDerivedRoad(deriveSmallRoad(cols), 'filled') || `<span class="hint">${t('noRecord')}</span>`);
  paintRoad(document.getElementById('cockroach-detail'), renderDerivedRoad(deriveCockroachRoad(cols), 'diagonal') || `<span class="hint">${t('noRecord')}</span>`);
  paintRoad(document.getElementById('beadroad-detail'), renderBeadRoad(history.slice(-BEAD_WINDOW), pairFlags.slice(-BEAD_WINDOW)) || `<span class="hint">${t('noRecord')}</span>`);
  renderSpeedDetailTally(tableId);
}
function renderSpeedDetailTally(tableId){
  const listEl = document.getElementById('tallylist-detail');
  const countEl = document.getElementById('tallycount-detail');
  if (!listEl && !countEl) return;
  const history = SPEED.tstate[tableId].history;
  const pairFlags = SPEED.tstate[tableId].pairFlags || [];
  const wins = tableWinCounts(history);
  const playerPairs = pairFlags.filter(p=>p.playerPair).length;
  const bankerPairs = pairFlags.filter(p=>p.bankerPair).length;
  if (countEl) countEl.textContent = '#' + (SPEED.tstate[tableId]?.roundNo || 1);
  if (listEl){
    // P/B/T rows carry the result letter; the two pair rows are a plain grey bead marked
    // with the same corner dot the roads use (blue = player pair, red = banker pair).
    const row = (cls, letter, val) => `<div class="tl-row ${cls}"><span class="tl-badge">${letter}</span><b>${fmtNum(val)}</b></div>`;
    const pairRow = (side, val) => `<div class="tl-row pair ${side}"><span class="tl-badge"><i class="br-pair ${side}"></i></span><b>${fmtNum(val)}</b></div>`;
    listEl.innerHTML = row('player','P',wins.player) + row('banker','B',wins.banker) + row('tie','T',wins.tie) + pairRow('player',playerPairs) + pairRow('banker',bankerPairs);
  }
}
function renderSpeedTileStats(tableId){
  const results = SPEED.tstate[tableId].history;
  const wins = tableWinCounts(results);
  const streak = trailingStreak(results);
  const statsEl = document.getElementById('stats-'+tableId);
  if (statsEl) statsEl.innerHTML = `P <b>${wins.player}</b> · B <b>${wins.banker}</b> · T <b>${wins.tie}</b>`;
  const badgeEl = document.getElementById('hotbadge-'+tableId);
  if (badgeEl) badgeEl.textContent = streak.len >= 3 ? `🔥 ${streak.len}연속 ${streak.side==='player'?t('player'):t('banker')}` : '';
}
// Betting lives only inside the table now, so this paints the detail screen's spots alone.
function renderSpeedTileBets(tableId){
  if (SPEED.detailTableId!==tableId) return;
  const s = SPEED.tstate[tableId];
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    const el = document.getElementById(`mybet-detail-${k}`);
    if (el) el.textContent = s.bets[k] ? fmtNum(s.bets[k]) : '';
  });
}
function placeSpeedBet(tableId, type){
  const s = SPEED.tstate[tableId];
  if (!s || s.phase !== 'betting'){ toast(t('notBettingTime'), true); return; }
  let locked = 0; Object.values(SPEED.tstate).forEach(x=> locked += Object.values(x.bets).reduce((a,b)=>a+b,0));
  if (STATE.balance - locked < STATE.selectedChip){ toast(t('insufficientBalance'), true); return; }
  s.bets[type] += STATE.selectedChip;
  if (SPEED.detailTableId===tableId) document.getElementById(`spot-detail-${type}`)?.classList.add('selected');
  renderSpeedTileBets(tableId);
  projectSpeedBalance();
}

/* ---------------- speed single-table detail screen (opened from a tile) ---------------- */
function openSpeedTableDetail(tableId, preserveScroll){
  const s = SPEED.tstate[tableId], tb = SPEED.tables[tableId];
  if (!s || !tb) return;
  SPEED.detailTableId = tableId;
  showView('viewSpeedTable');
  document.getElementById('viewSpeedTable').innerHTML = speedDetailShellHtml(tableId);
  renderSpeedTileBets(tableId);
  renderSpeedDetailRoad(tableId);
  setSpeedTilePhaseText(tableId, s.phase==='betting'?t('phaseBetting'):s.phase==='dealing'?t('phaseDealing'):'');
  setSpeedTileTimer(tableId, Math.max(0, s.secondsLeft));
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    const spot = document.getElementById(`spot-detail-${k}`);
    if (spot){ spot.classList.toggle('selected', s.bets[k]>0); spot.classList.toggle('locked', s.phase!=='betting'); }
  });
  if (s.phase==='result' && s._sim) revealSpeedDetailCards(s._sim, true);
}
function closeSpeedTableDetail(){
  SPEED.detailTableId = null;
  document.getElementById('viewSpeedTable').innerHTML = '';
  showView('viewSpeedLobby');
}
function speedDetailShellHtml(tableId){
  const tb = SPEED.tables[tableId];
  return `
  <div class="speed-detail-wrap">
    <div class="speed-detail-grid">
      <div class="sd-stage">
        <button class="icon-btn speed-detail-close" onclick="closeSpeedTableDetail()" style="position:absolute;top:14px;left:14px;z-index:2;background:rgba(0,0,0,.55);color:#fff;border-color:rgba(255,255,255,.15);" data-i18n-title="backToList" title="목록으로">✕</button>
        <div class="sd-stage-top">
          <div class="sd-type-badge">SPEED</div>
          <div class="sd-table-id-mini">${escapeHtml(tb.name)}</div>
          <div class="sd-limit-text">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</div>
        </div>
        <div class="phase-banner" id="phase-detail">${t('phaseBetting')}</div>
        <div class="sd-stage-icons">
          <button onclick="toggleStageFullscreen(this)" data-i18n-title="fullscreen" title="전체화면"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
          <button onclick="this.classList.toggle('muted')" data-i18n-title="mute" title="음소거">
            <svg class="icon-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/></svg>
            <svg class="icon-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M23 9l-6 6"/><path d="M17 9l6 6"/></svg>
          </button>
          <button onclick="this.classList.toggle('active')" data-i18n-title="viewToggle" title="화면 보기 전환"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button onclick="toast(t('tipComingSoon'))" data-i18n-title="giveTip" title="팁"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="5"/><path d="M9 21l3-4 3 4"/><path d="M12 21v-4"/></svg></button>
          <button onclick="openGameHistory()" data-i18n-title="gameHistory" title="게임기록"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></button>
        </div>
        <div class="table-felt">
          <div class="cards-area">
            <div class="hand player"><div class="cards" id="playerCardsDetail"></div><div class="score" id="playerScoreDetail"></div></div>
            <div class="hand banker"><div class="cards" id="bankerCardsDetail"></div><div class="score" id="bankerScoreDetail"></div></div>
          </div>
        </div>
        <div class="timer-ring-wrap"><svg width="64" height="64"><circle cx="32" cy="32" r="27" stroke="var(--line)" stroke-width="5" fill="none"/><circle cx="32" cy="32" r="27" stroke="var(--jade)" stroke-width="5" fill="none" stroke-dasharray="169.6" stroke-dashoffset="0" stroke-linecap="round"/></svg><div class="txt" id="timer-detail">15</div></div>
      </div>
      ${avatarScoreboardHtml('detail')}
      <div class="sd-bets">
        <div class="pair-row">
          <div class="bet-spot pair player" id="spot-detail-playerPair" onclick="placeSpeedBet('${tableId}','playerPair')"><div class="label" data-i18n="playerPair">플레이어 페어</div><div class="meta-row"><span>👤 0</span><span>₱ 0</span></div><div class="odds">11:1</div><div class="my-bet" id="mybet-detail-playerPair"></div></div>
          <div class="bet-spot tie" id="spot-detail-tie" onclick="placeSpeedBet('${tableId}','tie')"><div class="label" data-i18n="tie">타이</div><div class="meta-row"><span>👤 0</span><span>₱ 0</span></div><div class="odds">8:1</div><div class="my-bet" id="mybet-detail-tie"></div></div>
          <div class="bet-spot pair banker" id="spot-detail-bankerPair" onclick="placeSpeedBet('${tableId}','bankerPair')"><div class="label" data-i18n="bankerPair">뱅커 페어</div><div class="meta-row"><span>👤 0</span><span>₱ 0</span></div><div class="odds">11:1</div><div class="my-bet" id="mybet-detail-bankerPair"></div></div>
        </div>
        <div class="bet-rail two-up" style="margin-top:0;">
          <div class="bet-spot player" id="spot-detail-player" onclick="placeSpeedBet('${tableId}','player')"><div class="label" data-i18n="player">플레이어</div><div class="meta-row"><span>👤 0</span><span>₱ 0</span></div><div class="odds">1:1</div><div class="my-bet" id="mybet-detail-player"></div></div>
          <div class="bet-spot banker" id="spot-detail-banker" onclick="placeSpeedBet('${tableId}','banker')"><div class="label" data-i18n="banker">뱅커</div><div class="meta-row"><span>👤 0</span><span>₱ 0</span></div><div class="odds">0.95:1</div><div class="my-bet" id="mybet-detail-banker"></div></div>
        </div>
        <div class="sd-chip-tray">
          <button class="btn btn-sm" onclick="clearSpeedDetailBets('${tableId}')" data-i18n="cancelBet">취소</button>
          ${CHIP_VALUES.map(v=>`<div class="chip ${v===STATE.selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})" style="background-image:url('${chipFaceUrl(v)}')" aria-label="${chipLabel(v)}"></div>`).join('')}
          <span class="spacer"></span>
          <button class="btn btn-sm btn-gold" onclick="confirmSpeedBetDetail()" data-i18n="betComplete">베팅완료</button>
          <button class="btn btn-sm" onclick="repeatLastSpeedBetDetail('${tableId}')" data-i18n="repeatBet">반복</button>
        </div>
      </div>
    </div>
  </div>`;
}
function clearSpeedDetailCards(){
  const p = document.getElementById('playerCardsDetail'), b = document.getElementById('bankerCardsDetail');
  if (p) p.innerHTML = ''; if (b) b.innerHTML = '';
  const ps = document.getElementById('playerScoreDetail'), bs = document.getElementById('bankerScoreDetail');
  if (ps) ps.textContent = ''; if (bs) bs.textContent = '';
}
async function revealSpeedDetailCards(sim, instant){
  const pEl = document.getElementById('playerCardsDetail'), bEl = document.getElementById('bankerCardsDetail');
  if (!pEl || !bEl) return;
  pEl.innerHTML = ''; bEl.innerHTML = '';
  for (const [side,i] of dealSequence(sim)){
    (side==='player'?pEl:bEl).insertAdjacentHTML('beforeend', cardHtml(sim[side].cards[i], i));
    if (!instant) await new Promise(r=>setTimeout(r, 260));
  }
  document.getElementById('playerScoreDetail').textContent = sim.player.score;
  document.getElementById('bankerScoreDetail').textContent = sim.banker.score;
}
function clearSpeedDetailBets(tableId){
  const s = SPEED.tstate[tableId]; if (!s || s.phase!=='betting') return;
  s.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    document.getElementById(`spot-detail-${k}`)?.classList.remove('selected');
  });
  renderSpeedTileBets(tableId);
  projectSpeedBalance();
}
function confirmSpeedBetDetail(){ toast(t('betCompleteToast')); }
function repeatLastSpeedBetDetail(tableId){
  const s = SPEED.tstate[tableId]; if (!s || s.phase!=='betting') return;
  if (!s.lastBets || !Object.values(s.lastBets).some(v=>v>0)){ toast(t('repeatNoPrev'), true); return; }
  let locked = 0; Object.values(SPEED.tstate).forEach(x=> locked += Object.values(x.bets).reduce((a,b)=>a+b,0));
  const need = Object.values(s.lastBets).reduce((a,b)=>a+b,0);
  if (STATE.balance - locked < need){ toast(t('insufficientBalance'), true); return; }
  Object.entries(s.lastBets).forEach(([k,v])=>{ if (v>0){ s.bets[k] = (s.bets[k]||0) + v; document.getElementById(`spot-detail-${k}`)?.classList.add('selected'); } });
  renderSpeedTileBets(tableId);
  projectSpeedBalance();
}
function projectSpeedBalance(){
  let locked = 0;
  Object.values(SPEED.tstate).forEach(s=> locked += Object.values(s.bets).reduce((a,b)=>a+b,0));
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance - locked);
}
async function tickAllSpeedTables(){
  for (const tableId of Object.keys(SPEED.tstate)){
    const s = SPEED.tstate[tableId];
    s.secondsLeft--;
    if (s.phase==='betting'){
      setSpeedTileTimer(tableId, Math.max(0,s.secondsLeft));
      if (s.secondsLeft <= 0) await beginSpeedDealing(tableId);
    } else if (s.phase==='dealing'){
      if (s.secondsLeft <= 0) await beginSpeedResult(tableId);
    } else if (s.phase==='result'){
      setSpeedTileTimer(tableId, Math.max(0,s.secondsLeft));
      if (s.secondsLeft <= 0) beginSpeedBetting(tableId);
    }
  }
}
function setSpeedTileTimer(tableId, v){
  const el = document.getElementById('timer-'+tableId); if (el) el.textContent = v;
  if (SPEED.detailTableId===tableId){ const d = document.getElementById('timer-detail'); if (d) d.textContent = v; }
}
// The list no longer captions the phase - only the open table does.
function setSpeedTilePhaseText(tableId, txt){
  if (SPEED.detailTableId!==tableId || !txt) return;
  const d = document.getElementById('phase-detail'); if (d) d.textContent = txt;
}
function beginSpeedBetting(tableId){
  const s = SPEED.tstate[tableId];
  const hadBets = Object.values(s.bets).some(v=>v>0);
  if (hadBets) s.lastBets = {...s.bets};
  s.phase = 'betting'; s.secondsLeft = SPEED_BETTING_SECONDS; s.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0}; s.currentRoundId = uuidv4();
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    if (SPEED.detailTableId===tableId) document.getElementById(`spot-detail-${k}`)?.classList.remove('selected','locked');
  });
  renderSpeedTileBets(tableId);
  setSpeedTilePhaseText(tableId, t('phaseBetting'));
  const scoreEl = document.getElementById('score-'+tableId); if (scoreEl) scoreEl.textContent = '';
  if (SPEED.detailTableId===tableId) clearSpeedDetailCards();
}
async function beginSpeedDealing(tableId){
  const s = SPEED.tstate[tableId];
  s.phase = 'dealing'; s.secondsLeft = SPEED_DEALING_SECONDS;
  if (SPEED.detailTableId===tableId){
    ['player','tie','banker','playerPair','bankerPair'].forEach(k=> document.getElementById(`spot-detail-${k}`)?.classList.add('locked'));
  }
  setSpeedTilePhaseText(tableId, t('phaseDealing'));
  for (const [betType, amount] of Object.entries(s.bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:s.currentRoundId, betType, amount, staff:'system'});
  }
  const totalBet = Object.values(s.bets).reduce((a,b)=>a+b,0);
  if (totalBet > 0){ STATE.balance -= totalBet; }
  s._sim = simulateRound();
  if (SPEED.detailTableId===tableId) await revealSpeedDetailCards(s._sim);
}
async function beginSpeedResult(tableId){
  const s = SPEED.tstate[tableId];
  s.phase = 'result'; s.secondsLeft = SPEED_RESULT_SECONDS;
  const sim = s._sim;
  const tb = SPEED.tables[tableId];
  setSpeedTilePhaseText(tableId, sim.result==='player' ? 'PLAYER WIN' : sim.result==='banker' ? 'BANKER WIN' : 'TIE');
  const scoreEl = document.getElementById('score-'+tableId);
  if (scoreEl) scoreEl.textContent = `P${sim.player.score} : B${sim.banker.score}`;

  let totalPayout = 0;
  for (const [betType, amount] of Object.entries(s.bets)){
    if (amount <= 0) continue;
    const payout = await settleBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:s.currentRoundId, betType, amount, resultInfo:sim});
    totalPayout += payout;
    MY_BET_LOG.unshift({tableName:tb.name, roundNo:s.roundNo, betType, amount, payout, mode:'speed', dt:new Date().toISOString()});
    SPEED.allBets.push({relatedTableId:tableId, amount:-amount, category:'bet', createdAt:new Date().toISOString()});
  }
  if (MY_BET_LOG.length) renderMyBetHistory();
  if (totalPayout > 0){ STATE.balance += totalPayout; toast(`[${tb.name}] ${t('wonAmount', {amount: fmtNum(totalPayout)})}`); }
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);

  await writeRoundDoc(db, {tableId, tableType:'speed', roundNo:s.roundNo, shoeNo:tb.shoeNo||1, sim, startedAt:new Date(Date.now()-(SPEED_BETTING_SECONDS+SPEED_DEALING_SECONDS)*1000).toISOString()});
  s.history.push(sim.result);
  s.pairFlags.push({playerPair:!!sim.playerPair, bankerPair:!!sim.bankerPair});
  s.roundNo++;
  renderSpeedTileRoad(tableId);
  renderSpeedTileStats(tableId);
}
