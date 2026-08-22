/* ============================================================
   CAGE ADMIN 5.0 — shared player-side game engine
   Used by /avatar and /speed. Handles member auth (lite),
   balance/point aggregation, bet placement + settlement, round
   history writes, and the Big Road roadmap builder. No real
   video feed / RNG-audited dealer — client-driven demo round
   loop that still persists every bet & result as real Firestore
   documents (see docs/FIRESTORE_DATA_MODEL.md).
   ============================================================ */

// The chips the operator's own artwork is printed with - shared/assets/chips/chip-<name>.png
// carries its value on its face, so the tray's denominations are the deck's, not ours.
const CHIP_VALUES = [100, 500, 1000, 10000, 100000, 1000000];
const CHIP_FILE = {100:'100', 500:'500', 1000:'1000', 10000:'10k', 100000:'100k', 1000000:'1m'};
function chipFaceUrl(v){ return `../shared/assets/chips/chip-${CHIP_FILE[v]}.png`; }
const CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const CARD_SUITS = ['♠','♥','♦','♣'];
const PAYOUT = { player: 2.0, banker: 1.95, tie: 9.0, playerPair: 12.0, bankerPair: 12.0 };

function cardValue(rank){
  if (rank==='A') return 1;
  if (['10','J','Q','K'].includes(rank)) return 0;
  return Number(rank);
}
function handTotal(cards){
  return cards.reduce((sum,c)=>sum+cardValue(c.rank), 0) % 10;
}
function randCard(){
  const rank = CARD_RANKS[Math.floor(Math.random()*CARD_RANKS.length)];
  const suit = CARD_SUITS[Math.floor(Math.random()*CARD_SUITS.length)];
  return {rank, suit};
}

/* ---------------- the shoe ----------------
   Baccarat is dealt from an 8-deck shoe without replacement, not from an endless supply
   of random cards, and the difference is not cosmetic: a pair lands on 31 of the 415 cards
   left beside its match (7.47%), where drawing at random would make it 1 in 13 (7.69%).
   That gap is the whole house edge on the 11:1 pair bet - 10.36% dealt properly against
   7.7% dealt at random. The shoe also gives the roadmaps something real to be a record of.  */
const SHOE_DECKS = 8;
const CUT_CARD_FROM_BOTTOM = 16;   // the stop card sits 16 cards from the end
const MAX_CARDS_PER_ROUND = 6;     // three to a side is the most any tableau can call for

