/* ============================================================
   Avatar site — CAGE ADMIN 5.0
   Immersive single-table baccarat client. Login/signup against
   `members`, real balance via memberLedger, client-driven round
   loop that persists every round + bet + payout to Firestore.
   ============================================================ */

let db = null;
const TABLE_TYPE = 'avatar';
const BETTING_SECONDS = 30, DEALING_SECONDS = 4, RESULT_SECONDS = 5;

let STATE = {
  balance: 0, points: 0,
  table: null, phase: 'idle', secondsLeft: 0, roundNo: 1,
  bets: {player:0, banker:0, tie:0, playerPair:0, bankerPair:0},
  selectedChip: CHIP_VALUES[0],
  history: [], // 'player'|'banker'|'tie' oldest..newest
  currentRoundId: null, timerHandle: null, chatUnsub: null,
  myBetLog: [], // {roundNo, bets:{type:amt}, result, payout} newest first
};
const BET_LABEL = {player:'플레이어', banker:'뱅커', tie:'타이', playerPair:'플레이어 페어', bankerPair:'뱅커 페어'};
let LOBBY_DATA = null;

window.addEventListener('DOMContentLoaded', ()=>{
  db = cageInitFirebase();
  document.getElementById('liPw').addEventListener('keydown', e=>{ if (e.key==='Enter') onLogin(); });
});

