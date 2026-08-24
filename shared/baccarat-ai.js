/* ============================================================
   CAGE ADMIN 5.0 — baccarat prediction engine
   Loaded by /avatar (the table's 다음 게임 예측 panel) and by
   tools/baccarat-backtest.js, which is the thing that decides
   whether any of this is worth keeping.

   READ THIS BEFORE TRUSTING ANYTHING BELOW.

   The project's own first question is the right one: is there a
   statistical signal in past baccarat that says anything about
   the next hand? Two of the three answers here are known before
   a line of code runs, and the code is written so it reports
   them honestly rather than manufacturing an edge:

   1. PAST RESULTS carry no signal. A shoe is shuffled once and
      dealt; P/B/T history is a record of draws already taken
      out of it, and nothing in "P P P P" changes what the next
      card is. The pattern model here exists to be MEASURED, not
      because it is expected to work - if it lands above chance
      on shuffled data, that is a bug in this file, not an edge.

   2. CARD COMPOSITION does carry a real signal, and it is the
      only one that does. A shoe is finite: as cards leave it the
      exact probability of the next hand moves. That is not a
      theory, it is arithmetic, and compositionModel() computes
      it rather than guessing at it.

   3. The signal in (2) is far too small to beat the commission.
      Baccarat's card-counting edge is famously the weakest of
      any table game - the P/B crossover almost never happens,
      and when it does it is worth a fraction of a percent for a
      handful of hands at the very end of a shoe. Expect the
      backtest to return a negative expectation whatever the
      model says, and expect the recommendation to be 뱅커 nearly
      always, because banker's -1.06% simply loses more slowly
      than player's -1.24%.

   None of that is a reason not to build it. It is the reason to
   build the measuring end first and let the numbers decide, which
   is what the spec asks for and what tools/baccarat-backtest.js
   does. What must not happen is a screen that shows a confident
   number with nothing behind it.
   ============================================================ */

/* ---------------- the shoe as the model sees it ----------------
   Only a card's baccarat value matters, so the shoe is ten counts, not fifty-two. Value 0 holds
   four ranks (10/J/Q/K) and so starts four times as deep as the rest. */
function emptyValueCounts(){ return [0,0,0,0,0,0,0,0,0,0]; }
function shoeValueCounts(decks){
  const c = emptyValueCounts();
  const d = Number(decks) || 8;
  for (let v = 1; v <= 9; v++) c[v] = 4 * d;   // A..9, four suits
  c[0] = 16 * d;                                // 10, J, Q, K
  return c;
}
// What is left in a live shoe: the dealt cards taken off a full one. Works off the same shoe
// object shared/game-engine.js deals from (cards + pos), so the panel and the engine cannot
// disagree about what has gone.
function remainingValueCounts(shoe, decks){
  const c = shoeValueCounts(decks || 8);
  if (!shoe || !shoe.cards) return c;
  for (let i = 0; i < shoe.pos && i < shoe.cards.length; i++){
    const v = cardValue(shoe.cards[i].rank);
    if (c[v] > 0) c[v]--;
  }
  return c;
}
function countsTotal(counts){ return counts.reduce((a,b)=>a+b, 0); }

/* ---------------- 2. the composition model ----------------
   The exact probability of the next hand given what is left in the shoe. Exact by enumeration is
   not reachable - a hand is up to six cards from a multiset of four hundred, which is billions of
   orderings - so it is sampled: deal a full tableau out of the remaining shoe, by the same rules
   the table deals by, and count how it lands. The sampling error is 1/sqrt(trials), so 4000
   trials puts it within about 0.8% either way, which is an order of magnitude wider than the
   effect being looked for. That is stated rather than hidden: the panel reports it as a margin,
   and the backtest uses far more trials than the panel can afford. */
