/* ============================================================
   Game site (Avatar + Speed, integrated) — CAGE ADMIN 5.0
   One login/session/balance shared across both game modes.
   Avatar = immersive single-table baccarat. Speed = several
   tables running simultaneously with a faster round cadence.
   Both persist every round/bet/payout to Firestore via the
   shared engine in /shared/game-engine.js.
   ============================================================ */

let db = null;
let MODE = null; // 'avatar' | 'speed' | null (picker)
const AVATAR_BETTING_SECONDS = 30, AVATAR_DEALING_SECONDS = 4, AVATAR_RESULT_SECONDS = 5;
const SPEED_BETTING_SECONDS = 15, SPEED_DEALING_SECONDS = 3, SPEED_RESULT_SECONDS = 3;

const BET_LABEL = {player:'플레이어', banker:'뱅커', tie:'타이', playerPair:'플레이어 페어', bankerPair:'뱅커 페어'};
let MY_BET_LOG = []; // {tableName, roundNo, betType, amount, payout} newest first, shared across both modes

let STATE = { balance: 0, points: 0, selectedChip: CHIP_VALUES[0] };

/* ---------------- boot / auth ---------------- */
window.addEventListener('DOMContentLoaded', ()=>{
  db = cageInitFirebase();
  document.getElementById('liPw').addEventListener('keydown', e=>{ if (e.key==='Enter') onLogin(); });
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
  ['liId','liPw','suId','suPw','suNick','suPhone','suAgent'].forEach(id=>{
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('liErr').style.display = 'none';
  document.getElementById('suErr').style.display = 'none';
}

async function onLogin(){
  const id = document.getElementById('liId').value.trim();
  const pw = document.getElementById('liPw').value.trim();
  const err = document.getElementById('liErr');
  if (!id || !pw){ err.textContent = 'ID/비밀번호를 입력하세요.'; err.style.display='block'; return; }
  const res = await playerLogin(db, id, pw);
  if (!res.ok){
    err.textContent = res.reason==='notfound' ? '존재하지 않는 계정입니다.' : res.reason==='blocked' ? '이용이 제한된 계정입니다.' : '비밀번호가 일치하지 않습니다.';
    err.style.display='block';
    return;
  }
  err.style.display='none';
  enterApp();
}
async function onSignup(){
  const id = document.getElementById('suId').value.trim();
  const pw = document.getElementById('suPw').value.trim();
  const nickname = document.getElementById('suNick').value.trim();
  const phone = document.getElementById('suPhone').value.trim();
  const casino = document.getElementById('suCasino').value;
  const agentCode = document.getElementById('suAgent').value.trim() || 'DIRECT';
  const err = document.getElementById('suErr');
  if (!id || !pw || !nickname){ err.textContent = '필수 항목을 입력하세요.'; err.style.display='block'; return; }
  const res = await playerSignup(db, {id, pw, nickname, phone, casino, agentCode});
  if (!res.ok){ err.textContent = '이미 존재하는 아이디입니다.'; err.style.display='block'; return; }
  err.style.display='none';
  toast('회원가입이 완료되었습니다. 가입 축하 포인트 100,000이 지급되었습니다.');
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
function chipLabel(v){ if (v>=1000000) return (v/1000000)+'M'; if (v>=10000) return (v/10000)+'만'; return (v/1000)+'천'; }
function selectChip(v){
  STATE.selectedChip = v;
  document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('selected', Number(c.dataset.chip)===v));
}
function renderMyBetHistory(){
  const el = document.getElementById('myBetHistory'); if (!el) return;
  if (!MY_BET_LOG.length){ el.innerHTML = `<span class="hint">아직 베팅 내역이 없습니다</span>`; return; }
  el.innerHTML = MY_BET_LOG.slice(0, 20).map(b=>{
    const net = b.payout - b.amount;
    const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    return `<div class="row"><span>[${escapeHtml(b.tableName)}] #${b.roundNo} ${BET_LABEL[b.betType]} ${fmtNum(b.amount)}</span><span class="${cls}">${net===0 ? '푸시' : fmtSigned(net)}</span></div>`;
  }).join('');
}

/* ============================================================
   Navigation shell shared by both modes
   ============================================================ */
function stopAllLoops(){
  stopAvatarRoundLoop();
  if (SPEED.tick){ clearInterval(SPEED.tick); SPEED.tick = null; }
  if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); AVATAR.chatUnsub = null; }
  // #viewAvatarTable holds a dynamically-built #myBetHistory / chip-tray that would otherwise
  // collide with the static ids reused inside #viewSpeedLobby once both are simultaneously in the DOM.
  const avTable = document.getElementById('viewAvatarTable'); if (avTable) avTable.innerHTML = '';
}
function showView(name){
  ['viewPicker','viewAvatarLobby','viewAvatarTable','viewSpeedLobby'].forEach(id=>{
    document.getElementById(id).style.display = (id===name) ? 'block' : 'none';
  });
  document.getElementById('changeGameBtn').style.display = name==='viewPicker' ? 'none' : 'inline-block';
  document.getElementById('avatarLobbyBtn').style.display = name==='viewAvatarTable' ? 'inline-block' : 'none';
  document.getElementById('chipTray').style.display = name==='viewSpeedLobby' ? 'flex' : 'none';
}
function showPicker(){
  stopAllLoops();
  MODE = null;
  showView('viewPicker');
}
async function chooseAvatar(){
  stopAllLoops();
  MODE = 'avatar';
  showView('viewAvatarLobby');
  await goAvatarLobby();
}
async function chooseSpeed(){
  stopAllLoops();
  MODE = 'speed';
  showView('viewSpeedLobby');
  renderChipTray();
  await loadSpeedTables();
  renderMyBetHistory();
  SPEED.tick = setInterval(tickAllSpeedTables, 1000);
}
function backToAvatarLobby(){
  goAvatarLobby();
}

/* ============================================================
   AVATAR MODE — immersive single-table baccarat
   ============================================================ */
let AVATAR = {
  table: null, phase: 'idle', secondsLeft: 0, roundNo: 1,
  bets: {player:0, banker:0, tie:0, playerPair:0, bankerPair:0},
  history: [], currentRoundId: null, timerHandle: null, chatUnsub: null,
  lobbyData: null,
};

async function goAvatarLobby(){
  stopAvatarRoundLoop();
  if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); AVATAR.chatUnsub = null; }
  showView('viewAvatarLobby');
  const lobby = document.getElementById('viewAvatarLobby');
  lobby.innerHTML = `
    <div class="lobby-wrap">
      <div class="lobby-title">아바타 테이블</div>
      <div class="lobby-toolbar">
        <label class="hint" style="margin:0;">정렬</label>
        <select id="lobbySort" onchange="renderAvatarLobbyGrid(this.value)">
          <option value="popular">인기순 (베팅총액)</option>
          <option value="today">오늘 베팅액순</option>
          <option value="hot">좋은 흐름순</option>
          <option value="name">테이블명순</option>
        </select>
      </div>
      <div class="lobby-grid" id="lobbyGrid"><div class="spin"></div></div>
    </div>`;
  const [tableSnap, roundsSnap, betSnap] = await Promise.all([
    db.collection('tables').where('type','==','avatar').get(),
    db.collection('rounds').where('tableType','==','avatar').get(),
    db.collection('memberLedger').where('category','==','bet').get(), // single equality filter only - no composite index needed
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  AVATAR.lobbyData = { tables, rounds: roundsSnap.docs.map(d=>d.data()), bets: betSnap.docs.map(d=>d.data()) };
  if (!tables.length){ document.getElementById('lobbyGrid').innerHTML = `<p class="hint">열려있는 아바타 테이블이 없습니다. 파트너 어드민에서 데모 데이터를 생성해주세요.</p>`; return; }
  renderAvatarLobbyGrid('popular');
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
  grid.innerHTML = sorted.map(({t, results, wins, streak, volume})=>{
    const cols = buildBigRoad(results.slice(-40));
    const isHot = streak.len >= 3;
    return `
    <div class="lobby-card" onclick="enterAvatarTable('${t.id}')">
      <div class="thumb">
        <div class="live-dot"><span></span>LIVE</div>
        <div class="badge-type">AVATAR</div>
        <div class="felt"></div>
        ${isHot ? `<div class="hot-badge">🔥 ${streak.len}연속 ${streak.side==='player'?'플레이어':'뱅커'}</div>` : ''}
      </div>
      <div class="info"><div class="name">${escapeHtml(t.name)}</div><div class="limits">${t.casino} · ${fmtNum(t.betMin)} ~ ${fmtNum(t.betMax)}</div></div>
      <div class="mini-road br-grid">${renderBigRoad(cols, 4) || '<span class="hint" style="font-size:10px;">기록 없음</span>'}</div>
      <div class="stat-row"><span>P <b>${wins.player}</b> · B <b>${wins.banker}</b> · T <b>${wins.tie}</b></span><span>오늘 <b>${fmtNum(volume.today)}</b></span></div>
    </div>`;
  }).join('');
}

async function enterAvatarTable(tableId){
  showView('viewAvatarTable');
  const view = document.getElementById('viewAvatarTable');
  // unified loading transition regardless of casino/table
  view.innerHTML = `<div class="table-loading"><div class="spin-lg"></div><div>테이블에 연결 중입니다...</div></div>`;

  const doc = await db.collection('tables').doc(tableId).get();
  AVATAR.table = {id:tableId, ...doc.data()};
  const roundsSnap = await db.collection('rounds').where('tableId','==',tableId).get();
  const rounds = roundsSnap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  AVATAR.history = rounds.map(r=>r.result);
  AVATAR.roundNo = (Math.max(0, ...rounds.map(r=>r.roundNo||0)) || 0) + 1;

  view.innerHTML = avatarTableShellHtml();
  renderAvatarRoadmap();
  renderAvatarRecentResults();
  renderMyBetHistory();
  mountAvatarChat(tableId);
  startAvatarRoundLoop();
}
function avatarTableShellHtml(){
  const t = AVATAR.table;
  return `
  <div class="table-shell">
    <div class="table-main">
      <div class="table-stage">
        <div class="table-id-badge">${t.name}</div>
        <div class="table-shoe-badge">SHOE #${t.shoeNo||1} · ROUND ${AVATAR.roundNo}</div>
        <div class="phase-banner" id="phaseBanner">베팅하세요</div>
        <div class="table-felt">
          <div class="cards-area" id="cardsArea">
            <div class="hand player"><div class="side-label">PLAYER</div><div class="cards" id="playerCards"></div><div class="score" id="playerScore">&nbsp;</div></div>
            <div class="hand banker"><div class="side-label">BANKER</div><div class="cards" id="bankerCards"></div><div class="score" id="bankerScore">&nbsp;</div></div>
          </div>
        </div>
        <div class="timer-ring-wrap"><svg width="56" height="56"><circle cx="28" cy="28" r="24" stroke="var(--line)" stroke-width="4" fill="none"/><circle id="timerArc" cx="28" cy="28" r="24" stroke="var(--brass)" stroke-width="4" fill="none" stroke-dasharray="150.8" stroke-dashoffset="0" stroke-linecap="round"/></svg><div class="txt" id="timerTxt">30</div></div>
        <div class="result-flash" id="resultFlash"><div class="txt" id="resultFlashTxt"></div></div>
      </div>
      <div class="bet-rail with-pairs">
        <div class="bet-spot player" id="spot-player" onclick="placeAvatarBet('player')"><div class="label">PLAYER</div><div class="odds">1 : 1</div><div class="my-bet" id="mybet-player"></div></div>
        <div>
          <div class="bet-spot tie" id="spot-tie" onclick="placeAvatarBet('tie')"><div class="label">TIE</div><div class="odds">8 : 1</div><div class="my-bet" id="mybet-tie"></div></div>
          <div class="pair-row">
            <div class="bet-spot pair" id="spot-playerPair" onclick="placeAvatarBet('playerPair')"><div class="label">P PAIR</div><div class="odds">11:1</div><div class="my-bet" id="mybet-playerPair"></div></div>
            <div class="bet-spot pair" id="spot-bankerPair" onclick="placeAvatarBet('bankerPair')"><div class="label">B PAIR</div><div class="odds">11:1</div><div class="my-bet" id="mybet-bankerPair"></div></div>
          </div>
        </div>
        <div class="bet-spot banker" id="spot-banker" onclick="placeAvatarBet('banker')"><div class="label">BANKER</div><div class="odds">0.95 : 1</div><div class="my-bet" id="mybet-banker"></div></div>
      </div>
      <div class="chip-tray">
        ${CHIP_VALUES.map(v=>`<div class="chip c${v} ${v===STATE.selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})">${chipLabel(v)}</div>`).join('')}
        <div class="bet-controls">
          <span class="current-bet-total" id="betTotalTxt">총 0</span>
          <button class="btn btn-sm" onclick="clearAvatarBets()">취소</button>
        </div>
      </div>
    </div>
    <div class="table-side">
      <div class="card roadmap-card"><h3>빅로드</h3><div class="br-grid" id="bigRoadGrid"></div>
        <div class="roadmap-legend"><span><i style="background:#4A9FD8;"></i>PLAYER</span><span><i style="background:var(--danger);"></i>BANKER</span><span><i style="background:var(--jade);"></i>TIE</span></div>
      </div>
      <div class="card"><h3>최근 결과</h3><div class="recent-results" id="recentResults"></div></div>
      <div class="card"><h3>내 베팅내역</h3><div class="bet-history-mini" id="myBetHistory"></div></div>
      <div class="card chat-panel"><h3>채팅</h3>
        <div class="chat-log" id="chatLog"></div>
        <div class="chat-input-row"><input id="chatInput" placeholder="메시지 입력..." onkeydown="if(event.key==='Enter')sendAvatarChat()"><button class="btn btn-sm btn-gold" onclick="sendAvatarChat()">전송</button></div>
      </div>
    </div>
  </div>`;
}
function placeAvatarBet(type){
  if (AVATAR.phase !== 'betting'){ toast('베팅 시간이 아닙니다', true); return; }
  if (STATE.balance < STATE.selectedChip + avatarTotalBet()){ toast('보유금이 부족합니다', true); return; }
  AVATAR.bets[type] += STATE.selectedChip;
  document.getElementById('spot-'+type).classList.add('selected');
  updateAvatarBetUi();
}
function avatarTotalBet(){ return Object.values(AVATAR.bets).reduce((a,b)=>a+b,0); }
function updateAvatarBetUi(){
  Object.keys(AVATAR.bets).forEach(k=>{
    const el = document.getElementById('mybet-'+k);
    if (el) el.textContent = AVATAR.bets[k] ? fmtNum(AVATAR.bets[k]) : '';
  });
  const totalEl = document.getElementById('betTotalTxt');
  if (totalEl) totalEl.textContent = '총 ' + fmtNum(avatarTotalBet());
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance - avatarTotalBet());
}
function clearAvatarBets(){
  AVATAR.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  document.querySelectorAll('.bet-spot').forEach(s=>s.classList.remove('selected'));
  updateAvatarBetUi();
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
}

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
  clearAvatarBets();
  setAvatarPhaseBanner('베팅하세요', AVATAR_BETTING_SECONDS);
  document.querySelectorAll('.bet-spot').forEach(s=>s.classList.remove('locked'));
  const flash = document.getElementById('resultFlash'); if (flash) flash.classList.remove('show');
  document.getElementById('playerCards').innerHTML = ''; document.getElementById('bankerCards').innerHTML = '';
  document.getElementById('playerScore').textContent = ' '; document.getElementById('bankerScore').textContent = ' ';
}
function setAvatarPhaseBanner(text, secs){
  const el = document.getElementById('phaseBanner'); if (el) el.textContent = text;
  updateAvatarTimerRing(secs, secs);
}
function updateAvatarTimerRing(secLeft, secTotal){
  const txt = document.getElementById('timerTxt'); if (txt) txt.textContent = secLeft;
  const arc = document.getElementById('timerArc');
  if (arc){ const c = 150.8; arc.style.strokeDashoffset = c * (1 - secLeft/secTotal); }
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
  document.querySelectorAll('.bet-spot').forEach(s=>s.classList.add('locked'));
  setAvatarPhaseBanner('카드를 배분합니다', AVATAR_DEALING_SECONDS);
  for (const [betType, amount] of Object.entries(AVATAR.bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId:AVATAR.table.id, roundId:AVATAR.currentRoundId, betType, amount, staff:'system'});
  }
  if (avatarTotalBet() > 0){ STATE.balance -= avatarTotalBet(); }
  AVATAR._sim = simulateRound();
  await revealAvatarCards(AVATAR._sim);
}
function cardHtml(card){
  const red = card.suit==='♥' || card.suit==='♦';
  return `<div class="playing-card ${red?'red':'black'}">${card.rank}${card.suit}</div>`;
}
async function revealAvatarCards(sim){
  const pEl = document.getElementById('playerCards'), bEl = document.getElementById('bankerCards');
  const seq = [[pEl,sim.player.cards[0]],[bEl,sim.banker.cards[0]],[pEl,sim.player.cards[1]],[bEl,sim.banker.cards[1]]];
  for (const [el,card] of seq){
    el.insertAdjacentHTML('beforeend', cardHtml(card));
    await new Promise(r=>setTimeout(r, 260));
  }
  document.getElementById('playerScore').textContent = sim.player.score;
  document.getElementById('bankerScore').textContent = sim.banker.score;
}
async function beginAvatarResultPhase(){
  AVATAR.phase = 'result';
  AVATAR.secondsLeft = AVATAR_RESULT_SECONDS;
  const sim = AVATAR._sim;
  setAvatarPhaseBanner(sim.result==='player' ? '플레이어 승리' : sim.result==='banker' ? '뱅커 승리' : '타이', AVATAR_RESULT_SECONDS);

  const flash = document.getElementById('resultFlash');
  const flashTxt = document.getElementById('resultFlashTxt');
  flashTxt.className = 'txt ' + sim.result;
  flashTxt.textContent = sim.result==='player' ? 'PLAYER WIN' : sim.result==='banker' ? 'BANKER WIN' : 'TIE';
  flash.classList.add('show');

  let totalPayout = 0;
  for (const [betType, amount] of Object.entries(AVATAR.bets)){
    if (amount <= 0) continue;
    const payout = await settleBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId:AVATAR.table.id, roundId:AVATAR.currentRoundId, betType, amount, resultInfo:sim});
    totalPayout += payout;
    MY_BET_LOG.unshift({tableName:AVATAR.table.name, roundNo:AVATAR.roundNo, betType, amount, payout});
  }
  if (totalPayout > 0){ STATE.balance += totalPayout; toast(`+${fmtNum(totalPayout)} 획득!`); }
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
  refreshPointsQuiet();

  await writeRoundDoc(db, {tableId:AVATAR.table.id, tableType:'avatar', roundNo:AVATAR.roundNo, shoeNo:AVATAR.table.shoeNo||1, sim, startedAt:new Date(Date.now()-(AVATAR_BETTING_SECONDS+AVATAR_DEALING_SECONDS)*1000).toISOString()});
  AVATAR.history.push(sim.result);
  AVATAR.roundNo++;
  renderAvatarRoadmap();
  renderAvatarRecentResults();
  renderMyBetHistory();
}
async function refreshPointsQuiet(){
  const b = await getPlayerBalance(db, PLAYER.id);
  STATE.points = b.points;
  document.getElementById('hdrPoints').textContent = fmtNum(STATE.points);
}
function renderAvatarRoadmap(){
  const el = document.getElementById('bigRoadGrid'); if (!el) return;
  const cols = buildBigRoad(AVATAR.history.slice(-90));
  el.innerHTML = renderBigRoad(cols, 6);
  el.scrollLeft = el.scrollWidth;
}
function renderAvatarRecentResults(){
  const el = document.getElementById('recentResults'); if (!el) return;
  const recent = AVATAR.history.slice(-20);
  el.innerHTML = recent.map(r=>`<div class="rr ${r}">${r==='player'?'P':r==='banker'?'B':'T'}</div>`).join('') || `<span class="hint">기록 없음</span>`;
}
function mountAvatarChat(tableId){
  const log = document.getElementById('chatLog');
  if (AVATAR.chatUnsub) AVATAR.chatUnsub();
  // single equality filter only (no orderBy) - avoids needing a composite Firestore index; sort client-side.
  AVATAR.chatUnsub = db.collection('chatMessages').where('tableId','==',tableId).limit(200)
    .onSnapshot(snap=>{
      const msgs = snap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.dt)-new Date(b.dt)).slice(-30);
      log.innerHTML = msgs.map(m=>`<div class="msg"><b>${escapeHtml(m.nickname)}:</b> ${escapeHtml(m.text)}</div>`).join('') || `<span class="hint">채팅이 없습니다</span>`;
      log.scrollTop = log.scrollHeight;
    }, err=>{ log.innerHTML = `<span class="hint">채팅을 불러올 수 없습니다</span>`; });
}
async function sendAvatarChat(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !AVATAR.table) return;
  input.value = '';
  await db.collection('chatMessages').doc(uuidv4()).set({tableId:AVATAR.table.id, memberId:PLAYER.id, nickname:PLAYER.nickname, text, dt:new Date().toISOString()});
}

