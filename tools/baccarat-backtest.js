#!/usr/bin/env node
/* ============================================================
   Walk-forward backtest for shared/baccarat-ai.js
     node tools/baccarat-backtest.js [--shoes 2000] [--trials 3000] [--seed 1]

   This is the part of the project that decides whether the rest of it is worth building. It
   answers, in order, the two questions the brief puts first:

     1. Is there a statistical signal in past baccarat that says anything about the next hand?
     2. If there is, does it survive the payout and banker's commission?

   How it is kept honest
     - Time order, never a random split. Every hand is predicted from what was known before it
       and the model only learns it afterwards, hand by hand, shoe by shoe. There is no epoch and
       no shuffle, so there is nothing for a future hand to leak backwards through.
     - The shoe the model reads is the shoe as the players see it: cards already dealt are gone,
       the ones still in it are unknown. Nothing reads past `pos`.
     - Three datasets, the same model on each (the brief's section 13). A shuffled simulator is
       the control: any model that beats chance THERE is broken, and that is the first thing
       printed.
     - Flat stakes throughout. One unit a hand, no progression - which is what separates the
       model's own performance from a staking system's.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// game-engine.js is a browser script; run it in a context and take what is needed off it
const ctx = { console, Math, Date, Number, String, Array, Object, JSON, isNaN, parseInt, parseFloat };
vm.createContext(ctx);
const root = path.join(__dirname, '..');
vm.runInContext(fs.readFileSync(path.join(root, 'shared/game-engine.js'), 'utf8')
  + ';this.__consts = {SHOE_DECKS, MAX_CARDS_PER_ROUND};', ctx);
// a top-level `const` does not land on the sandbox's global, so the constants are handed out
// explicitly from inside the same script - without this BANKER_COMMISSION reads undefined and
// every profit in the report comes out NaN
vm.runInContext(fs.readFileSync(path.join(root, 'shared/baccarat-ai.js'), 'utf8')
  + ';this.__ai = {BANKER_COMMISSION, COMPOSITION_TRIALS};', ctx);
const { openShoe, shoeRemaining, simulateRound } = ctx;
const { remainingValueCounts, compositionModel, countsTotal, shoeValueCounts,
        patternFeatureVector, makePatternModel, blendPredictions, recommend } = ctx;
const { BANKER_COMMISSION } = ctx.__ai;

/* ---- a seeded generator, so a run can be repeated exactly ---- */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--'+name);
  return i > -1 ? Number(process.argv[i+1]) : dflt;
};
const SHOES  = arg('shoes', 500);
const TRIALS = arg('trials', 3000);
const SEED   = arg('seed', 1);

/* ---- the three datasets (section 13) ----
   A and C are the same generator here, and that is not a shortcut being hidden: this site's
   rounds ARE simulated from a Fisher-Yates 8-deck shoe, so its "real results" and a random
   simulator are the same distribution. Fed real recorded shoes from a live table, dataset A
   would be those and the comparison would mean more. The column is kept so that swap is a
   one-line change rather than a rewrite. */
function* shuffledShoes(count, rnd){
  for (let i = 0; i < count; i++){
    // openShoe uses Math.random; swap it for the seeded one for the length of the call
    const real = Math.random; Math.random = rnd; ctx.Math.random = rnd;
    const shoe = openShoe(i+1);
    Math.random = real; ctx.Math.random = real;
    yield shoe;
  }
}

