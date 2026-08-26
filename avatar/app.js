/* ============================================================
   Game site (Avatar + Speed, integrated) — CAGE ADMIN 5.0
   One login/session/balance shared across both game modes.
   Avatar = proxy/대리 betting: a member requests a dedicated
   avatar (staff, approved in Partner Admin) who places bets on
   their behalf each round per a saved instruction, tipped
   separately for avatar/dealer. Speed = several tables running
   simultaneously with a faster round cadence, self-service.
   Both persist every round/bet/payout/tip to Firestore via the
   shared engine in /shared/game-engine.js. UI text is driven by
   /shared/i18n.js (ko/zh/en/ja/vi).
   ============================================================ */

let db = null;
let MODE = null; // 'avatar' | 'speed' | null (picker)
const AVATAR_BETTING_SECONDS = 30, AVATAR_DEALING_SECONDS = 4, AVATAR_RESULT_SECONDS = 5;
const SPEED_BETTING_SECONDS = 30, SPEED_DEALING_SECONDS = 3, SPEED_RESULT_SECONDS = 3;

function betLabel(type){ return t(type); } // BET_LABEL keys (player/banker/tie/playerPair/bankerPair) match i18n dict keys 1:1
/* What a round did to the player's money, said the same way at either kind of table.
   Only the winning rounds used to be called, on `payout > 0` - so a round that took the stake and
   gave nothing back passed in silence, and a 플레이어/뱅커 bet meeting a tie was announced as a
   win, because the stake handed back is a payout. Both are now named for what they are.
   The figure is the net either way: what the round gained or cost, not the gross returned, so the
   three readings are the same measure and can be compared to one another.
   Called only for a round the player staked on - a round they sat out has nothing to say about
   their money, and a toast every round would be noise over the next bet. */
function roundOutcomeText(staked, payout){
  const net = payout - staked;
  if (net > 0) return t('wonAmount', {amount: fmtNum(net)});
  if (net < 0) return t('lostAmount', {amount: fmtNum(-net)});
  return t('pushedAmount', {amount: fmtNum(staked)});
}
let MY_BET_LOG = []; // {tableName, roundNo, betType, amount, payout, mode, dt} newest first, shared across both modes

let STATE = { balance: 0, points: 0, selectedChip: CHIP_VALUES[0] };

/* ---------------- boot / auth ---------------- */
/* A page the browser kept and a script the server just sent are not the same app. Hosting says
   no-store on the HTML, but that header only reaches a fetch: a phone that reopens a tab restores
   the shell it had, and the scripts inside it are then pulled fresh - so yesterday's markup runs
   today's code. It shows: the picker page was left standing with its captions reading as bare
   i18n keys, and its two cards led nowhere because the view they now open is not in that shell.
   Every build is built around #viewLobby, so its absence is the shell being old. Reload once, off
   the network; the flag is what stops that becoming a loop if the reload comes back the same. */
const STALE_FLAG = 'avatarSpeed.staleReload';
function shellMatchesBuild(){
  if (document.getElementById('viewLobby')){
    try{ sessionStorage.removeItem(STALE_FLAG); }catch(e){ /* storage refused; nothing to clear */ }
    return true;
  }
  let tried = false;
  try{ tried = sessionStorage.getItem(STALE_FLAG) === '1'; }catch(e){ /* no storage: one reload, then on */ }
  // reloaded once and it came back the same: say so, rather than leaving a page that does nothing
  if (tried){ showStaleShellNotice(); return false; }
  try{ sessionStorage.setItem(STALE_FLAG, '1'); }catch(e){ /* best effort */ }
  location.reload();
  return false;
}
function showStaleShellNotice(){
  const say = (typeof t === 'function' && t('staleShell')) || '이전 버전 화면입니다. 새로고침해 주세요.';
  const el = document.createElement('div');
  el.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;'
    + 'justify-content:center;flex-direction:column;gap:16px;padding:24px;text-align:center;'
    + 'background:#0a1420;color:#e8e8e8;font-size:15px;line-height:1.6;');
  const p = document.createElement('p'); p.textContent = say; p.style.margin = '0';
  const btn = document.createElement('button');
  btn.textContent = '↻';
  btn.setAttribute('style', 'font-size:22px;width:56px;height:56px;border-radius:50%;cursor:pointer;'
    + 'background:none;border:1.5px solid #d9b26a;color:#d9b26a;');
  btn.onclick = ()=>{ try{ sessionStorage.removeItem(STALE_FLAG); }catch(e){} location.reload(); };
  el.appendChild(p); el.appendChild(btn);
  document.body.appendChild(el);
}
window.addEventListener('DOMContentLoaded', ()=>{
  if (!shellMatchesBuild()) return;
  db = cageInitFirebase();
  document.getElementById('liPw').addEventListener('keydown', e=>{ if (e.key==='Enter') onLogin(); });
  document.getElementById('loginLangRow').innerHTML = langSwitcherHtml('loginLangSwitch');
  clearLoginFields();
  // Browsers autofill saved passwords asynchronously, after the page has already painted -
  // clearing once on load isn't enough since the browser can still fill the field a moment
  // later. Nuke it again shortly after, and once more if the page is restored from bfcache
  // (browser back/forward), which re-applies autofill without re-running DOMContentLoaded.
  setTimeout(clearLoginFields, 350);
});
window.addEventListener('pageshow', clearLoginFields);

function showPane(name){
  document.getElementById('pane-login').style.display = name==='login' ? 'block' : 'none';
  document.getElementById('pane-signup').style.display = name==='signup' ? 'block' : 'none';
}
function clearLoginFields(){
  ['liId','liPw'].forEach(id=>{ const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('liErr').style.display = 'none';
  document.getElementById('suErr').style.display = 'none';
}

async function onLogin(){
  const id = document.getElementById('liId').value.trim();
  const pw = document.getElementById('liPw').value.trim();
  const err = document.getElementById('liErr');
  if (!id || !pw){ err.textContent = t('loginErrRequired'); err.style.display='block'; return; }
  const res = await playerLogin(db, id, pw);
  if (!res.ok){
    err.textContent = res.reason==='notfound' ? t('loginErrNotfound') : res.reason==='blocked' ? t('loginErrBlocked') : res.reason==='duplicate' ? t('loginErrDuplicate') : t('loginErrBadPw');
    err.style.display='block';
    return;
  }
  err.style.display='none';
  enterApp();
}

/* ---------------- signup: ID/PW auto-generation + Telegram + SMS verify ---------------- */
let SIGNUP_CODE = null;
let SIGNUP_VERIFIED = false;
function genSignupId(){
  const id = 'SE' + Math.floor(100000 + Math.random()*900000);
  const pw = Math.random().toString(36).slice(2, 8).toUpperCase();
  document.getElementById('suId').value = id;
  document.getElementById('suPw').value = pw;
}
function sendSignupCode(){
  const phone = document.getElementById('suPhone').value.trim();
  if (!phone){ toast(t('suErrRequired'), true); return; }
  SIGNUP_CODE = String(Math.floor(100000 + Math.random()*900000));
  SIGNUP_VERIFIED = false;
  document.getElementById('suCodeStatus').textContent = t('suCodeSent', {code: SIGNUP_CODE});
  toast(t('suCodeSent', {code: SIGNUP_CODE}));
}
function verifySignupCode(){
  const code = document.getElementById('suCode').value.trim();
  if (SIGNUP_CODE && code === SIGNUP_CODE){
    SIGNUP_VERIFIED = true;
    document.getElementById('suCodeStatus').textContent = '✓ ' + t('suCodeOk');
    toast(t('suCodeOk'));
  } else {
    toast(t('suCodeBad'), true);
  }
}
async function onSignup(){
  const id = document.getElementById('suId').value.trim();
  const pw = document.getElementById('suPw').value.trim();
  const nickname = document.getElementById('suNick').value.trim();
  const telegram = document.getElementById('suTelegram').value.trim();
  const phone = document.getElementById('suPhone').value.trim();
  const casino = document.getElementById('suCasino').value;
  const agentCode = document.getElementById('suAgent').value.trim() || 'DIRECT';
  const err = document.getElementById('suErr');
  if (!id || !pw){ err.textContent = t('suErrGenId'); err.style.display='block'; return; }
  if (!SIGNUP_VERIFIED){ err.textContent = t('suErrVerify'); err.style.display='block'; return; }
  if (!nickname || !telegram){ err.textContent = t('suErrRequired'); err.style.display='block'; return; }
  const res = await playerSignup(db, {id, pw, nickname, telegram, phone, casino, agentCode, smsVerified:true});
  if (!res.ok){ err.textContent = t('suErrDup'); err.style.display='block'; return; }
  err.style.display='none';
  toast(t('suSignupDone'));
  enterApp();
}

function onLogout(){
  stopAllLoops();
  unwatchPlayerBalance();
  playerLogout(db); // clears the active-session marker in the background; UI resets immediately
  MODE = null;
  MY_BET_LOG = [];
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-gate').style.display = 'flex';
  showPane('login');
  clearLoginFields(); // don't leave a previously-typed password sitting in the field
}
async function enterApp(){
  document.getElementById('login-gate').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('hdrLangRow').innerHTML = langSwitcherHtml('hdrLangSwitch');
  document.getElementById('hdrNick').textContent = `${PLAYER.nickname} (${PLAYER.id})`;
  clearLoginFields();
  await refreshBalance();
  watchPlayerBalance();
  // ?mode= still names one of the two, and lights that pill; without it the lobby opens on 전체
  const requestedMode = new URLSearchParams(location.search).get('mode');
  LOBBY_TYPE_FILTER = (requestedMode === 'speed' || requestedMode === 'avatar') ? requestedMode : 'all';
  goLobby();
}
async function refreshBalance(){
  const b = await getPlayerBalance(db, PLAYER.id);
  STATE.balance = b.balance; STATE.points = b.points;
  /* What is shown is what is left to stake, not the raw figure - money already on a spot is spoken
     for even before the round closes and it leaves STATE.balance. This painted the raw balance, so
     any movement on the books mid-round (which is every round: the stake itself is a movement)
     refreshed the header straight back up to the pre-bet figure while the chips were still on the
     felt. paintPlayableBalance is what every other surface repaints through. */
  paintPlayableBalance();
  document.getElementById('hdrPoints').textContent = fmtNum(STATE.points);
}
/* What is actually spendable right now: the stake already on a spot is spoken for even though it
   has not left STATE.balance yet. Which figure that is depends on the mode - avatarCommittedAmount()
   for a session, speedLockedTotal() for the speed tables. Every surface that shows a balance shows
   this one, so a repaint from anywhere - a round settling, a tip, the books moving under the
   player - cannot put the header back up to the pre-bet number while the chips are still down. */
function playableBalance(){
  return STATE.balance - (MODE === 'speed' ? speedLockedTotal() : avatarCommittedAmount());
}
function paintPlayableBalance(){
  const el = document.getElementById('hdrBalance');
  if (el) el.textContent = fmtNum(playableBalance());
  if (MODE === 'speed'){ if (SPEED.detailTableId) paintSpeedFsBars(SPEED.detailTableId); }
  else paintAvatarFsBars();
}
/* The balance is kept live rather than read the once. Money moves from outside this screen -
   the cage pays an account out at the window, an agent transfers to a member - and none of it
   showed here until the player happened to place a bet or signed in again. The rows those
   movements are written to are watched instead, so the header follows the money as it lands.
   Which book to watch is which kind of account this is, the same split getPlayerBalance reads:
   one opened at a cage keeps its money in the cage's own `ledger`, everyone else's is in
   `memberLedger` - and a cage account still earns its points on memberLedger, so it watches
   both. */
let BALANCE_WATCH = [];
function watchPlayerBalance(){
  unwatchPlayerBalance();
  if (!db || !PLAYER) return;
  const onMoved = ()=>{ refreshBalance().catch(()=>{}); };
  const watch = (coll, field) => {
    try{
      const un = db.collection(coll).where(field,'==',PLAYER.id).onSnapshot(onMoved, ()=>{});
      if (typeof un === 'function') BALANCE_WATCH.push(un);
    }catch(e){ /* offline, or a build with no live queries - the balance still refreshes on its own */ }
  };
  watch('memberLedger','memberId');
  if (isCageAccount(PLAYER)) watch('ledger','accountId');
}
function unwatchPlayerBalance(){
  BALANCE_WATCH.forEach(un=>{ try{ un(); }catch(e){} });
  BALANCE_WATCH = [];
}
/* The chip artwork carries its own value on its face, so the tray needs no label of its own.
   This is still here for anywhere a chip's worth is written as text. */
function chipLabel(v){ if (v>=1000000) return (v/1000000)+'M'; if (v>=10000) return (v/10000)+'만'; if (v>=1000) return (v/1000)+'천'; return String(v); }
function selectChip(v){
  STATE.selectedChip = v;
  document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('selected', Number(c.dataset.chip)===v));
}
/* 내 베팅내역 used to be a panel at the foot of the lobby as well as the 게임기록 sheet the clock
   button at the top opens. Two lists of the same rounds, one of them below everything else on the
   page; the sheet is the one that is read, so the panel went and this went with it. MY_BET_LOG
   still feeds the sheet. */
/* ---------------- 즐겨찾기 ----------------
   Both hearts used to do nothing but colour themselves in: the one on a card marked no table, and
   the one in the header filtered nothing. A card's heart names a table now, and the header's
   narrows the lobby to the tables named. They are kept in this browser, under this player's id, so
   one machine's list is not another player's - and a browser that refuses storage (a private
   window, site data blocked) simply keeps them for the session instead of throwing. */
const FAV_KEY = () => `avatarSpeed.favourites.${(PLAYER && PLAYER.id) || 'anon'}`;
let FAVOURITES = null;
let LOBBY_FAVOURITES_ONLY = false;
function favourites(){
  if (FAVOURITES) return FAVOURITES;
  try{ FAVOURITES = new Set(JSON.parse(localStorage.getItem(FAV_KEY()) || '[]')); }
  catch(e){ FAVOURITES = new Set(); }
  return FAVOURITES;
}
function saveFavourites(){
  try{ localStorage.setItem(FAV_KEY(), JSON.stringify([...favourites()])); }catch(e){ /* kept for the session */ }
}
function isFavouriteTable(tableId){ return !!tableId && favourites().has(tableId); }
function toggleCardFavorite(btn, tableId){
  const favs = favourites();
  if (favs.has(tableId)) favs.delete(tableId); else favs.add(tableId);
  saveFavourites();
  btn.classList.toggle('active', favs.has(tableId));
  // showing favourites only, un-hearting a table takes it off the screen there and then
  if (LOBBY_FAVOURITES_ONLY) applyLobbyTileFilter();
}
function toggleHeaderFavorite(){
  LOBBY_FAVOURITES_ONLY = !LOBBY_FAVOURITES_ONLY;
  document.getElementById('favoriteBtn')?.classList.toggle('active', LOBBY_FAVOURITES_ONLY);
  applyLobbyTileFilter();
}
/* ---------------- 전체화면 ----------------
   A table is only ever the fullscreen screen. It used to be two screens - a card on a page with a
   ⛶ on it that swapped the page for the screen the game is actually played on - and the one on
   the page was the poorer of the two everywhere: the still small in a box with the room around it
   spent on the page's own furniture, and the board a flat grid rather than the felt. Nobody who
   found the ⛶ went back. So opening a table is entering that screen:
     - on a desktop the still fills the screen corner to corner and everything else rides over
       its foot as one strip - the counts and the Bead Plate on the left, the betting spots in
       the middle, the roads and the P/B prediction on the right;
     - on a phone there is no room to lay anything over anything, so the same pieces stack down
       the screen with a bar naming the round and the shoe above them and a bar carrying the
       balance below.
   Which of the two you get is the screen's own width. The lobby is still the page it was: it is a
   list of tables, and a list has nothing to gain from covering the screen. */
/* Covering the viewport is the app's own doing rather than the browser's, because the browser's
   cannot be asked for here: element fullscreen needs a gesture to grant it, and there is no
   gesture in "a table was opened" - and Safari on iOS has no element fullscreen at all, only a
   <video> can have it. So the screen is laid out by the .is-fs class and held over the page by a
   fixed box, which every browser has. The browser's own fullscreen is a second thing on top of
   that, offered by the ⛶: all it adds is taking the browser's chrome off the top of the screen,
   and leaving it drops back to this, not to a page. */
let FAUX_FS = null;
const TABLE_VIEWS = ['viewAvatarTable','viewSpeedTable'];
function nativeFsElement(){ return document.fullscreenElement || document.webkitFullscreenElement || null; }
function stageFsElement(){ return nativeFsElement() || FAUX_FS; }
/* The screen a table is open on, if one is. Both table views keep whatever was last painted in
   them until something replaces it, so a wrapper being in the page is not the same as a table
   being open - the view it is in has to be the one on the screen. */
function tableWrap(){
  for (const id of TABLE_VIEWS){
    const v = document.getElementById(id);
    if (!v || v.style.display === 'none') continue;
    const w = v.querySelector('.speed-detail-wrap');
    if (w) return w;
  }
  return null;
}
function enterFauxFullscreen(root){
  if (FAUX_FS === root) return;
  if (FAUX_FS) FAUX_FS.classList.remove('faux-fs');
  FAUX_FS = root;
  root.classList.add('faux-fs');
  document.body.classList.add('faux-fs-lock');
  onStageFullscreenChanged();
}
function exitFauxFullscreen(){
  if (!FAUX_FS) return;
  FAUX_FS.classList.remove('faux-fs');
  FAUX_FS = null;
  document.body.classList.remove('faux-fs-lock');
  onStageFullscreenChanged();
}
/* Put the screen on the screen. The table screen is rebuilt from scratch every time it is opened -
   and again when the language changes, or when a request is approved and the watched table becomes
   a played one - so this is called after each of those paints rather than once on the way in, and
   it has to be able to move the covering box from the wrapper that has just been thrown away to
   the one that replaced it. */
function mountTableFullscreen(wrap){
  wrap = wrap || tableWrap();
  if (!wrap) return;
  wrap.classList.add('is-fs');
  // where the browser has granted the real thing, it is already the box; a second one over it
  // would only take the screen back off the fullscreen element
  if (nativeFsElement() === wrap){
    if (FAUX_FS) exitFauxFullscreen();
    adoptFsFollowers(wrap);
    return;
  }
  enterFauxFullscreen(wrap);
  adoptFsFollowers(wrap);
}
/* and take it off again on the way back to the lobby, which is a page */
function unmountTableFullscreen(){
  exitNativeFullscreen();
  exitFauxFullscreen();
  releaseFsFollowers();
}
/* The ⛶, on the still and in the header alike. The screen it used to open is the screen you are
   already on, so what is left for it to ask for is the browser's own fullscreen - the address bar
   and the tabs off the top - and to give it back. Where there is no such API, or the browser
   refuses, nothing changes and nothing needs to: the table already has the whole viewport. */
function toggleBrowserFullscreen(){
  if (nativeFsElement()){ exitNativeFullscreen(); return; }
  const root = tableWrap() || document.documentElement;
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!req) return;
  try { Promise.resolve(req.call(root)).catch(()=>{}); } catch(e){ /* refused: already fullscreen enough */ }
}
function exitNativeFullscreen(){
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  if (nativeFsElement() && ex) ex.call(document);
}
/* the way out of a table is the lobby, whichever of the two it was */
function closeTableScreen(){
  if (SPEED.detailTableId) closeSpeedTableDetail();
  else backToAvatarLobby();
}
/* The layout swap is a class rather than :fullscreen so the pieces that have to move in JS -
   the roads, which are pinned to their newest column and have to be re-pinned once the panel
   they live in changes width - move with it. */
