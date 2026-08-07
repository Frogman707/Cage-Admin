/* ============================================================
   Speed site — CAGE ADMIN 5.0
   Multi-table speed baccarat: several tables run simultaneously
   on one screen, each with a fast round cadence. Shares the auth
   + ledger + round-persistence engine with /avatar.
   ============================================================ */

let db = null;
const TABLE_TYPE = 'speed';
const BETTING_SECONDS = 15, DEALING_SECONDS = 3, RESULT_SECONDS = 3;

let selectedChip = CHIP_VALUES[0];
let TABLES = {}; // tableId -> table meta
let TSTATE = {}; // tableId -> round state
let GLOBAL_TICK = null;
let ALL_BETS = []; // memberLedger bet rows across all speed tables, refreshed on load
const BET_LABEL = {player:'플레이어', banker:'뱅커', tie:'타이'};
let MY_BET_LOG = []; // {tableName, roundNo, betType, amount, payout} newest first

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
  if (GLOBAL_TICK) clearInterval(GLOBAL_TICK);
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
  renderChipTray();
  await loadTables();
  renderMyBetHistory();
  GLOBAL_TICK = setInterval(tickAll, 1000);
}
async function refreshBalance(){
  const b = await getPlayerBalance(db, PLAYER.id);
  window.PLAYER_BALANCE = b.balance; window.PLAYER_POINTS = b.points;
  document.getElementById('hdrBalance').textContent = fmtNum(b.balance);
  document.getElementById('hdrPoints').textContent = fmtNum(b.points);
}
function projectBalance(){
  let locked = 0;
  Object.values(TSTATE).forEach(s=> locked += Object.values(s.bets).reduce((a,b)=>a+b,0));
  document.getElementById('hdrBalance').textContent = fmtNum(window.PLAYER_BALANCE - locked);
}

function chipLabel(v){ if (v>=1000000) return (v/1000000)+'M'; if (v>=10000) return (v/10000)+'만'; return (v/1000)+'천'; }
function renderChipTray(){
  document.getElementById('chipTray').innerHTML = `
    <div class="chip-tray" style="border:none;background:none;">
      ${CHIP_VALUES.map(v=>`<div class="chip c${v} ${v===selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})">${chipLabel(v)}</div>`).join('')}
    </div>`;
}
function selectChip(v){ selectedChip = v; document.querySelectorAll('#chipTray .chip').forEach(c=>c.classList.toggle('selected', Number(c.dataset.chip)===v)); }