function openShoe(no){
  const cards = [];
  for (let d = 0; d < SHOE_DECKS; d++)
    for (const suit of CARD_SUITS)
      for (const rank of CARD_RANKS) cards.push({rank, suit});
  for (let i = cards.length - 1; i > 0; i--){            // Fisher-Yates
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const shoe = {no: no || 1, cards, pos: 0, cutCardAt: cards.length - CUT_CARD_FROM_BOTTOM, finalHandDealt: false};
  // The burn: the dealer turns the top card and burns as many as it is worth, a ten or a
  // face counting ten rather than the zero it is worth in play.
  const turned = cards[shoe.pos++];
  shoe.burnCard = turned;
  shoe.burned = ['10','J','Q','K'].includes(turned.rank) ? 10 : cardValue(turned.rank);
  shoe.pos += shoe.burned;
  return shoe;
}
function shoeRemaining(shoe){ return shoe.cards.length - shoe.pos; }
function drawFrom(shoe){ return shoe.cards[shoe.pos++]; }

/* Once the cut card shows the dealer finishes the hand it appeared in, deals one more, and
   then the shoe is changed. Call this after each round: it hands back either the same shoe
   or a fresh one, so a caller can compare .no to see whether the shoe just turned over. */
function advanceShoe(shoe){
  if (!shoe) return openShoe(1);
  if (shoe.pos >= shoe.cutCardAt){
    if (shoe.finalHandDealt) return openShoe(shoe.no + 1);
    shoe.finalHandDealt = true;
  }
  if (shoeRemaining(shoe) < MAX_CARDS_PER_ROUND) return openShoe(shoe.no + 1);
  return shoe;
}

function simulateRound(shoe){
  // Punto banco tableau: both hands get two cards, then the fixed drawing rules decide any
  // third card. Nobody chooses - the sequence is entirely determined by the totals.
  // dealt from the shoe when there is one; randCard is the shoeless fallback used by tests
  const draw = shoe ? () => drawFrom(shoe) : randCard;
  const player = {cards:[draw(), draw()]};
  const banker = {cards:[draw(), draw()]};
  // pair side bets are settled on the first two cards, before any draw
  const playerPair = player.cards[0].rank === player.cards[1].rank;
  const bankerPair = banker.cards[0].rank === banker.cards[1].rank;

  let pt = handTotal(player.cards), bt = handTotal(banker.cards);
  // a natural 8 or 9 on either side stands both hands
  if (pt < 8 && bt < 8){
    let p3 = null;
    if (pt <= 5){ p3 = draw(); player.cards.push(p3); pt = handTotal(player.cards); }
    const v = p3 ? cardValue(p3.rank) : null;
    // with no player draw the banker follows the player's own rule; otherwise the tableau
    // keys off the banker total and the value of the player's third card
    const bankerDraws =
      p3 === null ? bt <= 5 :
      bt <= 2     ? true :
      bt === 3    ? v !== 8 :
      bt === 4    ? v >= 2 && v <= 7 :
      bt === 5    ? v >= 4 && v <= 7 :
      bt === 6    ? v === 6 || v === 7 :
                    false; // 7 stands
    if (bankerDraws){ banker.cards.push(draw()); bt = handTotal(banker.cards); }
  }
  player.score = pt; banker.score = bt;
  const result = pt > bt ? 'player' : bt > pt ? 'banker' : 'tie';
  return {player, banker, result, playerPair, bankerPair};
}

/* Order the cards hit the felt: one each alternating, then the player's third, then the
   banker's - so the reveal animation follows the deal rather than assuming four cards. */
function dealSequence(sim){
  const seq = [['player',0],['banker',0],['player',1],['banker',1]];
  if (sim.player.cards[2]) seq.push(['player',2]);
  if (sim.banker.cards[2]) seq.push(['banker',2]);
  return seq;
}

/* ---------------- member session (lite auth against `members`) ---------------- */
let PLAYER = null;
// A member already active on another device within this window can't be signed in
// on a second device until that session ends (logout) or the window lapses - the
// same 6h "online" window the admin panels already use to call a member online.
const SESSION_STALE_MS = 1000*60*60*6;
async function playerLogin(db, id, pw){
  const ref = db.collection('members').doc(id.toUpperCase());
  const doc = await ref.get();
  if (!doc.exists) return {ok:false, reason:'notfound'};
  const m = doc.data();
  if (String(m.pw ?? '0000') !== pw) return {ok:false, reason:'badpw'};
  if (m.status !== '정상') return {ok:false, reason:'blocked'};
  const myDevice = getDeviceId();
  if (m.activeDeviceId && m.activeDeviceId !== myDevice && m.lastLoginAt && (Date.now() - new Date(m.lastLoginAt).getTime()) < SESSION_STALE_MS){
    return {ok:false, reason:'duplicate'};
  }
  const lastLoginAt = new Date().toISOString();
  await ref.set({lastLoginAt, activeDeviceId: myDevice}, {merge:true});
  PLAYER = {...m, lastLoginAt, activeDeviceId: myDevice};
  return {ok:true, member:PLAYER};
}
async function playerLogout(db){
  const id = PLAYER?.id;
  PLAYER = null;
  if (id && db){
    try{ await db.collection('members').doc(id).set({activeDeviceId: firebase.firestore.FieldValue.delete()}, {merge:true}); }catch(e){}
  }
}
async function playerSignup(db, data){
  const id = data.id.toUpperCase();
  const member = {
    id, loginId:id, pw:data.pw, nickname:data.nickname, phone:data.phone, telegram:data.telegram||null,
    casino:data.casino, agentCode:data.agentCode||'DIRECT', parentAgent:data.agentCode||'DIRECT',
    memberType:'준회원', status:'정상', vip:false, betMax:1000000, betMin:5000,
    withdrawPw:data.pw, smsVerified:!!data.smsVerified, source:'online',
    createdAt:new Date().toISOString(), lastLoginAt:new Date().toISOString(), activeDeviceId: getDeviceId(),
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
  await db.collection('memberLedger').doc(uuidv4()).set({
    memberId:id, casino:data.casino, amount:100000, category:'deposit', memo:'가입 축하 포인트', staff:'system',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
  });
  PLAYER = member;
  return {ok:true, member};
}
/* ---------------- the cage's ledger is a cage account's balance ----------------
   An account opened at a cage keeps its money in the cage's own `ledger` collection: the same
   rows the cage floor reads, where its balance is the sum of what has come in less what has gone
   out. So a player's stake and winnings are written there as they happen, and the cage sees the
   balance move on the same rows it already watches - one book, both sides, live - rather than the
   two keeping separate accounts that quietly drift apart.

   Members who were never opened at a cage - a demo account, an online signup - have no cage
   ledger to draw on, so they keep their own memberLedger balance, which is the only book they
   have. memberLedger is written either way: it is the partner admin's record of play. */
function isCageAccount(member){ return !!member && member.source === 'cage'; }
async function writeCageLedger(db, {accountId, casino, type, amount, memo}){
  const value = Math.abs(Number(amount) || 0);
  if (!value) return;
  const id = 'ldg_' + Date.now() + '_' + Math.random().toString(36).slice(2,9);
  await db.collection('ledger').doc(id).set({
    id, accountId, casino: casino || 'HANN',
    dt: new Date().toISOString().slice(0,16).replace('T',' '),
    type, inn: type === 'IN' ? value : 0, out: type === 'OUT' ? value : 0,
    staff: 'avatar', memo: memo || '',
  });
}
async function getPlayerBalance(db, memberId, member){
  const cage = isCageAccount(member || PLAYER);
  const [ledgerSnap, memberSnap] = await Promise.all([
    cage ? db.collection('ledger').where('accountId','==',memberId).get() : Promise.resolve(null),
    db.collection('memberLedger').where('memberId','==',memberId).get(),
  ]);
  let balance = 0, points = 0;
  memberSnap.forEach(d=>{
    const r = d.data();
    if (r.category==='point_earn' || r.category==='point_convert') points += Number(r.amount)||0;
    else if (!cage) balance += Number(r.amount)||0;
  });
  if (cage && ledgerSnap) ledgerSnap.forEach(d=>{
    const r = d.data();
    balance += (Number(r.inn)||0) - (Number(r.out)||0);
  });
  return {balance, points};
}

/* ---------------- betting ---------------- */
async function placeBet(db, {memberId, casino, tableId, roundId, betType, amount, staff}){
  await db.collection('memberLedger').doc(uuidv4()).set({
    memberId, casino, amount: -Math.abs(amount), category:'bet', betType,
    relatedTableId: tableId, relatedRoundId: roundId, staff: staff||'system',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
  });
  // the stake leaves the cage account as it is placed
  if (isCageAccount(PLAYER)) await writeCageLedger(db, {
    accountId: memberId, casino, type:'OUT', amount,
    memo: `${tableId} ${betType}`,
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
    });
    // and the return comes back into it
    if (isCageAccount(PLAYER)) await writeCageLedger(db, {
      accountId: memberId, casino, type:'IN', amount: payout,
      memo: `${tableId} ${betType}`,
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

/* ---------------- Big Road roadmap builder ----------------
   buildBigRoad groups the shoe into runs (a run = consecutive wins by the same side, which is
   what one Big Road column represents), and layoutRoadGrid places those runs on the board the
   way every live-casino board does it. */
function buildBigRoad(results, pairFlags){
  // results: array of 'player'|'banker'|'tie', oldest first.
  // pairFlags (optional): parallel array of {playerPair,bankerPair} - real boards mark a
  // pair hit as a small corner dot on the result circle rather than a separate symbol.
  const runs = [];
  results.forEach((r,i)=>{
    const pf = (pairFlags && pairFlags[i]) || null;
    const cur = runs[runs.length-1];
    if (r==='tie'){
      // A tie does not take a cell of its own: it is a green slash drawn across the hand that
      // is currently showing, and a repeat tie on the same hand bumps that slash's count. Only
      // a tie before any decision has nowhere to land, and gets its own green marker.
      if (cur && cur.items.length) cur.items[cur.items.length-1].ties++;
      else runs.push({side:null, items:[{side:null, pair:null, ties:1}]});
      return;
    }
    if (cur && cur.side===r) cur.items.push({side:r, pair:pf, ties:0});
    else runs.push({side:r, items:[{side:r, pair:pf, ties:0}]});
  });
  return runs;
}
/* Places runs on a maxRows-deep board under the standard rules, and returns the board as an
   array of columns (each a sparse array indexed by row).
     - a run opens at the top of the first column free at row 0, one column right of where the
       previous run opened;
     - it then walks down one cell per hand;
     - when it would leave the bottom row, or when the cell below is already taken by an earlier
       run's tail, it turns right instead and keeps going right for the rest of the run.
   That right turn is the "dragon tail" - the reason a long streak runs along the bottom of a
   real board rather than restarting at the top of the next column. */
function layoutRoadGrid(runs, maxRows){
  const grid = [];
  const taken = (c,r) => !!(grid[c] && grid[c][r]);
  const put = (c,r,v) => { (grid[c] = grid[c] || [])[r] = v; };
  let head = 0;
  runs.forEach(run=>{
    let c = head, r = 0;
    while (taken(c,0)) c++;
    head = c + 1;
    put(c, 0, run.items[0]);
    let turned = false;
    for (let k=1;k<run.items.length;k++){
      if (!turned && r+1 < maxRows && !taken(c,r+1)) r++;
      else { turned = true; c++; while (taken(c,r)) c++; }
      put(c, r, run.items[k]);
    }
  });
  return grid;
}
/* Renders a laid-out board. Every column is emitted at full depth, empty cells included, so the
   marks keep their row positions once a dragon tail has left holes above it - and so the board
   stays the same height whatever the shoe is doing. .br-cell's border is transparent until a
   side class colours it, so an empty cell is already an invisible spacer. */
function renderRoadGrid(grid, maxRows, cellHtmlFn){
  return grid.map(col=>{
    let html = '';
    for (let r=0;r<maxRows;r++) html += cellHtmlFn((col && col[r]) || null);
    return `<div class="br-col">${html}</div>`;
  }).join('');
}
function renderBigRoad(runs, maxRows){
  maxRows = maxRows || 6;
  return renderRoadGrid(layoutRoadGrid(runs, maxRows), maxRows, it=>{
    if (!it) return '<div class="br-cell"></div>';
    if (!it.side) return `<div class="br-cell tie-only">${it.ties>1?it.ties:''}</div>`;
    let dots = '';
    if (it.pair && it.pair.playerPair) dots += '<i class="br-pair player"></i>';
    if (it.pair && it.pair.bankerPair) dots += '<i class="br-pair banker"></i>';
    // The count rides along only when the same spot took more than one tie, and must sit in its
    // own <span> for the badge styling (and the mini-roads' hide rule) to apply to it.
    const tie = it.ties ? `<span class="br-tie">${it.ties>1?`<span>${it.ties}</span>`:''}</span>` : '';
    return `<div class="br-cell ${it.side}">${tie}${dots}</div>`;
  });
}

/* ---------------- Bead Plate (진주로드 / 珠盤路) ----------------
   The Bead Plate is the plain chronological log: one bead per hand, in the order the shoe dealt
   them, filling a column top to bottom and only then moving to the next column. It does NOT
   start a new column when the result changes - that is the Big Road's rule, not this one - so a
   column normally holds a mix of P/B/T. Blue = player, red = banker, green = tie, each bead
   carrying its result letter and any pair corner dot. */
const BEAD_ROWS = 6;
// how many recent hands the Bead Plate keeps in view - six rows by twelve columns is the
// standard board size, so the panel holds a dozen columns and scrolls to the newest.
const BEAD_WINDOW = 72;
const RESULT_LETTER = {player:'P', banker:'B', tie:'T'};
function renderBeadRoad(results, pairFlags){
  let html = '', colHtml = '';
  results.forEach((r,i)=>{
    const pf = (pairFlags && pairFlags[i]) || null;
    let dots = '';
    if (pf && pf.playerPair) dots += '<i class="br-pair player"></i>';
    if (pf && pf.bankerPair) dots += '<i class="br-pair banker"></i>';
    colHtml += `<div class="bd-cell ${r}">${RESULT_LETTER[r]}${dots}</div>`;
    if ((i+1) % BEAD_ROWS === 0){ html += `<div class="br-col">${colHtml}</div>`; colHtml = ''; }
  });
  if (colHtml) html += `<div class="br-col">${colHtml}</div>`;
  return html;
}

/* ---------------- shared column-grouping for the derived roads: groups consecutive equal
   values into one run, exactly like buildBigRoad groups consecutive same-side results. The
   derived roads are then placed by the same rules as the Big Road - down a column, turning
   right at the bottom - which is why they share layoutRoadGrid. ---------------- */
function groupIntoRoadColumns(values){
  const runs = [];
  values.forEach(v=>{
    if (runs.length && runs[runs.length-1].value===v) runs[runs.length-1].items.push(v);
    else runs.push({value:v, items:[v]});
  });
  return runs;
}
function renderRoadColumns(runs, cellHtmlFn, maxRows){
  maxRows = maxRows || 6;
  return renderRoadGrid(layoutRoadGrid(runs, maxRows), maxRows, m => m ? cellHtmlFn(m) : '<div class="dr-cell"></div>');
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
  // A leading tie carries a marker but is not a Big Road column, so it contributes no depth.
  const depth = i => (cols[i] && cols[i].side) ? cols[i].items.length : 0;
  const out = [];
  for (let i=offset;i<cols.length;i++){
    const col = cols[i];
    if (!col.side) continue;
    for (let j=0;j<col.items.length;j++){
      let mark;
      if (j===0){
        if (i<offset+1) continue;
        mark = depth(i-offset) === depth(i-offset-1) ? 'red' : 'blue';
      } else {
        // the streak continued: compare the cell one column back on this row with the one
        // above it. Both filled or both empty means the pattern repeated (red); exactly one
        // filled means it broke (blue) - which is only when that column ends at this row.
        mark = depth(i-offset) === j ? 'blue' : 'red';
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
// ('diagonal') - the same trio the P/B legend rail spells out. Like the Big Road they are six
// marks deep; the marks are drawn at half a Big Road cell so those six fit in three ruled
// squares, which is how a real board stacks all four roads into one panel.
/* ---------------- next-hand prediction (the board's "ask banker / ask player") ----------------
   What each derived road would draw if the next hand went Banker, and if it went Player. The
   rules are not restated here: the shoe is replayed with the hypothetical hand on the end and
   the same three builders are asked for the mark that appears, so the panel cannot disagree
   with the board beside it.
   A road that has not started yet gains no mark and reports null rather than a colour - Big Eye
   Boy cannot begin before the third hand, Small Road the fourth, Cockroach Road the fifth. A
   hypothetical tie is not offered: a tie does not open a Big Road cell, so it moves no derived
   road at all. */
const ASK_ROADS = [['bigEye', deriveBigEyeBoy], ['smallRoad', deriveSmallRoad], ['cockroach', deriveCockroachRoad]];
function predictNextRoads(history){
  const now = buildBigRoad(history || []);
  const have = {};
  ASK_ROADS.forEach(([key, fn]) => { have[key] = fn(now).length; });
  const ask = side => {
    const runs = buildBigRoad([...(history || []), side]);
    const out = {};
    ASK_ROADS.forEach(([key, fn]) => {
      const marks = fn(runs);
      out[key] = marks.length > have[key] ? marks[marks.length - 1] : null;
    });
    return out;
  };
  return {banker: ask('banker'), player: ask('player')};
}

const DERIVED_ROAD_ROWS = 6;
function renderDerivedRoad(marks, style){
  const cols = groupIntoRoadColumns(marks);
  return renderRoadColumns(cols, m=>`<div class="dr-cell ${m}${style?' '+style:''}"></div>`, DERIVED_ROAD_ROWS);
}

/* Every road grows to the right, so the column the player actually cares about - the one the
   round that just finished landed in - is the one that falls off the right edge as soon as the
   shoe outgrows the panel. Repaint through here so each road parks at its right edge and the
   latest result is on screen without the player having to swipe the board across. */
function paintRoad(el, html){
  if (!el) return;
  el.innerHTML = html;
  watchRoadRelayout();
  watchDragScroll();
  // a road on the board scrolls with its band (the band carries the ruling, so the two travel
  // together); elsewhere the painted element is the scroller itself
  const scroller = (el.closest && el.closest('.sd-road-band')) || el;
  // snapRoadToColumns parks the road itself - pinning again after it would undo the pixel or
  // two it backs off by to land the left edge on a whole column
  const pin = () => snapRoadToColumns(el, scroller);
  pin();
  // Two things can invalidate that first pin: another repaint later in the same tick can resize
  // the road (the tally counters sitting left of the Bead Plate widen as the shoe grows), and a
  // road painted while its screen is still hidden measures zero. Re-pin once the frame settles.
  requestAnimationFrame(pin);
}
/* Parking a road at scrollWidth puts its newest column against the right edge, but the distance
   scrolled is then whatever the shoe happens to measure - almost never a whole number of columns,
   so the column at the left edge was being sliced down the middle. Pad the road out on the right
   until that distance divides evenly, and both edges land on a column: the newest is still whole
   against the right, and the oldest one on screen starts where a column starts.
   The pad goes on the right because the left edge is where the ruling is anchored - padding that
   side would carry the marks off their squares. */
function snapRoadToColumns(grid, scroller){
  const old = grid.lastElementChild;
  if (old && old.classList && old.classList.contains('br-gap')) grid.removeChild(old);
  const cols = grid.children;
  if (cols.length < 2) return;
  // Everything here is counted in the element's own pixels - offsetLeft, scrollLeft, scrollWidth
  // and a width written into CSS all are. getBoundingClientRect is not: browser zoom scales it,
  // so a pitch measured that way and then spent as a CSS width came out zoom times wrong and the
  // left edge sliced the oldest column - two thirds of a ring at 150%, and worse zoomed out.
  // The columns are read one by one rather than multiplied out from a pitch, because at a zoom
  // that does not divide evenly the columns do not all land on the same fraction of a pixel and
  // a single pitch drifts a mark's width across a shoe's worth of them.
  const first = cols[0].offsetLeft;
  const starts = [];
  for (let i = 0; i < cols.length; i++) starts.push(cols[i].offsetLeft - first);
  if (starts[1] <= 0) return;
  // scrollLeft counts from the content's start edge, and a scroller clips at its padding box, so
  // the scroller's own left padding sits between the two
  const padLeft = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
  // The far end is read back off the browser rather than worked out from scrollWidth minus
  // clientWidth: both of those are whole numbers, and a band a third of a panel wide is not, so
  // the sum was over a pixel out and the road paid for it on one edge or the other.
  scroller.scrollLeft = scroller.scrollWidth;
  const maxScroll = scroller.scrollLeft;
  // a road that fits is already where it starts, which is a column start
  if (maxScroll <= 0) return;
  // Pad the road out on the right until the distance scrolled leaves the left edge on a column
  // start. The pad goes on the right because the left edge is where the ruling is anchored -
  // padding that side would carry the marks off their squares.
  const want = maxScroll - padLeft;
  const target = starts.find(s => s - want >= -0.5);
  if (target !== undefined && target - want >= 0.5){
    // the pad is a flex item, so the row's own column gap lands in front of it as well - pull that
    // back or the road grows by pad + gap and lands just as crooked as it started
    const rowGap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const gap = document.createElement('i');
    gap.className = 'br-gap';
    gap.style.cssText = 'flex:0 0 auto;width:' + (target - want).toFixed(2) + 'px;margin-left:' + (-rowGap) + 'px;';
    grid.appendChild(gap);
  }
  scroller.scrollLeft = scroller.scrollWidth;
  // Whatever rounding the browser has left over goes to the right-hand edge rather than the left:
  // the road backs off to the nearest column start, so it comes to rest on a whole column whether
  // or not the pad landed exactly. Only ever backwards - it is already as far right as it goes.
  const edge = scroller.scrollLeft - padLeft;
  let near = 0, dist = Infinity;
  for (let i = 0; i < starts.length; i++){
    const d = Math.abs(edge - starts[i]);
    if (d < dist){ dist = d; near = starts[i]; }
  }
  // a sub-pixel residue is left alone: backing off for it would cost the newest column on the
  // right edge the same hair it saves on the left
  if (edge - near >= 0.5) scroller.scrollLeft = near + padLeft;
}

/* The pad a road carries is measured against the width its band had when it was painted, so a
   rotation or any other resize leaves it stale and the left edge starts slicing again. Roads are
   only repainted when a round finishes, which on a slow table is a while to sit looking at a cut
   column, so re-measure them all when the window changes instead of waiting. */
const ROAD_SCROLLERS = '.sd-road .br-grid, .sd-road .derived-road-grid, .bead-road, .mini-road';
let roadRelayoutWatched = false;
function resnapRoads(root){
  (root || document).querySelectorAll(ROAD_SCROLLERS).forEach(grid=>{
    snapRoadToColumns(grid, grid.closest('.sd-road-band') || grid);
  });
}
function watchRoadRelayout(){
  if (roadRelayoutWatched || typeof window === 'undefined') return;
  roadRelayoutWatched = true;
  let pending = null;
  const again = () => { clearTimeout(pending); pending = setTimeout(()=>resnapRoads(), 80); };
  window.addEventListener('resize', again);
  window.addEventListener('orientationchange', again);
}

/* ---------------- drag a board sideways with the mouse ----------------
   These strips scroll but a mouse has no sideways wheel, so on a desktop the only way across a
   long shoe was a shift-wheel most players will never try. Press and drag now moves them, the
   way a finger already does on a phone. It is delegated from the document so it covers strips
   that are painted in later, and it stays out of the way of ordinary use: a press that never
   travels more than a few pixels is left alone, so clicking a bet spot or a card still works,
   and nothing is dragged on a strip that has nowhere to go. */
const DRAG_SCROLLERS = '.sd-road-band, .bead-road, .mini-road, .sd-board-row, .sm-road, .sm-list, .br-grid, .derived-road-grid';
const DRAG_SLOP = 4;   // px of travel before a press counts as a drag rather than a click
let dragScrollWatched = false;
function watchDragScroll(){
  if (dragScrollWatched || typeof document === 'undefined') return;
  dragScrollWatched = true;
  let el = null, startX = 0, startLeft = 0, moved = false;

  // The nearest match is not always the one that scrolls - a road's grid matches too and is
  // inside the band that actually carries the overflow - so keep walking up until one of them
  // has somewhere to go.
  const scrollerFor = node => {
    for (let n = node; n && n.closest; n = n.parentElement){
      const hit = n.closest(DRAG_SCROLLERS);
      if (!hit) return null;
      if (hit.scrollWidth > hit.clientWidth + 1) return hit;
      n = hit;                       // this one cannot scroll; try the next match above it
    }
    return null;
  };
  document.addEventListener('pointerdown', e=>{
    if (e.button !== 0 || e.pointerType !== 'mouse') return;
    const hit = scrollerFor(e.target);
    if (!hit) return;
    el = hit; startX = e.clientX; startLeft = hit.scrollLeft; moved = false;
  });
  document.addEventListener('pointermove', e=>{
    if (!el) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < DRAG_SLOP) return;
    if (!moved){ moved = true; el.classList.add('drag-scrolling'); }
    el.scrollLeft = startLeft - dx;
    e.preventDefault();
  });
  const end = () => {
    if (!el) return;
    el.classList.remove('drag-scrolling');
    // a press that turned into a drag must not also fire the click underneath it
    if (moved){ const was = el; document.addEventListener('click', ev=>{
      if (was.contains(ev.target)){ ev.stopPropagation(); ev.preventDefault(); }
    }, {capture:true, once:true}); }
    el = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
}

/* Same pin for roads that ship inside a bigger block of markup rather than being painted into
   their own element - the table-list cards build their Big Road as part of the card's HTML.
   Those are overflow:hidden, so a card whose shoe has more columns than the card is wide would
   otherwise be stuck showing the oldest results with no way to swipe to the newest. */
function pinRoadsIn(root){
  const pin = () => (root || document).querySelectorAll('.mini-road').forEach(el=>snapRoadToColumns(el, el));
  pin();
  requestAnimationFrame(pin);
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
  return decomposeChipStack(amount).map(v=>`<div class="cs-chip" style="background-image:url('${chipFaceUrl(v)}')"></div>`).join('');
}