/* Anything that floats over the page - the toast, the history sheet - is only drawn over the
   page it is in, so on a fullscreen table it has to be inside the table or it fires invisibly
   behind it. It is lent to the screen, not given: the table screen is rebuilt from scratch on
   every open, and a sheet left inside the old one is thrown away with it, so it goes home to
   the body before anything replaces the screen and is lent again afterwards. */
function adoptFsFollowers(host){
  document.querySelectorAll('[data-fs-follow]').forEach(el=>{ if (el.parentElement !== host) host.appendChild(el); });
}
function releaseFsFollowers(){ adoptFsFollowers(document.body); }
function fsFollowHost(){
  const fs = stageFsElement();
  return fs && fs.classList.contains('speed-detail-wrap') ? fs : document.body;
}
/* A table is laid out fullscreen for as long as it is open, so this no longer decides that - it
   only re-pins what is measured from the width of the panel it sits in, which the browser's own
   fullscreen coming and going does change. */
function onStageFullscreenChanged(){
  adoptFsFollowers(fsFollowHost());
  if (SPEED.detailTableId){
    paintSpeedFsBars(SPEED.detailTableId);
    renderSpeedDetailRoad(SPEED.detailTableId);
  } else if (AVATAR.table && document.getElementById('viewAvatarTable').style.display !== 'none'){
    paintAvatarFsBars();
    renderAvatarRoad(); renderAvatarTally();
  }
}
/* Leaving the browser's fullscreen - by the ⛶, or by the Escape it honours without being asked -
   leaves a table screen with no box holding it over the page, so it takes its own back. */
function onNativeFullscreenChanged(){
  if (tableWrap()) mountTableFullscreen();
  onStageFullscreenChanged();
}
document.addEventListener('fullscreenchange', onNativeFullscreenChanged);
document.addEventListener('webkitfullscreenchange', onNativeFullscreenChanged);
/* the round, the shoe and the balance the fullscreen bars carry - by class, because the head and
   the foot both carry them and only one of the two is on the screen at a time */
function paintSpeedFsBars(tableId){
  const s = SPEED.tstate[tableId];
  if (!s) return;
  const set = (cls, v)=>document.querySelectorAll('.' + cls).forEach(el=>{ el.textContent = v; });
  set('fs-round', s.roundNo || 1);
  set('fs-shoe', s.shoe ? s.shoe.no : (SPEED.tables[tableId]?.shoeNo || 1));
  const hdr = document.getElementById('hdrBalance');
  set('fs-bal', hdr ? hdr.textContent : fmtNum(STATE.balance));
}
function paintAvatarFsBars(){
  if (!AVATAR.table) return;
  const set = (cls, v)=>document.querySelectorAll('.' + cls).forEach(el=>{ el.textContent = v; });
  set('fs-round', AVATAR.roundNo || 1);
  set('fs-shoe', AVATAR.shoe ? AVATAR.shoe.no : (AVATAR.table.shoeNo || 1));
  const hdr = document.getElementById('hdrBalance');
  set('fs-bal', hdr ? hdr.textContent : fmtNum(STATE.balance));
}

/* ---------------- game history bottom sheet (mobile-style, grouped by day) ---------------- */
function openGameHistory(){
  const activeBtn = document.querySelector('#historyTabs button.active') || document.querySelector('#historyTabs button');
  renderGameHistory(activeBtn, activeBtn?.dataset.mode || 'speed');
  openModal('modal-history');
}
function renderGameHistory(btn, mode){
  if (btn){
    document.querySelectorAll('#historyTabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    btn.dataset.mode = mode;
  }
  const body = document.getElementById('historyBody');
  const rows = MY_BET_LOG.filter(b=>b.mode===mode);
  if (!rows.length){ body.innerHTML = `<p class="hint" style="padding:20px 0;text-align:center;">${t('noHistory')}</p>`; return; }
  const byDay = {};
  rows.forEach(b=>{
    const day = fmtDate(b.dt);
    (byDay[day] = byDay[day] || []).push(b);
  });
  body.innerHTML = Object.entries(byDay).map(([day, list])=>{
    const totalBet = list.reduce((s,b)=>s+b.amount,0);
    const totalNet = list.reduce((s,b)=>s+(b.payout-b.amount),0);
    const rowsHtml = list.map(b=>{
      const net = b.payout - b.amount;
      const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
      return `<div class="history-row">
        <span class="t">${fmtDt(b.dt).slice(11)}</span>
        <span class="g">${b.tableName ? escapeHtml(b.tableName) + ' · ' : ''}${betLabel(b.betType)}</span>
        <span class="amt">${fmtNum(b.amount)}</span>
        <span class="wl ${cls}">${net===0?t('push'):fmtSigned(net)}</span>
      </div>`;
    }).join('');
    return `<div class="history-day">
      <div class="history-day-head"><span>${day}</span><span>${t('betLabel')} ${fmtNum(totalBet)} · <b class="${totalNet>=0?'pos':'neg'}">${fmtSigned(totalNet)}</b></span></div>
      ${rowsHtml}
    </div>`;
  }).join('');
}

/* ============================================================
   Navigation shell shared by both modes
   ============================================================ */
function stopAllLoops(){
  stopAvatarRoundLoop();
  stopSpeedClock();
  SPEED.detailTableId = null;
  if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); AVATAR.chatUnsub = null; }
  // the table screens are built fresh each time they are opened, so what is left of the last one
  // is cleared rather than left in the page with its ids still in it
  releaseFsFollowers();     // the sheets go home before the screens holding them are emptied
  const avTable = document.getElementById('viewAvatarTable'); if (avTable) avTable.innerHTML = '';
  const spTable = document.getElementById('viewSpeedTable'); if (spTable) spTable.innerHTML = '';
}
function showView(name){
  ['viewLobby','viewAvatarTable','viewSpeedTable'].forEach(id=>{
    document.getElementById(id).style.display = (id===name) ? 'block' : 'none';
  });
  /* The two table screens keep a chip tray across the foot - 베팅완료 and 반복 sit in it - and a
     toast is drawn at the foot too, so on a phone it landed squarely over them. The class lets
     the toast clear the tray on those screens and nowhere else, where the foot is empty. */
  document.body.classList.toggle('has-chip-tray', TABLE_VIEWS.includes(name));
  document.getElementById('avatarLobbyBtn').style.display = name==='viewAvatarTable' ? 'inline-block' : 'none';
  // the lobby is a page: whatever was holding a table over it comes off on the way back
  if (!TABLE_VIEWS.includes(name)) unmountTableFullscreen();
}
/* 아바타 and 스피드 are one lobby with a filter on it, not two screens with a page in front of them
   asking which you wanted. Both of these are kept because the mode is still a real thing once a
   table is open - and because ?mode= names one - but on the lobby all they do is set which pills
   are lit. */
async function chooseAvatar(){ LOBBY_TYPE_FILTER = 'avatar'; await goLobby(); }
async function chooseSpeed(){ LOBBY_TYPE_FILTER = 'speed'; await goLobby(); }
/* One clock for the room, and starting it always stops whatever was already running.
   It used to be assigned straight after `await loadSpeedTables()`, with the only clearInterval
   back at the top of chooseSpeed() - so two calls that overlapped that await both passed a stop
   that had nothing to clear yet and then both assigned. The first interval was orphaned and
   never cleared, and every table's countdown then came off two a second. A double tap on 스피드
   in the picker is enough to do it, and the card there has no guard of its own. */
function stopSpeedClock(){ if (SPEED.tick){ clearInterval(SPEED.tick); SPEED.tick = null; } }
function startSpeedClock(){
  stopSpeedClock();
  SPEED.tick = setInterval(tickAllSpeedTables, 1000);
}
/* And the call that is overtaken drops out rather than finishing on top of the one that
   overtook it: it would otherwise paint its own (older) list of tables over the newer one and
   report a room that had already been replaced. */
let lobbyEntry = 0;

/* ---------------- lobby casino tabs + game-type filter + search (shared by avatar/speed) ---------------- */
/* Each house picks its table by its own mark, the way the reference lobby lists them: the logo
   over the name rather than the name alone.
   The marks are the operator's own logo files, traced to vector so they stay crisp at any size
   and carry no background of their own - HANN's monogram is three plain bars and is written out
   exactly as it measures; NuStar's and Solaire's are traced from the artwork. They are set in
   the houses' colours, lifted where a print mark would go muddy on the app's dark panel (HANN's
   slate, NuStar's maroon), and the "all games" sparkle is ours since no house owns it.
   To replace one with a newer file, drop it over shared/assets/logo-<house>.svg - nothing reads
   these but the tab. */
/* The ?v= is the mark's own version. Hosting serves an image out of cache for an hour unless
   it is told otherwise, so a corrected file went on being drawn from the old copy long after it
   shipped; the headers now make images revalidate, and bumping this number pulls a replacement
   through immediately rather than waiting the hour out. Bump it whenever a file here changes. */
const CASINO_MARK_SRC = {
  ALL: '../shared/assets/logo-all.svg?v=4',
  HANN: '../shared/assets/logo-hann.svg?v=4',
  NUSTAR: '../shared/assets/logo-nustar.svg?v=4',
  SOLAIRE: '../shared/assets/logo-solaire.svg?v=4',
  /* MIDORI's is the artwork itself rather than a drawing of it - the file the house supplied,
     with nothing but its transparent margin trimmed off. The others are line art and vector
     cleanly; this one is a rendered wordmark over a circuit-trace spade, and redrawing it would
     be an imitation of the mark rather than the mark. */
  MIDORI: '../shared/assets/logo-midori.png?v=5',
};
const LOBBY_CASINOS = ['HANN','NUSTAR','SOLAIRE','MIDORI'];
const CASINO_LABELS = {ALL:'allCasinos', HANN:'casinoHann', NUSTAR:'casinoNustar', SOLAIRE:'casinoSolaire', MIDORI:'casinoMidori'};
let LOBBY_CASINO_FILTER = 'ALL';
let LOBBY_SEARCH = '';
// 전체 / 아바타 / 스피드. 전체 means every table there is, both kinds together - it used to mean
// "every table of whichever kind you happened to be looking at", which on a screen that only ever
// held one kind was no filter at all.
let LOBBY_TYPE_FILTER = 'all';
function casinoTabsHtml(){
  return `<div class="casino-tabs">
    ${['ALL', ...LOBBY_CASINOS].map(c=>`<button class="casino-tab ${LOBBY_CASINO_FILTER===c?'active':''}" data-c="${c}" onclick="setLobbyCasinoFilter('${c}')"><span class="cl-mark"><img src="${CASINO_MARK_SRC[c]}" alt=""></span><span class="cl-name">${t(CASINO_LABELS[c])}</span></button>`).join('')}
  </div>`;
}
const GAME_TYPE_TABS = [
  {id:'all', label:'allGameTypes'},
  {id:'avatar', label:'gameTypeAvatar'},
  {id:'speed', label:'gameTypeSpeed'},
];
function gameTypeTabsHtml(){
  return `<div class="game-type-tabs">
    ${GAME_TYPE_TABS.map(ty=>`<button class="game-type-tab ${LOBBY_TYPE_FILTER===ty.id?'active':''}" data-t="${ty.id}" onclick="setGameTypeFilter('${ty.id}')">${t(ty.label)}</button>`).join('')}
  </div>`;
}
/* Both kinds are already on the screen, so this hides and shows rather than loading anything -
   which is what lets 전체 mean every table rather than sending you to one of two lists. */
function setGameTypeFilter(id){
  LOBBY_TYPE_FILTER = id;
  document.querySelectorAll('.game-type-tab').forEach(b=>b.classList.toggle('active', b.dataset.t===id));
  applyLobbyTileFilter();
}
function lobbySearchHtml(){
  return `<div class="lobby-search-wrap">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
    <input class="lobby-search" id="lobbySearchInput" placeholder="${t('searchTablePh')}" value="${escapeHtml(LOBBY_SEARCH)}" oninput="setLobbySearch(this.value)">
  </div>`;
}
function setLobbyCasinoFilter(c){
  LOBBY_CASINO_FILTER = c;
  document.querySelectorAll('.casino-tab').forEach(b=>b.classList.toggle('active', b.dataset.c===c));
  applyLobbyTileFilter();
}
function setLobbySearch(v){
  LOBBY_SEARCH = v;
  applyLobbyTileFilter();
}
function applyLobbyTileFilter(){
  const q = LOBBY_SEARCH.trim().toLowerCase();
  const favOnly = LOBBY_FAVOURITES_ONLY;
  let shown = 0;
  document.querySelectorAll('.lobby-card[data-casino]').forEach(el=>{
    const casinoOk = LOBBY_CASINO_FILTER==='ALL' || el.dataset.casino===LOBBY_CASINO_FILTER;
    const typeOk = LOBBY_TYPE_FILTER==='all' || el.dataset.type===LOBBY_TYPE_FILTER;
    const nameOk = !q || (el.dataset.name||'').toLowerCase().includes(q);
    const favOk = !favOnly || isFavouriteTable(el.dataset.table);
    const on = casinoOk && typeOk && nameOk && favOk;
    el.style.display = on ? '' : 'none';
    if (on) shown++;
  });
  // a filter that hides everything says so, rather than leaving a blank page to read as a fault
  const none = document.getElementById('lobbyNoMatch');
  if (none) none.style.display = shown ? 'none' : '';
}
function backToAvatarLobby(){ goLobby(); }
function onLangChange(){
  // re-render whichever screen is currently visible so JS-generated text updates immediately
  if (MODE==='avatar'){
    if (document.getElementById('viewAvatarTable').style.display !== 'none' && AVATAR.table){
      if (AVATAR.request){
        paintScreen(document.getElementById('viewAvatarTable'), avatarTableShellHtml());
        renderAvatarRoad(); renderAvatarTally(); updateAvatarStatusPanel();
        renderAvatarBetSpots(); paintAvatarFsBars();
      } else {
        paintScreen(document.getElementById('viewAvatarTable'), avatarPreviewShellHtml(avatarRequestStateForTable(AVATAR.previewTableId).state));
        renderAvatarRoad(); renderAvatarTally();
      }
    } else if (AVATAR.lobbyData){
      goLobby();
    }
  } else if (MODE==='speed'){
    Object.keys(SPEED.tables||{}).forEach(id=>{ renderSpeedTileStats(id); setSpeedTilePhaseText(id, SPEED.tstate[id].phase==='betting'?t('phaseBetting'):SPEED.tstate[id].phase==='dealing'?t('phaseDealing'):''); });
    if (SPEED.detailTableId) openSpeedTableDetail(SPEED.detailTableId, true);
    else if (document.getElementById('viewLobby').style.display !== 'none') goLobby();
  }
}

/* ============================================================
   AVATAR MODE — proxy/대리 betting
   A member requests a dedicated avatar for a table; once a staff
   member approves the request in Partner Admin, this client
   auto-places one bet per round per the member's saved
   instruction (still using the same round/settle engine as
   before), and shows a status panel (assigned avatar, tip
   totals) instead of a manual betting rail.
   ============================================================ */
let AVATAR = {
  table: null, phase: 'idle', secondsLeft: 0, roundNo: 1,
  bets: {player:0, banker:0, tie:0, playerPair:0, bankerPair:0},
  history: [], pairFlags: [], currentRoundId: null, timerHandle: null, chatUnsub: null,
  lobbyData: null, myRequests: [], request: null, tipTotals: {avatar:0, dealer:0},
};

/* The lobby. One list, every table - avatar tables and speed tables together - with the pills
   above it choosing which of them to show. Both sets are fetched before anything is painted: the
   two loads used to own a screen each, and appending one to the other as it arrived meant
   whichever finished second painted over the first. */
