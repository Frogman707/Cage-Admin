/* ============================================================
   CAGE ADMIN 5.0 — shared runtime helpers
   Firebase bootstrap + small UI/data utilities reused by
   /partner-admin, /avatar, /speed. No framework, no bundler —
   matches the rest of this repo (plain script, Firebase compat SDK).
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCOZl9qjgYnVPFTZMwGXyVKtRvJv3N0_cw",
  authDomain: "cage-admin-25bbf.firebaseapp.com",
  projectId: "cage-admin-25bbf",
  storageBucket: "cage-admin-25bbf.firebasestorage.app",
  messagingSenderId: "894377496526",
  appId: "1:894377496526:web:01b205e540c64dace8e59f",
  measurementId: "G-4P1TM5RGRP"
};

let cageDb = null;
function cageInitFirebase(){
  if (cageDb) return cageDb;
  firebase.initializeApp(FIREBASE_CONFIG);
  cageDb = firebase.firestore();
  cageDb.settings({experimentalForceLongPolling:true});
  cageDb.enablePersistence({synchronizeTabs:true}).catch(()=>{});
  return cageDb;
}

function uuidv4(){
  return crypto.randomUUID();
}

// Stable per-browser identifier for audit trails on money-relevant writes (see
// shared/game-engine.js) - not a security boundary, just lets a later investigation tell "same
// device, different sessions" apart from "different devices" when a client's wall clock (or the
// createdAt it wrote) turns out to have been wrong.
function getDeviceId(){
  let id = localStorage.getItem('cage-device-id');
  if (!id){
    id = crypto.randomUUID();
    localStorage.setItem('cage-device-id', id);
  }
  return id;
}

function fmtNum(n){
  n = Number(n)||0;
  return n.toLocaleString('en-US', {maximumFractionDigits:2});
}
function fmtSigned(n){
  n = Number(n)||0;
  return (n>0?'+':'') + fmtNum(n);
}
function fmtDt(d){
  if (!d) return '—';
  if (d.toDate) d = d.toDate();
  if (typeof d === 'string') d = new Date(d);
  if (!(d instanceof Date) || isNaN(d)) return '—';
  const p = x => String(x).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(d){
  if (!d) return '—';
  if (d.toDate) d = d.toDate();
  if (typeof d === 'string') d = new Date(d);
  if (!(d instanceof Date) || isNaN(d)) return '—';
  const p = x => String(x).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function maskPhone(p){
  if (!p) return '—';
  const s = String(p).replace(/[^0-9]/g,'');
  if (s.length < 7) return p;
  return `**-****-${s.slice(-4)}`;
}
/* Separators appear as the amount is typed. Rewriting the value moves the caret to the end, which
   on a field being corrected in the middle sends the cursor away mid-keystroke - so the caret is
   put back the same distance from the end it was, which is where it belongs whether or not a
   comma has just appeared to its left. */
function formatNumInput(el){
  const fromEnd = el.value.length - (el.selectionStart ?? el.value.length);
  const v = el.value.replace(/[^0-9]/g,'');
  el.value = v ? Number(v).toLocaleString('en-US') : '';
  const pos = Math.max(0, el.value.length - fromEnd);
  try { el.setSelectionRange(pos, pos); } catch (e) { /* not a field with a caret */ }
}
function rawNum(v){ return Number(String(v||'').replace(/[^0-9.-]/g,'')) || 0; }

function toast(msg, isErr){
  let t = document.getElementById('cageToast');
  if (!t){
    t = document.createElement('div');
    t.id = 'cageToast';
    t.className = 'toast';
    t.setAttribute('data-fs-follow', '');
  }
  /* A toast is only drawn over the page it is in. On a table that page is the table itself, so
     the toast goes in there - left on the body it fired invisibly behind it. The table screen is
     held over the page by the app rather than by the browser, so asking for document
     .fullscreenElement alone missed every table that had not also been given the browser's own
     fullscreen - which is all of them. fsFollowHost() is the app's answer to the same question;
     the admin screens have no such thing, and fall back to the page. */
  const host = (typeof fsFollowHost === 'function' ? fsFollowHost() : null)
            || document.fullscreenElement || document.body;
  if (t.parentElement !== host) host.appendChild(t);
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(()=>t.classList.remove('show'), 2200);
}

