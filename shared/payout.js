/* ============================================================
   CAGE ADMIN 5.0 — what a bet returns
   ============================================================
   The one place the board's odds are written down. The player app settles rounds as they are
   dealt; the admin re-settles a round whose result never landed (베팅내역 → 관리 → 업데이트).
   Both have to arrive at the same figure, and the admin cannot load shared/game-engine.js to get
   it — the two files each declare CARD_RANKS, so loading both is a syntax error. So the rule
   lives here, on its own, and both sides load it.

   The multipliers are what the house RETURNS in full, stake included: 플레이어 pays 1:1 so it
   returns twice the stake, 뱅커 pays 0.95:1 after commission, 타이 pays 8:1 and the pairs 11:1 —
   exactly the odds printed on the felt.
   ============================================================ */
const PAYOUT = { player: 2.0, banker: 1.95, tie: 9.0, playerPair: 12.0, bankerPair: 12.0 };

/* A tie is a push on 플레이어 and 뱅커: the stake comes back and nothing more. The pair bets are
   settled on the first two cards, so they win or lose on their own whichever side takes the hand,
   a tie included. */
function payoutFor(betType, amount, resultInfo){
  const r = resultInfo || {};
  let mult = 0;
  if (betType === 'player')          mult = r.result === 'player' ? PAYOUT.player : (r.result === 'tie' ? 1 : 0);
  else if (betType === 'banker')     mult = r.result === 'banker' ? PAYOUT.banker : (r.result === 'tie' ? 1 : 0);
  else if (betType === 'tie')        mult = r.result === 'tie' ? PAYOUT.tie : 0;
  else if (betType === 'playerPair') mult = r.playerPair ? PAYOUT.playerPair : 0;
  else if (betType === 'bankerPair') mult = r.bankerPair ? PAYOUT.bankerPair : 0;
  return Math.round(amount * mult);
}

/* One ledger row per round per spot per member, whichever side writes it and whichever attempt
   gets there. The player app retries a dropped write with this id, and the admin's re-settlement
   uses it too - so a round the admin settles can never be paid a second time by a retry arriving
   late from the table, and the other way round. */
function ledgerRowId(kind, {memberId, roundId, betType}){
  return `${kind}_${roundId}_${betType}_${memberId}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

/* ------------------------------------------------------------
   What a table will take, per spot
   ------------------------------------------------------------
   A table posts three sets of limits, not one: 본베팅 (플레이어/뱅커), 타이, and 페어. They sit on
   the table document as betMin/betMax, tieMin/tieMax, pairMin/pairMax. A table saved before those
   fields existed has only the first pair, so 타이 and 페어 fall back to it — no table's limits
   change until someone sets them. Both the felt and the admin read the rule from here. */
const SPOT_GROUP = {player:'main', banker:'main', tie:'tie', playerPair:'pair', bankerPair:'pair'};
function limitNum(v, fallback){
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function tableLimits(table, betType){
  const t = table || {};
  const mainMin = limitNum(t.betMin, 0), mainMax = limitNum(t.betMax, Infinity);
  const g = SPOT_GROUP[betType] || 'main';
  if (g === 'tie')  return {min: limitNum(t.tieMin,  mainMin), max: limitNum(t.tieMax,  mainMax)};
  if (g === 'pair') return {min: limitNum(t.pairMin, mainMin), max: limitNum(t.pairMax, mainMax)};
  return {min: mainMin, max: mainMax};
}

/* A member may carry limits of their own on top of the table's, set from 계정 관리 → 베팅한도. The
   narrower of the two is what the felt allows: a table that takes 3,000,000 still does not take
   3,000,000 from a member capped at 1,000,000, and a member with no limit of their own simply gets
   the table's. */
function effectiveLimits(table, member, betType){
  const t = tableLimits(table, betType);
  const m = member || {};
  return {
    min: Math.max(t.min, limitNum(m.betMin, 0)),
    max: Math.min(t.max, limitNum(m.betMax, Infinity)),
  };
}

/* 디프런스 베팅. A player may hold both sides of the main bet at once, and what the table stands to
   lose is the difference between them, not their sum — the smaller side is paid for by the larger
   one whichever way the hand falls. So the main maximum caps |플레이어 − 뱅커| rather than each
   side on its own, which is why a table with a 3,000,000 maximum will take 6,000,000 on 플레이어
   against 3,000,000 already standing on 뱅커.

   타이 and 페어 have no opposite side to net against, so each is capped on its own. */
function spotHeadroom(table, bets, betType, member){
  const {max} = effectiveLimits(table, member, betType);
  if (!Number.isFinite(max)) return Infinity;
  const mine = Number((bets||{})[betType]) || 0;
  if (betType === 'player' || betType === 'banker'){
    const other = Number((bets||{})[betType === 'player' ? 'banker' : 'player']) || 0;
    return Math.max(0, max + other - mine);
  }
  return Math.max(0, max - mine);
}