function drawValue(counts, total, rnd){
  let k = Math.floor(rnd() * total);
  for (let v = 0; v < 10; v++){
    if (k < counts[v]){ counts[v]--; return v; }
    k -= counts[v];
  }
  for (let v = 9; v >= 0; v--) if (counts[v] > 0){ counts[v]--; return v; }   // rounding guard
  return 0;
}
/* The punto banco tableau on values alone - the same rules as game-engine's simulateRound, which
   deals card objects. Kept as values here because this runs millions of times. */
function playTableauValues(counts, total, rnd){
  const d = () => drawValue(counts, total--, rnd);
  const p1 = d(), p2 = d(), b1 = d(), b2 = d();
  let pt = (p1 + p2) % 10, bt = (b1 + b2) % 10;
  if (pt < 8 && bt < 8){
    let p3 = null;
    if (pt <= 5){ p3 = d(); pt = (pt + p3) % 10; }
    const draws =
      p3 === null ? bt <= 5 :
      bt <= 2     ? true :
      bt === 3    ? p3 !== 8 :
      bt === 4    ? p3 >= 2 && p3 <= 7 :
      bt === 5    ? p3 >= 4 && p3 <= 7 :
      bt === 6    ? p3 === 6 || p3 === 7 :
                    false;
    if (draws) bt = (bt + d()) % 10;
  }
  return pt > bt ? 'player' : bt > pt ? 'banker' : 'tie';
}
const COMPOSITION_TRIALS = 4000;
function compositionModel(counts, opts){
  const trials = (opts && opts.trials) || COMPOSITION_TRIALS;
  const rnd = (opts && opts.rnd) || Math.random;
  const total = countsTotal(counts);
  // Not enough shoe left to deal from: nothing to say, and the table is about to change shoes.
  if (total < 6) return {player:0, banker:0, tie:0, trials:0, ok:false};
  const hit = {player:0, banker:0, tie:0};
  const work = emptyValueCounts();
  for (let i = 0; i < trials; i++){
    for (let v = 0; v < 10; v++) work[v] = counts[v];
    hit[playTableauValues(work, total, rnd)]++;
  }
  return {player:hit.player/trials, banker:hit.banker/trials, tie:hit.tie/trials, trials, ok:true};
}
// One standard error on a sampled probability, which is the number the panel has to respect
// before calling anything a signal.
function sampleMargin(p, trials){ return trials ? Math.sqrt(Math.max(p*(1-p), 1e-9)/trials) : 1; }

/* ---------------- 1. the pattern model ----------------
   What the roads say, turned into numbers, and a logistic regression over them. It is here to be
   falsified: on a shuffled shoe its weights should wander around zero and its accuracy should sit
   on the base rate. It is trained walk-forward - one hand at a time, in order, updating only on
   hands it has already predicted - so it can never see its own answer. */
const PATTERN_FEATURES = [
  'bias',        // the base rate the shoe deals at, which is banker's to lose
  'lastBanker',  // did the last decision go banker
  'streak',      // how long the current run is, scaled
  'chop',        // how much the last ten decisions alternated
  'bankerRate',  // banker's share of the shoe so far
  'shoeDepth',   // how far into the shoe this hand is
  'bigEye',      // what the derived roads would draw for banker next: +1 red, -1 blue, 0 none
  'smallRoad',
  'cockroach',
];
function patternFeatureVector(history, shoeProgress){
  const h = (history || []).filter(r => r !== 'tie');
  const n = h.length;
  const last = h[n-1];
  let streak = 0;
  for (let i = n-1; i >= 0 && h[i] === last; i--) streak++;
  let alternations = 0;
  const tail = h.slice(-11);
  for (let i = 1; i < tail.length; i++) if (tail[i] !== tail[i-1]) alternations++;
  const bankers = h.filter(r => r === 'banker').length;
  // the same three answers the board's own 다음 게임 예측 rail draws, as numbers
  const ask = (typeof predictNextRoads === 'function') ? predictNextRoads(history || []) : {banker:{}};
  const mark = k => ask.banker[k] === 'red' ? 1 : ask.banker[k] === 'blue' ? -1 : 0;
  return [
    1,
    last === 'banker' ? 1 : last === 'player' ? -1 : 0,
    Math.min(streak, 10) / 10,
    tail.length > 1 ? alternations/(tail.length-1) : 0,
    n ? bankers/n - 0.5 : 0,
    Math.max(0, Math.min(1, Number(shoeProgress) || 0)),
    mark('bigEye'), mark('smallRoad'), mark('cockroach'),
  ];
}
/* Plain online logistic regression: predicts P(banker | not a tie), then takes one gradient step
   on the hand once it has happened. No library, no training run - the walk-forward IS the
   training, which is also what makes it impossible for it to peek. */