async function goLobby(){
  const mine = ++lobbyEntry;
  stopAvatarRoundLoop();
  stopSpeedClock();
  SPEED.detailTableId = null;
  if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); AVATAR.chatUnsub = null; }
  showView('viewLobby');
  const lobby = document.getElementById('viewLobby');
  lobby.innerHTML = `
    <div class="lobby-wrap">
      <div class="lobby-title" data-i18n="lobbyTitle">테이블</div>
      ${casinoTabsHtml()}
      ${gameTypeTabsHtml()}
      <div class="lobby-toolbar">
        ${lobbySearchHtml()}
        <label class="hint" style="margin:0 0 0 auto;" data-i18n="sortLabel">정렬</label>
        <select id="lobbySort" onchange="renderLobbyGrid(this.value)">
          <option value="popular" data-i18n="sortPopular">인기순 (베팅총액)</option>
          <option value="today" data-i18n="sortToday">오늘 베팅액순</option>
          <option value="hot" data-i18n="sortHot">좋은 흐름순</option>
          <option value="name" data-i18n="sortName">테이블명 순</option>
        </select>
      </div>
      <div class="lobby-grid" id="lobbyGrid"><div class="table-loading" style="grid-column:1/-1;height:200px;"><div class="spin-lg"></div><div>${t('connectingTable')}</div></div></div>
      <p class="hint" id="lobbyNoMatch" style="display:none;" data-i18n="noTablesMatch">조건에 맞는 테이블이 없습니다</p>
    </div>`;
  applyI18n(lobby);
  await Promise.all([loadAvatarLobbyData(), loadSpeedLobbyData()]);
  if (mine !== lobbyEntry) return;   // overtaken; the newer call owns the screen
  renderLobbyGrid('popular');
  startSpeedClock();
}
// kept: the table screens and the request form both come back this way
async function goAvatarLobby(){ return goLobby(); }
async function loadAvatarLobbyData(){
  const [tableSnap, roundsSnap, betSnap, reqSnap, allReqSnap] = await Promise.all([
    db.collection('tables').where('type','==','avatar').get(),
    db.collection('rounds').where('tableType','==','avatar').get(),
    db.collection('memberLedger').where('category','==','bet').get(), // single equality filter only - no composite index needed
    db.collection('avatarRequests').where('memberId','==',PLAYER.id).get(),
    db.collection('avatarRequests').get(),
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  AVATAR.lobbyData = { tables, rounds: roundsSnap.docs.map(d=>d.data()), bets: betSnap.docs.map(d=>d.data()) };
  AVATAR.myRequests = reqSnap.docs.map(d=>({id:d.id, ...d.data()}));
  AVATAR.allRequests = allReqSnap.docs.map(d=>({id:d.id, ...d.data()}));
}
/* The grid: avatar cards then speed tiles, in one place. The sort is the avatar side's own - a
   speed table has no betting record of its own to rank by - so the speed tiles keep their order
   and follow. */
function renderLobbyGrid(sortMode){
  const grid = document.getElementById('lobbyGrid');
  if (!grid) return;
  const html = avatarLobbyCardsHtml(sortMode) + Object.values(SPEED.tables).map(tb=>speedTileHtml(tb)).join('');
  grid.innerHTML = html || `<p class="hint">${t('noTablesAtAll')}</p>`;
  // a speed tile's road and counts are painted into it once it is on the page
  Object.keys(SPEED.tstate).forEach(id=>{ renderSpeedTileRoad(id); renderSpeedTileStats(id); });
  pinRoadsIn(grid);
  applyLobbyTileFilter();
}
function avatarRequestStateForTable(tableId){
  const todayStr = fmtDate(new Date());
  const reqs = AVATAR.myRequests.filter(r=>r.tableId===tableId).sort((a,b)=>new Date(b.requestedAt)-new Date(a.requestedAt));
  const active = reqs.find(r=>r.status==='진행중');
  if (active) return {state:'active', req:active};
  const pending = reqs.find(r=>r.status==='대기');
  if (pending) return {state:'pending', req:pending};
  const endedToday = reqs.find(r=>r.status==='종료' && fmtDate(r.requestedAt)===todayStr);
  if (endedToday) return {state:'full', req:endedToday};
  return {state:'none', req:null};
}
// Table-wide occupancy (everyone's requests, not just mine) - drives the
// 관전/금일 예약 완료 states shown on the lobby card overlay.
function avatarTableOccupancy(tableId){
  const todayStr = fmtDate(new Date());
  const all = (AVATAR.allRequests||[]).filter(r=>r.tableId===tableId);
  const activeOther = all.some(r=>r.status==='진행중' && r.memberId!==PLAYER.id);
  const todayCount = all.filter(r=>fmtDate(r.requestedAt)===todayStr && (r.status==='진행중'||r.status==='종료')).length;
  return {activeOther, todayCount};
}
// Clicking anywhere on the card opens the full-screen table view. With an active
// (approved) session that's the live proxy-betting session; otherwise it's a
// read-only preview of the table, with the 아바타 신청 action living inside it.
function handleAvatarCardClick(tableId){
  // the mode is settled by which table is opened, not by which list it was picked from - there
  // is only the one list now
  MODE = 'avatar';
  const {state} = avatarRequestStateForTable(tableId);
  if (state==='active') enterAvatarSession(tableId);
  else openAvatarTablePreview(tableId, state);
}
// Centered pill (or bottom bar, when fully reserved) overlaid on the table
// thumbnail showing the table's current availability at a glance.
function avatarCardStatusHtml(tableId){
  const {state} = avatarRequestStateForTable(tableId);
  if (state==='active') return `<span class="card-status reenter">↩ ${t('btnReenter')}</span>`;
  if (state==='pending') return `<span class="card-status pending">⏳ ${t('btnPending')}</span>`;
  const occ = avatarTableOccupancy(tableId);
  if (occ.todayCount >= 3) return `<span class="card-status full">✏️ ${t('btnFullToday')}</span>`;
  if (occ.activeOther) return `<span class="card-status spectate">🎥 ${t('btnSpectate')}</span>`;
  // A free table needs no call to action here - opening the card leads to the table, and the
  // 아바타 신청 action lives inside it.
  return '';
}

function avatarLobbyCardsHtml(sortMode){
  if (!AVATAR.lobbyData) return '';
  const rows = AVATAR.lobbyData.tables.map(t=>{
    const allRounds = AVATAR.lobbyData.rounds.filter(r=>r.tableId===t.id).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
    // the card's counts and its streak are this shoe's, the same as the board inside the table
    const tableRounds = roundsInShoe(allRounds, latestShoeNo(allRounds, t.shoeNo));
    const results = tableRounds.map(r=>r.result);
    const tableBets = AVATAR.lobbyData.bets.filter(b=>b.relatedTableId===t.id);
    return {t, results, wins: tableWinCounts(results), streak: trailingStreak(results), volume: tableBetVolume(tableBets)};
  });
  const sorted = rows.slice().sort((a,b)=>{
    if (sortMode==='today') return b.volume.today - a.volume.today;
    if (sortMode==='hot') return b.streak.len - a.streak.len;
    if (sortMode==='name') return a.t.name.localeCompare(b.t.name);
    return b.volume.total - a.volume.total; // popular (default)
  });
  return sorted.map(({t:tb, results, wins, streak, volume})=>{
    const cols = buildBigRoad(results.slice(-40));
    const isHot = streak.len >= 3;
    return `
    <div class="lobby-card" data-casino="${tb.casino}" data-type="avatar" data-table="${tb.id}" data-name="${escapeHtml(tb.name).toLowerCase()}" onclick="handleAvatarCardClick('${tb.id}')" title="${t('openTable')}">
      <div class="thumb"></div>
      <div class="mini-road br-grid">${renderBigRoad(cols, 4)}</div>
      <div class="card-foot">
        <div class="card-line">
          <span class="name">${escapeHtml(tb.name)}</span>
          ${avatarCardStatusHtml(tb.id)}
          ${isHot ? `<span class="card-hot">🔥 ${streak.len}연속 ${streak.side==='player'?t('player'):t('banker')}</span>` : ''}
          <button class="card-favorite ${isFavouriteTable(tb.id)?'active':''}" onclick="event.stopPropagation();toggleCardFavorite(this,'${tb.id}')" title="${t('favorites')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.35-9.5-8.8C.7 7.9 2 4.5 5.4 4c2-.3 3.7.6 4.6 2.2C10.9 4.6 12.6 3.7 14.6 4c3.4.5 4.7 3.9 2.9 7.2C15 15.65 12 20 12 20z"/></svg></button>
        </div>
        <div class="card-line meta"><span class="limits">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</span><span class="counts">P <b>${wins.player}</b> · B <b>${wins.banker}</b> · T <b>${wins.tie}</b></span></div>
      </div>
    </div>`;
  }).join('');
}

/* ---------------- avatar request modal ---------------- */
let AVATAR_PENDING_TABLE = null;
function openAvatarRequestModal(tableId){
  AVATAR_PENDING_TABLE = tableId;
  // the buy-in comes out of this account, so the form says which one before it asks for an amount
  const acct = document.getElementById('reqAccount');
  if (acct) acct.textContent = PLAYER ? `${PLAYER.nickname || ''} (${PLAYER.id})`.trim() : '';
  document.getElementById('reqBuyin').value = '';
  openModal('modal-avatar-request');
}
async function submitAvatarRequest(){
  const buyin = rawNum(document.getElementById('reqBuyin').value);
  if (!buyin){ toast(t('suErrRequired'), true); return; }
  // AVATAR.lobbyData may not be loaded if the request modal was opened from a table's own
  // screen (an active session's "아바타 신청" button) rather than the lobby - fall back to
  // whatever table info is on hand there instead
  const tbl = AVATAR.lobbyData?.tables.find(x=>x.id===AVATAR_PENDING_TABLE)
    || (AVATAR.table?.id===AVATAR_PENDING_TABLE ? AVATAR.table : null)
    || SPEED.tables[AVATAR_PENDING_TABLE];
  await db.collection('avatarRequests').doc(uuidv4()).set({
    memberId: PLAYER.id, tableId: AVATAR_PENDING_TABLE, casino: tbl?.casino || PLAYER.casino,
    buyin, status:'대기', avatarStaffId:null,
    requestedAt: new Date().toISOString(), approvedAt:null, endedAt:null,
  });
  closeModal('modal-avatar-request');
  toast(t('requestSubmitted'));
  goAvatarLobby();
}

/* ---------------- avatar table preview (no approved session yet) ---------------- */
// Full-screen, read-only view of the table (felt + road map + recent results) with
// the 아바타 신청 action inside it, so entering a table never requires a request first.
async function openAvatarTablePreview(tableId, state){
  AVATAR.request = null;
  AVATAR.previewTableId = tableId;
  showView('viewAvatarTable');
  const view = document.getElementById('viewAvatarTable');
  releaseFsFollowers();     // whatever is on loan to the old screen, before it is thrown away
  view.innerHTML = `<div class="table-loading"><div class="spin-lg"></div><div>${t('connectingTable')}</div></div>`;

  const doc = await db.collection('tables').doc(tableId).get();
  AVATAR.table = {id:tableId, ...doc.data()};
  const roundsSnap = await db.collection('rounds').where('tableId','==',tableId).get();
  const all = roundsSnap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  const rounds = roundsInShoe(all, latestShoeNo(all, AVATAR.table.shoeNo));   // this shoe only
  AVATAR.history = rounds.map(r=>r.result);
  AVATAR.pairFlags = rounds.map(r=>({playerPair:!!r.playerPair, bankerPair:!!r.bankerPair}));

  paintScreen(view, avatarPreviewShellHtml(state ?? avatarRequestStateForTable(tableId).state));
  renderAvatarRoad();
  renderAvatarTally();
}
/* The avatar table, watched: no session approved yet, so the board takes no chips. It is the
   Speed screen all the same - the same stage, the same chrome over it, the same board and the same
   scoreboard under it - because it is the same table, and it used to be a bare still with a card
   beside it holding one button. What differs is only what can be done: the spots and the tray are
   held closed until an avatar is approved, and where Speed's tray ends in 멀티 베팅 - which is
   Speed's own thing, several tables at once - this one ends in 아바타 신청. */
function avatarPreviewShellHtml(state){
  const tb = AVATAR.table;
  return `
  <div class="speed-detail-wrap sd-live sd-watching">
    ${fsBarHtml(tb, 'top', 'avatar')}
    <div class="speed-detail-grid">
      ${avatarStageHtml(tb, state)}
      <div class="sd-underbar">
      ${avatarScoreboardHtml('avatar')}
      <div class="sd-bets">
        ${avatarBetBoardHtml()}
        ${avatarChipTrayHtml(state)}
      </div>
      </div>
    </div>
    ${fsBarHtml(tb, 'bottom', 'avatar')}
  </div>`;
}
/* The stage, shared by the two avatar shells so the screen is one screen whether or not a session
   is running - the watched table used to carry a single icon (게임기록) against Speed's six, and no
   banner, no clock and no cards at all. */
function avatarStageHtml(tb, state){
  return `
      <div class="sd-stage">
        <button class="icon-btn speed-detail-close" onclick="backToAvatarLobby()" style="position:absolute;top:14px;left:14px;z-index:2;background:rgba(0,0,0,.55);color:#fff;border-color:rgba(255,255,255,.15);" data-i18n-title="backToList" title="목록으로">✕</button>
        <div class="sd-stage-top">
          <div class="sd-type-badge">AVATAR</div>
          <div class="sd-table-id-mini">${escapeHtml(tb.name)}</div>
          <div class="sd-limit-text">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</div>
        </div>
        <div class="phase-banner" id="phase-avatar">${state === 'active' ? t('phaseBetting') : t(avatarWatchLabel(state))}</div>
        <div class="sd-stage-icons">
          <button onclick="toggleBrowserFullscreen()" data-i18n-title="fullscreen" title="전체화면"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
          <button onclick="this.classList.toggle('muted')" data-i18n-title="mute" title="음소거">
            <svg class="icon-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/></svg>
            <svg class="icon-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M23 9l-6 6"/><path d="M17 9l6 6"/></svg>
          </button>
          <button onclick="this.classList.toggle('active')" data-i18n-title="viewToggle" title="화면 보기 전환"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button onclick="openTipModal()" data-i18n-title="giveTip" title="팁"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="5"/><path d="M9 21l3-4 3 4"/><path d="M12 21v-4"/></svg></button>
          <button class="sd-ico-history" onclick="openGameHistory()" data-i18n-title="gameHistory" title="게임기록"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></button>
          <button class="sd-ico-ai" id="aiToggleBtn" onclick="toggleAiPanel()" data-i18n-title="aiPredictTitle" title="AI 예측"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.4"/></svg></button>
          ${state === 'active' ? `<button class="sd-ico-avatar" id="avatarPanelBtn" onclick="toggleAvatarPanel()" data-i18n-title="avatarStatusTitle" title="${t('avatarStatusTitle')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg></button>` : ''}
        </div>
        ${aiPanelHtml()}
        ${state === 'active' ? avatarPanelHtml() : ''}
        <div class="table-felt">
          <div class="cards-area">
            <div class="hand player"><div class="cards" id="playerCardsAvatar"></div><div class="score" id="playerScoreAvatar"></div></div>
            <div class="hand banker"><div class="cards" id="bankerCardsAvatar"></div><div class="score" id="bankerScoreAvatar"></div></div>
          </div>
        </div>
        <div class="timer-ring-wrap" id="timerRingWrap"><svg width="64" height="64"><circle cx="32" cy="32" r="27" stroke="var(--line)" stroke-width="5" fill="none"/><circle id="timerArc" cx="32" cy="32" r="27" stroke="var(--jade)" stroke-width="5" fill="none" stroke-dasharray="169.6" stroke-dashoffset="0" stroke-linecap="round"/></svg><div class="txt" id="timer-avatar">–</div></div>
      </div>`;
}
// what the banner over a watched table says: waiting on the request, or that today is spoken for
function avatarWatchLabel(state){
  if (state === 'pending') return 'btnPending';
  if (state === 'full') return 'btnFullToday';
  return 'btnWatching';
}
/* The tray, in the same shape as Speed's, with 아바타 신청 in the slot Speed gives 멀티 베팅 - which
   is Speed's own thing, several tables at once. There is no 베팅완료 because there is nothing to
   sign off: whatever is on a spot when the clock runs out is what the avatar plays. The session's
   own actions - the shoe, ending it - are in the panel the stage icon opens, so this column holds
   the board and the tray and nothing else, as Speed's does. */
function avatarChipTrayHtml(state){
  const live = state === 'active';
  const tableId = AVATAR.previewTableId || (AVATAR.table && AVATAR.table.id) || '';
  return `
        <div class="sd-chip-tray">
          <button class="btn btn-sm" onclick="clearAvatarBets()"${live?'':' disabled'} data-i18n="cancelBet">취소</button>
          ${CHIP_VALUES.map(v=>`<div class="chip ${v===STATE.selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})" style="background-image:url('${chipFaceUrl(v)}')" aria-label="${chipLabel(v)}"></div>`).join('')}
          <span class="spacer"></span>
          <!-- Two labels, one button, as Speed's is: fullscreen turns the tray's buttons into
               46px rings and "아바타 신청" does not go in one. -->
          <button class="btn btn-sm btn-gold sd-multi-btn" id="avatarRequestBtn" onclick="openAvatarRequestModal('${tableId}')">
            <span class="mb-long" data-i18n="btnRequestAvatar">아바타 신청</span><span class="mb-short" data-i18n="btnRequestAvatarShort">신청</span>
          </button>
        </div>`;
}
/* The avatar's own panel - who is playing for you, what is on the table this round, the line to
   them, and the two things a session can be told to do. It rides over the still the way the AI
   panel does rather than being stacked under the board, because stacked there it made this column
   a different shape to Speed's and clipped at the bottom of it. */
function avatarPanelHtml(){
  return `<div class="ai-panel avatar-panel${AVATAR_PANEL_OPEN?' open':''}" id="avatarPanel">
    <div class="ai-head"><b data-i18n="avatarStatusTitle">${t('avatarStatusTitle')}</b>
      <button class="ai-close" onclick="toggleAvatarPanel(false)" aria-label="close">✕</button></div>
    <div class="ai-body">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <span class="hint" style="margin:0;">${t('betPlacedLabel')}</span>
        <b style="font-family:var(--mono);color:var(--brass);" id="avatarStakedTotal">0</b>
      </div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:8px;">
        <span class="hint" style="margin:0;">${t('chipUsedLabel')}</span>
        <div class="chip-stack" style="height:auto;" id="avatarStakedChips"></div>
      </div>
      <div class="kv-grid" id="avatarStatusGrid" style="margin-top:12px;"></div>
      <div class="chat-panel" style="margin-top:12px;">
        <h3>${t('chat')}</h3>
        <div class="chat-log" id="chatLog"></div>
        <div class="chat-input-row"><input id="chatInput" placeholder="${t('chatPh')}" onkeydown="if(event.key==='Enter')sendAvatarChat()"><button class="btn btn-sm btn-gold" onclick="sendAvatarChat()">${t('send')}</button></div>
      </div>
      <div class="row" style="gap:8px;margin-top:12px;">
        <button class="btn btn-sm" onclick="requestShoeChange()">${t('requestShoeChange')}</button>
        <button class="btn btn-sm btn-danger" onclick="endAvatarSession()">${t('endSession')}</button>
      </div>
    </div>
  </div>`;
}
let AVATAR_PANEL_OPEN = false;
function toggleAvatarPanel(open){
  const el = document.getElementById('avatarPanel');
  if (!el) return;
  AVATAR_PANEL_OPEN = open === undefined ? !el.classList.contains('open') : !!open;
  el.classList.toggle('open', AVATAR_PANEL_OPEN);
  document.getElementById('avatarPanelBtn')?.classList.toggle('active', AVATAR_PANEL_OPEN);
}
// Shared by the avatar preview/active-session shells and the Speed detail screen. Mirrors
// the board's own arrangement: tally + Bead Plate (육매) on the left, and on the right three
// full-width bands stacked down the panel - Big Road (본매), Big Eye Boy (빅아이), Small Road
// (스몰로드), Cockroach Road (카카로치) - with the P/B legend rail running the full height of
// the right edge. `idSuffix` picks the element ids (only one
// of 'avatar'/'detail' is ever mounted in its view at a time).
// .sd-board-row is display:contents everywhere except the phone, where it becomes the
// horizontal scroller that carries the board's two pages - roads, then the full Bead Plate.
function avatarScoreboardHtml(idSuffix){
  return `
    <div class="sd-board-row">
      <div class="sd-tally sd-graph-bg">
        <div class="sd-tally-head"><span>${t('dealsLabel')}</span><b id="tallycount-${idSuffix}">#1</b></div>
        <div class="sd-tally-body">
          <div class="sd-tally-list" id="tallylist-${idSuffix}"></div>
          <div class="bead-road" id="beadroad-${idSuffix}"></div>
        </div>
      </div>
      <div class="sd-road sd-graph-bg">
        <div class="sd-road-main">
          <div class="sd-road-band"><div class="br-grid" id="road-${idSuffix}"></div></div>
          <div class="sd-road-band"><div class="derived-road-grid" id="bigeye-${idSuffix}"></div></div>
          <div class="sd-road-band"><div class="derived-road-grid" id="smallroad-${idSuffix}"></div></div>
          <div class="sd-road-band"><div class="derived-road-grid" id="cockroach-${idSuffix}"></div></div>
        </div>
        ${roadAskHtml(idSuffix)}
      </div>
    </div>`;
}
/* The board's prediction rail. Laid out as a grid so the three marks in the B row sit exactly over
   the three in the P row - a stack of free-standing badges never did line up. The mark shapes say
   which road each column is, the way the board itself does.

   WHAT IT SAYS, and why it says it that way. Underneath, each derived road answers a question
   about the shoe rather than about a side: write d for the depth of the run in play and e for the
   depth of the column `offset` columns back, which is what that road compares against.

     - the hand that CONTINUES the run lands at row d, and the road draws red when the column
       behind reaches that row: e > d.
     - the hand that BREAKS it opens a column, and the road draws red when the run just closed
       matched the column behind: e = d.

   e > d and e = d cannot both hold, so a road never answers red to both. But at e < d - the run in
   play already longer than the column it is measured against, which is an ordinary dragon - it
   answers BLUE to both, and a board prints that. Printed straight onto a rail whose rows are
   labelled P and B in the Big Road's own colours it reads as the board calling banker and player
   alike, which is not what the road means at all and is not something a player can act on.

   So the rail states the road's LEAN rather than its ink: red on the side the road points to, blue
   on the other. Which side it points to is the road's own answer - the side whose hand the road
   would draw red for, since red is the road staying in its run. At e < d neither hand draws red;
   there the run in play is longer than the one behind it, which is a dragon, and a dragon is a
   repeat, so the road points at the hand that continues it. Every road therefore reads one red and
   one blue: never blank once it has opened, and never the same on both rows. */
const ASK_MARKS = [['bigEye','ring'], ['smallRoad','dot'], ['cockroach','slash']];
function roadAskHtml(idSuffix){
  const badge = side => `
    <div class="rail-badge ${side}">${side === 'player' ? 'P' : 'B'}
      ${ASK_MARKS.map(([key, shape]) =>
        `<span class="${shape} none" id="ask-${idSuffix}-${side}-${key}"></span>`).join('')}
    </div>`;
  return `<div class="sd-road-legend-rail" id="ask-${idSuffix}">
    ${badge('player')}
    ${badge('banker')}
  </div>`;
}
// which side the run in play belongs to - a tie decides nothing and is skipped over
function runningSide(history){
  for (let i = (history||[]).length - 1; i >= 0; i--){
    if (history[i] === 'player' || history[i] === 'banker') return history[i];
  }
  return null;
}
function renderRoadPrediction(idSuffix, history){
  if (!document.getElementById(`ask-${idSuffix}`)) return;
  const p = predictNextRoads(history || []);
  const cont = runningSide(history);
  const brk = cont === 'player' ? 'banker' : 'player';
  for (const [key] of ASK_MARKS){
    const contMark = cont ? p[cont][key] : null;
    const brkMark = cont ? p[brk][key] : null;
    // the road it points at: the hand it would draw red for, and on a dragon - neither red - the
    // hand that keeps the run going
    const pointsAtContinue = contMark === 'red' ? true : brkMark === 'red' ? false : true;
    const ink = {};
    if (contMark && brkMark){
      ink[cont] = pointsAtContinue ? 'red' : 'blue';
      ink[brk] = pointsAtContinue ? 'blue' : 'red';
    }
    for (const side of ['player','banker']){
      const el = document.getElementById(`ask-${idSuffix}-${side}-${key}`);
      if (!el) continue;
      // `none` is the road not having started yet, and draws nothing at all
      el.classList.remove('red','blue','none');
      el.classList.add(ink[side] || 'none');
    }
  }
}
function renderAvatarRoad(){
  const el = document.getElementById('road-avatar'); if (!el) return;
  const cols = buildBigRoad(AVATAR.history.slice(-90), (AVATAR.pairFlags||[]).slice(-90));
  paintRoad(el, renderBigRoad(cols, 6));
  paintRoad(document.getElementById('bigeye-avatar'), renderDerivedRoad(deriveBigEyeBoy(cols)));
  paintRoad(document.getElementById('smallroad-avatar'), renderDerivedRoad(deriveSmallRoad(cols), 'filled'));
  paintRoad(document.getElementById('cockroach-avatar'), renderDerivedRoad(deriveCockroachRoad(cols), 'diagonal'));
  // Bead Plate shows the recent window left-aligned, as the board does - grouping runs into
  // columns makes the full shoe far wider than the panel.
  paintRoad(document.getElementById('beadroad-avatar'), renderBeadRoad(AVATAR.history.slice(-BEAD_WINDOW), (AVATAR.pairFlags||[]).slice(-BEAD_WINDOW)));
  renderRoadPrediction('avatar', AVATAR.history);
}
function renderAvatarTally(){
  const listEl = document.getElementById('tallylist-avatar');
  const countEl = document.getElementById('tallycount-avatar');
  if (!listEl && !countEl) return;
  const history = AVATAR.history;
  const pairFlags = AVATAR.pairFlags || [];
  const wins = tableWinCounts(history);
  const playerPairs = pairFlags.filter(p=>p && p.playerPair).length;
  const bankerPairs = pairFlags.filter(p=>p && p.bankerPair).length;
  if (countEl) countEl.textContent = '#' + (AVATAR.roundNo || 1);
  if (listEl){
    // P/B/T rows carry the result letter; the two pair rows are a plain grey bead marked
    // with the same corner dot the roads use (blue = player pair, red = banker pair).
    const row = (cls, letter, val) => `<div class="tl-row ${cls}"><span class="tl-badge">${letter}</span><b>${fmtNum(val)}</b></div>`;
    const pairRow = (side, val) => `<div class="tl-row pair ${side}"><span class="tl-badge"><i class="br-pair ${side}"></i></span><b>${fmtNum(val)}</b></div>`;
    listEl.innerHTML = row('player','P',wins.player) + row('banker','B',wins.banker) + row('tie','T',wins.tie) + pairRow('player',playerPairs) + pairRow('banker',bankerPairs);
  }
}

/* ---------------- avatar session (approved, proxy-betting in progress) ---------------- */
async function enterAvatarSession(tableId){
  const {req} = avatarRequestStateForTable(tableId);
  if (!req){ toast(t('btnPending'), true); return; }
  AVATAR.request = req;

  showView('viewAvatarTable');
  const view = document.getElementById('viewAvatarTable');
  releaseFsFollowers();     // whatever is on loan to the old screen, before it is thrown away
  view.innerHTML = `<div class="table-loading"><div class="spin-lg"></div><div>${t('connectingTable')}</div></div>`;

  const doc = await db.collection('tables').doc(tableId).get();
  AVATAR.table = {id:tableId, ...doc.data()};
  const roundsSnap = await db.collection('rounds').where('tableId','==',tableId).get();
  const all = roundsSnap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  const shoeNo = latestShoeNo(all, AVATAR.table.shoeNo);
  const rounds = roundsInShoe(all, shoeNo);          // the board is this shoe's, not the table's life
  AVATAR.history = rounds.map(r=>r.result);
  AVATAR.pairFlags = rounds.map(r=>({playerPair:!!r.playerPair, bankerPair:!!r.bankerPair}));
  AVATAR.roundNo = (Math.max(0, ...all.map(r=>r.roundNo||0)) || 0) + 1;
  AVATAR.shoe = openShoeAt(shoeNo, rounds.length);   // stands where the record left it
  await refreshTipTotals();

  paintScreen(view, avatarTableShellHtml());
  renderAvatarRoad();
  renderAvatarTally();
  updateAvatarStatusPanel();
  mountAvatarChat(tableId);
  paintAvatarFsBars();
  startAvatarRoundLoop();
}
async function refreshTipTotals(){
  const snap = await db.collection('memberLedger').where('memberId','==',PLAYER.id).get(); // single equality
  let avatarTip = 0, dealerTip = 0;
  snap.forEach(d=>{
    const r = d.data();
    if (r.relatedRequestId !== AVATAR.request.id) return;
    if (r.category==='avatar_tip') avatarTip += Math.abs(r.amount);
    if (r.category==='dealer_tip') dealerTip += Math.abs(r.amount);
  });
  AVATAR.tipTotals = {avatar:avatarTip, dealer:dealerTip};
}
function updateAvatarStatusPanel(){
  const el = document.getElementById('avatarStatusGrid'); if (!el) return;
  const r = AVATAR.request;
  el.innerHTML = `
    <span>${t('assignedAvatar')}</span><b>${r.avatarStaffId ? escapeHtml(r.avatarStaffId) : t('unassigned')}</b>
    <span>${t('buyinLabel')}</span><b class="num">${fmtNum(r.buyin)}</b>
    <span>${t('avatarTipTotal')}</span><b class="num">${fmtNum(AVATAR.tipTotals.avatar)}</b>
    <span>${t('dealerTipTotal')}</span><b class="num">${fmtNum(AVATAR.tipTotals.dealer)}</b>
  `;
}
/* The avatar table with a session running. The same screen as the watched one above and as
   Speed's - one stage builder, one tray - with the board live and the avatar's own panels under
   it: what is staked this round, who the avatar is, and the line to them. */
function avatarTableShellHtml(){
  const tb = AVATAR.table;
  return `
  <div class="speed-detail-wrap sd-live">
    ${fsBarHtml(tb, 'top', 'avatar')}
    <div class="speed-detail-grid">
      ${avatarStageHtml(tb, 'active')}
      <div class="sd-underbar">
      ${avatarScoreboardHtml('avatar')}
      <div class="sd-bets">
        ${avatarBetBoardHtml()}
        ${avatarChipTrayHtml('active')}
      </div>
      </div>
    </div>
    ${fsBarHtml(tb, 'bottom', 'avatar')}
  </div>`;
}

/* ---------------- tip / shoe-change / end-session ----------------
   A tip is handed over as chips, the way it is at a table: tap a chip and it joins the stack,
   and the stack is what gets given. Typing a figure was the old way in and read like a transfer
   form rather than like tipping.
   Both modes come through here. A speed table has no avatar to tip, so there the dealer is the
   only recipient and the target row is hidden. */
let TIP = { chips: [] };
function tipTotal(){ return TIP.chips.reduce((a,b)=>a+b, 0); }
/* What is actually spendable right now: the stake already committed to this round is spoken for
   even though it has not left STATE.balance yet. Which figure that is depends on the mode -
   avatarCommittedAmount() for a session, speedLockedTotal() for the speed tables. */
function tipFreeBalance(){ return playableBalance(); }
function renderTipChips(){
  const row = document.getElementById('tipChips');
  const stack = document.getElementById('tipStack');
  const total = document.getElementById('tipTotal');
  const btn = document.getElementById('tipSubmitBtn');
  if (!row) return;
  const free = tipFreeBalance();
  const sum = tipTotal();
  // a chip the player cannot afford on top of what is already on the stack is shown as spent
  // rather than silently refusing the tap
  row.innerHTML = CHIP_VALUES.map(v=>{
    const over = sum + v > free;
    return `<div class="chip${over?' disabled':''}" data-chip="${v}" ${over?'':`onclick="addTipChip(${v})"`}
      style="background-image:url('${chipFaceUrl(v)}')" aria-label="${chipLabel(v)}"></div>`;
  }).join('');
  if (stack) stack.innerHTML = TIP.chips.length
    ? TIP.chips.map(v=>`<div class="cs-chip" style="background-image:url('${chipFaceUrl(v)}')"></div>`).join('')
    : `<span class="hint" data-i18n="tipPickChip">${t('tipPickChip')}</span>`;
  if (total) total.textContent = fmtNum(sum);
  if (btn) btn.disabled = sum <= 0;
}
function addTipChip(v){
  if (tipTotal() + v > tipFreeBalance()){ toast(t('insufficientBalance'), true); return; }
  TIP.chips.push(v);
  renderTipChips();
}
function undoTipChip(){ TIP.chips.pop(); renderTipChips(); }
function clearTipChips(){ TIP.chips = []; renderTipChips(); }
function openTipModal(){
  TIP.chips = [];
  const speed = MODE === 'speed';
  const sel = document.getElementById('tipTarget');
  if (sel) sel.value = speed ? 'dealer' : 'avatar';
  const field = document.getElementById('tipTargetField');
  if (field) field.style.display = speed ? 'none' : '';
  renderTipChips();
  openModal('modal-tip');
}
async function submitTip(){
  const speed = MODE === 'speed';
  const target = speed ? 'dealer' : (document.getElementById('tipTarget')?.value || 'dealer');
  const amount = tipTotal();
  if (!amount){ toast(t('tipPickChip'), true); return; }
  if (amount > tipFreeBalance()){ toast(t('insufficientBalance'), true); return; }
  const tableId = speed ? SPEED.detailTableId : AVATAR.table?.id;
  const row = {
    memberId: PLAYER.id, casino: PLAYER.casino, amount: -amount,
    category: target==='avatar' ? 'avatar_tip' : 'dealer_tip',
    relatedTableId: tableId || null,
    chips: TIP.chips.slice(),        // what was actually handed over, not just the sum
    staff: 'member', createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    clientCreatedAt: new Date().toISOString(), deviceId: getDeviceId(),
  };
  if (!speed && AVATAR.request) row.relatedRequestId = AVATAR.request.id;
  await db.collection('memberLedger').doc(uuidv4()).set(row);
  /* memberLedger is the record of play; for an account opened at a cage it is NOT the money.
     That balance is the cage's own `ledger`, which is why placeBet writes both books - and why
     a tip that wrote only this one never actually left a cage account: the header dropped by the
     tip and the next refresh, reading `ledger`, put it straight back. */
  if (isCageAccount(PLAYER)) await writeCageLedger(db, {
    accountId: PLAYER.id, casino: PLAYER.casino, type:'OUT', amount,
    memo: `tip ${target}${tableId ? ' ' + tableId : ''}`,
    staff: speed ? CAGE_LEDGER_SOURCE.speed : CAGE_LEDGER_SOURCE.avatar,
  });
  STATE.balance -= amount;
  paintPlayableBalance();
  TIP.chips = [];
  if (!speed){ await refreshTipTotals(); updateAvatarStatusPanel(); }
  closeModal('modal-tip');
  toast(t('tipSentAmount', {amount: fmtNum(amount)}));
}
async function requestShoeChange(){
  await db.collection('avatarServiceRequests').doc(uuidv4()).set({
    requestId: AVATAR.request.id, tableId: AVATAR.table.id, memberId: PLAYER.id,
    type: 'shoe_change', dt: new Date().toISOString(),
  });
  toast(t('shoeChangeSent'));
}
async function endAvatarSession(){
  await db.collection('avatarRequests').doc(AVATAR.request.id).set({status:'종료', endedAt:new Date().toISOString()}, {merge:true});
  toast(t('sessionEnded'));
  backToAvatarLobby();
}

/* ---------------- round loop (auto-bets the member's saved instruction each round) ---------------- */
function avatarTotalBet(){ return Object.values(AVATAR.bets).reduce((a,b)=>a+b,0); }
/* AVATAR auto-bets the member's saved instruction every round with no confirm step, so the stake
   is committed the moment betting opens - unlike Speed, there is no "unconfirmed, might not
   happen" middle state to wait out. But it does not actually leave STATE.balance until
   beginAvatarDealingPhase's placeBet write lands, and that is a real network round-trip: the tip
   form reads STATE.balance directly, and on a slow connection a tip sent from what still looked
   like the full balance landed on top of the round's own deduction and took STATE.balance
   negative. AVATAR.committed tracks the gap: true from the moment a round's betting phase opens,
   false again once the deduction has actually happened (or the round turned out to have nothing
   staked). */
function avatarCommittedAmount(){ return AVATAR.committed ? avatarTotalBet() : 0; }
function stopAvatarRoundLoop(){ if (AVATAR.timerHandle){ clearInterval(AVATAR.timerHandle); AVATAR.timerHandle = null; } }
function startAvatarRoundLoop(){
  stopAvatarRoundLoop();
  beginAvatarBettingPhase();
  AVATAR.timerHandle = setInterval(avatarTick, 1000);
}
function beginAvatarBettingPhase(){
  AVATAR.phase = 'betting';
  AVATAR.secondsLeft = AVATAR_BETTING_SECONDS;
  AVATAR.currentRoundId = uuidv4();
  AVATAR.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  /* The round opens with nothing on it. The request used to carry a side and an amount and every
     round was staked with them before the player could say anything; the instruction is given at
     the table now, chip by chip, so what rides is whatever they put down before the clock runs
     out. Nothing is spoken for until they do. */
  AVATAR.committed = false;
  // the hand belongs to the round that just ended; clearing it is what lets "no hand, no result"
  // in beginAvatarResultPhase mean this round's hand rather than possibly a stale earlier one
  AVATAR._sim = null;
  renderAvatarBetSpots();
  setAvatarPhaseBanner(t('phaseBetting'), AVATAR_BETTING_SECONDS);
  document.getElementById('playerCardsAvatar').innerHTML = ''; document.getElementById('bankerCardsAvatar').innerHTML = '';
  document.getElementById('playerScoreAvatar').textContent = ''; document.getElementById('bankerScoreAvatar').textContent = '';
}
function setAvatarPhaseBanner(text, secs){
  const el = document.getElementById('phase-avatar'); if (el) el.textContent = text;
  updateAvatarTimerRing(secs, secs);
}
function updateAvatarTimerRing(secLeft, secTotal){
  const txt = document.getElementById('timer-avatar'); if (txt) txt.textContent = secLeft;
  const arc = document.getElementById('timerArc');
  if (arc){ const c = 169.6; arc.style.strokeDashoffset = c * (1 - secLeft/secTotal); }
  const wrap = document.getElementById('timerRingWrap');
  if (wrap) wrap.classList.toggle('urgent', secLeft <= 5 && secLeft > 0);
  paintAvatarFsBars();   // the fullscreen bars carry the round, the shoe and the balance
}
/* avatarTick is driven by a plain setInterval, which fires again every second whether or not the
   previous tick's async work has finished. A slow placeBet/settleBet write can outlast dealing's
   own 4-second clock, and once that happens a later tick sees the phase's countdown already at
   or below zero and tries to start the NEXT phase while the current one is still running - result
   was seen reading AVATAR._sim before dealing had set it ("Cannot read properties of undefined
   (reading 'result')"), and worse: the round that placeBet had already, genuinely staked then had
   its settlement silently skipped, so a winning bet's payout was never credited. avatarPhaseBusy
   is the same guard tickAllSpeedTables uses per table, sized down to Avatar's one instance. */
let avatarPhaseBusy = false;
function avatarTick(){
  AVATAR.secondsLeft--;
  if (AVATAR.phase==='betting'){
    updateAvatarTimerRing(Math.max(0,AVATAR.secondsLeft), AVATAR_BETTING_SECONDS);
    if (AVATAR.secondsLeft <= 0) startAvatarPhase(beginAvatarDealingPhase);
  } else if (AVATAR.phase==='dealing'){
    if (AVATAR.secondsLeft <= 0) startAvatarPhase(beginAvatarResultPhase);
  } else if (AVATAR.phase==='result'){
    updateAvatarTimerRing(Math.max(0,AVATAR.secondsLeft), AVATAR_RESULT_SECONDS);
    if (AVATAR.secondsLeft <= 0) beginAvatarBettingPhase();
  }
}
/* One phase change runs at a time. A failure here (a rejected write, a dropped connection) is
   caught and recovered by starting a fresh round rather than left to jam the loop or silently
   drop a settlement - the player is told, in case real money already moved for the round that
   was lost. */
function startAvatarPhase(fn){
  if (avatarPhaseBusy) return;
  avatarPhaseBusy = true;
  Promise.resolve()
    .then(fn)
    .catch(err=>{
      console.error('avatar phase failed', err);
      toast(t('roundFailed'), true);
      AVATAR.committed = false;
      beginAvatarBettingPhase();
    })
    .finally(()=>{ avatarPhaseBusy = false; });
}
async function beginAvatarDealingPhase(){
  // this round's own stake and the request it belongs to, read once before the write rather than
  // live afterward - AVATAR is one shared object, and a player who closes this table and opens
  // another while placeBet is still on the wire would otherwise have this call resume after the
  // switch and subtract the NEW round's total, or announce the wrong side, for a bet that was
  // actually placed under the OLD round entirely
  const myRound = AVATAR.currentRoundId;
  const bets = AVATAR.bets, total = avatarTotalBet();
  AVATAR.phase = 'dealing';
  AVATAR.secondsLeft = AVATAR_DEALING_SECONDS;
  setAvatarPhaseBanner(t('phaseDealing'), AVATAR_DEALING_SECONDS);
  for (const [betType, amount] of Object.entries(bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId:AVATAR.table.id, roundId:myRound, betType, amount, staff:CAGE_LEDGER_SOURCE.avatar});
  }
  if (AVATAR.currentRoundId !== myRound){
    // moved on to a new round while this write was in flight - the stake still landed correctly
    // under the old round, but applying it to whatever is on screen now would corrupt that
    // instead, so the real balance is re-read from the ledger rather than guessed at locally
    await refreshBalance();
    return;
  }
  if (total > 0){
    STATE.balance -= total;
    paintPlayableBalance();
    toast(t('avatarPlacedTotal', {amount: fmtNum(total)}));
  }
  AVATAR.committed = false;   // the stake has actually left STATE.balance now, one way or the other
  AVATAR._sim = simulateRound(AVATAR.shoe);
  await revealAvatarCards(AVATAR._sim);
}
/* The deck is a set of card faces rather than a drawn one: shared/assets/cards/<suit><rank>.png,
   suit as its initial and rank lowercased, so the seven of spades is s7 and the ace of hearts ha.
   card_back.png rides along with them for a face-down card. */
const CARD_SUIT_FILE = {'\u2660':'s', '\u2665':'h', '\u2666':'d', '\u2663':'c'};
function cardFaceUrl(card){
  return `../shared/assets/cards/${CARD_SUIT_FILE[card.suit]}${String(card.rank).toLowerCase()}.png`;
}
function cardHtml(card, index){
  const red = card.suit==='♥' || card.suit==='♦';
  // the third card of a hand goes down sideways, as it is dealt
  const third = index===2 ? ' third' : '';
  return `<div class="playing-card ${red?'red':'black'}${third}" data-rank="${card.rank}${card.suit}" style="background-image:url('${cardFaceUrl(card)}')"></div>`;
}
async function revealAvatarCards(sim){
  const pEl = document.getElementById('playerCardsAvatar'), bEl = document.getElementById('bankerCardsAvatar');
  for (const [side,i] of dealSequence(sim)){
    (side==='player'?pEl:bEl).insertAdjacentHTML('beforeend', cardHtml(sim[side].cards[i], i));
    await new Promise(r=>setTimeout(r, 260));
  }
  document.getElementById('playerScoreAvatar').textContent = sim.player.score;
  document.getElementById('bankerScoreAvatar').textContent = sim.banker.score;
}
async function beginAvatarResultPhase(){
  // no hand, no result: the deal is still going through (startAvatarPhase should already have
  // kept this from being reached, but a table with no hand yet is never worth reading as one)
  if (!AVATAR._sim) return;
  // this round's own table, shoe and stake, read once before settling rather than live afterward
  // or mid-loop - see the identical comment in beginAvatarDealingPhase
  const myRound = AVATAR.currentRoundId;
  const tableId = AVATAR.table.id, tableName = AVATAR.table.name, roundNo = AVATAR.roundNo, shoe = AVATAR.shoe, bets = AVATAR.bets;
  AVATAR.phase = 'result';
  AVATAR.secondsLeft = AVATAR_RESULT_SECONDS;
  const sim = AVATAR._sim;
  setAvatarPhaseBanner(sim.result==='player' ? t('phasePlayerWin') : sim.result==='banker' ? t('phaseBankerWin') : t('phaseTie'), AVATAR_RESULT_SECONDS);

  let totalPayout = 0;
  for (const [betType, amount] of Object.entries(bets)){
    if (amount <= 0) continue;
    const payout = await settleBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:myRound, betType, amount, resultInfo:sim, staff:CAGE_LEDGER_SOURCE.avatar});
    totalPayout += payout;
    MY_BET_LOG.unshift({tableName, roundNo, betType, amount, payout, mode:'avatar', dt:new Date().toISOString()});
  }
  const staked = Object.values(bets).reduce((a,x)=>a+x, 0);
  if (AVATAR.currentRoundId !== myRound){
    // moved on to a new round while this settlement was in flight - the payout still landed
    // correctly in the member's ledger under the old round, so the real balance is re-read
    // rather than applied here (or the shoe/history below carried onto whatever table is now
    // on screen)
    await refreshBalance();
    return;
  }
  if (totalPayout > 0) STATE.balance += totalPayout;
  if (staked > 0) toast(roundOutcomeText(staked, totalPayout));
  paintPlayableBalance();
  refreshPointsQuiet();

  await writeRoundDoc(db, {tableId, tableType:'avatar', roundNo, shoeNo:shoe.no, sim, startedAt:new Date(Date.now()-(AVATAR_BETTING_SECONDS+AVATAR_DEALING_SECONDS)*1000).toISOString()});
  AVATAR.history.push(sim.result);
  AVATAR.pairFlags.push({playerPair:!!sim.playerPair, bankerPair:!!sim.bankerPair});
  AVATAR.roundNo++;
  // the road belongs to the shoe: a cut card ends both together
  const nextShoe = advanceShoe(AVATAR.shoe);
  if (nextShoe.no !== AVATAR.shoe.no){
    AVATAR.shoe = nextShoe; AVATAR.table.shoeNo = nextShoe.no;
    AVATAR.history = []; AVATAR.pairFlags = [];
    toast(t('shoeChanged', {no: nextShoe.no}));
  }
  renderAvatarRoad();
  renderAvatarTally();
}
async function refreshPointsQuiet(){
  const b = await getPlayerBalance(db, PLAYER.id);
  STATE.points = b.points;
  document.getElementById('hdrPoints').textContent = fmtNum(STATE.points);
}
function mountAvatarChat(tableId){
  const log = document.getElementById('chatLog');
  if (AVATAR.chatUnsub) AVATAR.chatUnsub();
  // single equality filter only (no orderBy) - avoids needing a composite Firestore index; sort client-side.
  AVATAR.chatUnsub = db.collection('chatMessages').where('tableId','==',tableId).limit(200)
    .onSnapshot(snap=>{
      const msgs = snap.docs.map(d=>d.data()).sort((a,b)=>new Date(a.dt)-new Date(b.dt)).slice(-30);
      log.innerHTML = msgs.map(m=>`<div class="msg"><b>${escapeHtml(m.nickname)}:</b> ${escapeHtml(m.text)}</div>`).join('') || `<span class="hint">${t('noChat')}</span>`;
      log.scrollTop = log.scrollHeight;
    }, err=>{ log.innerHTML = `<span class="hint">${t('noChat')}</span>`; });
}
async function sendAvatarChat(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || !AVATAR.table) return;
  input.value = '';
  await db.collection('chatMessages').doc(uuidv4()).set({tableId:AVATAR.table.id, memberId:PLAYER.id, nickname:PLAYER.nickname, text, dt:new Date().toISOString()});
}

/* ============================================================
   SPEED MODE — several tables running simultaneously, self-service
   ============================================================ */
let SPEED = { tables:{}, tstate:{}, allBets:[], tick:null, detailTableId:null };


/* The speed side of the lobby's data. It used to own a screen - painting a toolbar and a grid of
   its own - and now it only gathers, so the one grid can hold both kinds of table. */
async function loadSpeedLobbyData(){
  const [tableSnap, roundsSnap, betSnap] = await Promise.all([
    db.collection('tables').where('type','==','speed').get(),
    db.collection('rounds').where('tableType','==','speed').get(),
    db.collection('memberLedger').where('category','==','bet').get(),
  ]);
  const tables = tableSnap.docs.map(d=>({id:d.id, ...d.data()})).filter(t=>t.status==='open');
  const allRounds = roundsSnap.docs.map(d=>d.data());
  SPEED.allBets = betSnap.docs.map(d=>d.data());
  SPEED.tables = {}; SPEED.tstate = {};
  tables.forEach(tb=>{
    SPEED.tables[tb.id] = tb;
    const all = allRounds.filter(r=>r.tableId===tb.id).sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
    // the board shows the shoe it is on, not every shoe the table has ever dealt
    const shoeNo = latestShoeNo(all, tb.shoeNo);
    const rounds = roundsInShoe(all, shoeNo);
    SPEED.tstate[tb.id] = {
      phase:'betting', secondsLeft: SPEED_BETTING_SECONDS - (Object.keys(SPEED.tstate).length*3)%SPEED_BETTING_SECONDS,
      roundNo: (Math.max(0, ...all.map(r=>r.roundNo||0))||0)+1,
      bets:{player:0, banker:0, tie:0, playerPair:0, bankerPair:0}, currentRoundId: uuidv4(),
      history: rounds.map(r=>r.result),
      pairFlags: rounds.map(r=>({playerPair:!!r.playerPair, bankerPair:!!r.bankerPair})),
      shoe: openShoeAt(shoeNo, rounds.length),   // stands where the record left it
      // seeded from the last round on record so a table already in play shows its score straight away
      lastResult: rounds.length
        ? {p: rounds[rounds.length-1].playerScore, b: rounds[rounds.length-1].bankerScore, side: rounds[rounds.length-1].result}
        : null,
    };
  });
}
// Built from the same pieces as the avatar lobby card - same classes, same order - so the
// two selection screens render identically. The one Speed-specific bit is the countdown,
// which takes the slot the avatar card gives its request/state pill.
function speedTileHtml(tb){
  return `
  <div class="lobby-card speed-tile" id="tile-${tb.id}" data-casino="${tb.casino}" data-type="speed" data-table="${tb.id}" data-name="${escapeHtml(tb.name).toLowerCase()}" onclick="openSpeedTableDetail('${tb.id}')" title="${t('openTable')}">
    <div class="thumb"></div>
    <div class="mini-road br-grid" id="road-${tb.id}"></div>
    <div class="card-foot">
      <div class="card-line">
        <span class="name">${escapeHtml(tb.name)}</span>
        <span class="card-status live">⏱ <b id="timer-${tb.id}">15</b></span>
        <span class="card-hot" id="score-${tb.id}"></span>
        <span class="card-hot" id="hotbadge-${tb.id}"></span>
        <button class="card-favorite ${isFavouriteTable(tb.id)?'active':''}" onclick="event.stopPropagation();toggleCardFavorite(this,'${tb.id}')" title="${t('favorites')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.35-9.5-8.8C.7 7.9 2 4.5 5.4 4c2-.3 3.7.6 4.6 2.2C10.9 4.6 12.6 3.7 14.6 4c3.4.5 4.7 3.9 2.9 7.2C15 15.65 12 20 12 20z"/></svg></button>
      </div>
      <div class="card-line meta"><span class="limits">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</span><span class="counts" id="stats-${tb.id}"></span></div>
    </div>
  </div>`;
}
/* Speed is several tables at once - every table runs its own round whether or not its screen is
   open - so an open table carries a multi-bet panel listing the others, and a spot in it stakes
   the chip selected in that table's own tray. The list itself stays a list. */
const SPEED_TILE_SPOTS = [
  ['playerPair','playerPairShort','pair player'], ['tie','tie','tie'], ['bankerPair','bankerPairShort','pair banker'],
  ['player','player','player'], ['banker','banker','banker'],
];
/* The multi-bet panel: the OTHER tables on one strip, each with the same five spots - so a round
   can be staked across the room without leaving the table on the screen. The table being watched
   is not on it: it has its own full-size board right there, and a second, smaller copy of it in
   the strip was one more thing to scroll past to reach a table that is not already in front of
   you. It stakes whatever chip is selected - the same STATE.selectedChip the table's own tray
   uses - and carries the running total across the lot. */
function speedMultiPanelHtml(){
  const openId = SPEED.detailTableId;
  const others = Object.keys(SPEED.tstate).filter(id => id !== openId);
  const spot = (tableId) => ([key,label,cls]) =>
    `<button type="button" class="tb-spot ${cls}" id="tilespot-${tableId}-${key}" onclick="placeSpeedBet('${tableId}','${key}')">
       <span class="tb-label">${t(label)}</span><b class="tb-amt" id="tilebet-${tableId}-${key}"></b>
     </button>`;
  const rows = others.map(id=>{
    const tb = SPEED.tables[id] || {name:id};
    return `<div class="sm-row" id="smrow-${id}">
      <div class="sm-head">
        <span class="sm-name">${escapeHtml(tb.name || id)}</span>
        <span class="sm-timer">⏱ <b id="smtimer-${id}">–</b></span>
        <button class="sm-open" onclick="openSpeedTableDetail('${id}')">${t('enterShort')}</button>
      </div>
      <div class="sm-sub">
        <span class="sm-phase" id="smphase-${id}"></span>
        <span class="sm-last" id="smlast-${id}"></span>
        <span class="sm-counts" id="smcounts-${id}"></span>
      </div>
      <div class="sm-body">
        <div class="sm-road mini-road" id="smroad-${id}" data-table="${id}" data-stale="1"></div>
        <div class="sm-spots">
          <div class="tb-row pairs">${SPEED_TILE_SPOTS.slice(0,3).map(spot(id)).join('')}</div>
          <div class="tb-row hands">${SPEED_TILE_SPOTS.slice(3).map(spot(id)).join('')}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  // the sheet covers the table's own tray, so it carries the chip picker itself - the same
  // STATE.selectedChip either way, so a chip chosen here is the one the open table stakes too
  return `
    <div class="sm-top">
      <b>${t('multiBet')}</b>
      <div class="sm-chips">
        ${CHIP_VALUES.map(v=>`<div class="chip ${v===STATE.selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})" style="background-image:url('${chipFaceUrl(v)}')" aria-label="${chipLabel(v)}"></div>`).join('')}
      </div>
      <span class="sm-total">${t('totalLabel')} <b id="speedStakedTotal">0</b></span>
      <button class="btn btn-sm btn-gold" onclick="confirmAllSpeedBets()">${t('betComplete')}</button>
      <button class="btn btn-sm" onclick="clearAllSpeedBets()">${t('cancelBet')}</button>
      <button class="icon-btn sm-close" onclick="toggleSpeedMultiPanel(false)" title="${t('backToList')}">✕</button>
    </div>
    <div class="sm-list">${rows || `<p class="hint">${t('noOtherTables')}</p>`}</div>
    <div class="sm-scrollbar" id="speedMultiScrollbar"><div class="sm-scrollbar-thumb" id="speedMultiScrollbarThumb"></div></div>`;
}
/* Slides the thumb to match the rail's own scrollLeft - the rail's native scrollbar is hidden,
   so without this there's no on-screen cue that swiping left/right reaches more tables. */
function updateSpeedMultiScrollbar(){
  const list = document.querySelector('#speedMultiPanel .sm-list');
  const bar = document.getElementById('speedMultiScrollbar');
  const thumb = document.getElementById('speedMultiScrollbarThumb');
  if (!list || !bar || !thumb) return;
  const scrollable = list.scrollWidth - list.clientWidth;
  if (scrollable <= 4){ bar.classList.remove('visible'); return; }
  bar.classList.add('visible');
  const barWidth = bar.clientWidth;
  const thumbWidth = Math.max(30, barWidth * (list.clientWidth / list.scrollWidth));
  thumb.style.width = thumbWidth + 'px';
  thumb.style.left = ((list.scrollLeft / scrollable) * (barWidth - thumbWidth)) + 'px';
}
function toggleSpeedMultiPanel(open){
  const el = document.getElementById('speedMultiPanel');
  if (!el) return;
  const show = open === undefined ? !el.classList.contains('open') : !!open;
  if (show){
    paintScreen(el, speedMultiPanelHtml());
    Object.keys(SPEED.tstate).forEach(id=>{
      renderSpeedTileBets(id);
      paintSpeedMultiRow(id);
      renderSpeedMultiResult(id);      // marks the road; the observer draws the ones on screen
      paintSpeedConfirmState(id);      // and this is what locks a board closed to further chips
    });
    renderSpeedStakedTotal();
    watchSpeedMultiRoads();
    const list = el.querySelector('.sm-list');
    if (list){
      list.addEventListener('scroll', updateSpeedMultiScrollbar);
      requestAnimationFrame(updateSpeedMultiScrollbar);
    }
  } else {
    unwatchSpeedMultiRoads();
  }
  el.classList.toggle('open', show);
  document.getElementById('speedMultiBtn')?.classList.toggle('active', show);
}
/* the row's own phase line, countdown and last score, so a table can be judged without opening
   it - cheap enough to run on every tick */
function paintSpeedMultiRow(tableId){
  const s = SPEED.tstate[tableId];
  if (!s) return;
  const ph = document.getElementById(`smphase-${tableId}`);
  if (ph){
    ph.textContent = s.phase==='betting' ? t('phaseBetting') : s.phase==='dealing' ? t('phaseDealing') : '';
    ph.className = 'sm-phase ' + s.phase;
  }
  const tm = document.getElementById(`smtimer-${tableId}`);
  if (tm) tm.textContent = Math.max(0, s.secondsLeft);
  const last = document.getElementById(`smlast-${tableId}`);
  if (last){
    const r = s.lastResult;
    last.textContent = r ? `P${r.p} : B${r.b}` : '';
    last.className = 'sm-last' + (r ? ' ' + r.side : '');
  }
}
/* The row's roadmap and running count. The whole shoe goes in, not a tail of it, drawn six rows
   deep the way the table's own board draws it - so no column is cut short and every result played
   is on the paper, reachable by scrolling back from the newest column.

   A road is only drawn once its row is actually on the screen. Drawing them all when the panel
   opens is what made pressing 멀티 베팅 freeze: a house running 32 tables put six thousand marks
   into the page in one go, and every road then forces two layout passes to pin itself to its
   newest column. Measured on a phone's processor that was 819ms of blocked main thread in a
   single block and about 1.4s in all - the screen simply stopped. The rail only ever shows one
   or two rows at a time, so the cost of opening it no longer depends on how many tables the
   house runs at all. The rest are marked and drawn as they are swiped to. */
const speedMultiVisible = new Set();
let speedMultiRoadWatch = null;
function renderSpeedMultiResult(tableId){
  const s = SPEED.tstate[tableId];
  if (!s) return;
  const road = document.getElementById(`smroad-${tableId}`);
  if (road){
    road.dataset.stale = '1';
    if (speedMultiVisible.has(tableId)) paintSpeedMultiRoad(tableId);
  }
  const counts = document.getElementById(`smcounts-${tableId}`);
  if (counts){
    const w = tableWinCounts(s.history);   // text, so cheap enough to keep current off-screen
    counts.innerHTML = `P <b>${w.player}</b> · B <b>${w.banker}</b> · T <b>${w.tie}</b>`;
  }
}
function paintSpeedMultiRoad(tableId){
  const road = document.getElementById(`smroad-${tableId}`);
  const s = SPEED.tstate[tableId];
  if (!road || !s || road.dataset.stale !== '1') return;
  road.dataset.stale = '0';
  const cols = buildBigRoad(s.history, s.pairFlags || []);
  paintRoad(road, renderBigRoad(cols, 6));
}
/* Which rows are on the rail's screen. The margin means the next table along is drawn before it
   is swiped to, so it is never caught being painted. */
function watchSpeedMultiRoads(){
  const list = document.querySelector('#speedMultiPanel .sm-list');
  speedMultiRoadWatch?.disconnect();
  speedMultiVisible.clear();
  if (!list || typeof IntersectionObserver === 'undefined'){
    // no observer: fall back to drawing them all, which is what it always did
    Object.keys(SPEED.tstate).forEach(id=>{ speedMultiVisible.add(id); paintSpeedMultiRoad(id); });
    return;
  }
  speedMultiRoadWatch = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      const id = e.target.dataset.table;
      if (!id) return;
      if (e.isIntersecting){ speedMultiVisible.add(id); paintSpeedMultiRoad(id); }
      else speedMultiVisible.delete(id);
    });
  }, {root: list, rootMargin: '0px 400px'});
  list.querySelectorAll('.sm-road[data-table]').forEach(el=>speedMultiRoadWatch.observe(el));
}
function unwatchSpeedMultiRoads(){
  speedMultiRoadWatch?.disconnect();
  speedMultiRoadWatch = null;
  speedMultiVisible.clear();
}
function renderSpeedStakedTotal(){
  let staked = 0;
  Object.values(SPEED.tstate || {}).forEach(s=> staked += Object.values(s.bets).reduce((a,b)=>a+b,0));
  const el = document.getElementById('speedStakedTotal');
  if (el) el.textContent = fmtNum(staked);
  // the button carries how many other tables are live with a bet, so the panel need not be open
  const badge = document.getElementById('speedMultiCount');
  if (badge){
    const n = Object.entries(SPEED.tstate || {})
      .filter(([id,s2]) => id !== SPEED.detailTableId && Object.values(s2.bets).some(v=>v>0)).length;
    badge.textContent = n ? n : '';
  }
}
/* clears whatever is staked on every table that is still taking bets - a round already dealing
   is committed and is left alone */
