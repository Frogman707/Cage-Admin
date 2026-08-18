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
function formatNumInput(el){
  let v = el.value.replace(/[^0-9]/g,'');
  el.value = v ? Number(v).toLocaleString('en-US') : '';
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
  /* A toast is only drawn over the page it is in. On a fullscreen table that page is the table
     itself, so the toast goes in there - left on the body it fired invisibly behind it. */
  const host = document.fullscreenElement || document.body;
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
  labels.forEach((lb,i)=>{
    const x = pad + i*bw + bw/2;
    xlabels += `<text x="${x.toFixed(1)}" y="${h-8}" font-size="9.5" fill="var(--ink-faint)" text-anchor="middle">${lb}</text>`;
  });
  const gridY = [0,.25,.5,.75,1].map(f=>{
    const y = h - pad - f*(h-pad*2);
    return `<line x1="${pad}" y1="${y.toFixed(1)}" x2="${w-8}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="overflow:visible;">${gridY}${bars}${xlabels}</svg>`;
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
  labels.forEach((lb,i)=>{
    if (labels.length>10 && i%Math.ceil(labels.length/8)!==0) return;
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

/* ---- memberLedger + balanceTotals dual-write (docs/BALANCE_ARCHITECTURE_DESIGN.md) ----
   Every memberLedger write (deposit/withdraw/bet/payout/point_earn/point_convert/correction/
   avatar_tip/dealer_tip/...) also applies FieldValue.increment() to the matching
   balanceTotals/member_{memberId} doc, in the same batch, so the two can never drift apart from
   each other - a partial failure leaves neither written rather than one without the other.
   This is the dual-write phase only: getPlayerBalance()/getBalances() still derive the balance
   shown to staff/players from a full memberLedger sum, same as before. Nothing reads or trusts
   balanceTotals yet - it exists purely so a future cutover (once verified against the derived sum
   over the shadow-read period described in the design doc) has a maintained number ready to use.
   Centralized here (one function, not one inline .set() per call site) specifically so a future
   write site can't forget the increment the way the design doc calls out as mechanism (b)'s risk. */
const MEMBER_LEDGER_POINT_CATEGORIES = ['point_earn', 'point_convert'];
async function writeMemberLedgerEntry(db, entry){
  const ledgerRef = db.collection('memberLedger').doc(uuidv4());
  const balRef = db.collection('balanceTotals').doc('member_' + entry.memberId);
  const field = MEMBER_LEDGER_POINT_CATEGORIES.includes(entry.category) ? 'points' : 'balance';
  const batch = db.batch();
  batch.set(ledgerRef, entry);
  batch.set(balRef, {[field]: firebase.firestore.FieldValue.increment(Number(entry.amount)||0)}, {merge:true});
  await batch.commit();
  return ledgerRef.id;
}
