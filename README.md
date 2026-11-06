# LOGITTA v2.76 — Digital e-Log Book (Cross-Platform Offline & Cloud Sync)

A military & civil aviation digital flying log book engineered to work **100% offline** on **iOS (iPhone)**, **Android**, and **Desktop**, with on-demand **Cloud & Google Drive Sync**.

---

## 🚀 Key Upgrades from the Original APK

1. **iPhone (iOS) Native-Like Support**:
   - The original app was locked inside an Android `.apk` file which iOS cannot run.
   - Converted into a Progressive Web App (PWA) with Apple Touch icons, translucent status bar, and safe-area notch support.
   - Installs to the iPhone Home Screen with 1 tap via Safari ("Add to Home Screen"). Opens fullscreen without browser bars, exactly like an App Store app!

2. **Bulletproof Offline Storage (IndexedDB + LocalStorage)**:
   - Standard iOS Safari can evict `localStorage` after 7 days of inactivity.
   - Integrated an **IndexedDB persistent storage layer** (`idb-storage.js`) that automatically backs up every sortie and aircraft entry into a durable browser database.
   - Even in airplane mode in the cockpit, all your sorties, hours, and settings are preserved.

3. **Multi-Platform On-Demand Sync (Press "Sync")**:
   - **Cross-Device Cloud Vault**: Enter a Sync Code (e.g. `PILOT-CHAUHAN`) to sync seamlessly between your iPhone, Android phone, and PC laptop.
   - **Google Drive & iCloud Files**: 1-click "Save to Drive / Files" uses native iOS Share Sheet / Android File Picker to save backups directly into your Google Drive or iCloud Drive app.
   - **Smart Sortie Merge**: Automatically detects duplicate sorties and merges new flights from other devices without overwriting existing data.

4. **100% Logic & Design Parity**:
   - Every sortie field (Day Dual/Pilot/Co-Pilot, Night, NVG, Simulator, IMC, SIF, Instrument Day/Night, WSO), CAT/IR currency tracking, Captain Con-Trg calculations, color inks, and gauges are identical to LOGITTA V2.76.

---

## 📱 How to Install and Run on iPhone (iOS)

### Option 1: Local Wi-Fi (No Cloud Deployment Required)
1. Double-click `start_app.bat` on your PC (or run `python sync_server.py`).
2. Note the Wi-Fi IP address printed in the terminal (e.g. `http://192.168.1.15:8080`).
3. Connect your iPhone to the same Wi-Fi network.
4. Open **Safari** on your iPhone and go to that address.
5. Tap the **Share** button (square with arrow pointing up at the bottom).
6. Tap **"Add to Home Screen"** and press **Add**.
7. Launch **Logitta** from your iPhone home screen. It will now work **completely offline**!

### Option 2: Free 24/7 Cloud Hosting (Recommended for Anywhere Access)
Deploy this folder to any free static host with HTTPS:
- **GitHub Pages**: Push this repo to GitHub, go to Settings -> Pages -> Deploy from branch.
- **Vercel / Netlify / Cloudflare Pages**: Drag and drop this folder for an instant, permanent `https://...` link.
- Once you open the `https://...` link on your iPhone, tap **Share -> Add to Home Screen**.

---

## 💻 How to Use on Desktop (Windows / Mac / Linux)

1. Double-click `start_app.bat` or run:
   ```bash
   python sync_server.py
   ```
2. Open `http://localhost:8080` in Chrome, Edge, or Brave.
3. In Chrome/Edge, click the **Install App** icon in the address bar to install Logitta as a native desktop application.

---

## 🔄 How the "Sync" Feature Works

1. On the **Home** screen, tap the **SYNC** button on the top-left (opposite to Settings).
2. Choose your preferred sync method:
   - **Cross-Device Cloud Vault**:
     - Tap 🎲 to generate a code (or type your own, e.g. `MY-FLIGHTS`).
     - Tap **Upload to Cloud** on your source device.
     - On your iPhone, open Logitta, enter the same code, and tap **Download from Cloud**.
     - All sorties will merge seamlessly!
   - **Google Drive / iCloud Files**:
     - Tap **Save to Drive / Files** to save a timestamped `.json` file directly into your Google Drive or iCloud Files app.
     - Tap **Load from Drive / Files** to restore or merge a backup file from Google Drive.

---

## 📁 File Structure

- `index.html` — The main user interface with military aviation dashboard, logbook, and sync modals.
- `styles.css` — High-performance responsive styling with luxury gold accents, theme modes, and safe-area notch layout.
- `app.js` — Core aviation logbook logic, sorties, totals, Captain Con-Trg calculations, and UI drivers.
- `sync.js` — Sync engine (Cloud Vault, Google Drive, and Sortie Merge algorithm).
- `idb-storage.js` — IndexedDB persistent storage engine for iOS & offline safety.
- `sw.js` — PWA Service Worker for offline caching.
- `manifest.json` — PWA manifest with standalone display configuration.
- `icon-192.png` & `icon-512.png` — Authentic Army Aviation golden wings app icons.
- `sync_server.py` — Python local server & Wi-Fi sync relay.
- `start_app.bat` — 1-click launcher for Windows.
- `LOGITTA V2.76.apk` — Original Android APK package preserved as reference.