function clearAllSpeedBets(){
  Object.entries(SPEED.tstate || {}).forEach(([tableId,s])=>{
    if (s.phase !== 'betting') return;
    s.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
    ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
      if (SPEED.detailTableId===tableId) document.getElementById(`spot-detail-${k}`)?.classList.remove('selected');
    });
    markSpeedBetsUnconfirmed(tableId);
    renderSpeedTileBets(tableId);
  });
  renderSpeedStakedTotal();
  projectSpeedBalance();
}
function renderSpeedTileRoad(tableId){
  const el = document.getElementById('road-'+tableId);
  if (el){
    const cols = buildBigRoad(SPEED.tstate[tableId].history.slice(-40), (SPEED.tstate[tableId].pairFlags||[]).slice(-40));
    paintRoad(el, renderBigRoad(cols, 4));
  }
  renderSpeedMultiResult(tableId);   // the multi-bet panel keeps the same record
  if (SPEED.detailTableId===tableId) renderSpeedDetailRoad(tableId);
}
function renderSpeedDetailRoad(tableId){
  const history = SPEED.tstate[tableId].history;
  const pairFlags = SPEED.tstate[tableId].pairFlags || [];
  const cols = buildBigRoad(history.slice(-90), pairFlags.slice(-90));
  paintRoad(document.getElementById('road-detail'), renderBigRoad(cols, 6));
  paintRoad(document.getElementById('bigeye-detail'), renderDerivedRoad(deriveBigEyeBoy(cols)));
  paintRoad(document.getElementById('smallroad-detail'), renderDerivedRoad(deriveSmallRoad(cols), 'filled'));
  paintRoad(document.getElementById('cockroach-detail'), renderDerivedRoad(deriveCockroachRoad(cols), 'diagonal'));
  paintRoad(document.getElementById('beadroad-detail'), renderBeadRoad(history.slice(-BEAD_WINDOW), pairFlags.slice(-BEAD_WINDOW)));
  renderRoadPrediction('detail', history);
  renderSpeedDetailTally(tableId);
}
function renderSpeedDetailTally(tableId){
  const listEl = document.getElementById('tallylist-detail');
  const countEl = document.getElementById('tallycount-detail');
  if (!listEl && !countEl) return;
  const history = SPEED.tstate[tableId].history;
  const pairFlags = SPEED.tstate[tableId].pairFlags || [];
  const wins = tableWinCounts(history);
  const playerPairs = pairFlags.filter(p=>p.playerPair).length;
  const bankerPairs = pairFlags.filter(p=>p.bankerPair).length;
  if (countEl) countEl.textContent = '#' + (SPEED.tstate[tableId]?.roundNo || 1);
  if (listEl){
    // P/B/T rows carry the result letter; the two pair rows are a plain grey bead marked
    // with the same corner dot the roads use (blue = player pair, red = banker pair).
    const row = (cls, letter, val) => `<div class="tl-row ${cls}"><span class="tl-badge">${letter}</span><b>${fmtNum(val)}</b></div>`;
    const pairRow = (side, val) => `<div class="tl-row pair ${side}"><span class="tl-badge"><i class="br-pair ${side}"></i></span><b>${fmtNum(val)}</b></div>`;
    listEl.innerHTML = row('player','P',wins.player) + row('banker','B',wins.banker) + row('tie','T',wins.tie) + pairRow('player',playerPairs) + pairRow('banker',bankerPairs);
  }
}
function renderSpeedTileStats(tableId){
  const results = SPEED.tstate[tableId].history;
  const wins = tableWinCounts(results);
  const streak = trailingStreak(results);
  const statsEl = document.getElementById('stats-'+tableId);
  if (statsEl) statsEl.innerHTML = `P <b>${wins.player}</b> · B <b>${wins.banker}</b> · T <b>${wins.tie}</b>`;
  const badgeEl = document.getElementById('hotbadge-'+tableId);
  if (badgeEl) badgeEl.textContent = streak.len >= 3 ? `🔥 ${streak.len}연속 ${streak.side==='player'?t('player'):t('banker')}` : '';
}
/* Paints what is staked on a table - on its tile in the list always, and on the detail screen
   as well when that table is the one open. The two stay in step because they read the same
   per-table state. */
