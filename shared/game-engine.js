/* ============================================================
   CAGE ADMIN 5.0 — shared player-side game engine
   Used by /avatar and /speed. Handles member auth (lite),
   balance/point aggregation, bet placement + settlement, round
   history writes, and the Big Road roadmap builder. No real
   video feed / RNG-audited dealer — client-driven demo round
   loop that still persists every bet & result as real Firestore
   documents (see docs/FIRESTORE_DATA_MODEL.md).
   ============================================================ */

const CHIP_VALUES = [5000, 10000, 50000, 100000, 500000, 1000000];
const CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const CARD_SUITS = ['♠','♥','♦','♣'];
const PAYOUT = { player: 2.0, banker: 1.95, tie: 9.0, playerPair: 12.0, bankerPair: 12.0 };

function cardValue(rank){
  if (rank==='A') return 1;
  if (['10','J','Q','K'].includes(rank)) return 0;
  return Number(rank);
}
function dealHand(){
  const c1 = randCard(), c2 = randCard();
  return {cards:[c1,c2], score:(cardValue(c1.rank)+cardValue(c2.rank))%10};
}
function randCard(){
  const rank = CARD_RANKS[Math.floor(Math.random()*CARD_RANKS.length)];
  const suit = CARD_SUITS[Math.floor(Math.random()*CARD_SUITS.length)];
  return {rank, suit};
}
function simulateRound(){
  const player = dealHand();
  const banker = dealHand();
  let result = 'tie';
  if (player.score > banker.score) result = 'player';
  else if (banker.score > player.score) result = 'banker';
  const playerPair = player.cards[0].rank === player.cards[1].rank;
  const bankerPair = banker.cards[0].rank === banker.cards[1].rank;
  return {player, banker, result, playerPair, bankerPair};
}

/* ---------------- member session (lite auth against `members`) ---------------- */
let PLAYER = null;
async function playerLogin(db, id, pw){
  const doc = await db.collection('members').doc(id.toUpperCase()).get();
  if (!doc.exists) return {ok:false, reason:'notfound'};
  const m = doc.data();
  if (String(m.pw ?? '0000') !== pw) return {ok:false, reason:'badpw'};
  if (m.status !== '정상') return {ok:false, reason:'blocked'};
  await db.collection('members').doc(id.toUpperCase()).set({lastLoginAt:new Date().toISOString()}, {merge:true});
  PLAYER = m;
  return {ok:true, member:m};
}
async function playerSignup(db, data){
  const id = data.id.toUpperCase();
  const existing = await db.collection('members').doc(id).get();
  if (existing.exists) return {ok:false, reason:'dup'};
  const member = {
    id, loginId:id, pw:data.pw, nickname:data.nickname, phone:data.phone, telegram:data.telegram||null,
    casino:data.casino, agentCode:data.agentCode||'DIRECT', parentAgent:data.agentCode||'DIRECT',
    memberType:'준회원', status:'정상', vip:false, betMax:1000000, betMin:5000,
    withdrawPw:data.pw, smsVerified:!!data.smsVerified, source:'online',
    createdAt:new Date().toISOString(), lastLoginAt:new Date().toISOString(),
  };
  await db.collection('members').doc(id).set(member);
  await db.collection('memberLedger').doc(uuidv4()).set({memberId:id, casino:data.casino, amount:100000, category:'deposit', memo:'가입 축하 포인트', staff:'system', createdAt:new Date().toISOString()});
  PLAYER = member;
  return {ok:true, member};
}
async function getPlayerBalance(db, memberId){
  const snap = await db.collection('memberLedger').where('memberId','==',memberId).get();
  let balance = 0, points = 0;
  snap.forEach(d=>{
    const r = d.data();
    if (r.category==='point_earn' || r.category==='point_convert') points += Number(r.amount)||0;
    else balance += Number(r.amount)||0;
  });
  return {balance, points};
}

