const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '..', 'www');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const filesToCopy = [
  'index.html',
  'styles.css',
  'app.js',
  'sync.js',
  'idb-storage.js',
  'manifest.json',
  'sw.js',
  'apple-touch-icon.png',
  'favicon.png',
  'icon-192.png',
  'icon-512.png'
];

console.log('Building Logitta web bundle into /www ...');
let count = 0;
filesToCopy.forEach(file => {
  const src = path.join(__dirname, '..', file);
  const dest = path.join(targetDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    count++;
  } else {
    console.warn(`Warning: file not found: ${file}`);
  }
});

console.log(`Success! Copied ${count} assets to www/. Ready for iOS packaging.`);