/* ---------------- load speed tables & init per-table state ---------------- */
async function loadTables(){
  const grid = document.getElementById('speedGrid');
  grid.innerHTML = `<div class="table-loading" style="grid-column:1/-1;height:200px;"><div class="spin-lg"></div><div>테이블에 연결 중입니다...</div></div>`;
  const [tableSnap, roundsSnap, betSnap] = await Promise.all([
    db.collection('tables').where('type','==',TABLE_TYPE).get(),
    db.collection('rounds').where('tableType','==',TABLE_TYPE).get(),
    db.collection('memberLedger').where('category','==','bet').get(), // single equality filter only - no composite index needed
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  if (!tables.length){ grid.innerHTML = `<p class="hint">열려있는 스피드 테이블이 없습니다. 파트너 어드민에서 데모 데이터를 생성해주세요.</p>`; return; }
  const allRounds = roundsSnap.docs.map(d=>d.data());
  ALL_BETS = betSnap.docs.map(d=>d.data());

  grid.innerHTML = tables.map(t=>speedTileHtml(t)).join('');
  tables.forEach(t=>{
    TABLES[t.id] = t;
    const rounds = allRounds.filter(r=>r.tableId===t.id).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
    TSTATE[t.id] = {
      phase:'betting', secondsLeft: BETTING_SECONDS - (Object.keys(TSTATE).length*3)%BETTING_SECONDS, // stagger start so tiles don't all flip at once
      roundNo: (Math.max(0, ...rounds.map(r=>r.roundNo||0))||0)+1,
      bets:{player:0, banker:0, tie:0}, currentRoundId: uuidv4(),
      history: rounds.map(r=>r.result),
    };
    renderTileMiniRoad(t.id);
    renderTileBets(t.id);
    renderTileStats(t.id);
  });
}
function speedTileHtml(t){
  return `
  <div class="speed-tile" id="tile-${t.id}" style="position:relative;">
    <div class="head"><span class="name">${escapeHtml(t.name)}</span><span class="shoe">SHOE #${t.shoeNo||1} · ${t.casino}</span></div>
    <div id="hotbadge-${t.id}"></div>
    <div class="speed-mini-stage" id="stage-${t.id}"><div class="phase-txt" id="phase-${t.id}">베팅하세요</div><div class="speed-timer" id="timer-${t.id}">15</div></div>
    <div class="speed-bets">
      <div class="bet-spot player" id="spot-${t.id}-player" onclick="placeBetSpot('${t.id}','player')"><div class="label">P</div><div class="odds">1:1</div><div class="my-bet" id="mybet-${t.id}-player"></div></div>
      <div class="bet-spot tie" id="spot-${t.id}-tie" onclick="placeBetSpot('${t.id}','tie')"><div class="label">T</div><div class="odds">8:1</div><div class="my-bet" id="mybet-${t.id}-tie"></div></div>
      <div class="bet-spot banker" id="spot-${t.id}-banker" onclick="placeBetSpot('${t.id}','banker')"><div class="label">B</div><div class="odds">.95:1</div><div class="my-bet" id="mybet-${t.id}-banker"></div></div>
    </div>
    <div class="speed-mini-road" id="road-${t.id}"></div>
    <div class="speed-tile-stats" id="stats-${t.id}"></div>
  </div>`;
}
function renderTileMiniRoad(tableId){
  const el = document.getElementById('road-'+tableId); if (!el) return;
  const results = TSTATE[tableId].history;
  const cols = buildBigRoad(results.slice(-40));
  el.innerHTML = renderBigRoad(cols, 4) || `<span class="hint" style="font-size:9px;">기록 없음</span>`;
}
function renderTileStats(tableId){
  const results = TSTATE[tableId].history;
  const wins = tableWinCounts(results);
  const streak = trailingStreak(results);
  const volume = tableBetVolume(ALL_BETS.filter(b=>b.relatedTableId===tableId));
  const statsEl = document.getElementById('stats-'+tableId);
  if (statsEl) statsEl.innerHTML = `<span>P <b>${wins.player}</b> · B <b>${wins.banker}</b> · T <b>${wins.tie}</b></span><span>오늘 <b>${fmtNum(volume.today)}</b></span>`;
  const badgeEl = document.getElementById('hotbadge-'+tableId);
  if (badgeEl) badgeEl.innerHTML = streak.len >= 3 ? `<div class="speed-hot-badge">🔥 ${streak.len}연속</div>` : '';
}
function renderTileBets(tableId){
  const s = TSTATE[tableId];
  ['player','tie','banker'].forEach(k=>{
    const el = document.getElementById(`mybet-${tableId}-${k}`);
    if (el) el.textContent = s.bets[k] ? fmtNum(s.bets[k]) : '';
  });
}
function placeBetSpot(tableId, type){
  const s = TSTATE[tableId];
  if (!s || s.phase !== 'betting'){ toast('베팅 시간이 아닙니다', true); return; }
  let locked = 0; Object.values(TSTATE).forEach(x=> locked += Object.values(x.bets).reduce((a,b)=>a+b,0));
  if (window.PLAYER_BALANCE - locked < selectedChip){ toast('보유금이 부족합니다', true); return; }
  s.bets[type] += selectedChip;
  document.getElementById(`spot-${tableId}-${type}`).classList.add('selected');
  renderTileBets(tableId);
  projectBalance();
}

/* ---------------- global 1s ticker driving every table independently ---------------- */
async function tickAll(){
  for (const tableId of Object.keys(TSTATE)){
    const s = TSTATE[tableId];
    s.secondsLeft--;
    if (s.phase==='betting'){
      setTileTimer(tableId, Math.max(0,s.secondsLeft));
      if (s.secondsLeft <= 0) await beginDealing(tableId);
    } else if (s.phase==='dealing'){
      if (s.secondsLeft <= 0) await beginResult(tableId);
    } else if (s.phase==='result'){
      setTileTimer(tableId, Math.max(0,s.secondsLeft));
      if (s.secondsLeft <= 0) beginBetting(tableId);
    }
  }
}
function setTileTimer(tableId, v){ const el = document.getElementById('timer-'+tableId); if (el) el.textContent = v; }
function setTilePhaseText(tableId, txt){ const el = document.getElementById('phase-'+tableId); if (el) el.textContent = txt; }
function beginBetting(tableId){
  const s = TSTATE[tableId];
  s.phase = 'betting'; s.secondsLeft = BETTING_SECONDS; s.bets = {player:0, banker:0, tie:0}; s.currentRoundId = uuidv4();
  ['player','tie','banker'].forEach(k=> document.getElementById(`spot-${tableId}-${k}`)?.classList.remove('selected','locked'));
  renderTileBets(tableId);
  setTilePhaseText(tableId, '베팅하세요');
  const stage = document.getElementById('stage-'+tableId);
  const scoreTxt = stage?.querySelector('.score-txt'); if (scoreTxt) scoreTxt.remove();
}
async function beginDealing(tableId){
  const s = TSTATE[tableId];
  s.phase = 'dealing'; s.secondsLeft = DEALING_SECONDS;
  ['player','tie','banker'].forEach(k=> document.getElementById(`spot-${tableId}-${k}`)?.classList.add('locked'));
  setTilePhaseText(tableId, '카드 배분중...');
  const t = TABLES[tableId];
  for (const [betType, amount] of Object.entries(s.bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:s.currentRoundId, betType, amount, staff:'system'});
  }
  const totalBet = Object.values(s.bets).reduce((a,b)=>a+b,0);
  if (totalBet > 0){ window.PLAYER_BALANCE -= totalBet; }
  s._sim = simulateRound();
}
async function beginResult(tableId){
  const s = TSTATE[tableId];
  s.phase = 'result'; s.secondsLeft = RESULT_SECONDS;
  const sim = s._sim;
  const t = TABLES[tableId];
  setTilePhaseText(tableId, sim.result==='player' ? 'PLAYER WIN' : sim.result==='banker' ? 'BANKER WIN' : 'TIE');
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
    ALL_BETS.push({relatedTableId:tableId, amount:-amount, category:'bet', createdAt:new Date().toISOString()});
  }
  if (MY_BET_LOG.length){ MY_BET_LOG = MY_BET_LOG.slice(0, 20); renderMyBetHistory(); }
  if (totalPayout > 0){ window.PLAYER_BALANCE += totalPayout; toast(`[${t.name}] +${fmtNum(totalPayout)} 획득!`); }
  document.getElementById('hdrBalance').textContent = fmtNum(window.PLAYER_BALANCE);

  await writeRoundDoc(db, {tableId, tableType:TABLE_TYPE, roundNo:s.roundNo, shoeNo:t.shoeNo||1, sim, startedAt:new Date(Date.now()-(BETTING_SECONDS+DEALING_SECONDS)*1000).toISOString()});
  s.history.push(sim.result);
  s.roundNo++;
  renderTileMiniRoad(tableId);
  renderTileStats(tableId);
}
function renderMyBetHistory(){
  const el = document.getElementById('myBetHistory'); if (!el) return;
  if (!MY_BET_LOG.length){ el.innerHTML = `<span class="hint">아직 베팅 내역이 없습니다</span>`; return; }
  el.innerHTML = MY_BET_LOG.map(b=>{
    const net = b.payout - b.amount;
    const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    return `<div class="row"><span>[${escapeHtml(b.tableName)}] #${b.roundNo} ${BET_LABEL[b.betType]} ${fmtNum(b.amount)}</span><span class="${cls}">${net===0 ? '푸시' : fmtSigned(net)}</span></div>`;
  }).join('');
}