function openModal(id){ const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id){ const m = document.getElementById(id); if (m) m.classList.remove('open'); }
document.addEventListener('click', e=>{
  if (e.target.classList && e.target.classList.contains('modal-bg')) e.target.classList.remove('open');
});

/* ---- tiny dependency-free SVG donut chart ---- */
function svgDonutChart(el, segments, opts={}){
  const size = opts.size || 180, r = size*0.36, cx = size/2, cy = size/2, sw = opts.strokeWidth || r*0.55;
  const total = segments.reduce((s,x)=>s+x.value,0);
  if (!total){ el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"/></svg>`; return; }
  const circ = 2*Math.PI*r;
  let offset = 0, arcs = '', labelEls = '';
  segments.forEach(seg=>{
    const frac = seg.value/total;
    const len = frac*circ;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(circ-len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    const midAngle = (offset + len/2)/circ * 2*Math.PI - Math.PI/2;
    const lx = cx + Math.cos(midAngle)*(r);
    const ly = cy + Math.sin(midAngle)*(r);
    if (frac > 0.03) labelEls += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="10.5" fill="#fff" text-anchor="middle" dominant-baseline="middle" style="paint-order:stroke;stroke:#000;stroke-width:2.5px;">${seg.label} : ${(frac*100).toFixed(1)}%</text>`;
    offset += len;
  });
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="${size}">${arcs}${labelEls}</svg>`;
}

/* ---- tiny dependency-free SVG bar/line chart ---- */
function svgBarChart(el, labels, series, opts={}){
  const w = el.clientWidth || 560, h = opts.height || 200, pad = 28;
  const max = Math.max(1, ...series.flatMap(s=>s.data));
  const bw = (w - pad*2) / labels.length;
  let bars = '';
  labels.forEach((lb,i)=>{
    const groupW = bw*0.62/series.length;
    series.forEach((s,si)=>{
      const val = s.data[i]||0;
      const barH = (val/max) * (h - pad*2);
      const x = pad + i*bw + bw*0.19 + si*groupW;
      const y = h - pad - barH;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(groupW-2).toFixed(1)}" height="${barH.toFixed(1)}" fill="${s.color}" rx="2"/>`;
    });
  });
  let xlabels = '';
  const barStride = labelStride(labels, w - pad*2);
  labels.forEach((lb,i)=>{
    if (i % barStride) return;
    const x = pad + i*bw + bw/2;
    xlabels += `<text x="${x.toFixed(1)}" y="${h-8}" font-size="9.5" fill="var(--ink-faint)" text-anchor="middle">${lb}</text>`;
  });
  const gridY = [0,.25,.5,.75,1].map(f=>{
    const y = h - pad - f*(h-pad*2);
    return `<line x1="${pad}" y1="${y.toFixed(1)}" x2="${w-8}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="overflow:visible;">${gridY}${bars}${xlabels}</svg>`;
}
/* How many of these labels will actually fit across the axis without running into each other. A
   sixteen-day axis is legible on a desktop card and a smear of digits on a phone, so the stride is
   worked out from the width actually in front of it rather than fixed. */
function labelStride(labels, plotWidth){
  const longest = labels.reduce((m,l)=>Math.max(m, String(l).length), 0);
  const per = longest * 6.2 + 12;          // 9.5px type is about 6.2px a character, plus a gap
  const fits = Math.max(1, Math.floor(plotWidth / per));
  return Math.max(1, Math.ceil(labels.length / fits));
}
function svgLineChart(el, labels, series, opts={}){
  const w = el.clientWidth || 560, h = opts.height || 200, pad = 28;
  const max = Math.max(1, ...series.flatMap(s=>s.data));
  const stepX = (w - pad*2) / Math.max(1,labels.length-1);
  let paths = '';
  series.forEach(s=>{
    const pts = s.data.map((v,i)=>{
      const x = pad + i*stepX;
      const y = h - pad - (v/max)*(h-pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    paths += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  const gridY = [0,.25,.5,.75,1].map(f=>{
    const y = h - pad - f*(h-pad*2);
    return `<line x1="${pad}" y1="${y.toFixed(1)}" x2="${w-8}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  }).join('');
  let xlabels = '';
  const lineStride = labelStride(labels, w - pad*2);
  labels.forEach((lb,i)=>{
    if (i % lineStride) return;
    const x = pad + i*stepX;
    xlabels += `<text x="${x.toFixed(1)}" y="${h-8}" font-size="9.5" fill="var(--ink-faint)" text-anchor="middle">${lb}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="overflow:visible;">${gridY}${paths}${xlabels}</svg>`;
}

/* ---- generic aggregate helper (client-side sum, Spark-plan friendly for small collections;
   swap for getAggregateFromServer when a collection grows past a few thousand docs) ---- */
async function sumWhere(db, coll, wheres, field){
  let q = db.collection(coll);
  wheres.forEach(([f,op,v])=> q = q.where(f,op,v));
  const snap = await q.get();
  let sum = 0;
  snap.forEach(d=> sum += Number(d.data()[field])||0);
  return sum;
}

function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   one balance rule, for every site that shows a balance
   ============================================================
   A member opened at a cage keeps its money in the cage's own book - `ledger`, one row per
   movement carrying accountId/inn/out - and NOT in memberLedger. memberLedger is still written
   for it: it is the record of play the partner admin reports on, and where its points live. But
   the running total there is not its balance, and summing it is what left the two admin panels
   showing a number the cage, the player's own screen and each other all disagreed with.
   A member who was never opened at a cage - a demo account, an online signup - has no cage book,
   so memberLedger is the only one it has and its balance is the sum of it.
   This is the same rule shared/game-engine.js getPlayerBalance() reads the player's own balance
   by, stated once so no screen can drift from another. */
function isCageAccountMember(m){ return !!m && m.source === 'cage'; }
/* memberLedgerRows: every row of memberLedger. cageLedgerRows: every row of `ledger`.
   members: the member docs, needed only to say which ids are cage accounts.
   Returns {[memberId]: {balance, points, deposit, withdraw, bet, payout}}.
   The four tallies beside the balance stay memberLedger's throughout - they are the record of
   what was played through the site, which is the same book for both kinds of member. */
/* Which ids are cage accounts is asked of TWO sources, not one. The `members` projection says so,
   and so does the cage book itself: a row in `ledger` carries an accountId, and money in the cage
   book only ever belongs to a cage account. Reading only the projection made the answer depend on
   a record kept somewhere else - and when it was missing, or had lost its source:'cage', the
   account fell through to the wrong book.
   That is not a cosmetic slip. A cage account's DEPOSITS live in the cage book; only its bets and
   payouts are written to memberLedger, as the record of play. So summing memberLedger for one
   gives its cumulative net loss and nothing else - a negative number, reported as a balance. An
   account down 1,935,937 on the day showed exactly that, while its actual money sat in `ledger`.
   The book is the thing that cannot be stale, so the book gets a vote. */
function cageAccountIds(members, cageLedgerRows){
  const ids = new Set((members||[]).filter(isCageAccountMember).map(m=>m.id));
  (cageLedgerRows||[]).forEach(r=>{ if (r && r.accountId) ids.add(r.accountId); });
  return ids;
}
function accountBalanceMap(memberLedgerRows, cageLedgerRows, members){
  const cageIds = cageAccountIds(members, cageLedgerRows);
  const map = {};
  const at = id => map[id] || (map[id] = {balance:0, points:0, deposit:0, withdraw:0, bet:0, payout:0});
  (memberLedgerRows||[]).forEach(r=>{
    const m = at(r.memberId);
    const amt = Number(r.amount)||0;
    if (r.category==='point_earn' || r.category==='point_convert') m.points += amt;
    else if (!cageIds.has(r.memberId)) m.balance += amt;
    if (r.category==='deposit') m.deposit += amt;
    if (r.category==='withdraw') m.withdraw += amt;
    if (r.category==='bet') m.bet += amt;
    if (r.category==='payout') m.payout += amt;
  });
  // A cage account's balance is its cage book, summed across every branch it holds money at -
  // which is what the cage's own account list totals (accountTotalBalance in index.html).
  // Only for ids this site actually has a member for: the cage book also holds each branch's own
  // MAIN account and anyone the cage knows who was never rolled out to here, and a balance for an
  // id with no member behind it is a phantom - it was never asked for and nothing can show it.
  const memberIds = new Set((members||[]).map(m=>m.id));
  (cageLedgerRows||[]).forEach(r=>{
    if (!cageIds.has(r.accountId)) return;
    if (members && !memberIds.has(r.accountId)) return;
    at(r.accountId).balance += (Number(r.inn)||0) - (Number(r.out)||0);
  });
  return map;
}

/* Appends one movement to the cage's own book. Any screen that moves a cage account's money has
   to write here, because this is where that money is - a memberLedger row alone is a record of a
   transfer that never happened. The book is append-only and the balance is derived from it, which
   is what lets the cage, the two admin panels and the player's own screen all agree. */
function cageLedgerWrite(db, {accountId, casino, type, amount, memo, staff}){
  const value = Math.abs(Number(amount) || 0);
  if (!value) return Promise.resolve();
  const id = 'ldg_' + Date.now() + '_' + Math.random().toString(36).slice(2,9);
  return db.collection('ledger').doc(id).set({
    id, accountId, casino: casino || 'HANN',
    dt: new Date().toISOString().slice(0,16).replace('T',' '),
    type, inn: type === 'IN' ? value : 0, out: type === 'OUT' ? value : 0,
    staff: staff || 'system', memo: memo || '',
  });
}

/* ---- live sync: a balance moves at the cage or at the table, not on this screen ----
   Watches the collections a screen is drawn from and calls back when any of them changes
   elsewhere. The first callback on each collection is its initial load, not a change, so it is
   swallowed; the rest are collapsed into one call per quiet moment, since a settlement writes
   several rows at once and each would otherwise be a repaint of its own.
   Returns the unsubscribe. */
function watchCollections(db, colls, onChange, quietMs){
  const unsubs = [], seeded = new Set(), pending = new Set();
  let timer = null;
  colls.forEach(coll=>{
    // A collection that cannot be watched is one this screen stops following on its own; it is
    // never a reason to fail the call, which is made on the way in to the panel.
    try{
      unsubs.push(db.collection(coll).onSnapshot(()=>{
        if (!seeded.has(coll)){ seeded.add(coll); return; }
        pending.add(coll);
        clearTimeout(timer);
        timer = setTimeout(()=>{
          const changed = new Set(pending); pending.clear();
          try{ onChange(changed); }catch(e){ console.error('watchCollections onChange failed:', e); }
        }, quietMs || 250);
      }, err=>console.error(`watchCollections(${coll}) failed:`, err)));
    }catch(e){ console.error(`watchCollections(${coll}) could not subscribe:`, e); }
  });
  return ()=>{ clearTimeout(timer); unsubs.forEach(u=>{ try{ u(); }catch(e){} }); };
}

/* Repaints every balance already on the screen without redrawing it. A cell that shows a balance
   is marked `data-bal="<memberId>"` and a cell that shows a sum of several is
   `data-bal-sum="id,id,..."`; both are rewritten in place, so a search box keeps its text, a list
   keeps its scroll and an open form is not disturbed by money moving underneath it. */
function repaintBalances(balances, root){
  (root||document).querySelectorAll('[data-bal]').forEach(el=>{
    const b = (balances[el.getAttribute('data-bal')]||{}).balance || 0;
    el.textContent = fmtNum(b);
    el.classList.toggle('neg', b<0);
    el.classList.toggle('pos', b>0);
  });
  (root||document).querySelectorAll('[data-bal-sum]').forEach(el=>{
    const ids = el.getAttribute('data-bal-sum').split(',').filter(Boolean);
    el.textContent = fmtNum(ids.reduce((s,id)=>s + ((balances[id]||{}).balance||0), 0));
  });
}

/* True while the screen is somebody's to finish with: a form is open, or the caret is in a field.
   A live redraw waits for both rather than pulling the page out from under them. */
function uiIsBusy(){
  if (document.querySelector('.modal-bg.open')) return true;
  const a = document.activeElement;
  return !!a && ['INPUT','TEXTAREA','SELECT'].includes(a.tagName);
}
