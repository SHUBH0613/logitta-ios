/**
 * Logitta IndexedDB Persistent Storage
 * Provides durable, quota-resilient storage on iOS Safari, Android, and Desktop.
 * Prevents iOS Safari's 7-day eviction and WebView localStorage clearing.
 */
const LogittaIDB = (function () {
  const DB_NAME = 'LogittaVaultDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'vault';
  const VAULT_KEY = 'active_vault';

  let dbPromise = null;

  function getDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('Logitta: IndexedDB not supported on this browser.');
        return resolve(null);
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => {
        console.warn('Logitta: IndexedDB open failed', e);
        resolve(null);
      };
    });
    return dbPromise;
  }

  // Request persistent storage from the browser (vital for iOS Safari & Android)
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persist();
        console.log(`Logitta: Storage persistence granted = ${isPersisted}`);
        return isPersisted;
      }
    } catch (e) {
      console.warn('Logitta: Persistent storage request error', e);
    }
    return false;
  }

  // Save full vault to IndexedDB
  async function saveVault(data) {
    if (!data) return false;
    try {
      const db = await getDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          ...data,
          savedAt: new Date().toISOString()
        };
        const req = store.put(record, VAULT_KEY);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    } catch (e) {
      console.warn('Logitta IDB save error:', e);
      return false;
    }
  }

  // Load vault from IndexedDB
  async function loadVault() {
    try {
      const db = await getDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(VAULT_KEY);
        req.onsuccess = (e) => resolve(e.target.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      console.warn('Logitta IDB load error:', e);
      return null;
    }
  }

  // Initialize persistence request on load
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      requestPersistence();
    });
  }

  return {
    saveVault,
    loadVault,
    requestPersistence
  };
})();