/* ============================================================
   SPEED MODE — several tables running simultaneously
   ============================================================ */
let SPEED = { tables:{}, tstate:{}, allBets:[], tick:null };

function renderChipTray(){
  document.getElementById('chipTray').innerHTML = `
    <div class="chip-tray" style="border:none;background:none;">
      ${CHIP_VALUES.map(v=>`<div class="chip c${v} ${v===STATE.selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})">${chipLabel(v)}</div>`).join('')}
    </div>`;
}
async function loadSpeedTables(){
  const grid = document.getElementById('speedGrid');
  grid.innerHTML = `<div class="table-loading" style="grid-column:1/-1;height:200px;"><div class="spin-lg"></div><div>테이블에 연결 중입니다...</div></div>`;
  const [tableSnap, roundsSnap, betSnap] = await Promise.all([
    db.collection('tables').where('type','==','speed').get(),
    db.collection('rounds').where('tableType','==','speed').get(),
    db.collection('memberLedger').where('category','==','bet').get(),
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  if (!tables.length){ grid.innerHTML = `<p class="hint">열려있는 스피드 테이블이 없습니다. 파트너 어드민에서 데모 데이터를 생성해주세요.</p>`; return; }
  const allRounds = roundsSnap.docs.map(d=>d.data());
  SPEED.allBets = betSnap.docs.map(d=>d.data());
  SPEED.tables = {}; SPEED.tstate = {};

  grid.innerHTML = tables.map(t=>speedTileHtml(t)).join('');
  tables.forEach(t=>{
    SPEED.tables[t.id] = t;
    const rounds = allRounds.filter(r=>r.tableId===t.id).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
    SPEED.tstate[t.id] = {
      phase:'betting', secondsLeft: SPEED_BETTING_SECONDS - (Object.keys(SPEED.tstate).length*3)%SPEED_BETTING_SECONDS,
      roundNo: (Math.max(0, ...rounds.map(r=>r.roundNo||0))||0)+1,
      bets:{player:0, banker:0, tie:0}, currentRoundId: uuidv4(),
      history: rounds.map(r=>r.result),
    };
    renderSpeedTileRoad(t.id);
    renderSpeedTileBets(t.id);
    renderSpeedTileStats(t.id);
  });
}
function speedTileHtml(t){
  return `
  <div class="speed-tile" id="tile-${t.id}">
    <div class="head"><span class="name">${escapeHtml(t.name)}</span><span class="shoe">SHOE #${t.shoeNo||1} · ${t.casino}</span></div>
    <div id="hotbadge-${t.id}"></div>
    <div class="speed-mini-stage" id="stage-${t.id}"><div class="phase-txt" id="phase-${t.id}">베팅하세요</div><div class="speed-timer" id="timer-${t.id}">15</div></div>
    <div class="speed-bets">
      <div class="bet-spot player" id="spot-${t.id}-player" onclick="placeSpeedBet('${t.id}','player')"><div class="label">P</div><div class="odds">1:1</div><div class="my-bet" id="mybet-${t.id}-player"></div></div>
      <div class="bet-spot tie" id="spot-${t.id}-tie" onclick="placeSpeedBet('${t.id}','tie')"><div class="label">T</div><div class="odds">8:1</div><div class="my-bet" id="mybet-${t.id}-tie"></div></div>
      <div class="bet-spot banker" id="spot-${t.id}-banker" onclick="placeSpeedBet('${t.id}','banker')"><div class="label">B</div><div class="odds">.95:1</div><div class="my-bet" id="mybet-${t.id}-banker"></div></div>
    </div>
    <div class="speed-mini-road" id="road-${t.id}"></div>
    <div class="speed-tile-stats" id="stats-${t.id}"></div>
  </div>`;
}
function renderSpeedTileRoad(tableId){
  const el = document.getElementById('road-'+tableId); if (!el) return;
  const cols = buildBigRoad(SPEED.tstate[tableId].history.slice(-40));
  el.innerHTML = renderBigRoad(cols, 4) || `<span class="hint" style="font-size:9px;">기록 없음</span>`;
}
function renderSpeedTileStats(tableId){
  const results = SPEED.tstate[tableId].history;
  const wins = tableWinCounts(results);
  const streak = trailingStreak(results);
  const volume = tableBetVolume(SPEED.allBets.filter(b=>b.relatedTableId===tableId));
  const statsEl = document.getElementById('stats-'+tableId);
  if (statsEl) statsEl.innerHTML = `<span>P <b>${wins.player}</b> · B <b>${wins.banker}</b> · T <b>${wins.tie}</b></span><span>오늘 <b>${fmtNum(volume.today)}</b></span>`;
  const badgeEl = document.getElementById('hotbadge-'+tableId);
  if (badgeEl) badgeEl.innerHTML = streak.len >= 3 ? `<div class="speed-hot-badge">🔥 ${streak.len}연속</div>` : '';
}
function renderSpeedTileBets(tableId){
  const s = SPEED.tstate[tableId];
  ['player','tie','banker'].forEach(k=>{
    const el = document.getElementById(`mybet-${tableId}-${k}`);
    if (el) el.textContent = s.bets[k] ? fmtNum(s.bets[k]) : '';
  });
}
function placeSpeedBet(tableId, type){
  const s = SPEED.tstate[tableId];
  if (!s || s.phase !== 'betting'){ toast('베팅 시간이 아닙니다', true); return; }
  let locked = 0; Object.values(SPEED.tstate).forEach(x=> locked += Object.values(x.bets).reduce((a,b)=>a+b,0));
  if (STATE.balance - locked < STATE.selectedChip){ toast('보유금이 부족합니다', true); return; }
  s.bets[type] += STATE.selectedChip;
  document.getElementById(`spot-${tableId}-${type}`).classList.add('selected');
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
function setSpeedTileTimer(tableId, v){ const el = document.getElementById('timer-'+tableId); if (el) el.textContent = v; }
function setSpeedTilePhaseText(tableId, txt){ const el = document.getElementById('phase-'+tableId); if (el) el.textContent = txt; }
function beginSpeedBetting(tableId){
  const s = SPEED.tstate[tableId];
  s.phase = 'betting'; s.secondsLeft = SPEED_BETTING_SECONDS; s.bets = {player:0, banker:0, tie:0}; s.currentRoundId = uuidv4();
  ['player','tie','banker'].forEach(k=> document.getElementById(`spot-${tableId}-${k}`)?.classList.remove('selected','locked'));
  renderSpeedTileBets(tableId);
  setSpeedTilePhaseText(tableId, '베팅하세요');
  const stage = document.getElementById('stage-'+tableId);
  const scoreTxt = stage?.querySelector('.score-txt'); if (scoreTxt) scoreTxt.remove();
}
async function beginSpeedDealing(tableId){
  const s = SPEED.tstate[tableId];
  s.phase = 'dealing'; s.secondsLeft = SPEED_DEALING_SECONDS;
  ['player','tie','banker'].forEach(k=> document.getElementById(`spot-${tableId}-${k}`)?.classList.add('locked'));
  setSpeedTilePhaseText(tableId, '카드 배분중...');
  for (const [betType, amount] of Object.entries(s.bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:s.currentRoundId, betType, amount, staff:'system'});
  }
  const totalBet = Object.values(s.bets).reduce((a,b)=>a+b,0);
  if (totalBet > 0){ STATE.balance -= totalBet; }
  s._sim = simulateRound();
}
async function beginSpeedResult(tableId){
  const s = SPEED.tstate[tableId];
  s.phase = 'result'; s.secondsLeft = SPEED_RESULT_SECONDS;
  const sim = s._sim;
  const t = SPEED.tables[tableId];
  setSpeedTilePhaseText(tableId, sim.result==='player' ? 'PLAYER WIN' : sim.result==='banker' ? 'BANKER WIN' : 'TIE');
  const stage = document.getElementById('stage-'+tableId);
  if (stage && !stage.querySelector('.score-txt')){
    stage.insertAdjacentHTML('beforeend', `<div class="score-txt">P${sim.player.score} : B${sim.banker.score}</div>`);
  }

  let totalPayout = 0;
  for (const [betType, amount] of Object.entries(s.bets)){
    if (amount <= 0) continue;
    const payout = await settleBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:s.currentRoundId, betType, amount, resultInfo:sim});
    totalPayout += payout;
    MY_BET_LOG.unshift({tableName:t.name, roundNo:s.roundNo, betType, amount, payout});
    SPEED.allBets.push({relatedTableId:tableId, amount:-amount, category:'bet', createdAt:new Date().toISOString()});
  }
  if (MY_BET_LOG.length) renderMyBetHistory();
  if (totalPayout > 0){ STATE.balance += totalPayout; toast(`[${t.name}] +${fmtNum(totalPayout)} 획득!`); }
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);

  await writeRoundDoc(db, {tableId, tableType:'speed', roundNo:s.roundNo, shoeNo:t.shoeNo||1, sim, startedAt:new Date(Date.now()-(SPEED_BETTING_SECONDS+SPEED_DEALING_SECONDS)*1000).toISOString()});
  s.history.push(sim.result);
  s.roundNo++;
  renderSpeedTileRoad(tableId);
  renderSpeedTileStats(tableId);
}
