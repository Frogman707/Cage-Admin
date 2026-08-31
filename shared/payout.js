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