/* ---- the runs ---- */
function runModel(label, shoeSource, cfg){
  const model = makePatternModel();
  const stat = {
    label, hands:0, bets:0, wins:0, losses:0, pushes:0,
    profit:0, correct:0, brier:0, logloss:0, scored:0,
    bySide:{banker:{bet:0,win:0,decided:0}, player:{bet:0,win:0,decided:0}},
    byThird:[{n:0,c:0},{n:0,c:0},{n:0,c:0}],       // shoe opening / middle / end
    positiveEdge:0, positiveEdgeWins:0, positiveEdgeProfit:0,
    equity:[], maxDrawdown:0, worstLossRun:0,
  };
  let peak = 0, run = 0;
  const full = countsTotal(shoeValueCounts(8));

  for (const shoe of shoeSource){
    const history = [];
    while (shoeRemaining(shoe) >= 6){
      /* ---- everything below the model is allowed to see, and nothing more ---- */
      const counts = remainingValueCounts(shoe, 8);
      const progress = (full - countsTotal(counts)) / full;
      const comp = compositionModel(counts, {trials: cfg.trials, rnd: cfg.rnd});
      if (!comp.ok) break;
      const x = patternFeatureVector(history, progress);
      const patternP = model.predict(x);
      const p = blendPredictions(comp, patternP, cfg.patternWeight);
      const rec = recommend({...p, trials: comp.trials});

      /* ---- and now the hand actually happens ---- */
      const sim = simulateRound(shoe);
      const actual = sim.result;
      history.push(actual);
      stat.hands++;

      // scoring the probability itself, on decided hands (the model speaks about P vs B)
      if (actual !== 'tie'){
        const decided = p.player + p.banker;
        const pb = decided > 0 ? p.banker/decided : 0.5;
        const y = actual === 'banker' ? 1 : 0;
        stat.brier += (pb - y)**2;
        stat.logloss += -(y*Math.log(Math.max(pb,1e-9)) + (1-y)*Math.log(Math.max(1-pb,1e-9)));
        stat.scored++;
        if ((pb >= 0.5) === (y === 1)) stat.correct++;
        model.learn(x, y === 1);            // learns only after it has been scored
      }

      /* ---- flat stake, one unit, every hand (section 9) ---- */
      stat.bets++;
      stat.bySide[rec.side].bet++;
      let pnl;
      if (actual === 'tie') { pnl = 0; stat.pushes++; }
      else if (stat.bySide[rec.side].decided++, actual === rec.side){
        pnl = rec.side === 'banker' ? (1 - BANKER_COMMISSION) : 1;
        stat.wins++; stat.bySide[rec.side].win++;
      } else { pnl = -1; stat.losses++; }
      stat.profit += pnl;

      if (rec.positive){
        stat.positiveEdge++;
        stat.positiveEdgeProfit += pnl;
        if (actual === rec.side) stat.positiveEdgeWins++;
      }
      const third = progress < 1/3 ? 0 : progress < 2/3 ? 1 : 2;
      if (actual !== 'tie'){
        stat.byThird[third].n++;
        if (actual === rec.side) stat.byThird[third].c++;
      }

      peak = Math.max(peak, stat.profit);
      stat.maxDrawdown = Math.max(stat.maxDrawdown, peak - stat.profit);
      run = pnl < 0 ? run + 1 : 0;
      stat.worstLossRun = Math.max(stat.worstLossRun, run);
      if (stat.bets % 500 === 0) stat.equity.push(Math.round(stat.profit));
    }
  }
  return stat;
}

/* ---- the baselines the brief asks for first (section 6, stage 1) ---- */
function runBaseline(label, side, shoeSource){
  const stat = {label, bets:0, wins:0, losses:0, pushes:0, profit:0};
  for (const shoe of shoeSource){
    while (shoeRemaining(shoe) >= 6){
      const pick = side === 'random' ? (Math.random() < 0.5 ? 'banker' : 'player') : side;
      const actual = simulateRound(shoe).result;
      stat.bets++;
      if (actual === 'tie'){ stat.pushes++; continue; }
      if (actual === pick){ stat.wins++; stat.profit += pick === 'banker' ? 1-BANKER_COMMISSION : 1; }
      else { stat.losses++; stat.profit -= 1; }
    }
  }
  return stat;
}

const pct = (a,b) => b ? (a/b*100).toFixed(2)+'%' : '—';
function report(s){
  const decided = s.wins + s.losses;
  console.log(`\n── ${s.label} ${'─'.repeat(Math.max(0, 52-s.label.length))}`);
  console.log(`   hands ${s.hands ?? s.bets}   bets ${s.bets}   win ${s.wins}  lose ${s.losses}  push ${s.pushes}`);
  console.log(`   hit rate (decided hands)   ${pct(s.wins, decided)}`);
  if (s.scored){
    console.log(`   accuracy on P/B            ${pct(s.correct, s.scored)}`);
    console.log(`   Brier                      ${(s.brier/s.scored).toFixed(5)}   (0.25 = no information)`);
    console.log(`   log loss                   ${(s.logloss/s.scored).toFixed(5)}   (0.6931 = no information)`);
  }
  console.log(`   profit                     ${s.profit.toFixed(2)} units`);
  console.log(`   ROI per unit staked        ${s.bets ? (s.profit/s.bets*100).toFixed(3)+'%' : '—'}`);
  if (s.maxDrawdown !== undefined){
    console.log(`   max drawdown               ${s.maxDrawdown.toFixed(2)} units`);
    console.log(`   worst losing run           ${s.worstLossRun}`);
  }
  if (s.bySide){
    console.log(`   called banker ${s.bySide.banker.bet} (${pct(s.bySide.banker.win, s.bySide.banker.decided)} hit)` +
                `   player ${s.bySide.player.bet} (${pct(s.bySide.player.win, s.bySide.player.decided)} hit)`);
  }
  if (s.byThird){
    const [a,b,c] = s.byThird;
    console.log(`   by shoe   opening ${pct(a.c,a.n)}   middle ${pct(b.c,b.n)}   end ${pct(c.c,c.n)}`);
  }
  if (s.positiveEdge !== undefined){
    console.log(`   hands the model called a real edge on: ${s.positiveEdge}` +
      (s.positiveEdge ? `  (${pct(s.positiveEdgeWins, s.positiveEdge)} hit, ${s.positiveEdgeProfit.toFixed(2)} units)` : ''));
  }
}