/* ---------------- betting ---------------- */
async function placeBet(db, {memberId, casino, tableId, roundId, betType, amount, staff}){
  await db.collection('memberLedger').doc(uuidv4()).set({
    memberId, casino, amount: -Math.abs(amount), category:'bet', betType,
    relatedTableId: tableId, relatedRoundId: roundId, staff: staff||'system',
    createdAt: new Date().toISOString(),
  });
}
async function settleBet(db, {memberId, casino, tableId, roundId, betType, amount, resultInfo}){
  let mult = 0;
  if (betType==='player') mult = resultInfo.result==='player' ? PAYOUT.player : (resultInfo.result==='tie' ? 1 : 0);
  else if (betType==='banker') mult = resultInfo.result==='banker' ? PAYOUT.banker : (resultInfo.result==='tie' ? 1 : 0);
  else if (betType==='tie') mult = resultInfo.result==='tie' ? PAYOUT.tie : 0;
  else if (betType==='playerPair') mult = resultInfo.playerPair ? PAYOUT.playerPair : 0;
  else if (betType==='bankerPair') mult = resultInfo.bankerPair ? PAYOUT.bankerPair : 0;
  const payout = Math.round(amount * mult);
  if (payout > 0){
    await db.collection('memberLedger').doc(uuidv4()).set({
      memberId, casino, amount: payout, category:'payout',
      relatedTableId: tableId, relatedRoundId: roundId, staff:'system',
      createdAt: new Date().toISOString(),
    });
  }
  return payout;
}
async function writeRoundDoc(db, {tableId, tableType, roundNo, shoeNo, sim, startedAt}){
  const id = uuidv4();
  await db.collection('rounds').doc(id).set({
    tableId, tableType, roundNo, shoeNo, phase:'result',
    playerCards: sim.player.cards.map(c=>c.rank+c.suit), bankerCards: sim.banker.cards.map(c=>c.rank+c.suit),
    playerScore: sim.player.score, bankerScore: sim.banker.score, result: sim.result,
    playerPair: sim.playerPair, bankerPair: sim.bankerPair,
    startedAt, resultAt: new Date().toISOString(), editedBy:null, editedReason:null,
  });
  return id;
}

/* ---------------- Big Road roadmap builder ---------------- */
function buildBigRoad(results, pairFlags){
  // results: array of 'player'|'banker'|'tie', oldest first.
  // pairFlags (optional): parallel array of {playerPair,bankerPair} - real boards mark a
  // pair hit as a small corner dot on the result circle rather than a separate symbol.
  const cols = [];
  results.forEach((r,i)=>{
    const pf = pairFlags && pairFlags[i];
    if (r==='tie'){
      if (cols.length) cols[cols.length-1].ties = (cols[cols.length-1].ties||0)+1;
      else { cols.push({side:null, items:[], pairs:[], ties:1}); }
      return;
    }
    if (cols.length && cols[cols.length-1].side===r){
      cols[cols.length-1].items.push(r);
      cols[cols.length-1].pairs.push(pf);
    } else {
      cols.push({side:r, items:[r], pairs:[pf], ties:0});
    }
  });
  return cols;
}
function renderBigRoad(cols, maxRows){
  maxRows = maxRows || 6;
  const cells = [];
  cols.forEach((col,ci)=>{
    if (!col.side){ cells.push(`<div class="br-col"><div class="br-cell tie-only">${col.ties}</div></div>`); return; }
    let colHtml = '';
    col.items.forEach((it,ri)=>{
      if (ri >= maxRows) return;
      const showTie = ri===0 && col.ties>0;
      const pf = col.pairs[ri];
      let dots = '';
      if (pf && pf.playerPair) dots += '<i class="br-pair player"></i>';
      if (pf && pf.bankerPair) dots += '<i class="br-pair banker"></i>';
      colHtml += `<div class="br-cell ${it}">${showTie?`<span class="br-tie">${col.ties}</span>`:''}${dots}</div>`;
    });
    if (col.items.length > maxRows) colHtml += `<div class="br-cell overflow">+${col.items.length-maxRows}</div>`;
    cells.push(`<div class="br-col">${colHtml}</div>`);
  });
  return cells.join('');
}

/* ---------------- Bead Road (진주로드) — same column rule as Big Road: a result keeps
   stacking down the current column until the value changes, then a new column starts.
   Real boards mark each bead with its result letter and a pair corner dot, same as Big Road. */
const RESULT_LETTER = {player:'P', banker:'B', tie:'T'};
function renderBeadRoad(results, pairFlags){
  const cols = [];
  results.forEach((r,i)=>{
    const pf = pairFlags && pairFlags[i];
    if (cols.length && cols[cols.length-1].value===r) cols[cols.length-1].items.push(pf);
    else cols.push({value:r, items:[pf]});
  });
  const maxRows = 6;
  return cols.map(col=>{
    let html = '';
    col.items.forEach((pf,ri)=>{
      if (ri >= maxRows) return;
      let dots = '';
      if (pf && pf.playerPair) dots += '<i class="br-pair player"></i>';
      if (pf && pf.bankerPair) dots += '<i class="br-pair banker"></i>';
      html += `<div class="bd-cell ${col.value}">${RESULT_LETTER[col.value]}${dots}</div>`;
    });
    if (col.items.length > maxRows) html += `<div class="bd-cell overflow">+${col.items.length-maxRows}</div>`;
    return `<div class="br-col">${html}</div>`;
  }).join('');
}