function renderSpeedTileBets(tableId){
  const s = SPEED.tstate[tableId];
  if (!s) return;
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    const amt = s.bets[k] ? fmtNum(s.bets[k]) : '';
    const tile = document.getElementById(`tilebet-${tableId}-${k}`);
    if (tile) tile.textContent = amt;
    const spot = document.getElementById(`tilespot-${tableId}-${k}`);
    if (spot) spot.classList.toggle('staked', !!s.bets[k]);
    if (SPEED.detailTableId===tableId){
      const el = document.getElementById(`mybet-detail-${k}`);
      if (el) el.textContent = amt;
    }
  });
  if (SPEED.detailTableId===tableId) paintBetBoardReadings(tableId);
}
/* The four readings on a spot. There is one player's money on this table, so what is on a spot
   is what this player put there, one head where there is anything at all, and the share is that
   spot's part of everything riding on the round - which is what the percentage on a live board
   means, and is worth reading even with a single player on it. */
function paintBetBoardReadings(tableId){
  const s = SPEED.tstate[tableId];
  if (!s) return;
  const total = speedBetsTotal(s.bets);
  BET_SPOTS.forEach(({key})=>{
    const amt = s.bets[key] || 0;
    const set = (id, v)=>{ const el = document.getElementById(id); if (el) el.textContent = v; };
    set(`pct-detail-${key}`, (total ? Math.round(amt / total * 100) : 0) + '%');
    set(`heads-detail-${key}`, amt ? 1 : 0);
    set(`pool-detail-${key}`, fmtNum(amt));
  });
}
/* the tile's spots take and release the same lock the open table's do, so a round that has gone
   to the cards cannot be bet into from the list either */