function showPane(name){
  document.getElementById('pane-login').style.display = name==='login' ? 'block' : 'none';
  document.getElementById('pane-signup').style.display = name==='signup' ? 'block' : 'none';
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
  stopRoundLoop();
  if (STATE.chatUnsub) STATE.chatUnsub();
  PLAYER = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-gate').style.display = 'flex';
  showPane('login');
}
async function enterApp(){
  document.getElementById('login-gate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('hdrNick').textContent = `${PLAYER.nickname} (${PLAYER.id})`;
  await refreshBalance();
  goLobby();
}
async function refreshBalance(){
  const b = await getPlayerBalance(db, PLAYER.id);
  STATE.balance = b.balance; STATE.points = b.points;
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
  document.getElementById('hdrPoints').textContent = fmtNum(STATE.points);
}

/* ---------------- lobby ---------------- */
async function goLobby(){
  stopRoundLoop();
  if (STATE.chatUnsub){ STATE.chatUnsub(); STATE.chatUnsub = null; }
  document.getElementById('lobbyBtn').style.display = 'none';
  document.getElementById('viewTable').style.display = 'none';
  const lobby = document.getElementById('viewLobby');
  lobby.style.display = 'block';
  lobby.innerHTML = `
    <div class="lobby-wrap">
      <div class="lobby-title">아바타 테이블</div>
      <div class="lobby-toolbar">
        <label class="hint" style="margin:0;">정렬</label>
        <select id="lobbySort" onchange="renderLobbyGrid(this.value)">
          <option value="popular">인기순 (베팅총액)</option>
          <option value="today">오늘 베팅액순</option>
          <option value="hot">좋은 흐름순</option>
          <option value="name">테이블명순</option>
        </select>
      </div>
      <div class="lobby-grid" id="lobbyGrid"><div class="spin"></div></div>
    </div>`;
  const [tableSnap, roundsSnap, betSnap] = await Promise.all([
    db.collection('tables').where('type','==',TABLE_TYPE).get(),
    db.collection('rounds').where('tableType','==',TABLE_TYPE).get(),
    db.collection('memberLedger').where('category','==','bet').get(), // single equality filter only - no composite index needed
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  LOBBY_DATA = {
    tables,
    rounds: roundsSnap.docs.map(d=>d.data()),
    bets: betSnap.docs.map(d=>d.data()),
  };
  if (!tables.length){ document.getElementById('lobbyGrid').innerHTML = `<p class="hint">열려있는 아바타 테이블이 없습니다. 파트너 어드민에서 데모 데이터를 생성해주세요.</p>`; return; }
  renderLobbyGrid('popular');
}
function renderLobbyGrid(sortMode){
  if (!LOBBY_DATA) return;
  const grid = document.getElementById('lobbyGrid');
  const rows = LOBBY_DATA.tables.map(t=>{
    const tableRounds = LOBBY_DATA.rounds.filter(r=>r.tableId===t.id).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
    const results = tableRounds.map(r=>r.result);
    const tableBets = LOBBY_DATA.bets.filter(b=>b.relatedTableId===t.id);
    const wins = tableWinCounts(results);
    const streak = trailingStreak(results);
    const volume = tableBetVolume(tableBets);
    return {t, results, wins, streak, volume};
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
    <div class="lobby-card" onclick="enterTable('${t.id}')">
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

/* ---------------- table ---------------- */
async function enterTable(tableId){
  document.getElementById('viewLobby').style.display = 'none';
  document.getElementById('lobbyBtn').style.display = 'inline-block';
  const view = document.getElementById('viewTable');
  view.style.display = 'block';
  // unified loading transition regardless of casino/table, per vendor feedback that
  // loading screens previously looked different across HANN/NUSTAR tables.
  view.innerHTML = `<div class="table-loading"><div class="spin-lg"></div><div>테이블에 연결 중입니다...</div></div>`;

  const doc = await db.collection('tables').doc(tableId).get();
  STATE.table = {id:tableId, ...doc.data()};
  const roundsSnap = await db.collection('rounds').where('tableId','==',tableId).get();
  const rounds = roundsSnap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  STATE.history = rounds.map(r=>r.result);
  STATE.roundNo = (Math.max(0, ...rounds.map(r=>r.roundNo||0)) || 0) + 1;
  STATE.myBetLog = [];

  view.innerHTML = tableShellHtml();
  renderRoadmap();
  renderRecentResults();
  renderMyBetHistory();
  mountChat(tableId);
  startRoundLoop();
}
function tableShellHtml(){
  const t = STATE.table;
  return `
  <div class="table-shell">
    <div class="table-main">
      <div class="table-stage">
        <div class="table-id-badge">${t.name}</div>
        <div class="table-shoe-badge">SHOE #${t.shoeNo||1} · ROUND ${STATE.roundNo}</div>
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
        <div class="bet-spot player" id="spot-player" onclick="placeBetSpot('player')"><div class="label">PLAYER</div><div class="odds">1 : 1</div><div class="my-bet" id="mybet-player"></div></div>
        <div>
          <div class="bet-spot tie" id="spot-tie" onclick="placeBetSpot('tie')"><div class="label">TIE</div><div class="odds">8 : 1</div><div class="my-bet" id="mybet-tie"></div></div>
          <div class="pair-row">
            <div class="bet-spot pair" id="spot-playerPair" onclick="placeBetSpot('playerPair')"><div class="label">P PAIR</div><div class="odds">11:1</div><div class="my-bet" id="mybet-playerPair"></div></div>
            <div class="bet-spot pair" id="spot-bankerPair" onclick="placeBetSpot('bankerPair')"><div class="label">B PAIR</div><div class="odds">11:1</div><div class="my-bet" id="mybet-bankerPair"></div></div>
          </div>
        </div>
        <div class="bet-spot banker" id="spot-banker" onclick="placeBetSpot('banker')"><div class="label">BANKER</div><div class="odds">0.95 : 1</div><div class="my-bet" id="mybet-banker"></div></div>
      </div>
      <div class="chip-tray">
        ${CHIP_VALUES.map(v=>`<div class="chip c${v} ${v===STATE.selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})">${chipLabel(v)}</div>`).join('')}
        <div class="bet-controls">
          <span class="current-bet-total" id="betTotalTxt">총 0</span>
          <button class="btn btn-sm" onclick="clearBets()">취소</button>
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
        <div class="chat-input-row"><input id="chatInput" placeholder="메시지 입력..." onkeydown="if(event.key==='Enter')sendChat()"><button class="btn btn-sm btn-gold" onclick="sendChat()">전송</button></div>
      </div>
    </div>
  </div>`;
}
function chipLabel(v){ if (v>=1000000) return (v/1000000)+'M'; if (v>=10000) return (v/10000)+'만'; return (v/1000)+'천'; }
function selectChip(v){ STATE.selectedChip = v; document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('selected', Number(c.dataset.chip)===v)); }
function placeBetSpot(type){
  if (STATE.phase !== 'betting'){ toast('베팅 시간이 아닙니다', true); return; }
  if (STATE.balance < STATE.selectedChip + totalBetAmount()){ toast('보유금이 부족합니다', true); return; }
  STATE.bets[type] += STATE.selectedChip;
  document.getElementById('spot-'+type).classList.add('selected');
  updateBetUi();
}
function totalBetAmount(){ return Object.values(STATE.bets).reduce((a,b)=>a+b,0); }
function updateBetUi(){
  Object.keys(STATE.bets).forEach(k=>{
    const el = document.getElementById('mybet-'+k);
    if (el) el.textContent = STATE.bets[k] ? fmtNum(STATE.bets[k]) : '';
  });
  const totalEl = document.getElementById('betTotalTxt');
  if (totalEl) totalEl.textContent = '총 ' + fmtNum(totalBetAmount());
  const projected = STATE.balance - totalBetAmount();
  document.getElementById('hdrBalance').textContent = fmtNum(projected);
}
function clearBets(){
  STATE.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  document.querySelectorAll('.bet-spot').forEach(s=>s.classList.remove('selected'));
  updateBetUi();
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
}

/* ---------------- round loop ---------------- */
function stopRoundLoop(){ if (STATE.timerHandle){ clearInterval(STATE.timerHandle); STATE.timerHandle = null; } }
function startRoundLoop(){
  stopRoundLoop();
  beginBettingPhase();
  STATE.timerHandle = setInterval(tick, 1000);
}
function beginBettingPhase(){
  STATE.phase = 'betting';
  STATE.secondsLeft = BETTING_SECONDS;
  STATE.currentRoundId = uuidv4();
  clearBets();
  setPhaseBanner('베팅하세요', BETTING_SECONDS);
  document.querySelectorAll('.bet-spot').forEach(s=>s.classList.remove('locked'));
  const flash = document.getElementById('resultFlash'); if (flash) flash.classList.remove('show');
  document.getElementById('playerCards').innerHTML = ''; document.getElementById('bankerCards').innerHTML = '';
  document.getElementById('playerScore').textContent = ' '; document.getElementById('bankerScore').textContent = ' ';
}
function setPhaseBanner(text, secs){
  const el = document.getElementById('phaseBanner'); if (el) el.textContent = text;
  updateTimerRing(secs, secs);
}
function updateTimerRing(secLeft, secTotal){
  const txt = document.getElementById('timerTxt'); if (txt) txt.textContent = secLeft;
  const arc = document.getElementById('timerArc');
  if (arc){ const c = 150.8; arc.style.strokeDashoffset = c * (1 - secLeft/secTotal); }
}
async function tick(){
  STATE.secondsLeft--;
  if (STATE.phase==='betting'){
    updateTimerRing(Math.max(0,STATE.secondsLeft), BETTING_SECONDS);
    if (STATE.secondsLeft <= 0) await beginDealingPhase();
  } else if (STATE.phase==='dealing'){
    if (STATE.secondsLeft <= 0) await beginResultPhase();
  } else if (STATE.phase==='result'){
    updateTimerRing(Math.max(0,STATE.secondsLeft), RESULT_SECONDS);
    if (STATE.secondsLeft <= 0) beginBettingPhase();
  }
}
async function beginDealingPhase(){
  STATE.phase = 'dealing';
  STATE.secondsLeft = DEALING_SECONDS;
  document.querySelectorAll('.bet-spot').forEach(s=>s.classList.add('locked'));
  setPhaseBanner('카드를 배분합니다', DEALING_SECONDS);

  // persist bets placed this round
  for (const [betType, amount] of Object.entries(STATE.bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId:STATE.table.id, roundId:STATE.currentRoundId, betType, amount, staff:'system'});
  }
  if (totalBetAmount() > 0){ STATE.balance -= totalBetAmount(); }

  const sim = simulateRound();
  STATE._sim = sim;
  await revealCards(sim);
}
function cardHtml(card){
  const red = card.suit==='♥' || card.suit==='♦';
  return `<div class="playing-card ${red?'red':'black'}">${card.rank}${card.suit}</div>`;
}
async function revealCards(sim){
  const pEl = document.getElementById('playerCards'), bEl = document.getElementById('bankerCards');
  const seq = [[pEl,sim.player.cards[0]],[bEl,sim.banker.cards[0]],[pEl,sim.player.cards[1]],[bEl,sim.banker.cards[1]]];
  for (const [el,card] of seq){
    el.insertAdjacentHTML('beforeend', cardHtml(card));
    await new Promise(r=>setTimeout(r, 260));
  }
  document.getElementById('playerScore').textContent = sim.player.score;
  document.getElementById('bankerScore').textContent = sim.banker.score;
}
async function beginResultPhase(){
  STATE.phase = 'result';
  STATE.secondsLeft = RESULT_SECONDS;
  const sim = STATE._sim;
  setPhaseBanner(sim.result==='player' ? '플레이어 승리' : sim.result==='banker' ? '뱅커 승리' : '타이', RESULT_SECONDS);

  const flash = document.getElementById('resultFlash');
  const flashTxt = document.getElementById('resultFlashTxt');
  flashTxt.className = 'txt ' + sim.result;
  flashTxt.textContent = sim.result==='player' ? 'PLAYER WIN' : sim.result==='banker' ? 'BANKER WIN' : 'TIE';
  flash.classList.add('show');

  // settle
  let totalPayout = 0;
  const myBetsThisRound = {};
  for (const [betType, amount] of Object.entries(STATE.bets)){
    if (amount <= 0) continue;
    const payout = await settleBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId:STATE.table.id, roundId:STATE.currentRoundId, betType, amount, resultInfo:sim});
    totalPayout += payout;
    myBetsThisRound[betType] = {amount, payout};
  }
  if (totalPayout > 0){ STATE.balance += totalPayout; toast(`+${fmtNum(totalPayout)} 획득!`); }
  document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance);
  refreshPointsQuiet();

  await writeRoundDoc(db, {tableId:STATE.table.id, tableType:TABLE_TYPE, roundNo:STATE.roundNo, shoeNo:STATE.table.shoeNo||1, sim, startedAt:new Date(Date.now()-(BETTING_SECONDS+DEALING_SECONDS)*1000).toISOString()});
  STATE.history.push(sim.result);
  if (Object.keys(myBetsThisRound).length){
    STATE.myBetLog.unshift({roundNo:STATE.roundNo, bets:myBetsThisRound, result:sim.result});
    STATE.myBetLog = STATE.myBetLog.slice(0, 15);
    renderMyBetHistory();
  }
  STATE.roundNo++;
  renderRoadmap();
  renderRecentResults();
}
function renderMyBetHistory(){
  const el = document.getElementById('myBetHistory'); if (!el) return;
  if (!STATE.myBetLog.length){ el.innerHTML = `<span class="hint">아직 베팅 내역이 없습니다</span>`; return; }
  el.innerHTML = STATE.myBetLog.map(entry=>{
    const lines = Object.entries(entry.bets).map(([type,info])=>{
      const net = info.payout - info.amount;
      const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
      return `<div class="row"><span>#${entry.roundNo} ${BET_LABEL[type]} ${fmtNum(info.amount)}</span><span class="${cls}">${net===0 ? '푸시' : fmtSigned(net)}</span></div>`;
    }).join('');
    return lines;
  }).join('');
}
async function refreshPointsQuiet(){
  const b = await getPlayerBalance(db, PLAYER.id);
  STATE.points = b.points;
  document.getElementById('hdrPoints').textContent = fmtNum(STATE.points);
}

/* ---------------- roadmap / chat ---------------- */
function renderRoadmap(){
  const el = document.getElementById('bigRoadGrid'); if (!el) return;
  const cols = buildBigRoad(STATE.history.slice(-90));
  el.innerHTML = renderBigRoad(cols, 6);
  el.scrollLeft = el.scrollWidth;
}
function renderRecentResults(){
  const el = document.getElementById('recentResults'); if (!el) return;
  const recent = STATE.history.slice(-20);
  el.innerHTML = recent.map(r=>`<div class="rr ${r}">${r==='player'?'P':r==='banker'?'B':'T'}</div>`).join('') || `<span class="hint">기록 없음</span>`;
}
function mountChat(tableId){
  const log = document.getElementById('chatLog');
  if (STATE.chatUnsub) STATE.chatUnsub();
  // single equality filter only (no orderBy) - avoids needing a composite Firestore index;
  // sort client-side instead.
  STATE.chatUnsub = db.collection('chatMessages').where('tableId','==',tableId).limit(200)
    .onSnapshot(snap=>{
      const msgs = snap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.dt)-new Date(b.dt)).slice(-30);
      log.innerHTML = msgs.map(m=>`<div class="msg"><b>${escapeHtml(m.nickname)}:</b> ${escapeHtml(m.text)}</div>`).join('') || `<span class="hint">채팅이 없습니다</span>`;
      log.scrollTop = log.scrollHeight;
    }, err=>{ log.innerHTML = `<span class="hint">채팅을 불러올 수 없습니다</span>`; });
}
async function sendChat(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !STATE.table) return;
  input.value = '';
  await db.collection('chatMessages').doc(uuidv4()).set({tableId:STATE.table.id, memberId:PLAYER.id, nickname:PLAYER.nickname, text, dt:new Date().toISOString()});
}