function makePatternModel(opts){
  const lr = (opts && opts.lr) || 0.02;
  const l2 = (opts && opts.l2) || 1e-4;
  const w = PATTERN_FEATURES.map(()=>0);
  // the bias starts where the game actually sits: banker takes 50.68% of decided hands
  w[0] = Math.log(0.5068/0.4932);
  return {
    weights: w,
    predict(x){
      let z = 0;
      for (let i = 0; i < w.length; i++) z += w[i]*x[i];
      return 1/(1+Math.exp(-z));
    },
    learn(x, bankerWon){
      const p = this.predict(x), err = (bankerWon ? 1 : 0) - p;
      for (let i = 0; i < w.length; i++) w[i] += lr*(err*x[i] - l2*w[i]);
    },
  };
}

/* ---------------- putting the two together ----------------
   The composition model is the one with arithmetic behind it, so it carries the answer; the
   pattern model is allowed to nudge it, and `patternWeight` is how far. At 0 the pattern model is
   only being measured, which is where it should stay until a backtest on data that is NOT a
   shuffled shoe says otherwise. */
const DEFAULT_PATTERN_WEIGHT = 0;
function blendPredictions(comp, patternBankerP, patternWeight){
  const wgt = Number.isFinite(patternWeight) ? patternWeight : DEFAULT_PATTERN_WEIGHT;
  const decided = comp.player + comp.banker;
  if (!comp.ok || decided <= 0) return {player:0, banker:0, tie:0, ok:false};
  // the pattern model only ever speaks about decided hands, so the tie is the composition's
  const compBanker = comp.banker/decided;
  const banker = (1-wgt)*compBanker + wgt*patternBankerP;
  return {
    player: (1-banker)*decided,
    banker: banker*decided,
    tie: comp.tie,
    ok: true,
  };
}

/* ---------------- what it is worth, which is the only question that matters ----------------
   Per unit staked, with the tie pushing both sides and banker paying its 5%. A hand the model
   thinks is a coin flip is still worth -1.06% on banker and -1.24% on player; the model has to
   move the odds further than that before either side is worth having. */
const BANKER_COMMISSION = 0.05;
function expectedValues(p){
  const banker = p.banker*(1-BANKER_COMMISSION) - p.player;
  const player = p.player - p.banker;
  return {banker, player};
}
/* The recommendation, and how much to believe it. Confidence is not the probability - a 53%
   banker call on 4000 trials is inside its own sampling error and means nothing - it is how far
   the edge stands clear of both the margin of error and the house's cut. */
/* The side to call is NOT simply whichever expected value is larger, and getting that wrong is
   the whole trap here. The two sit 0.19 of a percent apart on a fresh shoe - banker -1.06%
   against player -1.24% - while a probability sampled over a few thousand trials carries about
   a percent of noise. Taking the larger of the two therefore reads the noise, not the shoe, and
   coin-flips between them; an early run of this called player on half the hands, which no
   correct model of baccarat ever does.
   To resolve a 0.19% difference the standard error has to be under about 0.05%, which needs on
   the order of a million trials a hand - not something a table can do between rounds, and not
   something worth doing, because the difference it would resolve is smaller than the commission
   either way. So banker is the standing answer, and player is only called when the composition
   actually puts it ahead by more than the sampling can be wrong by. */