function setSpeedTileBetsLocked(tableId, locked){
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    const el = document.getElementById(`tilespot-${tableId}-${k}`);
    if (el){ el.classList.toggle('locked', locked); el.disabled = locked; }
  });
  paintSpeedMultiRow(tableId);
}
/* What is genuinely still pending against the balance. A table's stake only leaves
   STATE.balance for real once betting closes on it - beginSpeedDealing does that subtraction and
   then leaves s.bets holding the confirmed amounts all through dealing and the result, so the
   felt and the multi-bet panel still have something to show. Counting every table's s.bets as
   "locked" without checking phase double-charges the display: a table already in dealing or
   result has had its stake taken out of STATE.balance once for real, and summing its s.bets on
   top of that took it out a second time. With two tables live - one just placed, one still being
   staked - the balance came out ten thousand short of what it should have read. Only a table
   still in 'betting' has money that has not actually moved yet.

   There is one more window: beginSpeedDealing flips the phase to 'dealing' the instant betting
   closes, but the stake is not actually taken out of STATE.balance until every placeBet() write
   has round-tripped the network - and placeSpeedBet() runs synchronously in between on whatever
   table the player taps next. Excluding a table the moment its phase leaves 'betting' would let
   that in-flight stake be spent a second time on another table before beginSpeedDealing finishes
   subtracting it. s.settling covers exactly that gap: true from the moment dealing starts, false
   again once the real subtraction has happened. */
function speedLockedTotal(){
  let locked = 0;
  Object.values(SPEED.tstate).forEach(s=>{
    if (s.phase !== 'betting' && !s.settling) return;
    locked += Object.values(s.bets).reduce((a,b)=>a+b,0);
  });
  return locked;
}
/* A table takes chips while betting is open and nothing has been signed off on it yet. 베팅완료
   closes its board for the round: what was confirmed is what rides. A tap on a spot after it used
   to quietly re-open the bet and add to the stake, so a stray touch on the way to the next round
   staked more than the player had agreed to - and the confirmation on screen no longer described
   what was on the felt. 취소 is still the way back: it takes the whole stake off and re-opens the
   board, which is a deliberate act rather than a slip. */
function speedTableTakesBets(tableId){
  const s = SPEED.tstate[tableId];
  return !!s && s.phase === 'betting' && !s.confirmed;
}
function placeSpeedBet(tableId, type){
  const s = SPEED.tstate[tableId];
  if (!s || s.phase !== 'betting'){ toast(t('notBettingTime'), true); return; }
  if (s.confirmed){ toast(t('alreadyConfirmed'), true); return; }
  const free = STATE.balance - speedLockedTotal();
  // the table's limits apply to each betting position, not to the round as a whole
  const max = tableBetMax(tableId);
  const headroom = Math.max(0, max - s.bets[type]);
  // A chip worth more than is left rides the rest of the balance in rather than being refused:
  // the click still lands, for whatever the player actually has. The table maximum still caps it.
  const stake = Math.min(STATE.selectedChip, headroom, free);
  if (stake <= 0){
    toast(free <= 0 ? t('insufficientBalance') : t('aboveTableMax', {max: fmtNum(max)}), true);
    return;
  }
  s.bets[type] += stake;
  if (stake < STATE.selectedChip && stake === free) toast(t('allInStaked', {amount: fmtNum(stake)}));
  markSpeedBetsUnconfirmed(tableId);
  if (SPEED.detailTableId===tableId) document.getElementById(`spot-detail-${type}`)?.classList.add('selected');
  renderSpeedTileBets(tableId);
  renderSpeedStakedTotal();
  projectSpeedBalance();
}

/* Every screen is built from a template that carries its Korean inline with a data-i18n name
   beside it, and applyI18n swaps that text for whatever language is in force. It only ran on
   load and when the language was changed - so a screen built after that kept the Korean it was
   written with, whatever the player had picked. That is every table screen: the felt read
   플레이어 / 뱅커 / 베팅완료 in all six languages. Screens are painted through here now, so a
   screen speaks the right language from the moment it exists. */
function paintScreen(el, html){
  if (!el) return null;
  el.innerHTML = html;
  applyI18n(el);
  /* A table is the fullscreen screen, and it is painted from four places - opened from the lobby,
     opened while one was already open, re-painted when the language changes, re-painted when a
     request is approved and a watched table becomes a played one. Doing it here means none of
     them can forget, and none of them can leave the covering box on a wrapper that has just been
     thrown away. */
  const wrap = el.querySelector('.speed-detail-wrap');
  if (wrap) mountTableFullscreen(wrap);
  return el;
}

/* ---------------- the fullscreen bars ----------------
   In fullscreen the page header is off the screen, so what it carried gets bars of its own: the
   casino's mark, which round and which shoe, who is playing and for how much, and the way out.
   The phone shows both bars - the round and the shoe at the head, the player and the balance at
   the foot. The desktop shows only the foot, which carries the round, the shoe, the chips and
   the two round buttons, and keeps the ✕ over the video where the reference has it.
   Both bars carry the same readings, so they are written once and painted by class. */
const FS_BAR_ICONS = {
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};
function fsBarHtml(tb, where, mode){
  mode = mode || 'speed';
  const mark = `<span class="fs-mark">${CASINO_MARK_SRC[tb.casino] ? `<img src="${CASINO_MARK_SRC[tb.casino]}" alt="">` : ''}<b>${escapeHtml(tb.casino || '')}</b></span>`;
  const stats = `
    <span class="fs-stat"><i>${t('roundLabel')}</i><b class="fs-round">1</b></span>
    <span class="fs-stat shoe"><i>${t('shoeLabel')}</i><b class="fs-shoe">1</b></span>`;
  if (where === 'top'){
    return `<div class="sd-fs-bar sd-fs-top">${mark}${stats}
      <button class="fs-x" onclick="closeTableScreen()" data-i18n-title="backToList" title="목록으로">✕</button>
    </div>`;
  }
  // Speed's second icon opens the multi-bet sheet - several tables at once, which is Speed's own
  // thing. The avatar's opens the request, the same swap the tray makes.
  const secondIcon = mode === 'avatar'
    ? `<button class="fs-ico" onclick="openAvatarRequestModal('${(AVATAR.previewTableId || (AVATAR.table && AVATAR.table.id) || '')}')" data-i18n-title="btnRequestAvatar" title="아바타 신청">${FS_BAR_ICONS.menu}</button>`
    : `<button class="fs-ico" onclick="toggleSpeedMultiPanel()" data-i18n-title="multiBet" title="멀티 베팅">${FS_BAR_ICONS.menu}</button>`;
  return `<div class="sd-fs-bar sd-fs-bottom">
    ${mark}${stats}
    <span class="fs-who"><em><i>${PERSON_ICON}</i>${escapeHtml(PLAYER?.nickname || PLAYER?.id || '')}</em><b>${PESO} <span class="fs-bal">0</span></b></span>
    <span class="fs-sp"></span>
    <button class="fs-ico" onclick="openGameHistory()" data-i18n-title="gameHistory" title="게임기록">${FS_BAR_ICONS.history}</button>
    ${secondIcon}
  </div>`;
}

/* The head beside a head-count, and the peso beside a sum. Both were characters - 👤 is a
   colour emoji, so it ignored the colour it was set in and stayed its own blue on the red
   spots too, and ₱ is absent from the mono face, so it fell back to a bare P. Drawn and
   set in a face that has it, they take the colour around them and read as what they are. */
const PERSON_ICON = '<svg class="ic-person" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.6 21a7.4 7.4 0 0 1 14.8 0z"/></svg>';
const PESO = '<span class="cur-peso">₱</span>';

/* ---------------- the betting board ----------------
   The felt itself: 플레이어 페어 and 뱅커 페어 across the top, 플레이어 and 뱅커 across the
   bottom in half the board each, and 타이 as a green arch standing between them - a column
   through the top row that ends in a semicircle over the line where 플레이어 meets 뱅커. Every
   spot carries the four readings a live board carries: the share of the round's money on it, how
   many are on it, what is on it, and what it pays. They face inwards - the player side reads from
   the outer edge, the banker side mirrors it - so the two names sit either side of the arch
   rather than at the far ends of the board.

   There used to be a second, flatter board for the table-on-a-page screen: the pairs and 타이 in
   a row of cells with 플레이어 and 뱅커 under them. That screen is gone - a table is the
   fullscreen screen now - so the felt is the board. */
function betBoardHtml(tableId){ return feltBoardHtml(tableId); }
/* the screen is not rebuilt for every change to it, so the board is swapped in place */
function renderBetBoard(tableId){
  const host = document.querySelector('#viewSpeedTable .sd-bets');
  if (!host) return;
  const old = host.querySelector('.bet-board');
  if (old) old.outerHTML = betBoardHtml(tableId);
  applyI18n?.(host);
  renderSpeedTileBets(tableId);
  const s = SPEED.tstate[tableId];
  if (s) ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    const spot = document.getElementById(`spot-detail-${k}`);
    if (spot) spot.classList.toggle('selected', s.bets[k]>0);
  });
  if (s) paintSpeedConfirmState(tableId);   // which is what puts the lock on, confirmed or dealt
}
/* The four corners where the arch cuts into 플레이어 and 뱅커. They are junctions rather than
   corners of any box - two elements' edges crossing - so nothing on either of them can round
   them; each is drawn over instead, in shared/game-ui.css. Two elements, four corners: each
   carries one at ::before and its mirror at ::after. */
