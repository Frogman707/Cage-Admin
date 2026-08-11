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
  const member = {
    id, loginId:id, pw:data.pw, nickname:data.nickname, phone:data.phone, telegram:data.telegram||null,
    casino:data.casino, agentCode:data.agentCode||'DIRECT', parentAgent:data.agentCode||'DIRECT',
    memberType:'준회원', status:'정상', vip:false, betMax:1000000, betMin:5000,
    withdrawPw:data.pw, smsVerified:!!data.smsVerified, source:'online',
    createdAt:new Date().toISOString(), lastLoginAt:new Date().toISOString(),
  };
  // Claiming the id (checking it doesn't exist, then creating it) has to happen in one transaction,
  // not a separate get() then set() - otherwise two concurrent signups for the same id can both pass
  // the existence check and each append their own 100,000 signup bonus to memberLedger.
  const ref = db.collection('members').doc(id);
  try {
    await db.runTransaction(async tx=>{
      const existing = await tx.get(ref);
      if (existing.exists) throw new Error('DUP');
      tx.set(ref, member);
    });
  } catch (e) {
    if (e.message === 'DUP') return {ok:false, reason:'dup'};
    throw e;
  }
  await writeMemberLedgerEntry(db, {
    memberId:id, casino:data.casino, amount:100000, category:'deposit', memo:'가입 축하 포인트', staff:'system',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
  });
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
  await writeMemberLedgerEntry(db, {
    memberId, casino, amount: -Math.abs(amount), category:'bet', betType,
    relatedTableId: tableId, relatedRoundId: roundId, staff: staff||'system',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
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
    await writeMemberLedgerEntry(db, {
      memberId, casino, amount: payout, category:'payout',
      relatedTableId: tableId, relatedRoundId: roundId, staff:'system',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
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
  cols.forEach(col=>{
    if (!col.side){ cells.push(`<div class="br-col"><div class="br-cell tie-only">${col.ties}</div></div>`); return; }
    // A run longer than the board is deep continues in the next column ("dragon tail")
    // rather than being cut off with a counter, which is what a real board draws.
    for (let start=0; start<col.items.length; start+=maxRows){
      let colHtml = '';
      col.items.slice(start, start+maxRows).forEach((it,ri)=>{
        const idx = start + ri;
        const showTie = idx===0 && col.ties>0;
        const pf = col.pairs[idx];
        let dots = '';
        if (pf && pf.playerPair) dots += '<i class="br-pair player"></i>';
        if (pf && pf.bankerPair) dots += '<i class="br-pair banker"></i>';
        colHtml += `<div class="br-cell ${it}">${showTie?`<span class="br-tie">${col.ties}</span>`:''}${dots}</div>`;
      });
      cells.push(`<div class="br-col">${colHtml}</div>`);
    }
  });
  return cells.join('');
}

/* ---------------- Bead Road (진주로드) — strictly chronological, unlike every other road:
   results fill straight down a column of 6 and then wrap to the next column, so one column
   freely mixes P/B/T. (The value-change-starts-a-new-column rule applies to Big Road and the
   derived roads, never here.) Each bead carries its result letter and any pair corner dot. */
const BEAD_ROWS = 6;
const RESULT_LETTER = {player:'P', banker:'B', tie:'T'};
function renderBeadRoad(results, pairFlags){
  let html = '';
  for (let start=0; start<results.length; start+=BEAD_ROWS){
    let colHtml = '';
    results.slice(start, start+BEAD_ROWS).forEach((r,ri)=>{
      const pf = pairFlags && pairFlags[start+ri];
      let dots = '';
      if (pf && pf.playerPair) dots += '<i class="br-pair player"></i>';
      if (pf && pf.bankerPair) dots += '<i class="br-pair banker"></i>';
      colHtml += `<div class="bd-cell ${r}">${RESULT_LETTER[r]}${dots}</div>`;
    });
    html += `<div class="br-col">${colHtml}</div>`;
  }
  return html;
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
function renderRoadColumns(cols, cellHtmlFn, maxRows){
  maxRows = maxRows || 6;
  let html = '';
  cols.forEach(col=>{
    // same dragon-tail wrap as Big Road: overflow continues in the next column
    for (let start=0; start<col.items.length; start+=maxRows){
      html += `<div class="br-col">${col.items.slice(start, start+maxRows).map(cellHtmlFn).join('')}</div>`;
    }
  });
  return html;
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
// The three derived roads are distinguished by their mark, not their position: Big Eye Boy
// draws hollow rings, Small Road solid dots ('filled'), Cockroach Road diagonal ticks
// ('diagonal') - the same trio the P/B legend rail spells out. They stack three-to-a-panel
// under Big Road, so they run 3 rows deep rather than Big Road's 6.
const DERIVED_ROAD_ROWS = 3;
function renderDerivedRoad(marks, style){
  const cols = groupIntoRoadColumns(marks);
  return renderRoadColumns(cols, m=>`<div class="dr-cell ${m}${style?' '+style:''}"></div>`, DERIVED_ROAD_ROWS);
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