/* Two sigma on the QUANTITY THE COMPARISON ACTUALLY TURNS ON, which is
     EV(player) - EV(banker) = 2*p_player - 1.95*p_banker
   and not on either probability by itself. The two come out of one multinomial sample, so they
   are negatively correlated - Cov = -p_p*p_b/n - and the difference is noisier than adding their
   errors as if they were independent would suggest. Treating them as independent let a fifth of
   all hands past the guard and back onto player. */
/* Three sigma, not two. A two-sigma gate is wrong here by its own definition: it lets a false
   positive through one time in twenty, and one time in twenty a full shoe - where the composition
   has moved nothing at all - would be reported to the player as a shoe that separated the two
   sides. On a feature whose whole purpose is to not manufacture a signal, a one-in-twenty
   manufactured signal is the defect. Three sigma puts that at about one in three hundred, and
   costs only the marginal late-shoe readings that were never worth acting on anyway. */
const NOISE_SIGMA = 3;
function evDifferenceNoise(p, trials){
  if (!trials) return Infinity;
  const a = 2, b = 1.95;               // the two coefficients above
  const v = (a*a*p.player*(1-p.player) + b*b*p.banker*(1-p.banker) + 2*a*b*p.player*p.banker) / trials;
  return NOISE_SIGMA*Math.sqrt(Math.max(v, 0));
}
function recommend(p, opts){
  const trials = (opts && opts.trials) || (p && p.trials) || COMPOSITION_TRIALS;
  const ev = expectedValues(p);
  const noise = evDifferenceNoise(p, trials);
  const side = (ev.player - ev.banker) > noise ? 'player' : 'banker';
  const edge = ev[side];
  const margin = 2*sampleMargin(p[side], trials);
  let confidence = 'none';
  if (edge > 0 && edge > margin) confidence = edge > 3*margin ? 'high' : 'normal';
  else if (edge > -0.02) confidence = 'low';
  return {
    side, ev, edge, margin, noise, confidence,
    // The honest headline. A negative edge is the normal state of a baccarat hand and saying so
    // is the point: this is the side that loses least, not a side that wins.
    positive: edge > 0 && edge > margin,
    // and whether the shoe was even read finely enough for the comparison to mean anything
    resolved: Math.abs(ev.banker - ev.player) > noise,
  };
}

/* One call for a live table: what is left in the shoe, what the roads say, and the answer. */
function predictNextHand(shoe, history, opts){
  const o = opts || {};
  const counts = remainingValueCounts(shoe, o.decks);
  const comp = compositionModel(counts, {trials: o.trials, rnd: o.rnd});
  const dealt = countsTotal(shoeValueCounts(o.decks || 8)) - countsTotal(counts);
  const progress = dealt / countsTotal(shoeValueCounts(o.decks || 8));
  let patternP = 0.5068;
  if (o.patternModel) patternP = o.patternModel.predict(patternFeatureVector(history, progress));
  const p = blendPredictions(comp, patternP, o.patternWeight);
  return {...p, comp, patternP, progress, cardsLeft: countsTotal(counts),
          rec: p.ok ? recommend({...p, trials: comp.trials}) : null};
}

/* exported for node (the backtest) without disturbing the browser, which loads this as a plain
   script and reads the names off the global */
if (typeof module !== 'undefined' && module.exports){
  module.exports = {
    emptyValueCounts, shoeValueCounts, remainingValueCounts, countsTotal,
    compositionModel, playTableauValues, sampleMargin, evDifferenceNoise,
    PATTERN_FEATURES, patternFeatureVector, makePatternModel,
    blendPredictions, expectedValues, recommend, predictNextHand,
    BANKER_COMMISSION, COMPOSITION_TRIALS, DEFAULT_PATTERN_WEIGHT,
  };
}