const BB_JOINS = '<i class="bb-joins bb-joins-row"></i><i class="bb-joins bb-joins-foot"></i>';
const BET_SPOTS = [
  {key:'playerPair', cls:'bb-pp', side:'player', i18n:'playerPair', ko:'플레이어 페어', odds:'11:1'},
  {key:'bankerPair', cls:'bb-bp', side:'banker', i18n:'bankerPair', ko:'뱅커 페어',     odds:'11:1'},
  {key:'player',     cls:'bb-pl', side:'player', i18n:'player',     ko:'플레이어',      odds:'1:1'},
  {key:'banker',     cls:'bb-bk', side:'banker', i18n:'banker',     ko:'뱅커',          odds:'0.95:1'},
  {key:'tie',        cls:'bb-tie',side:'tie',    i18n:'tie',        ko:'타이',          odds:'8:1'},
];
function betSpotHtml(tableId, s){
  return `<div class="bet-spot ${s.cls} ${s.side}" id="spot-detail-${s.key}" onclick="placeSpeedBet('${tableId}','${s.key}')">
    <div class="bb-meta">
      <span class="bb-pct" id="pct-detail-${s.key}">0%</span>
      <span class="bb-stats"><i>${PERSON_ICON}<b id="heads-detail-${s.key}">0</b></i><i>${PESO}<b id="pool-detail-${s.key}">0</b></i></span>
    </div>
    <div class="bb-name">
      <span class="bb-label" data-i18n="${s.i18n}">${s.ko}</span>
      <span class="bb-odds">${s.odds}</span>
    </div>
    <div class="my-bet" id="mybet-detail-${s.key}"></div>
  </div>`;
}
function feltBoardHtml(tableId){
  const spot = key => betSpotHtml(tableId, BET_SPOTS.find(s=>s.key===key));
  return `<div class="bet-board">
    <div class="bb-row bb-top">
      ${spot('playerPair')}
      <div class="bb-arch-gap"></div>
      ${spot('bankerPair')}
    </div>
    <div class="bb-row bb-main">
      ${spot('player')}
      ${spot('banker')}
    </div>
    ${spot('tie')}
    ${BB_JOINS}
  </div>`;
}

/* ---------------- avatar's board is Speed's, read-only ----------------
   The same felt as Speed's board, kept as its own
   small set of functions with an -avatar id suffix rather than parametrizing Speed's
   (which take a clickable tableId throughout) - no onclick, filled from AVATAR.bets instead of
   a chip tray, since the avatar places the bet automatically rather than the player. */
function avatarBetBoardHtml(){ return avatarFeltBoardHtml(); }
function avatarBetSpotHtml(s){
  return `<div class="bet-spot ${s.cls} ${s.side}" id="spot-avatar-${s.key}" onclick="placeAvatarBet('${s.key}')">
    <div class="bb-meta">
      <span class="bb-pct" id="pct-avatar-${s.key}">0%</span>
      <span class="bb-stats"><i>${PERSON_ICON}<b id="heads-avatar-${s.key}">0</b></i><i>${PESO}<b id="pool-avatar-${s.key}">0</b></i></span>
    </div>
    <div class="bb-name">
      <span class="bb-label" data-i18n="${s.i18n}">${s.ko}</span>
      <span class="bb-odds">${s.odds}</span>
    </div>
    <div class="my-bet" id="mybet-avatar-${s.key}"></div>
  </div>`;
}
function avatarFeltBoardHtml(){
  const spot = key => avatarBetSpotHtml(BET_SPOTS.find(s=>s.key===key));
  return `<div class="bet-board">
    <div class="bb-row bb-top">
      ${spot('playerPair')}
      <div class="bb-arch-gap"></div>
      ${spot('bankerPair')}
    </div>
    <div class="bb-row bb-main">
      ${spot('player')}
      ${spot('banker')}
    </div>
    ${spot('tie')}
    ${BB_JOINS}
  </div>`;
}
/* mirrors renderSpeedTileBets + paintBetBoardReadings, but reading AVATAR.bets - the .locked
   class in the markup above already keeps every spot inert, so there's no click state to track,
   only amounts to paint in as the avatar's auto-bet lands each round. */
/* Putting a chip on the felt. The avatar plays what is on the board when the clock runs out, so
   this is the instruction - and it is the same shape as Speed's placeSpeedBet: only while betting
   is open, never past the table maximum, and a chip worth more than is left rides the rest of the
   balance in rather than being refused. */
function avatarTakesBets(){ return AVATAR.phase === 'betting' && !!AVATAR.request; }
function placeAvatarBet(type){
  if (!avatarTakesBets()){ toast(t('notBettingTime'), true); return; }
  const free = STATE.balance - avatarCommittedAmount();
  const max = Number(AVATAR.table?.betMax) || Infinity;
  const headroom = Math.max(0, max - (AVATAR.bets[type] || 0));
  const stake = Math.min(STATE.selectedChip, headroom, free);
  if (stake <= 0){
    toast(free <= 0 ? t('insufficientBalance') : t('aboveTableMax', {max: fmtNum(max)}), true);
    return;
  }
  AVATAR.bets[type] = (AVATAR.bets[type] || 0) + stake;
  AVATAR.committed = true;          // spoken for from the moment a chip lands
  if (stake < STATE.selectedChip && stake === free) toast(t('allInStaked', {amount: fmtNum(stake)}));
  document.getElementById(`spot-avatar-${type}`)?.classList.add('selected');
  renderAvatarBetSpots();
  projectAvatarBalance();
}
function clearAvatarBets(){
  if (!avatarTakesBets()){ toast(t('notBettingTime'), true); return; }
  AVATAR.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  AVATAR.committed = false;
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>
    document.getElementById(`spot-avatar-${k}`)?.classList.remove('selected'));
  renderAvatarBetSpots();
  projectAvatarBalance();
}
/* the header follows the chips, as it does on a Speed table - the stake has not left the balance
   yet, so what is shown is what is left to stake */
function projectAvatarBalance(){ paintPlayableBalance(); }
function renderAvatarBetSpots(){
  const total = Object.values(AVATAR.bets).reduce((a,b)=>a+b,0);
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    const amt = AVATAR.bets[k] || 0;
    const set = (id, v)=>{ const el = document.getElementById(id); if (el) el.textContent = v; };
    set(`mybet-avatar-${k}`, amt ? fmtNum(amt) : '');
    set(`pct-avatar-${k}`, (total ? Math.round(amt / total * 100) : 0) + '%');
    set(`heads-avatar-${k}`, amt ? 1 : 0);
    set(`pool-avatar-${k}`, fmtNum(amt));
  });
  const tot = document.getElementById('avatarStakedTotal');
  if (tot) tot.textContent = fmtNum(total);
  const chips = document.getElementById('avatarStakedChips');
  if (chips) chips.innerHTML = total ? chipStackHtml(total) : '';
}
/* the screen is not rebuilt for every change to it, so the board is swapped in
   place - mirrors renderBetBoard for Speed's own board */
function renderAvatarBetBoard(){
  const host = document.querySelector('#viewAvatarTable .sd-bets');
  if (!host) return;
  const old = host.querySelector('.bet-board');
  if (old) old.outerHTML = avatarBetBoardHtml();
  applyI18n?.(host);
  renderAvatarBetSpots();
}

/* ---------------- speed single-table detail screen (opened from a tile) ---------------- */
function openSpeedTableDetail(tableId, preserveScroll){
  const s = SPEED.tstate[tableId], tb = SPEED.tables[tableId];
  if (!s || !tb) return;
  MODE = 'speed';
  SPEED.detailTableId = tableId;
  showView('viewSpeedTable');
  releaseFsFollowers();     // whatever is on loan to the old screen, before it is thrown away
  paintScreen(document.getElementById('viewSpeedTable'), speedDetailShellHtml(tableId));
  renderSpeedTileBets(tableId);
  renderSpeedDetailRoad(tableId);
  paintSpeedFsBars(tableId);
  setSpeedTilePhaseText(tableId, s.phase==='betting'?t('phaseBetting'):s.phase==='dealing'?t('phaseDealing'):'');
  setSpeedTileTimer(tableId, Math.max(0, s.secondsLeft));
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    const spot = document.getElementById(`spot-detail-${k}`);
    if (spot) spot.classList.toggle('selected', s.bets[k]>0);
  });
  paintSpeedConfirmState(tableId);          // which is what puts the lock on, confirmed or dealt
  renderAiPrediction(tableId);
  if (s.phase==='result' && s._sim) revealSpeedDetailCards(s._sim, true);
}
function closeSpeedTableDetail(){
  SPEED.detailTableId = null;
  // the loans go home before the screen holding them is thrown away
  unmountTableFullscreen();
  document.getElementById('viewSpeedTable').innerHTML = '';
  showView('viewLobby');
}
function speedDetailShellHtml(tableId){
  const tb = SPEED.tables[tableId];
  return `
  <div class="speed-detail-wrap sd-live">
    <!-- the two bars belong to the fullscreen screen and are drawn nowhere else. The phone gets
         both; the desktop gets only the foot, where the round, the shoe and the chips live. -->
    ${fsBarHtml(tb, 'top')}
    <div class="speed-detail-grid">
      <div class="sd-stage">
        <button class="icon-btn speed-detail-close" onclick="closeSpeedTableDetail()" style="position:absolute;top:14px;left:14px;z-index:2;background:rgba(0,0,0,.55);color:#fff;border-color:rgba(255,255,255,.15);" data-i18n-title="backToList" title="목록으로">✕</button>
        <div class="sd-stage-top">
          <div class="sd-type-badge">SPEED</div>
          <div class="sd-table-id-mini">${escapeHtml(tb.name)}</div>
          <div class="sd-limit-text">${fmtNum(tb.betMin)} ~ ${fmtNum(tb.betMax)}</div>
        </div>
        <div class="phase-banner" id="phase-detail">${t('phaseBetting')}</div>
        <div class="sd-stage-icons">
          <button onclick="toggleBrowserFullscreen()" data-i18n-title="fullscreen" title="전체화면"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
          <button onclick="this.classList.toggle('muted')" data-i18n-title="mute" title="음소거">
            <svg class="icon-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/></svg>
            <svg class="icon-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M23 9l-6 6"/><path d="M17 9l6 6"/></svg>
          </button>
          <button onclick="this.classList.toggle('active')" data-i18n-title="viewToggle" title="화면 보기 전환"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg></button>
          <button onclick="openTipModal()" data-i18n-title="giveTip" title="팁"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="5"/><path d="M9 21l3-4 3 4"/><path d="M12 21v-4"/></svg></button>
          <button class="sd-ico-history" onclick="openGameHistory()" data-i18n-title="gameHistory" title="게임기록"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></button>
          <button class="sd-ico-ai" id="aiToggleBtn" onclick="toggleAiPanel()" data-i18n-title="aiPredictTitle" title="AI 예측"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.4"/></svg></button>
        </div>
        ${aiPanelHtml()}
        <div class="table-felt">
          <div class="cards-area">
            <div class="hand player"><div class="cards" id="playerCardsDetail"></div><div class="score" id="playerScoreDetail"></div></div>
            <div class="hand banker"><div class="cards" id="bankerCardsDetail"></div><div class="score" id="bankerScoreDetail"></div></div>
          </div>
        </div>
        <div class="timer-ring-wrap" id="timerRingWrapDetail"><svg width="64" height="64"><circle cx="32" cy="32" r="27" stroke="var(--line)" stroke-width="5" fill="none"/><circle id="timerArcDetail" cx="32" cy="32" r="27" stroke="var(--jade)" stroke-width="5" fill="none" stroke-dasharray="169.6" stroke-dashoffset="0" stroke-linecap="round"/></svg><div class="txt" id="timer-detail">30</div></div>
      </div>
      <!-- The board and the betting spots share one wrapper. It is display:contents everywhere
           except a desktop fullscreen, so on the ordinary screen it is not there at all and its
           children land on the table grid exactly as they did; in fullscreen it becomes the
           strip over the foot of the video and puts them on three columns of its own. -->
      <div class="sd-underbar">
      ${avatarScoreboardHtml('detail')}
      <div class="sd-bets">
        ${betBoardHtml(tableId)}
        <div class="sd-chip-tray">
          <button class="btn btn-sm" onclick="clearSpeedDetailBets('${tableId}')" data-i18n="cancelBet">취소</button>
          ${CHIP_VALUES.map(v=>`<div class="chip ${v===STATE.selectedChip?'selected':''}" data-chip="${v}" onclick="selectChip(${v})" style="background-image:url('${chipFaceUrl(v)}')" aria-label="${chipLabel(v)}"></div>`).join('')}
          <span class="spacer"></span>
          <button class="btn btn-sm btn-gold" id="speedConfirmBtn" onclick="confirmSpeedBetDetail('${tableId}')" data-i18n="betComplete">베팅완료</button>
          <button class="btn btn-sm" onclick="repeatLastSpeedBetDetail('${tableId}')" data-i18n="repeatBet">반복</button>
          <!-- Two labels, one button. Fullscreen turns the tray's buttons into 46px rings, and
               "멀티 베팅" does not go in one - so the short form is what shows there. -->
          <button class="btn btn-sm sd-multi-btn" id="speedMultiBtn" onclick="toggleSpeedMultiPanel()">
            <span class="mb-long" data-i18n="multiBet">멀티 베팅</span><span class="mb-short" data-i18n="multiBetShort">멀티</span><b class="sm-count" id="speedMultiCount"></b>
          </button>
        </div>
      </div>
      </div>
    </div>
    ${fsBarHtml(tb, 'bottom')}
    <!-- the multi-bet sheet lives outside the grid: it floats over the screen rather than
         sitting in the layout, so opening it moves nothing else on the page -->
    <div class="speed-multi" id="speedMultiPanel"></div>
  </div>`;
}
function clearSpeedDetailCards(){
  const p = document.getElementById('playerCardsDetail'), b = document.getElementById('bankerCardsDetail');
  if (p) p.innerHTML = ''; if (b) b.innerHTML = '';
  const ps = document.getElementById('playerScoreDetail'), bs = document.getElementById('bankerScoreDetail');
  if (ps) ps.textContent = ''; if (bs) bs.textContent = '';
}
async function revealSpeedDetailCards(sim, instant){
  const pEl = document.getElementById('playerCardsDetail'), bEl = document.getElementById('bankerCardsDetail');
  if (!pEl || !bEl) return;
  pEl.innerHTML = ''; bEl.innerHTML = '';
  for (const [side,i] of dealSequence(sim)){
    (side==='player'?pEl:bEl).insertAdjacentHTML('beforeend', cardHtml(sim[side].cards[i], i));
    if (!instant) await new Promise(r=>setTimeout(r, 260));
  }
  document.getElementById('playerScoreDetail').textContent = sim.player.score;
  document.getElementById('bankerScoreDetail').textContent = sim.banker.score;
}
function clearSpeedDetailBets(tableId){
  const s = SPEED.tstate[tableId]; if (!s || s.phase!=='betting') return;
  s.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    document.getElementById(`spot-detail-${k}`)?.classList.remove('selected');
  });
  markSpeedBetsUnconfirmed(tableId);
  renderSpeedTileBets(tableId);
  renderSpeedStakedTotal();
  projectSpeedBalance();
}
/* ---------------- nothing rides until 베팅완료 ----------------
   What is on the spots is only an intention. A table plays the amounts the player confirmed and
   nothing else: anything staked and left unconfirmed when betting closes is pushed back, the way
   a dealer returns chips that were never actually placed. Touching a spot after confirming
   re-opens the bet, so the confirmation always describes exactly what is on the felt. */
function markSpeedBetsUnconfirmed(tableId){
  const s = SPEED.tstate[tableId];
  if (!s) return;
  s.confirmed = null;
  paintSpeedConfirmState(tableId);
}
function speedBetsTotal(bets){ return Object.values(bets || {}).reduce((a,b)=>a+b,0); }
function confirmSpeedBets(tableId, quiet){
  const s = SPEED.tstate[tableId];
  if (!s || s.phase !== 'betting') { if (!quiet) toast(t('notBettingTime'), true); return false; }
  returnUnderMinSpeedBets(tableId);          // a short bet cannot be confirmed either
  if (speedBetsTotal(s.bets) <= 0){ if (!quiet) toast(t('nothingToConfirm'), true); return false; }
  s.confirmed = {...s.bets};
  paintSpeedConfirmState(tableId);
  /* 베팅완료 is the moment the player expects to see the money go. It is already off the balance
     by then - it comes off as each chip lands - but returnUnderMinSpeedBets() just above can hand
     a short bet back, and confirming from the multi-bet sheet stakes several tables at once, so
     the figure is re-read here rather than assumed to be current. */
  projectSpeedBalance();
  if (!quiet) toast(t('betCompleteToast'));
  return true;
}
function confirmSpeedBetDetail(tableId){ confirmSpeedBets(tableId); }
/* the sheet stakes several tables at once, so its button confirms every one of them */
function confirmAllSpeedBets(){
  let n = 0;
  Object.keys(SPEED.tstate || {}).forEach(id=>{ if (confirmSpeedBets(id, true)) n++; });
  toast(n ? t('betConfirmedCount', {n}) : t('nothingToConfirm'), !n);
}
/* the open table's spots and the sheet's rows both show whether what is on them is riding - and
   both boards take the lock together, so a table closed to further chips is closed on the felt
   and on its tile in the strip alike */
function paintSpeedConfirmState(tableId){
  const s = SPEED.tstate[tableId];
  if (!s) return;
  const pending = speedBetsTotal(s.bets) > 0 && !s.confirmed;
  /* Two ways to be shut, and they do not look alike. A round gone to the cards is dimmed right
     down - there is nothing to read on it any more. A round the player has signed off is still a
     live betting round they will want to read for the next thirty seconds, so it is marked as
     closed rather than darkened. Either way it takes no more chips. */
  const dealt = s.phase !== 'betting';
  const signedOff = !dealt && !!s.confirmed;
  if (SPEED.detailTableId === tableId){
    document.getElementById('viewSpeedTable')?.classList.toggle('bets-pending', pending);
    const btn = document.getElementById('speedConfirmBtn');
    if (btn){ btn.classList.toggle('pending', pending); btn.classList.toggle('done', !!s.confirmed); }
    ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
      const spot = document.getElementById(`spot-detail-${k}`);
      if (!spot) return;
      spot.classList.toggle('locked', dealt);
      spot.classList.toggle('bets-closed', signedOff);
    });
    /* The stretch of 플레이어's and 뱅커's border that runs round the arch is drawn on the board,
       not on either spot - it has to be, because a spot clips its own children. So the dimming the
       spots take when a round shuts does not reach it, and a closed board was left with two bright
       curves on it. The board carries the same state, and dims them with it. */
    const board = document.querySelector('#viewSpeedTable .bet-board');
    if (board){
      board.classList.toggle('board-locked', dealt);
      board.classList.toggle('board-closed', signedOff);
    }
  }
  setSpeedTileBetsLocked(tableId, dealt || signedOff);
  document.getElementById(`smrow-${tableId}`)?.classList.toggle('pending', pending);
}
/* ============================================================
   다음 게임 예측 — the AI panel
   ============================================================
   The engine is shared/baccarat-ai.js; read its header before reading this. The short of it:
   the only real signal in baccarat is what is left in the shoe, it is far too small to beat the
   commission, and this panel is written to SAY so rather than to sell a number.

   So the panel shows three things a punter can act on and one they should:
     - the probabilities, with the margin of error the sampling actually carries
     - the expected value of each side, which is negative on both, always
     - whether the model resolved anything at all, or is simply repeating the base rate

   It is a read on the table, not advice, and the panel says as much on its face. */
