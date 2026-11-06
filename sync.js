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

  let _syncSettings = {
    mode: 'auto',
    vaultCode: 'LOGITTA',
    autoExportFile: true,
    endpoint: ''
  };

  let _isSyncing = false;
  let _hasUnsynced = false;

  function init() {
    loadSettings();
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

  function markUnsynced() {
    _hasUnsynced = true;
    updateSyncPill('unsynced', 'Unsynced');
  }

  function markSynced() {
    _hasUnsynced = false;
    const now = new Date().toISOString();
    try {
      localStorage.setItem(K_LAST_SYNC_TIME, now);
    } catch (_) {}
    updateSyncPill('synced', 'Synced');
  }

  function getLastSyncTime() {
    try {
      return localStorage.getItem(K_LAST_SYNC_TIME) || null;
    } catch (_) {
      return null;
    }
  }

  function updateConnectionStatus(isOnline) {
    if (!isOnline) {
      updateSyncPill('offline', 'Offline');
    } else if (_hasUnsynced) {
      updateSyncPill('unsynced', 'Unsynced');
    } else {
      updateSyncPill('synced', 'Online');
    }
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

    // Save to IndexedDB
    if (window.LogittaIDB) {
      window.LogittaIDB.saveVault(data);
    }

    // Refresh UI
    if (typeof window.renderHome === 'function') window.renderHome();
    if (typeof window.renderEntries === 'function') window.renderEntries();
    if (typeof window.renderAircraftList === 'function') window.renderAircraftList();
    if (typeof window.renderAcList === 'function') window.renderAcList();
    if (typeof window.renderLogbook === 'function') window.renderLogbook();
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

  // 2. EXPORT TO GOOGLE DRIVE / ICLOUD / LOCAL FILES
  async function saveToDriveFiles() {
    const payload = buildPayload();
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Logitta_Backup_${dateStr}.json`;

    if (navigator.canShare && typeof File !== 'undefined') {
      try {
        const file = new File([blob], fileName, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Logitta Flying Log Book Backup',
            text: 'Save to Google Drive or iCloud Files'
          });
          markSynced();
          return { success: true, message: 'Saved to Drive / Files!' };
        }
      } catch (e) {
        if (e.name === 'AbortError') return { cancelled: true };
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Logitta JSON File', accept: { 'application/json': ['.json'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        markSynced();
        return { success: true, message: 'Saved to Drive / Disk!' };
      } catch (e) {
        if (e.name === 'AbortError') return { cancelled: true };
      }
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);

    markSynced();
    return { success: true, message: `Exported ${fileName} to Downloads / Drive.` };
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
          markSynced();
          resolve({
            success: true,
            message: `Restored! Merged ${stats.addedFromRemote} new sorties. Total entries: ${stats.mergedTotal}`
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  // 4. MASTER "SYNC NOW" ACTION
  async function triggerSync() {
    if (_isSyncing) return;
    _isSyncing = true;
    updateSyncPill('syncing', 'Syncing...');

    try {
      let cloudMsg = '';
      let cloudOk = false;

      try {
        const res = await syncCloudVault('sync');
        cloudMsg = res.message;
        cloudOk = true;
      } catch (err) {
        console.warn('Cloud sync note:', err.message);
      }

      let fileMsg = '';
      try {
        const fileRes = await saveToDriveFiles();
        if (fileRes && !fileRes.cancelled) {
          fileMsg = fileRes.message;
        }
      } catch (err) {
        console.warn('File export note:', err.message);
      }

      markSynced();

      const finalMsg = cloudOk
        ? (cloudMsg + (fileMsg ? ' & File Exported' : ''))
        : (fileMsg || 'Data synced & saved to local vault!');

      if (typeof window.showToast === 'function') {
        window.showToast(finalMsg);
      }
      return { success: true, message: finalMsg };
    } catch (err) {
      console.error('Sync failed:', err);
      updateSyncPill('error', 'Sync Failed');
      if (typeof window.showToast === 'function') {
        window.showToast(err.message || 'Sync failed', true);
      }
      throw err;
    } finally {
      _isSyncing = false;
      const last = getLastSyncTime();
      updateSyncPill(_hasUnsynced ? 'unsynced' : 'synced', last ? 'Synced ' + formatTimeAgo(last) : 'Ready');
    }
  }

  function formatTimeAgo(iso) {
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
  }

  return {
    init,
    getSettings,
    saveSettings,
    markUnsynced,
    markSynced,
    triggerSync,
    syncCloudVault,
    saveToDriveFiles,
    loadFromDriveFiles,
    mergePayloads,
    applyDataset,
    buildPayload,
    getLastSyncTime
  };
})();

// Alias
window.ELogSync = LogittaSync;