/* ---- go / no-go (section 22), stated against the hit rate on decided hands ---- */
function verdict(s){
  const decided = s.wins + s.losses;
  const rate = decided ? s.wins/decided : 0;
  const roi = s.bets ? s.profit/s.bets : 0;
  // one standard error on the hit rate, so a verdict is not read off noise
  const se = Math.sqrt(0.25/Math.max(decided,1));
  console.log(`\n${'═'.repeat(60)}\nGO / NO-GO`);
  console.log(`   hit rate ${(rate*100).toFixed(2)}% ± ${(se*196).toFixed(2)}% (95%)   on ${decided} decided hands`);
  console.log(`   ROI ${(roi*100).toFixed(3)}% per unit staked`);
  const edgeOverChance = (rate - 0.5)/se;
  console.log(`   distance from chance: ${edgeOverChance.toFixed(2)} standard errors`);
  let call;
  if (roi > 0 && rate - 2*se > 0.53) call = 'ABOVE 53% AND PROFITABLE — worth a hard look at commercial viability, but only after this repeats on out-of-sample data from a different source';
  else if (rate - 2*se > 0.51) call = 'ABOVE 51% — needs substantial further verification on data this model has never seen';
  else if (rate - 2*se > 0.50) call = '50-51% — further research, not a product';
  else call = 'INDISTINGUISHABLE FROM CHANCE — on this data there is no signal to build on. Per the brief: stop.';
  console.log(`   → ${call}`);
  if (roi <= 0){
    console.log(`\n   Note the two numbers are not the same question. Even a hit rate above chance can`);
    console.log(`   lose money: banker pays 0.95 and player pays 1.00, so a flat-staked hand is worth`);
    console.log(`   about -1.06% on banker and -1.24% on player before any model opens its mouth. The`);
    console.log(`   model has to beat the commission, not the coin.`);
  }
  console.log('═'.repeat(60));
}

/* ---------------- run ---------------- */
console.log(`baccarat backtest — ${SHOES} shoes, ${TRIALS} composition trials a hand, seed ${SEED}`);
console.log('walk-forward: every hand is predicted before it is dealt and learned from only after.\n');

console.log('STAGE 1 — the baselines everything else has to beat (section 6)');
report({...runBaseline('always banker', 'banker', shuffledShoes(SHOES, mulberry32(SEED))), hands:undefined});
report({...runBaseline('always player', 'player', shuffledShoes(SHOES, mulberry32(SEED))), hands:undefined});
report({...runBaseline('coin flip', 'random', shuffledShoes(SHOES, mulberry32(SEED))), hands:undefined});

console.log('\n\nSTAGE 2 — the control: a shuffled simulator, where there is nothing to find (section 13C)');
console.log('Anything above chance here is a bug in the model or a leak in this harness, not an edge.');
const control = runModel('composition model, shuffled shoes', shuffledShoes(SHOES, mulberry32(SEED+7)),
  {trials: TRIALS, rnd: mulberry32(SEED+99), patternWeight: 0});
report(control);

console.log('\n\nSTAGE 3 — the pattern model on the same shuffled shoes (section 13A)');
console.log('Trained walk-forward on the roads alone. Its own weights are printed: on shuffled');
console.log('data they should sit near zero, because there is nothing for them to hold on to.');
const pattern = runModel('pattern model (roads), shuffled shoes', shuffledShoes(SHOES, mulberry32(SEED+7)),
  {trials: 200, rnd: mulberry32(SEED+99), patternWeight: 1});
report(pattern);

verdict(control);

console.log('\nWhat this run does NOT establish: anything about a real casino\'s shoes. This site deals');
console.log('from a Fisher-Yates shuffle, so its recorded rounds and the control above are the same');
console.log('distribution. Point dataset A at real recorded shoes and re-run before drawing any');
console.log('conclusion about a live table.');