let AI_PANEL_OPEN = false;
let AI_LAST = null;              // the prediction standing against the round now being dealt
function aiPanelHtml(){
  return `<div class="ai-panel${AI_PANEL_OPEN?' open':''}" id="aiPanel">
    <div class="ai-head"><b data-i18n="aiPredictTitle">${t('aiPredictTitle')}</b>
      <button class="ai-close" onclick="toggleAiPanel(false)" aria-label="close">✕</button></div>
    <div class="ai-body" id="aiBody"><p class="hint" data-i18n="aiWaiting">${t('aiWaiting')}</p></div>
  </div>`;
}
function toggleAiPanel(open){
  const el = document.getElementById('aiPanel');
  if (!el) return;
  AI_PANEL_OPEN = open === undefined ? !el.classList.contains('open') : !!open;
  el.classList.toggle('open', AI_PANEL_OPEN);
  document.getElementById('aiToggleBtn')?.classList.toggle('active', AI_PANEL_OPEN);
  if (AI_PANEL_OPEN) renderAiPrediction(aiSourceTableId());
}
/* Run once when betting opens, not on every tick: the sampling is a few thousand hands of work
   and the answer cannot change until a card leaves the shoe. */
/* Which table the panel is reading: a speed table keeps its shoe on SPEED.tstate, an avatar
   session keeps its own on AVATAR. Both have a shoe and a history, which is all the model wants -
   and until this took either, opening the panel on the avatar screen drew an empty box. */
function aiSource(tableId){
  if (tableId && SPEED.tstate[tableId]) return SPEED.tstate[tableId];
  if (MODE === 'avatar' && AVATAR.shoe) return AVATAR;
  return null;
}
function aiSourceTableId(){
  return SPEED.detailTableId || (MODE === 'avatar' && AVATAR.table ? AVATAR.table.id : null);
}
function renderAiPrediction(tableId){
  const s = aiSource(tableId);
  const body = document.getElementById('aiBody');
  if (!s || !body) return;
  if (!AI_PANEL_OPEN){ AI_LAST = null; return; }
  const p = predictNextHand(s.shoe, s.history, {decks:8});
  if (!p.ok){ body.innerHTML = `<p class="hint">${t('aiNoShoe')}</p>`; AI_LAST = null; return; }
  AI_LAST = {tableId: tableId || aiSourceTableId(), roundId: s.currentRoundId, roundNo: s.roundNo, shoeNo: s.shoe?.no,
             player:p.player, banker:p.banker, tie:p.tie, side:p.rec.side, ev:p.rec.edge,
             resolved:p.rec.resolved, cardsLeft:p.cardsLeft};
  const pctOf = v => (v*100).toFixed(1) + '%';
  const err = (2*sampleMargin(p.banker, p.comp.trials)*100).toFixed(1);
  const evTxt = (p.rec.edge*100).toFixed(2) + '%';
  const conf = t('aiConf_' + p.rec.confidence);
  body.innerHTML = `
    <div class="ai-bars">
      ${[['player',p.player],['banker',p.banker],['tie',p.tie]].map(([k,v])=>`
        <div class="ai-bar ${k}"><span class="ai-k">${t(k)}</span>
          <span class="ai-track"><i style="width:${Math.max(2,Math.min(100,v*100)).toFixed(1)}%"></i></span>
          <b class="ai-v">${pctOf(v)}</b></div>`).join('')}
    </div>
    <div class="ai-rec ${p.rec.side}">
      <span data-i18n="aiRecommendation">${t('aiRecommendation')}</span>
      <b>${t(p.rec.side)}</b>
    </div>
    <div class="ai-meta">
      <div><i>${t('aiExpectedValue')}</i><b class="${p.rec.positive?'pos':p.rec.edge<0?'neg':'flat'}">${evTxt}</b></div>
      <div><i>${t('aiConfidence')}</i><b>${conf}</b></div>
      <div><i>${t('aiMarginLabel')}</i><b>±${err}%</b></div>
      <div><i>${t('aiCardsLeft')}</i><b>${fmtNum(p.cardsLeft)}</b></div>
    </div>
    <p class="ai-note">${p.rec.resolved ? t('aiNoteResolved') : t('aiNoteUnresolved')}</p>
    <p class="ai-note warn">${t('aiNoteHouse')}</p>`;
  applyI18n(body);
}
/* Every prediction is kept against what actually happened, which is what makes a paper-betting
   record out of a panel. One row per hand, the shape the brief's section 20 asks for, so model
   versions can be compared on the same hands later rather than argued about. */
const AI_MODEL_VERSION = 'v1-composition';
async function logAiPrediction(tableId, actual){
  const a = AI_LAST;
  AI_LAST = null;
  if (!a || a.tableId !== tableId || !db) return;
  const won = actual === 'tie' ? null : actual === a.side;
  const profit = actual === 'tie' ? 0 : (won ? (a.side === 'banker' ? 0.95 : 1) : -1);
  try{
    await db.collection('aiPredictions').doc(uuidv4()).set({
      tableId, shoeId: `${tableId}#${a.shoeNo}`, gameId: a.roundId, roundNo: a.roundNo,
      prediction: a.side, playerProbability: a.player, bankerProbability: a.banker,
      tieProbability: a.tie, expectedValue: a.ev, resolved: a.resolved, cardsLeft: a.cardsLeft,
      modelVersion: AI_MODEL_VERSION, actualResult: actual,
      winLoss: won === null ? 'push' : (won ? 'win' : 'loss'),
      betAmount: 1, commission: a.side === 'banker' ? 0.05 : 0, profit,   // paper units, never money
      memberId: PLAYER?.id || null, createdAt: new Date().toISOString(),
    });
  }catch(e){ console.error('ai prediction log failed', e); }
}

function repeatLastSpeedBetDetail(tableId){
  const s = SPEED.tstate[tableId]; if (!s || s.phase!=='betting') return;
  if (s.confirmed){ toast(t('alreadyConfirmed'), true); return; }   // the board is closed, as the spots are
  if (!s.lastBets || !Object.values(s.lastBets).some(v=>v>0)){ toast(t('repeatNoPrev'), true); return; }
  const need = Object.values(s.lastBets).reduce((a,b)=>a+b,0);
  if (STATE.balance - speedLockedTotal() < need){ toast(t('insufficientBalance'), true); return; }
  const max = tableBetMax(tableId);
  if (Object.entries(s.lastBets).some(([k,v]) => v > 0 && (s.bets[k]||0) + v > max)){
    toast(t('aboveTableMax', {max: fmtNum(max)}), true); return;
  }
  Object.entries(s.lastBets).forEach(([k,v])=>{ if (v>0){ s.bets[k] = (s.bets[k]||0) + v; document.getElementById(`spot-detail-${k}`)?.classList.add('selected'); } });
  markSpeedBetsUnconfirmed(tableId);
  renderSpeedTileBets(tableId);
  renderSpeedStakedTotal();
  projectSpeedBalance();
}
/* What the player has left to stake, on every surface that shows it. The page header was the only
   one repainted here; the fullscreen bar carries its own copy of the figure and was left to pick
   the change up on the next clock tick, so in fullscreen - which is where the table is actually
   played - money placed did not come off the balance until as much as a second later. Stake three
   chips quickly and the number stood still and then jumped. It moves with the chips now. */
function projectSpeedBalance(){ paintPlayableBalance(); }
/* One loop drives every table's clock, so it must never wait on any of them. It used to await
   the phase changes, and a phase change is not quick: closing betting writes each staked spot to
   the cage over the network and then deals the cards one at a time, a second and a half of
   animation on its own. Every table behind that one in the loop stopped counting until it
   finished - stake the room from the multi-bet rail on a slow link and the whole screen froze.
   The clock now only counts. A phase change is started and left to finish on its own. */
function tickAllSpeedTables(){
  for (const tableId of Object.keys(SPEED.tstate)){
    const s = SPEED.tstate[tableId];
    s.secondsLeft--;
    if (s.phase==='betting'){
      setSpeedTileTimer(tableId, Math.max(0,s.secondsLeft));
      if (s.secondsLeft <= 0) startSpeedPhase(tableId, beginSpeedDealing);
    } else if (s.phase==='dealing'){
      if (s.secondsLeft <= 0) startSpeedPhase(tableId, beginSpeedResult);
    } else if (s.phase==='result'){
      setSpeedTileTimer(tableId, Math.max(0,s.secondsLeft));
      if (s.secondsLeft <= 0) beginSpeedBetting(tableId);
    }
  }
}
/* A table runs one phase change at a time. The guard is what keeps a slow round honest: while
   the cage is still taking the bets, the clock keeps counting down and would otherwise call the
   result in on a hand that has not been dealt yet - which read the cards off an empty round and
   threw. Held back, it simply tries again on the next second. A failure is caught here as well,
   so one table losing its connection cannot stop the rest of the room. */
const speedPhaseBusy = new Set();
function startSpeedPhase(tableId, fn){
  if (speedPhaseBusy.has(tableId)) return;
  speedPhaseBusy.add(tableId);
  Promise.resolve()
    .then(()=>fn(tableId))
    .catch(err=>{
      // A round that could not be put through leaves the table mid-phase, and a table stuck in
      // dealing never deals again - its clock runs on into the negative for ever. Say so and
      // start it over on a fresh round, which is the only state it can safely be left in.
      console.error('speed phase failed on', tableId, err);
      if (SPEED.detailTableId === tableId) toast(t('roundFailed'), true);
      try { beginSpeedBetting(tableId); } catch (e){ console.error('speed recovery failed on', tableId, e); }
    })
    .finally(()=>speedPhaseBusy.delete(tableId));
}
function setSpeedTileTimer(tableId, v){
  const el = document.getElementById('timer-'+tableId); if (el) el.textContent = v;
  if (SPEED.detailTableId===tableId){
    const d = document.getElementById('timer-detail'); if (d) d.textContent = v;
    updateSpeedTimerRing(tableId, v);
    paintSpeedFsBars(tableId);   // the fullscreen bars carry the round, the shoe and the balance
  }
  paintSpeedMultiRow(tableId);   // the multi-bet panel counts its neighbours down too
}
/* The open table's ring only ever printed a number - the arc around it was drawn once, full, and
   left there, so the countdown had a dial that never moved. It winds down against whatever the
   phase it is in is counted from, the way the avatar table's does. */
function updateSpeedTimerRing(tableId, secLeft){
  const s = SPEED.tstate[tableId]; if (!s) return;
  const total = s.phase==='betting' ? SPEED_BETTING_SECONDS
              : s.phase==='dealing' ? SPEED_DEALING_SECONDS : SPEED_RESULT_SECONDS;
  const arc = document.getElementById('timerArcDetail');
  if (arc){ const c = 169.6; arc.style.strokeDashoffset = c * (1 - Math.max(0,secLeft)/total); }
  document.getElementById('timerRingWrapDetail')?.classList.toggle('urgent', secLeft <= 5 && secLeft > 0);
}
// The list no longer captions the phase - only the open table does.
function setSpeedTilePhaseText(tableId, txt){
  if (SPEED.detailTableId!==tableId || !txt) return;
  const d = document.getElementById('phase-detail'); if (d) d.textContent = txt;
}
function beginSpeedBetting(tableId){
  const s = SPEED.tstate[tableId];
  const hadBets = Object.values(s.bets).some(v=>v>0);
  if (hadBets) s.lastBets = {...s.bets};
  s.phase = 'betting'; s.secondsLeft = SPEED_BETTING_SECONDS; s.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0}; s.currentRoundId = uuidv4();
  if (SPEED.detailTableId === tableId) renderAiPrediction(tableId);   // read the shoe once a round
  s.settling = false;
  s.confirmed = null;
  // the hand belongs to the round that just ended; clearing it is what lets "no hand, no result"
  // in beginSpeedResult mean this round's hand rather than possibly the last one's
  s._sim = null;
  ['player','tie','banker','playerPair','bankerPair'].forEach(k=>{
    if (SPEED.detailTableId===tableId) document.getElementById(`spot-detail-${k}`)?.classList.remove('selected','locked');
  });
  paintSpeedConfirmState(tableId);          // a fresh round: nothing confirmed, both boards open
  renderSpeedTileBets(tableId);
  renderSpeedStakedTotal();
  // the header can be showing this table's stake projected off the balance - clearing s.bets
  // above without this leaves it stuck low with nothing actually riding, which is exactly what
  // happens when a bet fails to reach the cage: the table recovers to a clean round, but the
  // balance display never did
  projectSpeedBalance();
  setSpeedTilePhaseText(tableId, t('phaseBetting'));
  const scoreEl = document.getElementById('score-'+tableId); if (scoreEl) scoreEl.textContent = '';
  if (SPEED.detailTableId===tableId) clearSpeedDetailCards();
}
async function beginSpeedDealing(tableId){
  const s = SPEED.tstate[tableId];
  s.phase = 'dealing'; s.secondsLeft = SPEED_DEALING_SECONDS;
  // still counts as locked until the balance actually moves below - see speedLockedTotal
  s.settling = true;
  paintSpeedConfirmState(tableId);          // betting is shut: both boards take the lock
  setSpeedTilePhaseText(tableId, t('phaseDealing'));
  returnUnderMinSpeedBets(tableId);   // a short bet never reaches the felt
  // Only what was confirmed rides. Chips left on a spot without pressing 베팅완료 are pushed
  // back untouched - they were never actually placed.
  const unconfirmed = speedBetsTotal(s.bets) - speedBetsTotal(s.confirmed);
  s.bets = s.confirmed ? {...s.confirmed} : {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
  s.confirmed = null;
  if (unconfirmed > 0){
    renderSpeedTileBets(tableId);
    renderSpeedStakedTotal();
    projectSpeedBalance();
    toast(t('betNotConfirmed', {amount: fmtNum(unconfirmed)}), true);
  }
  paintSpeedConfirmState(tableId);
  for (const [betType, amount] of Object.entries(s.bets)){
    if (amount > 0) await placeBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:s.currentRoundId, betType, amount, staff:CAGE_LEDGER_SOURCE.speed});
  }
  const totalBet = Object.values(s.bets).reduce((a,b)=>a+b,0);
  if (totalBet > 0){ STATE.balance -= totalBet; }
  s.settling = false;
  s._sim = simulateRound(s.shoe);
  if (SPEED.detailTableId===tableId) await revealSpeedDetailCards(s._sim);
}
/* Table limits. A baccarat table posts a minimum and a maximum and both apply per betting
   position, so a chip that would take one spot over the max is refused outright, and a spot
   left standing under the minimum when betting closes is pushed back rather than played. */
function tableBetMax(tableId){ return Number(SPEED.tables[tableId]?.betMax) || Infinity; }
function tableBetMin(tableId){ return Number(SPEED.tables[tableId]?.betMin) || 0; }
function returnUnderMinSpeedBets(tableId){
  const s = SPEED.tstate[tableId], min = tableBetMin(tableId);
  let returned = 0;
  for (const [k, v] of Object.entries(s.bets)){
    if (v > 0 && v < min){ returned += v; s.bets[k] = 0; }
  }
  if (returned > 0){
    renderSpeedTileBets(tableId);
    renderSpeedStakedTotal();
    /* The money is back on the balance here, so the balance is re-read here. Leaving it to the
       caller missed the case that matters most: when the short bet was the only thing on the
       felt, confirmSpeedBets returns early with "nothing to confirm" - before it ever gets to
       repaint - and the chip was handed back while the header went on showing it as staked. */
    projectSpeedBalance();
    toast(t('betReturnedBelowMin', {amount: fmtNum(returned)}), true);
  }
  return returned;
}

/* A roadmap is the record of one shoe, so when the cut card ends the shoe the road starts
   over on the fresh one rather than running on across the change. */
function advanceSpeedShoe(tableId){
  const s = SPEED.tstate[tableId];
  const next = advanceShoe(s.shoe);
  if (next.no === s.shoe.no) return false;
  s.shoe = next;
  s.history = []; s.pairFlags = [];
  if (SPEED.tables[tableId]) SPEED.tables[tableId].shoeNo = next.no;
  if (SPEED.detailTableId === tableId) toast(`[${SPEED.tables[tableId].name}] ${t('shoeChanged', {no: next.no})}`);
  return true;
}
async function beginSpeedResult(tableId){
  const s = SPEED.tstate[tableId];
  // no hand, no result: the deal is still going through, so leave the table where it is and let
  // the next second call it in rather than reading the cards off a round that has none
  if (!s._sim) return;
  s.phase = 'result'; s.secondsLeft = SPEED_RESULT_SECONDS;
  const sim = s._sim;
  const tb = SPEED.tables[tableId];
  setSpeedTilePhaseText(tableId, sim.result==='player' ? 'PLAYER WIN' : sim.result==='banker' ? 'BANKER WIN' : 'TIE');
  const scoreEl = document.getElementById('score-'+tableId);
  if (scoreEl) scoreEl.textContent = `P${sim.player.score} : B${sim.banker.score}`;
  // kept on the state, not just painted, so the multi-bet panel still shows it when reopened
  s.lastResult = {p: sim.player.score, b: sim.banker.score, side: sim.result};
  paintSpeedMultiRow(tableId);

  let totalPayout = 0;
  for (const [betType, amount] of Object.entries(s.bets)){
    if (amount <= 0) continue;
    const payout = await settleBet(db, {memberId:PLAYER.id, casino:PLAYER.casino, tableId, roundId:s.currentRoundId, betType, amount, resultInfo:sim, staff:CAGE_LEDGER_SOURCE.speed});
    totalPayout += payout;
    MY_BET_LOG.unshift({tableName:tb.name, roundNo:s.roundNo, betType, amount, payout, mode:'speed', dt:new Date().toISOString()});
    SPEED.allBets.push({relatedTableId:tableId, amount:-amount, category:'bet', createdAt:new Date().toISOString()});
  }
  logAiPrediction(tableId, sim.result);   // the paper-betting record, win or lose
  const staked = Object.values(s.bets).reduce((a,x)=>a+x, 0);
  if (totalPayout > 0) STATE.balance += totalPayout;
  if (staked > 0) toast(`[${tb.name}] ${roundOutcomeText(staked, totalPayout)}`);
  paintPlayableBalance();

  await writeRoundDoc(db, {tableId, tableType:'speed', roundNo:s.roundNo, shoeNo:s.shoe.no, sim, startedAt:new Date(Date.now()-(SPEED_BETTING_SECONDS+SPEED_DEALING_SECONDS)*1000).toISOString()});
  s.history.push(sim.result);
  s.pairFlags.push({playerPair:!!sim.playerPair, bankerPair:!!sim.bankerPair});
  s.roundNo++;
  advanceSpeedShoe(tableId);
  renderSpeedTileRoad(tableId);
  renderSpeedTileStats(tableId);
}