/* ---------------- shared column-grouping for the derived roads + Bead Road: groups
   consecutive equal values into one column, exactly like Big Road groups consecutive
   same-side results - a value change always starts a new column. ---------------- */
function groupIntoRoadColumns(values){
  const cols = [];
  values.forEach(v=>{
    if (cols.length && cols[cols.length-1].value===v) cols[cols.length-1].items.push(v);
    else cols.push({value:v, items:[v]});
  });
  return cols;
}
function renderRoadColumns(cols, cellHtmlFn, overflowClass, maxRows){
  maxRows = maxRows || 6;
  return cols.map(col=>{
    let html = '';
    col.items.forEach((it,ri)=>{
      if (ri >= maxRows) return;
      html += cellHtmlFn(it);
    });
    if (col.items.length > maxRows) html += `<div class="${overflowClass} overflow">+${col.items.length-maxRows}</div>`;
    return `<div class="br-col">${html}</div>`;
  }).join('');
}

/* ---------------- table-list stats (vendor feedback: 오늘/총 베팅액, P/B/T 승수, 좋은 흐름) ---------------- */
function tableWinCounts(results){
  const c = {player:0, banker:0, tie:0};
  results.forEach(r=> c[r] = (c[r]||0)+1);
  return c;
}
function trailingStreak(results){
  // results oldest..newest. Ties don't break a streak but don't extend it either.
  const nonTie = results.filter(r=>r!=='tie');
  if (!nonTie.length) return {side:null, len:0};
  const last = nonTie[nonTie.length-1];
  let len = 0;
  for (let i=nonTie.length-1;i>=0;i--){ if (nonTie[i]===last) len++; else break; }
  return {side:last, len};
}
function tableBetVolume(betLedgerRows){
  const todayStr = new Date().toISOString().slice(0,10);
  let total = 0, today = 0;
  betLedgerRows.forEach(b=>{
    const amt = Math.abs(Number(b.amount)||0);
    total += amt;
    if ((b.createdAt||'').slice(0,10)===todayStr) today += amt;
  });
  return {total, today};
}

/* ---------------- derived roads (Big Eye Boy / Small Road / Cockroach Road) -
   decorative, simplified approximation of the standard rule: each one compares
   a Big Road column against the column `offset` steps further back to mark red
   (matching pattern) / blue (breaking pattern). offset 1/2/3 = Big Eye Boy/
   Small Road/Cockroach Road respectively - same comparison, deeper look-back. */
function deriveRoad(cols, offset){
  const out = [];
  for (let i=offset;i<cols.length;i++){
    const col = cols[i];
    if (!col.side) continue;
    for (let j=0;j<col.items.length;j++){
      let mark;
      if (j===0){
        if (i<offset+1) continue;
        mark = cols[i-offset].items.length === cols[i-offset-1].items.length ? 'red' : 'blue';
      } else {
        mark = cols[i-offset].items.length > j ? 'red' : 'blue';
      }
      out.push(mark);
    }
  }
  return out;
}
function deriveBigEyeBoy(cols){ return deriveRoad(cols, 1); }
function deriveSmallRoad(cols){ return deriveRoad(cols, 2); }
function deriveCockroachRoad(cols){ return deriveRoad(cols, 3); }
function renderDerivedRoad(marks, style){
  // Cockroach Road is conventionally drawn as diagonal ticks rather than dots,
  // distinguishing it at a glance from Big Eye Boy / Small Road on a real board.
  const cols = groupIntoRoadColumns(marks);
  return renderRoadColumns(cols, m=>`<div class="dr-cell ${m}${style?' '+style:''}"></div>`, 'dr-cell');
}


/* ---------------- chip-stack decomposition for the felt "chips in the betting spot" visual ---------------- */
function decomposeChipStack(amount, maxDiscs){
  maxDiscs = maxDiscs || 4;
  const denominations = [...CHIP_VALUES].sort((a,b)=>b-a);
  const discs = [];
  let remaining = amount;
  for (const v of denominations){
    while (remaining >= v && discs.length < maxDiscs){ discs.push(v); remaining -= v; }
  }
  if (!discs.length && amount > 0) discs.push(CHIP_VALUES[0]);
  return discs;
}
function chipStackHtml(amount){
  if (!amount) return '';
  return decomposeChipStack(amount).map(v=>`<div class="cs-chip c${v}"></div>`).join('');
}
