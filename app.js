// ════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

const ALL_PE_FIELDS = [
  {key:'day_dual',      lbl:'Day – Dual',           cat:'DAY'},
  {key:'day_pilot',     lbl:'Day – Pilot',           cat:'DAY'},
  {key:'day_copilot',   lbl:'Day – Co-Pilot',        cat:'DAY'},
  {key:'night_dual',    lbl:'Night – Dual',          cat:'NIGHT'},
  {key:'night_pilot',   lbl:'Night – Pilot',         cat:'NIGHT'},
  {key:'night_copilot', lbl:'Night – Co-Pilot',      cat:'NIGHT'},
  {key:'nvg',           lbl:'NVG Experience',        cat:'NVG'},
  {key:'sim',           lbl:'Simulator Experience',  cat:'SIMULATOR'},
  {key:'imc',           lbl:'IMC',                   cat:'SPECIAL'},
  {key:'sif',           lbl:'SIF',                   cat:'SPECIAL'},
  {key:'instr_day',     lbl:'INSTR – Day',           cat:'SPECIAL'},
  {key:'instr_night',   lbl:'INSTR – Night',         cat:'SPECIAL'},
  {key:'wso',           lbl:'WSO Hours',             cat:'SPECIAL'},
];

// Ink colours used to render entry text in the logbook and entry form.
// 'hex' is the dark-mode value; 'hexLight' (if present) is the light-mode override.
// Black ink needs special handling: silver (#cbd5e1) reads on dark backgrounds,
// near-black (#0d1424) reads on light. Other colours (blue/red/nvg) read well on
// both, so they don't override per-mode.
const ENTRY_COLORS = {
  black:{ hex:'#cbd5e1', hexLight:'#0d1424', label:'Black', night:false, nvg:false },
  blue: { hex:'#4aa8e8', label:'Blue',  night:false, nvg:false },
  red:  { hex:'#ff5b4d', label:'Red',   night:true,  nvg:false },
  nvg:  { hex:'#2ecc71', label:'NVG',   night:true,  nvg:true  },
};

// Resolve the active ink hex for the current mode (light vs dark).
function _inkHex(inkType){
  const info = ENTRY_COLORS[inkType] || ENTRY_COLORS.black;
  const isLight = document.documentElement.classList.contains('mode-light') ||
                  document.body.classList.contains('mode-light');
  return (isLight && info.hexLight) ? info.hexLight : info.hex;
}

// Single source of truth for the Log Entry form's hour fields.
// `skipWhen` (optional): function(ctx) → true means skip validation/save for this entry-type context.
// ctx = { isNight, isNVG }
const LOG_HOUR_FIELDS = [
  {key:'day_dual',     idH:'h_day_dual_h',     idM:'h_day_dual_m',     lbl:'Day Dual',         skipWhen:c=>c.isNight},
  {key:'day_pilot',    idH:'h_day_pilot_h',    idM:'h_day_pilot_m',    lbl:'Day Pilot',        skipWhen:c=>c.isNight},
  {key:'day_copilot',  idH:'h_day_copilot_h',  idM:'h_day_copilot_m',  lbl:'Day Co-Pilot',     skipWhen:c=>c.isNight},
  {key:'night_dual',   idH:'h_night_dual_h',   idM:'h_night_dual_m',   lbl:'Night Dual',       skipWhen:c=>!c.isNight},
  {key:'night_pilot',  idH:'h_night_pilot_h',  idM:'h_night_pilot_m',  lbl:'Night Pilot',      skipWhen:c=>!c.isNight},
  {key:'night_copilot',idH:'h_night_copilot_h',idM:'h_night_copilot_m',lbl:'Night Co-Pilot',   skipWhen:c=>!c.isNight},
  {key:'nvg',          idH:'s_nvg_h',          idM:'s_nvg_m',          lbl:'NVG',              skipWhen:c=>!c.isNVG},
  {key:'imc',          idH:'s_imc_h',          idM:'s_imc_m',          lbl:'IMC'},
  {key:'sif',          idH:'s_sif_h',          idM:'s_sif_m',          lbl:'SIF'},
  {key:'instr_day',    idH:'s_instr_day_h',    idM:'s_instr_day_m',    lbl:'Instructor Day',   skipWhen:c=>c.isNight},
  {key:'instr_night',  idH:'s_instr_night_h',  idM:'s_instr_night_m',  lbl:'Instructor Night', skipWhen:c=>!c.isNight},
  {key:'wso',          idH:'s_wso_h',          idM:'s_wso_m',          lbl:'WSO'},
];

// ════════════════════════════════════════════════════
// STORAGE
// ════════════════════════════════════════════════════
const K_AC   = 'lg_aircraft_v1';
const K_ENT  = 'lg_entries_v1';
const K_SETT = 'lg_settings_v1';
const K_ACTIVE = 'lg_active_ac_v1';
// Captain Con-Trg picker selections (Day / Night / SIF-IMC). Persisted so the
// user's chosen Pilot/Co-Pilot toggles and month windows survive app restarts.
const K_CCSEL = 'lg_contrg_sel_v2';
// Name-suggestion list used to autocomplete Pilot / Co-Pilot in New Log Entry.
// Stored as an array of strings, deduped case-insensitively. Seeded on first
// app load from existing log entries (see _seedNameSuggestionsFromEntries),
// then grown automatically as the user saves entries with new names.
const K_NAMES = 'lg_name_suggestions_v1';
// Aircraft-number suggestions — mirrors the name-suggestions system exactly.
// Same storage shape (array of strings), same dedupe + alphabetical sort,
// same one-time seed-from-entries flag, same dropdown UI (shared code keyed
// by the field name 'acno'). Included in backup/import/vault/wipe.
const K_ACNOS = 'lg_acno_suggestions_v1';
const K_ACNOS_SEEDED = 'lg_acnos_seeded_v1';

// ─── Haptic feedback (bulletproof) ──────────────────────────────────────
// A single helper for all tactile feedback. Designed to NEVER throw, NEVER
// block, and NEVER affect any other functionality:
//   • Feature-detects navigator.vibrate (absent on iOS WKWebView, older
//     browsers) — silently no-ops when unavailable.
//   • Wrapped entirely in try/catch so a vibrate failure can't bubble.
//   • Gated by a master On/Off setting (settings.haptics, default ON).
//   • Reads the setting defensively; any error → treated as ON (the safe,
//     expected default) but still inside try/catch so it can't break.
// Call sites pass a semantic TYPE, not a raw duration, so the vocabulary
// stays consistent app-wide and can be tuned in one place.
const _HAPTIC_PATTERNS = {
  light:    8,            // selecting a suggestion, toggling a chip, opening a dropdown
  confirm:  18,           // saving an entry
  success:  [12, 30, 12], // backup exported / imported — a "done" double tick
  destructive: [25, 35, 40], // delete entry / swipe-reset fires — heavier
  longpress: 18,          // long-press popout opens
  error:    [30, 40, 30], // validation failed — sharp triple "no"
  tick:     18            // slide-to-reset reached the firing point
};
function haptic(type){
  try {
    // Master toggle — default ON. Read defensively.
    let on = true;
    try {
      const s = getSettings();
      if(s && s.haptics === false) on = false;
    } catch(_){ /* settings unreadable → leave ON */ }
    if(!on) return;

    const pattern = _HAPTIC_PATTERNS[type];
    if(pattern == null) return;

    // Prefer the NATIVE bridge (Android Vibrator service) — it's reliable
    // across OEMs where the WebView's navigator.vibrate is inconsistent or
    // silently ignored. Fall back to navigator.vibrate only if the bridge
    // isn't present (iOS / plain web preview).
    const bridge = (typeof window !== 'undefined') && (window.Android || window.LogittaAndroid);
    if(bridge){
      if(Array.isArray(pattern)){
        // vibratePattern expects a CSV of "delay,buzz,pause,buzz…". Prefix
        // a 0 initial-delay so the first number is the first buzz.
        if(typeof bridge.vibratePattern === 'function'){
          bridge.vibratePattern('0,' + pattern.join(','));
          return;
        }
        // Older bridge without vibratePattern → sum the buzz portions into
        // one buzz so the user still feels something.
        if(typeof bridge.vibrate === 'function'){
          const total = pattern.filter((_, i) => i % 2 === 0)
                               .reduce((a, b) => a + b, 0);
          bridge.vibrate(total || 18);
          return;
        }
      } else {
        if(typeof bridge.vibrate === 'function'){
          bridge.vibrate(pattern);
          return;
        }
      }
    }

    // Fallback: Web Vibration API (Android browsers; no-op on iOS).
    if(typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'){
      navigator.vibrate(pattern);
    }
  } catch(_){ /* never let haptics break anything */ }
}

function getActiveAcId(){
  // Returns the currently-active aircraft id, or null if none set or the
  // referenced aircraft has been deleted.
  const id = _storeGet(K_ACTIVE, null);
  const acs = getAC();
  if(!acs.length) return null;
  if(id && acs.find(a=>a.id===id)) return id;
  // Fallback: auto-select ALH MK1 (or first available aircraft) so the Summary page
  // is never empty/broken with 0h!
  const defaultAc = acs.find(a => (a.name||'').toLowerCase().includes('alh')) || acs[0];
  if(defaultAc){
    _storeSet(K_ACTIVE, defaultAc.id);
    return defaultAc.id;
  }
  return null;
}
function setActiveAcId(id){
  if(id) _storeSet(K_ACTIVE, id);
  else   _storeRemove(K_ACTIVE);
}

function getAC(){
  try{
    const raw = _storeGet(K_AC, null);
    const arr = Array.isArray(raw) ? raw : [];
    // Migrate legacy aircraft data: merge sim_* into sim, imc_day+night into imc, sif_day+night into sif
    let mutated = false;
    arr.forEach(ac=>{
      const d = ac.data||{};
      if(d.sim_pilot!==undefined || d.sim_copilot!==undefined || d.sim_dual!==undefined || d.sim_night!==undefined){
        d.sim = (d.sim||0) + (d.sim_pilot||0) + (d.sim_copilot||0) + (d.sim_dual||0) + (d.sim_night||0);
        delete d.sim_pilot; delete d.sim_copilot; delete d.sim_dual; delete d.sim_night;
        mutated = true;
      }
      if(d.imc_day!==undefined || d.imc_night!==undefined){
        d.imc = (d.imc||0) + (d.imc_day||0) + (d.imc_night||0);
        delete d.imc_day; delete d.imc_night;
        mutated = true;
      }
      if(d.sif_day!==undefined || d.sif_night!==undefined){
        d.sif = (d.sif||0) + (d.sif_day||0) + (d.sif_night||0);
        delete d.sif_day; delete d.sif_night;
        mutated = true;
      }
      ac.data = d;
    });
    if(mutated) _storeSet(K_AC, arr);
    return arr;
  }catch(e){return []}
}
// ─── Quota-proof storage layer ──────────────────────────────────────────
// localStorage in Android WebView is hard-capped (~10 MB, Chromium-set;
// no app setting can raise it). To support DECADES of log data, the
// durable source of truth is the NATIVE FILE VAULT (app filesDir via the
// AndroidBridge — gigabytes available). localStorage is just a fast cache.
//
// Layers:
//   1. _mem{}        — in-session memory cache, written first. Reads in
//                      the same session always succeed even if
//                      localStorage is full.
//   2. localStorage  — best-effort persistence; setItem wrapped in
//                      try/catch so quota overflow never breaks a save.
//   3. Native vault  — every save mirrors the FULL dataset to
//                      logitta_autobackup.json in the app's private files
//                      dir (write: _scheduleAutoBackup → bridge autoBackup;
//                      read: _restoreFromVaultIfNeeded at boot repopulates
//                      the cache if localStorage was evicted or full).
// Net effect: capacity is bounded by device disk, not the WebView quota —
// easily a century of sorties (100 yrs ≈ 20k entries ≈ 10-20 MB).
const _mem = {};
function _storeSet(key, value){
  _mem[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch(_){ /* quota exceeded — memory + native vault still hold the data */ }
}
function _storeGet(key, fallback){
  if(key in _mem) return _mem[key];
  let raw = null;
  try { raw = localStorage.getItem(key); } catch(_){}
  if(raw !== null){
    try {
      const v = JSON.parse(raw);
      _mem[key] = v;
      return v;
    } catch(_){
      // Legacy migration: older builds stored some values (e.g. the active
      // aircraft id) as RAW strings, not JSON. JSON.parse throws on those.
      // Return the raw string so existing installs keep working; the next
      // _storeSet for this key re-saves it as proper JSON.
      _mem[key] = raw;
      return raw;
    }
  }
  return fallback;
}
function _storeRemove(key){
  delete _mem[key];
  try { localStorage.removeItem(key); } catch(_){}
}

function setAC(d){ _storeSet(K_AC, d); _scheduleAutoBackup(); }
function getEntries(){ const v = _storeGet(K_ENT, null); return Array.isArray(v) ? v : []; }
function setEntries(d){ _storeSet(K_ENT, d); _scheduleAutoBackup(); }
function getSettings(){ const v = _storeGet(K_SETT, null); return (v && typeof v === 'object') ? v : {}; }
function setSettings(d){ _storeSet(K_SETT, d); _scheduleAutoBackup(); }
// Name suggestions — alphabetically sorted, deduplicated case-insensitively.
function getNames(){
  try{
    const arr = _storeGet(K_NAMES, []);
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : [];
  }catch(e){ return []; }
}
function setNames(arr){
  // Always dedupe + sort before persisting so the storage stays clean
  // regardless of the caller's input. Comparison is case-insensitive so
  // "Maj Singh" and "MAJ SINGH" don't both end up in the list.
  const seen = new Set();
  const clean = [];
  (arr || []).forEach(s => {
    if(typeof s !== 'string') return;
    const t = s.trim();
    if(!t) return;
    const k = t.toLowerCase();
    if(seen.has(k)) return;
    seen.add(k);
    clean.push(t);
  });
  clean.sort((a, b) => a.localeCompare(b));
  _storeSet(K_NAMES, clean);
  _scheduleAutoBackup();
}
// Add a single name to the suggestions list (no-op if already present).
function addNameSuggestion(name){
  if(!name) return;
  const n = String(name).trim();
  if(!n) return;
  // Skip "SELF" — it's a logbook convention placeholder, not an actual person.
  if(n.toUpperCase() === 'SELF') return;
  const list = getNames();
  if(list.some(s => s.toLowerCase() === n.toLowerCase())) return;
  list.push(n);
  setNames(list);
}

// ─── Aircraft-number suggestion list (parallel to the name list) ─────────
function getAcnos(){
  try{
    const arr = _storeGet(K_ACNOS, []);
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : [];
  }catch(e){ return []; }
}
function setAcnos(arr){
  // Dedupe (case-insensitive) + alphabetical sort, same as names.
  const seen = new Set();
  const clean = [];
  (arr || []).forEach(s => {
    if(typeof s !== 'string') return;
    const t = s.trim();
    if(!t) return;
    const k = t.toLowerCase();
    if(seen.has(k)) return;
    seen.add(k);
    clean.push(t);
  });
  clean.sort((a, b) => a.localeCompare(b));
  _storeSet(K_ACNOS, clean);
  _scheduleAutoBackup();
}
function addAcnoSuggestion(acno){
  if(!acno) return;
  const n = String(acno).trim();
  if(!n) return;
  const list = getAcnos();
  if(list.some(s => s.toLowerCase() === n.toLowerCase())) return;
  list.push(n);
  setAcnos(list);
}

// ─── Unified list accessor ───────────────────────────────────────────────
// The suggestion dropdown UI is shared between three fields: 'pilot',
// 'copilot' (both backed by the NAME list) and 'acno' (backed by the
// AIRCRAFT-NUMBER list). This helper returns the correct getter/setter pair
// for a given field key, so the shared dropdown/popout code doesn't have to
// branch on `which` at every call site.
function _nsListFor(which){
  if(which === 'acno'){
    return { get: getAcnos, set: setAcnos };
  }
  return { get: getNames, set: setNames };
}
// Seed the suggestions list from existing log entries. Runs ONCE EVER —
// on the first launch where the seed flag is absent. After seeding it sets
// the flag, so subsequent boots never rescan history again. This is the
// fix for the "deleted/edited name reappears on reopen" bug: previously
// this ran on every boot and re-added any entry pilot/copilot name missing
// from the list, silently resurrecting names the user had deliberately
// deleted or renamed (the original name still sits on the saved entries).
// With the flag gate, the list becomes fully user-owned after first launch:
// every add/edit/delete persists permanently regardless of entry contents.
const K_NAMES_SEEDED = 'lg_names_seeded_v1';
function _seedNameSuggestionsFromEntries(force){
  // Routine boot: skip if already seeded once — the list is the user's to
  // curate and must never be silently rescanned (that resurrects deleted
  // names). Import path passes force=true to BYPASS this gate and REPLACE
  // the list with names rebuilt from the just-imported entries.
  if(!force){
    let seeded = false;
    try { seeded = !!localStorage.getItem(K_NAMES_SEEDED); } catch(_){}
    if(seeded) return;
  }

  // force → clean slate (replace). non-force → augment the current list.
  const base = force ? [] : getNames();
  const existing = new Set(base.map(s => s.toLowerCase()));
  const toAdd = [];
  getEntries().forEach(e => {
    [e.pilot, e.copilot].forEach(name => {
      if(!name) return;
      const n = String(name).trim();
      if(!n || n.toUpperCase() === 'SELF') return;
      const k = n.toLowerCase();
      if(!existing.has(k)){
        existing.add(k);
        toAdd.push(n);
      }
    });
  });
  // setNames dedupes + sorts; passing base+toAdd covers both modes (base is
  // [] when forcing, so this becomes a pure rebuild from entries).
  setNames([...base, ...toAdd]);
  // Mark seeded so routine boot never runs again, even if the list ended up
  // empty (an empty history is still a valid "first launch" / import).
  _markNamesSeeded();
}
// Set the one-time seed flag. Also called from the import path: an imported
// backup's name list is authoritative, so we must stop the seeder from
// running afterwards and re-injecting entry names over the restored list.
function _markNamesSeeded(){
  try { localStorage.setItem(K_NAMES_SEEDED, '1'); } catch(_){}
}

// ─── Aircraft-number seeding (one-time, mirrors the name seeder) ─────────
function _seedAcnosFromEntries(force){
  if(!force){
    let seeded = false;
    try { seeded = !!localStorage.getItem(K_ACNOS_SEEDED); } catch(_){}
    if(seeded) return;
  }

  const base = force ? [] : getAcnos();
  const existing = new Set(base.map(s => s.toLowerCase()));
  const toAdd = [];
  getEntries().forEach(e => {
    const v = e && e.acno ? String(e.acno).trim() : '';
    if(!v) return;
    const k = v.toLowerCase();
    if(!existing.has(k)){
      existing.add(k);
      toAdd.push(v);
    }
  });
  setAcnos([...base, ...toAdd]);
  _markAcnosSeeded();
}
function _markAcnosSeeded(){
  try { localStorage.setItem(K_ACNOS_SEEDED, '1'); } catch(_){}
}

// ─── Auto-backup pipeline ─────────────────────────────────────────────────
// Whenever the in-app state changes (aircraft list, log entries, settings),
// we serialise the whole logbook to JSON and hand it to the Android shell
// for persistent backup to private app storage. This survives the user
// clearing the WebView's localStorage but NOT the user uninstalling the app
// (which is by Android-platform design and unavoidable). The work is
// debounced so a multi-step operation (e.g. import which calls setAC and
// setEntries back-to-back) produces only one backup write.
// ─── Native vault restore (boot path) ───────────────────────────────────
// If localStorage came up empty (OS cleared WebView data under storage
// pressure, quota overflow dropped writes, etc.) but the native vault file
// has data, restore everything from the vault. This is what makes the
// native file the durable source of truth.
// Runs synchronously before first render so the home page shows restored
// data immediately. The bridge call is synchronous (JavascriptInterface
// returning String), so no async complexity.
function _restoreFromVaultIfNeeded(){
  try {
    if(getEntries().length > 0) return;
    const bridge = window.Android || window.LogittaAndroid;
    if(bridge && typeof bridge.loadAutoBackup === 'function'){
      const raw = bridge.loadAutoBackup('logitta_autobackup.json');
      if(raw){
        const d = JSON.parse(raw);
        if(d && Array.isArray(d.entries) && d.entries.length > 0){
          setEntries(d.entries);
          if(Array.isArray(d.aircraft)) setAC(d.aircraft);
          if(d.settings && typeof d.settings === 'object') setSettings(d.settings);
          if(Array.isArray(d.nameSuggestions)){ setNames(d.nameSuggestions); _markNamesSeeded(); }
          if(Array.isArray(d.acnoSuggestions)){ setAcnos(d.acnoSuggestions); _markAcnosSeeded(); }
          console.log('Logitta: restored ' + d.entries.length + ' entries from native vault');
          return;
        }
      }
    }
    if(window.LogittaIDB && typeof window.LogittaIDB.loadVault === 'function'){
      window.LogittaIDB.loadVault().then(d => {
        if(d && Array.isArray(d.entries) && d.entries.length > 0 && getEntries().length === 0){
          setEntries(d.entries);
          if(Array.isArray(d.aircraft)) setAC(d.aircraft);
          if(d.settings && typeof d.settings === 'object') setSettings(d.settings);
          if(Array.isArray(d.nameSuggestions)){ setNames(d.nameSuggestions); _markNamesSeeded(); }
          if(Array.isArray(d.acnoSuggestions)){ setAcnos(d.acnoSuggestions); _markAcnosSeeded(); }
          console.log('Logitta: restored ' + d.entries.length + ' entries from IndexedDB persistent storage');
          if(typeof renderHome === 'function') renderHome();
          if(typeof renderAcList === 'function') renderAcList();
          if(typeof renderLogbook === 'function') renderLogbook();
        }
      }).catch(err => console.warn('IDB restore warning:', err));
    }
  } catch(_){ }
}

let _autoBackupTimer = null;
function _scheduleAutoBackup(){
  if(_autoBackupTimer) clearTimeout(_autoBackupTimer);
  _autoBackupTimer = setTimeout(()=>{
    _autoBackupTimer = null;
    try {
      const payload = {
        app: 'Logitta',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: getSettings(),
        aircraft: getAC(),
        entries: getEntries(),
        nameSuggestions: getNames(),
        acnoSuggestions: getAcnos(),
      };
      const json = JSON.stringify(payload);
      _callNative(['autoBackup','backupJson'], 'logitta_autobackup.json', json);
      if(window.LogittaIDB && typeof window.LogittaIDB.saveVault === 'function'){
        window.LogittaIDB.saveVault(payload);
      }
      if(window.LogittaSync && typeof window.LogittaSync.markUnsynced === 'function'){
        window.LogittaSync.markUnsynced();
      }
    } catch(_) { }
  }, 250);
}

// ════════════════════════════════════════════════════
// HELPERS — time
// ════════════════════════════════════════════════════
function hm(mins){ const h=Math.floor(mins/60),m=mins%60; return h+'h'+(m>0?String(m).padStart(2,'0')+'m':'') }
/* Same value as hm() but as HTML: hours/minutes are big, the `h` and `m` unit letters
   are wrapped in <span class="u"> for smaller, dimmer rendering with a thin gap between. */
function hmHTML(mins){
  const h = Math.floor(mins/60), m = mins%60;
  if(m > 0){
    return h + '<span class="u">h</span><span class="u-gap"></span>' + String(m).padStart(2,'0') + '<span class="u">m</span>';
  }
  return h + '<span class="u">h</span>';
}

/* Count-up animation for a stat element. Goes from 0 to `targetMins` over ~900ms with
   ease-out, calling `formatter` each frame to produce the HTML. Cancels any prior anim
   on the same element. Respects prefers-reduced-motion. */
function animateMins(el, targetMins, formatter=hmHTML, durationMs=900){
  if(!el) return;
  // Cancel any prior animation on this element
  if(el._animFrame){ cancelAnimationFrame(el._animFrame); }
  // Reduced motion: jump straight to final value
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    el.innerHTML = formatter(targetMins);
    return;
  }
  const start = performance.now();
  const tick = (now)=>{
    const t = Math.min(1, (now - start) / durationMs);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    const cur = Math.round(targetMins * eased);
    el.innerHTML = formatter(cur);
    if(t < 1){
      el._animFrame = requestAnimationFrame(tick);
    } else {
      el._animFrame = null;
    }
  };
  el._animFrame = requestAnimationFrame(tick);
}
function hmFull(mins){ const h=Math.floor(mins/60),m=mins%60; return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0') }
function dec(mins){ return (mins/60).toFixed(2) }

// Validate a single h/m pair, return {ok, mins, err}
// Rules: no decimals, no negatives, no alphabets; h ≤ 5 digits; m ≤ 2 digits; m≥60 overflows to h
function validateHM(hRaw, mRaw, label){
  // Empty fields are OK → treated as 0
  const hStr = (hRaw||'').toString().trim();
  const mStr = (mRaw||'').toString().trim();
  if(hStr === '' && mStr === '') return { ok:true, mins:0 };
  // Reject negatives, decimals, alphabets — must be pure digits
  const digitsOnly = /^\d+$/;
  if(hStr !== '' && !digitsOnly.test(hStr)){
    return { ok:false, err:`${label}: Hour must be a whole number (no decimals, signs or letters)` };
  }
  if(mStr !== '' && !digitsOnly.test(mStr)){
    return { ok:false, err:`${label}: Minute must be a whole number (no decimals, signs or letters)` };
  }
  if(hStr.length > 5){
    return { ok:false, err:`${label}: Hour cannot exceed 5 digits` };
  }
  if(mStr.length > 2){
    return { ok:false, err:`${label}: Minute cannot exceed 2 digits` };
  }
  let h = parseInt(hStr || '0', 10);
  let m = parseInt(mStr || '0', 10);
  // Overflow minutes ≥ 60 into hours
  if(m >= 60){
    h += Math.floor(m/60);
    m = m % 60;
  }
  if(h > 99999){
    return { ok:false, err:`${label}: Hour too large (max 99999)` };
  }
  return { ok:true, mins: h*60 + m, normalizedH: h, normalizedM: m };
}

// Read & validate a single HM field by id prefix; returns {ok, mins, err}
function readValidatedHM(hId, mId, label){
  const hEl = document.getElementById(hId);
  const mEl = document.getElementById(mId);
  const hVal = hEl?.value ?? '';
  const mVal = mEl?.value ?? '';
  const result = validateHM(hVal, mVal, label);
  // If valid and minutes overflowed, write back the normalized values to the UI
  if(result.ok && (hVal !== '' || mVal !== '')){
    if(hEl) hEl.value = result.normalizedH > 0 ? String(result.normalizedH) : (hVal !== '' ? '0' : '');
    if(mEl) mEl.value = result.normalizedM > 0 ? String(result.normalizedM).padStart(2,'0') : (mVal !== '' ? '0' : '');
  }
  return result;
}

// HTML for an inline SVG icon. `cls` lets the caller add 'ico-mr' (right margin) or other modifiers.
function icon(name, cls=''){
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Legacy fallback (still used in some places that don't need validation feedback)
function readHM(hId, mId){
  const r = validateHM(document.getElementById(hId)?.value, document.getElementById(mId)?.value, '');
  return r.ok ? r.mins : 0;
}

// Write a minute count into a paired hour:minute input.
// Empty value when mins is 0 so the placeholder still shows.
function setHM(idH, idM, mins){
  const h = Math.floor((mins||0)/60), m = (mins||0)%60;
  const hEl = document.getElementById(idH);
  const mEl = document.getElementById(idM);
  if(hEl) hEl.value = h>0 ? String(h) : '';
  if(mEl) mEl.value = m>0 ? String(m).padStart(2,'0') : '';
}

// HTML for one paired hour:minute input cell.
// `wrapperClass` lets callers pick between the visual variants (.hm-box, .hrs-hm, .spl-hm).
// Hour field defaults to 5 digits (Prior Experience career totals can be 1234h+);
// Log Entry uses static HTML with maxlength="1" since a single sortie won't exceed 9h.
function hmInputHTML({idH, idM, mins=0, wrapperClass='hm-box', sepClass='hm-sep'}){
  const h = Math.floor((mins||0)/60), m = (mins||0)%60;
  return `<div class="${wrapperClass}">
    <input type="text" inputmode="numeric" maxlength="5" placeholder="0"  value="${h||''}" id="${idH}">
    <span class="${sepClass}">:</span>
    <input type="text" inputmode="numeric" maxlength="2" placeholder="00" value="${m?String(m).padStart(2,'0'):''}" id="${idM}">
  </div>`;
}

// ════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════
let curScreen = 'home';

// Toggle all 3 Home stat cards together. The first card's current state decides
// the action — if it's collapsed, all three expand; otherwise all three collapse.
// This keeps the row visually coherent (no half-open layouts).
function toggleStatCards(){
  const cards = document.querySelectorAll('#home .stat-card');
  if(!cards.length) return;
  const expanding = cards[0].classList.contains('collapsed');
  cards.forEach(c => c.classList.toggle('collapsed', !expanding));
}

// ── ANDROID BACK BUTTON / GESTURE SUPPORT ──────────────────────────────────────
// Each call to go() or showSubview() pushes a history entry. When the user presses
// the Android back button or swipes back, the WebView pops that entry and fires a
// popstate event here. We read the popped state and replay the navigation in the
// app — silently (without pushing another history entry, which would create a loop).
//
// Special priority: if Settings overlay is open, close it first; if a picker modal
// is open, close that first. Only after those are closed does back actually navigate.
window.addEventListener('popstate', (e) => {
  // ─── Unified back handling ────────────────────────────────────────────────
  // Previously this popstate handler (fired by the back GESTURE / WebView
  // history pop) used different logic than window.LogittaBack() (fired by the
  // back BUTTON via the Android shell). That divergence meant the gesture in a
  // Prior-Experience subview would jump to whatever history entry existed,
  // while the button correctly walked the subview flow back to the list / home.
  //
  // Fix: route the gesture through the SAME _handleBackNavigation() logic the
  // button uses. If that logic handled the back (closed an overlay, popped a
  // subview, or navigated to home), we re-seed a history entry so the next
  // gesture has somewhere to pop to. If it returned false (nothing left to do —
  // we're on Home), we let the pop proceed, which lets the Android shell close
  // the app.
  const handled = _handleBackNavigation();
  if(handled){
    // Re-push the current screen so the history stack still has an entry to pop
    // next time. Without this, two gestures in a row could over-pop and exit.
    history.pushState({type:'screen', id:curScreen}, '', '#'+curScreen);
  }
  // If not handled (on Home, nothing open), do nothing — the pop already
  // happened and the shell will finish() the activity.
});

// ─── Shared back-navigation logic ─────────────────────────────────────────────
// Single source of truth for "what should the back action do right now". Used by
// BOTH the back gesture (popstate, above) and the back button (LogittaBack, via
// the Android shell). Returns true if it consumed the back action, false if
// there's nothing left to do (caller should let the app close).
function _handleBackNavigation(){
  // 1. Open Settings overlay? Close it.
  const settingsOverlay = document.getElementById('settingsOverlay');
  if(settingsOverlay && settingsOverlay.classList.contains('active')){
    closeSettings();
    return true;
  }
  // 2. Any open picker/modal? Close the top-most one.
  const openModal = document.querySelector('.picker-overlay.active');
  if(openModal){
    openModal.classList.remove('active');
    return true;
  }
  // 3. Glass-dropdown popover open? Close it.
  const gdPopover = document.querySelector('.gd-popover.open');
  if(gdPopover && typeof GD !== 'undefined'){
    GD.close();
    return true;
  }
  // 4. Inside a Prior-Exp subview that isn't the list? Walk the subview flow
  //    back (name → list, detail → name, etc). This is what makes the gesture
  //    behave like the button inside Prior Experience.
  if(curScreen === 'prev'){
    const sub = document.querySelector('#prev .subview.active');
    if(sub && sub.id !== 'sv_list' && sub.id !== 'sv-list'){
      if(typeof prevGoBack === 'function'){
        window._navSilent = true;
        try { prevGoBack(); } finally { window._navSilent = false; }
        return true;
      }
    }
  }
  // 5. On any screen other than Home? Go to Home.
  if(curScreen !== 'home'){
    window._navSilent = true;
    try { go('home'); } finally { window._navSilent = false; }
    return true;
  }
  // 6. Already on Home with nothing open — ask the Android shell to close
  //    the app. We use the requestExit() bridge added in MainActivity.kt
  //    (AndroidBridge) — calling it triggers a clean finish() on the UI
  //    thread. If the bridge isn't available (e.g. running this bundle in a
  //    plain browser preview, not the APK), do nothing — there's no way to
  //    exit a browser tab from script, so the user just stays on home.
  try {
    if(window.Android && typeof window.Android.requestExit === 'function'){
      window.Android.requestExit();
    } else if(window.LogittaAndroid && typeof window.LogittaAndroid.requestExit === 'function'){
      window.LogittaAndroid.requestExit();
    }
  } catch(_){ /* never throw from a back-press handler */ }
  return false;
}

// Seed the initial history state on first load so the very first back press
// has somewhere to pop back to (and doesn't immediately exit the app from home).
if(!history.state){
  history.replaceState({type:'screen', id:'home'}, '', '#home');
}

// ─── Android system back-button bridge ───────────────────────────────────────
// The Android shell calls window.LogittaBack() when the system back button
// (or gesture) is pressed. We close any open overlay first, then walk back
// through screens; if we're already on Home and nothing is open, return false
// so the shell knows to finish() the activity (i.e. close the app).
window.LogittaBack = function(){
  // Delegate to the shared back-navigation logic used by the gesture too,
  // so the back BUTTON and the back GESTURE behave identically.
  return _handleBackNavigation();
};
// ───────────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────────


function go(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  curScreen = id;
  // bottom nav removed
  window.scrollTo(0,0);

  if(id==='home')    renderHome();
  if(id==='prev')    { showSubview('list'); renderAcList(); }
  if(id==='entry')   initEntry();
  if(id==='logbook') renderLogbook();
  if(id==='summary') renderSummary();

  // Push a history entry so the Android system back gesture / back button can pop
  // back to the previous screen. _navSilent is set true by the popstate handler when
  // it triggers navigation itself, so we don't double-push.
  if(!window._navSilent){
    history.pushState({type:'screen', id}, '', '#'+id);
  }
}

// ════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════

// Valid lists kept in one place so other functions can validate without re-typing.
const VALID_ACCENTS = ['gold','blue','aqua','purple','red','silver'];
const VALID_MODES   = ['dark','darkgrey','light']; // 'dark' is the default look (no class)

// Backward-compat: migrate the old single `theme` setting into the new {accent, mode} model.
// Old values that mixed accent + background (grey, dark) become a mode + the default accent.
function _migrateThemeSetting(s){
  if(s.accent || s.mode) return s; // already migrated
  const out = {...s};
  if(s.theme === 'grey'){ out.accent = 'gold'; out.mode = 'darkgrey'; }
  else if(s.theme === 'dark'){ out.accent = 'gold'; out.mode = 'dark'; }
  else if(s.theme === 'silver'){ out.accent = 'silver'; out.mode = 'dark'; }
  else if(s.theme === 'green'){ out.accent = 'gold'; out.mode = 'dark'; } // legacy
  else if(VALID_ACCENTS.includes(s.theme)){ out.accent = s.theme; out.mode = 'dark'; }
  else { out.accent = 'gold'; out.mode = 'dark'; }
  delete out.theme;
  return out;
}

function applySettings(){
  const s = _migrateThemeSetting(getSettings());
  if(s.name){ document.getElementById('homeName').textContent = s.name; }
  if(s.unit){ document.getElementById('homeUnit').textContent = s.unit; }
  applyAccent(s.accent || 'gold');
  applyMode(s.mode || 'dark');
  if(s.fs){ applyFs(s.fs); }
}

// Apply accent colour by toggling a single theme-* class on body.
// 'gold' = no class (root defaults). Marks the matching settings chip as active.
function applyAccent(a){
  if(!VALID_ACCENTS.includes(a)) a = 'gold';
  document.body.className = document.body.className.replace(/theme-\w+/g,'').trim();
  if(a !== 'gold') document.body.classList.add('theme-'+a);
  document.querySelectorAll('.sett-chip[id^="theme_"]').forEach(c=>c.classList.remove('active'));
  const tc = document.getElementById('theme_'+a);
  if(tc) tc.classList.add('active');
}

// Apply mode (background + text palette). 'dark' = no class. Marks the matching chip.
function applyMode(m){
  if(!VALID_MODES.includes(m)) m = 'dark';
  document.body.className = document.body.className.replace(/mode-\w+/g,'').trim();
  if(m !== 'dark') document.body.classList.add('mode-'+m);
  document.querySelectorAll('.sett-chip[id^="mode_"]').forEach(c=>c.classList.remove('active'));
  const mc = document.getElementById('mode_'+m);
  if(mc) mc.classList.add('active');
}

function applyFs(fs){
  document.body.className = document.body.className.replace(/fs-\w+/g,'').trim();
  // Five modes: tiny (0.50×) → xs/Compact (0.85×) → sm/Small (1.00×) →
  // md/Medium (1.18×) → lg/Large (1.38×). Each adds its specific class so
  // the :root default never applies (which would equate to Small).
  if(fs==='tiny') document.body.classList.add('fs-tiny');
  if(fs==='xs') document.body.classList.add('fs-xs');
  if(fs==='sm') document.body.classList.add('fs-sm');
  if(fs==='md') document.body.classList.add('fs-md');
  if(fs==='lg') document.body.classList.add('fs-lg');
  document.querySelectorAll('.sett-chip[id^="fs_"]').forEach(c=>c.classList.remove('active'));
  const fc = document.getElementById('fs_'+fs);
  if(fc) fc.classList.add('active');
}

// Click handlers from the chips
function setTheme(a){ haptic('light'); applyAccent(a); }
function setMode(m){ haptic('light'); applyMode(m); }
function setFontSize(fs){ haptic('light'); applyFs(fs); }
// Haptic master toggle chip. Update the active-chip UI, then fire a sample
// tick when turning ON (so the user feels the confirmation). Persistence
// happens in saveSettings, same as the other chips.
function setHaptics(on){
  applyHaptics(on);
  if(on) haptic('light');   // sample buzz only when enabling
}
function applyHaptics(on){
  const onChip  = document.getElementById('haptics_on');
  const offChip = document.getElementById('haptics_off');
  if(onChip)  onChip.classList.toggle('active', !!on);
  if(offChip) offChip.classList.toggle('active', !on);
}

function openSettings(){
  const s = _migrateThemeSetting(getSettings());
  document.getElementById('sett_name').value       = s.name||'MAJ SS CHAUHAN';
  document.getElementById('sett_unit').value       = s.unit||'ALH WSI · AH-64 Qualified';
  document.getElementById('sett_catir').value      = s.catir||'';
  document.getElementById('sett_catir_date').value = s.catirDate||'';
  applyAccent(s.accent||'gold');
  applyMode(s.mode||'dark');
  applyFs(s.fs||'md');
  applyHaptics(s.haptics !== false);  // default ON unless explicitly false
  document.getElementById('settingsOverlay').classList.add('active');
}

function closeSettings(){
  document.getElementById('settingsOverlay').classList.remove('active');
}

function saveSettings(){
  const accent = document.querySelector('.sett-chip[id^="theme_"].active')?.id.replace('theme_','')||'gold';
  const mode   = document.querySelector('.sett-chip[id^="mode_"].active')?.id.replace('mode_','')||'dark';
  const fs     = document.querySelector('.sett-chip[id^="fs_"].active')?.id.replace('fs_','')||'md';
  const name   = document.getElementById('sett_name').value.trim()||'MAJ SS CHAUHAN';
  const unit   = document.getElementById('sett_unit').value.trim()||'ALH WSI · AH-64 Qualified';
  const catir     = document.getElementById('sett_catir').value.trim();
  const catirDate = document.getElementById('sett_catir_date').value;
  // Haptics: ON unless the Off chip is the active one.
  const haptics = !document.getElementById('haptics_off')?.classList.contains('active');
  const existing = getSettings();
  // Strip the legacy `theme` key on save so it doesn't keep getting migrated.
  delete existing.theme;
  setSettings({...existing, accent, mode, fs, name, unit, catir, catirDate, haptics});
  applySettings();
  renderHome();
  closeSettings();
  showToast('Settings saved ✓');
}

// ════════════════════════════════════════════════════
// HOME
// ════════════════════════════════════════════════════
function renderHome(){
  const entries = getEntries();
  const acs = getAC();

  // ── Hour-bucket helpers ──
  // Total Flying = Day (Dual + Pilot + Co-Pilot) + Night (Dual + Pilot + Co-Pilot).
  // NVG is a *descriptor* of Night sorties (already counted in Night fields), so it's NOT
  // added in. Sim / IMC / SIF / Instr Day / Instr Night / WSO are categorisations or
  // non-airborne — also excluded from Total Hrs.
  const flyingMins = src => (src.day_dual||0)   + (src.day_pilot||0)   + (src.day_copilot||0)
                          + (src.night_dual||0) + (src.night_pilot||0) + (src.night_copilot||0);

  // Captain = Day Pilot + Night Pilot (P1 time on the aircraft only).
  const captainMinsOf = src => (src.day_pilot||0) + (src.night_pilot||0);

  let totalMins=0, captainMins=0;
  // ── Prior Experience: each aircraft contributes its Day + Night buckets ──
  acs.forEach(ac=>{
    const d = ac.data||{};
    totalMins   += flyingMins(d);
    captainMins += captainMinsOf(d);
  });

  // ── Sorties: same formula, plus month-to-date tracking for the home deltas ──
  const now = new Date();
  const curMonth = MONTHS[now.getMonth()];
  const curYear  = now.getFullYear();
  let mtdMins = 0, mtdCaptainMins = 0, mtdEntries = 0;

  entries.forEach(e=>{
    const m = flyingMins(e);
    const c = captainMinsOf(e);
    totalMins   += m;
    captainMins += c;
    // == on year because the form stores it as a string
    if(e.month === curMonth && e.year == curYear){
      mtdMins        += m;
      mtdCaptainMins += c;
      mtdEntries     += 1;
    }
  });

  document.getElementById('h_total').innerHTML     = hmHTML(totalMins);
  document.getElementById('h_captain').innerHTML   = hmHTML(captainMins);
  // Sorties on the home card = count of entries in the CURRENT calendar month.
  // (Lifetime sortie count is available in the Summary tab via the cumulative table.)
  document.getElementById('h_entries').textContent = mtdEntries;

  // Deltas: hours formatted via hmHTML(). Sorties has no delta line — its value IS the MTD figure.
  const setDelta = (id, value) => {
    const el = document.getElementById(id);
    if(!el) return;
    if(value > 0){
      el.innerHTML = '+' + hmHTML(value) + ' <span style="opacity:.7">↑ MTD</span>';
      el.classList.remove('zero');
    } else {
      el.textContent = '—';
      el.classList.add('zero');
    }
  };
  setDelta('h_total_delta',   mtdMins);
  setDelta('h_captain_delta', mtdCaptainMins);

  // CAT/IR currency sub-line on the Sorties card.
  // Settings stores `catir` (text e.g. "GREEN / CAT-A") and `catirDate` (ISO YYYY-MM-DD).
  const s = getSettings();
  const catirEl = document.getElementById('h_catir');
  if(catirEl){
    const txt = (s.catir||'').trim();
    const iso = (s.catirDate||'').trim();
    if(txt || iso){
      // Format ISO 2026-03-15 → "15 MAR 26" (matches pilot vernacular)
      let dateStr = '';
      if(iso){
        const d = new Date(iso + 'T00:00:00');
        if(!isNaN(d.getTime())){
          dateStr = String(d.getDate()).padStart(2,'0') + ' ' + MONTHS[d.getMonth()] + ' ' + String(d.getFullYear()).slice(-2);
        }
      }
      catirEl.textContent = [txt, dateStr].filter(Boolean).join('\n');
      catirEl.classList.remove('zero');
    } else {
      catirEl.textContent = 'CAT/IR —';
      catirEl.classList.add('zero');
    }
  }
}

// ════════════════════════════════════════════════════
// PRIOR EXPERIENCE — Sub-view system
// ════════════════════════════════════════════════════
let prevCurrentAcId = null; // for edit/new
let prevMode = 'new'; // 'new' | 'edit'
let pendingDeleteId = null;

function showSubview(id){
  document.querySelectorAll('.subview').forEach(s=>s.classList.remove('active'));
  document.getElementById('sv_'+id).classList.add('active');
  const titles = {
    list:'Prior Experience', name:'New Aircraft',
    detail: prevMode==='edit'?'Edit Hours':'Enter Hours',
    editlist:'Edit Entry', dellist:'Delete Entry'
  };
  const subs = {
    list:'AIRCRAFT & HOURS BEFORE CURRENT UNIT',
    name:'STEP 1 — AIRCRAFT TYPE NAME',
    detail:'STEP 2 — ENTER ALL HOURS',
    editlist:'SELECT AIRCRAFT TO EDIT',
    dellist:'SELECT AIRCRAFT TO REMOVE'
  };
  document.getElementById('prevTitle').textContent = titles[id]||'Prior Experience';
  document.getElementById('prevSub').textContent   = subs[id]||'';
  document.getElementById('prevBack').onclick = id==='list' ? ()=>go('home') : ()=>prevGoBack();

  // Push subview history (skip the very first 'list' load since `go('prev')` already
  // pushed). _navSilent suppresses double-push during back navigation.
  if(!window._navSilent && id !== 'list'){
    history.pushState({type:'subview', id}, '', '#prev/'+id);
  }
}

function prevGoBack(){
  const active = document.querySelector('#prev .subview.active')?.id||'sv_list';
  const flows = { sv_name:'list', sv_detail:'name', sv_editlist:'list', sv_dellist:'list' };
  if(active==='sv_list'){ go('home'); return; }
  showSubview(flows[active]||'list');
  if(flows[active]==='list') renderAcList();
}

function renderAcList(){
  const acs = getAC();
  const el = document.getElementById('acListDisplay');
  if(!acs.length){
    el.innerHTML='<div class="empty"><div class="empty-ico"><svg class="ico" aria-hidden="true" style="width:1.8em;height:1.8em"><use href="#i-book"/></svg></div>No aircraft added yet.<br>Tap "New Entry" above to begin.</div>';
    return;
  }
  const activeId = getActiveAcId();

  // HTML for the action row (Edit / Delete only — Set Active is now in the header).
  const actionRow = (ac) => `
    <div class="ac-sum-actions">
      <button class="ac-sum-action-btn" onclick="event.stopPropagation();startEditAc('${ac.id}')">${icon('pencil','ico-mr')}Edit</button>
      <button class="ac-sum-action-btn danger" onclick="event.stopPropagation();askDelete('${ac.id}','${ac.name.replace(/'/g, "\\'")}')">${icon('trash','ico-mr')}Delete</button>
    </div>`;

  // The Set Active / ✓ Active toggle button shown in the card header itself, always visible.
  const headerActiveBtn = (ac, isActive) => `
    <button class="ac-head-active-btn ${isActive?'is-active':''}"
            onclick="event.stopPropagation();toggleActiveAc('${ac.id}')"
            title="${isActive?'Tap to clear active aircraft':'Use this aircraft for new log entries'}"
            aria-pressed="${isActive}">
      ${isActive?'✓ ACTIVE':'SET ACTIVE'}
    </button>`;

  el.innerHTML = acs.map((ac, idx)=>{
    const d = ac.data||{};
    const isActive = ac.id === activeId;
    // Aggregated stats
    const dayTotal     = (d.day_dual||0)+(d.day_pilot||0)+(d.day_copilot||0);
    const nightTotal   = (d.night_dual||0)+(d.night_pilot||0)+(d.night_copilot||0);
    const grandTotal   = dayTotal + nightTotal;
    const captainHrs   = (d.day_pilot||0) + (d.night_pilot||0);
    const sifTotal     = (d.sif||0)+(d.sif_day||0)+(d.sif_night||0);
    const imcTotal     = (d.imc||0)+(d.imc_day||0)+(d.imc_night||0);
    const wsoTotal     = (d.wso||0);

    if(grandTotal === 0 && captainHrs === 0 && sifTotal === 0 && imcTotal === 0 && wsoTotal === 0){
      return `<div class="ac-summary-card ${isActive?'is-active':''}">
        <div class="ac-summary-head" onclick="toggleAcSummary('${ac.id}')">
          <div class="ac-summary-head-left">
            <div class="ac-sum-name">${ac.name}</div>
          </div>
          <div class="ac-summary-head-right">
            ${headerActiveBtn(ac, isActive)}
            <div class="ac-sum-grandtotal" style="background:rgba(255,255,255,.04);color:var(--txt3);border-color:var(--bdr3)">No hours yet</div>
            <div class="ac-sum-toggle" id="tog_${ac.id}"><svg class="ico" aria-hidden="true"><use href="#i-chevron-down"/></svg></div>
          </div>
        </div>
        <div class="ac-sum-body" id="body_${ac.id}">
          <div class="ac-sum-empty">No flying hours entered for this aircraft yet.</div>
          ${actionRow(ac)}
        </div>
      </div>`;
    }

    return `<div class="ac-summary-card ${isActive?'is-active':''}">
      <div class="ac-summary-head" onclick="toggleAcSummary('${ac.id}')">
        <div class="ac-summary-head-left">
          <div class="ac-sum-name">${ac.name}</div>
        </div>
        <div class="ac-summary-head-right">
          ${headerActiveBtn(ac, isActive)}
          <div class="ac-sum-grandtotal">${hmHTML(grandTotal)}</div>
          <div class="ac-sum-toggle" id="tog_${ac.id}"><svg class="ico" aria-hidden="true"><use href="#i-chevron-down"/></svg></div>
        </div>
      </div>
      <div class="ac-sum-body" id="body_${ac.id}">
        <div class="ac-sum-grid">
          <div class="ac-sum-cell highlight full">
            <span class="ac-sum-lbl">Total Flying Hrs (Day + Night)</span>
            <span class="ac-sum-val total">${hmHTML(grandTotal)}</span>
          </div>
          <div class="ac-sum-cell highlight full">
            <span class="ac-sum-lbl">Captain Hrs (Day Plt + Ni Plt)</span>
            <span class="ac-sum-val captain">${hmHTML(captainHrs)}</span>
          </div>
          <div class="ac-sum-cell">
            <span class="ac-sum-lbl">Day Pilot</span>
            <span class="ac-sum-val">${hmHTML(d.day_pilot||0)}</span>
          </div>
          <div class="ac-sum-cell">
            <span class="ac-sum-lbl">Ni Pilot</span>
            <span class="ac-sum-val">${hmHTML(d.night_pilot||0)}</span>
          </div>
          <div class="ac-sum-cell">
            <span class="ac-sum-lbl">SIF</span>
            <span class="ac-sum-val">${hmHTML(sifTotal)}</span>
          </div>
          <div class="ac-sum-cell">
            <span class="ac-sum-lbl">IMC</span>
            <span class="ac-sum-val">${hmHTML(imcTotal)}</span>
          </div>
          <div class="ac-sum-cell full">
            <span class="ac-sum-lbl">WSO</span>
            <span class="ac-sum-val">${hmHTML(wsoTotal)}</span>
          </div>
        </div>
        ${actionRow(ac)}
      </div>
    </div>`;
  }).join('');
}

function toggleAcSummary(id){
  const body = document.getElementById('body_'+id);
  const tog = document.getElementById('tog_'+id);
  if(!body) return;
  const isOpen = body.classList.toggle('open');
  if(tog) tog.classList.toggle('open', isOpen);
}

// ── NEW ENTRY ──
function startNewEntry(){
  prevMode = 'new';
  prevCurrentAcId = null;
  document.getElementById('newAcInput').value = '';
  showSubview('name');
}

function goToDetail(){
  const name = document.getElementById('newAcInput').value.trim();
  if(!name){ showToast('Enter aircraft name', true); return; }
  if(prevMode==='new'){
    prevCurrentAcId = 'ac_'+Date.now();
  }
  buildDetailTable();
  showSubview('detail');
}

function buildDetailTable(){
  const acs = getAC();
  const existing = prevMode==='edit' ? (acs.find(a=>a.id===prevCurrentAcId)?.data||{}) : {};

  const cats = {};
  ALL_PE_FIELDS.forEach(f=>{
    if(!cats[f.cat]) cats[f.cat]=[];
    cats[f.cat].push(f);
  });

  let html='';
  Object.entries(cats).forEach(([cat,fields])=>{
    html+=`<tr class="cat-row"><td colspan="2">${cat}</td></tr>`;
    fields.forEach(f=>{
      html+=`<tr>
        <td>${f.lbl}</td>
        <td>${hmInputHTML({ idH:'dtl_'+f.key+'_h', idM:'dtl_'+f.key+'_m', mins:existing[f.key]||0 })}</td>
      </tr>`;
    });
  });
  document.getElementById('detailTableBody').innerHTML = html;
  // Wire up big tap targets + live validation on the newly-built table
  _initHmTapTargets();
}

function resetDetailFields(){
  ALL_PE_FIELDS.forEach(f=>{
    const h=document.getElementById('dtl_'+f.key+'_h');
    const m=document.getElementById('dtl_'+f.key+'_m');
    if(h) h.value='';
    if(m) m.value='';
  });
  showToast('Fields reset');
}

function showConfirmPopup(){
  const name = prevMode==='edit'
    ? getAC().find(a=>a.id===prevCurrentAcId)?.name
    : document.getElementById('newAcInput').value.trim();
  document.getElementById('confirmBody').textContent =
    `Save all hours for "${name}"? ${prevMode==='edit'?'Existing data will be updated.':'This will create a new aircraft entry.'}`;
  document.getElementById('confirmPopup').classList.add('active');
}
function closePopup(){ document.getElementById('confirmPopup').classList.remove('active'); }

function doConfirmSave(){
  // Validate all hour inputs first
  const data = {};
  for(const f of ALL_PE_FIELDS){
    const r = readValidatedHM('dtl_'+f.key+'_h', 'dtl_'+f.key+'_m', f.lbl);
    if(!r.ok){ showToast(r.err, true); return; }
    data[f.key] = r.mins;
  }
  closePopup();
  const acs = getAC();
  const wasFirstAircraft = (prevMode==='new' && acs.length === 0);
  if(prevMode==='new'){
    const name = document.getElementById('newAcInput').value.trim();
    // Guard against creating a duplicate when Save runs twice for the same
    // in-progress aircraft (e.g. user saves manually, then "Get Back" in the
    // tutorial saves again). Match first by id, then by name (case-
    // insensitive) — goToDetail() mints a fresh id each run, so a second save
    // could otherwise create a same-name twin with a different id.
    let existing = acs.find(a=>a.id===prevCurrentAcId);
    if(!existing && name){
      existing = acs.find(a=> (a.name||'').trim().toLowerCase() === name.toLowerCase());
    }
    if(existing){
      existing.name = name || existing.name;
      existing.data = data;
      prevCurrentAcId = existing.id;   // keep working with the surviving entry
    } else {
      acs.push({ id: prevCurrentAcId, name, data });
    }
  } else {
    const ac = acs.find(a=>a.id===prevCurrentAcId);
    if(ac){
      ac.data = data;
      // Also persist any change to the aircraft name made on the Step-1
      // name screen during edit. Previously only hours were saved, so a
      // renamed aircraft silently kept its old name. Guard against blank.
      const editedName = document.getElementById('newAcInput').value.trim();
      if(editedName) ac.name = editedName;
    }
  }
  setAC(acs);
  // Auto-activate the very first aircraft so Log Entry works without an extra step.
  if(wasFirstAircraft) setActiveAcId(prevCurrentAcId);
  renderAcList();
  showSubview('list');
  showToast(prevMode==='edit'?'Entry updated ✓':'Aircraft added ✓');
  renderHome();
}

// ── EDIT ──
function startEditList(){
  const acs = getAC();
  const el = document.getElementById('acEditList');
  if(!acs.length){ showToast('No aircraft to edit', true); return; }
  el.innerHTML = acs.map(ac=>`
    <div class="ac-item" onclick="startEditAc('${ac.id}')">
      <div>
        <div class="ac-item-name">${ac.name}</div>
        <div class="ac-item-total">Tap to edit hours</div>
      </div>
      <div class="ac-item-arrow">${icon('pencil')}</div>
    </div>`).join('');
  showSubview('editlist');
}

function startEditAc(id){
  prevMode = 'edit';
  prevCurrentAcId = id;
  const ac = getAC().find(a=>a.id===id);
  document.getElementById('newAcInput').value = ac?.name||'';
  // Show the NAME step first (Step 1) — same as the add flow — so the user
  // can review/change the aircraft name before proceeding to the hours.
  // Previously this jumped straight to the detail (hours) subview, so the
  // name step only appeared when the user pressed Back. goToDetail() (the
  // NEXT button) carries through to the hours table and, because prevMode
  // is 'edit', preserves the existing aircraft id rather than creating a
  // new one.
  buildDetailTable();
  showSubview('name');
}

// ── DELETE ──
function startDeleteList(){
  const acs = getAC();
  const el = document.getElementById('acDelList');
  if(!acs.length){ showToast('No aircraft to delete', true); return; }
  el.innerHTML = acs.map(ac=>`
    <div class="ac-del-item">
      <div>
        <div class="ac-item-name">${ac.name}</div>
      </div>
      <button class="ac-del-btn-small" onclick="askDelete('${ac.id}','${ac.name}')">DELETE</button>
    </div>`).join('');
  showSubview('dellist');
}

function askDelete(id, name){
  pendingDeleteId = id;
  document.getElementById('deleteBody').textContent = `Delete "${name}" and all its prior experience hours? This cannot be undone.`;
  document.getElementById('deletePopup').classList.add('active');
}
function closeDeletePopup(){ document.getElementById('deletePopup').classList.remove('active'); }
function doDelete(){
  closeDeletePopup();
  // If the deleted aircraft was the active one, clear active state
  if(getActiveAcId() === pendingDeleteId) setActiveAcId(null);
  setAC(getAC().filter(a=>a.id!==pendingDeleteId));
  startDeleteList();
  renderAcList();
  renderHome();
  showToast('Aircraft deleted');
}

// Toggle the active-aircraft flag. Tapping the active aircraft's button clears
// active (no aircraft active). Tapping a different aircraft switches active to it.
function toggleActiveAc(id){
  const cur = getActiveAcId();
  if(cur === id){
    setActiveAcId(null);
    showToast('No active aircraft');
  } else {
    setActiveAcId(id);
    const ac = getAC().find(a=>a.id===id);
    showToast((ac?.name||'Aircraft') + ' set as active ✓');
  }
  renderAcList();
}

// ════════════════════════════════════════════════════
// LOG ENTRY
// ════════════════════════════════════════════════════

// Click anywhere on an HM box to focus its hour input (bigger tap target)
function _initHmTapTargets(){
  // Tap anywhere on an HM-input wrapper to focus its first input.
  // Covers: .hrs-hm (log entry Day/Night rows), .spl-cell (log entry special hours),
  //         .hm-box (Prior Experience detail table).
  document.querySelectorAll('.hrs-hm, .spl-cell, .hm-box').forEach(box=>{
    if(box._tapWired) return;
    box._tapWired = true;
    box.addEventListener('click', (e)=>{
      if(e.target.tagName === 'INPUT') return;
      const firstInput = box.querySelector('input');
      if(firstInput){ firstInput.focus(); firstInput.select(); }
    });
  });
  // Real-time validation on dynamically-built .hm-box inputs (PE detail table).
  document.querySelectorAll('.hm-box input').forEach(inp=>{
    if(inp._validatorAttached) return;
    inp._validatorAttached = true;
    inp.addEventListener('input', validateHMInputLive);
    inp.addEventListener('blur', validateHMInputLive);
  });
}

// ─── Axis-lock scrolling for the logbook table.
// On touch devices, the logbook table allows both horizontal (12+ columns) and
// vertical (many rows) scroll. With both axes unlocked, a finger drag that's
// even slightly diagonal ends up scrolling both ways simultaneously, which
// reads as "drift" and disorients the user. This handler locks each touch
// gesture to whichever axis dominates the first ~8px of movement, so once a
// drag is identified as "horizontal", vertical scroll is frozen for that
// gesture (and vice-versa). The axis is re-evaluated on every new touchstart.
function _initAxisLockScroll(){
  if(window._axisLockWired) return;
  window._axisLockWired = true;
  // Selector covers any current OR future logbook table wrappers — renderLogbook
  // re-creates these on every month change, but the handler is wired to document
  // and dispatches via closest(), so re-wiring isn't needed per render.
  let startX = 0, startY = 0, scrollLeft0 = 0, scrollTop0 = 0;
  let axis = null;    // 'x' | 'y' | null (undecided)
  let target = null;
  const DECISION_PX = 8;   // px of movement before locking
  document.addEventListener('touchstart', (e)=>{
    const t = e.target.closest('.lb-table-wrap');
    if(!t || e.touches.length !== 1) { axis = null; target = null; return; }
    target = t;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    scrollLeft0 = t.scrollLeft;
    scrollTop0  = t.scrollTop;
    axis = null;
  }, {passive:true});
  document.addEventListener('touchmove', (e)=>{
    if(!target || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if(axis === null){
      // Decide axis when movement crosses threshold
      if(Math.abs(dx) > DECISION_PX || Math.abs(dy) > DECISION_PX){
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      } else {
        return;
      }
    }
    // Freeze the OTHER axis by repeatedly re-setting it to its starting value.
    // Doing this on every move event prevents the browser's native scroll from
    // accumulating off-axis movement across the gesture.
    if(axis === 'x'){
      target.scrollTop  = scrollTop0;
    } else {
      target.scrollLeft = scrollLeft0;
    }
  }, {passive:true});
  document.addEventListener('touchend',   ()=>{ axis = null; target = null; }, {passive:true});
  document.addEventListener('touchcancel',()=>{ axis = null; target = null; }, {passive:true});
}

// ─── Keyboard-clearance: scroll a focused input above the on-screen keyboard.
// On mobile the virtual keyboard covers the bottom ~40-45% of the viewport, so
// inputs near the bottom of the entry form (WSO) and the prior-experience
// detail table (Instr Night / WSO rows) end up hidden when tapped. The CSS
// gives us enough scroll padding-bottom that the input CAN be scrolled into
// view; this handler ensures the browser actually does it.
function _initKeyboardScrollFix(){
  if(window._kbScrollWired) return;
  window._kbScrollWired = true;
  let activeInput = null;
  // Remember the initial window height so we can detect keyboard open/close
  // by comparing the current innerHeight to it. In Android WebView the
  // visualViewport API often doesn't fire its `resize` event when the
  // keyboard opens — Android resizes the WebView itself (via
  // android:windowSoftInputMode=adjustResize, the default) so we observe
  // the change via `window.innerHeight` instead.
  const ORIGINAL_H = window.innerHeight;
  let keyboardOpen = false;

  function bringInputIntoView(inp){
    if(!inp) return;
    const scroller = inp.closest('#entry .form-scroll, #entry .scroll-area, #sv_detail .scroll-area');
    if(!scroller) return;
    const inpRect = inp.getBoundingClientRect();
    // Effective visible bottom: prefer visualViewport when it actually reports
    // a meaningful shrunk height; fall back to window.innerHeight (which IS
    // updated when Android WebView is resized by the keyboard via adjustResize).
    const vv = window.visualViewport;
    let visibleBottom;
    if(vv && vv.height < window.innerHeight){
      visibleBottom = vv.offsetTop + vv.height;
    } else {
      visibleBottom = window.innerHeight;
    }
    // STRATEGY CHANGE: instead of nudging the input just above the keyboard
    // line (which depends on knowing the keyboard height — unreliable across
    // OEM WebViews), we scroll the focused input toward the TOP of the visible
    // area. An input near the top of the screen is ALWAYS above the keyboard,
    // regardless of how tall the keyboard is. We aim to place the input's top
    // at ~110px from the top of the scroller's visible region (leaving room
    // for its section header just above it).
    const scrollerRect = scroller.getBoundingClientRect();
    const targetTopWithinScroller = 110;        // px from the top of the visible scroll area
    const inputTopWithinScroller = inpRect.top - scrollerRect.top;
    const delta = inputTopWithinScroller - targetTopWithinScroller;
    // Positive delta → input is below the target line → scroll down to lift it up.
    // Negative delta → input is above the target → scroll up to push it down.
    scroller.scrollTop += delta;
  }

  // When the WebView shrinks (keyboard opening), add extra scroll-padding
  // to the scroll-area equal to the height the keyboard takes. This GUARANTEES
  // that any input — even the last one in the form — can be scrolled above
  // the keyboard. Without this, the LAST input is stuck at the bottom of the
  // scroller no matter how many pixels of padding we set in CSS, because the
  // CSS padding is fixed and may be smaller than the actual keyboard.
  function applyDynamicKeyboardPadding(){
    const heightDelta = ORIGINAL_H - window.innerHeight;
    const isOpen = heightDelta > 150;  // > 150px → keyboard is definitely up
    if(isOpen === keyboardOpen) return;
    keyboardOpen = isOpen;
    const scrollers = document.querySelectorAll('#entry .form-scroll, #entry .scroll-area, #sv_detail .scroll-area');
    scrollers.forEach(s=>{
      if(isOpen){
        // Store original padding so we can restore on close
        if(!s.dataset.origPbStored){
          s.dataset.origPbStored = '1';
          s.dataset.origPb = s.style.paddingBottom || '';
        }
        // heightDelta is the keyboard height — add it as inline padding so
        // even the last input has scroll room above the keyboard. We add a
        // generous 220px buffer on top so the LAST rows (WSO, Instructor-Ni)
        // in the entry form and PE detail table can be scrolled well clear of
        // the keypad — users reported these specific rows still hiding with a
        // smaller buffer.
        s.style.paddingBottom = (heightDelta + 360) + 'px';
      } else {
        // Restore original padding (CSS-driven) when keyboard closes
        s.style.paddingBottom = s.dataset.origPb || '';
      }
    });
    // Re-position the focused input after padding change
    if(isOpen && activeInput && document.activeElement === activeInput){
      // Defer one frame so the new padding takes effect first
      requestAnimationFrame(()=>bringInputIntoView(activeInput));
    }
  }

  document.addEventListener('focusin', (e)=>{
    const inp = e.target;
    if(!inp || (inp.tagName !== 'INPUT' && inp.tagName !== 'TEXTAREA' && inp.tagName !== 'SELECT')) return;
    const scroller = inp.closest('#entry .form-scroll, #entry .scroll-area, #sv_detail .scroll-area');
    if(!scroller) return;
    activeInput = inp;
    // Belt-and-braces: immediately add a large bottom padding to the scroll-area
    // on focus, WITHOUT waiting for the resize event. On some Android WebView
    // builds the window.resize event for the keyboard never fires (e.g. when
    // windowSoftInputMode is adjustPan instead of adjustResize), so the
    // resize-driven padding never kicks in. Adding it here on focus guarantees
    // the scroll room exists. We store the original so focusout can restore it.
    if(!scroller.dataset.focusPadStored){
      scroller.dataset.focusPadStored = '1';
      scroller.dataset.focusPadOrig = scroller.style.paddingBottom || '';
    }
    // Screen-specific bottom padding on focus:
    //   • #entry (New Log Entry, special/qualification hours incl. WSO) gets a
    //     LARGE 800px so the user can scroll well past the keyboard to reach
    //     the very last field, with extra room to spare (item 2).
    //   • #sv_detail (Prior Experience page 2 of 2) gets a MODEST 300px — the
    //     scroll-to-top logic still lifts the focused field above the keyboard,
    //     but without leaving a big empty gap under WSO that the user disliked
    //     (item 4).
    const isEntry = !!inp.closest('#entry .form-scroll, #entry .scroll-area');
    scroller.style.paddingBottom = isEntry ? '800px' : '300px';
    // Multi-stage scroll: WebView keyboards open in 200-600ms depending on the
    // device. We re-run the scroll several times so that by the time the
    // keyboard is fully open we've placed the input near the top of the visible
    // area. Each call is cheap. Extra late attempts (1200/1600ms) catch slow
    // OEM keyboard animations.
    setTimeout(()=>bringInputIntoView(inp), 150);
    setTimeout(()=>bringInputIntoView(inp), 350);
    setTimeout(()=>bringInputIntoView(inp), 600);
    setTimeout(()=>bringInputIntoView(inp), 900);
    setTimeout(()=>bringInputIntoView(inp), 1200);
    setTimeout(()=>bringInputIntoView(inp), 1600);
  });

  // Listen for the WebView's resize event — fires every time the keyboard
  // toggles in Android with android:windowSoftInputMode=adjustResize (default).
  window.addEventListener('resize', applyDynamicKeyboardPadding);

  // visualViewport listener for browsers / iOS where window.resize doesn't fire
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', ()=>{
      applyDynamicKeyboardPadding();
      if(activeInput && document.activeElement === activeInput){
        bringInputIntoView(activeInput);
      }
    });
  }

  document.addEventListener('focusout', (e)=>{
    activeInput = null;
    const scroller = e.target.closest && e.target.closest('#entry .form-scroll, #entry .scroll-area, #sv_detail .scroll-area');
    if(!scroller) return;
    // Restore the original (compact) padding shortly after blur — but only if
    // focus didn't immediately move to ANOTHER input in the same scroller (the
    // user tabbing field to field). The 250ms delay lets a new focusin cancel
    // the restore by re-setting activeInput.
    setTimeout(()=>{
      if(activeInput) return;   // focus moved to another field — keep the padding
      if(scroller.dataset.focusPadStored){
        scroller.style.paddingBottom = scroller.dataset.focusPadOrig || '';
        delete scroller.dataset.focusPadStored;
        delete scroller.dataset.focusPadOrig;
      }
    }, 250);
  });
}

function initEntry(){
  // ── Self-healing suggestion backfill ─────────────────────────────────
  // Safety net for the dropdowns. If a suggestion list is empty AND it was
  // never seeded (flag absent), rebuild it from existing log entries here.
  // This guarantees population whenever there's data, covering any case
  // where a first-launch seed or an import force-seed didn't take (stale
  // cached build, ordering edge case, etc.).
  //
  // The seed-flag guard is what preserves a DELIBERATELY emptied list: once
  // seeding has run (flag set), the user is in control — if they've deleted
  // every name, the list stays empty and this won't refill it. It only fires
  // when seeding genuinely never happened, so it can't resurrect deletions.
  try {
    const entries = getEntries();
    if(entries.length){
      let nameSeeded = false, acnoSeeded = false;
      try { nameSeeded = !!localStorage.getItem(K_NAMES_SEEDED); } catch(_){}
      try { acnoSeeded = !!localStorage.getItem(K_ACNOS_SEEDED); } catch(_){}
      if(!nameSeeded && getNames().length === 0){
        _seedNameSuggestionsFromEntries(true);
      }
      if(!acnoSeeded && getAcnos().length === 0){
        _seedAcnosFromEntries(true);
      }
    }
  } catch(_){ /* never block the entry form on a backfill issue */ }

  // ── Aircraft type: driven by the Active Aircraft chosen in Prior Experience ──
  const acs = getAC();
  const activeId = getActiveAcId();
  const sel = document.getElementById('f_actype');
  if(activeId){
    const ac = acs.find(a=>a.id===activeId);
    sel.innerHTML = `<option value="${ac.id}">${ac.name}</option>`;
    sel.value = ac.id;
  } else {
    // No active aircraft set
    sel.innerHTML = acs.length
      ? '<option value="">— Set an active aircraft in Prior Experience —</option>'
      : '<option value="">— Add an aircraft in Prior Experience first —</option>';
    sel.value = '';
  }
  // Field stays disabled regardless — user changes the active aircraft from PE.
  sel.disabled = true;
  onEntryTypeChange();

  // ── Default date / month / year to today (only when fields are empty so edit-mode is preserved) ──
  const dateEl  = document.getElementById('f_date');
  const monthEl = document.getElementById('f_month');
  const yearEl  = document.getElementById('f_year');
  if(dateEl && !dateEl.value && monthEl && !monthEl.value && yearEl){
    const t = new Date();
    dateEl.value  = String(t.getDate());
    monthEl.value = MONTHS[t.getMonth()];
    yearEl.value  = String(t.getFullYear());
  } else if(yearEl && !yearEl.value){
    // Fallback: at least seed year so the hardcoded "2026" no longer locks the form to one year
    yearEl.value = String(new Date().getFullYear());
  }

  // ── Wire up future-date guards on date / month / year ──
  // `change` only (not `blur`) — `blur` fires every time the user tabs out mid-entry
  // and can flag transient intermediate values as "future" before the user finishes.
  [dateEl, monthEl, yearEl].forEach(el=>{
    if(!el || el._futureGuardWired) return;
    el._futureGuardWired = true;
    el.addEventListener('change', enforceNoFutureDate);
  });

  // Attach real-time validation listeners to all hour/minute inputs
  document.querySelectorAll('.hrs-hm input, .spl-hm input').forEach(inp=>{
    if(inp._validatorAttached) return;
    inp._validatorAttached = true;
    inp.addEventListener('input', validateHMInputLive);
    inp.addEventListener('blur', validateHMInputLive);
  });

  // ─── Auto-replication: WSO mirrors Day total on black ink, NVG mirrors
  //     Night total on NVG ink ──────────────────────────────────────────
  // Two convenience replications drawn from common Indian Army Aviation
  // logbook conventions:
  //   • Black-ink sortie: every entry in Day Dual / Pilot / Co-Pilot should
  //     be reflected in the WSO column total (the WSO time IS the day time
  //     for a single-seat or non-WSO-split entry). User can edit WSO
  //     manually if it's different — once they do, auto-fill stops touching it.
  //   • NVG-ink sortie: every entry in Night Dual / Pilot / Co-Pilot should
  //     be reflected in the single NVG cell. Same override behaviour.
  _initAutoReplication();

  // Big-tap support: clicking anywhere on a box focuses its input
  _initHmTapTargets();
  _initEntryHmAutoJump();
}

// ─── Auto-replication helpers ────────────────────────────────────────────
// State: tracks whether the user has manually touched the WSO and NVG cells
// since the current entry-form was opened. Once they have, auto-fill stops
// overwriting that field. Reset at form-open via resetAutoReplication().
let _wsoManuallyTouched = false;
let _nvgManuallyTouched = false;

function resetAutoReplication(){
  _wsoManuallyTouched = false;
  _nvgManuallyTouched = false;
}

// Read an h:m pair of inputs and return total minutes; tolerates empty fields.
function _readHM(idH, idM){
  const h = parseInt(document.getElementById(idH)?.value, 10);
  const m = parseInt(document.getElementById(idM)?.value, 10);
  return (Number.isFinite(h)?h:0) * 60 + (Number.isFinite(m)?m:0);
}

// Write a minutes value into an h:m pair, splitting it into the two boxes.
// Empty boxes for zero so the placeholder ("0" / "00") stays visible.
function _writeHM(idH, idM, mins){
  const h = document.getElementById(idH);
  const m = document.getElementById(idM);
  if(!h || !m) return;
  if(mins <= 0){
    h.value = ''; m.value = '';
  } else {
    h.value = String(Math.floor(mins/60));
    m.value = String(mins%60).padStart(2,'0');
  }
}

// Triggered whenever any Day-row input changes (black ink only): sum Day
// total and write it into the WSO cell, unless the user has manually edited WSO.
function _replicateWSOFromDay(){
  if(_wsoManuallyTouched) return;
  const total = _readHM('h_day_dual_h','h_day_dual_m')
              + _readHM('h_day_pilot_h','h_day_pilot_m')
              + _readHM('h_day_copilot_h','h_day_copilot_m');
  _writeHM('s_wso_h','s_wso_m', total);
}

// Triggered whenever any Night-row input changes (NVG ink only): sum Night
// total and write it into the NVG cell, unless the user has manually edited NVG.
function _replicateNVGFromNight(){
  if(_nvgManuallyTouched) return;
  const total = _readHM('h_night_dual_h','h_night_dual_m')
              + _readHM('h_night_pilot_h','h_night_pilot_m')
              + _readHM('h_night_copilot_h','h_night_copilot_m');
  _writeHM('s_nvg_h','s_nvg_m', total);
}

function _initAutoReplication(){
  // Wire each Day input → WSO replication (active only when black ink selected).
  // Use the LOG_HOUR_FIELDS ids so we don't hardcode duplicates.
  const dayIds = [
    'h_day_dual_h','h_day_dual_m',
    'h_day_pilot_h','h_day_pilot_m',
    'h_day_copilot_h','h_day_copilot_m',
  ];
  dayIds.forEach(id=>{
    const el = document.getElementById(id);
    if(!el || el._autoReplWired) return;
    el._autoReplWired = true;
    el.addEventListener('input', ()=>{
      const t = document.getElementById('f_entrytype')?.value;
      if(t === 'black') _replicateWSOFromDay();
    });
  });

  // Wire each Night input → NVG replication (active only when nvg ink selected).
  const nightIds = [
    'h_night_dual_h','h_night_dual_m',
    'h_night_pilot_h','h_night_pilot_m',
    'h_night_copilot_h','h_night_copilot_m',
  ];
  nightIds.forEach(id=>{
    const el = document.getElementById(id);
    if(!el || el._autoReplWired) return;
    el._autoReplWired = true;
    el.addEventListener('input', ()=>{
      const t = document.getElementById('f_entrytype')?.value;
      if(t === 'nvg') _replicateNVGFromNight();
    });
  });

  // Detect manual edits to WSO and NVG — once the user touches either,
  // auto-replication stops writing to that field for the remainder of
  // this form session. Their intent wins.
  ['s_wso_h','s_wso_m'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el || el._touchWired) return;
    el._touchWired = true;
    // Use 'change' (fires on actual user-initiated change, not programmatic
    // value-set) so our own _writeHM calls don't trip the manual-edit flag.
    el.addEventListener('change', ()=>{ _wsoManuallyTouched = true; });
  });
  ['s_nvg_h','s_nvg_m'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el || el._touchWired) return;
    el._touchWired = true;
    el.addEventListener('change', ()=>{ _nvgManuallyTouched = true; });
  });
}


// Returns true if the date/month/year currently entered in the Log Entry form is in the future.
// Returns false if any field is empty or the date is today/past.
function _isFutureLogDate(){
  const d = parseInt(document.getElementById('f_date')?.value, 10);
  const monStr = document.getElementById('f_month')?.value;
  const y = parseInt(document.getElementById('f_year')?.value, 10);
  if(!d || !monStr || !y) return false;
  const monIdx = MONTHS.indexOf(monStr);
  if(monIdx < 0) return false;
  // Compare chosen date (at midnight) against the start of TOMORROW (at midnight).
  // This way the entire current day passes — no timezone slop, no minute-precision edge cases.
  const chosen = new Date(y, monIdx, d, 0, 0, 0).getTime();
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 0).getTime();
  return chosen >= startOfTomorrow;
}

// Snap the date back to today if user enters something in the future.
function enforceNoFutureDate(){
  if(!_isFutureLogDate()) return;
  const t = new Date();
  document.getElementById('f_date').value  = String(t.getDate());
  document.getElementById('f_month').value = MONTHS[t.getMonth()];
  document.getElementById('f_year').value  = String(t.getFullYear());
  showToast('Future date not allowed — reset to today', true, 3000);
}

function validateHMInputLive(evt){
  const inp = evt.target;
  const id = inp.id;
  const val = (inp.value||'').toString();
  const isHour = id.endsWith('_h');
  const isMin = id.endsWith('_m');

  let invalid = false;
  let errMsg = '';

  if(val !== ''){
    // Check for decimals, negatives, letters
    if(!/^\d+$/.test(val)){
      invalid = true;
      if(/[a-zA-Z]/.test(val)) errMsg = 'No letters allowed';
      else if(val.includes('.') || val.includes(',')) errMsg = 'No decimals — whole numbers only';
      else if(val.includes('-')) errMsg = 'No negative values';
      else errMsg = 'Whole numbers only';
    }
    // Digit limit check — follow the input's own maxLength attribute so the same
    // validator covers Prior Experience (hour max 5) AND Log Entry (hour max 1).
    else if(isHour && val.length > (inp.maxLength > 0 ? inp.maxLength : 5)){
      invalid = true;
      const lim = inp.maxLength > 0 ? inp.maxLength : 5;
      errMsg = `Hour field max ${lim} digit${lim>1?'s':''}`;
    }
    else if(isMin && val.length > 2){
      invalid = true;
      errMsg = 'Minute field max 2 digits';
    }
    // Minute must also be 0-59
    else if(isMin && parseInt(val,10) > 59){
      invalid = true;
      errMsg = 'Minutes must be 0-59';
    }
  }

  // Toggle invalid class on the parent container
  const hmBox = inp.closest('.hrs-hm') || inp.closest('.spl-cell') || inp.closest('.hm-box');
  if(hmBox){
    hmBox.classList.toggle('invalid', invalid);
  }
  if(invalid && evt.type==='blur'){
    showToast(errMsg, true, 2400);
  }
}

function onEntryTypeChange(){
  const t = document.getElementById('f_entrytype').value;
  const info = ENTRY_COLORS[t]||ENTRY_COLORS.black;
  // Resolve the active hex for the current mode — black ink renders as silver
  // in dark modes and as near-black in light mode, so the input text on the
  // entry form follows the same convention.
  const inkHex = _inkHex(t);
  // Set the color strip beneath the entry type dropdown
  const cs = document.getElementById('colorStrip');
  if(cs) cs.style.background = inkHex;
  // Set the typed-text color on every hour input so anything typed appears in chosen ink
  const all = document.querySelectorAll('.hrs-hm input, .spl-hm input');
  all.forEach(el=>{ el.style.color = inkHex; });
  document.querySelectorAll('.spl-hm input').forEach(el=>{ el.style.borderBottomColor = inkHex; });

  // DAY vs NIGHT row activation:
  //   info.night === true  => NIGHT row active, DAY disabled
  //   info.night === false => DAY row active, NIGHT disabled
  const dayRow   = document.getElementById('row_day');
  const nightRow = document.getElementById('row_night');
  if(info.night){
    if(dayRow)   dayRow.classList.add('disabled');
    if(nightRow) nightRow.classList.remove('disabled');
  } else {
    if(dayRow)   dayRow.classList.remove('disabled');
    if(nightRow) nightRow.classList.add('disabled');
  }

  // Visibility rule: NVG, Instr Day, and Instr Night cells are ALWAYS visible — the
  // form layout stays stable across ink switches. They're disabled (greyed, inputs
  // cleared & locked, pointer-events off) when the chosen ink type makes them inapplicable.
  //   NVG cell        → enabled only on NVG ink
  //   Instr Day cell  → disabled on NIGHT-family inks (red/nvg), enabled on day inks
  //   Instr Night cell→ disabled on DAY inks (black/blue), enabled on night-family inks
  function _setCellEnabled(cell, enabled){
    if(!cell) return;
    if(enabled){
      cell.classList.remove('disabled','spl-disabled');
      cell.querySelectorAll('input').forEach(inp=>{ inp.disabled = false; });
    } else {
      cell.classList.add('disabled');
      cell.querySelectorAll('input').forEach(inp=>{ inp.value = ''; inp.disabled = true; });
    }
  }
  _setCellEnabled(document.getElementById('spl_nvg'),         info.nvg);
  _setCellEnabled(document.getElementById('spl_instr_day'),   !info.night);
  _setCellEnabled(document.getElementById('spl_instr_night'),  info.night);

  // Reset auto-replication touch-tracking on every ink change so switching
  // ink type starts a fresh replication cycle (otherwise switching to black
  // with WSO previously edited would never auto-fill again, which is annoying
  // because the user expects fresh ink to mean fresh fill behaviour).
  resetAutoReplication();
  // And re-run the appropriate replication immediately so the destination
  // cell matches the new ink's convention (e.g. switching from blue to black
  // should populate WSO from existing Day values right now).
  if(t === 'black') _replicateWSOFromDay();
  else if(t === 'nvg') _replicateNVGFromNight();
}

function saveEntry(){
  const month    = document.getElementById('f_month').value;
  const year     = document.getElementById('f_year').value.trim();
  const date     = document.getElementById('f_date').value.trim();
  const acId     = document.getElementById('f_actype').value;
  const acno     = document.getElementById('f_acno').value.trim();
  const pilot    = document.getElementById('f_pilot').value.trim();
  const copilot  = document.getElementById('f_copilot').value.trim();
  const route    = document.getElementById('f_route').value.trim();
  const t        = document.getElementById('f_entrytype').value;

  // Mandatory field check
  const missing = [];
  if(!month)    missing.push('Month');
  if(!year)     missing.push('Year');
  if(!date)     missing.push('Date');
  if(!acId)     missing.push('Aircraft Type');
  if(!acno)     missing.push('Aircraft No');
  if(!pilot)    missing.push('Pilot');
  if(!copilot)  missing.push('Co-Pilot');
  if(!route)    missing.push('Route');
  if(!t)        missing.push('Entry Type');

  if(missing.length){
    // If the only missing piece is Aircraft Type, guide the user to Prior Experience
    if(missing.length === 1 && missing[0] === 'Aircraft Type'){
      showToast('Set an active aircraft in Prior Experience first', true, 4000);
    } else {
      showToast('Missing: '+missing.join(', '), true, 4000);
    }
    return;
  }

  // Pilot and Co-Pilot cannot be the same person (case-insensitive).
  if(pilot && copilot && pilot.trim().toLowerCase() === copilot.trim().toLowerCase()){
    showToast('Pilot and Co-Pilot cannot be the same name', true, 4000);
    return;
  }

  // Final guard against future-dated entries (in addition to the live guard on field change).
  if(_isFutureLogDate()){
    enforceNoFutureDate();
    return;
  }

  if(!/^\d{1,2}$/.test(date) || +date < 1 || +date > 31){
    showToast('Date must be a whole number 1-31', true); return;
  }

  // Both day and night rows are ALWAYS available now
  const isNight = ENTRY_COLORS[t]?.night;
  const isNVG   = ENTRY_COLORS[t]?.nvg;

  // Only validate fields belonging to the active (ink color) row
  const ctx = { isNight, isNVG };
  const values = {};
  for(const f of LOG_HOUR_FIELDS){
    if(f.skipWhen && f.skipWhen(ctx)){ values[f.key] = 0; continue; }
    const r = readValidatedHM(f.idH, f.idM, f.lbl);
    if(!r.ok){ showToast(r.err, true); return; }
    values[f.key] = r.mins;
  }

  // Require at least one Day OR Night hour value > 0
  const totalFlying = values.day_dual + values.day_pilot + values.day_copilot
                    + values.night_dual + values.night_pilot + values.night_copilot;
  if(totalFlying === 0){
    showToast('Enter at least one ' + (isNight?'Night':'Day') + ' hour value', true);
    return;
  }

  // Exclusivity check: a single sortie should have hours in ONLY ONE of Dual/Pilot/Co-Pilot
  // (you cannot be flying as Dual AND as Pilot at the same time)
  if(isNight){
    const filled = [
      {v:values.night_dual,    name:'Night Dual'},
      {v:values.night_pilot,   name:'Night Pilot'},
      {v:values.night_copilot, name:'Night Co-Pilot'},
    ].filter(x=>x.v>0);
    if(filled.length > 1){
      showToast('Only one of '+filled.map(x=>x.name).join(' / ')+' should have hours for a single sortie', true, 4500);
      return;
    }
  } else {
    const filled = [
      {v:values.day_dual,    name:'Day Dual'},
      {v:values.day_pilot,   name:'Day Pilot'},
      {v:values.day_copilot, name:'Day Co-Pilot'},
    ].filter(x=>x.v>0);
    if(filled.length > 1){
      showToast('Only one of '+filled.map(x=>x.name).join(' / ')+' should have hours for a single sortie', true, 4500);
      return;
    }
  }

  // NVG validation: NVG hours cannot exceed the total night flying hours
  // (NVG is part of night flying — only checked when NVG ink is selected)
  if(isNVG && values.nvg > 0){
    const nightTotal = values.night_dual + values.night_pilot + values.night_copilot;
    if(values.nvg > nightTotal){
      showToast('NVG ('+hm(values.nvg)+') cannot exceed Night Flying ('+hm(nightTotal)+')', true, 4500);
      return;
    }
  }

  // Special-hours sub-total check: IMC, SIF, Instr Day, Instr Ni, WSO 
  // are subsets of the actual flying hours, so none of them can exceed
  // the total Day or Night flying hours of the sortie.
  const dayTotal   = values.day_dual + values.day_pilot + values.day_copilot;
  const nightTotal = values.night_dual + values.night_pilot + values.night_copilot;
  const sortieTotal = dayTotal + nightTotal;
  // For each special hour, define what part of the sortie it can\'t exceed
  const splChecks = [
    {key:'imc',         label:'IMC',         max:sortieTotal, maxName:'Total Flying'},
    {key:'sif',         label:'SIF',         max:sortieTotal, maxName:'Total Flying'},
    {key:'wso',         label:'WSO',         max:sortieTotal, maxName:'Total Flying'},
    {key:'instr_day',   label:'Instructor Day',   max:dayTotal,   maxName:'Day Flying'},
    {key:'instr_night', label:'Instructor Night', max:nightTotal, maxName:'Night Flying'},
  ];
  for(const c of splChecks){
    const v = values[c.key] || 0;
    if(v > 0 && v > c.max){
      showToast(c.label+' ('+hm(v)+') cannot exceed '+c.maxName+' ('+hm(c.max)+')', true, 4500);
      return;
    }
  }

  _pendingEntry = {
    id: Date.now(),
    month, year, date, entryType: t,
    acId, acName: document.getElementById('f_actype').selectedOptions[0]?.text||'',
    acno, pilot, copilot, route,
    ...values,
  };

  document.getElementById('entryConfirmSummary').innerHTML = `
    <div class="confirm-row-item"><span>Date:</span><b>${date} ${month} ${year}</b></div>
    <div class="confirm-row-item"><span>Aircraft:</span><b>${_pendingEntry.acName} · ${acno}</b></div>
    <div class="confirm-row-item"><span>Pilot:</span><b>${pilot}</b></div>
    <div class="confirm-row-item"><span>Co-Pilot:</span><b>${copilot}</b></div>
    <div class="confirm-row-item"><span>Ink Type:</span><b style="color:${_inkHex(t)}">${t.toUpperCase()}</b></div>
    <div class="confirm-row-item"><span>Total Hrs:</span><b>${hmHTML(totalFlying)}</b></div>
  `;
  document.getElementById('entryConfirmPopup').classList.add('active');
}

function _resetEditingState(){
  _editingEntryId = null;
  const saveBtn = document.querySelector('.entry-action-bar .confirm-btn');
  if(saveBtn) saveBtn.textContent = '⊕ SAVE SORTIE ENTRY';
}

// Brief gold checkmark draw-in shown on saving a new sortie — a small moment
// of reward. Animates OVER whatever is on screen (incl. the confirm popup) and
// invokes onDone when the animation completes, so the caller can defer closing
// the popup until the tick has finished. Non-blocking; self-removes.
// Total Captain hours (mins) across ALL aircraft: Prior Experience + every
// sortie's Day Pilot + Night Pilot. Used for milestone detection on save.
function _totalCaptainMins(){
  let mins = 0;
  getAC().forEach(a=>{ const d=a.data||{}; mins += (d.day_pilot||0)+(d.night_pilot||0); });
  getEntries().forEach(e=>{ mins += (e.day_pilot||0)+(e.night_pilot||0); });
  return mins;
}

// Given a before/after captain-minute total, return the highest 50-hour line
// (in WHOLE HOURS) crossed by going from before→after, or 0 if none. A line
// at H hours is "crossed" when before < H*60 <= after.
function _milestoneCrossed(beforeMins, afterMins){
  const STEP_H = 50;
  const beforeLines = Math.floor(beforeMins / (STEP_H*60));
  const afterLines  = Math.floor(afterMins  / (STEP_H*60));
  if(afterLines > beforeLines){
    return afterLines * STEP_H;   // highest line crossed, in whole hours
  }
  return 0;
}

// Milestone celebration — the gold burst + ring + tick + "N HOURS" caption.
// Reuses the save-celebrate overlay machinery but with extra flare.
function _celebrateMilestone(hours, onDone){
  try {
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      if(typeof onDone === 'function') onDone();
      return;
    }
    const old = document.getElementById('saveCelebrate'); if(old) old.remove();
    const d = document.createElement('div');
    d.id = 'saveCelebrate';
    d.className = 'save-celebrate milestone';
    d.innerHTML =
      '<div class="ms-wrap">' +
      '<svg class="ms-burst" viewBox="0 0 300 300" aria-hidden="true">' +
        '<g class="ms-rays">' +
          '<line x1="150" y1="150" x2="150" y2="30"  stroke="#e8c96d" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>' +
          '<line x1="150" y1="150" x2="150" y2="270" stroke="#e8c96d" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>' +
          '<line x1="150" y1="150" x2="30"  y2="150" stroke="#e8c96d" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>' +
          '<line x1="150" y1="150" x2="270" y2="150" stroke="#e8c96d" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>' +
          '<line x1="150" y1="150" x2="65"  y2="65"  stroke="#c9a84c" stroke-width="2"   stroke-linecap="round" opacity=".65"/>' +
          '<line x1="150" y1="150" x2="235" y2="65"  stroke="#c9a84c" stroke-width="2"   stroke-linecap="round" opacity=".65"/>' +
          '<line x1="150" y1="150" x2="65"  y2="235" stroke="#c9a84c" stroke-width="2"   stroke-linecap="round" opacity=".65"/>' +
          '<line x1="150" y1="150" x2="235" y2="235" stroke="#c9a84c" stroke-width="2"   stroke-linecap="round" opacity=".65"/>' +
          '<line x1="150" y1="150" x2="105" y2="38"  stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          '<line x1="150" y1="150" x2="195" y2="38"  stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          '<line x1="150" y1="150" x2="262" y2="105" stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          '<line x1="150" y1="150" x2="262" y2="195" stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          '<line x1="150" y1="150" x2="195" y2="262" stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          '<line x1="150" y1="150" x2="105" y2="262" stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          '<line x1="150" y1="150" x2="38"  y2="195" stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
          '<line x1="150" y1="150" x2="38"  y2="105" stroke="#c9a84c" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>' +
        '</g>' +
        '<path class="ms-spark ms-s1" fill="#f3dd95" d="M 150 12 l 3 9 l 9 3 l -9 3 l -3 9 l -3 -9 l -9 -3 l 9 -3 z"/>' +
        '<path class="ms-spark ms-s2" fill="#f3dd95" d="M 274 150 l 3 9 l 9 3 l -9 3 l -3 9 l -3 -9 l -9 -3 l 9 -3 z"/>' +
        '<path class="ms-spark ms-s3" fill="#f3dd95" d="M 44 60 l 2.4 7 l 7 2.4 l -7 2.4 l -2.4 7 l -2.4 -7 l -7 -2.4 l 7 -2.4 z"/>' +
        '<path class="ms-spark ms-s4" fill="#f3dd95" d="M 250 232 l 2.4 7 l 7 2.4 l -7 2.4 l -2.4 7 l -2.4 -7 l -7 -2.4 l 7 -2.4 z"/>' +
        '<circle class="ms-dot ms-d1" cx="90"  cy="40"  r="2.4" fill="#e8c96d"/>' +
        '<circle class="ms-dot ms-d2" cx="225" cy="48"  r="2"   fill="#e8c96d"/>' +
        '<circle class="ms-dot ms-d3" cx="262" cy="118" r="2.4" fill="#e8c96d"/>' +
        '<circle class="ms-dot ms-d4" cx="40"  cy="135" r="2"   fill="#e8c96d"/>' +
        '<circle class="ms-dot ms-d5" cx="78"  cy="250" r="2.4" fill="#e8c96d"/>' +
        '<circle class="ms-dot ms-d6" cx="232" cy="262" r="2"   fill="#e8c96d"/>' +
        '<circle cx="150" cy="150" r="66" fill="#0b1120"/>' +
        '<circle class="ms-halo" cx="150" cy="150" r="74" fill="none" stroke="#c9a84c" stroke-width="1.4" opacity=".55"/>' +
        '<circle class="ms-ring" cx="150" cy="150" r="66" fill="none" stroke="#e8c96d" stroke-width="3.6"/>' +
        '<path class="ms-check" d="M 120 152 L 142 174 L 182 124" fill="none" stroke="#e8c96d" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
      '<div class="ms-cap">' +
        '<div class="ms-cap-top">\u2605 Milestone Reached \u2605</div>' +
        '<div class="ms-cap-num">' + hours + ' HOURS</div>' +
        '<div class="ms-cap-sub">CAPTAIN FLYING \u00b7 BZ!</div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(d);
    try{ haptic && haptic('success'); }catch(e){}
    // Sequence ends ~1.5s (caption rises at 1.0s, settles ~1.5s). Hold then fade.
    setTimeout(()=>{ if(typeof onDone === 'function') onDone(); }, 1600);
    setTimeout(()=>{ d.classList.add('fade-out'); }, 2100);
    setTimeout(()=>{ if(d && d.parentNode) d.remove(); }, 2600);
  } catch(e){
    if(typeof onDone === 'function') onDone();
  }
}

function _celebrateSave(onDone){
  try {
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      if(typeof onDone === 'function') onDone();
      return;
    }
    const old = document.getElementById('saveCelebrate'); if(old) old.remove();
    const d = document.createElement('div');
    d.id = 'saveCelebrate';
    d.className = 'save-celebrate';
    d.innerHTML =
      '<svg viewBox="0 0 100 100" aria-hidden="true">' +
        '<circle class="sc-ring" cx="50" cy="50" r="45"/>' +
        '<path class="sc-check" d="M 28 52 L 44 67 L 73 35"/>' +
      '</svg>';
    document.body.appendChild(d);
    try{ haptic && haptic('success'); }catch(e){}
    // Ring (.5s) + check (.35s delay + .4s) ≈ 0.95s draw; close the popup then.
    setTimeout(()=>{ if(typeof onDone === 'function') onDone(); }, 1000);
    setTimeout(()=>{ d.classList.add('fade-out'); }, 1050);
    setTimeout(()=>{ if(d && d.parentNode) d.remove(); }, 1500);
  } catch(e){
    if(typeof onDone === 'function') onDone();
  }
}

function confirmSaveEntry(){
  if(!_pendingEntry){ return; }
  haptic('confirm');
  // Capture captain total BEFORE the new sortie is persisted, so we can detect
  // a 50-hour milestone crossing afterwards (new sorties only).
  const _capBefore = _totalCaptainMins();
  const entries = getEntries();
  var isNewSortie = false;
  if(_editingEntryId !== null){
    // Update existing
    const idx = entries.findIndex(x=>x.id===_editingEntryId);
    if(idx > -1){
      // Preserve original id
      _pendingEntry.id = _editingEntryId;
      entries[idx] = _pendingEntry;
      setEntries(entries);
      showToast('Entry updated ✓');
    } else {
      entries.push(_pendingEntry);
      setEntries(entries);
      showToast('Sortie saved ✓');
      isNewSortie = true;
    }
    _editingEntryId = null;
  } else {
    entries.push(_pendingEntry);
    setEntries(entries);
    showToast('Sortie saved ✓');
    isNewSortie = true;
  }
  // Capture pilot/copilot names into the suggestions list. addNameSuggestion
  // is a no-op if the name is empty, equals "SELF", or already exists, so
  // duplicates can't slip in here.
  addNameSuggestion(_pendingEntry.pilot);
  addNameSuggestion(_pendingEntry.copilot);
  // Capture the aircraft number into its own suggestions list (no-op if
  // empty or already present, case-insensitive).
  addAcnoSuggestion(_pendingEntry.acno);
  _pendingEntry = null;

  // Closes the confirm popup, clears the form, and refreshes home. For a NEW
  // sortie we run the celebration tick OVER the still-open popup and defer
  // this teardown until the tick finishes, so the popup only disappears once
  // the checkmark animation has completed.
  const finish = function(){
    document.getElementById('entryConfirmPopup').classList.remove('active');
    ['f_date','f_acno','f_pilot','f_copilot','f_route'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    document.querySelectorAll('.hrs-hm input, .spl-hm input').forEach(el=>el.value='');
    const saveBtn = document.querySelector('.entry-action-bar .confirm-btn');
    if(saveBtn) saveBtn.textContent = '⊕ SAVE SORTIE ENTRY';
    renderHome();
  };

  if(isNewSortie){
    // Did this sortie push total captain hours across a 50-hour line?
    const capAfter = _totalCaptainMins();
    const milestoneH = _milestoneCrossed(_capBefore, capAfter);
    if(milestoneH > 0){
      _celebrateMilestone(milestoneH, finish);   // gold burst + "N HOURS"
    } else {
      _celebrateSave(finish);   // standard tick over the popup
    }
  } else {
    finish();
  }
}

function cancelSaveEntry(){
  _pendingEntry = null;
  document.getElementById('entryConfirmPopup').classList.remove('active');
}

// ─── Reset Fields (used by the swipe-to-reset control) ──────────────────
// Clears every editable field of the new-entry form. Mirrors exactly the
// field-clearing that runs after a successful save, so the form returns to
// the same pristine state. Does NOT touch the Aircraft Type (locked to the
// active aircraft from Prior Experience — not a per-entry field), nor the
// Month/Year selects (these default to the current period and are a sensible
// starting point rather than stale data). No confirmation — the swipe
// gesture is itself the deliberate action.
function _resetEntryFields(){
  ['f_date','f_acno','f_pilot','f_copilot','f_route'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value = '';
  });
  // All hour inputs (flying hours + special hours)
  document.querySelectorAll('.hrs-hm input, .spl-hm input').forEach(el => el.value = '');
  // Entry type / ink colour back to its first option (default Black)
  const et = document.getElementById('f_entrytype');
  if(et) et.selectedIndex = 0;
  // Close any open suggestion dropdown
  if(typeof _closeNameSuggest === 'function') _closeNameSuggest();
  // Reset the save button label in case a prior edit changed it
  const saveBtn = document.querySelector('.entry-action-bar .confirm-btn');
  if(saveBtn) saveBtn.textContent = '⊕ SAVE SORTIE ENTRY';
  showToast('Fields reset');
}

// ─── Swipe-to-reset gesture ─────────────────────────────────────────────
// The user drags the red knob from the left edge to the right edge of the
// track. Reaching ~85% of the travel fires the reset; the knob then springs
// back to the start. A short tap or partial drag does nothing.
function _initSwipeReset(){
  const root = document.getElementById('swipeReset');
  const knob = document.getElementById('swipeResetKnob');
  const fill = document.getElementById('swipeResetFill');
  if(!root || !knob) return;

  let dragging = false;
  let startX = 0;
  let maxTravel = 0;       // px the knob can move (track width − knob − margins)
  let curX = 0;
  let atEnd = false;       // currently within the firing zone
  let dwellTimer = null;   // 120ms dwell-at-end timer
  let tickFired = false;   // threshold haptic fires once per drag

  const knobMargin = 3;    // matches CSS top/left:3px
  const FIRE_FRACTION = 0.85;
  const DWELL_MS = 120;    // must hold at far-right this long before firing

  function travelMax(){
    return root.clientWidth - knob.offsetWidth - (knobMargin * 2);
  }
  function setFill(px){
    if(fill) fill.style.width = (knobMargin + knob.offsetWidth + px) + 'px';
  }
  function clearDwell(){
    if(dwellTimer){ clearTimeout(dwellTimer); dwellTimer = null; }
  }
  function fire(){
    root.classList.add('done');
    knob.style.left = (knobMargin + maxTravel) + 'px';
    setFill(maxTravel);
    haptic('destructive');
    setTimeout(() => {
      _resetEntryFields();
      knob.style.left = knobMargin + 'px';
      if(fill) fill.style.width = '0px';
      setTimeout(() => root.classList.remove('done'), 200);
    }, 180);
  }

  function onDown(e){
    dragging = true;
    atEnd = false;
    tickFired = false;
    clearDwell();
    knob.classList.add('dragging');
    if(fill) fill.classList.add('dragging');
    const pt = (e.touches && e.touches[0]) || e;
    startX = pt.clientX;
    maxTravel = travelMax();
    curX = 0;
  }
  function onMove(e){
    if(!dragging) return;
    const pt = (e.touches && e.touches[0]) || e;
    let dx = pt.clientX - startX;
    if(dx < 0) dx = 0;
    if(dx > maxTravel) dx = maxTravel;
    curX = dx;
    knob.style.left = (knobMargin + dx) + 'px';
    setFill(dx);
    if(e.cancelable) e.preventDefault();

    const threshold = maxTravel * FIRE_FRACTION;
    if(curX >= threshold){
      // Entered the firing zone: tick once, then require a DWELL_MS hold so
      // a fast overshoot-and-retreat won't trigger an accidental reset.
      if(!tickFired){ haptic('tick'); tickFired = true; }
      if(!atEnd){
        atEnd = true;
        clearDwell();
        dwellTimer = setTimeout(() => {
          if(dragging && atEnd){
            dragging = false;
            knob.classList.remove('dragging');
            if(fill) fill.classList.remove('dragging');
            fire();
          }
        }, DWELL_MS);
      }
    } else {
      // Left the firing zone before the dwell elapsed — cancel it.
      if(atEnd){ atEnd = false; clearDwell(); tickFired = false; }
    }
  }
  function onUp(){
    if(!dragging) return;
    dragging = false;
    atEnd = false;
    clearDwell();
    knob.classList.remove('dragging');
    if(fill) fill.classList.remove('dragging');
    // Released before the dwell fired → spring back, no action.
    knob.style.left = knobMargin + 'px';
    if(fill) fill.style.width = '0px';
    curX = 0;
  }

  // Touch
  knob.addEventListener('touchstart', onDown, {passive:true});
  knob.addEventListener('touchmove', onMove, {passive:false});
  knob.addEventListener('touchend', onUp);
  knob.addEventListener('touchcancel', onUp);
  // Mouse (desktop testing / preview)
  knob.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
document.addEventListener('DOMContentLoaded', _initSwipeReset);

// ════════════════════════════════════════════════════
// LOGBOOK
// ════════════════════════════════════════════════════
function _populateYearDropdown(){
  const sel = document.getElementById('lb_year');
  if(!sel) return;
  const entries = getEntries();
  const years = new Set();
  entries.forEach(e=>{
    const y = parseInt(e.year);
    if(!isNaN(y)) years.add(y);
  });
  // If there are no entries at all, fall back to a single "current year" option so the
  // dropdown isn't empty. Per request: don't pad with years that have no flights.
  if(years.size === 0) years.add(new Date().getFullYear());

  const sorted = [...years].sort((a,b)=>b-a);
  const currentVal = sel.value;
  sel.innerHTML = sorted.map(y=>`<option value="${y}">${y}</option>`).join('');
  // Restore previous selection if still valid, else default to the most-recent year with entries.
  if(currentVal && sorted.includes(+currentVal)){
    sel.value = currentVal;
  } else {
    sel.value = sorted[0];
  }
}

// ─── LOGBOOK SEARCH ─────────────────────────────────────────────────────────
// State + helpers for the Logbook search bar. When the user types into the
// search input, the year/month filters are bypassed and the entire log is
// scanned across ALL years and months. Matches are case-insensitive and
// substring-based. Results group by year (newest first) then by month, with
// the matched substring highlighted inside each rendered row.
let _lbSearchQuery = '';
// Page-break feature: rows-per-page in single-month logbook view. When > 0,
// renderLogbook inserts a Page Total + Running Total sub-row ONCE after the
// Nth data row in the table (e.g. value 6 → break after row 6 only, not at
// rows 12/18/24/...). 0 disables the feature. Value is persisted to the app
// settings so it survives across sessions.
let _lbPageBreak = 0;
let _lbPbMenuOpen = false;
// Total rows in the currently rendered single-month view — used to populate
// the "of N" suffix next to the page-break input.
let _lbPbTotalRows = 0;
// One-shot: highlight freshly inserted break rows after the user changes
// the page-break value (set in onLogbookPageBreakInput, cleared after render).
let _lbPbFlash = false;
// Restore last-used value at boot. The settings call may return undefined
// the first time; fall back to 0 (off).
try {
  const s = getSettings();
  if(s && Number.isInteger(s.lbPageBreak)){ _lbPageBreak = s.lbPageBreak; }
} catch(_){}

// HTML-escape any user-entered text before injection. Prevents an entry
// containing "<" or ">" in (say) a pilot's name from breaking layout, and
// shields against accidental tag-like content. The logbook previously did
// direct interpolation since data is user-trusted, but with highlight
// markup injection we now need clean escaping.
function _escHtml(s){
  if(s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Escape regex special chars in the user's search query so a query like
// "C-130 (PVT)" doesn't blow up the regex parser.
function _escRegex(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Wrap occurrences of `query` (case-insensitive) inside `text` with a
// <mark class="lb-hl">…</mark> wrapper. The surrounding text is HTML-escaped
// so injected user data stays safe. Returns the original (escaped) text if
// the query is empty or has no match.
function _hlText(text, query){
  const esc = _escHtml(text);
  if(!query || !text) return esc;
  // Build the regex AFTER escaping the HTML — the escape only transforms
  // <, >, &, " and ', none of which conflict with regex special chars,
  // so the query still matches positions in the escaped text 1-to-1.
  const re = new RegExp(`(${_escRegex(query)})`, 'gi');
  return esc.replace(re, '<mark class="lb-hl">$1</mark>');
}

// Input handler (called from oninput on the search field). Updates the
// query state, toggles the clear button's visibility, and re-renders the
// logbook. We don't debounce — the scan is on entries already in memory and
// is fast even for thousands of rows.
function onLogbookSearchInput(val){
  _lbSearchQuery = (val || '').trim();
  const btn = document.getElementById('lb_search_clear');
  if(btn) btn.style.display = _lbSearchQuery ? 'flex' : 'none';
  renderLogbook();
}

// Clear-button handler. Resets the search field, clears the query, and
// re-renders so the year/month filters take effect again.
function clearLogbookSearch(){
  const inp = document.getElementById('lb_search');
  if(inp) inp.value = '';
  _lbSearchQuery = '';
  const btn = document.getElementById('lb_search_clear');
  if(btn) btn.style.display = 'none';
  renderLogbook();
}

// ─── Page-break feature handlers ────────────────────────────────────────
// User types any positive integer into the number input next to Search.
// After every N data rows, renderLogbook inserts a Page Total sub-row
// (sum of those N rows) and a Running Total sub-row (cumulative PE +
// all entries through that row). 0 or empty input = off.
function onLogbookPageBreakInput(val){
  // Empty string or 0 → disable. Any other non-negative integer → enable.
  const n = parseInt(val, 10);
  const clean = (Number.isFinite(n) && n > 0) ? n : 0;
  _lbPageBreak = clean;
  // One-shot flash flag: the next render highlights the inserted break
  // rows with a gold pulse so the eye jumps straight to where the break
  // landed in the table. Cleared at the end of renderLogbook.
  _lbPbFlash = clean > 0;
  // Persist to settings.
  try {
    const s = getSettings() || {};
    s.lbPageBreak = _lbPageBreak;
    setSettings(s);
  } catch(_){}
  // Reflect cleaned value back into the input (e.g. negatives → 0/empty).
  const inp = document.getElementById('lb_pb_input');
  if(inp){
    inp.value = _lbPageBreak > 0 ? String(_lbPageBreak) : '';
  }
  _updateLogbookPageBreakUi();
  renderLogbook();
}
function _updateLogbookPageBreakUi(){
  // Sync input value (so the input reflects state after navigation /
  // settings load / search clear), and toggle the active-styling class
  // on the wrap so engaged state has a gold tint.
  const inp = document.getElementById('lb_pb_input');
  if(inp){
    const cur = _lbPageBreak > 0 ? String(_lbPageBreak) : '';
    if(inp.value !== cur) inp.value = cur;
  }
  const wrap = document.getElementById('lb_pb_wrap');
  if(wrap) wrap.classList.toggle('lb-pb-active', _lbPageBreak > 0);
  // "of N" suffix — populated from _lbPbTotalRows after each render.
  // Shows "of 47 rows" so the user knows the valid range when picking.
  const of = document.getElementById('lb_pb_of');
  if(of){
    of.textContent = _lbPbTotalRows > 0 ? `of ${_lbPbTotalRows}` : '';
  }
}
// Show / hide the page-break picker based on whether a single month is
// selected.
function _updateLogbookPageBreakVisibility(){
  const month = document.getElementById('lb_month')?.value || '';
  const wrap = document.querySelector('.lb-search-wrap');
  if(!wrap) return;
  // .lb-no-month → CSS hides the picker.
  wrap.classList.toggle('lb-no-month', !month);
}

// Test whether a single entry matches the active search query. Searches the
// text fields a user would naturally search for: pilot/copilot, route,
// aircraft name and tail-number. Numeric hour fields aren't text-searched.
function _entryMatchesSearch(e, qLower){
  if(!qLower) return true;
  const haystack = [
    e.pilot, e.copilot, e.route,
    e.acName, e.acId, e.acno,
    e.remarks, e.entryType, e.entryTypeText,
    e.month, String(e.year), String(e.date)
  ].filter(Boolean).join('\u0001').toLowerCase();
  return haystack.indexOf(qLower) !== -1;
}

// SEARCH-MODE renderer. Builds the entire logbook scroll view as a flat list
// of year→month groups containing only the entries that match the query.
// Reuses the same row markup as renderLogbook's main loop so visual style is
// identical, but the text fields go through _hlText() to surface the matched
// substring in gold. Falls back to a no-results message when nothing matches.
function _renderLogbookSearch(){
  const q = _lbSearchQuery;
  const qLower = q.toLowerCase();
  const sc = document.getElementById('lbScroll');

  const all = getEntries().filter(e => _entryMatchesSearch(e, qLower));
  if(!all.length){
    sc.innerHTML = '<div class="lb-empty empty-state">' +
      '<div class="empty-glyph">' + icon('book') + '</div>' +
      `<div class="empty-msg">No entries match \u201C${_escHtml(q)}\u201D.</div>` +
      '</div>';
    return;
  }

  // Group by year (descending), then by month (canonical MONTHS order
  // within each year). This puts the user's most recent matching sorties
  // at the top — natural reading order for a logbook search.
  const byYear = {};
  all.forEach(e => {
    const y = String(e.year || '');
    const m = e.month || '';
    if(!byYear[y]) byYear[y] = {};
    if(!byYear[y][m]) byYear[y][m] = [];
    byYear[y][m].push(e);
  });
  const years = Object.keys(byYear).sort((a, b) => parseInt(b) - parseInt(a));

  let html = `<div class="lb-search-meta">Found <b>${all.length}</b> entr${all.length===1?'y':'ies'} matching \u201C<b>${_escHtml(q)}</b>\u201D across ${years.length} year${years.length===1?'':'s'}.</div>`;

  years.forEach(yr => {
    const months = MONTHS.filter(m => byYear[yr][m]);
    months.forEach(mon => {
      const rows = byYear[yr][mon];
      html += `<div class="lb-month-block">
        <div class="lb-month-summary">
          <div class="lb-ms-title">${mon} ${yr} \u2014 ${rows.length} match${rows.length===1?'':'es'}</div>
        </div>
        <div class="lb-table-wrap">
          <table class="lb-table lb-table-search">
            <thead><tr>
              <th>SR</th><th>Date</th><th>Aircraft</th><th>Pilot</th><th>Co-P</th>
              <th>Route</th>
              <th>Day<br>Dual</th><th>Day<br>Pilot</th><th>Day<br>C/P</th>
              <th>Ni<br>Dual</th><th>Ni<br>Pilot</th><th>Ni<br>C/P</th>
              <th>NVG</th>
              <th>IMC</th><th>SIF</th>
              <th>Instr<br>Day</th><th>Instr<br>Ni</th>
              <th>WSO</th>
            </tr></thead>
            <tbody>`;
      rows.forEach((e, idx) => {
        const inkClass = _entryInkClass(e);
        const col = _entryInkColor(e);
        const selfPilot = e.pilot && (e.pilot.toUpperCase().includes('SELF') || e.pilot.toLowerCase().includes('shubham') || e.pilot.toLowerCase().includes(((getSettings()||{}).name||'').toLowerCase()));
        const f = mins => mins ? hmHTML(mins) : '\u2014';
        // Read-only search-result row — no Strike/Edit/Del buttons. The user
        // can clear the search bar and navigate to the entry's month to edit
        // or delete normally. Keeping search clean = fewer accidental taps
        // on destructive controls while scanning results.
        html += `<tr class="lb-entry-row ${inkClass}" data-id="${e.id}">
          <td style="color:${col}">${idx + 1}</td>
          <td style="color:${col}">${_escHtml(e.date)}</td>
          <td style="color:${col}">${e.acno ? '<span style="font-size:calc(17px * var(--tbl-scale));font-weight:800">' + _hlText(e.acno, q) + '</span><br>' : ''}<span style="font-size:calc(9px * var(--tbl-scale));color:var(--txt2);font-weight:500;letter-spacing:.5px">${_hlText(e.acName || e.acId || '', q)}</span></td>
          <td style="color:${col};font-weight:${selfPilot?800:600};text-align:left">${_hlText(e.pilot, q)}</td>
          <td style="color:${col};font-weight:600;opacity:.9;text-align:left">${e.copilot ? _hlText(e.copilot, q) : '\u2014'}</td>
          <td style="color:${col};font-weight:600;max-width:160px;white-space:normal;text-align:left">${e.route ? _hlText(e.route, q) : '\u2014'}</td>
          <td style="color:${col}">${f(e.day_dual)}</td>
          <td style="color:${col};font-weight:700">${f(e.day_pilot)}</td>
          <td style="color:${col};opacity:.75">${f(e.day_copilot)}</td>
          <td style="color:${col}">${f(e.night_dual)}</td>
          <td style="color:${col};font-weight:700">${f(e.night_pilot)}</td>
          <td style="color:${col};opacity:.75">${f(e.night_copilot)}</td>
          <td style="color:${col}">${f(e.nvg)}</td>
          <td style="color:${col}">${f(e.imc)}</td>
          <td style="color:${col}">${f(e.sif)}</td>
          <td style="color:${col}">${f(e.instr_day)}</td>
          <td style="color:${col}">${f(e.instr_night)}</td>
          <td style="color:${col}">${f(e.wso)}</td>
        </tr>`;
      });
      html += `</tbody></table></div></div>`;
    });
  });

  sc.innerHTML = html;
}

// Helpers extracted so the search renderer matches the colour logic of the
// main renderLogbook. If these classes/functions diverge between the two
// paths the search results would visually mismatch the normal view.
function _entryInkClass(e){
  const t = (e.entryType || '').toLowerCase();
  if(t.includes('nvg')) return 'ink-nvg';
  if(t.includes('night') || t.includes('ni ') || t.includes('red')) return 'ink-red';
  if(t.includes('day') || t.includes('blue')) return 'ink-blue';
  return 'ink-black';
}
function _entryInkColor(e){
  const t = (e.entryType || '').toLowerCase();
  if(t.includes('nvg')) return '#2ecc71';
  if(t.includes('night') || t.includes('ni ') || t.includes('red')) return '#ff5b4d';
  if(t.includes('day') || t.includes('blue')) return '#4aa8e8';
  return _inkHex(t);
}

function renderLogbook(){
  // If the user has typed in the Logbook search bar, hand off to the dedicated
  // search renderer which scans ALL years/months and presents matches grouped
  // by year+month. The year/month dropdown filters are bypassed in that mode.
  if(_lbSearchQuery){
    _populateYearDropdown();   // keep the dropdowns populated for when user clears
    _renderLogbookSearch();
    return;
  }
  _populateYearDropdown();
  const year  = document.getElementById('lb_year').value;
  const month = document.getElementById('lb_month').value;
  const all = getEntries().filter(e=> e.year==year && (!month||e.month===month));
  const sc = document.getElementById('lbScroll');

  // Single-month vs all-months mode. In single-month mode the entire page
  // becomes one continuous scroll with the table header sticky at the top
  // and the page-total / running-total rows sticky at the bottom (the
  // "frozen panes" Excel-style layout). The scrollbar is moved to the LEFT
  // edge via the direction:rtl trick on the scroll container so it's
  // permanently visible without competing with the table's right edge.
  if(sc) sc.classList.toggle('lb-single-month', !!month);

  if(!all.length){
    // If a specific month is selected → say so explicitly. Otherwise, generic.
    const msg = month
      ? `You have not flown in ${month} ${year}.`
      : `No entries for ${year}.`;
    sc.innerHTML='<div class="lb-empty empty-state"><div class="empty-glyph">'+icon('book')+'</div><div class="empty-msg">'+msg+'</div></div>';
    return;
  }

  // Group by month if "All"
  const groups = {};
  if(!month){
    all.forEach(e=>{ if(!groups[e.month])groups[e.month]=[]; groups[e.month].push(e); });
  } else {
    groups[month] = all;
  }

  let html='';
  const orderedMonths = MONTHS.filter(m=>groups[m]);

  // ─── Running totals helper ─────────────────────────────────────────
  // For each month displayed, we need a "RUNNING TOTAL" row that shows
  // the cumulative hours for every column from the beginning of records
  // up to and including that month. This sums:
  //   • Prior Experience for every aircraft that ever appears in the data
  //   • All log entries dated on or before the (year, month) being shown
  // NVG follows the existing rule: counted in its own column, NOT added
  // separately to the Total (since NVG hours are already part of Night).
  const allEntries = getEntries();
  const allAcs = getAC();
  // PE roll-up across all aircraft (one-shot — same for every month row)
  const peSum = {
    day_dual:0, day_pilot:0, day_copilot:0,
    night_dual:0, night_pilot:0, night_copilot:0,
    nvg:0, imc:0, sif:0, instr_day:0, instr_night:0, wso:0,
  };
  allAcs.forEach(ac=>{
    const d = ac.data || {};
    peSum.day_dual    += (d.day_dual    || 0);
    peSum.day_pilot   += (d.day_pilot   || 0);
    peSum.day_copilot += (d.day_copilot || 0);
    peSum.night_dual  += (d.night_dual  || 0);
    peSum.night_pilot += (d.night_pilot || 0);
    peSum.night_copilot += (d.night_copilot || 0);
    // PE NVG: new schema is a single 'nvg' field. Legacy schema (pre-unify)
    // stored nvg_dual / nvg_pilot / nvg_copilot — sum those for any saved
    // data from old versions. The || on || 0 short-circuits cleanly so we
    // don't double-count: if d.nvg is truthy, the legacy sum is skipped.
    peSum.nvg += (d.nvg || ((d.nvg_dual||0) + (d.nvg_pilot||0) + (d.nvg_copilot||0)));
    // Legacy split fields for IMC/SIF supported (older imports may have them)
    peSum.imc += (d.imc || 0) + (d.imc_day || 0) + (d.imc_night || 0);
    peSum.sif += (d.sif || 0) + (d.sif_day || 0) + (d.sif_night || 0);
    peSum.instr_day   += (d.instr_day   || 0);
    peSum.instr_night += (d.instr_night || 0);
    peSum.wso += (d.wso || 0);
  });

  // Comparator: entry e is dated on/before (yr, monIdx)?
  // We compare by (year, month-index). Day-of-month not needed for
  // monthly granularity.
  const ymIndex = (yr, mIdx) => parseInt(yr,10)*12 + mIdx;

  // Track row counts so the page-break picker can display "of N" — this
  // only makes sense in single-month mode where there's exactly one
  // month-block. Reset before the loop; if a single month is selected
  // it will get overwritten with rows.length for that month.
  _lbPbTotalRows = 0;

  orderedMonths.forEach(mon=>{
    const rows = groups[mon].sort((a,b)=>parseInt(a.date)-parseInt(b.date));
    // If we're in single-month mode (only one month iteration), record
    // the row count so the picker can show "of N rows".
    if(month){
      _lbPbTotalRows = rows.length;
    }
    // monthly totals
    let mtDay=0,mtNight=0,mtNVG=0,mtPilot=0,mtCopilot=0,mtWSO=0,mtIMC=0,mtSIF=0,mtDayPilot=0;
    rows.forEach(e=>{
      mtDay   +=(e.day_dual||0)+(e.day_pilot||0)+(e.day_copilot||0);
      mtNight +=(e.night_dual||0)+(e.night_pilot||0)+(e.night_copilot||0);
      mtNVG   +=(e.nvg||0);
      mtPilot +=(e.day_pilot||0)+(e.night_pilot||0);
      mtDayPilot += (e.day_pilot||0);   // Day-only Pilot-In-Command hours
      mtCopilot+=(e.day_copilot||0)+(e.night_copilot||0);
      mtWSO   +=(e.wso||0);
      mtIMC   +=(e.imc||0)+(e.imc_day||0)+(e.imc_night||0);
      mtSIF   +=(e.sif||0)+(e.sif_day||0)+(e.sif_night||0);
    });
    // NVG is a *descriptor* of Night sorties — its hours are already counted inside
    // night_dual/night_pilot/night_copilot (and therefore in mtNight). Adding mtNVG
    // here would double-count, so the month total is mtDay + mtNight only.
    const mtTotal = mtDay+mtNight;

    // ─── Running totals through the END of this month ──────────────
    // Walk every log entry and accumulate columns for those dated on or
    // before (year, mon). Start from a clone of peSum so PE is included.
    const curMonIdx = MONTHS.indexOf(mon);
    const cutoff = ymIndex(year, curMonIdx);
    const run = { ...peSum };
    allEntries.forEach(e=>{
      const eIdx = ymIndex(e.year, MONTHS.indexOf(e.month));
      if(eIdx < 0 || eIdx > cutoff) return;
      run.day_dual    += (e.day_dual    || 0);
      run.day_pilot   += (e.day_pilot   || 0);
      run.day_copilot += (e.day_copilot || 0);
      run.night_dual  += (e.night_dual  || 0);
      run.night_pilot += (e.night_pilot || 0);
      run.night_copilot += (e.night_copilot || 0);
      run.nvg += (e.nvg || 0);
      run.imc += (e.imc || 0) + (e.imc_day || 0) + (e.imc_night || 0);
      run.sif += (e.sif || 0) + (e.sif_day || 0) + (e.sif_night || 0);
      run.instr_day   += (e.instr_day   || 0);
      run.instr_night += (e.instr_night || 0);
      run.wso += (e.wso || 0);
    });

    // ─── Page-break logic ───────────────────────────────────────────
    // When _lbPageBreak > 0 AND a single month is selected, after every N
    // data rows we insert a Page Total (sum of last N rows) and a Running
    // Total (PE + every entry through the cutoff row). This mimics a paper
    // logbook with subtotals at every page break.
    const pbEnabled = _lbPageBreak > 0 && !!month;
    const pbStep = _lbPageBreak;
    // Pre-seed the cumulative-run accumulator with PE + every entry STRICTLY
    // BEFORE this month. Within the month, we add row-by-row as we render so
    // each break row shows the running total through THAT cutoff row.
    const runAccum = { ...peSum };
    allEntries.forEach(e => {
      const eIdx = ymIndex(e.year, MONTHS.indexOf(e.month));
      if(eIdx < 0 || eIdx >= cutoff) return;  // strictly before this month
      runAccum.day_dual    += (e.day_dual    || 0);
      runAccum.day_pilot   += (e.day_pilot   || 0);
      runAccum.day_copilot += (e.day_copilot || 0);
      runAccum.night_dual  += (e.night_dual  || 0);
      runAccum.night_pilot += (e.night_pilot || 0);
      runAccum.night_copilot += (e.night_copilot || 0);
      runAccum.nvg += (e.nvg || 0);
      runAccum.imc += (e.imc || 0) + (e.imc_day || 0) + (e.imc_night || 0);
      runAccum.sif += (e.sif || 0) + (e.sif_day || 0) + (e.sif_night || 0);
      runAccum.instr_day   += (e.instr_day   || 0);
      runAccum.instr_night += (e.instr_night || 0);
      runAccum.wso += (e.wso || 0);
    });
    // Page-bucket accumulator — resets at each break.
    const newBucket = () => ({
      day_dual:0, day_pilot:0, day_copilot:0,
      night_dual:0, night_pilot:0, night_copilot:0,
      nvg:0, imc:0, sif:0, instr_day:0, instr_night:0, wso:0,
    });
    let pgBucket = newBucket();

    // Helper: render a Page Total / Running Total sub-row at break point N.
    // Uses smaller styling (.lb-pb-page / .lb-pb-run) than the final totals
    // so the user can distinguish "intermediate break" from "end of month".
    const _renderBreakRows = (cutoffRowNum) => {
      const flashCls = _lbPbFlash ? ' lb-pb-flash' : '';
      const pg = `
        <tr class="lb-pb-row lb-pb-page${flashCls}">
          <td colspan="7">PAGE TOTAL — till Row ${cutoffRowNum}</td>
          <td>${hmHTML(pgBucket.day_dual)}</td>
          <td>${hmHTML(pgBucket.day_pilot)}</td>
          <td>${hmHTML(pgBucket.day_copilot)}</td>
          <td>${hmHTML(pgBucket.night_dual)}</td>
          <td>${hmHTML(pgBucket.night_pilot)}</td>
          <td>${hmHTML(pgBucket.night_copilot)}</td>
          <td>${hmHTML(pgBucket.nvg)}</td>
          <td>${hmHTML(pgBucket.imc)}</td>
          <td>${hmHTML(pgBucket.sif)}</td>
          <td>${hmHTML(pgBucket.instr_day)}</td>
          <td>${hmHTML(pgBucket.instr_night)}</td>
          <td>${hmHTML(pgBucket.wso)}</td>
          <td></td><td></td>
        </tr>`;
      const rn = `
        <tr class="lb-pb-row lb-pb-run${flashCls}">
          <td colspan="7">RUNNING TOTAL — till Row ${cutoffRowNum}</td>
          <td>${hmHTML(runAccum.day_dual)}</td>
          <td>${hmHTML(runAccum.day_pilot)}</td>
          <td>${hmHTML(runAccum.day_copilot)}</td>
          <td>${hmHTML(runAccum.night_dual)}</td>
          <td>${hmHTML(runAccum.night_pilot)}</td>
          <td>${hmHTML(runAccum.night_copilot)}</td>
          <td>${hmHTML(runAccum.nvg)}</td>
          <td>${hmHTML(runAccum.imc)}</td>
          <td>${hmHTML(runAccum.sif)}</td>
          <td>${hmHTML(runAccum.instr_day)}</td>
          <td>${hmHTML(runAccum.instr_night)}</td>
          <td>${hmHTML(runAccum.wso)}</td>
          <td></td><td></td>
        </tr>`;
      return pg + rn;
    };

    // Build the body row-by-row so we can inject break rows at the right
    // positions and update the accumulators in step.
    let bodyHtml = '';
    rows.forEach((e, i) => {
      const inkType = e.entryType||'black';
      const col = _inkHex(inkType) || '#aab4c0';
      const f = v=>v>0?hmFull(v):'—';
      const selfPilot = e.pilot && (e.pilot.toUpperCase().includes('SELF') || e.pilot.toLowerCase().includes('shubham') || e.pilot.toLowerCase().includes(((getSettings()||{}).name||'').toLowerCase()));
      const rowBg = col + '24';
      const imcTot = (e.imc||0)+(e.imc_day||0)+(e.imc_night||0);
      const sifTot = (e.sif||0)+(e.sif_day||0)+(e.sif_night||0);
      bodyHtml += `<tr class="lb-entry-row ink-${inkType}" style="background:${rowBg};box-shadow:inset 5px 0 0 ${col},inset -5px 0 0 ${col}">
        <td><button class="lb-strike-btn" onclick="toggleLogbookStrike(this)" title="Temporary strike off">−</button></td>
        <td style="color:${col};font-weight:700;text-align:center">${i+1}</td>
        <td style="color:${col};font-weight:700">${e.date} ${e.month}</td>
        <td style="color:${col}">${e.acno?'<span style="font-size:calc(17px * var(--tbl-scale));font-weight:800">'+e.acno+'</span><br>':''}<span style="font-size:calc(9px * var(--tbl-scale));color:var(--txt2);font-weight:500;letter-spacing:.5px">${e.acName||e.acId}</span></td>
        <td style="color:${col};font-weight:${selfPilot?800:600};text-align:left">${e.pilot}</td>
        <td style="color:${col};font-weight:600;opacity:.9;text-align:left">${e.copilot||'—'}</td>
        <td style="color:${col};font-weight:600;max-width:160px;white-space:normal;text-align:left">${e.route||'—'}</td>
        <td style="color:${col}">${f(e.day_dual)}</td>
        <td style="color:${col};font-weight:700">${f(e.day_pilot)}</td>
        <td style="color:${col};opacity:.75">${f(e.day_copilot)}</td>
        <td style="color:${col}">${f(e.night_dual)}</td>
        <td style="color:${col};font-weight:700">${f(e.night_pilot)}</td>
        <td style="color:${col};opacity:.75">${f(e.night_copilot)}</td>
        <td style="color:${col}">${f(e.nvg)}</td>
        <td style="color:${col}">${f(imcTot)}</td>
        <td style="color:${col}">${f(sifTot)}</td>
        <td style="color:${col}">${f(e.instr_day)}</td>
        <td style="color:${col}">${f(e.instr_night)}</td>
        <td style="color:${col}">${f(e.wso)}</td>
        <td><button class="lb-edit-btn" onclick="editLogEntry(${e.id})" title="Edit entry">${icon('pencil')}</button></td>
        <td><button class="lb-delete-btn" onclick="deleteLogEntry(${e.id})" title="Delete entry">${icon('trash')}</button></td>
      </tr>`;
      // Update both accumulators with this row's hours.
      pgBucket.day_dual    += (e.day_dual    || 0);
      pgBucket.day_pilot   += (e.day_pilot   || 0);
      pgBucket.day_copilot += (e.day_copilot || 0);
      pgBucket.night_dual  += (e.night_dual  || 0);
      pgBucket.night_pilot += (e.night_pilot || 0);
      pgBucket.night_copilot += (e.night_copilot || 0);
      pgBucket.nvg += (e.nvg || 0);
      pgBucket.imc += imcTot;
      pgBucket.sif += sifTot;
      pgBucket.instr_day   += (e.instr_day   || 0);
      pgBucket.instr_night += (e.instr_night || 0);
      pgBucket.wso += (e.wso || 0);
      runAccum.day_dual    += (e.day_dual    || 0);
      runAccum.day_pilot   += (e.day_pilot   || 0);
      runAccum.day_copilot += (e.day_copilot || 0);
      runAccum.night_dual  += (e.night_dual  || 0);
      runAccum.night_pilot += (e.night_pilot || 0);
      runAccum.night_copilot += (e.night_copilot || 0);
      runAccum.nvg += (e.nvg || 0);
      runAccum.imc += imcTot;
      runAccum.sif += sifTot;
      runAccum.instr_day   += (e.instr_day   || 0);
      runAccum.instr_night += (e.instr_night || 0);
      runAccum.wso += (e.wso || 0);
      // Inject break rows ONCE, when we just finished the cutoff row.
      // Previously this used (i+1) % pbStep === 0 which would inject a
      // break at every multiple of N (6, 12, 18 …) — per user feedback
      // that's wrong; the input is interpreted as "insert ONE break at
      // exactly THIS row." So we fire only when i+1 === pbStep, and
      // never again. Subsequent rows continue normally; the final
      // PAGE TOTAL / RUNNING TOTAL at the table's end still sums all
      // rows (not affected by the break).
      if(pbEnabled && ((i + 1) === pbStep)){
        bodyHtml += _renderBreakRows(i + 1);
      }
    });

    html+=`
    <div class="lb-month-block">
    <div class="lb-month-summary">
      <div class="lb-ms-title">${mon} ${year} — ${rows.length} Sorties</div>
      <div class="lb-ms-grid">
        <!-- Sequence: Total → Pilot → Day → Night → NVG (item 2 — was Total/Day/Pilot/Ni/NVG).
             Pilot recoloured from green #27ae60 to var(--gold) to match Total — visually
             grouping the two "headline" metrics together. Day/Night/NVG keep their
             traditional aviation-ink colours (blue / red / green) so the section
             reads as: headline gold pair, then the day/night/NVG breakdown. -->
        <div class="lb-ms-cell"><span class="lb-ms-val" style="color:var(--gold)">${hmHTML(mtTotal)}</span><span class="lb-ms-lbl">Total</span></div>
        <div class="lb-ms-cell"><span class="lb-ms-val" style="color:var(--gold)">${hmHTML(mtPilot)}</span><span class="lb-ms-lbl">Pilot</span></div>
        <div class="lb-ms-cell"><span class="lb-ms-val" style="color:#4aa8e8">${hmHTML(mtDayPilot)}</span><span class="lb-ms-lbl">Day</span></div>
        <div class="lb-ms-cell"><span class="lb-ms-val" style="color:#ff5b4d">${hmHTML(mtNight)}</span><span class="lb-ms-lbl">Ni</span></div>
        <div class="lb-ms-cell"><span class="lb-ms-val" style="color:#2ecc71">${hmHTML(mtNVG)}</span><span class="lb-ms-lbl">NVG</span></div>
      </div>
    </div>
    <div class="lb-table-wrap">
      <table class="lb-table">
        <thead><tr>
          <th></th><th>SR</th><th>Date</th><th>Aircraft</th><th>Pilot</th><th>Co-P</th>
          <th>Route</th>
          <th>Day<br>Dual</th><th>Day<br>Pilot</th><th>Day<br>C/P</th>
          <th>Ni<br>Dual</th><th>Ni<br>Pilot</th><th>Ni<br>C/P</th>
          <th>NVG</th>
          <th>IMC</th><th>SIF</th>
          <th>Instr<br>Day</th><th>Instr<br>Ni</th>
          <th>WSO</th>
          <th>Edit</th>
          <th>Del</th>
        </tr></thead>
        <tbody>
          ${bodyHtml}
          <tr class="lb-total-row">
            <td colspan="7">PAGE TOTAL — ${rows.length} sorties</td>
            <td class="lb-c-day">${hmHTML(rows.reduce((s,e)=>s+(e.day_dual||0),0))}</td>
            <td class="lb-c-day">${hmHTML(rows.reduce((s,e)=>s+(e.day_pilot||0),0))}</td>
            <td class="lb-c-day">${hmHTML(rows.reduce((s,e)=>s+(e.day_copilot||0),0))}</td>
            <td class="lb-c-night">${hmHTML(rows.reduce((s,e)=>s+(e.night_dual||0),0))}</td>
            <td class="lb-c-night">${hmHTML(rows.reduce((s,e)=>s+(e.night_pilot||0),0))}</td>
            <td class="lb-c-night">${hmHTML(rows.reduce((s,e)=>s+(e.night_copilot||0),0))}</td>
            <td class="lb-c-nvg">${hmHTML(rows.reduce((s,e)=>s+(e.nvg||0),0))}</td>
            <td class="lb-c-day">${hmHTML(rows.reduce((s,e)=>s+(e.imc||0)+(e.imc_day||0)+(e.imc_night||0),0))}</td>
            <td class="lb-c-day">${hmHTML(rows.reduce((s,e)=>s+(e.sif||0)+(e.sif_day||0)+(e.sif_night||0),0))}</td>
            <td class="lb-c-day">${hmHTML(rows.reduce((s,e)=>s+(e.instr_day||0),0))}</td>
            <td class="lb-c-night">${hmHTML(rows.reduce((s,e)=>s+(e.instr_night||0),0))}</td>
            <td class="lb-c-wso">${hmHTML(rows.reduce((s,e)=>s+(e.wso||0),0))}</td>
            <td></td>
            <td></td>
          </tr>
          <tr class="lb-running-row">
            <td colspan="7">RUNNING TOTAL — PE + all sorties through ${mon} ${year}</td>
            <td class="lb-c-day">${hmHTML(run.day_dual)}</td>
            <td class="lb-c-day">${hmHTML(run.day_pilot)}</td>
            <td class="lb-c-day">${hmHTML(run.day_copilot)}</td>
            <td class="lb-c-night">${hmHTML(run.night_dual)}</td>
            <td class="lb-c-night">${hmHTML(run.night_pilot)}</td>
            <td class="lb-c-night">${hmHTML(run.night_copilot)}</td>
            <td class="lb-c-nvg">${hmHTML(run.nvg)}</td>
            <td class="lb-c-day">${hmHTML(run.imc)}</td>
            <td class="lb-c-day">${hmHTML(run.sif)}</td>
            <td class="lb-c-day">${hmHTML(run.instr_day)}</td>
            <td class="lb-c-night">${hmHTML(run.instr_night)}</td>
            <td class="lb-c-wso">${hmHTML(run.wso)}</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    </div>`;
  });
  sc.innerHTML = html;

  // Page-break flash is one-shot: the flashing rows are now in the DOM
  // (the CSS animation plays automatically on insertion), so clear the
  // flag — subsequent re-renders (month switch, edits) must not re-flash.
  _lbPbFlash = false;

  // Refresh page-break picker UI and visibility (visibility depends on
  // whether single-month is currently selected).
  _updateLogbookPageBreakUi();
  _updateLogbookPageBreakVisibility();

  // Wire up the sticky-header transition animation. Has to run after the
  // DOM is laid out so the sentinel positions are accurate. (The previous
  // measurement of --lb-running-h is no longer needed — the page-total and
  // running-total rows are no longer position:sticky; they sit at the
  // natural end of the table.)
  requestAnimationFrame(()=>{
    _setupStickyHeaderTransitions(sc);
    _setupLbCollapse(sc);
  });
}

// ─── Collapse filter + search bars on scroll (single-month only) ─────────
// When the user scrolls DOWN past a small threshold in single-month view,
// collapse the YEAR/MONTH filter and the search/page-break bar so the table
// (with its sticky column header) gets maximum room. Scrolling back UP near
// the top reveals them again. Disabled in all-months view (nothing to gain —
// each month has its own header and the bars are useful while browsing).
let _lbCollapseHandler = null;
let _lbCollapseTarget = null;
function _setupLbCollapse(scrollContainer){
  // Bar-collapse on scroll was removed (it caused scroll-position jumps when
  // the surrounding layout resized mid-scroll). The sticky column header alone
  // provides the column orientation the user needs. Ensure no stale collapsed
  // state lingers and no scroll listener remains attached.
  const logbook = document.getElementById('logbook');
  if(logbook) logbook.classList.remove('lb-bars-collapsed');
  if(_lbCollapseHandler && _lbCollapseTarget){
    try { _lbCollapseTarget.removeEventListener('scroll', _lbCollapseHandler); } catch(_){}
  }
  _lbCollapseHandler = null; _lbCollapseTarget = null;
}

// ─── Sticky-header transition animation ─────────────────────────────────
// CSS position:sticky has no built-in "moment of becoming stuck" event, so
// we use the standard IntersectionObserver+sentinel pattern: insert a 1px
// sentinel element just above each table; when it scrolls off the top of
// the scroll container (no longer intersecting from below), the header is
// "stuck" and we add a .lb-thead-stuck class to the thead so CSS can
// transition shadow / accent line / background tint smoothly. When the
// sentinel comes back into view (user scrolls back up), the class is
// removed and the styling animates back out.
let _lbStickyObserver = null;
function _setupStickyHeaderTransitions(scrollContainer){
  if(!scrollContainer) return;
  // Tear down any previous observer — renderLogbook can run multiple times
  // (filter changes), and the old sentinels are replaced when the HTML is
  // rebuilt above.
  if(_lbStickyObserver){
    try { _lbStickyObserver.disconnect(); } catch(_){}
    _lbStickyObserver = null;
  }
  // For each table-wrap, insert a sentinel as its FIRST child. The sentinel
  // sits just above the thead in scroll terms (same Y as the thead at rest).
  // When this sentinel scrolls past the top of the scroll container, the
  // sticky thead is now stuck.
  const wraps = scrollContainer.querySelectorAll('.lb-table-wrap');
  if(!wraps.length) return;
  wraps.forEach(w => {
    if(w.querySelector(':scope > .lb-thead-sentinel')) return;
    const sent = document.createElement('div');
    sent.className = 'lb-thead-sentinel';
    w.insertBefore(sent, w.firstChild);
  });
  _lbStickyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const wrap = entry.target.closest('.lb-table-wrap');
      if(!wrap) return;
      const thead = wrap.querySelector('thead');
      if(!thead) return;
      // "Stuck" when the sentinel is OUT of view AND positioned above the
      // viewport (boundingClientRect.top < observer root top). This avoids
      // false-positives when the sentinel is below the viewport (scrolled
      // way past — bottom-out scenarios).
      const rootRect = entry.rootBounds || {top:0};
      const isStuck = !entry.isIntersecting && entry.boundingClientRect.top < rootRect.top;
      thead.classList.toggle('lb-thead-stuck', isStuck);
    });
  }, {
    root: scrollContainer,
    threshold: 0,
    // Small negative top margin so the stick triggers exactly as the
    // header's top edge meets the scroll-container's top edge.
    rootMargin: '0px 0px 0px 0px'
  });
  scrollContainer.querySelectorAll('.lb-thead-sentinel').forEach(s => {
    _lbStickyObserver.observe(s);
  });
}

function toggleLogbookStrike(btn){
  const row = btn?.closest('.lb-entry-row');
  if(!row) return;
  row.classList.toggle('struck');
}

// ════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════
function renderSummary(){
  const entries = getEntries();
  const acs = getAC();
  const activeId = getActiveAcId();
  const activeAc = acs.find(a=>a.id===activeId);

  // ─── Active aircraft × selected month — the central scope of this screen ───
  // _sumSelMonth = "MMM_YYYY" (e.g. "MAY_2026"). All month-scoped sections derive from this.
  const [selM, selY] = _sumSelMonth.split('_');
  const selMonIdx = MONTHS.indexOf(selM);
  const selYearInt = parseInt(selY, 10);

  // Entries for active aircraft × picked month
  const monthAcEntries = activeAc
    ? entries.filter(e=>e.acId===activeId && e.month===selM && String(e.year)===selY)
    : [];

  // Aggregate hours for the month, across all 12 columns. Used by hero, type-wise, monthly table.
  const monthAgg = {};
  _SUM_COLS.forEach(c=>monthAgg[c.key]=0);
  monthAcEntries.forEach(e=>{
    _SUM_COLS.forEach(c=>{ monthAgg[c.key] += _sumCol(e, c); });
  });
  const monthDay     = monthAgg.day_dual + monthAgg.day_pilot + monthAgg.day_copilot;
  const monthNight   = monthAgg.night_dual + monthAgg.night_pilot + monthAgg.night_copilot;
  const monthCaptain = monthAgg.day_pilot + monthAgg.night_pilot;
  const monthNVG     = monthAgg.nvg;
  const monthTotal   = monthDay + monthNight; // NVG is a Night descriptor — not added

  // ─── CON TRG — Continuation Training currency, scoped to the picked month ───
  // Reference end-date = last day of the picked month (capped to today if that's later
  // — never look into the future). For a current-month pick this matches "today − window".
  // Day:   pilot-time on the active aircraft in the last 3 CALENDAR MONTHS ending refEnd
  // Night: pilot-time on the active aircraft in the last 6 CALENDAR MONTHS ending refEnd
  // Captain breakdown (3-month window for both): used under the Day Pilot gauge
  //   to show the user a quick Day-pilot + Night-pilot = Total Captain summary
  //   for the same 3-month window — answers "what's my Captain time over the
  //   last quarter?" at a glance.
  //
  // We use CALENDAR-MONTH arithmetic (Date object month subtraction), not
  // fixed 90/180-day windows — those can differ by up to ~4 days from true
  // months because months have variable lengths. Example: if refEnd is Jun 20,
  // Day window starts Mar 20 (3 calendar months back), not Mar 22 (90 days back).
  let conDayPlt = 0, conNightPlt = 0, conNightPlt3mo = 0;
  if(activeAc){
    const lastDayOfMonth = new Date(selYearInt, selMonIdx + 1, 0).getDate();
    const refEnd = new Date(selYearInt, selMonIdx, lastDayOfMonth, 23, 59, 59);
    const capDate = refEnd.getTime() > Date.now() ? new Date() : refEnd;
    const cap = capDate.getTime();
    // Calendar-month subtraction: build new Dates 3 and 6 months before capDate,
    // preserving the day-of-month. JavaScript's Date constructor handles month
    // overflow naturally (e.g. May 31 − 3 months → Mar 3).
    const cutoffDay   = new Date(capDate.getFullYear(), capDate.getMonth() - 3, capDate.getDate(), 0, 0, 0).getTime();
    const cutoffNight = new Date(capDate.getFullYear(), capDate.getMonth() - 6, capDate.getDate(), 0, 0, 0).getTime();
    entries.forEach(e=>{
      if(e.acId !== activeId) return;
      const mi = MONTHS.indexOf(e.month);
      const d = parseInt(e.date, 10), y = parseInt(e.year, 10);
      if(mi < 0 || !d || !y) return;
      const ts = new Date(y, mi, d, 12, 0, 0).getTime();
      if(ts > cap) return;
      if(ts >= cutoffDay)  { conDayPlt        += (e.day_pilot||0);
                             conNightPlt3mo   += (e.night_pilot||0); }
      if(ts >= cutoffNight) conNightPlt       += (e.night_pilot||0);
    });
  }
  // Captain total for the 3-month window — Day pilot + Night pilot.
  const conCaptain3mo = conDayPlt + conNightPlt3mo;

  // Build a single semi-circular gauge — binary CURRENT/LAPSED based on a hard threshold.
  // CURRENT when actual hours ≥ threshold; LAPSED otherwise. The arc fills proportionally
  // to the threshold (capped at 100%) so the user can visually gauge how far above/below.
  // gauge with threshold-driven colour. opts: {onclick, colorClass, nvgMins}
  // If nvgMins is provided, a green NVG arc is drawn CONCENTRICALLY INSIDE the
  // main arc (smaller radius, small gap) so the two hug as one paired gauge,
  // and the NVG total is shown in small green above the title.
  function buildGauge(title, valueMins, thresholdMins, subText, opts){
    opts = opts || {};
    const pct = Math.min(1, valueMins/Math.max(1,thresholdMins));
    const cls    = opts.colorClass || (valueMins >= thresholdMins ? 'ok' : 'crit');
    const status = (cls === 'ok') ? 'CURRENT' : (cls === 'warn' ? 'MARGINAL' : 'LAPSED');
    const R = 40, CX = 50, CY = 55;
    const arcLen = Math.PI * R;
    const dashOffset = arcLen * (1 - pct);
    const clickAttr = opts.onclick ? ` onclick="${opts.onclick}" style="cursor:pointer"` : '';
    const editHint = opts.onclick ? '<div class="gauge-edit-hint">\u270e tap to edit</div>' : '';
    const hasNvg = (opts.nvgMins != null);
    // Inner NVG arc geometry (concentric, smaller radius with a gap below the
    // main 8px stroke). Always green; visual scale vs a 6h reference.
    let nvgArc = '';
    if(hasNvg){
      const NR = R - 11;                 // smaller radius → sits inside, with gap
      const nArcLen = Math.PI * NR;
      const nPct = Math.min(1, opts.nvgMins/Math.max(1, 6*60));
      const nOff = nArcLen * (1 - nPct);
      nvgArc = `
        <path class="gauge-track gauge-track-nvg" d="M ${CX-NR} ${CY} A ${NR} ${NR} 0 0 1 ${CX+NR} ${CY}"/>
        <path class="gauge-fill gauge-fill-nvg"
              d="M ${CX-NR} ${CY} A ${NR} ${NR} 0 0 1 ${CX+NR} ${CY}"
              stroke-dasharray="${nArcLen}"
              stroke-dashoffset="${nArcLen}"
              data-target="${nOff}"/>`;
    }
    return `<div class="gauge-card"${clickAttr}>

      <div class="gauge-card-title">${title}</div>
      <svg class="gauge-svg" viewBox="0 0 100 70" aria-hidden="true">
        <path class="gauge-track" d="M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}"/>
        <path class="gauge-fill ${cls}"
              d="M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}"
              stroke-dasharray="${arcLen}"
              stroke-dashoffset="${arcLen}"
              data-target="${dashOffset}"/>
        ${nvgArc}
        ${[0,0.25,0.5,0.75,1].map(t=>{
          const ang = Math.PI - Math.PI*t;
          const r1 = R-7, r2 = R+1;
          const x1 = CX + r1*Math.cos(ang), y1 = CY - r1*Math.sin(ang);
          const x2 = CX + r2*Math.cos(ang), y2 = CY - r2*Math.sin(ang);
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--gold)" stroke-width=".8" opacity=".5"/>`;
        }).join('')}
        ${(function(){
          // Instrument needle — points from the centre to the gauge value
          // along the 180° arc. Starts at the left (empty) and animates to the
          // target angle via CSS rotate transition with a gentle overshoot.
          const ang = 180 * pct;  // 0 at left, 180 at right
          return `<g class="gauge-needle" data-target-angle="${ang.toFixed(1)}" style="transform-origin:${CX}px ${CY}px; transform:rotate(0deg);">
            <line x1="${CX}" y1="${CY}" x2="${CX-R+6}" y2="${CY}" class="gauge-needle-line"/>
            <circle cx="${CX}" cy="${CY}" r="3.2" class="gauge-needle-hub"/>
          </g>`;
        })()}
      </svg>
      <div class="gauge-val" data-count="${valueMins}">${hmHTML(0)}</div>
      ${hasNvg ? `<div class="gauge-nvg-inline" data-count="${opts.nvgMins}">NVG ${hmHTML(opts.nvgMins)}</div>` : ''}
      <div class="gauge-sub">${subText}</div>
      <div class="gauge-status ${cls}${cls==='crit'?' gauge-status-pulse':''}">${status}</div>
      ${editHint}
    </div>`;
  }
  // Captain Con-Trg breakdown — Day and Night sides are each independently
  // configurable (Pilot/Co-Pilot toggles + 1–12 month window) via a popup
  // opened by tapping that side's hours figure. Totals reflect each side's
  // own selection. Defaults (Pilot, 3 months) match the original behaviour.
  const ccDayHours   = _ccSideHours('day',   _ccDaySel,   entries, activeId, selMonIdx, selYearInt);
  const ccNightHours = _ccSideHours('night', _ccNightSel, entries, activeId, selMonIdx, selYearInt);
  const ccTotal      = ccDayHours + ccNightHours;
  const ccSifImc     = _ccSifImcHours(_ccSifImcSel, entries, activeId, selMonIdx, selYearInt);
  // Gauge values driven by their own Pilot/Co-Pilot + months selection;
  // colours by the user's red/yellow threshold marks.
  const dayGVal   = _gaugeHours('day',   _dayGauge,   entries, activeId, selMonIdx, selYearInt);
  const nightGVal = _gaugeHours('night', _nightGauge, entries, activeId, selMonIdx, selYearInt);
  const dayGCls   = _gaugeColorClass(dayGVal/60,   _dayGauge.red);
  const nightGCls = _gaugeColorClass(nightGVal/60, _nightGauge.red);
  const nightNvgVal = _nightGauge.nvg ? _gaugeNvgHours(_nightGauge, entries, activeId, selMonIdx, selYearInt) : null;
  const gaugesHTML = `
    <div class="gauge-row two-col">
      ${buildGauge('Day Pilot', dayGVal, Math.max(1,_dayGauge.red*60), 'Min ' + _dayGauge.red + 'h · ' + _gaugeSelLabel(_dayGauge), { onclick:"openGaugePicker('day')", colorClass:dayGCls })}
      ${buildGauge('Night Pilot', nightGVal, Math.max(1,_nightGauge.red*60), 'Min ' + _nightGauge.red + 'h · ' + _gaugeSelLabel(_nightGauge), { onclick:"openGaugePicker('night')", colorClass:nightGCls, nvgMins: nightNvgVal })}
    </div>
    <div class="captain-contrg ${_captainContrgOpen ? 'open' : ''}" id="captainContrgWrap">
      <button class="captain-contrg-toggle" onclick="toggleCaptainContrg()" aria-expanded="${_captainContrgOpen ? 'true' : 'false'}">
        <span class="captain-contrg-title">Captain Con-Trg <span class="cc-edit-hint">· tap hours to edit</span></span>
        <span class="captain-contrg-headline cc-count" data-count="${ccTotal}">${hmHTML(ccTotal)}</span>
        <span class="captain-contrg-chev">\u25BE</span>
      </button>
      <div class="captain-contrg-body">
        <div class="captain-contrg-body-inner">
          <div class="captain-contrg-row">
            <div class="cc-cell cc-tappable" onclick="openCcPicker('day')" title="Tap to choose Pilot / Co-Pilot and months">
              <div class="cc-val cc-count" style="color:#4aa8e8" data-count="${ccDayHours}">${hmHTML(ccDayHours)}</div>
              <div class="cc-lbl">Day</div>
              <div class="cc-sel-note">${_ccSelLabel(_ccDaySel)} \u270e</div>
            </div>
            <div class="cc-sep">+</div>
            <div class="cc-cell cc-tappable" onclick="openCcPicker('night')" title="Tap to choose Pilot / Co-Pilot and months">
              <div class="cc-val cc-count" style="color:#ff5b4d" data-count="${ccNightHours}">${hmHTML(ccNightHours)}</div>
              <div class="cc-lbl">Night</div>
              <div class="cc-sel-note">${_ccSelLabel(_ccNightSel)} \u270e</div>
            </div>
            <div class="cc-sep">=</div>
            <div class="cc-cell cc-total">
              <div class="cc-val cc-count" data-count="${ccTotal}">${hmHTML(ccTotal)}</div>
              <div class="cc-lbl">Total Captain</div>
            </div>
          </div>
          <div class="cc-sifimc-bar" onclick="openSifImcPicker()" title="Tap to choose SIF / IMC, months and threshold">
            <div class="cc-sifimc-track">
              <div class="cc-sifimc-fill" style="width:${(function(){ const thr=Math.max(1,(_ccSifImcSel.threshold|0)||3)*60; return Math.max(0,Math.min(100, Math.round((ccSifImc/thr)*100))); })()}%"></div>
            </div>
            <div class="cc-sifimc-caption">
              <span class="cc-sifimc-hrs cc-count" data-count="${ccSifImc}">${hmHTML(ccSifImc)}</span>
              <span class="cc-sifimc-lbl">SIF + IMC · ${Math.max(1,(_ccSifImcSel.months|0)||3)} mo \u270e</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // ─── 12-month rolling chart — anchored to the SELECTED month ───
  // The chart shows the trailing 12 months ending at the month picked in the
  // selector above (selMonIdx / selYearInt), so the "Viewing: MMM YYYY" caption
  // genuinely matches the bars. Picking an earlier month slides the whole
  // window back. (Previously the window was hard-anchored to today, which made
  // the caption disagree with the graph.)
  const anchorYear = selYearInt;
  const anchorMonthIdx = selMonIdx;
  const months12 = [];
  for(let i=11;i>=0;i--){
    const d = new Date(anchorYear, anchorMonthIdx-i, 1);
    months12.push({
      key: MONTHS[d.getMonth()]+'_'+d.getFullYear(),
      monthName: MONTHS[d.getMonth()],
      year: d.getFullYear(),
      day:0, night:0, nvg:0, total:0,
      dayPilot:0, nightPilot:0   // tracked separately for the per-month coloured captions
    });
  }
  entries.forEach(e=>{
    const slot = months12.find(s=>s.monthName===e.month && String(s.year)===String(e.year));
    if(!slot) return;
    const d = (e.day_dual||0)+(e.day_pilot||0)+(e.day_copilot||0);
    const n = (e.night_dual||0)+(e.night_pilot||0)+(e.night_copilot||0);
    // BUGFIX: previously had `slot.day += d` written twice in a row, which
    // doubled the Day bar height. With Day doubled but the total line still
    // computed correctly as d+n, any month where Day was the dominant series
    // ended up with the total line drawn *below* the (over-tall) Day bar.
    slot.day   += d;
    slot.night += n;
    slot.nvg   += (e.nvg||0);
    slot.total += d + n;
    slot.dayPilot   += (e.day_pilot||0);
    slot.nightPilot += (e.night_pilot||0);
  });

    const hasAnyData = months12.some(m=>m.total>0);
    let chartHTML = '';
    if(!hasAnyData){
      chartHTML = `<div class="chart-card"><div class="chart-empty empty-state">`+
        `<div class="empty-glyph">`+icon('gauge')+`</div>`+
        `<div class="empty-msg">No log entries yet.<br>Hours added in the Log Entry tab will appear here.</div>`+
        `</div></div>`;
    } else {
      // Chart dimensions reduced — H 180→150 so the box height shrinks ~17%
      // overall, AND padB 110→60 (was 78 in a prior pass) so the actual bar
      // area takes up much more of the box. Before: 60px bars in a 180px box
      // (33%). Now: 80px bars in a 150px box (53%). The caption rows below
      // the bars still fit because their font dropped to 7.5px and the row
      // spacing was tightened from 11px → 9px in the same pass.
      // Chart widened 340 → 420 (item 5) so each month slot is wider, giving
      // the per-month caption text more horizontal room and eliminating the
      // slight label overlap. The viewBox scales to fit the card, so a wider
      // internal coordinate space just means more breathing room per slot.
      const W=420, H=150, padL=24, padR=8, padT=10, padB=60;
      const innerW = W-padL-padR;
      const innerH = H-padT-padB;
      const barW = innerW / months12.length;
      // Each month has 3 bars + 2 thin internal gaps. We allocate 48% of the
      // month-slot width to bars (down from 55%), leaving 52% as inter-month
      // breathing room so the captions under each group don't touch.
      const groupW = barW * 0.48;
      const innerGap = 0.6;  // pixel gap between Day/Night and Night/NVG bars
      const singleBarW = (groupW - 2*innerGap) / 3;
      // Use the largest of the three series to drive the y-axis scale.
      const maxVal = Math.max(...months12.map(m=>Math.max(m.day,m.night,m.nvg,m.total)),60);
      const niceMax = Math.ceil(maxVal/60)*60;
      const tickCount = 4;
      const tickStep = niceMax/tickCount;

      let gridSVG = '';
      for(let i=0;i<=tickCount;i++){
        const v = tickStep*i;
        const y = padT + innerH - (v/niceMax)*innerH;
        gridSVG += `<line class="bar-grid" x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}"/>`;
        gridSVG += `<text class="bar-axis-lbl" x="${padL-4}" y="${y+3}" text-anchor="end">${Math.round(v/60)}h</text>`;
      }

      // Compact H:M label for per-bar captions. "1h30", "45m", "0h"
      const abbrevHM = mins => {
        if(mins<=0) return '0';
        const h = Math.floor(mins/60), m = mins%60;
        if(h===0) return m+'m';
        return h+'h'+(m>0?String(m).padStart(2,'0'):'');
      };

      let barsSVG = '';
      let linePts = [];
      months12.forEach((m,i)=>{
        const x0 = padL + i*barW;
        const cx = x0 + barW/2;
        const groupStart = cx - groupW/2;
        // Bar 1: Day (blue)
        const dayH = (m.day/niceMax)*innerH;
        const dayY = padT + innerH - dayH;
        barsSVG += `<rect class="bar-day bar-grow" style="animation-delay:${(i*0.05).toFixed(2)}s" x="${groupStart}" y="${dayY}" width="${singleBarW}" height="${dayH}" rx="1"/>`;
        // Bar 2: Night (red)
        const nightX = groupStart + singleBarW + innerGap;
        const ngtH = (m.night/niceMax)*innerH;
        const ngtY = padT + innerH - ngtH;
        barsSVG += `<rect class="bar-night bar-grow" style="animation-delay:${(i*0.05+0.02).toFixed(2)}s" x="${nightX}" y="${ngtY}" width="${singleBarW}" height="${ngtH}" rx="1"/>`;
        // Bar 3: NVG (green) — NEW
        const nvgX = nightX + singleBarW + innerGap;
        const nvgH = (m.nvg/niceMax)*innerH;
        const nvgY = padT + innerH - nvgH;
        barsSVG += `<rect class="bar-nvg bar-grow" style="animation-delay:${(i*0.05+0.04).toFixed(2)}s" x="${nvgX}" y="${nvgY}" width="${singleBarW}" height="${nvgH}" rx="1"/>`;
        // Smooth-curve total still tracks the (Day+Night) trend line at the centre
        const totalY = padT + innerH - (m.total/niceMax)*innerH;
        linePts.push([cx, totalY, m]);

        const showYear = (i===0) || (m.monthName==='JAN');
        // Month name (row 1) — dy 12 → 10 to sit closer to bar baseline
        barsSVG += `<text class="bar-axis-lbl" x="${cx}" y="${H-padB+10}" text-anchor="middle">${m.monthName}${showYear?' '+String(m.year).slice(-2):''}</text>`;

        // 4-row coloured caption: Day Pilot (blue), Night Pilot (red), NVG (green), Total (gold).
        // dys tightened from 24/35/46/57 (11px steps at 9.5px font) to
        // 19/28/37/46 (9px steps at 7.5px font) — captions no longer overlap.
        const dayPilot   = (m.dayPilot||0);
        const nightPilot = (m.nightPilot||0);
        const cap = (txt, fill, dy) => `<text class="bar-cap" x="${cx}" y="${H-padB+dy}" text-anchor="middle" style="fill:${fill}">${txt}</text>`;
        // Only render rows with values to keep it visually clean
        if(dayPilot>0)   barsSVG += cap(abbrevHM(dayPilot),   '#4aa8e8', 19);
        if(nightPilot>0) barsSVG += cap(abbrevHM(nightPilot), '#ff5b4d', 28);
        if(m.nvg>0)      barsSVG += cap(abbrevHM(m.nvg),      '#2ecc71', 37);
        if(m.total>0)    barsSVG += cap(abbrevHM(m.total),    'var(--gold2)', 46);
      });

    // Smooth Catmull-Rom curve through the line points (using a Bezier approximation).
    // alpha=0.5 (centripetal) gives a more natural curve that doesn't overshoot on spikes.
    function smoothPath(pts){
      if(pts.length < 2) return '';
      // Pad with virtual endpoints so the curve has tangents at the ends
      const p = [[pts[0][0]*2-pts[1][0], pts[0][1]*2-pts[1][1]], ...pts.map(q=>[q[0],q[1]]), [pts[pts.length-1][0]*2-pts[pts.length-2][0], pts[pts.length-1][1]*2-pts[pts.length-2][1]]];
      let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      const tension = 0.18; // 0.16-0.22 = pleasant gentle curve, no overshoot
      for(let i=1; i<p.length-2; i++){
        const c1x = p[i  ][0] + (p[i+1][0]-p[i-1][0]) * tension;
        const c1y = p[i  ][1] + (p[i+1][1]-p[i-1][1]) * tension;
        const c2x = p[i+1][0] - (p[i+2][0]-p[i  ][0]) * tension;
        const c2y = p[i+1][1] - (p[i+2][1]-p[i  ][1]) * tension;
        d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p[i+1][0].toFixed(1)} ${p[i+1][1].toFixed(1)}`;
      }
      return d;
    }
    let lineSVG = `<path class="bar-total bar-total-draw" d="${smoothPath(linePts)}"/>`;
    linePts.forEach((p,i)=>{ lineSVG += `<circle class="bar-dot bar-dot-anim" style="animation-delay:${(0.5 + i*0.04).toFixed(2)}s" cx="${p[0]}" cy="${p[1]}" r="2.4"/>`; });

    chartHTML = `
    <div class="chart-card">
      <div class="chart-head">
        <div class="chart-title">Rolling 12-Month View</div>
        <div class="chart-month-tag">12 mo ending ${selM} ${selY}</div>
      </div>
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${gridSVG}
        ${barsSVG}
        ${lineSVG}
      </svg>
      <div class="chart-legend">
        <div class="legend-item"><div class="legend-dot" style="background:#3498db"></div>Day Pilot</div>
        <div class="legend-item"><div class="legend-dot" style="background:#e74c3c"></div>Ni Pilot</div>
        <div class="legend-item"><div class="legend-dot" style="background:#2ecc71"></div>NVG</div>
        <div class="legend-item"><div class="legend-dot" style="background:#e8c96d;border-radius:50%"></div>Total</div>
      </div>
    </div>`;
  }

  // ─── Render ───
  const sc = document.getElementById('sumScroll');
  const activeAcName = activeAc ? activeAc.name : '— none —';

  sc.innerHTML = `
  <!-- ════════ Month picker bar at the top ════════ -->
  <div class="sum-picker-bar">
    <div class="sum-picker-info">
      <div class="sum-picker-lbl">Active Aircraft</div>
      <div class="sum-picker-selects">
        <select class="sum-picker-select" id="sumAcSel" onchange="setActiveAcId(this.value); renderSummary();" aria-label="Active Aircraft" style="font-weight:700;color:var(--gold);max-width:140px">
          ${acs.map(a => `<option value="${a.id}" ${a.id===activeId?'selected':''}>${a.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="sum-picker-info" style="text-align:right">
      <div class="sum-picker-lbl">Period</div>
      <div class="sum-picker-selects">
        <select class="sum-picker-select" id="sumMonthSel" onchange="_onSumMonthYearChange()" aria-label="Month">
          ${_sumMonthOnlyOptions()}
        </select>
        <select class="sum-picker-select" id="sumYearSel" onchange="_onSumMonthYearChange()" aria-label="Year">
          ${_sumYearOnlyOptions()}
        </select>
      </div>
    </div>
  </div>

  <!-- ════════ Hero — Total Flying for the picked month ════════ -->
  <div class="sum-hero">
    <!-- 60/40 split: LEFT = total flying for the picked month (big hero number
         + label), RIGHT = "fatigue flying" rolling-days chip. The two halves
         use explicit basis flexes so the right side stops getting pushed all
         the way to the edge — they now sit balanced as 60% / 40% of the row. -->
    <div class="hero-top">
      <div class="hero-top-left">
        <div class="hero-lbl">TOTAL FLYING<br>${selM} ${selY}</div>
        <div class="hero-num" id="sumHeroNum">0<span class="u">h</span></div>
      </div>
      <!-- Fatigue Flying — rolling-window total. Shows total flying hours over
           the last N days (1-366, default 30). User types into the input to
           change N — value clamps on change. Renamed from "last N days" so it
           reflects what aircrew actually use this metric for: tracking fatigue
           exposure across a rolling window. -->
      <div class="hero-rolling">
        <div class="hero-rolling-lbl hero-rolling-lbl-top">
          <span class="fatigue-emph">Fatigue Flying</span> in
          <input type="number"
                 id="heroRollingDays"
                 class="hero-rolling-input"
                 min="1" max="366" inputmode="numeric"
                 value="${_heroRollingDays}"
                 onchange="_onHeroRollingChange()"
                 aria-label="Number of days (1-366)">
          days
        </div>
        <div class="hero-rolling-val" id="heroRollingVal">${(()=>{const f=_heroRollingTotalMins(_heroRollingDays); return hmHTML(f.total);})()}</div>
        <div class="hero-rolling-breakdown" id="heroRollingBreakdown">${(()=>{
          const f = _heroRollingTotalMins(_heroRollingDays);
          return `<span style="color:#4aa8e8">${hmHTML(f.day)}</span>`
               + `<span class="rb-plus">+</span>`
               + `<span style="color:#ff5b4d">${hmHTML(f.ni)}</span>`
               + `<span class="rb-plus">+</span>`
               + `<span style="color:#2ecc71">${hmHTML(f.nvg)}</span>`;
        })()}</div>
      </div>
    </div>
    <div class="hero-row">
      <div class="hero-cell cap-cell"><div class="v">${hmHTML(monthCaptain)}</div><div class="l">Captain</div></div>
      <div class="hero-cell"><div class="v" style="color:#4aa8e8">${hmHTML(monthDay)}</div><div class="l">Day</div></div>
      <div class="hero-cell"><div class="v" style="color:#ff5b4d">${hmHTML(monthNight)}</div><div class="l">Ni</div></div>
      <div class="hero-cell"><div class="v" style="color:#2ecc71">${hmHTML(monthNVG)}</div><div class="l">NVG</div></div>
    </div>
  </div>

  <div class="sec">Con Trg</div>
  ${gaugesHTML}

  <div class="sec">Flying Hours Trend — Last 12 Months</div>
  ${chartHTML}

  <!-- ════════ Monthly Summary — single totals row for active aircraft × month ════════ -->
  <div class="sec">Monthly Summary — ${selM} ${selY}</div>
  <div class="sum-table-wrap" style="margin-bottom:14px">
    ${_renderMonthlySummaryRow(activeAc, monthAgg, monthTotal, monthAcEntries.length)}
  </div>

  <!-- ════════ Cumulative — All Aircraft (as of the picked month) ════════ -->
  <div class="sec">Cumulative — All Aircraft <span class="sec-note">till ${selM} ${selY}</span></div>
  <div class="sum-table-wrap" style="margin-bottom:14px">
    ${_renderAllAcCumulativeTable(selMonIdx, selYearInt)}
  </div>

  <!-- ════════ Periodic Summary — collapsible dropdown ════════ -->
  <!-- Wrapped in a toggleable container so users who don't need it can keep the
       Summary tab clean. Opens with a smooth height + chevron-rotation animation. -->
  <div class="periodic-wrap ${_periodicOpen?'open':''}" id="periodicWrap">
    <button class="periodic-toggle" onclick="togglePeriodicSummary()" aria-expanded="${_periodicOpen?'true':'false'}">
      <span class="periodic-toggle-lbl">Periodic Summary</span>
      <span class="periodic-toggle-sub">${_periodicShown ? 'Tap to expand' : 'Tap to set From / To dates'}</span>
      <span class="periodic-toggle-chev" aria-hidden="true">▾</span>
    </button>
    <div class="periodic-body">
      <div class="periodic-picker">
        <div class="periodic-row">
          <div class="periodic-field">
            <label class="periodic-field-lbl" for="periodicFrom">From</label>
            <input type="date" class="periodic-date" id="periodicFrom" value="${_periodicFrom}" max="${new Date().toISOString().slice(0,10)}" onchange="_onPeriodicChange()">
          </div>
          <div class="periodic-field">
            <label class="periodic-field-lbl" for="periodicTo">To</label>
            <input type="date" class="periodic-date" id="periodicTo" value="${_periodicTo}" max="${new Date().toISOString().slice(0,10)}" onchange="_onPeriodicChange()">
          </div>
        </div>
        <button class="periodic-go" id="periodicGo" onclick="applyPeriodicSummary()">APPLY</button>
      </div>
      ${_periodicShown ? _renderPeriodicSection() : ''}
    </div>
  </div>
  `;

  // Count-up animation on the big hero number — animates to the picked-month total.
  animateMins(document.getElementById('sumHeroNum'), monthTotal, hmHTML, 800);

  // Count-up every value tagged with data-count (gauges, captain panel, SIF/IMC).
  sc.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10) || 0;
    const isNvg = el.classList.contains('gauge-nvg-inline');
    animateMins(el, target, isNvg ? (m=>'NVG '+hmHTML(m)) : hmHTML, 850);
  });

  // Sweep the recency gauge arcs from empty to value, and swing the needles
  // from the left (empty) to their target angle. Both use CSS transitions
  // defined on .gauge-fill / .gauge-needle (the needle has a gentle overshoot
  // cubic-bezier so it settles like a real instrument). Double-rAF guarantees
  // a painted empty frame first on Android WebView.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sc.querySelectorAll('.gauge-fill[data-target]').forEach(p => {
      p.style.strokeDashoffset = p.dataset.target;
    });
    sc.querySelectorAll('.gauge-needle[data-target-angle]').forEach(g => {
      g.style.transform = 'rotate(' + g.dataset.targetAngle + 'deg)';
    });
  }));
}

// ─── Summary support: month-picker state + table renderers ───
// Selected month for the Summary screen. Defaults to current calendar month.
// ─── Rolling-window state for the Total Flying hero card (item 6) ───────────
// The hero card's right side ("Fatigue Flying") shows total flying hours in
// the last N days, where the user can choose N (1-366, default 30). 366 = a
// leap year. Stored at module scope so the value persists across re-renders
// when the user changes the picker.
let _heroRollingDays = 30;
// ─── NAME SUGGESTIONS UI (Pilot / Co-Pilot autocomplete) ────────────────────
// Module-level state for the dropdown attached to each name input. Each input
// has its own dropdown div (`ns_dropdown_pilot` / `ns_dropdown_copilot`); the
// helpers below render, filter, and react to taps. State:
//   _nsActive  — which field's dropdown is currently shown ('pilot'|'copilot'|null)
//   _nsEditing — index within suggestions array of the row in inline-edit mode
let _nsActive = null;
let _nsEditing = -1;

// Show the suggestion dropdown for the given input ('pilot' or 'copilot').
// Called on focus. Filters by whatever the user has typed so far.
function showNameSuggest(which){
  _nsActive = which;
  _nsEditing = -1;
  const input = document.getElementById('f_' + which);
  if(!input) return;
  _renderNameSuggest(which, input.value);
}

// ─── Dismissal: outside-tap only ─────────────────────────────────────────
// The dropdown CLOSES ONLY when the user taps somewhere outside the
// name-suggest area (input + dropdown) and outside the long-press popout
// overlay. It no longer closes on input blur — that behavior killed the
// dropdown whenever the popout editor took focus, so after editing a name
// the list was gone. Now the popout can open, edit, save, close … and the
// dropdown is still there underneath, refreshed.
function _closeNameSuggest(){
  // Close ALL three suggestion dropdowns (pilot, copilot, acno). Closing
  // them all unconditionally is correct because there's only ever one
  // active at a time, and a stray-open dropdown on an inactive field would
  // be a bug.
  ['pilot','copilot','acno'].forEach(w => {
    const dd = document.getElementById('ns_dropdown_' + w);
    if(dd) dd.classList.remove('open');
  });
  _nsActive = null;
  _nsEditing = -1;
}
// Legacy shim — old markup/state paths may still call hideNameSuggest.
// Routes to the same close logic, immediately (no blur-delay needed since
// this is no longer wired to blur events).
function hideNameSuggest(){ _closeNameSuggest(); }

// Document-level capture listener: dismiss on any press outside the
// CURRENTLY-ACTIVE field's suggestion area and outside the popout overlay.
// pointerdown (with touchstart fallback) fires before click, so the
// dropdown is gone before any underlying control processes the tap — but
// the tap itself still reaches its target (we don't preventDefault).
function _nsOutsideTapHandler(e){
  if(!_nsActive) return;
  const t = e.target;
  // BUGFIX: the old check was `t.closest('.name-suggest-wrap')` — but ALL
  // three fields (pilot, copilot, acno) live inside their own
  // .name-suggest-wrap. So tapping the co-pilot field while the pilot
  // dropdown was open landed "inside a wrap" and wrongly kept pilot open.
  // The correct test is whether the tap landed inside the wrap belonging
  // to the ACTIVE field specifically. We identify wraps by a data-ns
  // attribute matching the field key. Tapping a DIFFERENT field's wrap
  // closes the current dropdown; that field's own focus handler then opens
  // its dropdown — exactly the expected behavior.
  const activeWrap = t.closest && t.closest('.name-suggest-wrap[data-ns="' + _nsActive + '"]');
  if(activeWrap) return;
  // Inside the long-press popout (edit card / overlay)? Keep open — the
  // popout interaction must not nuke the dropdown beneath it.
  if(t.closest && t.closest('.ns-popout-overlay')) return;
  _closeNameSuggest();
}
if(window.PointerEvent){
  document.addEventListener('pointerdown', _nsOutsideTapHandler, true);
} else {
  document.addEventListener('touchstart', _nsOutsideTapHandler, true);
  document.addEventListener('mousedown', _nsOutsideTapHandler, true);
}

// Live filter as the user types in the input. Re-renders with the matching
// subset of suggestions.
function onNameInputType(which, val){
  if(_nsActive !== which) _nsActive = which;
  _renderNameSuggest(which, val);
}

// Build the dropdown HTML. Filters suggestions by case-insensitive substring
// match on the current input value. Each row shows the name (matched portion
// highlighted) plus an edit and a delete button. The dropdown shows nothing
// — and is hidden — if there are no matches and the user has typed something
// (so the typed text doesn't get covered up). If the input is EMPTY, all
// suggestions are shown.
function _renderNameSuggest(which, filterVal){
  const dd = document.getElementById('ns_dropdown_' + which);
  if(!dd) return;
  const all = _nsListFor(which).get();
  const q = (filterVal || '').trim().toLowerCase();
  // Filter: empty query → show all; non-empty → substring match
  const matches = q ? all.filter(n => n.toLowerCase().indexOf(q) !== -1) : all;

  // ── Pinned self row (pilot/copilot ONLY) ─────────────────────────────
  // The user's own name (from Settings) is pinned at the TOP of the list,
  // above all saved suggestions, marked with a YOU badge. Shown when the
  // query is empty or matches the name. Tapping fills the field just like
  // any suggestion. It is NOT part of the editable suggestions list —
  // its source of truth is Settings, so no long-press editor on it.
  // The aircraft-number field ('acno') has no equivalent personal value,
  // so it gets no pinned row.
  const isAcno = (which === 'acno');
  const selfName = isAcno ? '' : ((getSettings() || {}).name || '').trim();
  const showSelf = !!selfName &&
    (!q || selfName.toLowerCase().indexOf(q) !== -1) &&
    // If the self name is ALSO in the saved list, don't duplicate it —
    // pin the saved copy's text via the self row and filter it from below.
    true;
  const matchesSansSelf = showSelf
    ? matches.filter(n => n.toLowerCase() !== selfName.toLowerCase())
    : matches;

  if(!matchesSansSelf.length && !showSelf){
    // Nothing to show — keep dropdown closed
    dd.classList.remove('open');
    dd.innerHTML = '';
    return;
  }
  // Header strip: shows total count and the filter context if any.
  // Sits sticky at the top of the scrollable dropdown so the user knows
  // how many suggestions exist even after scrolling.
  const totalCount = all.length;
  const showingCount = matchesSansSelf.length;
  const headerLabel = q
    ? `Matches <span class="ns-count">${showingCount}/${totalCount}</span>`
    : `${isAcno ? 'Saved Numbers' : 'Saved Names'} <span class="ns-count">${totalCount}</span>`;
  const hintLabel = `<span class="ns-hint">Hold to edit</span>`;
  let html = `<div class="ns-header">
    <span class="ns-header-label">${headerLabel}</span>
    ${hintLabel}
  </div>`;
  if(showSelf){
    const selfHl = q ? _hlNameMatch(selfName, q) : _escHtml(selfName);
    html += `<div class="ns-row ns-row-self">
      <button class="ns-name" onclick="pickSelfName('${which}')">
        <span class="ns-name-ico">${icon('user')}</span>
        <span class="ns-name-text">${selfHl}</span>
        <span class="ns-self-badge">You</span>
      </button>
    </div>`;
  }
  matchesSansSelf.forEach((name) => {
    // Real index in the full suggestions array (needed for edit/delete which
    // operate on the canonical list, not the filtered view).
    const realIdx = all.indexOf(name);
    const hl = q ? _hlNameMatch(name, q) : _escHtml(name);
    // Each row carries long-press handlers on its container; a short tap
    // fires onclick on the inner button → pickNameSuggest (fills the
    // input). A long press (>=480ms with no movement) fires showNamePopout
    // (magnified popout with edit/delete actions). The flag set by the
    // long-press handler suppresses the upcoming click so the field doesn't
    // also get filled.
    html += `<div class="ns-row"
              ontouchstart="nsPressStart(${realIdx}, event)"
              ontouchmove="nsPressMove(event)"
              ontouchend="nsPressEnd(event)"
              ontouchcancel="nsPressCancel()"
              onmousedown="nsPressStart(${realIdx}, event)"
              onmouseup="nsPressEnd(event)"
              onmouseleave="nsPressCancel()">
      <button class="ns-name" onclick="pickNameSuggest('${which}', ${realIdx})">
        <span class="ns-name-ico">${icon('user')}</span>
        <span class="ns-name-text">${hl}</span>
      </button>
    </div>`;
  });
  dd.innerHTML = html;
  dd.classList.add('open');
}

// Helper: highlight the matched substring (case-insensitive) inside a name.
// Wraps the match in <mark class="ns-hl">. Avoids the regex special-char
// gotcha by escaping the query characters.
function _hlNameMatch(name, qLower){
  const esc = _escHtml(name);
  if(!qLower) return esc;
  const re = new RegExp('(' + _escRegex(qLower) + ')', 'gi');
  return esc.replace(re, '<mark class="ns-hl">$1</mark>');
}

// Tap the pinned self row → fill the field with the Settings name and
// close the dropdown (same flow as picking any suggestion).
function pickSelfName(which){
  if(_nsSuppressClick){ _nsSuppressClick = false; return; }
  const selfName = ((getSettings() || {}).name || '').trim();
  if(!selfName) return;
  const input = document.getElementById('f_' + which);
  if(input){
    input.value = selfName;
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }
  _closeNameSuggest();
}

// Tap a suggestion → fill the input, close the dropdown. Uses onclick
// (NOT touchstart) so press-and-hold or touch-and-drag scroll gestures
// don't accidentally select. The 280ms blur delay in hideNameSuggest
// gives the click time to fire before the dropdown closes.
//
// If a long-press just fired (showing the popout), _nsSuppressClick is
// set true — skip the pick. The flag resets on next press start.
function pickNameSuggest(which, idx){
  if(_nsSuppressClick){
    _nsSuppressClick = false;
    return;
  }
  const all = _nsListFor(which).get();
  const name = all[idx];
  if(!name) return;
  const input = document.getElementById('f_' + which);
  if(input){
    input.value = name;
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }
  haptic('light');
  const dd = document.getElementById('ns_dropdown_' + which);
  if(dd) dd.classList.remove('open');
  _nsActive = null;
}

// ─── LONG-PRESS DETECTION ───────────────────────────────────────────────
// Press and hold on a name (~480ms with no finger movement) shows a
// magnified popout with edit / delete actions. A short tap (under 480ms,
// or interrupted by movement) falls through to the button's onclick
// → pickNameSuggest fires normally.
const NS_LONG_PRESS_MS = 480;
const NS_PRESS_MOVE_TOL = 10;  // px tolerance — any move beyond this cancels
let _nsPressTimer = null;
let _nsPressStartX = 0;
let _nsPressStartY = 0;
let _nsSuppressClick = false;

function nsPressStart(idx, evt){
  // Reset any prior suppression flag — a new press starts fresh.
  _nsSuppressClick = false;
  const pt = (evt.touches && evt.touches[0]) || evt;
  _nsPressStartX = pt.clientX || 0;
  _nsPressStartY = pt.clientY || 0;
  if(_nsPressTimer) clearTimeout(_nsPressTimer);
  _nsPressTimer = setTimeout(() => {
    _nsPressTimer = null;
    _nsSuppressClick = true;   // prevent the upcoming click from firing pick
    // Subtle haptic if the WebView supports vibrate (most Android does)
    haptic('longpress');
    showNamePopout(idx);
  }, NS_LONG_PRESS_MS);
}

function nsPressMove(evt){
  if(!_nsPressTimer) return;
  const pt = (evt.touches && evt.touches[0]) || evt;
  const dx = Math.abs((pt.clientX||0) - _nsPressStartX);
  const dy = Math.abs((pt.clientY||0) - _nsPressStartY);
  if(dx > NS_PRESS_MOVE_TOL || dy > NS_PRESS_MOVE_TOL){
    clearTimeout(_nsPressTimer);
    _nsPressTimer = null;
  }
}

function nsPressEnd(evt){
  // Release before timer fired — just cancel the long-press; the click
  // will fire normally and pickNameSuggest runs.
  if(_nsPressTimer){
    clearTimeout(_nsPressTimer);
    _nsPressTimer = null;
  }
}

function nsPressCancel(){
  if(_nsPressTimer){
    clearTimeout(_nsPressTimer);
    _nsPressTimer = null;
  }
}

// ─── MAGNIFIED POPOUT (long-press menu) ─────────────────────────────────
// A centred glass-panel overlay shown when the user long-presses a name in
// the suggestions dropdown. Displays the name in a large gold typographic
// treatment, with Edit and Delete pill buttons below. Tapping the backdrop
// or pressing Cancel closes it. Edit mode swaps the name display for an
// inline input with Save / Cancel controls.
let _nsPopoutIdx = -1;
let _nsPopoutEditing = false;

function showNamePopout(idx){
  const all = _nsListFor(_nsActive).get();
  if(idx < 0 || idx >= all.length) return;
  _nsPopoutIdx = idx;
  _nsPopoutEditing = false;
  _renderPopout();
}

function closeNamePopout(){
  const ov = document.getElementById('ns_popout_overlay');
  if(ov){
    ov.classList.remove('open');
    // Wait for the exit animation to complete before removing from DOM.
    setTimeout(() => { if(ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
  }
  _nsPopoutIdx = -1;
  _nsPopoutEditing = false;
}

function _renderPopout(){
  const all = _nsListFor(_nsActive).get();
  const name = all[_nsPopoutIdx];
  if(!name) return;
  // Build / reuse the overlay element. Created on demand so it doesn't
  // sit in the DOM consuming layout when not needed.
  let ov = document.getElementById('ns_popout_overlay');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'ns_popout_overlay';
    ov.className = 'ns-popout-overlay';
    ov.onclick = function(e){ if(e.target === ov) closeNamePopout(); };
    document.body.appendChild(ov);
  }
  let cardInner;
  if(_nsPopoutEditing){
    cardInner = `
      <div class="ns-popout-handle"></div>
      <div class="ns-popout-label">${_nsActive==='acno' ? 'Edit number' : 'Edit name'}</div>
      <input type="text" class="ns-popout-input" id="ns_popout_input" value="${_escHtml(name)}" autocomplete="off">
      <div class="ns-popout-actions">
        <button class="ns-popout-btn ns-popout-save" onclick="savePopoutEdit()">
          ${icon('check')}<span>Save</span>
        </button>
        <button class="ns-popout-btn ns-popout-cancel" onclick="cancelPopoutEdit()">
          ${icon('x')}<span>Cancel</span>
        </button>
      </div>
    `;
  } else {
    cardInner = `
      <div class="ns-popout-handle"></div>
      <div class="ns-popout-label">${_nsActive==='acno' ? 'Saved number' : 'Saved name'}</div>
      <div class="ns-popout-name-display">
        <span class="ns-popout-name-ico">${icon('user')}</span>
        <span class="ns-popout-name-text">${_escHtml(name)}</span>
      </div>
      <div class="ns-popout-actions">
        <button class="ns-popout-btn ns-popout-edit" onclick="enterPopoutEdit()">
          ${icon('pencil')}<span>Edit</span>
        </button>
        <button class="ns-popout-btn ns-popout-del" onclick="deleteFromPopout()">
          ${icon('trash')}<span>Delete</span>
        </button>
      </div>
    `;
  }
  ov.innerHTML = `<div class="ns-popout-card" onclick="event.stopPropagation()">${cardInner}</div>`;
  // Force a reflow then add the .open class so the entry animation fires
  requestAnimationFrame(() => {
    ov.classList.add('open');
    if(_nsPopoutEditing){
      const ip = document.getElementById('ns_popout_input');
      if(ip){ ip.focus(); ip.select(); }
    }
  });
}

function enterPopoutEdit(){
  _nsPopoutEditing = true;
  _renderPopout();
}

function cancelPopoutEdit(){
  _nsPopoutEditing = false;
  _renderPopout();
}

function savePopoutEdit(){
  const ip = document.getElementById('ns_popout_input');
  if(!ip) return;
  const newName = ip.value.trim();
  if(!newName){
    cancelPopoutEdit();
    return;
  }
  const acc = _nsListFor(_nsActive);
  const list = acc.get();
  if(_nsPopoutIdx < 0 || _nsPopoutIdx >= list.length){ closeNamePopout(); return; }
  const existsAt = list.findIndex((n, i) => i !== _nsPopoutIdx && n.toLowerCase() === newName.toLowerCase());
  if(existsAt !== -1){
    list.splice(_nsPopoutIdx, 1);
  } else {
    list[_nsPopoutIdx] = newName;
  }
  acc.set(list);
  showToast('Suggestion updated');
  closeNamePopout();
  // Refresh the dropdown so the renamed entry shows up sorted in place
  if(_nsActive){
    const input = document.getElementById('f_' + _nsActive);
    _renderNameSuggest(_nsActive, input ? input.value : '');
  }
}

function deleteFromPopout(){
  const acc = _nsListFor(_nsActive);
  const list = acc.get();
  if(_nsPopoutIdx < 0 || _nsPopoutIdx >= list.length){ closeNamePopout(); return; }
  list.splice(_nsPopoutIdx, 1);
  acc.set(list);
  showToast('Suggestion removed');
  closeNamePopout();
  if(_nsActive){
    const input = document.getElementById('f_' + _nsActive);
    _renderNameSuggest(_nsActive, input ? input.value : '');
  }
}

// Enter inline-edit mode for the given index in the suggestions list. Keeps
// the dropdown open and re-renders so the row turns into an input + save/
// cancel buttons. The user can then type a new name and tap ✓ to commit.
function startNameEdit(idx){
  _nsEditing = idx;
  if(_nsActive){
    const input = document.getElementById('f_' + _nsActive);
    _renderNameSuggest(_nsActive, input ? input.value : '');
    // Focus the new inline input so the keyboard pops up ready
    setTimeout(() => {
      const ei = document.getElementById('ns_edit_input_' + _nsActive);
      if(ei){ ei.focus(); ei.select(); }
    }, 30);
  }
}

// Commit the inline edit. Replaces the name at `idx` with the new value
// from the inline input. Empty value → cancels (no destructive default).
function saveNameEdit(which, idx){
  const ei = document.getElementById('ns_edit_input_' + which);
  if(!ei) return;
  const newName = ei.value.trim();
  if(!newName){
    cancelNameEdit(which);
    return;
  }
  const acc = _nsListFor(which);
  const list = acc.get();
  if(idx < 0 || idx >= list.length){ cancelNameEdit(which); return; }
  // If the user renames to a value that already exists (other than this
  // entry), drop this entry — keep the canonical existing one.
  const existsAt = list.findIndex((n, i) => i !== idx && n.toLowerCase() === newName.toLowerCase());
  if(existsAt !== -1){
    list.splice(idx, 1);
  } else {
    list[idx] = newName;
  }
  acc.set(list);
  _nsEditing = -1;
  if(_nsActive){
    const input = document.getElementById('f_' + _nsActive);
    _renderNameSuggest(_nsActive, input ? input.value : '');
  }
  showToast('Suggestion updated');
}

// Exit inline-edit mode without committing changes.
function cancelNameEdit(which){
  _nsEditing = -1;
  if(_nsActive){
    const input = document.getElementById('f_' + _nsActive);
    _renderNameSuggest(_nsActive, input ? input.value : '');
  }
}

// Delete a suggestion. Removes from the persisted list and re-renders the
// open dropdown. No confirm modal — the user can re-add a deleted name
// by typing it into the field and saving an entry.
function deleteNameSuggest(idx){
  const acc = _nsListFor(_nsActive);
  const list = acc.get();
  if(idx < 0 || idx >= list.length) return;
  list.splice(idx, 1);
  acc.set(list);
  if(_nsActive){
    const input = document.getElementById('f_' + _nsActive);
    _renderNameSuggest(_nsActive, input ? input.value : '');
  }
  showToast('Suggestion removed');
}

// ─── Captain Con-Trg open/closed state ──────────────────────────────────────
// Default true so the panel is visible the first time the user lands on the
// Summary tab. The user can collapse it; that choice persists for the rest of
// the session via this module-level flag (re-renders preserve it). Not stored
// in localStorage by design — same as the hero rolling-days number, it's a
// transient view preference, not a saved setting.
let _captainContrgOpen = true;

// ─── Captain Con-Trg per-side selection (Day / Night) ───────────────────────
// Each side has its own pilot/copilot toggles and month window (1–12).
// Defaults match the original behaviour: Pilot only, 3 months. Transient
// (session-only) view preference — re-renders preserve it.
// Load persisted Con-Trg selections (or defaults). Defaults match the
// original behaviour: Pilot only, 3 months for Day/Night; SIF+IMC on, 3 months.
let _ccSelStore = (function(){
  let s = {};
  try { s = _storeGet(K_CCSEL, null) || {}; } catch(e){ s = {}; }
  // Clamp the saved gauge threshold to the allowed range (0–50h) WITHOUT
  // rounding — the picker uses 1-hour steps, so a saved value like 6 must
  // come back as 6, not snap to the nearest multiple of 5.
  const clampMark = (v,d)=>{ v = (v|0); if(isNaN(v)) v=d; return Math.max(0, Math.min(50, v)); };
  return {
    day:     (s.day     && typeof s.day==='object')     ? { pilot:s.day.pilot!==false,   copilot:!!s.day.copilot,   months:Math.max(1,Math.min(12,s.day.months|0||3)) }   : { pilot:true, copilot:false, months:3 },
    night:   (s.night   && typeof s.night==='object')   ? { pilot:s.night.pilot!==false, copilot:!!s.night.copilot, months:Math.max(1,Math.min(12,s.night.months|0||6)) } : { pilot:true, copilot:false, months:6 },
    sifimc:  (s.sifimc  && typeof s.sifimc==='object')  ? { sif:s.sifimc.sif!==false,    imc:s.sifimc.imc!==false,  months:Math.max(1,Math.min(12,s.sifimc.months|0||3)), threshold:Math.max(1,Math.min(50,s.sifimc.threshold|0||3)) } : { sif:true, imc:true, months:3, threshold:3 },
    // Gauge threshold settings — red & yellow marks (hours, 0–50, step 5),
    // plus Pilot/Co-Pilot toggles + months that drive the gauge value.
    // Defaults: red=20, yellow=25 (matches the prior fixed thresholds).
    dayG:    (s.dayG    && typeof s.dayG==='object')    ? { pilot:s.dayG.pilot!==false,  copilot:!!s.dayG.copilot,  months:Math.max(1,Math.min(12,s.dayG.months|0||3)),  red:clampMark(s.dayG.red,20),  yellow:clampMark(s.dayG.yellow,25) }  : { pilot:true, copilot:false, months:3, red:20, yellow:25 },
    nightG:  (s.nightG  && typeof s.nightG==='object')  ? { pilot:s.nightG.pilot!==false,copilot:!!s.nightG.copilot,months:Math.max(1,Math.min(12,s.nightG.months|0||6)),red:clampMark(s.nightG.red,6),yellow:clampMark(s.nightG.yellow,6),nvg:!!s.nightG.nvg } : { pilot:true, copilot:false, months:6, red:6, yellow:6, nvg:false }
  };
})();
let _ccDaySel    = _ccSelStore.day;
let _ccNightSel  = _ccSelStore.night;
let _ccSifImcSel = _ccSelStore.sifimc;
let _dayGauge    = _ccSelStore.dayG;
let _nightGauge  = _ccSelStore.nightG;
function _saveCcSel(){
  try { _storeSet(K_CCSEL, { day:_ccDaySel, night:_ccNightSel, sifimc:_ccSifImcSel, dayG:_dayGauge, nightG:_nightGauge }); } catch(e){}
}

// Compute Con-Trg hours for one side given its selection.
//   side: 'day' or 'night'
//   sel : { pilot, copilot, months }
// Window = last `months` CALENDAR MONTHS ending at the picked month's last day
// (capped to today). Sums the selected categories on the active aircraft.
function _ccSideHours(side, sel, entries, activeId, selMonIdx, selYearInt){
  if(!activeId) return 0;
  const lastDayOfMonth = new Date(selYearInt, selMonIdx + 1, 0).getDate();
  const refEnd = new Date(selYearInt, selMonIdx, lastDayOfMonth, 23, 59, 59);
  const capDate = refEnd.getTime() > Date.now() ? new Date() : refEnd;
  const cap = capDate.getTime();
  const months = Math.max(1, Math.min(12, sel.months|0 || 3));
  const cutoff = new Date(capDate.getFullYear(), capDate.getMonth() - months, capDate.getDate(), 0, 0, 0).getTime();
  let total = 0;
  entries.forEach(e=>{
    if(e.acId !== activeId) return;
    const mi = MONTHS.indexOf(e.month);
    const d = parseInt(e.date, 10), y = parseInt(e.year, 10);
    if(mi < 0 || !d || !y) return;
    const ts = new Date(y, mi, d, 12, 0, 0).getTime();
    if(ts > cap || ts < cutoff) return;
    if(side === 'day'){
      if(sel.pilot)   total += (e.day_pilot||0);
      if(sel.copilot) total += (e.day_copilot||0);
    } else {
      if(sel.pilot)   total += (e.night_pilot||0);
      if(sel.copilot) total += (e.night_copilot||0);
    }
  });
  return total;
}

// Human label for a side's selection, e.g. "Pilot + Co-Pilot · 6 mo".
function _ccSelLabel(sel){
  const parts = [];
  if(sel.pilot)   parts.push('Pilot');
  if(sel.copilot) parts.push('Co-Pilot');
  const who = parts.length ? parts.join(' + ') : 'None';
  const m = Math.max(1, Math.min(12, sel.months|0 || 3));
  return who + ' · ' + m + ' mo';
}

// SIF + IMC hours over the selected month window (active aircraft).
function _ccSifImcHours(sel, entries, activeId, selMonIdx, selYearInt){
  if(!activeId) return 0;
  const lastDayOfMonth = new Date(selYearInt, selMonIdx + 1, 0).getDate();
  const refEnd = new Date(selYearInt, selMonIdx, lastDayOfMonth, 23, 59, 59);
  const capDate = refEnd.getTime() > Date.now() ? new Date() : refEnd;
  const cap = capDate.getTime();
  const months = Math.max(1, Math.min(12, sel.months|0 || 3));
  const cutoff = new Date(capDate.getFullYear(), capDate.getMonth() - months, capDate.getDate(), 0, 0, 0).getTime();
  let total = 0;
  entries.forEach(e=>{
    if(e.acId !== activeId) return;
    const mi = MONTHS.indexOf(e.month);
    const d = parseInt(e.date, 10), y = parseInt(e.year, 10);
    if(mi < 0 || !d || !y) return;
    const ts = new Date(y, mi, d, 12, 0, 0).getTime();
    if(ts > cap || ts < cutoff) return;
    if(sel.sif) total += (e.sif||0);
    if(sel.imc) total += (e.imc||0);
  });
  return total;
}
function _ccSifImcLabel(sel){
  const parts = [];
  if(sel.sif) parts.push('SIF');
  if(sel.imc) parts.push('IMC');
  const who = parts.length ? parts.join(' + ') : 'None';
  const m = Math.max(1, Math.min(12, sel.months|0 || 3));
  return who + ' · ' + m + ' mo';
}

// Gauge pilot/copilot hours for Day or Night over the gauge's own window.
function _gaugeHours(side, g, entries, activeId, selMonIdx, selYearInt){
  return _ccSideHours(side, g, entries, activeId, selMonIdx, selYearInt);
}
// NVG hours over a window (active aircraft).
function _gaugeNvgHours(g, entries, activeId, selMonIdx, selYearInt){
  if(!activeId) return 0;
  const lastDayOfMonth = new Date(selYearInt, selMonIdx + 1, 0).getDate();
  const refEnd = new Date(selYearInt, selMonIdx, lastDayOfMonth, 23, 59, 59);
  const capDate = refEnd.getTime() > Date.now() ? new Date() : refEnd;
  const cap = capDate.getTime();
  const months = Math.max(1, Math.min(12, g.months|0 || 3));
  const cutoff = new Date(capDate.getFullYear(), capDate.getMonth() - months, capDate.getDate(), 0, 0, 0).getTime();
  let total = 0;
  entries.forEach(e=>{
    if(e.acId !== activeId) return;
    const mi = MONTHS.indexOf(e.month);
    const d = parseInt(e.date, 10), y = parseInt(e.year, 10);
    if(mi < 0 || !d || !y) return;
    const ts = new Date(y, mi, d, 12, 0, 0).getTime();
    if(ts > cap || ts < cutoff) return;
    total += (e.nvg||0);
  });
  return total;
}
// Resolve gauge colour class from value (hours) against the red threshold.
//   < red  → crit (red)
//   ≥ red  → ok (green)
function _gaugeColorClass(valHours, redH){
  const r = Math.max(0, Math.min(50, redH|0));
  return (valHours >= r) ? 'ok' : 'crit';
}
function _gaugeSelLabel(g){
  const parts = [];
  if(g.pilot)   parts.push('Pilot');
  if(g.copilot) parts.push('Co-Pilot');
  const who = parts.length ? parts.join(' + ') : 'None';
  const m = Math.max(1, Math.min(12, g.months|0 || 3));
  return who + ' · ' + m + ' mo';
}

// Which side the picker is currently editing ('day' | 'night').
let _ccPickerSide = 'day';
// Reliable <select> value setter for popups. Setting .value on a select whose
// popup just became visible can silently fail in some WebViews, leaving the
// element on its previously-rendered value (the "shows the last edited value"
// bug). Explicitly flag the matching <option> as selected and clear the rest,
// then also set .value — this sticks across WebView quirks.
// ── Custom steppers (replace native <select> which mis-renders in WebView) ──
// Each stepper is a <div id> containing a .cc-step-val span. The value lives
// in the span text. These avoid the native-select "stuck on first option" bug.
function _getStep(stepId){
  const el = document.querySelector('#'+stepId+' .cc-step-val');
  const n = el ? parseInt(el.textContent, 10) : NaN;
  return isNaN(n) ? null : n;
}
function _setStep(stepId, value){
  const el = document.querySelector('#'+stepId+' .cc-step-val');
  if(el) el.textContent = String(value);
}
function _stepMonths(stepId, delta){
  let v = _getStep(stepId); if(v == null) v = 3;
  v = Math.max(1, Math.min(12, v + delta));
  _setStep(stepId, v);
  try{ haptic && haptic('tick'); }catch(e){}
}
function _stepThresh(stepId, delta){
  let v = _getStep(stepId); if(v == null) v = 3;
  v = Math.max(1, Math.min(50, v + delta));
  _setStep(stepId, v);
  try{ haptic && haptic('tick'); }catch(e){}
}

function openCcPicker(side){
  _ccPickerSide = side;
  const sel = (side === 'night') ? _ccNightSel : _ccDaySel;
  const titleEl = document.getElementById('ccPickerTitle');
  const pilotChk = document.getElementById('ccPilotChk');
  const copilotChk = document.getElementById('ccCopilotChk');
  if(titleEl) titleEl.textContent = (side === 'night' ? 'Night' : 'Day') + ' Captain Con-Trg';
  if(pilotChk) pilotChk.checked = !!sel.pilot;
  if(copilotChk) copilotChk.checked = !!sel.copilot;
  _setStep('ccMonthsStep', Math.max(1, Math.min(12, (parseInt(sel.months,10)||3))));
  const pop = document.getElementById('ccPickerPopup');
  if(pop) pop.classList.add('active');
  try{ haptic && haptic('light'); }catch(e){}
}
function closeCcPicker(){
  const pop = document.getElementById('ccPickerPopup');
  if(pop) pop.classList.remove('active');
}
function applyCcPicker(){
  const pilotChk = document.getElementById('ccPilotChk');
  const copilotChk = document.getElementById('ccCopilotChk');
  const sel = (_ccPickerSide === 'night') ? _ccNightSel : _ccDaySel;
  sel.pilot   = !!(pilotChk && pilotChk.checked);
  sel.copilot = !!(copilotChk && copilotChk.checked);
  sel.months  = Math.max(1, Math.min(12, (_getStep('ccMonthsStep') || sel.months || 3)));
  // Guard: at least one of Pilot/Co-Pilot must be selected.
  if(!sel.pilot && !sel.copilot){ sel.pilot = true; }
  _saveCcSel();
  closeCcPicker();
  try{ haptic && haptic('confirm'); }catch(e){}
  if(typeof renderSummary === 'function') renderSummary();
}

// ── SIF + IMC picker ──
function openSifImcPicker(){
  const sif = document.getElementById('ccSifChk');
  const imc = document.getElementById('ccImcChk');
  if(sif) sif.checked = !!_ccSifImcSel.sif;
  if(imc) imc.checked = !!_ccSifImcSel.imc;
  _setStep('ccSifImcMonthsStep', Math.max(1, Math.min(12, (parseInt(_ccSifImcSel.months,10)||3))));
  _setStep('ccSifImcThreshStep', Math.max(1, Math.min(50, (parseInt(_ccSifImcSel.threshold,10)||3))));
  const pop = document.getElementById('ccSifImcPopup');
  if(pop) pop.classList.add('active');
  try{ haptic && haptic('light'); }catch(e){}
}
function closeSifImcPicker(){
  const pop = document.getElementById('ccSifImcPopup');
  if(pop) pop.classList.remove('active');
}
function applySifImcPicker(){
  const sif = document.getElementById('ccSifChk');
  const imc = document.getElementById('ccImcChk');
  _ccSifImcSel.sif    = !!(sif && sif.checked);
  _ccSifImcSel.imc    = !!(imc && imc.checked);
  _ccSifImcSel.months = Math.max(1, Math.min(12, (_getStep('ccSifImcMonthsStep') || _ccSifImcSel.months || 3)));
  _ccSifImcSel.threshold = Math.max(1, Math.min(50, (_getStep('ccSifImcThreshStep') || _ccSifImcSel.threshold || 3)));
  if(!_ccSifImcSel.sif && !_ccSifImcSel.imc){ _ccSifImcSel.sif = true; }
  _saveCcSel();
  closeSifImcPicker();
  try{ haptic && haptic('confirm'); }catch(e){}
  if(typeof renderSummary === 'function') renderSummary();
}

// ── Day / Night gauge picker (toggles + months + single red threshold bar) ──
const GAUGE_BAR_MAX = 50, GAUGE_BAR_STEP = 1;
let _gaugePickerSide = 'day';
let _gpRed = 20;   // working value while the popup is open

function openGaugePicker(side){
  _gaugePickerSide = side;
  const g = (side === 'night') ? _nightGauge : _dayGauge;
  _gpRed = Math.max(0, Math.min(GAUGE_BAR_MAX, g.red|0));
  document.getElementById('gpTitle').textContent = (side === 'night' ? 'Night Pilot' : 'Day Pilot') + ' Gauge';
  document.getElementById('gpPilotChk').checked = !!g.pilot;
  document.getElementById('gpCopilotChk').checked = !!g.copilot;
  _setStep('gpMonthsStep', Math.max(1, Math.min(12, (parseInt(g.months,10)||3))));
  const nvgRow = document.getElementById('gpNvgRow');
  if(nvgRow) nvgRow.style.display = (side === 'night') ? 'flex' : 'none';
  const nvgChk = document.getElementById('gpNvgChk');
  if(nvgChk) nvgChk.checked = (side === 'night') ? !!g.nvg : false;
  _gpRenderBar();
  const thrInput = document.getElementById('gpThreshInput');
  if(thrInput) thrInput.value = String(_gpRed);
  const pop = document.getElementById('gaugePickerPopup');
  if(pop) pop.classList.add('active');
  try{ haptic && haptic('light'); }catch(e){}
}
function closeGaugePicker(){
  const pop = document.getElementById('gaugePickerPopup');
  if(pop) pop.classList.remove('active');
}
function _gpRenderBar(){
  const max = GAUGE_BAR_MAX;
  const redPct = (_gpRed/max)*100;
  const fill = document.getElementById('gpBarFill');
  if(fill){
    // Single threshold: 0→red red, red→max green, with a SMALL soft shaded
    // transition straddling the boundary so the two colours blend gently.
    const blend = 4; // % width of the soft transition band
    const a = Math.max(0, redPct - blend);
    const b = Math.min(100, redPct + blend);
    fill.style.background =
      'linear-gradient(to right,'+
      '#e74c3c 0%,'+
      '#e74c3c '+a+'%,'+
      '#d88a3c '+redPct+'%,'+        /* warm blend at the boundary */
      '#27ae60 '+b+'%,'+
      '#27ae60 100%)';
  }
  const rm = document.getElementById('gpRedMarker');
  if(rm){ rm.style.left = redPct+'%'; }
  const rl = document.getElementById('gpRedLbl');
  if(rl){ rl.textContent = _gpRed + 'h'; rl.style.left = redPct+'%'; }
  const ti = document.getElementById('gpThreshInput');
  if(ti && document.activeElement !== ti){ ti.value = String(_gpRed); }
}
// Typed threshold input → update the bar live (clamped 0–50, whole hours).
function _gpThreshInput(v){
  let n = parseInt(v, 10);
  if(isNaN(n)) return;            // allow empty/partial typing without snapping
  n = Math.max(0, Math.min(GAUGE_BAR_MAX, n));
  _gpRed = n;
  _gpRenderBar();
}
function _gpThreshCommit(v){
  let n = parseInt(v, 10);
  if(isNaN(n)) n = _gpRed;
  _gpRed = Math.max(0, Math.min(GAUGE_BAR_MAX, n));
  const ti = document.getElementById('gpThreshInput');
  if(ti) ti.value = String(_gpRed);
  _gpRenderBar();
}
// Drag handling — pointer position → snapped value (1-hour steps).
function _gpStartDrag(which, ev){
  ev.preventDefault();
  const track = document.getElementById('gpBarTrack');
  if(!track) return;
  const move = (e)=>{
    const pt = (e.touches && e.touches[0]) ? e.touches[0] : e;
    const r = track.getBoundingClientRect();
    let frac = (pt.clientX - r.left) / Math.max(1, r.width);
    frac = Math.max(0, Math.min(1, frac));
    let val = Math.round((frac*GAUGE_BAR_MAX)/GAUGE_BAR_STEP)*GAUGE_BAR_STEP;
    if(val !== _gpRed){ _gpRed = val; try{haptic&&haptic('tick');}catch(_){} }
    _gpRenderBar();
  };
  const up = ()=>{
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('touchmove', move, {passive:false});
  document.addEventListener('touchend', up);
  move(ev);
}
function applyGaugePicker(){
  const g = (_gaugePickerSide === 'night') ? _nightGauge : _dayGauge;
  g.pilot   = !!document.getElementById('gpPilotChk').checked;
  g.copilot = !!document.getElementById('gpCopilotChk').checked;
  const _gm = _getStep('gpMonthsStep');
  g.months  = Math.max(1, Math.min(12, (_gm || g.months || 3)));
  if(!g.pilot && !g.copilot){ g.pilot = true; }
  g.red = _gpRed; g.yellow = _gpRed;   // keep yellow synced for back-compat
  if(_gaugePickerSide === 'night'){ g.nvg = !!document.getElementById('gpNvgChk').checked; }
  _saveCcSel();
  closeGaugePicker();
  try{ haptic && haptic('confirm'); }catch(e){}
  if(typeof renderSummary === 'function') renderSummary();
}

function toggleCaptainContrg(){
  _captainContrgOpen = !_captainContrgOpen;
  const wrap = document.getElementById('captainContrgWrap');
  if(!wrap) return;
  wrap.classList.toggle('open', _captainContrgOpen);
  // Update the aria-expanded on the inner button for accessibility consumers.
  const btn = wrap.querySelector('.captain-contrg-toggle');
  if(btn) btn.setAttribute('aria-expanded', _captainContrgOpen ? 'true' : 'false');
}
// Clamp helper — keeps the value in the allowed range no matter what's typed.
function _clampRollingDays(n){
  n = parseInt(n, 10);
  if(isNaN(n) || n < 1) return 1;
  if(n > 366) return 366;
  return n;
}
// Compute FATIGUE flying within the rolling window ending TODAY. Each minute
// of flying contributes to fatigue at a weighted rate based on conditions:
//
//   Day  ×  1.00   (baseline)
//   Ni   ×  1.25   (night flying is more fatiguing than day)
//   NVG  ×  1.50   (night vision goggles add significant cognitive load)
//
// CRITICAL: a sortie's NVG minutes are a SUBSET of its Night minutes (a NVG
// sortie is by definition flown at night). To avoid double-counting, we
// subtract NVG minutes from Night minutes before applying the 1.25× weight,
// then add NVG minutes at the 1.50× weight separately. So a 45-min sortie
// flown entirely on NVG gives 0 min at Ni-rate + 45 × 1.5 = 68 min fatigue
// (NOT 45 × 1.25 + 45 × 1.5 = 124 min — which would double-count).
//
// Returns an object so the renderer can display a breakdown (Day + Ni + NVG)
// below the total. Each component is rounded individually so the displayed
// breakdown sums exactly to the displayed total.
function _heroRollingTotalMins(days){
  const now = Date.now();
  const cutoff = now - days * 24*60*60*1000;
  let dayContrib = 0, niContrib = 0, nvgContrib = 0;
  getEntries().forEach(e=>{
    const mi = MONTHS.indexOf(e.month);
    const d  = parseInt(e.date, 10);
    const y  = parseInt(e.year, 10);
    if(mi < 0 || !d || !y) return;
    const ts = new Date(y, mi, d, 12, 0, 0).getTime();
    if(ts < cutoff || ts > now) return;

    const dayMins   = (e.day_dual||0) + (e.day_pilot||0) + (e.day_copilot||0);
    const nightMins = (e.night_dual||0) + (e.night_pilot||0) + (e.night_copilot||0);
    const nvgMins   = (e.nvg||0);
    // De-double-count: subtract NVG portion before weighting the rest as Ni.
    const nightNonNVG = Math.max(0, nightMins - nvgMins);

    dayContrib += dayMins * 1.0;
    niContrib  += nightNonNVG * 1.25;
    nvgContrib += nvgMins * 1.5;
  });
  return {
    day:   Math.round(dayContrib),
    ni:    Math.round(niContrib),
    nvg:   Math.round(nvgContrib),
    total: Math.round(dayContrib + niContrib + nvgContrib),
  };
}
// Handler for the user-editable rolling-days input. Clamps the value, stores
// it, then refreshes ONLY the rolling-total number in the DOM (we don't call
// renderSummary() because that would re-collapse the periodic-summary section
// and lose other in-place state — a targeted DOM update is cheaper and nicer).
function _onHeroRollingChange(){
  const inp = document.getElementById('heroRollingDays');
  if(!inp) return;
  const days = _clampRollingDays(inp.value);
  _heroRollingDays = days;
  inp.value = days;     // reflect clamped value back into the field
  const f = _heroRollingTotalMins(days);
  // Refresh both the big total and the colour-coded Day+Ni+NVG breakdown line.
  // We update both targeted elements in-place rather than calling renderSummary()
  // so we don't disturb other in-place state on the tab (e.g. an expanded
  // periodic-summary, scroll position).
  const valEl = document.getElementById('heroRollingVal');
  if(valEl) valEl.innerHTML = hmHTML(f.total);
  const bdEl = document.getElementById('heroRollingBreakdown');
  if(bdEl){
    bdEl.innerHTML =
        `<span style="color:#4aa8e8">${hmHTML(f.day)}</span>`
      + `<span class="rb-plus">+</span>`
      + `<span style="color:#ff5b4d">${hmHTML(f.ni)}</span>`
      + `<span class="rb-plus">+</span>`
      + `<span style="color:#2ecc71">${hmHTML(f.nvg)}</span>`;
  }
}

let _sumSelMonth = (function(){
  const d = new Date();
  return MONTHS[d.getMonth()] + '_' + d.getFullYear();
})();

// ─── Periodic Summary state — from/to dates (ISO yyyy-mm-dd) and PE-inclusion flag ───
// Default: last 90 days, PE excluded. The user can change either date via the
// system calendar picker on each <input type="date">. Empty string = not yet set.
let _periodicFrom = (function(){
  const d = new Date(); d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0,10);
})();
let _periodicTo = new Date().toISOString().slice(0,10);
// Periodic Summary always EXCLUDES Prior Experience. The checkbox that used
// to control this was removed for simplicity — the summary now reports only
// what the user logged within the selected date range, which is the cleaner
// definition of "periodic." Career-to-date views (including PE) are still
// available on the main Summary card and the per-aircraft summaries above.
// Kept as a const so any legacy code path that reads this variable still
// behaves correctly (it's just always false now).
const _periodicIncludePE = false;
// True once the user taps APPLY — table appears only after that, so the section
// doesn't auto-render with the default 90-day window before they've engaged.
let _periodicShown = false;
// Whether the Periodic Summary collapsible is open. Default closed so the
// Summary tab loads compact; user taps to expand. Stays open across re-renders
// once they've engaged with it.
let _periodicOpen = false;

function togglePeriodicSummary(){
  _periodicOpen = !_periodicOpen;
  const wrap = document.getElementById('periodicWrap');
  if(!wrap) return;
  wrap.classList.toggle('open', _periodicOpen);
  // Update aria-expanded on the button so accessibility tools track state
  const btn = wrap.querySelector('.periodic-toggle');
  if(btn) btn.setAttribute('aria-expanded', _periodicOpen ? 'true' : 'false');
  // When EXPANDING, the section grows by ~200-400px below its previous footprint
  // and on mid-height phones the date picker + APPLY button (and any rendered
  // data table) ends up below the bottom of the viewport. Scroll the toggle
  // toward the top of the visible area so the whole picker is in view. Defer
  // until after the 0fr → 1fr grid-rows transition (320ms) finishes so the
  // browser is scrolling against the final height, not the in-flight one.
  if(_periodicOpen){
    setTimeout(()=>{
      wrap.scrollIntoView({block:'start', behavior:'smooth'});
    }, 340);
  }
}

// Hour columns shared by all Summary tables (matches Logbook column order).
// `cat` drives column-tint colour in summary tables: day=blue, night=red, nvg=green.
const _SUM_COLS = [
  {key:'day_dual',     lbl:'Day<br>Dual',  cat:'day'},
  {key:'day_pilot',    lbl:'Day<br>Pilot', cat:'day'},
  {key:'day_copilot',  lbl:'Day<br>C/P',   cat:'day'},
  {key:'night_dual',   lbl:'Ni<br>Dual',   cat:'night'},
  {key:'night_pilot',  lbl:'Ni<br>Pilot',  cat:'night'},
  {key:'night_copilot',lbl:'Ni<br>C/P',    cat:'night'},
  {key:'nvg',          lbl:'NVG',          cat:'nvg',  combine:['nvg','nvg_dual','nvg_pilot','nvg_copilot']},
  {key:'imc',          lbl:'IMC',    combine:['imc','imc_day','imc_night']},
  {key:'sif',          lbl:'SIF',    combine:['sif','sif_day','sif_night']},
  {key:'instr_day',    lbl:'Instr<br>Day'},
  {key:'instr_night',  lbl:'Instr<br>Ni'},
  {key:'wso',          lbl:'WSO'},
];

// Category colour map (used for summary table column tinting).
// Values match the brightened ink colours so columns visually align with logbook ink.
const _CAT_COL = {
  day:   '#4aa8e8',  // blue
  night: '#ff5b4d',  // red
  nvg:   '#2ecc71',  // green
};
// Return inline CSS colour string for a column, or empty if no category colour.
function _colCss(col){
  return col.cat ? `color:${_CAT_COL[col.cat]}` : '';
}

// Sum a column's value from one source object (entry OR PE data), respecting combine aliases.
function _sumCol(src, col){
  if(col.combine) return col.combine.reduce((s,k)=>s+(src[k]||0), 0);
  return src[col.key]||0;
}

// <option>s for the MONTH picker — always all 12 months (a user might pick a month they
// haven't flown in yet, in which case the table shows the empty state). Highlights the
// currently-selected month.
function _sumMonthOnlyOptions(){
  const sel = _sumSelMonth.split('_')[0];
  return MONTHS.map(m=>`<option value="${m}" ${m===sel?'selected':''}>${m}</option>`).join('');
}

// <option>s for the YEAR picker — every year with entries, plus current year.
// Sorted newest-first. Highlights the currently-selected year.
function _sumYearOnlyOptions(){
  const entries = getEntries();
  const set = new Set();
  entries.forEach(e=>{ if(e.year) set.add(parseInt(e.year, 10)); });
  set.add(new Date().getFullYear());
  const years = [...set].sort((a,b)=>b-a);
  const selY = parseInt(_sumSelMonth.split('_')[1], 10);
  // If selected year somehow not in the list (deleted all entries from it), keep it visible
  if(!years.includes(selY)) years.unshift(selY);
  return years.map(y=>`<option value="${y}" ${y===selY?'selected':''}>${y}</option>`).join('');
}

// Monthly Summary table: ONE row of totals for the active aircraft × picked month.
function _renderMonthlySummaryRow(activeAc, monthAgg, monthTotal, entryCount){
  const headerHTML = `
    <thead><tr>
      <th>Aircraft</th>
      ${_SUM_COLS.map(c=>`<th style="${_colCss(c)}">${c.lbl}</th>`).join('')}
      <th>Total</th>
    </tr></thead>`;

  if(!activeAc){
    return `<table class="sum-table sum-cols">
      ${headerHTML}
      <tbody><tr><td colspan="${_SUM_COLS.length+2}" style="padding:18px;text-align:center;color:var(--txt2)">
        No active aircraft set. Choose one from Prior Experience.
      </td></tr></tbody>
    </table>`;
  }

  if(entryCount === 0){
    return `<table class="sum-table sum-cols">
      ${headerHTML}
      <tbody><tr><td colspan="${_SUM_COLS.length+2}" style="padding:18px;text-align:center;color:var(--txt2)">
        No entries for ${activeAc.name} in the selected month.
      </td></tr></tbody>
    </table>`;
  }

  // Single row with the aggregated month totals
  const cellsHTML = _SUM_COLS.map(c=>{
    const v = monthAgg[c.key];
    return `<td style="${_colCss(c)}">${v>0?hm(v):'—'}</td>`;
  }).join('');
  return `<table class="sum-table sum-cols">
    ${headerHTML}
    <tbody>
      <tr>
        <td style="text-align:left;padding-left:10px;font-weight:700;color:var(--gold2)">
          ${activeAc.name}
          <div style="font-size:9px;color:var(--txt3);letter-spacing:.5px;font-weight:400;margin-top:2px">${entryCount} sortie${entryCount===1?'':'s'}</div>
        </td>
        ${cellsHTML}
        <td style="color:var(--gold);font-weight:700">${hmHTML(monthTotal)}</td>
      </tr>
    </tbody>
  </table>`;
}

// Cumulative All-Aircraft table: one row per aircraft, PE + all log-entry hours, all-time.
function _renderAllAcCumulativeTable(cutoffMonIdx, cutoffYear){
  const acs = getAC();
  const allEntries = getEntries();
  // ── Cutoff scoping ────────────────────────────────────────────────────
  // The cumulative table is computed AS OF the month/year picked at the
  // top of the Summary tab — it includes every entry dated up to and
  // including the selected month, and excludes entries from later months.
  // (Pick the latest month and it equals the old all-time behavior.)
  // Prior Experience hours are always included as the base — they predate
  // all log entries by definition.
  const hasCutoff = Number.isInteger(cutoffMonIdx) && Number.isInteger(cutoffYear);
  const cutoffIdx = hasCutoff ? (cutoffYear * 12 + cutoffMonIdx) : Infinity;
  const entries = allEntries.filter(e => {
    const mIdx = MONTHS.indexOf(e.month);
    const y = parseInt(e.year, 10);
    if(mIdx === -1 || isNaN(y)) return true;  // unparseable dates: keep
    return (y * 12 + mIdx) <= cutoffIdx;
  });

  const headerHTML = `
    <thead><tr>
      <th>Aircraft</th>
      ${_SUM_COLS.map(c=>`<th style="${_colCss(c)}">${c.lbl}</th>`).join('')}
      <th>Total</th>
    </tr></thead>`;

  if(!acs.length){
    return `<table class="sum-table sum-cols">
      ${headerHTML}
      <tbody><tr><td colspan="${_SUM_COLS.length+2}" style="padding:18px;text-align:center;color:var(--txt2)">
        No aircraft added. Add one in Prior Experience.
      </td></tr></tbody>
    </table>`;
  }

  const grand = {};
  _SUM_COLS.forEach(c=>grand[c.key]=0);
  let grandFlying = 0;

  const rowsHTML = acs.map(ac=>{
    const acEntries = entries.filter(e=>e.acId===ac.id);
    const peData = ac.data||{};
    const rowVals = {};
    _SUM_COLS.forEach(c=>{
      rowVals[c.key] = _sumCol(peData, c) + acEntries.reduce((s,e)=>s+_sumCol(e,c), 0);
      grand[c.key] += rowVals[c.key];
    });
    const flyingKeys = ['day_dual','day_pilot','day_copilot','night_dual','night_pilot','night_copilot'];
    const rowFlying = flyingKeys.reduce((s,k)=>s+rowVals[k], 0);
    grandFlying += rowFlying;

    return `<tr>
      <td style="text-align:left;padding-left:10px;font-weight:700">${ac.name}</td>
      ${_SUM_COLS.map(c=>{
        const v = rowVals[c.key];
        return `<td style="${_colCss(c)}">${v>0?hm(v):'—'}</td>`;
      }).join('')}
      <td style="color:var(--gold);font-weight:700">${rowFlying>0?hm(rowFlying):'—'}</td>
    </tr>`;
  }).join('');

  const grandRowHTML = `<tr class="grand-row">
    <td style="text-align:left;padding-left:10px">GRAND TOTAL</td>
    ${_SUM_COLS.map(c=>{
      const v = grand[c.key];
      return `<td style="${_colCss(c)}">${v>0?hm(v):'—'}</td>`;
    }).join('')}
    <td>${hmHTML(grandFlying)}</td>
  </tr>`;

  return `<table class="sum-table sum-cols">
    ${headerHTML}
    <tbody>${rowsHTML}${grandRowHTML}</tbody>
  </table>`;
}

// ═════════════════════════ PERIODIC SUMMARY ═════════════════════════
// Convert a log entry to a JS Date using its date/month/year fields. Returns null
// if any field is malformed (defensive — entries imported from older versions
// occasionally have missing pieces).
function _entryDate(e){
  const m = MONTHS.indexOf(e.month);
  const d = parseInt(e.date, 10);
  const y = parseInt(e.year, 10);
  if(m < 0 || !d || !y) return null;
  return new Date(y, m, d);
}

// Live form-input listener: keep the state vars synced as the user changes
// the date inputs. Does NOT re-render — that only happens on APPLY.
function _onPeriodicChange(){
  const f = document.getElementById('periodicFrom')?.value;
  const t = document.getElementById('periodicTo')?.value;
  if(f !== undefined) _periodicFrom = f;
  if(t !== undefined) _periodicTo = t;
}

// (_onPeriodicPeToggle removed — PE checkbox no longer exists. The function
// is kept as a harmless no-op alias in case any cached HTML still references
// it via onchange; otherwise removing it would throw a ReferenceError when
// the old DOM fires.)
function _onPeriodicPeToggle(){ /* no-op — PE toggle removed */ }

// User tapped APPLY — validate, mark "shown", re-render. Guards against
// inverted ranges and empty fields.
function applyPeriodicSummary(){
  _onPeriodicChange();
  if(!_periodicFrom || !_periodicTo){
    showToast('Pick both From and To dates', true); return;
  }
  if(_periodicFrom > _periodicTo){
    showToast('From date must be on or before To date', true, 4000); return;
  }
  _periodicShown = true;
  _periodicOpen  = true;   // keep the section expanded after APPLY so the result is visible
  renderSummary();
  // renderSummary() replaces the Summary tab's HTML, so we need to scroll AFTER
  // the new DOM is in place. The data table sits inside .periodic-body — pull
  // it into view so the user sees the result they just generated instead of
  // staring at the unchanged date picker that was already on screen.
  setTimeout(()=>{
    const wrap = document.getElementById('periodicWrap');
    if(!wrap) return;
    // Prefer the actual data table (rendered after APPLY); fall back to the wrap.
    const target = wrap.querySelector('.periodic-data, .pa-card, table') || wrap;
    target.scrollIntoView({block:'start', behavior:'smooth'});
  }, 60);
}

// Filter all log entries to the active periodic range.
// Inclusive on both ends; uses local-date comparison so picking "today" really
// includes today.
function _periodicEntries(){
  const from = new Date(_periodicFrom + 'T00:00:00');
  const to   = new Date(_periodicTo   + 'T23:59:59');
  return getEntries().filter(e=>{
    const d = _entryDate(e);
    return d && d >= from && d <= to;
  });
}

// Render the Periodic Summary table — same shape as _renderAllAcCumulativeTable
// but scoped to the date range. Prior Experience is intentionally excluded
// (it has no date so cannot be range-scoped meaningfully).
function _renderPeriodicSection(){
  const acs = getAC();
  const ents = _periodicEntries();

  // Format the chosen range in DD MMM YYYY for the caption (more readable than
  // ISO yyyy-mm-dd in a printed summary)
  const fmt = iso => {
    const [y,m,d] = iso.split('-');
    return `${d} ${MONTHS[parseInt(m,10)-1]} ${y}`;
  };
  const metaHTML = `<div class="periodic-result-meta">
    ${fmt(_periodicFrom)} → ${fmt(_periodicTo)} · ${ents.length} sortie${ents.length===1?'':'s'}
  </div>`;

  if(!acs.length){
    return metaHTML + `<div class="periodic-empty">No aircraft added.</div>`;
  }

  const headerHTML = `
    <thead><tr>
      <th>Aircraft</th>
      ${_SUM_COLS.map(c=>`<th style="${_colCss(c)}">${c.lbl}</th>`).join('')}
      <th>Total</th>
    </tr></thead>`;

  const grand = {};
  _SUM_COLS.forEach(c=>grand[c.key]=0);
  let grandFlying = 0;
  const flyingKeys = ['day_dual','day_pilot','day_copilot','night_dual','night_pilot','night_copilot'];

  const rowsHTML = acs.map(ac=>{
    const acEntries = ents.filter(e=>e.acId===ac.id);
    const rowVals = {};
    _SUM_COLS.forEach(c=>{
      let v = acEntries.reduce((s,e)=>s+_sumCol(e,c), 0);
      // PE has no date, so it can only be included in full — treat it as belonging
      // to the start of any range when the user opts in.
      if(_periodicIncludePE) v += _sumCol(ac.data||{}, c);
      rowVals[c.key] = v;
      grand[c.key] += v;
    });
    const rowFlying = flyingKeys.reduce((s,k)=>s+rowVals[k], 0);
    grandFlying += rowFlying;

    return `<tr>
      <td style="text-align:left;padding-left:10px;font-weight:700">${ac.name}</td>
      ${_SUM_COLS.map(c=>{
        const v = rowVals[c.key];
        return `<td style="${_colCss(c)}">${v>0?hm(v):'—'}</td>`;
      }).join('')}
      <td style="color:var(--gold);font-weight:700">${rowFlying>0?hm(rowFlying):'—'}</td>
    </tr>`;
  }).join('');

  const grandRowHTML = `<tr class="grand-row">
    <td style="text-align:left;padding-left:10px">PERIOD TOTAL</td>
    ${_SUM_COLS.map(c=>{
      const v = grand[c.key];
      return `<td style="${_colCss(c)}">${v>0?hm(v):'—'}</td>`;
    }).join('')}
    <td>${hmHTML(grandFlying)}</td>
  </tr>`;

  return metaHTML + `<div class="sum-table-wrap" style="margin-bottom:14px">
    <table class="sum-table sum-cols">
      ${headerHTML}
      <tbody>${rowsHTML}${grandRowHTML}</tbody>
    </table>
  </div>`;
}

// ═════════════════════════ PDF EXPORT (native print) ═════════════════════════
// Build a printer-friendly HTML document inside #printRoot, then trigger the
// system print dialog where the user picks "Save as PDF". The @media print
// stylesheet hides everything except #printRoot. Zero KB of dependencies.

// ═════════════════════════ PDF EXPORT — range & aircraft picker ═════════════════════════
// All PDF tables share a printer-friendly class scheme (.pr-table, .pr-col-day, etc.)
// that's styled by the @media print stylesheet so the output is consistent.

// ════════════════════════════════════════════════════════════════════════
//                  STANDARDISED PDF REPORT GENERATOR
// Mirrors the Indian Army Aviation paper logbook layout:
//   – Cover page with pilot identity, unit, range, and an at-a-glance
//     5-card summary (Day / Night / NVG / Total Flying / Total Pilot)
//   – One A4-landscape page per month with sortie-by-sortie detail table,
//     PAGE TOTAL / RUNNING TOTAL / DAY-NIGHT-NVG / TOTAL FLYING summary
//     rows, and a signature block (Pilot / Supervisor / Date)
//   – Final cumulative page across all aircraft in the chosen range
//
// All hours render hh:mm (never decimal). Colour convention: Day=blue,
// Night=red, NVG=green. Print stylesheet handles page breaks, page-number
// counter, and toner-safe colours.
// ════════════════════════════════════════════════════════════════════════

// Order key for month strings: "FEB_2026" < "MAR_2026" < "JAN_2027"
function _monthKeyCmp(a, b){
  const [am, ay] = a.split('_'); const [bm, by] = b.split('_');
  if(ay !== by) return parseInt(ay,10) - parseInt(by,10);
  return MONTHS.indexOf(am) - MONTHS.indexOf(bm);
}

// CSS class for the column's ink category — applied to <th> and <td>
function _pdfColCls(cat){
  if(cat === 'day')   return 'day';
  if(cat === 'night') return 'night';
  if(cat === 'nvg')   return 'nvg';
  return '';
}

// Compute totals for a given aircraft/entries collection. Returns an object
// keyed by column with minutes summed; respects the NVG combine rule (PE
// stores nvg_dual/nvg_pilot/nvg_copilot, log entries store a single nvg).
function _pdfSumRow(entriesList, includePE, ac){
  const out = {};
  _SUM_COLS.forEach(c => out[c.key] = 0);
  entriesList.forEach(e => {
    _SUM_COLS.forEach(c => { out[c.key] += _sumCol(e, c); });
  });
  if(includePE && ac && ac.data){
    _SUM_COLS.forEach(c => { out[c.key] += _sumCol(ac.data, c); });
  }
  return out;
}

// Render one detail row given an entry (no totals — actual sortie).
// Columns laid out left-to-right: # | Date | Aircraft | Pilot | Co-Pilot |
// Exercise/Route | D-Dual | D-Pilot | D-CoP | N-Dual | N-Pilot | N-CoP |
// NVG | Sim | WSO | IMC | SIF | InstrD | InstrN
function _pdfDetailRow(e, idx){
  const f = v => v > 0 ? hm(v) : '—';
  // Normalise legacy entry-type tokens to the canonical set
  // {black, blue, red, nvg}. Older imports / backups may have 'green' for NVG.
  let inkType = e.entryType || 'black';
  if(inkType === 'green') inkType = 'nvg';
  // Truncation lengths tuned to the column widths in the print stylesheet so
  // the text fills its cell without spilling: aircraft (14mm ≈ 10 chars),
  // pilot/copilot (24mm ≈ 13 chars). Exercise can wrap to 2 lines so we
  // allow up to 50 chars before truncating. The CSS text-overflow ellipsis
  // takes care of anything that still doesn't fit on the single-line cells.
  // ink-{type} class drives the whole-row colour coding (left stripe + faint
  // background tint) defined in the print stylesheet.
  return `<tr class="ink-${inkType}">
    <td>${idx+1}</td>
    <td>${String(e.date||'').padStart(2,'0')} ${e.month||''}</td>
    <td class="acno">${e.acno || ''}</td>
    <td class="name">${e.pilot || ''}</td>
    <td class="name">${e.copilot || ''}</td>
    <td class="left">${e.route || ''}</td>
    <td class="hr day">${f(e.day_dual||0)}</td>
    <td class="hr day">${f(e.day_pilot||0)}</td>
    <td class="hr day">${f(e.day_copilot||0)}</td>
    <td class="hr night">${f(e.night_dual||0)}</td>
    <td class="hr night">${f(e.night_pilot||0)}</td>
    <td class="hr night">${f(e.night_copilot||0)}</td>
    <td class="hr nvg">${f(e.nvg||0)}</td>
    <td class="hr">${f(e.simulator||0)}</td>
    <td class="hr">${f(e.wso||0)}</td>
    <td class="hr">${f((e.imc||0)+(e.imc_day||0)+(e.imc_night||0))}</td>
    <td class="hr">${f((e.sif||0)+(e.sif_day||0)+(e.sif_night||0))}</td>
    <td class="hr">${f(e.instr_day||0)}</td>
    <td class="hr">${f(e.instr_night||0)}</td>
  </tr>`;
}

// Render a "totals" row (PAGE TOTAL / RUNNING TOTAL / DAY-NIGHT-NVG /
// TOTAL FLYING). `cls` selects the styling, `cols` is the hour map.
function _pdfTotalsRow(cls, label, cols, spanLabel){
  const f = v => v > 0 ? hm(v) : '—';
  return `<tr class="${cls}">
    <td colspan="${spanLabel || 6}" class="left">${label}</td>
    <td class="hr day">${f(cols.day_dual||0)}</td>
    <td class="hr day">${f(cols.day_pilot||0)}</td>
    <td class="hr day">${f(cols.day_copilot||0)}</td>
    <td class="hr night">${f(cols.night_dual||0)}</td>
    <td class="hr night">${f(cols.night_pilot||0)}</td>
    <td class="hr night">${f(cols.night_copilot||0)}</td>
    <td class="hr nvg">${f(cols.nvg||0)}</td>
    <td class="hr">${f(cols.simulator||0)}</td>
    <td class="hr">${f(cols.wso||0)}</td>
    <td class="hr">${f(cols.imc||0)}</td>
    <td class="hr">${f(cols.sif||0)}</td>
    <td class="hr">${f(cols.instr_day||0)}</td>
    <td class="hr">${f(cols.instr_night||0)}</td>
  </tr>`;
}

// Render the DAY/NIGHT/NVG ROLL-UP row — combines Dual+Pilot+CoPilot per
// group, mirrors the reference workbook's row 359.
function _pdfDnnRow(cols){
  const f = v => v > 0 ? hm(v) : '—';
  const dayAll   = (cols.day_dual||0)+(cols.day_pilot||0)+(cols.day_copilot||0);
  const nightAll = (cols.night_dual||0)+(cols.night_pilot||0)+(cols.night_copilot||0);
  return `<tr class="dnn">
    <td colspan="6" class="left">DAY / NIGHT / NVG ROLL-UP</td>
    <td class="hr day" colspan="3">${f(dayAll)}</td>
    <td class="hr night" colspan="3">${f(nightAll)}</td>
    <td class="hr nvg">${f(cols.nvg||0)}</td>
    <td class="hr">${f(cols.simulator||0)}</td>
    <td class="hr">${f(cols.wso||0)}</td>
    <td class="hr">${f(cols.imc||0)}</td>
    <td class="hr">${f(cols.sif||0)}</td>
    <td class="hr">${f(cols.instr_day||0)}</td>
    <td class="hr">${f(cols.instr_night||0)}</td>
  </tr>`;
}

// Render the TOTAL FLYING line — Day + Night only (NVG is a Night descriptor).
function _pdfFlyingRow(cols){
  const dayAll   = (cols.day_dual||0)+(cols.day_pilot||0)+(cols.day_copilot||0);
  const nightAll = (cols.night_dual||0)+(cols.night_pilot||0)+(cols.night_copilot||0);
  const total = dayAll + nightAll;
  return `<tr class="flying">
    <td colspan="19" class="left">TOTAL FLYING (Day + Night) &nbsp;·&nbsp; ${hmHTML(total)}</td>
  </tr>`;
}

// Per-aircraft summary table for a per-month page.
// `entriesForRange` is the list of entries to sum (just-this-month, or
// PE-through-this-month). `includePE` adds aircraft Prior Experience to
// every row; used for the cumulative table, not the monthly-only one.
// `title` is the heading displayed above the table.
function _pdfPerAcSummary(entriesForRange, acs, acFilterId, includePE, title){
  const filteredAcs = acs.filter(a => !acFilterId || a.id === acFilterId);
  const flyKeys = ['day_dual','day_pilot','day_copilot','night_dual','night_pilot','night_copilot'];

  const grand = {};
  _SUM_COLS.forEach(c => grand[c.key] = 0);
  let grandFly = 0;
  let anyData = false;

  const rowsHTML = filteredAcs.map(ac => {
    const acEnts = entriesForRange.filter(e => e.acId === ac.id);
    // For the monthly-only table, skip aircraft with zero entries this month
    // — keeps the table compact. For the cumulative table, always show
    // because PE alone is enough to warrant a row.
    if(!includePE && acEnts.length === 0) return '';
    const r = {};
    _SUM_COLS.forEach(c => {
      r[c.key] = (includePE ? _sumCol(ac.data||{}, c) : 0)
               + acEnts.reduce((s,e)=>s+_sumCol(e,c), 0);
      grand[c.key] += r[c.key];
    });
    const fly = flyKeys.reduce((s,k)=>s+r[k], 0);
    grandFly += fly;
    anyData = true;
    const f = v => v > 0 ? hm(v) : '—';
    return `<tr>
      <td class="ac-name">${ac.name}</td>
      <td class="hr day">${f(r.day_dual)}</td>
      <td class="hr day">${f(r.day_pilot)}</td>
      <td class="hr day">${f(r.day_copilot)}</td>
      <td class="hr night">${f(r.night_dual)}</td>
      <td class="hr night">${f(r.night_pilot)}</td>
      <td class="hr night">${f(r.night_copilot)}</td>
      <td class="hr nvg">${f(r.nvg)}</td>
      <td class="hr">${f(r.simulator)}</td>
      <td class="hr">${f(r.wso)}</td>
      <td class="hr">${f(r.imc)}</td>
      <td class="hr">${f(r.sif)}</td>
      <td class="hr">${f(r.instr_day)}</td>
      <td class="hr">${f(r.instr_night)}</td>
      <td class="hr"><b>${hmHTML(fly)}</b></td>
    </tr>`;
  }).join('');

  // Empty state: monthly-only summary with no sorties this month.
  if(!anyData){
    return `<div class="pr-mini-summary">
      <div class="pr-mini-title">${title}</div>
      <div style="padding:6px 8px;text-align:center;color:#888;font-style:italic;font-family:'Rajdhani',sans-serif;font-size:9.5px;background:#fbf8ee;border:0.4px solid #99a0ad;border-radius:1mm">
        No sorties in this period.
      </div>
    </div>`;
  }

  const f = v => v > 0 ? hm(v) : '—';
  const grandRow = `<tr class="grand">
    <td class="ac-name">${includePE ? 'CUMULATIVE TOTAL' : 'MONTH TOTAL'}</td>
    <td class="hr day">${f(grand.day_dual)}</td>
    <td class="hr day">${f(grand.day_pilot)}</td>
    <td class="hr day">${f(grand.day_copilot)}</td>
    <td class="hr night">${f(grand.night_dual)}</td>
    <td class="hr night">${f(grand.night_pilot)}</td>
    <td class="hr night">${f(grand.night_copilot)}</td>
    <td class="hr nvg">${f(grand.nvg)}</td>
    <td class="hr">${f(grand.simulator)}</td>
    <td class="hr">${f(grand.wso)}</td>
    <td class="hr">${f(grand.imc)}</td>
    <td class="hr">${f(grand.sif)}</td>
    <td class="hr">${f(grand.instr_day)}</td>
    <td class="hr">${f(grand.instr_night)}</td>
    <td class="hr">${hmHTML(grandFly)}</td>
  </tr>`;

  // Header — same shape as the page-end cumulative but trimmed/compact for
  // the per-month placement.
  const headerHTML = `
    <thead>
      <tr>
        <th rowspan="2" style="width:30mm">Aircraft</th>
        <th class="col-day" colspan="3">Day</th>
        <th class="col-night" colspan="3">Night</th>
        <th class="col-nvg" rowspan="2">NVG</th>
        <th rowspan="2">Sim</th>
        <th rowspan="2">WSO</th>
        <th rowspan="2">IMC</th>
        <th rowspan="2">SIF</th>
        <th rowspan="2">Instr D</th>
        <th rowspan="2">Instr N</th>
        <th rowspan="2" style="width:18mm">Total Flying</th>
      </tr>
      <tr>
        <th class="col-day">Dual</th>
        <th class="col-day">Pilot</th>
        <th class="col-day">CoP</th>
        <th class="col-night">Dual</th>
        <th class="col-night">Pilot</th>
        <th class="col-night">CoP</th>
      </tr>
    </thead>`;

  return `<div class="pr-mini-summary">
    <div class="pr-mini-title">${title}</div>
    <table class="pr-mini-table">
      ${headerHTML}
      <tbody>${rowsHTML}${grandRow}</tbody>
    </table>
  </div>`;
}

// Build the detail table for a single month
function _pdfMonthPage(monthKey, pageNum, totalPages, pilotName, acFilterId){
  const [mm, yy] = monthKey.split('_');
  const acs = getAC();
  const allEntries = getEntries();

  const inThisMonth = e => e.month === mm && String(e.year) === yy &&
                            (!acFilterId || e.acId === acFilterId);
  const upToThisMonth = e => {
    const k = e.month + '_' + e.year;
    return _monthKeyCmp(k, monthKey) <= 0 &&
           (!acFilterId || e.acId === acFilterId);
  };

  const monthEntries = allEntries.filter(inThisMonth)
    .sort((a,b) => parseInt(a.date,10) - parseInt(b.date,10));
  const runningEntries = allEntries.filter(upToThisMonth);

  // Two-row header — top row groups (DAY / NIGHT / NVG span sub-columns).
  // Explicit widths chosen to fit A4 landscape with 6mm side margins
  // (= 285mm usable). Text columns take 130mm; the 13 hour columns share
  // the remaining 155mm so each gets ~12mm — comfortable for "hh:mm".
  const headerHTML = `
    <thead>
      <tr>
        <th rowspan="2" style="width:5mm">#</th>
        <th rowspan="2" style="width:14mm">Date</th>
        <th rowspan="2" style="width:14mm">Aircraft</th>
        <th rowspan="2" style="width:24mm">Pilot</th>
        <th rowspan="2" style="width:24mm">Co-Pilot</th>
        <th rowspan="2" style="width:34mm">Exercise / Route</th>
        <th class="col-day" colspan="3">Day</th>
        <th class="col-night" colspan="3">Night</th>
        <th class="col-nvg" rowspan="2">NVG</th>
        <th rowspan="2">Sim</th>
        <th rowspan="2">WSO</th>
        <th rowspan="2">IMC</th>
        <th rowspan="2">SIF</th>
        <th rowspan="2">Instr D</th>
        <th rowspan="2">Instr N</th>
      </tr>
      <tr>
        <th class="col-day">Dual</th>
        <th class="col-day">Pilot</th>
        <th class="col-day">CoP</th>
        <th class="col-night">Dual</th>
        <th class="col-night">Pilot</th>
        <th class="col-night">CoP</th>
      </tr>
    </thead>`;

  // Empty-state
  if(monthEntries.length === 0 && runningEntries.length === 0){
    return `<div class="${pageNum>1?'pr-page-break':''}">
      ${_pdfPageHead(pilotName, pageNum, totalPages, `${mm} ${yy}`)}
      <div class="pr-month-banner">
        <span class="ttl">${mm} ${yy}</span>
        <span class="meta">No entries</span>
      </div>
      <div style="text-align:center;color:#888;font-style:italic;margin-top:20mm">
        No sorties logged for this month.
      </div>
      ${_pdfPageFoot()}
    </div>`;
  }

  // Per-month totals (PAGE TOTAL)
  const pageTot = _pdfSumRow(monthEntries, false, null);

  // Running total: include all aircraft's PE (or just the filtered one's PE)
  // plus every log entry up to and including this month.
  const runTot = {};
  _SUM_COLS.forEach(c => runTot[c.key] = 0);
  acs.filter(a => !acFilterId || a.id === acFilterId).forEach(ac => {
    _SUM_COLS.forEach(c => { runTot[c.key] += _sumCol(ac.data||{}, c); });
  });
  runningEntries.forEach(e => {
    _SUM_COLS.forEach(c => { runTot[c.key] += _sumCol(e, c); });
  });

  const rowsHTML = monthEntries.map((e, i) => _pdfDetailRow(e, i)).join('');

  // Per-aircraft monthly + cumulative breakdowns. These tables sit below the
  // detail table and let the reader see how flying hours distributed across
  // aircraft for this month alone and cumulatively. The cumulative one
  // restates lifetime totals through the end of THIS month so a single page
  // is fully self-contained.
  //
  // IMPORTANT: the cumulative summary always shows ALL aircraft the pilot has
  // ever flown — even when the PDF itself was generated for a single aircraft
  // (acFilterId set). That's because the cumulative table is a "career to
  // date" view, and a single-aircraft PDF should still let the reader see the
  // full lifetime breakdown across every type, with the filtered aircraft
  // visible in context. The MONTHLY summary above still respects acFilterId.
  const allAcRunningEntries = allEntries.filter(e => {
    const k = e.month + '_' + e.year;
    return _monthKeyCmp(k, monthKey) <= 0;
  });

  const monthlySummaryHTML  = _pdfPerAcSummary(monthEntries, acs, acFilterId, false,
                                                `${mm} ${yy} — Monthly Summary by Aircraft`);
  const cumulativeSummaryHTML = _pdfPerAcSummary(allAcRunningEntries, acs, null, true,
                                                `Cumulative Summary Through ${mm} ${yy} — All Aircraft (PE + all sorties)`);

  return `<div class="pr-pagewrap">
    ${_pdfPageHead(pilotName, pageNum, totalPages, `${mm} ${yy}`)}
    <div class="pr-month-banner">
      <span class="ttl">${mm} ${yy}</span>
      <span class="meta">${monthEntries.length} sortie${monthEntries.length===1?'':'s'}</span>
    </div>
    <table class="pr-detail">
      ${headerHTML}
      <tbody>
        ${rowsHTML}
        ${_pdfTotalsRow('subtotal', `PAGE TOTAL — ${mm} ${yy}`, pageTot)}
        ${_pdfTotalsRow('running', `RUNNING TOTAL — PE + all sorties through ${mm} ${yy}`, runTot)}
        ${_pdfDnnRow(runTot)}
        ${_pdfFlyingRow(runTot)}
      </tbody>
    </table>

    <div class="pr-sub-section">
      ${monthlySummaryHTML}
      ${cumulativeSummaryHTML}
    </div>

    <div class="pr-sig">
      <div class="pr-sig-cell"><span class="role">Pilot's Signature</span>${pilotName}</div>
      <div class="pr-sig-cell"><span class="role">Supervisor / Flt Cdr</span>&nbsp;</div>
      <div class="pr-sig-cell"><span class="role">Date</span>&nbsp;</div>
    </div>
    ${_pdfPageFoot()}
  </div>`;
}

// Page header — name + page number + meta. Same on every non-cover page.
function _pdfPageHead(pilotName, pageNum, totalPages, contextLine){
  return `<div class="pr-pagehead">
    <div class="pr-pagehead-left">
      LOGITTA <small>${contextLine}</small>
    </div>
    <div class="pr-pagehead-right">
      ${pilotName}<br>
      Page ${pageNum} of ${totalPages}
    </div>
  </div>`;
}

// Page footer with the colour legend.
function _pdfPageFoot(){
  return `<div class="pr-legend">
    <span><span class="sw" style="background:#1565c0"></span>Day</span>
    <span><span class="sw" style="background:#c0392b"></span>Night</span>
    <span><span class="sw" style="background:#1e8449"></span>NVG (within Night)</span>
  </div>`;
}

// Cumulative page — one row per aircraft, all-time totals (PE + every entry
// in range). Final row is the grand total across all aircraft.
function _pdfCumulativePage(fromKey, toKey, acFilterId, pageNum, totalPages, pilotName){
  const acs = getAC().filter(a => !acFilterId || a.id === acFilterId);
  const inRange = e => {
    const k = e.month + '_' + e.year;
    return _monthKeyCmp(fromKey, k) <= 0 && _monthKeyCmp(k, toKey) <= 0;
  };
  const entries = getEntries().filter(e => inRange(e) && (!acFilterId || e.acId === acFilterId));

  // Build the cumulative table — same width allocation as the detail table
  // for visual consistency (text col left, 13 hour cols + 1 total col share rest).
  const headerHTML = `
    <thead>
      <tr>
        <th rowspan="2" style="width:24mm">Aircraft</th>
        <th class="col-day" colspan="3">Day</th>
        <th class="col-night" colspan="3">Night</th>
        <th class="col-nvg" rowspan="2">NVG</th>
        <th rowspan="2">Sim</th>
        <th rowspan="2">WSO</th>
        <th rowspan="2">IMC</th>
        <th rowspan="2">SIF</th>
        <th rowspan="2">Instr D</th>
        <th rowspan="2">Instr N</th>
        <th rowspan="2" style="width:20mm">Total Flying</th>
      </tr>
      <tr>
        <th class="col-day">Dual</th>
        <th class="col-day">Pilot</th>
        <th class="col-day">CoP</th>
        <th class="col-night">Dual</th>
        <th class="col-night">Pilot</th>
        <th class="col-night">CoP</th>
      </tr>
    </thead>`;

  const grand = {};
  _SUM_COLS.forEach(c => grand[c.key] = 0);
  let grandFly = 0;
  const flyKeys = ['day_dual','day_pilot','day_copilot','night_dual','night_pilot','night_copilot'];

  const rowsHTML = acs.map(ac => {
    const acEnts = entries.filter(e => e.acId === ac.id);
    const r = {};
    _SUM_COLS.forEach(c => {
      r[c.key] = _sumCol(ac.data||{}, c) + acEnts.reduce((s,e)=>s+_sumCol(e,c), 0);
      grand[c.key] += r[c.key];
    });
    const fly = flyKeys.reduce((s,k)=>s+r[k], 0);
    grandFly += fly;
    const f = v => v > 0 ? hm(v) : '—';
    return `<tr>
      <td class="ac-name">${ac.name}</td>
      <td class="hr day">${f(r.day_dual)}</td>
      <td class="hr day">${f(r.day_pilot)}</td>
      <td class="hr day">${f(r.day_copilot)}</td>
      <td class="hr night">${f(r.night_dual)}</td>
      <td class="hr night">${f(r.night_pilot)}</td>
      <td class="hr night">${f(r.night_copilot)}</td>
      <td class="hr nvg">${f(r.nvg)}</td>
      <td class="hr">${f(r.simulator)}</td>
      <td class="hr">${f(r.wso)}</td>
      <td class="hr">${f(r.imc)}</td>
      <td class="hr">${f(r.sif)}</td>
      <td class="hr">${f(r.instr_day)}</td>
      <td class="hr">${f(r.instr_night)}</td>
      <td class="hr"><b>${hmHTML(fly)}</b></td>
    </tr>`;
  }).join('');

  const f = v => v > 0 ? hm(v) : '—';
  const grandRow = `<tr class="grand">
    <td class="ac-name">GRAND TOTAL</td>
    <td class="hr day">${f(grand.day_dual)}</td>
    <td class="hr day">${f(grand.day_pilot)}</td>
    <td class="hr day">${f(grand.day_copilot)}</td>
    <td class="hr night">${f(grand.night_dual)}</td>
    <td class="hr night">${f(grand.night_pilot)}</td>
    <td class="hr night">${f(grand.night_copilot)}</td>
    <td class="hr nvg">${f(grand.nvg)}</td>
    <td class="hr">${f(grand.simulator)}</td>
    <td class="hr">${f(grand.wso)}</td>
    <td class="hr">${f(grand.imc)}</td>
    <td class="hr">${f(grand.sif)}</td>
    <td class="hr">${f(grand.instr_day)}</td>
    <td class="hr">${f(grand.instr_night)}</td>
    <td class="hr">${hmHTML(grandFly)}</td>
  </tr>`;

  return `<div class="${pageNum>1?'pr-page-break':''}">
    ${_pdfPageHead(pilotName, pageNum, totalPages, 'Cumulative Summary')}
    <div class="pr-month-banner">
      <span class="ttl">CUMULATIVE SUMMARY</span>
      <span class="meta">${fromKey.replace('_',' ')} → ${toKey.replace('_',' ')}</span>
    </div>
    <table class="pr-cum">
      ${headerHTML}
      <tbody>
        ${rowsHTML}
        ${grandRow}
      </tbody>
    </table>
    <div style="margin-top:6mm;padding:3mm 5mm;background:#fdf6d8;border:0.5px solid #c9a84c;border-radius:1.5mm;font-family:'Share Tech Mono',monospace;font-size:9px;color:#5a4214;letter-spacing:.5px">
      <b>Accounting rules:</b>
      Total Flying = Day + Night (NVG counted within Night, not added separately).
      Total Pilot = day_pilot + night_pilot.
      Per-column totals = Prior Experience + all sorties in selected range.
    </div>
    ${_pdfPageFoot()}
  </div>`;
}

// Cover page — pilot identity + at-a-glance lifetime numbers.
function _pdfCoverPage(pilotName, unitLine, fromM, fromY, toM, toY, acScopeLabel, generatedOn, lifetimeTotals){
  return `<div class="pr-pagewrap"><div class="pr-cover">
    <div class="pr-cover-band">
      <div class="pr-cover-app">LOGITTA</div>
      <div class="pr-cover-tagline">Flying Logbook · Summary Report</div>
      <div class="pr-cover-pilot">${pilotName || 'PILOT'}</div>
      <div class="pr-cover-unit">${unitLine || ''}</div>
      <div class="pr-cover-period">
        <b>Period:</b> ${fromM} ${fromY} &nbsp;→&nbsp; ${toM} ${toY}
        &nbsp;·&nbsp; <b>Scope:</b> ${acScopeLabel}
      </div>
    </div>

    <div class="pr-glance">
      <div class="pr-glance-card day">
        <div class="lbl">Day</div>
        <div class="val">${hmHTML(lifetimeTotals.day)}</div>
        <div class="sub">Dual + Pilot + Co-P</div>
      </div>
      <div class="pr-glance-card night">
        <div class="lbl">Night</div>
        <div class="val">${hmHTML(lifetimeTotals.night)}</div>
        <div class="sub">Dual + Pilot + Co-P</div>
      </div>
      <div class="pr-glance-card nvg">
        <div class="lbl">NVG</div>
        <div class="val">${hmHTML(lifetimeTotals.nvg)}</div>
        <div class="sub">Within Night</div>
      </div>
      <div class="pr-glance-card">
        <div class="lbl">Total Flying</div>
        <div class="val">${hmHTML(lifetimeTotals.flying)}</div>
        <div class="sub">Day + Night</div>
      </div>
      <div class="pr-glance-card">
        <div class="lbl">Total Pilot</div>
        <div class="val">${hmHTML(lifetimeTotals.pilot)}</div>
        <div class="sub">D-Pilot + N-Pilot</div>
      </div>
    </div>

    <div class="pr-cover-foot">
      <span>Generated ${generatedOn}</span>
      <span>Developed by Samrat</span>
    </div>
  </div></div>`;
}

// ─── PDF Report modal open/close + dropdown population ───────────────────────
// These were referenced by index.html (Settings → "Generate PDF Report" button
// and the modal's close controls) but never defined — so tapping the button
// threw a ReferenceError and nothing happened. Defining them here is the core
// fix for "PDF button does nothing".
function openPdfReportModal(){
  try{
    const entries = getEntries();
    const acs = getAC();

    const now = new Date();
    const curM = MONTHS[now.getMonth()];
    const curY = now.getFullYear();

    // Year list: only years that ACTUALLY have entries (per user preference -
    // a contiguous range with empty years was confusing). The current year is
    // included as a fallback so the dropdown isn't empty for new users with
    // zero entries.
    //
    // BUGFIX: original implementation used `parseInt(e.year, 10)` to convert
    // each entry's year, but if `e.year` was already a number (legacy data
    // format) the cascade silently produced NaN-like behaviour and the year
    // got dropped from the Set. Result: a user with SEP 2025 entries would
    // only see 2026 in the dropdown. We now accept BOTH numeric and string
    // year values so every year that has at least one entry appears.
    const years = new Set([curY]);
    entries.forEach(e=>{
      const y = typeof e.year === 'number' ? e.year : parseInt(e.year, 10);
      if(y && !isNaN(y)) years.add(y);
    });
    const yearList = Array.from(years).sort((a,b)=>a-b);

    const monthOpts = MONTHS.map(m=>`<option value="${m}">${m}</option>`).join('');
    const yearOpts  = yearList.map(y=>`<option value="${y}">${y}</option>`).join('');

    const fromMonthSel = document.getElementById('pdfFromMonth');
    const fromYearSel  = document.getElementById('pdfFromYear');
    const toMonthSel   = document.getElementById('pdfToMonth');
    const toYearSel    = document.getElementById('pdfToYear');
    const acSel        = document.getElementById('pdfAircraft');

    if(fromMonthSel) fromMonthSel.innerHTML = monthOpts;
    if(toMonthSel)   toMonthSel.innerHTML   = monthOpts;
    if(fromYearSel)  fromYearSel.innerHTML  = yearOpts;
    if(toYearSel)    toYearSel.innerHTML    = yearOpts;

    let earliest = null, latest = null;
    entries.forEach(e=>{
      const mi = MONTHS.indexOf(e.month);
      const y  = parseInt(e.year, 10);
      if(mi < 0 || !y) return;
      const key = y * 12 + mi;
      if(earliest === null || key < earliest.key) earliest = {key, m:e.month, y};
      if(latest   === null || key > latest.key)   latest   = {key, m:e.month, y};
    });

    if(fromMonthSel && fromYearSel){
      fromMonthSel.value = earliest ? earliest.m : curM;
      fromYearSel.value  = String(earliest ? earliest.y : curY);
    }
    if(toMonthSel && toYearSel){
      toMonthSel.value = latest ? latest.m : curM;
      toYearSel.value  = String(latest ? latest.y : curY);
    }

    if(acSel){
      const acOpts = ['<option value="">All Aircraft</option>']
        .concat(acs.map(a=>`<option value="${a.id}">${a.name}</option>`))
        .join('');
      acSel.innerHTML = acOpts;
      acSel.value = '';
    }

    if(typeof GD !== 'undefined' && GD.upgradeAll) GD.upgradeAll();

    const modal = document.getElementById('pdfReportModal');
    if(modal) modal.classList.add('active');
  }catch(e){
    showToast('Could not open PDF options: ' + e.message, true, 4500);
  }
}

function closePdfReportModal(){
  const modal = document.getElementById('pdfReportModal');
  if(modal) modal.classList.remove('active');
}

function _pdfStandaloneDoc(bodyHTML){
  // Returns a COMPLETE, self-contained HTML document for printing.
  // ALL report styling is inlined here — no external stylesheet — so the
  // Android WebView print pass cannot be sabotaged by the app's @media
  // print rules (which were collapsing content to a blank/single page).
  const css = `
  @page { size: A4 landscape; margin: 7mm 8mm 12mm 8mm; }
  /* A4 landscape with narrow margins — chosen so the 19-column detail table
     fits comfortably without horizontal scroll. The @bottom-right page-number
     directive renders "Page X of Y" automatically on every page. The 6mm
     horizontal margins are the minimum that still print reliably across
     consumer printers; we use larger top/bottom margins because vertical
     space is less constrained than horizontal. */
  
  

  /* Force light-on-white regardless of the in-app theme. Drop the cockpit
     background entirely so the PDF prints cleanly and doesn't waste toner. */
  html,body{
    background:#fff !important;
    color:#0d1424 !important;
    margin:0 !important;
    padding:0 !important;
  }

  /* Hide everything by default; show only #printRoot. */
  
  
  #printRoot{
    background:#fff;color:#0d1424;
    font-family:'Rajdhani', 'Segoe UI', sans-serif;
    padding:0;margin:0;
  }

  /* ─── PAGE-BREAK PRIMITIVES ──────────────────────────────────────────── */
  .pr-page-break{ page-break-before:always; break-before:page; }
  .pr-no-break  { page-break-inside:avoid; break-inside:avoid; }

  /* ─── COVER PAGE ─────────────────────────────────────────────────────── */
  .pr-cover{
    page-break-after:always; break-after:page;
    display:flex;flex-direction:column;
    min-height:180mm;   /* fill page minus margins */
    padding:6mm 0;
  }
  .pr-cover-band{
    background:linear-gradient(135deg,#0a1428 0%,#1a2845 100%);
    color:#f4e4a8;
    padding:14mm 12mm;border-radius:3mm;
    margin-bottom:8mm;
  }
  .pr-cover-app{
    font-family:'Bebas Neue', 'Impact', sans-serif;
    font-size:44px;letter-spacing:6px;color:#f4e4a8;line-height:1;
  }
  .pr-cover-tagline{
    font-family:'Share Tech Mono', monospace;
    font-size:11px;letter-spacing:3px;color:#c9a84c;
    margin-top:2mm;text-transform:uppercase;
  }
  .pr-cover-pilot{
    font-family:'Bebas Neue', sans-serif;
    font-size:32px;letter-spacing:3px;color:#fff;
    margin-top:8mm;line-height:1.1;
  }
  .pr-cover-unit{
    font-family:'Share Tech Mono', monospace;
    font-size:13px;letter-spacing:2px;color:#c9a84c;
    margin-top:1mm;text-transform:uppercase;
  }
  .pr-cover-period{
    margin-top:8mm;padding-top:5mm;border-top:1px solid rgba(201,168,76,.4);
    font-family:'Rajdhani', sans-serif;font-size:15px;color:#e8d488;
    letter-spacing:1.5px;
  }
  .pr-cover-period b{color:#fff;font-weight:600}

  /* At-a-glance card grid */
  .pr-glance{
    display:grid;grid-template-columns:repeat(5, 1fr);gap:4mm;
    margin:0 4mm;
    /* Flex fallback for renderers without modern grid support */
    display:flex;flex-wrap:nowrap;
  }
  .pr-glance > *{flex:1 1 0;min-width:0}
  .pr-glance-card{
    border:1.5px solid #0d1424;border-radius:2mm;
    padding:5mm 4mm;text-align:center;
    background:#fdf6d8;
  }
  .pr-glance-card .lbl{
    font-family:'Share Tech Mono', monospace;
    font-size:9.5px;letter-spacing:2px;color:#7a5e1c;
    text-transform:uppercase;font-weight:700;
  }
  .pr-glance-card .val{
    font-family:'Bebas Neue', sans-serif;
    font-size:30px;letter-spacing:1.5px;color:#0d1424;
    margin-top:2mm;line-height:1;
  }
  .pr-glance-card .sub{
    font-family:'Share Tech Mono', monospace;
    font-size:8.5px;color:#6a7180;margin-top:1mm;
  }
  /* Specialised tints for the Day/Night/NVG glance cards */
  .pr-glance-card.day  { background:#e3eff9;border-color:#1565c0 }
  .pr-glance-card.day .val  { color:#1565c0 }
  .pr-glance-card.day .lbl  { color:#0d3a72 }
  .pr-glance-card.night{ background:#fbe6e3;border-color:#c0392b }
  .pr-glance-card.night .val{ color:#c0392b }
  .pr-glance-card.night .lbl{ color:#7a2419 }
  .pr-glance-card.nvg  { background:#e0f0e6;border-color:#1e8449 }
  .pr-glance-card.nvg .val  { color:#1e8449 }
  .pr-glance-card.nvg .lbl  { color:#0f5128 }

  .pr-cover-foot{
    margin-top:auto;
    border-top:1.5px solid #c9a84c;padding-top:4mm;margin-left:4mm;margin-right:4mm;
    display:flex;justify-content:space-between;
    font-family:'Share Tech Mono', monospace;
    font-size:9.5px;letter-spacing:1px;color:#6a7180;
  }

  /* ─── PER-PAGE HEADER (every non-cover page) ──────────────────────────── */
  .pr-pagehead{
    display:flex;justify-content:space-between;align-items:center;
    border-bottom:1.5px solid #0d1424;padding-bottom:2mm;margin-bottom:4mm;
  }
  .pr-pagehead-left{
    font-family:'Bebas Neue', sans-serif;font-size:18px;letter-spacing:3px;
    color:#0d1424;
  }
  .pr-pagehead-left small{
    font-family:'Share Tech Mono', monospace;font-size:8.5px;letter-spacing:1.5px;
    color:#7a5e1c;margin-left:4mm;
  }
  .pr-pagehead-right{
    font-family:'Share Tech Mono', monospace;font-size:9px;letter-spacing:1.2px;
    color:#5a6072;text-align:right;line-height:1.5;
  }

  /* ─── MONTH PAGE SECTION HEADER ───────────────────────────────────────── */
  .pr-month-banner{
    background:#0a1428;color:#f4e4a8;
    padding:3mm 5mm;margin:0 0 3mm 0;
    border-radius:1.5mm;
    display:flex;justify-content:space-between;align-items:center;
  }
  .pr-month-banner .ttl{
    font-family:'Bebas Neue', sans-serif;font-size:20px;letter-spacing:3px;
  }
  .pr-month-banner .meta{
    font-family:'Share Tech Mono', monospace;font-size:9.5px;letter-spacing:1.5px;
    color:#c9a84c;text-transform:uppercase;
  }

  /* ─── DETAIL TABLE (sortie-by-sortie) ─────────────────────────────────── */
  .pr-detail{
    width:100%;border-collapse:collapse;font-size:10.5px;
    table-layout:fixed;
  }
  .pr-detail thead tr:first-child th{
    background:#0a1428;color:#f4e4a8;
    font-family:'Share Tech Mono', monospace;font-size:10px;
    letter-spacing:.5px;text-transform:uppercase;font-weight:700;
    padding:2.4mm 0.8mm;border:0.5px solid #0a1428;
  }
  .pr-detail thead tr:nth-child(2) th{
    background:#f0e6c8;color:#5a4214;
    font-family:'Share Tech Mono', monospace;font-size:9px;
    letter-spacing:.3px;text-transform:uppercase;font-weight:700;
    padding:1.6mm 0.6mm;border:0.5px solid #b8a050;
  }
  .pr-detail thead th.col-day{background:#1565c0;color:#fff}
  .pr-detail thead th.col-night{background:#c0392b;color:#fff}
  .pr-detail thead th.col-nvg{background:#1e8449;color:#fff}
  .pr-detail tbody td{
    border:0.4px solid #99a0ad;
    padding:2.2mm 0.8mm;text-align:center;
    font-family:'Rajdhani', sans-serif;font-size:11px;
    color:#0d1424;
    vertical-align:middle;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  }
  /* Pilot / Co-Pilot / Aircraft cells: allow long names/numbers to wrap to a
     second line instead of being cut off with ellipsis. Words break only on
     spaces by default; word-break:break-word handles the rare case of a single
     long word that exceeds the column width (e.g. an unspaced callsign).
     !important is used to defeat the base td rule's white-space:nowrap +
     text-overflow:ellipsis + overflow:hidden which would otherwise win on
     some browsers due to property-level inheritance quirks. */
  .pr-detail tbody td.name,
  .pr-detail tbody td.acno,
  .pr-detail tbody td.left{
    white-space:normal !important;
    overflow:visible !important;
    text-overflow:clip !important;
    word-break:break-word !important;
    overflow-wrap:break-word !important;
    line-height:1.18;
    text-align:left;
    padding-left:1.6mm;
  }
  /* The narrow numeric-hour cells use the monospace font so columns line up */
  .pr-detail tbody td.hr{
    font-family:'Share Tech Mono', monospace;font-size:10.5px;
    padding:2.2mm 0.5mm;
  }
  .pr-detail tbody td.hr.day  { color:#1565c0 }
  .pr-detail tbody td.hr.night{ color:#c0392b }
  .pr-detail tbody td.hr.nvg  { color:#1e8449 }
  /* (Exercise/route .left styling is defined above with wrap support;
     no second .left rule needed here — would override word-break behavior.) */
  /* Zebra striping */
  .pr-detail tbody tr:nth-child(even) td{background:#fbf8ee}
  .pr-detail tbody tr:nth-child(odd)  td{background:#ffffff}
  /* ─── Row-wide ink colour coding ──────────────────────────────────────
     Each sortie row carries an ink-{type} class matching its entry-type ink.
     We layer two visual cues per row:
       • Left stripe (4-col-spans-wide via box-shadow inset on the first <td>)
       • Faint background tint across every cell (overrides zebra)
     Day-ink (BLUE):   inset blue stripe + cool tint
     Night-ink (RED):  red stripe + warm tint
     NVG-ink (GREEN):  green stripe + sage tint
     Black-ink (WSO):  graphite stripe + faint grey tint
     The tints are intentionally muted (~6% saturation) so the row reads
     as ink-coded but the data columns still dominate the visual hierarchy. */
  .pr-detail tbody tr.ink-black > td{
    background:#e9ebef !important;
  }
  .pr-detail tbody tr.ink-black > td:first-child{
    box-shadow:inset 3px 0 0 #4a5468;
  }
  .pr-detail tbody tr.ink-blue > td{
    background:#eaf2fa !important;
  }
  .pr-detail tbody tr.ink-blue > td:first-child{
    box-shadow:inset 3px 0 0 #1565c0;
  }
  .pr-detail tbody tr.ink-red > td{
    background:#fbeae8 !important;
  }
  .pr-detail tbody tr.ink-red > td:first-child{
    box-shadow:inset 3px 0 0 #c0392b;
  }
  .pr-detail tbody tr.ink-nvg > td{
    background:#e7f1ea !important;
  }
  .pr-detail tbody tr.ink-nvg > td:first-child{
    box-shadow:inset 3px 0 0 #1e8449;
  }
  /* Override for the summary/total rows — they have their own stronger
     backgrounds and shouldn't pick up the per-row ink tint. */
  .pr-detail tr.subtotal.ink-black > td,
  .pr-detail tr.subtotal.ink-blue > td,
  .pr-detail tr.subtotal.ink-red > td,
  .pr-detail tr.subtotal.ink-nvg > td,
  .pr-detail tr.running.ink-black > td,
  .pr-detail tr.running.ink-blue > td,
  .pr-detail tr.running.ink-red > td,
  .pr-detail tr.running.ink-nvg > td{
    background:inherit !important;
  }
  /* Subtotal / summary rows */
  .pr-detail tr.subtotal td{
    background:#fdf6d8 !important;
    border-top:1.2px solid #0d1424;
    font-family:'Share Tech Mono', monospace;font-weight:700;
    font-size:8.5px;letter-spacing:.3px;
    color:#5a4214;
  }
  .pr-detail tr.subtotal td.hr.day  { color:#0d3a72 }
  .pr-detail tr.subtotal td.hr.night{ color:#7a2419 }
  .pr-detail tr.subtotal td.hr.nvg  { color:#0f5128 }
  .pr-detail tr.running td{
    background:#f4e4a8 !important;
    border-top:1.5px solid #0d1424;
    font-weight:800;
  }
  .pr-detail tr.dnn td{
    background:#0a1428 !important;color:#f4e4a8 !important;
    font-family:'Share Tech Mono', monospace;font-weight:700;
    letter-spacing:.5px;font-size:8.5px;
  }
  .pr-detail tr.dnn td.hr.day  { color:#7eb3eb !important }
  .pr-detail tr.dnn td.hr.night{ color:#ed8278 !important }
  .pr-detail tr.dnn td.hr.nvg  { color:#7cd0a0 !important }
  .pr-detail tr.flying td{
    background:#c9a84c !important;color:#0d1424 !important;
    font-family:'Bebas Neue', sans-serif;font-size:13px;letter-spacing:1.5px;
    border-top:2px solid #0d1424;font-weight:700;
  }

  /* (td.name styling consolidated above with the wrap rules — no separate
     rule needed here.) */

  /* ─── PER-MONTH MINI-SUMMARY (Monthly + Cumulative) ────────────────────
     Two compact aircraft-breakdown tables that sit below the detail table
     on every month page, before the signature block. Styled smaller than
     the page-end cumulative table so they read as supplementary info, not
     a competing main table. Sit side-by-side on wide pages, stack on narrow. */
  .pr-sub-section{
    /* Stacked vertically, each full-width (was side-by-side 1fr 1fr).
       The user wants: log table, then monthly summary full-width below it,
       then cumulative summary full-width below that — all the same horizontal
       size as the log table. */
    display:block;
    margin-top:4mm;
  }
  .pr-mini-summary{
    break-inside:avoid;page-break-inside:avoid;
    margin-bottom:4mm;
  }
  .pr-mini-summary:last-child{ margin-bottom:0; }
  .pr-mini-title{
    background:#1a2845;color:#f4e4a8;
    font-family:'Share Tech Mono', monospace;font-size:10px;letter-spacing:1px;
    padding:2mm 3mm;border-radius:1mm 1mm 0 0;
    text-transform:uppercase;font-weight:700;
  }
  .pr-mini-table{
    width:100%;border-collapse:collapse;font-size:10px;
    table-layout:fixed;
  }
  .pr-mini-table thead tr:first-child th{
    background:#3a4868;color:#f4e4a8;
    font-family:'Share Tech Mono', monospace;font-size:9px;letter-spacing:.3px;
    text-transform:uppercase;font-weight:700;
    padding:1.6mm 0.6mm;border:0.4px solid #2a3858;
  }
  .pr-mini-table thead tr:nth-child(2) th{
    background:#e8dab8;color:#5a4214;
    font-family:'Share Tech Mono', monospace;font-size:8px;letter-spacing:.2px;
    text-transform:uppercase;font-weight:700;
    padding:1.2mm 0.5mm;border:0.4px solid #b8a050;
  }
  .pr-mini-table thead th.col-day{background:#1565c0;color:#fff}
  .pr-mini-table thead th.col-night{background:#c0392b;color:#fff}
  .pr-mini-table thead th.col-nvg{background:#1e8449;color:#fff}
  .pr-mini-table tbody td{
    border:0.3px solid #99a0ad;padding:1.6mm 0.6mm;
    font-family:'Rajdhani', sans-serif;font-size:10.5px;text-align:center;
    color:#0d1424;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  }
  .pr-mini-table tbody td.hr{font-family:'Share Tech Mono', monospace;font-size:10px;padding:1.6mm 0.5mm}
  .pr-mini-table tbody td.hr.day  {color:#1565c0}
  .pr-mini-table tbody td.hr.night{color:#c0392b}
  .pr-mini-table tbody td.hr.nvg  {color:#1e8449}
  .pr-mini-table tbody td.ac-name{text-align:left;padding-left:1.2mm;font-weight:700}
  .pr-mini-table tbody tr.grand td{
    background:#c9a84c !important;color:#0d1424 !important;
    font-family:'Bebas Neue', sans-serif;font-size:11px;letter-spacing:1px;
    border-top:1.2px solid #0d1424;font-weight:700;
  }
  .pr-mini-table tbody tr.grand td.ac-name{
    font-size:9.5px;letter-spacing:.4px;padding:1mm 1mm;white-space:nowrap;overflow:visible;
  }
  .pr-mini-table tbody tr.grand td.hr.day  { color:#0d3a72 !important }
  .pr-mini-table tbody tr.grand td.hr.night{ color:#7a2419 !important }
  .pr-mini-table tbody tr.grand td.hr.nvg  { color:#0f5128 !important }

  /* ─── SIGNATURE BLOCK ──────────────────────────────────────────────── */
  .pr-sig{
    margin-top:6mm;display:grid;grid-template-columns:repeat(3, 1fr);gap:8mm;
  }
  .pr-sig-cell{
    border-top:1px solid #0d1424;padding-top:1.5mm;
    font-family:'Share Tech Mono', monospace;font-size:8.5px;
    letter-spacing:1.2px;color:#5a6072;text-transform:uppercase;
  }
  .pr-sig-cell .role{color:#0d1424;font-weight:700;margin-bottom:8mm;display:block}

  /* ─── CUMULATIVE SUMMARY TABLE (final page) ───────────────────────────── */
  .pr-cum{
    width:100%;border-collapse:collapse;font-size:9.5px;
    margin-top:2mm;
    table-layout:fixed;
  }
  .pr-cum thead tr:first-child th{
    background:#0a1428;color:#f4e4a8;
    font-family:'Share Tech Mono', monospace;font-size:8.5px;letter-spacing:.6px;
    text-transform:uppercase;font-weight:700;padding:1.8mm 0.6mm;
    border:0.5px solid #0a1428;
  }
  .pr-cum thead tr:nth-child(2) th{
    background:#f0e6c8;color:#5a4214;
    font-family:'Share Tech Mono', monospace;font-size:7.5px;letter-spacing:.3px;
    text-transform:uppercase;font-weight:700;padding:1.2mm 0.5mm;
    border:0.4px solid #b8a050;
  }
  .pr-cum thead th.col-day{background:#1565c0;color:#fff}
  .pr-cum thead th.col-night{background:#c0392b;color:#fff}
  .pr-cum thead th.col-nvg{background:#1e8449;color:#fff}
  .pr-cum tbody td{
    border:0.4px solid #99a0ad;padding:1.6mm 0.6mm;
    font-family:'Rajdhani', sans-serif;font-size:10px;text-align:center;
    color:#0d1424;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  }
  .pr-cum tbody td.hr{font-family:'Share Tech Mono', monospace;font-size:9.5px;padding:1.6mm 0.4mm}
  .pr-cum tbody td.hr.day  {color:#1565c0}
  .pr-cum tbody td.hr.night{color:#c0392b}
  .pr-cum tbody td.hr.nvg  {color:#1e8449}
  .pr-cum tbody td.ac-name{text-align:left;padding-left:3mm;font-weight:700}
  .pr-cum tbody tr.grand td{
    background:#c9a84c !important;color:#0d1424 !important;
    font-family:'Bebas Neue', sans-serif;font-size:13px;letter-spacing:1.2px;
    border-top:2px solid #0d1424;font-weight:700;
  }
  /* The grand-total label cell needs to not ellipsise — it sits in the same
     24mm-wide Aircraft column as the aircraft rows but with display font.
     Allow it to wrap if needed; "GRAND TOTAL" fits on one line at this width. */
  .pr-cum tbody tr.grand td.ac-name{
    white-space:nowrap;overflow:visible;
    font-size:11px;letter-spacing:.8px;
    padding:1.6mm 1mm;
  }
  .pr-cum tbody tr.grand td.hr.day  { color:#0d3a72 !important }
  .pr-cum tbody tr.grand td.hr.night{ color:#7a2419 !important }
  .pr-cum tbody tr.grand td.hr.nvg  { color:#0f5128 !important }

  /* ─── LEGEND (used on each page footer) ──────────────────────────────── */
  .pr-legend{
    display:flex;gap:6mm;
    font-family:'Share Tech Mono', monospace;font-size:8.5px;letter-spacing:.8px;
    color:#5a6072;
    margin-top:3mm;
    justify-content:flex-end;
  }
  .pr-legend .sw{
    display:inline-block;width:3mm;height:3mm;margin-right:1.5mm;
    vertical-align:middle;border:0.5px solid #555;
  }

  /* ─── PAGE FOOTER (identifier strip on every month page) ──────────────── */
  .pr-pagefoot{
    border-top:0.5px solid #99a0ad;padding-top:1.5mm;margin-top:3mm;
    display:flex;justify-content:space-between;
    font-family:'Share Tech Mono', monospace;font-size:8px;letter-spacing:.8px;
    color:#7a7a7a;
  }

/* ═══ BULLETPROOF PAGINATION (self-contained, no external deps) ═══ */
html, body { margin:0 !important; padding:0 !important; background:#fff !important; }
#printRoot { display:block !important; background:#fff; }
#printRoot, #printRoot * { visibility:visible !important; }
/* Each top-level section is one logical page. We rely on @page (above) to set
   the physical sheet size and page-break-after to push each section onto a new
   sheet. We do NOT clip with a fixed height — a busy month (many sorties) can
   legitimately need more than one sheet, and clipping would lose rows. A short
   month simply leaves the rest of its sheet blank, which is correct. */
#printRoot > .pr-pagewrap {
  box-sizing: border-box;
  page-break-after: always;
  break-after: page;
  /* Allow internal breaks if a single month overflows one sheet, but prefer
     keeping tables intact row-by-row (the .pr-detail tr rule handles rows). */
}
#printRoot > .pr-pagewrap:last-child {
  page-break-after: auto;
  break-after: auto;
}
/* Keep detail-table rows from splitting across a page boundary. */
.pr-detail tr { page-break-inside: avoid; break-inside: avoid; }
`;
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + css + '</style></head><body>' +
    '<div id="printRoot">' + bodyHTML + '</div></body></html>';
}

// ─── Main entry point — called from the Generate PDF Report modal ───
function generatePdfReport(){
 try{
  const fromM = document.getElementById('pdfFromMonth').value;
  const fromY = document.getElementById('pdfFromYear').value;
  const toM   = document.getElementById('pdfToMonth').value;
  const toY   = document.getElementById('pdfToYear').value;
  const acId  = document.getElementById('pdfAircraft').value;

  const fromKey = fromM + '_' + fromY;
  const toKey   = toM   + '_' + toY;

  if(_monthKeyCmp(fromKey, toKey) > 0){
    showToast('From month must be on or before To month', true, 4000);
    return;
  }

  // Build the list of months in range
  const months = [];
  let cur = fromKey;
  let safety = 0;
  while(_monthKeyCmp(cur, toKey) <= 0 && safety < 240){
    months.push(cur);
    const [cm, cy] = cur.split('_');
    let mi = MONTHS.indexOf(cm); let yr = parseInt(cy, 10);
    mi++; if(mi >= 12){ mi = 0; yr++; }
    cur = MONTHS[mi] + '_' + yr;
    safety++;
  }

  const acs = getAC();
  const acFilterAc = acId ? acs.find(a => a.id === acId) : null;
  const acScopeLabel = acFilterAc ? acFilterAc.name : 'All Aircraft';

  const sett = getSettings();
  const pilotName = sett.name || '—';
  const unitLine  = sett.unit || '';
  const now = new Date();
  const generatedOn = `${String(now.getDate()).padStart(2,'0')} ${MONTHS[now.getMonth()]} ${now.getFullYear()} · ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // Lifetime totals for the cover-page glance cards. We compute these from
  // PE + every entry up to and including the chosen "To" month (so the
  // cover reflects what the report actually covers, not the user's total
  // career which might extend beyond the chosen range).
  const inRange = e => {
    const k = e.month + '_' + e.year;
    return _monthKeyCmp(k, toKey) <= 0 && (!acId || e.acId === acId);
  };
  const filteredEnts = getEntries().filter(inRange);
  const filteredAcs = acs.filter(a => !acId || a.id === acId);
  const lifetime = { day:0, night:0, nvg:0, pilot:0, flying:0 };
  filteredAcs.forEach(ac => {
    const d = ac.data || {};
    lifetime.day   += (d.day_dual||0)+(d.day_pilot||0)+(d.day_copilot||0);
    lifetime.night += (d.night_dual||0)+(d.night_pilot||0)+(d.night_copilot||0);
    lifetime.nvg   += (d.nvg || ((d.nvg_dual||0)+(d.nvg_pilot||0)+(d.nvg_copilot||0)));
    lifetime.pilot += (d.day_pilot||0)+(d.night_pilot||0);
  });
  filteredEnts.forEach(e => {
    lifetime.day   += (e.day_dual||0)+(e.day_pilot||0)+(e.day_copilot||0);
    lifetime.night += (e.night_dual||0)+(e.night_pilot||0)+(e.night_copilot||0);
    lifetime.nvg   += (e.nvg||0);
    lifetime.pilot += (e.day_pilot||0)+(e.night_pilot||0);
  });
  lifetime.flying = lifetime.day + lifetime.night;   // NVG not added

  // Page counting: cover(1) + month pages + cumulative(1)
  // Page count: cover(1) + one page per month. The separate end-of-report
  // cumulative page was removed per user request — every month page already
  // carries its own monthly + cumulative-through-that-month summary below the
  // log table, so a final standalone cumulative page is redundant.
  const totalPages = 1 + months.length;
  let pageNum = 1;

  // Build pages
  const coverHTML = _pdfCoverPage(pilotName, unitLine, fromM, fromY, toM, toY,
                                   acScopeLabel, generatedOn, lifetime);
  pageNum++;
  const monthPagesHTML = months.map(mk => {
    const html = _pdfMonthPage(mk, pageNum, totalPages, pilotName, acId);
    pageNum++;
    return html;
  }).join('');

  const printHTML = coverHTML + monthPagesHTML;

  let root = document.getElementById('printRoot');
  if(!root){
    root = document.createElement('div');
    root.id = 'printRoot';
    document.body.appendChild(root);
  }
  root.innerHTML = printHTML;

  // Build a COMPLETE, self-contained print document with ALL styles inlined.
  // This is the bulletproof path: no external stylesheet for the print WebView
  // to load (or fail to load), and no @media print rules from the app's CSS to
  // collapse the content. Passed whole to the native bridge.
  const standaloneDoc = _pdfStandaloneDoc(printHTML);

  closePdfReportModal();

  const fileName = `Logitta_${pilotName.replace(/\s+/g,'_')}_${fromM}${fromY}-${toM}${toY}`;
  const prevTitle = document.title;
  document.title = fileName;

  // PDF download strategy — try the most native/reliable path first, fall back.
  //
  // 1) Android native bridge: if the host app exposes printPdf/savePdf/sharePdf,
  //    hand the print HTML over and let the OS render and save it. This is the
  //    only path that works inside an embedded WebView where window.print() is
  //    a no-op.
  // 2) Browser window.print(): works in Chrome/Safari/Firefox standalone or
  //    when launched as a PWA. User picks "Save as PDF" in the print dialog.
  // 3) Last-resort blob fallback: build a standalone HTML document containing
  //    the print HTML inline (so it can be opened with the print stylesheet
  //    applied) and open it in a new tab. The user manually picks print → PDF.
  //    This catches the case where window.print() silently fails.
  setTimeout(()=>{
    // ── PDF dispatch ──────────────────────────────────────────────────
    // The report HTML is now in #printRoot and @media print CSS hides
    // everything else. We need to trigger Android's print system.
    //
    // Strategy: call the native bridge's print method DIRECTLY rather than
    // relying on the window.print() shim, because the shim depends on the
    // shim having installed correctly during onPageFinished (timing-fragile).
    // The bridge object (LogittaAndroid / Android) exposes printPage(jobName),
    // print(jobName), and savePdf(jobName) — all of which call PrintManager
    // with the live WebView's print adapter. We try them in order.
    const bridge = window.LogittaAndroid || window.Android || null;
    let dispatched = false;

    if(bridge){
      // Prefer printPdf(jobName, html) — the upgraded Kotlin bridge renders the
      // supplied report HTML in a dedicated off-screen WebView (most reliable).
      // Fall back to printPage/print/savePdf(jobName) which print the live
      // WebView using @media print CSS (works if the dedicated path isn't
      // available, e.g. an older APK build).
      if(typeof bridge.printPdf === 'function'){
        try{
          bridge.printPdf(fileName, standaloneDoc);
          dispatched = true;
          showToast('Opening print dialog…');
        }catch(e){ console.warn('printPdf failed:', e); }
      }
      if(!dispatched){
        for(const method of ['printPage', 'print', 'savePdf']){
          if(typeof bridge[method] === 'function'){
            try{
              bridge[method](fileName);
              dispatched = true;
              showToast('Opening print dialog…');
              break;
            }catch(e){
              console.warn('Logitta print bridge failed:', method, e);
            }
          }
        }
      }
    }

    // If no native bridge method worked, try the standard window.print()
    // (works in browser / PWA, and also catches the Kotlin shim if the
    // bridge object wasn't directly enumerable for some reason).
    if(!dispatched){
      try{
        window.print();
        dispatched = true;
        showToast('Opening print dialog…');
      }catch(e){
        console.warn('window.print() failed:', e);
      }
    }

    // Last-resort fallback — open the printable HTML as a standalone document
    // in a new tab so the user can print from there. Only runs if neither the
    // bridge nor window.print() dispatched.
    if(!dispatched){
      try{
        const stylesHtml = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
          .map(n => n.outerHTML).join('\n');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${fileName}</title>${stylesHtml}<style>body{margin:0}@media screen{#printRoot{display:block!important}}</style></head><body><div id="printRoot">${root.innerHTML}</div><script>setTimeout(()=>window.print(),400)<\/script></body></html>`;
        const blob = new Blob([html], {type:'text/html'});
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank');
        if(!w){
          const a = document.createElement('a');
          a.href = url; a.download = fileName + '.html'; a.click();
          showToast('PDF preview downloaded as HTML — open it and print to PDF');
        } else {
          showToast('PDF report opened in new tab — tap Print');
        }
      }catch(e){
        console.warn('PDF fallback failed:', e);
        showToast('Could not generate PDF. Check Print service is enabled.', true, 5000);
      }
    }

    document.title = prevTitle;
  }, 250);
 }catch(err){
   // Surface ANY error in generatePdfReport as a toast instead of failing
   // silently. This is what makes "nothing happens" diagnosable — if the
   // function throws while building the report (bad date, missing element,
   // etc), the user now sees the reason instead of a dead button.
   showToast('PDF error: ' + (err && err.message ? err.message : err), true, 5000);
   console.error('generatePdfReport failed:', err);
 }
}
function _onSumMonthYearChange(){
  const m = document.getElementById('sumMonthSel')?.value;
  const y = document.getElementById('sumYearSel')?.value;
  if(m && y) _sumSelMonth = m + '_' + y;
  renderSummary();
}

// ════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════
function showToast(msg, isErr=false, duration=2200){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast'+(isErr?' err':'');
  t.classList.add('on');
  clearTimeout(t._tid);
  t._tid=setTimeout(()=>t.classList.remove('on'), duration);
  // Error toasts get the "no/blocked" haptic. Centralising it here covers
  // every validation-failure call site (showToast(msg, true)) in one safe
  // place, rather than editing each individually. Non-error toasts get no
  // haptic from here — success/confirm haptics are fired explicitly at
  // their own action sites so they're not duplicated.
  if(isErr) haptic('error');
}




// ════════════════════════════════════════════════════
// EDIT LOG ENTRY — loads entry into the log entry form
// ════════════════════════════════════════════════════
let _editingEntryId = null;

// ════════════════════════════════════════════════════════════════════════════
// DELETE LOG ENTRY (item 1)
// Two-step confirmation: native confirm() popup with the entry's key details so
// the user knows exactly which sortie they're about to remove. On confirm,
// removes from localStorage and re-renders the logbook so the row vanishes
// immediately. Toast confirms the action.
// ════════════════════════════════════════════════════════════════════════════
// Pending log-entry deletion — id stashed while the themed confirm popup
// is open; consumed by doLogDelete() when the user confirms.
let _pendingLogDeleteId = null;

function deleteLogEntry(entryId){
  const entries = getEntries();
  const e = entries.find(x=>x.id===entryId);
  if(!e){ showToast('Entry not found', true); return; }

  // Build the sortie identity block shown inside the themed popup — date,
  // aircraft (+ tail number) and route, each on its own line so the user
  // can verify EXACTLY which sortie is about to be deleted. This replaces
  // the native confirm() dialog, which rendered as an unthemed system
  // alert ("The page at file:// says…") completely outside the app's
  // visual language.
  const dateLine = `${e.date||''} ${e.month||''} ${e.year||''}`.trim();
  const acLine   = `${e.acName||e.acId||''}${e.acno ? ' · ' + e.acno : ''}`.trim();
  const rtLine   = (e.route||'').trim();
  const descrEl = document.getElementById('logDeleteDescr');
  if(descrEl){
    descrEl.innerHTML = `
      ${dateLine ? `<div class="log-del-line"><span class="log-del-lbl">Date</span><span class="log-del-val">${_escHtml(dateLine)}</span></div>` : ''}
      ${acLine   ? `<div class="log-del-line"><span class="log-del-lbl">Aircraft</span><span class="log-del-val">${_escHtml(acLine)}</span></div>` : ''}
      ${rtLine   ? `<div class="log-del-line"><span class="log-del-lbl">Route</span><span class="log-del-val">${_escHtml(rtLine)}</span></div>` : ''}
    `;
  }
  _pendingLogDeleteId = entryId;
  document.getElementById('logDeletePopup').classList.add('active');
}
function closeLogDeletePopup(){
  document.getElementById('logDeletePopup').classList.remove('active');
  _pendingLogDeleteId = null;
}
function doLogDelete(){
  const entryId = _pendingLogDeleteId;
  document.getElementById('logDeletePopup').classList.remove('active');
  _pendingLogDeleteId = null;
  if(!entryId) return;
  haptic('destructive');

  // Remove from the entries array and write back. The id is the unique key
  // (timestamp-based) so we filter on that, not on array position.
  const filtered = getEntries().filter(x=>x.id!==entryId);
  setEntries(filtered);

  // Re-render the logbook so the row vanishes immediately. We stay on the
  // logbook screen — no navigation needed.
  renderLogbook();
  showToast('Entry deleted');
}

function editLogEntry(entryId){
  const entries = getEntries();
  const e = entries.find(x=>x.id===entryId);
  if(!e){ showToast('Entry not found', true); return; }

  _editingEntryId = entryId;
  go('entry');

  // Defer field population until after initEntry has run
  setTimeout(()=>{
    document.getElementById('f_month').value     = e.month||'';
    document.getElementById('f_year').value      = e.year||String(new Date().getFullYear());
    document.getElementById('f_date').value      = e.date||'';
    // Aircraft type is locked, but for edit-mode we show the entry's *original* aircraft
    // rather than the currently-active one — otherwise the user couldn't see what aircraft
    // the entry was recorded against. The field stays disabled either way.
    const acSel = document.getElementById('f_actype');
    const acs = getAC();
    const origAc = acs.find(a=>a.id === e.acId);
    if(origAc){
      acSel.innerHTML = `<option value="${origAc.id}">${origAc.name}</option>`;
      acSel.value = origAc.id;
    } else if(e.acName){
      // Aircraft has been deleted from Prior Experience — still show its name (read-only)
      acSel.innerHTML = `<option value="${e.acId||''}">${e.acName} (deleted)</option>`;
      acSel.value = e.acId||'';
    }
    document.getElementById('f_acno').value      = e.acno||'';
    document.getElementById('f_pilot').value     = e.pilot||'';
    document.getElementById('f_copilot').value   = e.copilot||'';
    document.getElementById('f_route').value     = e.route||'';
    document.getElementById('f_entrytype').value = e.entryType||'black';
    onEntryTypeChange();

    // Hours — drive every field from LOG_HOUR_FIELDS (single source of truth).
    // IMC/SIF: combine legacy imc_day+imc_night / sif_day+sif_night with the current single field.
    LOG_HOUR_FIELDS.forEach(f=>{
      let mins;
      if(f.key === 'imc')      mins = (e.imc||0) + (e.imc_day||0) + (e.imc_night||0);
      else if(f.key === 'sif') mins = (e.sif||0) + (e.sif_day||0) + (e.sif_night||0);
      else                     mins = e[f.key] || 0;
      setHM(f.idH, f.idM, mins);
    });

    showToast('Editing entry — make changes & save', false, 2800);

    // Change the save button label to indicate edit mode
    const saveBtn = document.querySelector('.entry-action-bar .confirm-btn');
    if(saveBtn) saveBtn.textContent = '✓ SAVE CHANGES';
  }, 80);
}


// ════════════════════════════════════════════════════
// EXPORT / IMPORT / SHARE
// ════════════════════════════════════════════════════
let _pendingImportData = null;
let _pendingEntry = null;

// ── EXPORT — opens picker first ──
// Builds the backup filename as: "<Pilot Name> <YYYY-MM-DD> Logitta Backup.json"
// so files sort sensibly and are easy to identify. The name comes from
// Settings; characters unsafe for filenames are stripped, and it falls back to
// a sensible default if no name is set.
function _backupFileName(){
  const stamp = new Date().toISOString().slice(0,10);   // YYYY-MM-DD
  let name = (getSettings().name || '').trim();
  // Strip characters that are problematic in filenames; collapse whitespace.
  name = name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  if(!name) name = 'Pilot';
  return `${name} ${stamp} Logitta Backup.json`;
}

function exportBackup(){
  closeSettings();
  const name = _backupFileName();
  document.getElementById('exportFileName').textContent = name;
  // Reset modal to its fresh state — restore the option buttons & info,
  // remove any leftover fallback textarea from a previous open.
  const card = document.querySelector('#exportModal .picker-card');
  if(card){
    card.querySelectorAll('.save-opt').forEach(b=>{ b.style.display=''; });
    const info = card.querySelector('#exportFileInfo');
    if(info) info.style.display='';
    const fb = card.querySelector('.jsonFallbackBox');
    if(fb) fb.remove();
  }
  document.getElementById('exportModal').classList.add('active');
}
function closeExportModal(){ document.getElementById('exportModal').classList.remove('active'); }

function _buildBackupBlob(){
  const data = {
    app:'Logitta', version:1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    aircraft: getAC(),
    entries: getEntries(),
    nameSuggestions: getNames(),
    acnoSuggestions: getAcnos(),
  };
  const json = JSON.stringify(data, null, 2);
  return { json, blob: new Blob([json], {type:'application/json'}) };
}

function _nativeBridge(){
  return window.LogittaAndroid || window.Android || null;
}

function _callNative(names, ...args){
  const bridge = _nativeBridge();
  if(!bridge) return false;
  for(const name of names){
    if(typeof bridge[name] === 'function'){
      try{
        bridge[name](...args);
        return true;
      }catch(e){
        console.warn('Logitta Android bridge failed:', name, e);
      }
    }
  }
  return false;
}


function _openExternalUrl(url, toast){
  if(_callNative(['openUrl','openExternalUrl','launchUrl'], url)){
    if(toast) showToast(toast);
    return true;
  }
  window.location.href = url;
  if(toast) showToast(toast);
  return true;
}

function _shareTextNative(title, text){
  return _callNative(['shareText','share'], title, text);
}

function _downloadJsonNative(name, json){
  return _callNative(['downloadJson','saveJson','downloadFile'], name, json);
}

function _copyTextNative(text){
  return _callNative(['copyText','copyToClipboard','copy'], text);
}

function exportVia(method){
  const name = _backupFileName();
  const { json, blob } = _buildBackupBlob();

  if(method === 'share'){
    if(_callNative(['shareJson','shareFile'], name, json) || _shareTextNative('Logitta Backup', json)){
      closeExportModal();
      showToast('Shared');
      return;
    }
    // Try modern Web Share API with file attachment first. This works on:
    //   - Mobile Chrome on HTTPS pages
    //   - Some recent Android WebViews when the host configures secure context
    // In a stock Android WebView loading file://, this typically fails and we fall
    // through to the inline-JSON-textarea fallback so the user is NEVER stuck.
    if(navigator.canShare && typeof File !== 'undefined'){
      try {
        const file = new File([blob], name, {type:'application/json'});
        if(navigator.canShare({files:[file]})){
          navigator.share({files:[file], title:'Logitta Backup', text:'Flying log backup'})
            .then(()=>{ closeExportModal(); showToast('Shared ✓'); })
            .catch(err=>{ if(err.name!=='AbortError'){ _showJsonFallback(json); } });
          return;
        }
      } catch(e){ /* fall through */ }
    }
    if(navigator.share){
      // Older Share API — title+text only, no file. Try, but fall back to JSON.
      navigator.share({title:'Logitta Backup', text:json.slice(0,2000)})
        .then(()=>{ closeExportModal(); showToast('Shared ✓'); })
        .catch(err=>{ if(err.name!=='AbortError'){ _showJsonFallback(json); } });
      return;
    }
    // No share API at all (WebView typical) — show the JSON inline.
    _showJsonFallback(json);
  }
  else if(method === 'download'){
    if(_downloadJsonNative(name, json)){
      closeExportModal();
      showToast('Download saved');
      return;
    }
    // <a download> trick. Works in browsers; in Android WebView this requires the
    // host Activity to wire up a DownloadListener. If your Activity doesn't have
    // one (most don't), this is a silent no-op — so we ALSO show the JSON inline as
    // a safety net. The Toast tells the user where to look.
    _downloadFile(blob, name);
    // After a moment, also surface the JSON so they always have a way out.
    setTimeout(()=>{
      _showJsonFallback(json, /*afterDownload*/ true);
    }, 600);
  }
  else if(method === 'copy'){
    closeExportModal();
    _copyToClipboard(json);
  }
}

// Render the backup JSON inside the export modal as a copyable textarea. This is
// the universal fallback when the native share / download paths don't work — e.g.
// in an Android WebView with no DownloadListener and no secure-context share.
function _showJsonFallback(json, afterDownload){
  const card = document.querySelector('#exportModal .picker-card');
  if(!card) return;
  // Hide the option buttons, show the textarea + copy button.
  card.querySelectorAll('.save-opt').forEach(b=>b.style.display='none');
  const info = card.querySelector('#exportFileInfo');
  if(info) info.style.display='none';

  // Render the textarea ONCE (idempotent — calling again just re-renders content).
  let fb = card.querySelector('.jsonFallbackBox');
  if(!fb){
    fb = document.createElement('div');
    fb.className = 'jsonFallbackBox';
    fb.innerHTML = `
      <div class="picker-sub" style="margin-top:8px">
        ${afterDownload
          ? "If the download didn't start, copy the JSON below manually."
          : 'Long-press inside the box to Select All → Copy, or use the Copy button.'}
      </div>
      <textarea class="json-fallback-area"
        readonly
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"></textarea>
      <button class="popup-yes" style="width:100%;margin-top:10px"
        onclick="_copyToClipboard(this.previousElementSibling.value);">
        Copy JSON to Clipboard
      </button>
      <button class="popup-no" style="width:100%;margin-top:8px"
        onclick="closeExportModal()">
        Done
      </button>`;
    card.appendChild(fb);
  }
  const ta = fb.querySelector('textarea');
  ta.value = json;
  // Auto-select on focus so the user can immediately copy
  ta.addEventListener('focus', ()=>ta.select(), {once:true});
}

function _downloadFile(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = name;
  a.target = '_blank';
  a.rel = 'noopener';
  a.style.display = 'none';

  document.body.appendChild(a);

  const evt = new MouseEvent('click', {
    view: window,
    bubbles: true,
    cancelable: true
  });

  a.dispatchEvent(evt);

  setTimeout(()=>{
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2500);

  showToast('Download initiated ✓');
}

// ── IMPORT — opens picker first ──
function openImportModal(){
  closeSettings();
  document.getElementById('importStage1').style.display='';
  document.getElementById('importStage2').style.display='none';
  _pendingImportData = null;
  document.getElementById('importModal').classList.add('active');
}
function closeImportModal(){
  document.getElementById('importModal').classList.remove('active');
  _pendingImportData = null;
}

function handleImportFile(evt){
  const file = evt.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e)=>{
    try {
      const data = JSON.parse(e.target.result);
      if(data.app !== 'Logitta'){ showToast('Not a Logitta backup file', true); return; }
      _pendingImportData = data;
      showImportPreview(data, file.name);
    } catch(err){
      showToast('Invalid JSON file', true);
      console.error(err);
    }
  };
  reader.readAsText(file);
  evt.target.value='';
}
function showImportPreview(data, filename){
  const acCount = (data.aircraft||[]).length;
  const enCount = (data.entries||[]).length;
  const expDate = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'Unknown';

  let totalMins = 0;
  (data.aircraft||[]).forEach(ac=>{
    Object.values(ac.data||{}).forEach(v=>totalMins+=(v||0));
  });
  (data.entries||[]).forEach(e=>{
    totalMins += (e.day_dual||0)+(e.day_pilot||0)+(e.day_copilot||0)
                +(e.night_dual||0)+(e.night_pilot||0)+(e.night_copilot||0);
  });

  document.getElementById('importStats').innerHTML = `
    <div class="import-stat"><span>File:</span><b>${filename}</b></div>
    <div class="import-stat"><span>Exported:</span><b>${expDate}</b></div>
    <div class="import-stat"><span>Aircraft entries:</span><b>${acCount}</b></div>
    <div class="import-stat"><span>Sortie entries:</span><b>${enCount}</b></div>
    <div class="import-stat"><span>Total flying hrs:</span><b>${(totalMins/60).toFixed(2)} hrs</b></div>
  `;
  document.getElementById('importStage1').style.display='none';
  document.getElementById('importStage2').style.display='';
}

function cancelImport(){
  _pendingImportData = null;
  document.getElementById('importStage1').style.display='';
  document.getElementById('importStage2').style.display='none';
}

function confirmImport(){
  if(!_pendingImportData){ return; }
  const d = _pendingImportData;
  if(d.aircraft) setAC(d.aircraft);
  if(d.entries) setEntries(d.entries);
  if(d.settings) setSettings(d.settings);
  // Name-suggestions restore, flag-aware:
  //  • If the backup CONTAINS a name list, it is authoritative — the user's
  //    curated/edited list. Restore it and immediately mark seeding done so
  //    the seeder never runs afterwards and re-injects entry names over it.
  //    (Without this, a fresh install with no seed flag yet would seed from
  //    the imported entries and resurrect names the user had deleted.)
  //  • If the backup has NO name list (an old backup from before this
  //    feature), seed once from the imported entries so the list isn't
  //    empty, then the seeder sets the flag itself.
  if(Array.isArray(d.nameSuggestions)){
    setNames(d.nameSuggestions);
    _markNamesSeeded();
  } else {
    // Old backup with no saved list → REPLACE the list with names rebuilt
    // from the imported entries. force=true bypasses the seed flag (which is
    // already set from this install's first launch) and clears before
    // filling, so the dropdown reflects exactly the imported data.
    _seedNameSuggestionsFromEntries(true);
  }
  // Same flag-aware logic for the aircraft-number list.
  if(Array.isArray(d.acnoSuggestions)){
    setAcnos(d.acnoSuggestions);
    _markAcnosSeeded();
  } else {
    _seedAcnosFromEntries(true);
  }
  // Set the primary imported aircraft (e.g. ALH MK1 or first) as active so Summary immediately works!
  const importedAcs = d.aircraft || getAC();
  const defAc = importedAcs.find(a => (a.name||'').toLowerCase().includes('alh')) || importedAcs[0];
  setActiveAcId(defAc ? defAc.id : null);
  _pendingImportData = null;
  applySettings();
  closeImportModal();
  renderHome();
  if(curScreen==='prev') renderAcList();
  if(curScreen==='logbook') renderLogbook();
  if(curScreen==='summary') renderSummary();
  haptic('success');
  showToast('Backup restored ✓');
}


// ── drag-drop wiring (for dropZone) ──
function _initDropZone(){
  const dz = document.getElementById('dropZone');
  if(!dz || dz._wired) return;
  dz._wired = true;
  ['dragenter','dragover'].forEach(ev=>{
    dz.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.add('dragging'); });
  });
  ['dragleave','drop'].forEach(ev=>{
    dz.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragging'); });
  });
  dz.addEventListener('drop', e=>{
    const f = e.dataTransfer?.files?.[0];
    if(!f) return;
    handleImportFile({ target:{ files:[f], value:'' }});
  });
}

function confirmWipe(){
  if(!confirm('⚠️ ERASE ALL DATA?\n\nThis will permanently delete:\n• All aircraft entries\n• All sortie log entries\n• All settings\n\nThis CANNOT be undone. Make sure you have a backup first.')) return;
  if(!confirm('Are you absolutely sure?\n\nLast chance to cancel.')) return;
  // Clear all three layers: memory cache + localStorage (via _storeRemove)
  // AND the native vault file — otherwise the next boot's
  // _restoreFromVaultIfNeeded() would resurrect everything just wiped.
  _storeRemove(K_AC);
  _storeRemove(K_ENT);
  _storeRemove(K_SETT);
  _storeRemove(K_ACTIVE);
  _storeRemove(K_NAMES);
  _storeRemove(K_ACNOS);
  // Clear the one-time seed flags too: after a full wipe the user is starting
  // fresh, so if they later add entries (or import), seeding should be
  // allowed to run once again rather than being permanently suppressed.
  try { localStorage.removeItem(K_NAMES_SEEDED); } catch(_){}
  try { localStorage.removeItem(K_ACNOS_SEEDED); } catch(_){}
  try {
    const bridge = window.Android || window.LogittaAndroid;
    if(bridge && typeof bridge.clearAutoBackup === 'function'){
      bridge.clearAutoBackup('logitta_autobackup.json');
    }
  } catch(_){}
  // Cancel any pending auto-backup that would re-write the vault with the
  // pre-wipe data captured before this point.
  if(_autoBackupTimer){ clearTimeout(_autoBackupTimer); _autoBackupTimer = null; }
  document.body.className='';
  applySettings();
  renderHome();
  closeSettings();
  showToast('All data erased');
}

// ── SHARE SUMMARY — chooser ──
function shareSummary(){ document.getElementById('shareModal').classList.add('active'); }
function shareSummaryFromSettings(){ closeSettings(); setTimeout(()=>shareSummary(), 180); }
function closeShareModal(){ document.getElementById('shareModal').classList.remove('active'); }

// ─────────────────────────────────────────────────────
// CONCISE SUMMARY — Aircraft picker → preview → send
// ─────────────────────────────────────────────────────
let _selectedConciseAcId = null;

function openConcisePicker(){
  closeShareModal();
  const acs = getAC();
  const el = document.getElementById('conciseAcList');
  if(!acs.length){
    el.innerHTML = '<div class="empty" style="padding:24px 12px"><div class="empty-ico"><svg class="ico" aria-hidden="true" style="width:1.8em;height:1.8em"><use href="#i-book"/></svg></div>No aircraft added yet.<br>Add aircraft in Prior Experience first.</div>';
  } else {
    el.innerHTML = acs.map(ac=>{
      const d = ac.data||{};
      const capt = (d.day_pilot||0)+(d.night_pilot||0);
      return `<div class="concise-ac-item" onclick="selectConciseAc('${ac.id}')">
        <div>
          <div class="concise-ac-name">${ac.name}</div>
          <div class="concise-ac-hrs">Captain Hrs: ${hmHTML(capt)}</div>
        </div>
        <div class="concise-ac-arrow">›</div>
      </div>`;
    }).join('');
  }
  document.getElementById('concisePicker').classList.add('active');
}
function closeConcisePicker(){ document.getElementById('concisePicker').classList.remove('active'); }

function selectConciseAc(id){
  _selectedConciseAcId = id;
  closeConcisePicker();
  openConcisePreview();
}

function openConcisePreview(){
  const ac = getAC().find(a=>a.id===_selectedConciseAcId);
  if(!ac){ showToast('Aircraft not found', true); return; }

  // Compute the 5 metrics
  const acs = getAC();
  const entries = getEntries();

  // 1) Total Captain Hrs across ALL aircraft (prior + entries) = day_pilot + night_pilot
  let totalCaptain = 0;
  acs.forEach(a=>{
    const d = a.data||{};
    totalCaptain += (d.day_pilot||0) + (d.night_pilot||0);
  });
  entries.forEach(e=>{
    totalCaptain += (e.day_pilot||0) + (e.night_pilot||0);
  });

  // 2) Captain Hrs of SELECTED aircraft only — split Day / Night.
  const sd = ac.data||{};
  let selDayPilot = sd.day_pilot||0;
  let selNiPilot  = sd.night_pilot||0;
  entries.filter(e=>e.acId===_selectedConciseAcId).forEach(e=>{
    selDayPilot += (e.day_pilot||0);
    selNiPilot  += (e.night_pilot||0);
  });
  const selCaptain = selDayPilot + selNiPilot;

  // 3) Total NVG Experience across ALL aircraft (prior + entries).
  let selNVG = 0;
  acs.forEach(a=>{
    const d = a.data||{};
    selNVG += (d.nvg || ((d.nvg_dual||0)+(d.nvg_pilot||0)+(d.nvg_copilot||0)));
  });
  entries.forEach(e=>{
    selNVG += (e.nvg||0);
  });

  // 4–6) Con-Trg Day / Night + SIF/IMC — computed for the SELECTED aircraft
  // using the SAME selections the user set in the Summary tab's Captain
  // Con-Trg pickers (Pilot/Co-Pilot + months) and the SIF+IMC bar, so the
  // concise summary mirrors what they configured there. Reference = today.
  const _now = new Date();
  const _mIdx = _now.getMonth();
  const _yr   = _now.getFullYear();
  const conTrgDay   = _ccSideHours('day',   _ccDaySel,   entries, _selectedConciseAcId, _mIdx, _yr);
  const conTrgNi    = _ccSideHours('night', _ccNightSel, entries, _selectedConciseAcId, _mIdx, _yr);
  const conSifImc   = _ccSifImcHours(_ccSifImcSel, entries, _selectedConciseAcId, _mIdx, _yr);
  const dayParam    = _ccSelLabel(_ccDaySel);     // e.g. "Pilot · 3 mo"
  const niParam     = _ccSelLabel(_ccNightSel);
  const sifimcParam = _ccSifImcLabel(_ccSifImcSel);

  // Build preview HTML
  const sett = getSettings();
  const pilotName = sett.name || 'Pilot';
  const today = new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
  // Settings (sett_catir + sett_catir_date). Display only if at least the
  // category text is set; date is optional. The date is stored as ISO
  // (YYYY-MM-DD) by the <input type="date">, so convert to DD MMM YYYY for
  // display (matches the same format used for "Date :" above).
  const catirTxt  = (sett.catir || '').trim();
  const catirIso  = (sett.catirDate || '').trim();
  const catirDate = catirIso ? (()=>{
    const [y,m,d] = catirIso.split('-');
    const mIdx = parseInt(m,10) - 1;
    return `${d} ${MONTHS[mIdx] || m} ${y}`;
  })() : '';
  // One-line CAT IR string: "<category>  ·  <date>" if both set, just the
  // category if no date, blank otherwise.
  const catirLine = catirTxt
    ? (catirDate ? `${catirTxt}  ·  ${catirDate}` : catirTxt)
    : '';

  const html = `
    <div class="pv-header">CONCISE SUMMARY — ${ac.name}</div>
    <div style="font-size:10px;color:var(--txt2);margin-bottom:6px;text-align:center">${pilotName} · ${today}</div>
    ${catirLine ? `<div style="font-size:10px;color:var(--gold);margin-bottom:8px;text-align:center;letter-spacing:.3px">CAT IR : ${catirLine}</div>` : ''}
    <div class="pv-line">
      <span class="pv-key">1. Total Captain Hrs Experience<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(Day + Ni Pilot — all aircraft)</span></span>
      <span class="pv-val">${hmHTML(totalCaptain)}</span>
    </div>
    <div class="pv-line">
      <span class="pv-key">2. Total Captain Hrs on ${ac.name}<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(Day + Ni Pilot — this aircraft)</span></span>
      <span class="pv-val">${hmHTML(selCaptain)}</span>
    </div>
    <div class="pv-line">
      <span class="pv-key">3. Total Captain Hrs Day<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(Day Pilot — ${ac.name})</span></span>
      <span class="pv-val">${hmHTML(selDayPilot)}</span>
    </div>
    <div class="pv-line">
      <span class="pv-key">4. Total Captain Hrs Night<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(Ni Pilot — ${ac.name})</span></span>
      <span class="pv-val">${hmHTML(selNiPilot)}</span>
    </div>
    <div class="pv-line">
      <span class="pv-key">5. Total NVG Experience<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(NVG — all aircraft)</span></span>
      <span class="pv-val">${hmHTML(selNVG)}</span>
    </div>
    <div class="pv-line">
      <span class="pv-key">6. Con-Trg Day<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(${dayParam})</span></span>
      <span class="pv-val">${hmHTML(conTrgDay)}</span>
    </div>
    <div class="pv-line">
      <span class="pv-key">7. Con-Trg Night<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(${niParam})</span></span>
      <span class="pv-val">${hmHTML(conTrgNi)}</span>
    </div>
    <div class="pv-line">
      <span class="pv-key">8. SIF + IMC<br><span style="font-size:9px;color:var(--txt3);font-weight:normal">(${sifimcParam})</span></span>
      <span class="pv-val" style="color:var(--gold2)">${hmHTML(conSifImc)}</span>
    </div>
  `;

  document.getElementById('conciseMsgBox').innerHTML = html;
  document.getElementById('concisePreviewSub').textContent = 'AIRCRAFT: ' + ac.name.toUpperCase();

  // Store the plain-text version for sending. Uses hm() (plain text)
  // deliberately — this string is shared into WhatsApp / SMS / email, where
  // HTML spans from hmHTML() would render as literal angle-bracket text.
  _conciseText = `✈️ FLYING HOURS SUMMARY — ${ac.name}
━━━━━━━━━━━━━━━━━━━━━━
Pilot : ${pilotName}
Date  : ${today}${catirLine ? '\nCAT IR: ' + catirLine : ''}

1. Total Captain Hrs Experience : ${hm(totalCaptain)}
   (Day + Ni Pilot — all aircraft)

2. Total Captain Hrs on ${ac.name} : ${hm(selCaptain)}

3. Total Captain Hrs Day        : ${hm(selDayPilot)}

4. Total Captain Hrs Night      : ${hm(selNiPilot)}

5. Total NVG Experience         : ${hm(selNVG)}

6. Con-Trg Day                  : ${hm(conTrgDay)}
   (${dayParam})

7. Con-Trg Night                : ${hm(conTrgNi)}
   (${niParam})

8. SIF + IMC                    : ${hm(conSifImc)}
   (${sifimcParam})

— Generated by Logitta...`;

  document.getElementById('concisePreview').classList.add('active');
}
function closeConcisePreview(){ document.getElementById('concisePreview').classList.remove('active'); }

let _conciseText = '';
function sendConcise(method){
  const txt = _conciseText;
  if(_shareTextNative('Flying Hours Summary', txt)){
    showToast('Share sheet opened');
  } else if(navigator.share){
    navigator.share({title:'Flying Hours Summary', text:txt})
      .then(()=>showToast('Shared'))
      .catch(err=>{ if(err.name!=='AbortError') _copyToClipboard(txt); });
  } else {
    _copyToClipboard(txt);
  }
}

// ─────────────────────────────────────────────────────
// COMPLETE SUMMARY — Tabular preview → send
// ─────────────────────────────────────────────────────
let _completeText = '';

function openCompletePreview(){
  closeShareModal();

  const acs = getAC();
  const entries = getEntries();
  const sett = getSettings();
  const pilotName = sett.name || 'Pilot';
  const today = new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
  // CAT IR — same logic as Concise summary (see comment there for details).
  const catirTxt  = (sett.catir || '').trim();
  const catirIso  = (sett.catirDate || '').trim();
  const catirDate = catirIso ? (()=>{
    const [y,m,d] = catirIso.split('-');
    const mIdx = parseInt(m,10) - 1;
    return `${d} ${MONTHS[mIdx] || m} ${y}`;
  })() : '';
  const catirLine = catirTxt
    ? (catirDate ? `${catirTxt}  ·  ${catirDate}` : catirTxt)
    : '';

  // Build per-aircraft aggregated rows (prior exp + log entries combined)
  const buckets = {};
  acs.forEach(ac=>{
    const d = ac.data||{};
    buckets[ac.id] = {
      name: ac.name,
      day_dual:(d.day_dual||0),
      day_pilot:(d.day_pilot||0),
      day_copilot:(d.day_copilot||0),
      night_dual:(d.night_dual||0),
      night_pilot:(d.night_pilot||0),
      night_copilot:(d.night_copilot||0),
      nvg:(d.nvg || ((d.nvg_dual||0)+(d.nvg_pilot||0)+(d.nvg_copilot||0))),
      imc:(d.imc_day||0)+(d.imc_night||0),
      sif:(d.sif_day||0)+(d.sif_night||0),
      wso:(d.wso||0),
      instr:(d.instr_day||0)+(d.instr_night||0),
    };
  });
  entries.forEach(e=>{
    if(!buckets[e.acId]){
      buckets[e.acId] = {name:e.acName||'Unknown',day_dual:0,day_pilot:0,day_copilot:0,night_dual:0,night_pilot:0,night_copilot:0,nvg:0,imc:0,sif:0,wso:0,instr:0};
    }
    const b = buckets[e.acId];
    b.day_dual+=(e.day_dual||0); b.day_pilot+=(e.day_pilot||0); b.day_copilot+=(e.day_copilot||0);
    b.night_dual+=(e.night_dual||0); b.night_pilot+=(e.night_pilot||0); b.night_copilot+=(e.night_copilot||0);
    b.nvg+=(e.nvg||0); b.imc+=(e.imc||0)+(e.imc_day||0)+(e.imc_night||0); b.sif+=(e.sif||0)+(e.sif_day||0)+(e.sif_night||0);
    b.wso+=(e.wso||0); b.instr+=(e.instr_day||0)+(e.instr_night||0);
  });

  const rows = Object.values(buckets);
  // grand totals
  const g = {day_dual:0,day_pilot:0,day_copilot:0,night_dual:0,night_pilot:0,night_copilot:0,nvg:0,imc:0,sif:0,wso:0,instr:0};
  rows.forEach(r=>{
    Object.keys(g).forEach(k=>{ g[k]+=r[k]||0; });
  });

  // HTML table — preceded by a small header strip showing pilot, date, and
  // CAT IR. This mirrors the share text's top section and gives the user a
  // visible CAT IR reminder in the preview itself (the previous version
  // showed pilot/date/CAT only in the shared text — too easy to miss).
  let tableHTML = `<div style="text-align:center;margin:0 0 10px;line-height:1.45">
    <div style="font-size:11px;color:var(--txt2)">${pilotName} · ${today}</div>
    ${catirLine ? `<div style="font-size:11px;color:var(--gold);letter-spacing:.3px;margin-top:2px">CAT IR : ${catirLine}</div>` : ''}
  </div>`;
  tableHTML += '<table class="preview-table"><thead><tr>'
    + '<th>Aircraft</th>'
    + '<th>Day<br>Dual</th><th>Day<br>Pilot</th><th>Day<br>C/P</th>'
    + '<th>Ni<br>Dual</th><th>Ni<br>Pilot</th><th>Ni<br>C/P</th>'
    + '<th>NVG</th><th>IMC</th><th>SIF</th><th>WSO</th><th>Inst</th>'
    + '<th>Total</th>'
    + '</tr></thead><tbody>';
  rows.forEach(r=>{
    const dayTot = r.day_dual+r.day_pilot+r.day_copilot;
    const ngtTot = r.night_dual+r.night_pilot+r.night_copilot;
    // Total = Day + Night only. NVG is a Night descriptor and is already counted in Night.
    const total = dayTot+ngtTot;
    tableHTML += `<tr>
      <td>${r.name}</td>
      <td>${hmHTML(r.day_dual)}</td><td>${hmHTML(r.day_pilot)}</td><td>${hmHTML(r.day_copilot)}</td>
      <td>${hmHTML(r.night_dual)}</td><td>${hmHTML(r.night_pilot)}</td><td>${hmHTML(r.night_copilot)}</td>
      <td>${hmHTML(r.nvg)}</td><td>${hmHTML(r.imc)}</td><td>${hmHTML(r.sif)}</td><td>${hmHTML(r.wso)}</td><td>${hmHTML(r.instr)}</td>
      <td style="color:var(--gold2);font-weight:700">${hmHTML(total)}</td>
    </tr>`;
  });
  // Grand total row
  const gDayTot = g.day_dual+g.day_pilot+g.day_copilot;
  const gNgtTot = g.night_dual+g.night_pilot+g.night_copilot;
  // Total = Day + Night only. NVG is a Night descriptor and is already counted in Night.
  const gTotal = gDayTot+gNgtTot;
  tableHTML += `<tr class="grand-row">
    <td>GRAND TOTAL</td>
    <td>${hmHTML(g.day_dual)}</td><td>${hmHTML(g.day_pilot)}</td><td>${hmHTML(g.day_copilot)}</td>
    <td>${hmHTML(g.night_dual)}</td><td>${hmHTML(g.night_pilot)}</td><td>${hmHTML(g.night_copilot)}</td>
    <td>${hmHTML(g.nvg)}</td><td>${hmHTML(g.imc)}</td><td>${hmHTML(g.sif)}</td><td>${hmHTML(g.wso)}</td><td>${hmHTML(g.instr)}</td>
    <td>${hmHTML(gTotal)}</td>
  </tr>`;
  tableHTML += '</tbody></table>';

  document.getElementById('completeTableWrap').innerHTML = tableHTML;

  // Build plain-text version for the Android share sheet.
  let txt = `✈️ COMPLETE FLYING HOURS SUMMARY
═══════════════════════════════
Pilot : ${pilotName}
Date  : ${today}${catirLine ? '\nCAT IR: ' + catirLine : ''}
Aircraft: ${acs.length}  ·  Sorties: ${entries.length}

`;
  rows.forEach(r=>{
    const dayTot = r.day_dual+r.day_pilot+r.day_copilot;
    const ngtTot = r.night_dual+r.night_pilot+r.night_copilot;
    // Total = Day + Night only. NVG is a Night descriptor and is already counted in Night.
    const total = dayTot+ngtTot;
    txt += `▸ ${r.name.toUpperCase()}
  ─────────────────────
`;
    txt += `  Day Dual    : ${hm(r.day_dual).padStart(8)}
`;
    txt += `  Day Pilot   : ${hm(r.day_pilot).padStart(8)}
`;
    txt += `  Day Co-Plt  : ${hm(r.day_copilot).padStart(8)}
`;
    txt += `  Ni Dual     : ${hm(r.night_dual).padStart(8)}
`;
    txt += `  Ni Pilot    : ${hm(r.night_pilot).padStart(8)}
`;
    txt += `  Ni Co-Plt   : ${hm(r.night_copilot).padStart(8)}
`;
    txt += `  NVG         : ${hm(r.nvg).padStart(8)}
`;
    txt += `  IMC         : ${hm(r.imc).padStart(8)}
`;
    txt += `  SIF         : ${hm(r.sif).padStart(8)}
`;
    txt += `  WSO         : ${hm(r.wso).padStart(8)}
`;
    txt += `  Instructor  : ${hm(r.instr).padStart(8)}
`;
    txt += `  ─────────────────────
`;
    txt += `  TOTAL       : ${hm(total).padStart(8)}

`;
  });
  txt += `═══════════════════════════════
GRAND TOTAL (ALL AIRCRAFT)
═══════════════════════════════
  Day Total   : ${hm(gDayTot).padStart(8)}
  Ni Total    : ${hm(gNgtTot).padStart(8)}
  NVG Total   : ${hm(g.nvg).padStart(8)}
  IMC Total   : ${hm(g.imc).padStart(8)}
  SIF Total   : ${hm(g.sif).padStart(8)}
  WSO Total   : ${hm(g.wso).padStart(8)}
  Instructor  : ${hm(g.instr).padStart(8)}
  ─────────────────────────────
  Captain Hrs : ${hm(g.day_pilot+g.night_pilot).padStart(8)}
  ═════════════════════════════
  GRAND TOTAL : ${hm(gTotal).padStart(8)}

— Generated by Logitta...`;

  _completeText = txt;
  document.getElementById('completePreview').classList.add('active');
}
function closeCompletePreview(){ document.getElementById('completePreview').classList.remove('active'); }

function sendComplete(method){
  const txt = _completeText;
  if(_shareTextNative('Complete Flying Hours Summary', txt)){
    showToast('Share sheet opened');
  } else if(navigator.share){
    navigator.share({title:'Complete Flying Hours Summary', text:txt})
      .then(()=>showToast('Shared'))
      .catch(err=>{ if(err.name!=='AbortError') _copyToClipboard(txt); });
  } else {
    _copyToClipboard(txt);
  }
}

function _copyToClipboard(text){
  if(_copyTextNative(text)){
    showToast('Copied to clipboard');
  } else if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text)
      .then(()=>showToast('Copied to clipboard ✓'))
      .catch(()=>_fallbackCopy(text));
  } else {
    _fallbackCopy(text);
  }
}
function _fallbackCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position='fixed';
  ta.style.left='0';
  ta.style.top='0';
  ta.style.opacity='0';

  document.body.appendChild(ta);

  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  let copied = false;

  try{
    copied = document.execCommand('copy');
  }catch(e){
    copied = false;
  }

  document.body.removeChild(ta);

  if(copied){
    showToast('Copied to clipboard ✓');
  }else{
    showToast('Manual copy required', true);
  }
}

// Migrate legacy 'green' ink type to 'nvg' (UI change: green became NVG)

// Auto-jump from hour to minute fields in Log Entry.
// The minute box stays empty until an hour is typed, then it defaults to 00 and
// the cursor moves there automatically.
function _initEntryHmAutoJump(){
  document.querySelectorAll('.hrs-hm, .spl-hm').forEach(pair=>{
    if(pair._autoJumpWired) return;
    pair._autoJumpWired = true;

    const hourInput = pair.querySelector('input[id$="_h"]');
    const minuteInput = pair.querySelector('input[id$="_m"]');
    if(!hourInput || !minuteInput) return;

    hourInput.addEventListener('input', function(){
      this.value = this.value.replace(/\D/g, '').slice(0, this.maxLength > 0 ? this.maxLength : 1);
      if(this.value.length < 1) return;

      if(minuteInput.value.trim() === ''){
        minuteInput.value = '00';
        minuteInput.dispatchEvent(new Event('input', {bubbles:true}));
      }

      setTimeout(()=>{
        minuteInput.focus();
        minuteInput.select();
      }, 30);
    });

    minuteInput.addEventListener('input', function(){
      this.value = this.value.replace(/\D/g, '').slice(0, 2);
    });
  });
}

document.addEventListener('DOMContentLoaded', _initEntryHmAutoJump);
// Seed the name-suggestions list from any pre-existing log entries the
// FIRST time the app boots (or any time the user imports a backup that
// doesn't include nameSuggestions). No-op if already seeded.
document.addEventListener('DOMContentLoaded', function(){ _seedNameSuggestionsFromEntries(); });
document.addEventListener('DOMContentLoaded', function(){ _seedAcnosFromEntries(); });

// One-time cleanup: merge any pre-existing duplicate aircraft that share the
// same name (case-insensitive). Earlier builds could create same-name twins
// (e.g. saving manually then again via the tutorial). For each name group we
// keep a single entry, preferring the one that is currently active, else the
// one with the most recorded hours. Active state is preserved.
function _dedupeAircraftOnce(){
  try {
    const acs = getAC();
    if(!acs || acs.length < 2) return;
    const activeId = (typeof getActiveAcId==='function') ? getActiveAcId() : null;
    const hoursOf = (a)=>{ let t=0; const d=a.data||{}; for(const k in d){ if(typeof d[k]==='number') t+=d[k]; } return t; };
    const byName = {};
    acs.forEach(a=>{
      const key = (a.name||'').trim().toLowerCase();
      if(!byName[key]) byName[key] = [];
      byName[key].push(a);
    });
    let changed = false, newActiveId = activeId;
    const merged = [];
    Object.keys(byName).forEach(key=>{
      const group = byName[key];
      if(group.length === 1){ merged.push(group[0]); return; }
      changed = true;
      // Choose the keeper: active one first, else most hours.
      let keeper = group.find(a=>a.id===activeId) ||
                   group.slice().sort((a,b)=>hoursOf(b)-hoursOf(a))[0];
      // If any twin was active, the keeper carries the active flag.
      if(group.some(a=>a.id===activeId)) newActiveId = keeper.id;
      merged.push(keeper);
    });
    if(changed){
      setAC(merged);
      if(newActiveId && !merged.some(a=>a.id===newActiveId)) newActiveId = null;
      if(typeof setActiveAcId==='function') setActiveAcId(newActiveId);
    }
  } catch(e){}
}
document.addEventListener('DOMContentLoaded', _dedupeAircraftOnce);
document.addEventListener('DOMContentLoaded', _initKeyboardScrollFix);
document.addEventListener('DOMContentLoaded', _initAxisLockScroll);


function _migrateGreenToNvg(){
  const entries = getEntries();
  let changed = false;
  entries.forEach(e=>{
    if(e.entryType === 'green'){
      e.entryType = 'nvg';
      changed = true;
    }
  });
  if(changed) setEntries(entries);
}

// ════════════════════════════════════════════════════
// GLASS DROPDOWN — drop-in replacement for native <select> popups
// ════════════════════════════════════════════════════
// Native <select> stays in DOM (functional, accessible) but is hidden. A styled trigger
// button overlays it. Tapping opens a singleton centred frosted-glass popover with the
// options. Selecting an option sets the native select's .value and dispatches a 'change'
// event so every existing onchange handler (renderLogbook, _onSumMonthYearChange,
// onEntryTypeChange, etc.) fires as if the user used the native picker. No existing
// code needs to change.

const GD = (function(){
  let _backdrop = null, _popover = null, _list = null, _titleEl = null;
  let _activeSelect = null;

  function _ensureSingleton(){
    if(_backdrop) return;
    _backdrop = document.createElement('div');
    _backdrop.className = 'gd-backdrop';
    _backdrop.addEventListener('click', close);
    document.body.appendChild(_backdrop);

    _popover = document.createElement('div');
    _popover.className = 'gd-popover';
    _popover.setAttribute('role','listbox');
    _popover.innerHTML = `
      <div class="gd-popover-head">
        <div class="gd-popover-title" id="gdPopTitle">Select</div>
        <button class="gd-popover-close" aria-label="Close">✕</button>
      </div>
      <div class="gd-popover-list" id="gdPopList"></div>
    `;
    document.body.appendChild(_popover);
    _list = _popover.querySelector('#gdPopList');
    _titleEl = _popover.querySelector('#gdPopTitle');
    _popover.querySelector('.gd-popover-close').addEventListener('click', close);
  }

  // Best-effort label for the popover title — pulls from aria-label, nearest .flabel etc.
  function _titleFor(select){
    if(select.getAttribute('aria-label')) return select.getAttribute('aria-label');
    const fgroup = select.closest('.fgroup, .sett-row, .sum-picker-info');
    if(fgroup){
      const lbl = fgroup.querySelector('.flabel, .sett-label, .sum-picker-lbl, .entry-type-label');
      if(lbl) return lbl.textContent.trim().replace(/[—\-].*$/,'').trim() || 'Select';
    }
    if(select.id === 'lb_year') return 'Year';
    if(select.id === 'lb_month') return 'Month';
    if(select.id === 'f_month') return 'Month';
    if(select.id === 'f_entrytype') return 'Ink Colour';
    return 'Select';
  }

  function open(select, trigger){
    if(select.disabled) return;
    _ensureSingleton();
    _activeSelect = select;
    _titleEl.textContent = _titleFor(select);
    _list.innerHTML = '';
    Array.from(select.options).forEach((opt)=>{
      // Empty-value options are usually placeholders ("— Select —"), so we
      // hide them once the user has picked a real value. EXCEPTION: options
      // marked with data-keep-empty are meaningful filter values (e.g. the
      // Logbook's "All Months" option), and must remain selectable so the
      // user can clear their month filter without leaving the picker first.
      if(opt.value === '' && select.value !== '' && opt.dataset.keepEmpty === undefined) return;
      const row = document.createElement('div');
      row.className = 'gd-option';
      row.setAttribute('role','option');
      if(opt.value === select.value) row.classList.add('selected');
      // Preserve inline colour styling (e.g. ink colours on entry-type options)
      if(opt.style.color) row.style.color = opt.style.color;
      row.innerHTML = `<span>${opt.textContent}</span>`;
      row.addEventListener('click', ()=>_pick(opt.value));
      _list.appendChild(row);
    });
    _backdrop.classList.add('open');
    _popover.classList.add('open');
    trigger.classList.add('open');
  }

  function close(){
    if(!_backdrop) return;
    _backdrop.classList.remove('open');
    _popover.classList.remove('open');
    if(_activeSelect && _activeSelect._gdTrigger){
      _activeSelect._gdTrigger.classList.remove('open');
    }
    _activeSelect = null;
  }

  function _pick(val){
    if(!_activeSelect) return close();
    _activeSelect.value = val;
    if(_activeSelect._gdTrigger) _syncTriggerLabel(_activeSelect, _activeSelect._gdTrigger);
    _activeSelect.dispatchEvent(new Event('change', {bubbles:true}));
    close();
  }

  function _syncTriggerLabel(select, trigger){
    const labelEl = trigger.querySelector('.gd-trigger-label');
    if(!labelEl) return;
    const sel = select.options[select.selectedIndex];
    const text = sel ? sel.textContent : '';
    labelEl.textContent = text || '— Select —';
    labelEl.classList.toggle('placeholder', !select.value || sel?.value === '');
    labelEl.style.color = sel?.style.color || '';
  }

  // Wrap a single <select>. Idempotent.
  function upgrade(select){
    if(!select || select.dataset.gdUpgraded === '1') return;
    select.dataset.gdUpgraded = '1';

    const wrap = document.createElement('div');
    wrap.className = 'gd-wrap';
    if(select.style.flex) wrap.style.flex = select.style.flex;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'gd-trigger';
    // Inherit the select's classes so existing CSS skins the trigger naturally
    trigger.classList.add(...Array.from(select.classList));
    trigger.innerHTML = `<span class="gd-trigger-label"></span>`;
    if(select.disabled) trigger.classList.add('disabled');

    trigger.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(select.disabled) return;
      open(select, trigger);
    });

    const parent = select.parentNode;
    parent.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(trigger);

    select._gdTrigger = trigger;
    _syncTriggerLabel(select, trigger);
  }

  // Upgrade every <select> in the document. Safe to call repeatedly — already-upgraded
  // selects are skipped, and previously-upgraded selects have their labels re-synced
  // (handles cases where options were rebuilt externally, e.g. _populateYearDropdown).
  function upgradeAll(){
    document.querySelectorAll('select:not([data-gd-upgraded])').forEach(upgrade);
    document.querySelectorAll('select[data-gd-upgraded="1"]').forEach(sel=>{
      if(sel._gdTrigger){
        _syncTriggerLabel(sel, sel._gdTrigger);
        sel._gdTrigger.classList.toggle('disabled', sel.disabled);
      }
    });
  }

  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape') close();
  });

  return { upgrade, upgradeAll, close };
})();

// Hook upgrade-after-render into dynamic renderers so newly-built selects get the glass
// treatment too. Wraps the originals — non-invasive.
(function(){
  ['renderSummary','renderLogbook','_populateYearDropdown','initEntry'].forEach(name=>{
    if(typeof window[name] === 'function'){
      const orig = window[name];
      window[name] = function(){ const r = orig.apply(this, arguments); GD.upgradeAll(); return r; };
    }
  });
})();

// ════════════════════════════════════════════════════
// GESTURE NAVIGATION (home screen)
// ════════════════════════════════════════════════════
//  • Swipe right→left (anywhere on home)         → Log Entry
//  • Overscroll pull DOWN at the very top        → Logbook
//  • Overscroll pull UP at the very bottom       → Summary
// The vertical gestures only engage once the home page is scrolled hard
// against its top/bottom edge and the user keeps pulling, so they never
// fight normal scrolling. A short pull peeks the target page; pulling past a
// threshold commits the navigation, otherwise it springs back.
// Hint arrows appear for ~10s on a fresh open, gently bouncing, then fade.
function _initGestureNav(){
  if(window._gnavWired) return;
  window._gnavWired = true;

  const home = document.getElementById('home');
  if(!home) return;

  // ── Build hint + peek elements once ──
  const arrow = (d, cls)=>{
    // simple chevron pointing in direction d
    const paths = {
      left:  'M15 6 L9 12 L15 18',
      down:  'M6 9 L12 15 L18 9',
      up:    'M6 15 L12 9 L18 15'
    };
    return `<svg ${cls?`class="${cls}" `:''}viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[d]}"/></svg>`;
  };
  const hintLeft = document.createElement('div');
  hintLeft.className = 'gnav-hint gnav-left';
  hintLeft.innerHTML = `${arrow('left')}<span class="gnav-lbl">Log Entry</span>`;
  const hintTop = document.createElement('div');
  hintTop.className = 'gnav-hint gnav-top';
  hintTop.innerHTML = `<span class="gnav-lbl">Logbook</span>${arrow('down')}`;
  const hintBottom = document.createElement('div');
  hintBottom.className = 'gnav-hint gnav-bottom';
  hintBottom.innerHTML = `<span class="gnav-lbl">Summary</span>${arrow('up')}`;
  const peekTop = document.createElement('div');
  peekTop.className = 'gnav-peek gnav-peek-top';
  peekTop.innerHTML = `${arrow('down','gnav-peek-ico')}<span class="gnav-peek-txt">LOGBOOK</span>`;
  const peekBottom = document.createElement('div');
  peekBottom.className = 'gnav-peek gnav-peek-bottom';
  peekBottom.innerHTML = `${arrow('up','gnav-peek-ico')}<span class="gnav-peek-txt">SUMMARY</span>`;
  const peekRight = document.createElement('div');
  peekRight.className = 'gnav-peek gnav-peek-right';
  peekRight.innerHTML = `${arrow('left','gnav-peek-ico')}<span class="gnav-peek-txt">LOG ENTRY</span>`;
  [hintLeft,hintTop,hintBottom,peekTop,peekBottom,peekRight].forEach(el=>document.body.appendChild(el));

  // ── Hint visibility: show on fresh open, fade after 10s ──
  let hintTimer = null;
  function showHints(){
    if(curScreen !== 'home') return;
    [hintLeft,hintTop,hintBottom].forEach(h=>{ h.classList.remove('hide'); h.classList.add('show'); });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHints, 10000);
  }
  function hideHints(){
    [hintLeft,hintTop,hintBottom].forEach(h=>{ h.classList.remove('show'); h.classList.add('hide'); });
  }
  window._gnavShowHints = showHints;
  window._gnavHideHints = hideHints;

  // ── Gesture tracking ──
  const COMMIT_PX   = 90;    // pull distance to trigger navigation
  const DECIDE_PX   = 10;    // movement before locking an axis
  const H_COMMIT    = 70;    // horizontal swipe distance for Log Entry
  const EDGE_TOL    = 2;     // px tolerance for "at edge"
  let startX=0, startY=0, axis=null, dir=null, active=false, pulled=0;

  function atTop(){ return home.scrollTop <= EDGE_TOL; }
  function atBottom(){ return (home.scrollHeight - home.clientHeight - home.scrollTop) <= EDGE_TOL; }

  function resetPeek(){
    peekTop.style.height='0px'; peekBottom.style.height='0px'; peekRight.style.width='0px';
    peekTop.classList.remove('gnav-armed'); peekBottom.classList.remove('gnav-armed'); peekRight.classList.remove('gnav-armed');
  }

  home.addEventListener('touchstart',(e)=>{
    if(curScreen!=='home' || e.touches.length!==1){ active=false; return; }
    startX=e.touches[0].clientX; startY=e.touches[0].clientY;
    axis=null; dir=null; active=true; pulled=0;
  }, {passive:true});

  home.addEventListener('touchmove',(e)=>{
    if(!active || e.touches.length!==1) return;
    const dx=e.touches[0].clientX-startX;
    const dy=e.touches[0].clientY-startY;
    if(axis===null){
      if(Math.abs(dx)<DECIDE_PX && Math.abs(dy)<DECIDE_PX) return;
      axis = Math.abs(dx)>Math.abs(dy) ? 'x' : 'y';
      // Lock the direction + whether a vertical pull is even eligible
      if(axis==='y'){
        if(dy>0 && atTop()) dir='top';        // pulling down at the top → Logbook
        else if(dy<0 && atBottom()) dir='bottom'; // pulling up at the bottom → Summary
        else { active=false; return; }        // mid-scroll: let it scroll normally
      } else {
        dir = dx<0 ? 'left' : 'rightedge';    // right→left → Log Entry
        if(dir==='rightedge'){ active=false; return; } // left→right unused
      }
      hideHints();
    }

    if(axis==='y'){
      // Resist with a damped factor so the peek feels rubbery
      const raw = dir==='top' ? dy : -dy;
      if(raw<=0){ resetPeek(); return; }
      pulled = Math.min(raw*0.6, 160);
      e.preventDefault();   // stop native scroll/refresh while pulling the peek
      const panel = dir==='top' ? peekTop : peekBottom;
      const other = dir==='top' ? peekBottom : peekTop;
      other.style.height='0px';
      panel.style.height = pulled+'px';
      panel.classList.toggle('gnav-armed', pulled>=COMMIT_PX);
    } else if(axis==='x' && dir==='left'){
      // Pulling right→left grows the right-edge strip (tracks width).
      const raw = -dx;
      if(raw<=0){ resetPeek(); return; }
      pulled = Math.min(raw*0.7, 220);
      e.preventDefault();
      peekRight.style.width = pulled+'px';
      peekRight.classList.toggle('gnav-armed', pulled>=H_COMMIT);
    }
  }, {passive:false});

  function finish(){
    if(!active){ resetPeek(); return; }
    active=false;
    if(axis==='y' && pulled>=COMMIT_PX){
      try{ haptic && haptic('confirm'); }catch(_){}
      const target = dir==='top' ? 'logbook' : 'summary';
      resetPeek();
      go(target);
    } else if(axis==='x' && dir==='left' && pulled>=H_COMMIT){
      try{ haptic && haptic('confirm'); }catch(_){}
      resetPeek();
      go('entry');
    } else {
      resetPeek();
    }
  }
  home.addEventListener('touchend', finish, {passive:true});
  home.addEventListener('touchcancel', ()=>{ active=false; resetPeek(); }, {passive:true});

  // Hints are shown after the boot splash dismisses (see _bootSplash);
  // if there's no splash (reduced-motion), show them now.
  if(window.__bootSplashShown){ showHints(); }
}


// ════════════════════════════════════════════════════
// A brief (~1.3s) avionics-style boot: dark overlay, the crest fades/scales
// in, "LOGITTA" reveals, a thin sweep line draws, then the whole thing fades
// out to reveal the home screen (which runs its own staggered entrance).
// Tapping anywhere skips straight to the fade-out. Honors reduced-motion by
// skipping entirely. Runs once per page load (i.e. per cold launch).
function _bootSplash(){
  try {
    if(window.__bootSplashShown) return;
    window.__bootSplashShown = true;
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      return;   // no splash for reduced-motion users
    }
    var ICON = "data:image/jpeg;base64,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";

    var s = document.createElement('div');
    s.id = 'bootSplash';
    s.className = 'boot-splash';
    s.innerHTML =
      '<div class="bs-inner">' +
        '<div class="bs-icon-wrap">' +
          '<div class="bs-chakra"></div>' +
          '<div class="bs-chakra bs-chakra2"></div>' +
          '<svg class="bs-ring" viewBox="0 0 100 100" aria-hidden="true">' +
            '<circle cx="50" cy="50" r="48" fill="none" stroke="rgba(var(--accent-rgb),.25)" stroke-width="0.5"/>' +
            '<circle class="bs-ring-draw" cx="50" cy="50" r="45" fill="none" stroke="rgba(var(--accent-rgb),.75)" stroke-width="1" stroke-linecap="round"/>' +
          '</svg>' +
          '<div class="bs-icon-glow"></div>' +
          '<img class="bs-icon" src="'+ICON+'" alt="">' +
        '</div>' +
        '<div class="bs-title">LOGITTA</div>' +
        '<div class="bs-line"></div>' +
        '<div class="bs-sub">FLYING LOG BOOK</div>' +
      '</div>';
    document.body.appendChild(s);

    var done = false;
    function dismiss(){
      if(done) return; done = true;
      // Hand-off: splash icon zooms out + fades, home page fade-zooms into place.
      s.classList.add('bs-out');
      var home = document.getElementById('home');
      if(home){ home.classList.add('home-boot-in'); }
      setTimeout(function(){
        if(s && s.parentNode) s.remove();
        if(home){ home.classList.remove('home-boot-in'); }
        // Reveal the swipe hints once the home screen is in place.
        try{ window._gnavShowHints && window._gnavShowHints(); }catch(_){}
      }, 850);
    }
    s.addEventListener('click', dismiss, { once:true });
    setTimeout(dismiss, 2600);   // let everything appear + the chakra breathe before exit
  } catch(e){
    var el = document.getElementById('bootSplash');
    if(el && el.parentNode) el.remove();
  }
}

_migrateGreenToNvg();
applySettings();
renderHome();
_initDropZone();
GD.upgradeAll();
_initGestureNav();   // home swipe navigation + hint arrows
_bootSplash();   // cold-start avionics boot sequence (tap to skip)


// ════════════════════════════════════════════════════════════════════════
// GUIDED TUTORIAL (v2) — rewritten self-contained for maximum robustness.
// Everything (DOM, styling, handlers) is created at call time with inline
// styles, so it cannot be affected by stale external CSS. A small debug
// line on the card shows the build tag + what the current step targeted,
// to make any field issue diagnosable at a glance.
// ════════════════════════════════════════════════════════════════════════
var LOGITTA_ICON = 'data:image/png;base64,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';
var TUT_BUILD = 'v2.76';
var _tutStep = 0;
// Snapshot of data that existed before the tour (for end-of-tour cleanup).
var _tutPreAcIds = [], _tutPreEntryIds = [], _tutPreActiveId = null;

// Remove any aircraft + sortie the walkthrough created, and restore the
// previously-active aircraft. Lets the tour be hands-on with real data
// without leaving the user stuck with a sample aircraft/entry.
function _tutCleanupSampleData(){
  try {
    var acs = (getAC()||[]).filter(function(a){ return _tutPreAcIds.indexOf(a.id) !== -1; });
    setAC(acs);
  } catch(e){}
  try {
    var ents = (getEntries()||[]).filter(function(e){ return _tutPreEntryIds.indexOf(e.id) !== -1; });
    setEntries(ents);
  } catch(e){}
  try {
    // Restore prior active aircraft (or clear if there wasn't one / it's gone).
    var stillThere = (getAC()||[]).some(function(a){ return a.id === _tutPreActiveId; });
    setActiveAcId(stillThere ? _tutPreActiveId : null);
  } catch(e){}
  try { if(typeof renderAcList==='function') renderAcList(); } catch(e){}
  try { if(typeof renderHome==='function') renderHome(); } catch(e){}
}
var TUT_STEPS = [
  // ── Intro ──
  { title:'Welcome to Logitta',
    text:'A fully offline and secured app for logging \u2014 here to spare our fellow aviators the extra mental drag of keeping flying records. Let\u2019s get you up to speed.',
    screen:'home' },

  // ── Prior Experience setup ──
  { title:'Prior Experience', text:'This is where your flying history begins. We\u2019ll set up your aircraft and carried-forward hours here first. Tap to open it.',
    screen:'home', sel:'#navPrev' },
  { title:'Add Your Aircraft', text:'Tap New Entry to add an aircraft type with its carried-forward hours.',
    screen:'prev', sub:'list', sel:'.pe-actions .pe-action-btn:nth-child(1)' },
  { title:'Aircraft Type Name', text:'Type the aircraft name (e.g. ALH WSI, Chetak, Cheetah). This is required \u2014 then tap Next.',
    screen:'prev', sub:'name', sel:'#newAcInput', require:true },
  { title:'Carried-Forward \u2014 Day', text:'Enter your existing DAY hours \u2014 Dual, Pilot and Co-Pilot \u2014 as HH:MM. Leave blank where nil. Then tap Next.',
    screen:'prev', sub:'detail', before:function(){ try{ if(typeof buildDetailTable==='function' && !document.querySelector('#detailTableBody tr')) buildDetailTable(); }catch(e){} }, groupCat:'DAY' },
  { title:'Carried-Forward \u2014 Night', text:'Enter your existing NIGHT hours \u2014 Dual, Pilot and Co-Pilot. Leave blank where nil. Then tap Next.',
    screen:'prev', sub:'detail', groupCat:'NIGHT' },
  { title:'Carried-Forward \u2014 NVG', text:'Enter your existing Night Vision Goggle hours, if any. Then tap Next.',
    screen:'prev', sub:'detail', groupCat:'NVG' },
  { title:'Carried-Forward \u2014 Simulator', text:'Enter your existing simulator hours, if any. Then tap Next.',
    screen:'prev', sub:'detail', groupCat:'SIMULATOR' },
  { title:'Carried-Forward \u2014 Special', text:'Enter IMC, SIF, Instrument (Day/Night) and WSO hours, as applicable. Leave blank where nil. Then tap Next.',
    screen:'prev', sub:'detail', groupCat:'SPECIAL' },
  { title:'Save It', text:'Press Next \u2014 or tap the highlighted Save \u2014 to save the aircraft and its carried-forward hours. This opens the confirmation.',
    screen:'prev', sub:'detail', sel:'#sv_detail .confirm-btn',
    onNext:function(){ try{ var b=document.querySelector('#sv_detail .confirm-btn'); if(b) b.click(); }catch(e){} }, onNextDelay:320 },
  { title:'Confirm Save', text:'Logitta asks you to confirm. Press Next \u2014 or tap the highlighted \u201cYes, Save\u201d \u2014 to record the aircraft.',
    screen:'prev', sel:'#confirmPopup .popup-yes',
    onNext:function(){ try{ var b=document.querySelector('#confirmPopup .popup-yes'); if(b) b.click(); }catch(e){} }, onNextDelay:360 },

  // ── Branch: after save ──
  { title:'Set This Aircraft Active', text:'The aircraft you just entered now appears here. Tap the card to expand it.',
    screen:'prev', sub:'list', before:function(){ try{ renderAcList(); }catch(e){} },
    cond:function(){ try{ return getAC().length > 0; }catch(e){ return false; } },
    sel:'.ac-summary-card, #acListDisplay' },
  { title:'Make It Active', text:'Set the aircraft you just entered as active \u2014 tap the highlighted button. New sorties will be logged against it. This is required to continue.',
    cond:function(){ try{ return getAC().length > 0; }catch(e){ return false; } },
    screen:'prev', sub:'list', sel:'.ac-head-active-btn, #acListDisplay',
    requireCond:function(){ try{ return getActiveAcId() != null; }catch(e){ return false; } },
    requireMsg:'Tap the highlighted Set Active button to mark this aircraft active before continuing.' },
  { title:'Set Your Active Aircraft', text:'Once you\u2019ve added an aircraft, tap its card and use Set Active to mark the one you\u2019re currently flying.',
    cond:function(){ try{ return getAC().length === 0; }catch(e){ return true; } },
    screen:'prev', sub:'list', sel:'#acListDisplay, .pe-actions' },
  { title:'Edit Anytime', text:'You can edit the aircraft you just made \u2014 its name and hours \u2014 from Edit Entry here whenever you need.',
    screen:'prev', sub:'list', sel:'.pe-actions .pe-action-btn:nth-child(2)' },

  // ── New sortie entry (field by field) ──
  { title:'Make a New Entry', text:'With your prior experience set up, let\u2019s log a sortie. Tap Log Entry.',
    screen:'home', sel:'#navEntry' },
  { title:'Month', text:'Select the month of this sortie. Required \u2014 then tap Next.', screen:'entry', sel:'#f_month', require:true },
  { title:'Year', text:'Enter the year of this sortie. Required \u2014 then tap Next.', screen:'entry', sel:'#f_year', require:true },
  { title:'Date', text:'Enter the date of the sortie (1\u201331). Required \u2014 then tap Next.', screen:'entry', sel:'#f_date', require:true },
  { title:'Aircraft Type', text:'This is locked to your active aircraft. Change it by setting a different active aircraft in Prior Experience.',
    screen:'entry', sel:'#f_actype', require:true },
  { title:'Aircraft Number', text:'Enter the tail number. Required \u2014 then tap Next. Numbers you\u2019ve used before appear as suggestions.',
    screen:'entry', sel:'#f_acno', require:true },
  { title:'Pilot', text:'Enter the captain. Required \u2014 then tap Next. Saved names appear as suggestions; long-press one to edit or delete it.',
    screen:'entry', sel:'#f_pilot', require:true },
  { title:'Co-Pilot', text:'Enter the co-pilot. Required \u2014 then tap Next. Names are shared with the pilot list.',
    screen:'entry', sel:'#f_copilot', require:true },
  { title:'Route / From-To', text:'Record the route flown, from and to. Required \u2014 then tap Next.', screen:'entry', sel:'#f_route', require:true },
  { title:'Entry Type \u2014 Ink Colour', text:'Choose the ink colour for this entry, matching how you\u2019d write it in your paper logbook.',
    screen:'entry', sel:'#f_entrytype' },
  { title:'Day Hours', text:'Enter your day flying \u2014 Dual, Pilot and Co-Pilot. Leave blank where nil. Then tap Next.', screen:'entry', sel:'#row_day' },
  { title:'Night Hours', text:'Enter your night flying \u2014 Dual, Pilot and Co-Pilot. Leave blank where nil. Then tap Next.', screen:'entry', sel:'#row_night' },
  { title:'NVG', text:'Enter Night Vision Goggle hours flown, if any.', screen:'entry', sel:'#spl_nvg' },
  { title:'Special Hours', text:'Enter IMC, SIF, Instrument Day, Instrument Night and WSO hours, as applicable.',
    screen:'entry', sel:'.spl-grid' },
  { title:'Save the Sortie', text:'Press Next \u2014 or tap the highlighted Save \u2014 to save the sortie. This opens the confirmation. The Swipe-to-Reset beside it clears the form if you need to start over.',
    screen:'entry', sel:'.entry-action-bar .confirm-btn',
    onNext:function(){ try{ var b=document.querySelector('.entry-action-bar .confirm-btn'); if(b) b.click(); }catch(e){} }, onNextDelay:340 },
  { title:'Confirm the Sortie', text:'Logitta shows a summary to confirm. Press Next \u2014 or tap the highlighted \u201cSave\u201d \u2014 to record this sortie.',
    screen:'entry', sel:'#entryConfirmPopup .popup-yes',
    onNext:function(){ try{ var b=document.querySelector('#entryConfirmPopup .popup-yes'); if(b) b.click(); }catch(e){} }, onNextDelay:360 },

  // ── Logbook ──
  { title:'Review in the Logbook', text:'Let\u2019s review that the data entered is correct and check your overall figures. Tap Logbook.',
    screen:'home', sel:'#navLogbook' },
  { title:'Select the Month', text:'Choose the current month to see the sorties you entered. Required \u2014 then tap Next.',
    screen:'logbook', sel:'#lb_month', require:true },
  { title:'Search', text:'Search your sorties by pilot, route or aircraft number.', screen:'logbook', sel:'.lb-search-wrap, #lb_search' },
  { title:'Page Break', text:'Insert a page break in the middle of the log \u2014 handy for matching the layout of your paper logbook pages.',
    screen:'logbook', sel:'.lb-pb-wrap, #lb_pb_input' },
  { title:'Strike Off', text:'Strike off an entered row while writing it into your paper logbook, to avoid confusion over what\u2019s already transcribed.',
    screen:'logbook', sel:'.lb-strike-btn, .lb-table th:first-child, .topbar' },

  // ── Summary ──
  { title:'Summary', text:'Now to your performance at a glance. Everything here is computed for you. Tap Summary.',
    screen:'home', sel:'#navSummary' },
  { title:'Select Month & Year', text:'Select the month and year to set the period the summary is computed to. Monthly figures, cumulative totals, total flying hours and fatigue all follow this.',
    screen:'summary', sel:'.sum-picker-selects, #sumMonthSel, .topbar' },
  { title:'Fatigue Limit', text:'Enter the number of days over which you want to check your fatigue flying \u2014 your rolling hours for that window are shown.',
    screen:'summary', sel:'#heroRollingDays, .hero-row' },
  { title:'12-Month Trend', text:'View the roller-coaster of your flying hours across the past 12 months at a glance.',
    screen:'summary', sel:'.chart-card, .hero-row' },
  { title:'Recency Gauges', text:'These two gauges show your Day and Night Pilot recency against your Con-Trg requirement \u2014 green when current, red when lapsed. They are fully editable.',
    screen:'summary', sel:'.gauge-row, .captain-contrg' },
  { title:'Set Your Day Gauge', text:'Press Next to open the Day Pilot gauge. Inside you can set Pilot / Co-Pilot, the period, and your Con-Trg requirement (the red threshold). Editing is optional \u2014 just have a look.',
    screen:'summary', sel:".gauge-card:first-child, .gauge-row",
    onNext:function(){ try{ openGaugePicker('day'); }catch(e){} }, onNextDelay:340 },
  { title:'Apply or Cancel', text:'Adjust anything you like, then tap APPLY to save (or CANCEL to leave it unchanged).',
    screen:'summary', sel:'#gaugePickerPopup .popup-yes',
    onNext:function(){ try{ var b=document.querySelector('#gaugePickerPopup .popup-yes'); if(b) b.click(); }catch(e){} }, onNextDelay:300 },
  { title:'Night Gauge \u2014 Same Way', text:'The Night Pilot gauge works exactly the same way \u2014 tap it any time to set Pilot / Co-Pilot, period, Con-Trg requirement, and to show your NVG hours nested inside.',
    screen:'summary', sel:".gauge-card:nth-child(2), .gauge-row", noTap:true },
  { title:'Captain Con-Trg', text:'Below the gauges, your Captain Con-Trg shows Day + Night = Total. The bracketed Day and Night figures are tappable to set them as per your CAT IR.',
    screen:'summary', sel:'.captain-contrg, .gauge-row',
    before:function(){ try{ if(!_captainContrgOpen) toggleCaptainContrg(); }catch(e){} } },
  { title:'Check Your Day Con-Trg', text:'Tap the highlighted Day cell to set Pilot / Co-Pilot and the period as per your CAT IR. This one is optional \u2014 set it now or tap Next to move on.',
    screen:'summary', sel:'.captain-contrg-row .cc-cell.cc-tappable:first-child',
    before:function(){ try{ if(!_captainContrgOpen) toggleCaptainContrg(); }catch(e){} } },
  { title:'Set Your Night Con-Trg', text:'Press Next to open the Night Captain Con-Trg and set it as per your CAT IR.',
    screen:'summary', sel:'.captain-contrg-row .cc-cell.cc-tappable:nth-child(3)',
    before:function(){ try{ if(!_captainContrgOpen) toggleCaptainContrg(); }catch(e){} },
    onNext:function(){ try{ openCcPicker('night'); }catch(e){} }, onNextDelay:340 },
  { title:'Apply or Cancel', text:'Choose Pilot / Co-Pilot and the period, then tap APPLY (or CANCEL to leave it).',
    screen:'summary', sel:'#ccPickerPopup .popup-yes',
    onNext:function(){ try{ var b=document.querySelector('#ccPickerPopup .popup-yes'); if(b) b.click(); }catch(e){} }, onNextDelay:300 },
  { title:'Set Your SIF + IMC', text:'Press Next to open the SIF + IMC bar. Choose SIF / IMC, the period and the threshold that fills the bar \u2014 a quick visual of your instrument currency.',
    screen:'summary', sel:'.cc-sifimc-bar',
    before:function(){ try{ if(!_captainContrgOpen) toggleCaptainContrg(); }catch(e){} },
    onNext:function(){ try{ openSifImcPicker(); }catch(e){} }, onNextDelay:340 },
  { title:'Apply or Cancel', text:'Set it to your requirement, then tap APPLY (or CANCEL).',
    screen:'summary', sel:'#ccSifImcPopup .popup-yes',
    onNext:function(){ try{ var b=document.querySelector('#ccSifImcPopup .popup-yes'); if(b) b.click(); }catch(e){} }, onNextDelay:300 },
  { title:'Monthly & Cumulative', text:'Your monthly and cumulative summaries \u2014 by aircraft type and in aggregate \u2014 ready for review or for writing up your logbook.',
    screen:'summary', sel:'.sum-table-wrap' },
  { title:'Periodic Summary', text:'Select any period you need a cumulative summary for \u2014 ideal for year-end logbook completion or when posting out.',
    screen:'summary', sel:'.periodic-row, #periodicFrom, .sum-table-wrap' },

  // ── Sample data cleanup ──
  { title:'Sample Data', text:'During this walkthrough you created a sample aircraft and a sample sortie. Press Next to REMOVE them and start clean, or tap \u201cKeep\u201d to keep what you entered as real data.',
    screen:'home',
    onNext:function(){ try{ _tutCleanupSampleData(); }catch(e){} },
    altLabel:'Keep', altAction:function(){ /* keep — do nothing */ } },

  // ── Finish ──
  { title:'You\u2019re All Set', text:'Thank you for choosing Logitta \u2014 we hope you treat her well. Please share your valuable inputs with the developer, Samrat Singh Chauhan, on 9257692510. Thank you.',
    screen:'home' }
];

function _tutEl(id){ return document.getElementById(id); }

// Single guarded advance — prevents the double-step skip that happened when
// a tap on a highlighted nav element both fired the tap-handler AND raced
// with other timers. The lock is released once the next step has rendered.
var _tutAdvancing = false;
function _tutAdvance(){
  if(_tutAdvancing) return;       // ignore re-entrant / double fires
  _tutAdvancing = true;
  _tutUnbindTap();
  _tutStep++;
  if(_tutStep >= TUT_STEPS.length){ _tutEnd(); _tutAdvancing = false; return; }
  _tutRender();
  // Release the lock after the render's navigation + settle window so a
  // stray second tap during the transition can't skip a step.
  setTimeout(function(){ _tutAdvancing = false; }, 600);
}

// Step backward — mirror of _tutAdvance. Skips conditional steps that don't
// apply (in reverse) and stops at the first step (can't go before Welcome).
function _tutBack(){
  if(_tutAdvancing) return;
  if(_tutStep <= 0) return;          // already at the first step
  _tutAdvancing = true;
  _tutUnbindTap();
  _tutStep--;
  // Skip backward over any conditional step that doesn't currently apply.
  while(_tutStep > 0){
    var s = TUT_STEPS[_tutStep];
    var ok = true;
    try { if(s && typeof s.cond === 'function') ok = !!s.cond(); } catch(e){ ok = true; }
    if(ok) break;
    _tutStep--;
  }
  _tutRender();
  setTimeout(function(){ _tutAdvancing = false; }, 600);
}

function startTutorial(){
  try {
    // Remove any prior instance
    var old = _tutEl('tutOverlay'); if(old) old.remove();
    _tutStep = 0;
    // Snapshot the aircraft + entry IDs that existed BEFORE the tour, so at
    // the end we can offer to remove anything the walkthrough created (so the
    // user isn't left with stuck sample data). Also remember the prior active
    // aircraft so we can restore it.
    try {
      _tutPreAcIds = (getAC()||[]).map(function(a){ return a.id; });
      _tutPreEntryIds = (getEntries()||[]).map(function(e){ return e.id; });
      _tutPreActiveId = (typeof getActiveAcId==='function') ? getActiveAcId() : null;
    } catch(e){ _tutPreAcIds=[]; _tutPreEntryIds=[]; _tutPreActiveId=null; }
    try { if(typeof closeSettings === 'function') closeSettings(); } catch(e){}

    // Build overlay fresh, fully inline-styled.
    var ov = document.createElement('div');
    ov.id = 'tutOverlay';
    ov.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483600;pointer-events:none;';

    var spot = document.createElement('div');
    spot.id = 'tutSpot';
    spot.style.cssText = 'position:fixed;border-radius:12px;border:2.5px solid #e8c96d;box-shadow:0 0 18px 6px rgba(201,168,76,.35), 0 0 4px 1px rgba(201,168,76,.55);pointer-events:none;opacity:0;transition:top .25s ease,left .25s ease,width .25s ease,height .25s ease,opacity .2s ease;';

    // Wave ring — sits over the spotlight and pulses outward in the accent
    // colour. Separate element so its scale animation doesn't disturb the
    // spotlight box-shadow. pointer-events:none so taps pass through to the
    // real highlighted element beneath.
    var wave = document.createElement('div');
    wave.id = 'tutWave';
    wave.style.cssText = 'position:fixed;border-radius:18px;pointer-events:none;opacity:0;box-shadow:0 0 26px 12px rgba(201,168,76,.30);filter:blur(2px);';

    // Inject the wave keyframes once (inline module is CSS-independent, but
    // @keyframes must live in a <style>; this is self-contained and removed
    // with the overlay).
    if(!document.getElementById('tutKeyframes')){
      var kf = document.createElement('style');
      kf.id = 'tutKeyframes';
      kf.textContent = '@keyframes tutWavePulse{0%,100%{opacity:.45}50%{opacity:.9}}' +
        '@keyframes tutCrestFloat{0%,100%{transform:translateY(0) scale(1);box-shadow:0 0 12px rgba(201,168,76,.35)}50%{transform:translateY(-3px) scale(1.05);box-shadow:0 0 20px rgba(201,168,76,.6)}}';
      document.head.appendChild(kf);
    }

    var card = document.createElement('div');
    card.id = 'tutCard';
    card.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);width:calc(100% - 32px);max-width:380px;max-height:70vh;overflow-y:auto;background:#0f1726;border:1px solid rgba(201,168,76,.5);border-radius:16px;padding:18px;box-shadow:0 18px 48px rgba(0,0,0,.6);pointer-events:auto;z-index:2147483601;';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">' +
        '<img id="tutCrest" alt="Logitta" style="width:48px;height:48px;border-radius:50%;object-fit:cover;flex:0 0 auto;border:1.5px solid rgba(201,168,76,.55);box-shadow:0 0 12px rgba(201,168,76,.35);">' +
        '<div style="flex:1;min-width:0;">' +
          '<div id="tutCount" style="font-family:monospace;font-size:11px;letter-spacing:2px;color:#c9a84c;opacity:.7;margin-bottom:2px;"></div>' +
          '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:14px;letter-spacing:2px;color:#e8c96d;text-transform:uppercase;">Logitta</div>' +
        '</div>' +
      '</div>' +
      '<div id="tutTitle" style="font-family:\'Bebas Neue\',sans-serif;font-size:24px;letter-spacing:1.5px;color:#e8c96d;text-transform:uppercase;line-height:1.1;margin-bottom:8px;"></div>' +
      '<div id="tutText" style="font-family:\'Rajdhani\',sans-serif;font-size:15px;font-weight:500;line-height:1.45;color:#e8eef6;margin-bottom:14px;"></div>' +
      '<div id="tutDbg" style="font-family:monospace;font-size:9px;color:#5a6b80;margin-bottom:12px;"></div>' +
      '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center;">' +
        '<button id="tutClose" type="button" style="font-family:monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;padding:12px 14px;border-radius:10px;background:transparent;border:1px solid rgba(201,168,76,.35);color:#9fb0c4;cursor:pointer;pointer-events:auto;">Close</button>' +
        '<div id="tutNavGroup" style="display:flex;gap:8px;">' +
          '<button id="tutPrev" type="button" style="font-family:monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;padding:12px 16px;border-radius:10px;background:transparent;border:1px solid rgba(201,168,76,.45);color:#c9a84c;cursor:pointer;pointer-events:auto;min-width:78px;">Previous</button>' +
          '<button id="tutNext" type="button" style="font-family:monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;padding:12px 18px;border-radius:10px;background:linear-gradient(135deg,#c9a84c,#e8c96d);border:none;color:#0a1018;cursor:pointer;pointer-events:auto;min-width:84px;">Next</button>' +
        '</div>' +
        '<button id="tutBackTo" type="button" style="display:none;font-family:monospace;font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:700;padding:12px 18px;border-radius:10px;background:linear-gradient(135deg,#c9a84c,#e8c96d);border:none;color:#0a1018;cursor:pointer;pointer-events:auto;min-width:120px;">↩ Get Back</button>' +
      '</div>';

    ov.appendChild(spot);
    ov.appendChild(wave);
    ov.appendChild(card);
    document.body.appendChild(ov);

    // Logitta herself appears in the card with a gentle float + glow.
    try {
      var crestEl = _tutEl('tutCrest');
      if(crestEl){
        crestEl.src = LOGITTA_ICON;
        crestEl.style.animation = 'tutCrestFloat 3.2s ease-in-out infinite';
      }
    } catch(e){}

    _tutEl('tutNext').onclick = function(){
      try{ if(navigator.vibrate) navigator.vibrate(8); }catch(e){}
      var step = TUT_STEPS[_tutStep];
      var x = _tutEl('tutText');
      // Read the current field's value (if this step targets a field).
      var hasVal = true;
      if(_tutCurField){
        var v = '';
        try { v = (_tutCurField.value || '').trim(); } catch(e){}
        hasVal = (v !== '');
      }
      // REQUIRED steps (data must be entered — nil not acceptable): hard
      // block. Won't advance until the field has a value.
      if(step && step.require && _tutCurField && !hasVal){
        try{ if(navigator.vibrate) navigator.vibrate([20,40,20]); }catch(e){}
        if(x){
          if(!_tutReqShown){ _tutReqShown = true; _tutPrevText = x.textContent; }
          x.textContent = 'Please enter this before continuing — it\u2019s required for a valid entry.';
        }
        try { _tutCurField.focus(); } catch(e){}
        return;  // stay on this step
      }
      // REQUIRED ACTION steps (e.g. Set Active): block until the condition is
      // met (the action has been performed during the walkthrough).
      if(step && typeof step.requireCond === 'function'){
        var ok = false; try { ok = !!step.requireCond(); } catch(e){ ok = false; }
        if(!ok){
          try{ if(navigator.vibrate) navigator.vibrate([20,40,20]); }catch(e){}
          if(x){
            if(!_tutReqShown){ _tutReqShown = true; _tutPrevText = x.textContent; }
            x.textContent = step.requireMsg || 'Please complete this step before continuing.';
          }
          return;  // stay on this step
        }
      }
      // OPTIONAL field steps (nil acceptable): one-time gentle notice that
      // they can fill now or amend later, then advance on the next press.
      if(step && !step.require && _tutCurField && !hasVal && !_tutNoticeShown){
        _tutNoticeShown = true;
        if(x){ _tutPrevText = x.textContent;
          x.textContent = 'You can enter this now — or leave it and amend later after the tutorial. Tap Next again to continue.'; }
        return;
      }
      // ACTION steps: pressing Next performs a real action (e.g. clicking the
      // Save button or the confirm-popup YES) before advancing the tour.
      if(step && typeof step.onNext === 'function'){
        try { step.onNext(); } catch(e){}
        // Give the app a beat to open its popup / update state, then advance.
        setTimeout(function(){ _tutAdvance(); }, step.onNextDelay || 260);
        return;
      }
      _tutAdvance();
    };
    _tutEl('tutPrev').onclick = function(){ try{ if(navigator.vibrate) navigator.vibrate(8); }catch(e){} _tutBack(); };
    _tutEl('tutClose').onclick = function(){ _tutEnd(); };
    _tutEl('tutBackTo').onclick = function(){
      try{ if(navigator.vibrate) navigator.vibrate(8); }catch(e){}
      _tutDiverted = false;
      _tutRender();   // re-render the current step (navigates back to it)
    };

    _tutStartDivertWatch();
    _tutRender();
  } catch(err){
    alert('Tutorial error: ' + err.message);
  }
}

function _tutEnd(){
  _tutUnbindTap();
  _tutStopTracking();
  _tutStopDivertWatch();
  var ov = _tutEl('tutOverlay');
  if(ov) ov.remove();
  var kf = _tutEl('tutKeyframes');
  if(kf) kf.remove();
}

function _tutRender(){
  var step = TUT_STEPS[_tutStep];
  if(!step){ _tutEnd(); return; }

  // Conditional steps: if a step defines cond() and it returns false, skip
  // it (forward). Used for the branch after Save — e.g. show the "expand the
  // entry & set active" step only if an aircraft exists, otherwise show the
  // "you'll set it active once added" step instead.
  try {
    if(typeof step.cond === 'function' && !step.cond()){
      _tutStep++;
      if(_tutStep >= TUT_STEPS.length){ _tutEnd(); return; }
      _tutRender();
      return;
    }
  } catch(e){}

  // Immediately hide the spotlight/wave and unbind the old tap target so the
  // outline never lingers in its previous position while the next screen
  // loads (the fix for the "highlight stays where it was on the next page"
  // bug). It will be repositioned by _tutSpotlight once the new step shows.
  _tutUnbindTap();
  _tutStopTracking();
  _tutNoticeShown = false;
  _tutReqShown = false;
  // Exit divert mode and restore the normal Next/Previous buttons; record
  // this step's expected screen + sub-view for the divert watcher.
  _tutDiverted = false;
  _tutExpScreen = step.screen || null;
  _tutExpSub = step.sub || null;
  var _grp = _tutEl('tutNavGroup'), _back = _tutEl('tutBackTo');
  if(_grp) _grp.style.display = 'flex';
  if(_back) _back.style.display = 'none';
  var _s = _tutEl('tutSpot'), _w = _tutEl('tutWave');
  if(_s){ _s.style.opacity = '0'; _s.style.width = '0px'; _s.style.height = '0px'; }
  if(_w){ _w.style.opacity = '0'; _w.style.animation = 'none'; }

  var show = function(){
    var c = _tutEl('tutCount'), t = _tutEl('tutTitle'), x = _tutEl('tutText'),
        n = _tutEl('tutNext'), d = _tutEl('tutDbg');
    if(c) c.textContent = (_tutStep+1) + ' / ' + TUT_STEPS.length;
    if(t) t.textContent = step.title || '';
    if(x) x.textContent = step.text || '';
    if(n) n.textContent = (_tutStep === TUT_STEPS.length-1) ? 'Finish' : 'Next';
    var pv = _tutEl('tutPrev');
    if(pv){
      if(step.altLabel){
        // Repurpose the Previous slot as the step's alternate action button
        // (e.g. "Keep" on the sample-data cleanup step).
        pv.style.visibility = 'visible';
        pv.textContent = step.altLabel;
        pv.onclick = function(){
          try{ if(navigator.vibrate) navigator.vibrate(8); }catch(e){}
          try { if(typeof step.altAction === 'function') step.altAction(); } catch(e){}
          _tutAdvance();
        };
      } else {
        pv.textContent = 'Previous';
        pv.onclick = function(){ try{ if(navigator.vibrate) navigator.vibrate(8); }catch(e){} _tutBack(); };
        pv.style.visibility = (_tutStep <= 0) ? 'hidden' : 'visible';
      }
    }

    // Resolve target via the descriptor resolver (supports selectors AND
    // detail-table category groups). Store it for the Next handler's
    // require/notice checks.
    var target = _tutResolveTarget(step);
    _tutCurTarget = target;
    if(d){
      var lbl = step.groupCat ? ('group:'+step.groupCat) : (step.sel ? step.sel.split(',')[0].trim() : 'intro step');
      d.textContent = TUT_BUILD + ' · ' + (target ? 'found: '+lbl : (step.sel||step.groupCat ? 'NOT FOUND: '+lbl : lbl));
    }

    _tutSpotlight(target);
  };

  // Screen change first if needed, then sub-view (Prior Experience), then show.
  var needScreen = step.screen && typeof go === 'function' && typeof curScreen !== 'undefined' && curScreen !== step.screen;
  var runBeforeAndSub = function(){
    // Prior-Experience sub-view navigation first (list / name / detail), so
    // the correct sub-view is active, then the optional before() hook (e.g.
    // renderAcList) populates it.
    if(step.sub && typeof showSubview === 'function'){
      try { showSubview(step.sub); } catch(e){}
    }
    if(typeof step.before === 'function'){ try { step.before(); } catch(e){} }
  };
  if(needScreen){
    try{ go(step.screen); }catch(e){}
    setTimeout(function(){ runBeforeAndSub(); setTimeout(show, 220); }, 360);
    _tutSettleUntil = Date.now() + 1100;   // grace window: ignore divert while navigating
  } else {
    runBeforeAndSub();
    setTimeout(show, step.sub ? 220 : 40);
    _tutSettleUntil = Date.now() + (step.sub ? 700 : 400);
  }
}

// Track the element currently wired for tap-to-advance so we can unbind it.
var _tutTapEl = null;
var _tutTapHandler = null;

// Find the detail-table rows belonging to one category (DAY/NIGHT/NVG/etc.).
// Returns the category header row plus its field rows, up to the next header.
function _tutCatRows(catName){
  var body = document.getElementById('detailTableBody');
  if(!body) return [];
  var rows = body.querySelectorAll('tr');
  var out = [], capturing = false;
  for(var i=0;i<rows.length;i++){
    var tr = rows[i];
    var isCat = tr.classList.contains('cat-row');
    if(isCat){
      var label = (tr.textContent||'').trim().toUpperCase();
      if(capturing) break;                 // reached the next category — stop
      if(label.indexOf(catName.toUpperCase()) === 0 || label === catName.toUpperCase()){
        capturing = true; out.push(tr); continue;
      }
    }
    if(capturing) out.push(tr);
  }
  return out;
}

// Combined bounding rect (viewport coords) of a set of elements.
function _tutRowsRect(rows){
  var top=1e9, left=1e9, right=-1e9, bottom=-1e9;
  for(var i=0;i<rows.length;i++){
    var r = rows[i].getBoundingClientRect();
    if(r.top<top) top=r.top;
    if(r.left<left) left=r.left;
    if(r.right>right) right=r.right;
    if(r.bottom>bottom) bottom=r.bottom;
  }
  return { top:top, left:left, width:right-left, height:bottom-top, bottom:bottom, right:right };
}

// Resolve a step to a target descriptor used by _tutSpotlight.
// Returns null if nothing found. Descriptor: {getRect, scrollEl, fieldEl,
// isField, tapEl}.
function _tutResolveTarget(step){
  // Category group in the Prior-Experience detail table.
  if(step.groupCat){
    var rows = _tutCatRows(step.groupCat);
    if(rows.length){
      return {
        getRect: function(){ return _tutRowsRect(rows); },
        scrollEl: rows[0],
        fieldEl: null,            // hour groups: nil acceptable, never required
        isField: true,            // don't tap-advance; user types then Next
        tapEl: null
      };
    }
    return null;
  }
  if(step.sel){
    var parts = step.sel.split(',');
    for(var i=0;i<parts.length;i++){
      var el = null;
      try { el = document.querySelector(parts[i].trim()); } catch(e){}
      if(el){
        var tag = (el.tagName||'').toLowerCase();
        var inner = el.querySelector && el.querySelector('input,select,textarea');
        var isField = (tag==='input'||tag==='select'||tag==='textarea'||!!inner);
        return {
          getRect: function(){ return el.getBoundingClientRect(); },
          scrollEl: el,
          fieldEl: isField ? (inner||el) : null,
          isField: isField,
          // noTap steps (e.g. Save) are highlighted but advance only via Next.
          tapEl: (isField || step.noTap) ? null : el
        };
      }
    }
  }
  return null;
}

function _tutAccent(){
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
    return v || '#c9a84c';
  } catch(e){ return '#c9a84c'; }
}
function _tutAccentRgb(){
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    return v || '201,168,76';
  } catch(e){ return '201,168,76'; }
}

function _tutUnbindTap(){
  if(_tutTapEl && _tutTapHandler){
    try { _tutTapEl.removeEventListener('click', _tutTapHandler, true); } catch(e){}
  }
  _tutTapEl = null; _tutTapHandler = null;
}

function _tutSpotlight(target){
  var spot = _tutEl('tutSpot'), card = _tutEl('tutCard'), wave = _tutEl('tutWave');
  if(!spot || !card) return;

  // Always unbind any previous tap target + scroll tracker first.
  _tutUnbindTap();
  _tutStopTracking();

  if(!target){
    spot.style.opacity = '0';
    spot.style.width = '0px'; spot.style.height = '0px';
    if(wave){ wave.style.opacity = '0'; wave.style.animation = 'none'; }
    // Centered card for intro/finish steps.
    card.style.left = '50%';
    card.style.transform = 'translateX(-50%)';
    card.style.top = 'auto';
    card.style.bottom = '24px';
    _tutCurField = null;
    return;
  }

  var accent = _tutAccent();
  var accentRgb = _tutAccentRgb();
  spot.style.borderColor = accent;
  spot.style.boxShadow = '0 0 18px 6px rgba(' + accentRgb + ',.35), 0 0 4px 1px rgba(' + accentRgb + ',.55)';
  if(wave) wave.style.boxShadow = '0 0 26px 12px rgba(' + accentRgb + ',.30)';

  // Reposition — recalculated from the LIVE rect every time via the target's
  // getRect(), so it tracks the element/group on scroll or resize.
  var reposition = function(){
    var r;
    try { r = target.getRect(); } catch(e){ return; }
    if(!r) return;
    var pad = 8;
    var top = r.top - pad, left = r.left - pad;
    var w = r.width + pad*2, h = r.height + pad*2;
    spot.style.opacity = '1';
    spot.style.top = top + 'px';
    spot.style.left = left + 'px';
    spot.style.width = w + 'px';
    spot.style.height = h + 'px';
    if(wave){
      var gpad = 6;
      wave.style.top = (top - gpad) + 'px';
      wave.style.left = (left - gpad) + 'px';
      wave.style.width = (w + gpad*2) + 'px';
      wave.style.height = (h + gpad*2) + 'px';
      wave.style.opacity = '1';
    }
    // Card: horizontally centered on the SCREEN; top or bottom edge, opposite
    // the highlighted item so it never covers it.
    var vh = window.innerHeight;
    card.style.left = '50%';
    card.style.transform = 'translateX(-50%)';
    var elCenterY = r.top + r.height/2;
    if(elCenterY < vh/2){
      card.style.top = 'auto';
      card.style.bottom = 'calc(24px + env(safe-area-inset-bottom, 0px))';
    } else {
      card.style.bottom = 'auto';
      card.style.top = 'calc(24px + env(safe-area-inset-top, 0px))';
    }
  };

  if(target.scrollEl){ try { target.scrollEl.scrollIntoView({block:'center'}); } catch(e){} }
  setTimeout(function(){
    reposition();
    if(wave){
      wave.style.animation = 'none';
      void wave.offsetWidth;
      wave.style.animation = 'tutWavePulse 2.6s ease-in-out infinite';
    }
    _tutTrackFn = function(){ try { reposition(); } catch(e){} };
    window.addEventListener('scroll', _tutTrackFn, true);
    window.addEventListener('resize', _tutTrackFn, true);

    // Field reference (for require/notice checks) and tap-to-advance binding.
    _tutCurField = target.fieldEl || null;
    if(!target.isField && target.tapEl){
      _tutTapEl = target.tapEl;
      _tutTapHandler = function(){ setTimeout(function(){ _tutAdvance(); }, 140); };
      target.tapEl.addEventListener('click', _tutTapHandler, true);
    }
  }, 120);
}

// Scroll/resize tracking teardown.
var _tutTrackEl = null, _tutTrackFn = null, _tutCurField = null, _tutCurTarget = null;
var _tutNoticeShown = false, _tutPrevText = '', _tutReqShown = false;

// ── Divert detection ──
// If the user navigates away from the screen/sub-view the current step
// expects (e.g. taps Edit instead of New Entry), we hide the highlight and
// swap Next/Previous for a single "Get Back" button that returns them to the
// step they left. _tutExpScreen / _tutExpSub hold the current step's expected
// location; _tutDiverted tracks whether we're currently off-track.
var _tutExpScreen = null, _tutExpSub = null, _tutDiverted = false, _tutDivertTimer = null, _tutSettleUntil = 0;

function _tutCurSub(){
  try { var a = document.querySelector('#prev .subview.active'); return a ? a.id.replace('sv_','') : null; }
  catch(e){ return null; }
}

function _tutStartDivertWatch(){
  if(_tutDivertTimer) return;
  _tutDivertTimer = setInterval(function(){
    if(!_tutEl('tutOverlay')) return;        // tour ended
    if(_tutExpScreen == null) return;        // intro/finish — no expectation
    if(_tutDiverted) return;                 // already handled
    if(Date.now() < _tutSettleUntil) return; // within post-render grace window
    var scrOk = (typeof curScreen === 'undefined') || (curScreen === _tutExpScreen);
    var subOk = true;
    if(_tutExpSub){ subOk = (_tutCurSub() === _tutExpSub); }
    // While a save-confirm popup is open, the screen technically hasn't
    // changed; don't treat that as a divert.
    if(!scrOk || !subOk){ _tutEnterDivert(); }
  }, 450);
}
function _tutStopDivertWatch(){
  if(_tutDivertTimer){ clearInterval(_tutDivertTimer); _tutDivertTimer = null; }
}

function _tutEnterDivert(){
  _tutDiverted = true;
  // Hide the highlight + stop tracking so it can't linger on the old screen.
  _tutUnbindTap(); _tutStopTracking();
  var s = _tutEl('tutSpot'), w = _tutEl('tutWave');
  if(s){ s.style.opacity = '0'; s.style.width = '0px'; s.style.height = '0px'; }
  if(w){ w.style.opacity = '0'; w.style.animation = 'none'; }
  // Swap the buttons: hide Next/Previous, show Get Back. Centre the card.
  var grp = _tutEl('tutNavGroup'), back = _tutEl('tutBackTo'), card = _tutEl('tutCard');
  if(grp) grp.style.display = 'none';
  if(back) back.style.display = 'block';
  if(card){ card.style.left='50%'; card.style.transform='translateX(-50%)'; card.style.top='auto'; card.style.bottom='24px'; }
  var t = _tutEl('tutTitle'), x = _tutEl('tutText');
  var step = TUT_STEPS[_tutStep] || {};
  if(t) t.textContent = 'Paused';
  if(x) x.textContent = 'Looks like you\u2019ve stepped away from the walkthrough to explore. Tap \u201cGet Back\u201d when you\u2019re ready to continue from where you left off (' + (step.title||'') + ').';
}

function _tutStopTracking(){
  if(_tutTrackFn){
    try { window.removeEventListener('scroll', _tutTrackFn, true); } catch(e){}
    try { window.removeEventListener('resize', _tutTrackFn, true); } catch(e){}
  }
  _tutTrackEl = null; _tutTrackFn = null;
}


// ============================================================
// PWA & SYNC MODAL INTEGRATION
// ============================================================
function _initSW(){
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('Logitta: Service Worker registered', reg.scope);
    }).catch((err) => {
      console.warn('Logitta: Service Worker registration failed', err);
    });
  }
}
if (document.readyState === 'complete' || document.readyState === 'interactive') { _initSW(); } else { window.addEventListener('load', _initSW); }

try { _restoreFromVaultIfNeeded(); } catch(e){}

if (window.LogittaSync && typeof window.LogittaSync.init === 'function') {
  try { window.LogittaSync.init(); } catch(e){}
}

function openSyncModal(){
  closeSettings();
  const modal = document.getElementById('syncModal');
  if(modal){
    modal.classList.add('active');
    if(window.LogittaSync){
      const settings = window.LogittaSync.getSettings();
      const codeInp = document.getElementById('syncVaultCode');
      if(codeInp && settings.vaultCode) codeInp.value = settings.vaultCode;
      const last = window.LogittaSync.getLastSyncTime();
      const lastLbl = document.getElementById('syncLastTime');
      if(lastLbl) lastLbl.textContent = last ? new Date(last).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Never';
    }
  }
}

function closeSyncModal(){
  const modal = document.getElementById('syncModal');
  if(modal) modal.classList.remove('active');
}

function saveSyncVaultCode(val){
  if(window.LogittaSync){
    window.LogittaSync.saveSettings({ vaultCode: (val||'').trim().toUpperCase() });
  }
}

function generateVaultCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'LOGITTA-';
  for(let i=0; i<6; i++){
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const inp = document.getElementById('syncVaultCode');
  if(inp){
    inp.value = code;
    saveSyncVaultCode(code);
  }
  showToast('Generated code: ' + code);
}

async function doSyncNow(){
  const syncObj = window.LogittaSync || window.ELogSync;
  if(!syncObj) return;
  const btn = document.getElementById('syncMasterBtn');
  if(btn) { btn.disabled = true; btn.textContent = 'SYNCING...'; }
  try {
    const res = await syncObj.triggerSync();
    if(res && res.message) showToast(res.message);
  } catch(err){
    console.error(err);
    showToast(err.message || 'Sync failed', true);
  } finally {
    if(btn) { btn.disabled = false; btn.innerHTML = '<svg class="ico ico-mr" aria-hidden="true"><use href="#i-cloud-sync"/></svg><span>SYNC & EXPORT NOW</span>'; }
  }
}

async function doVaultUpload(){
  if(!window.LogittaSync) return;
  const code = (document.getElementById('syncVaultCode')?.value || '').trim();
  if(!code){ showToast('Please enter a Sync Code first', true); return; }
  saveSyncVaultCode(code);
  try {
    showToast('Uploading to cloud...');
    const res = await window.LogittaSync.syncCloudVault('upload');
    showToast(res.message);
  } catch(e){ showToast(e.message || 'Upload failed', true); }
}

async function doVaultDownload(){
  if(!window.LogittaSync) return;
  const code = (document.getElementById('syncVaultCode')?.value || '').trim();
  if(!code){ showToast('Please enter a Sync Code first', true); return; }
  saveSyncVaultCode(code);
  try {
    showToast('Downloading from cloud...');
    const res = await window.LogittaSync.syncCloudVault('download');
    showToast(res.message);
  } catch(e){ showToast(e.message || 'Download failed', true); }
}

async function doDriveSave(){
  if(!window.LogittaSync) return;
  try {
    const res = await window.LogittaSync.saveToDriveFiles();
    if(res && !res.cancelled){ showToast(res.message); }
  } catch(e){ showToast(e.message || 'Drive save failed', true); }
}

async function doDriveLoad(evt){
  if(!window.LogittaSync) return;
  const file = evt.target.files?.[0];
  if(!file) return;
  try {
    const res = await window.LogittaSync.loadFromDriveFiles(file);
    showToast(res.message);
    closeSyncModal();
  } catch(e){ showToast(e.message || 'Failed to load file', true); }
  finally { evt.target.value = ''; }
}
