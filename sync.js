/**
 * Logitta Sync Engine
 * Handles Offline-first data synchronization:
 *  1. Cloud Vault (Instant Multi-Device Sync via Sync Code)
 *  2. Google Drive / iCloud Files Sync (Export & Import)
 *  3. Sortie-Level Intelligent Merging (Zero Data Loss)
 */
const LogittaSync = (function () {
  const K_SYNC_SETTINGS = 'lg_sync_settings_v1';
  const K_LAST_SYNC_TIME = 'lg_last_sync_time_v1';
  const K_SYNC_STATE = 'lg_sync_state_v1';

  let _syncSettings = {
    mode: 'auto',
    vaultCode: 'LOGITTA',
    autoExportFile: true,
    endpoint: ''
  };

  let _syncState = {
    unsyncedCount: 0,
    unsyncedSince: null,
    lastChangeAt: null,
    lastIcloudAt: null,
    lastDriveAt: null,
    lastDownloadAt: null,
    changeSeq: 0,
    icloudSeq: -1,
    driveSeq: -1
  };

  let _isSyncing = false;
  let _hasUnsynced = false;

  function loadSyncState() {
    try {
      const raw = localStorage.getItem(K_SYNC_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          _syncState = { ..._syncState, ...parsed };
        }
      }
    } catch (_) {}
    _syncState.unsyncedCount = Math.max(0, Number(_syncState.unsyncedCount) || 0);
    _syncState.changeSeq = Math.max(0, Number(_syncState.changeSeq) || 0);
    _syncState.icloudSeq = _syncState.icloudSeq == null ? null : Number(_syncState.icloudSeq);
    _syncState.driveSeq = _syncState.driveSeq == null ? null : Number(_syncState.driveSeq);
    _hasUnsynced = _syncState.unsyncedCount > 0;
  }

  function saveSyncState() {
    _hasUnsynced = _syncState.unsyncedCount > 0;
    try {
      localStorage.setItem(K_SYNC_STATE, JSON.stringify(_syncState));
    } catch (_) {}
  }

  function init() {
    loadSettings();
    loadSyncState();
    updateUI();
    window.addEventListener('online', () => updateConnectionStatus(true));
    window.addEventListener('offline', () => updateConnectionStatus(false));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(K_SYNC_SETTINGS);
      if (raw) _syncSettings = { ..._syncSettings, ...JSON.parse(raw) };
    } catch (_) {}
    if (!_syncSettings.vaultCode) _syncSettings.vaultCode = 'LOGITTA';
  }

  function saveSettings(newSettings) {
    _syncSettings = { ..._syncSettings, ...newSettings };
    try {
      localStorage.setItem(K_SYNC_SETTINGS, JSON.stringify(_syncSettings));
    } catch (_) {}
    updateUI();
  }

  function getSettings() {
    return { ..._syncSettings };
  }

  function isTargetFresh(targetIso, targetSeq) {
    if (!targetIso) return false;
    if (typeof targetSeq === 'number' && !isNaN(targetSeq)) {
      return targetSeq >= (_syncState.changeSeq || 0);
    }
    if ((_syncState.unsyncedCount || 0) > 0) return false;
    if (!_syncState.lastChangeAt) return true;
    const tTarget = new Date(targetIso).getTime();
    const tChange = new Date(_syncState.lastChangeAt).getTime();
    if (isNaN(tTarget) || isNaN(tChange)) return true;
    return tTarget >= tChange;
  }

  function markUnsynced() {
    const now = new Date().toISOString();
    _syncState.unsyncedCount = Math.max(0, Number(_syncState.unsyncedCount) || 0) + 1;
    _syncState.changeSeq = Math.max(0, Number(_syncState.changeSeq) || 0) + 1;
    if (!_syncState.unsyncedSince) _syncState.unsyncedSince = now;
    _syncState.lastChangeAt = now;
    _hasUnsynced = true;
    saveSyncState();
    updateUI();
  }

  function markSynced(target) {
    const now = new Date().toISOString();
    const seq = Math.max(0, Number(_syncState.changeSeq) || 0);
    _syncState.unsyncedCount = 0;
    _syncState.unsyncedSince = null;
    if (target === 'icloud') {
      _syncState.lastIcloudAt = now;
      _syncState.icloudSeq = seq;
    } else if (target === 'drive') {
      _syncState.lastDriveAt = now;
      _syncState.driveSeq = seq;
    } else if (target === 'download') {
      _syncState.lastDownloadAt = now;
    } else if (target === 'both') {
      _syncState.lastIcloudAt = now;
      _syncState.lastDriveAt = now;
      _syncState.icloudSeq = seq;
      _syncState.driveSeq = seq;
    }
    _hasUnsynced = false;
    try {
      localStorage.setItem(K_LAST_SYNC_TIME, now);
    } catch (_) {}
    saveSyncState();
    updateUI();
  }

  function resetState() {
    _syncState = {
      unsyncedCount: 0,
      unsyncedSince: null,
      lastChangeAt: null,
      lastIcloudAt: null,
      lastDriveAt: null,
      lastDownloadAt: null,
      changeSeq: 0,
      icloudSeq: -1,
      driveSeq: -1
    };
    _hasUnsynced = false;
    try {
      localStorage.removeItem(K_SYNC_STATE);
      localStorage.removeItem(K_LAST_SYNC_TIME);
    } catch (_) {}
    updateUI();
  }

  function getLastSyncTime() {
    try {
      return localStorage.getItem(K_LAST_SYNC_TIME) || null;
    } catch (_) {
      return null;
    }
  }

  function getSyncSummary() {
    return {
      ..._syncState,
      hasUnsynced: _syncState.unsyncedCount > 0,
      lastBackupAt: getLastSyncTime(),
      icloudFresh: isTargetFresh(_syncState.lastIcloudAt, _syncState.icloudSeq),
      driveFresh: isTargetFresh(_syncState.lastDriveAt, _syncState.driveSeq)
    };
  }

  function updateConnectionStatus() {
    updateUI();
  }

  function updateSyncPill(state, text) {
    const dot = document.getElementById('syncStatusDot');
    const txt = document.getElementById('syncStatusText');
    const homeBtnDot = document.getElementById('homeSyncDot');

    if (dot) dot.className = 'sync-status-dot ' + state;
    if (txt) txt.textContent = text;
    if (homeBtnDot) homeBtnDot.className = 'home-sync-dot ' + state;
  }

  // Build the complete export payload
  function buildPayload() {
    return {
      app: 'Logitta',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: typeof window.getSettings === 'function' ? window.getSettings() : {},
      aircraft: typeof window.getAC === 'function' ? window.getAC() : [],
      entries: typeof window.getEntries === 'function' ? window.getEntries() : [],
      nameSuggestions: typeof window.getNames === 'function' ? window.getNames() : [],
      acnoSuggestions: typeof window.getAcnos === 'function' ? window.getAcnos() : [],
    };
  }

  // Intelligent merge between local data and remote data
  function mergePayloads(localData, remoteData) {
    if (!remoteData || (remoteData.app !== 'Logitta' && remoteData.app !== 'E-LOG')) {
      throw new Error('Invalid Logitta backup file format');
    }

    const localEntries = Array.isArray(localData.entries) ? localData.entries : [];
    const remoteEntries = Array.isArray(remoteData.entries) ? remoteData.entries : [];

    function entryKey(e) {
      if (e.id) return 'id:' + e.id;
      return [
        e.date || '',
        e.month || '',
        e.year || '',
        e.actype || e.acId || '',
        e.acno || '',
        e.pilot || '',
        e.route || '',
        e.day_pilot || 0,
        e.night_pilot || 0
      ].join('|').toLowerCase();
    }

    const mergedEntriesMap = new Map();
    localEntries.forEach((e) => {
      mergedEntriesMap.set(entryKey(e), e);
    });

    let newFromRemote = 0;
    remoteEntries.forEach((e) => {
      const k = entryKey(e);
      if (!mergedEntriesMap.has(k)) {
        mergedEntriesMap.set(k, e);
        newFromRemote++;
      }
    });

    const mergedEntries = Array.from(mergedEntriesMap.values());

    // Merge aircraft
    const localAC = Array.isArray(localData.aircraft) ? localData.aircraft : [];
    const remoteAC = Array.isArray(remoteData.aircraft) ? remoteData.aircraft : [];
    const acMap = new Map();
    localAC.forEach((a) => { if (a && (a.id || a.name)) acMap.set(a.id || a.name, a); });
    remoteAC.forEach((a) => {
      const key = a.id || a.name;
      if (!acMap.has(key)) acMap.set(key, a);
    });
    const mergedAC = Array.from(acMap.values());

    // Merge name suggestions
    const localNames = Array.isArray(localData.nameSuggestions) ? localData.nameSuggestions : [];
    const remoteNames = Array.isArray(remoteData.nameSuggestions) ? remoteData.nameSuggestions : [];
    const nameSet = new Set([...localNames, ...remoteNames].filter(Boolean));
    const mergedNames = Array.from(nameSet).sort((a, b) => a.localeCompare(b));

    // Merge aircraft numbers
    const localAcnos = Array.isArray(localData.acnoSuggestions) ? localData.acnoSuggestions : [];
    const remoteAcnos = Array.isArray(remoteData.acnoSuggestions) ? remoteData.acnoSuggestions : [];
    const acnoSet = new Set([...localAcnos, ...remoteAcnos].filter(Boolean));
    const mergedAcnos = Array.from(acnoSet).sort((a, b) => a.localeCompare(b));

    // Prefer newest settings
    const mergedSettings = remoteData.settings && Object.keys(remoteData.settings).length > 0
      ? { ...localData.settings, ...remoteData.settings }
      : localData.settings;

    return {
      merged: {
        app: 'Logitta',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: mergedSettings,
        aircraft: mergedAC,
        entries: mergedEntries,
        nameSuggestions: mergedNames,
        acnoSuggestions: mergedAcnos
      },
      stats: {
        localTotal: localEntries.length,
        remoteTotal: remoteEntries.length,
        mergedTotal: mergedEntries.length,
        addedFromRemote: newFromRemote
      }
    };
  }

  // Apply merged dataset to the active application
  function applyDataset(data) {
    if (!data) return;
    if (typeof window.setAC === 'function' && Array.isArray(data.aircraft)) window.setAC(data.aircraft);
    if (typeof window.setEntries === 'function' && Array.isArray(data.entries)) window.setEntries(data.entries);
    if (typeof window.setSettings === 'function' && data.settings) window.setSettings(data.settings);
    if (typeof window.setNames === 'function' && Array.isArray(data.nameSuggestions)) window.setNames(data.nameSuggestions);
    if (typeof window.setAcnos === 'function' && Array.isArray(data.acnoSuggestions)) window.setAcnos(data.acnoSuggestions);

    // Ensure an active aircraft is selected after crash recovery/restore
    if (typeof window.getActiveAcId === 'function' && typeof window.setActiveAcId === 'function' && !window.getActiveAcId()) {
      const acs = Array.isArray(data.aircraft) ? data.aircraft : [];
      if (acs.length > 0) {
        const defAc = acs.find(a => (a.name || '').toLowerCase().includes('alh')) || acs[0];
        if (defAc && defAc.id) window.setActiveAcId(defAc.id);
      }
    }

    // Save to IndexedDB
    if (window.LogittaIDB) {
      window.LogittaIDB.saveVault(data);
    }

    // Refresh UI
    if (typeof window.applySettings === 'function') window.applySettings();
    if (typeof window.renderHome === 'function') window.renderHome();
    if (typeof window.renderEntries === 'function') window.renderEntries();
    if (typeof window.renderAircraftList === 'function') window.renderAircraftList();
    if (typeof window.renderAcList === 'function') window.renderAcList();
    if (typeof window.renderLogbook === 'function') window.renderLogbook();
    if (typeof window.renderSummary === 'function') window.renderSummary();
  }

  function getEndpoint(code) {
    const cleanCode = (code || _syncSettings.vaultCode || 'LOGITTA').trim().toUpperCase();
    if (_syncSettings.endpoint) {
      return _syncSettings.endpoint.replace('{code}', cleanCode);
    }
    if (window.location.protocol.startsWith('http')) {
      return window.location.origin + '/api/sync/' + encodeURIComponent(cleanCode);
    }
    return 'http://localhost:8080/api/sync/' + encodeURIComponent(cleanCode);
  }

  // 1. CLOUD / SERVER VAULT SYNC
  async function syncCloudVault(action = 'sync') {
    const code = (_syncSettings.vaultCode || 'LOGITTA').trim().toUpperCase();
    const payload = buildPayload();
    const endpoint = getEndpoint(code);

    if (action === 'upload') {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error('Cloud upload failed (Server status: ' + resp.status + ')');
      markSynced();
      return { success: true, message: `Exported ${payload.entries.length} sorties to Cloud Vault (${code})!` };
    }

    if (action === 'download') {
      const resp = await fetch(endpoint);
      if (resp.status === 404) throw new Error(`Vault "${code}" not found on server. Upload first from your source device.`);
      if (!resp.ok) throw new Error('Cloud download failed (Server status: ' + resp.status + ')');
      const remoteData = await resp.json();
      const { merged, stats } = mergePayloads(payload, remoteData);
      applyDataset(merged);
      markSynced();
      return { success: true, message: `Synced! Merged ${stats.addedFromRemote} new sorties (Total: ${stats.mergedTotal})` };
    }

    // 2-Way Sync
    let remoteData = null;
    try {
      const resp = await fetch(endpoint);
      if (resp.ok) {
        remoteData = await resp.json();
      }
    } catch (_) {}

    let dataToPush = payload;
    let message = `Synced to cloud vault (${code})!`;
    if (remoteData && (remoteData.app === 'Logitta' || remoteData.app === 'E-LOG')) {
      const { merged, stats } = mergePayloads(payload, remoteData);
      applyDataset(merged);
      dataToPush = merged;
      message = `Synced! Merged ${stats.addedFromRemote} new sorties (Total: ${stats.mergedTotal})`;
    }

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToPush)
    });

    markSynced();
    return { success: true, message };
  }

  function _buildBackupFile() {
    const payload = buildPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Logitta_Backup_${dateStr}.json`;
    return { payload, json, blob, fileName };
  }

  function _triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  }

  async function _fallbackPickerOrDownload(blob, fileName, target) {
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Logitta JSON File', accept: { 'application/json': ['.json'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        markSynced(target);
        return {
          success: true,
          target,
          message: target === 'drive' ? 'Saved backup file for Google Drive ✓' : 'Saved backup file to Files / iCloud ✓'
        };
      } catch (e) {
        if (e && e.name === 'AbortError') return { cancelled: true, target };
      }
    }

    _triggerBlobDownload(blob, fileName);
    markSynced(target === 'icloud' || target === 'drive' ? 'download' : target);
    return {
      success: true,
      target: 'download',
      message: `Downloaded ${fileName} (Check Files → Downloads) ✓`
    };
  }

  // 2. EXPORT TO ICLOUD FILES / GOOGLE DRIVE / DOWNLOADS
  // Important on iOS: invoke navigator.share synchronously within the user tap!
  function saveBackupTarget(target = 'icloud') {
    const { blob, fileName } = _buildBackupFile();

    if (target === 'download') {
      _triggerBlobDownload(blob, fileName);
      markSynced('download');
      return Promise.resolve({
        success: true,
        target: 'download',
        message: `Downloaded ${fileName} ✓`
      });
    }

    if (navigator.canShare && typeof File !== 'undefined') {
      try {
        const file = new File([blob], fileName, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({
            files: [file],
            title: 'Logitta Flying Log Backup',
            text: target === 'drive'
              ? 'Save Logitta backup to Google Drive'
              : 'Save Logitta backup to iCloud Drive / Files'
          }).then(() => {
            markSynced(target);
            return {
              success: true,
              target,
              message: target === 'drive'
                ? 'Saved backup via Google Drive Share Sheet ✓'
                : 'Saved backup via iCloud / Files Share Sheet ✓'
            };
          }).catch((e) => {
            if (e && e.name === 'AbortError') return { cancelled: true, target };
            return _fallbackPickerOrDownload(blob, fileName, target);
          });
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return Promise.resolve({ cancelled: true, target });
      }
    }

    return _fallbackPickerOrDownload(blob, fileName, target);
  }

  function saveToDriveFiles() {
    return saveBackupTarget('drive');
  }

  // 3. LOAD & MERGE FROM GOOGLE DRIVE / ICLOUD / LOCAL FILES
  function loadFromDriveFiles(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file selected'));
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const remoteData = JSON.parse(e.target.result);
          if (remoteData.app !== 'Logitta' && remoteData.app !== 'E-LOG') {
            return reject(new Error('Selected file is not a valid Logitta backup'));
          }
          const current = buildPayload();
          const { merged, stats } = mergePayloads(current, remoteData);
          applyDataset(merged);

          // If local only matched remote or this was a fresh recovery, clear unsynced warning;
          // if local already had extra entries not present in the imported file, keep reminder active.
          if (stats.localTotal === 0 || stats.mergedTotal <= stats.remoteTotal) {
            markSynced();
          } else {
            updateUI();
          }

          resolve({
            success: true,
            stats,
            message: stats.localTotal === 0
              ? `Restored ${stats.mergedTotal} sorties from backup ✓`
              : `Merged ${stats.addedFromRemote} new sorties! Total: ${stats.mergedTotal}`
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  // 4. MASTER ACTION (direct share sheet for iPhone PWA)
  function triggerSync(target = 'icloud') {
    if (_isSyncing) return Promise.resolve({ cancelled: true });
    _isSyncing = true;
    updateSyncPill('syncing', 'Preparing backup...');

    return saveBackupTarget(target).finally(() => {
      _isSyncing = false;
      updateUI();
    });
  }

  function formatTimeAgo(iso) {
    if (!iso) return 'Never';
    try {
      const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diffSec < 60) return 'just now';
      if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
      if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
      return Math.floor(diffSec / 86400) + 'd ago';
    } catch (_) {
      return '';
    }
  }

  function updateUI() {
    const codeInp = document.getElementById('syncVaultCode');
    const lastSyncLabel = document.getElementById('syncLastTime');
    if (codeInp) codeInp.value = _syncSettings.vaultCode || 'LOGITTA';

    const last = getLastSyncTime();
    if (lastSyncLabel) {
      lastSyncLabel.textContent = last ? formatTimeAgo(last) : 'Never';
    }

    const cnt = _syncState.unsyncedCount || 0;
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

    if (_isSyncing) {
      updateSyncPill('syncing', 'Opening Share Sheet...');
    } else if (cnt > 0) {
      updateSyncPill('unsynced', `${cnt} unsaved change${cnt === 1 ? '' : 's'} — Backup recommended`);
    } else if (last) {
      updateSyncPill('synced', isOnline ? 'Backed up' : 'Backed up (Offline ready)');
    } else {
      updateSyncPill('synced', isOnline ? 'Ready to back up' : 'Offline (Files backup works)');
    }

    // Home top-left Sync button numeric badge
    const badge = document.getElementById('homeSyncBadge');
    if (badge) {
      if (cnt > 0) {
        badge.textContent = cnt > 99 ? '99+' : String(cnt);
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // Home screen reminder banner
    const banner = document.getElementById('homeSyncBanner');
    const bannerTxt = document.getElementById('homeSyncBannerText');
    if (banner && bannerTxt) {
      if (cnt > 0) {
        bannerTxt.textContent = `${cnt} update${cnt === 1 ? '' : 's'} not backed up to iCloud / Drive`;
        banner.style.display = 'flex';
      } else {
        banner.style.display = 'none';
      }
    }

    // Per-target cards (iCloud & Google Drive) inside Sync Modal
    const updateTargetCard = (btnId, badgeId, hintId, ts, targetSeq, defaultHint) => {
      const btn = document.getElementById(btnId);
      const bEl = document.getElementById(badgeId);
      const hEl = document.getElementById(hintId);
      const fresh = isTargetFresh(ts, targetSeq);

      if (btn) {
        btn.classList.toggle('is-fresh', fresh);
        btn.classList.toggle('is-pending', (!!ts && !fresh) || (!ts && cnt > 0));
      }
      if (bEl) {
        if (fresh) {
          bEl.textContent = '✓ ' + formatTimeAgo(ts);
        } else if (ts) {
          bEl.textContent = 'Update needed';
        } else {
          bEl.textContent = cnt > 0 ? 'Pending' : 'Not saved';
        }
      }
      if (hEl) {
        if (fresh) {
          hEl.textContent = 'Up to date · Tap to export again';
        } else if (ts) {
          hEl.textContent = 'Last: ' + formatTimeAgo(ts) + ' · Tap to update';
        } else {
          hEl.textContent = defaultHint;
        }
      }
    };

    updateTargetCard(
      'syncBtnIcloud',
      'syncBadgeIcloud',
      'syncHintIcloud',
      _syncState.lastIcloudAt,
      _syncState.icloudSeq,
      'Share Sheet → Save to Files → iCloud'
    );
    updateTargetCard(
      'syncBtnDrive',
      'syncBadgeDrive',
      'syncHintDrive',
      _syncState.lastDriveAt,
      _syncState.driveSeq,
      'Share Sheet → Google Drive'
    );
  }

  return {
    init,
    getSettings,
    saveSettings,
    markUnsynced,
    markSynced,
    resetState,
    getSyncSummary,
    refreshUI: updateUI,
    triggerSync,
    syncCloudVault,
    saveBackupTarget,
    saveToDriveFiles,
    loadFromDriveFiles,
    mergePayloads,
    applyDataset,
    buildPayload,
    getLastSyncTime
  };
})();

// Expose on window cleanly for browser <script> consumers
window.LogittaSync = LogittaSync;
window.ELogSync = LogittaSync;
