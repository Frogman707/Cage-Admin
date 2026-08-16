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
function handTotal(cards){
  return cards.reduce((sum,c)=>sum+cardValue(c.rank), 0) % 10;
}
function randCard(){
  const rank = CARD_RANKS[Math.floor(Math.random()*CARD_RANKS.length)];
  const suit = CARD_SUITS[Math.floor(Math.random()*CARD_SUITS.length)];
  return {rank, suit};
}
function simulateRound(){
  // Punto banco tableau: both hands get two cards, then the fixed drawing rules decide any
  // third card. Nobody chooses - the sequence is entirely determined by the totals.
  const player = {cards:[randCard(), randCard()]};
  const banker = {cards:[randCard(), randCard()]};
  // pair side bets are settled on the first two cards, before any draw
  const playerPair = player.cards[0].rank === player.cards[1].rank;
  const bankerPair = banker.cards[0].rank === banker.cards[1].rank;

  let pt = handTotal(player.cards), bt = handTotal(banker.cards);
  // a natural 8 or 9 on either side stands both hands
  if (pt < 8 && bt < 8){
    let p3 = null;
    if (pt <= 5){ p3 = randCard(); player.cards.push(p3); pt = handTotal(player.cards); }
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
    if (bankerDraws){ banker.cards.push(randCard()); bt = handTotal(banker.cards); }
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
  await db.collection('memberLedger').doc(uuidv4()).set({
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
  await db.collection('memberLedger').doc(uuidv4()).set({
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
    await db.collection('memberLedger').doc(uuidv4()).set({
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
  // a road on the board scrolls with its band (the band carries the ruling, so the two travel
  // together); elsewhere the painted element is the scroller itself
  const scroller = (el.closest && el.closest('.sd-road-band')) || el;
  const pin = () => { snapRoadToColumns(el, scroller); el.scrollLeft = el.scrollWidth; scroller.scrollLeft = scroller.scrollWidth; };
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
  scroller.scrollLeft = scroller.scrollWidth;
  if (scroller.scrollWidth <= scroller.clientWidth) return;
  const pitch = cols[1].getBoundingClientRect().left - cols[0].getBoundingClientRect().left;
  if (pitch <= 0) return;
  const cs = getComputedStyle(scroller);
  const viewLeft = scroller.getBoundingClientRect().left
                 + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  // where the left edge falls on the lattice the columns are laid out on
  const off = ((viewLeft - cols[0].getBoundingClientRect().left) % pitch + pitch) % pitch;
  const pad = (pitch - off) % pitch;
  if (pad < 0.5 || pad > pitch - 0.5) return;
  // the pad is a flex item, so the row's own column gap lands in front of it as well - pull that
  // back or the road grows by pad + gap and lands just as crooked as it started
  const rowGap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const gap = document.createElement('i');
  gap.className = 'br-gap';
  gap.style.cssText = 'flex:0 0 auto;width:' + pad.toFixed(2) + 'px;margin-left:' + (-rowGap) + 'px;';
  grid.appendChild(gap);
  scroller.scrollLeft = scroller.scrollWidth;
}

/* Same pin for roads that ship inside a bigger block of markup rather than being painted into
   their own element - the table-list cards build their Big Road as part of the card's HTML.
   Those are overflow:hidden, so a card whose shoe has more columns than the card is wide would
   otherwise be stuck showing the oldest results with no way to swipe to the newest. */
function pinRoadsIn(root){
  const pin = () => (root || document).querySelectorAll('.mini-road').forEach(el=>{
    snapRoadToColumns(el, el);
    el.scrollLeft = el.scrollWidth;
  });
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
  return decomposeChipStack(amount).map(v=>`<div class="cs-chip c${v}"></div>`).join('');
}
