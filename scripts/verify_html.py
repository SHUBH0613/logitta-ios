import re

with open('LOGITTA_OFFLINE.html', 'r', encoding='utf-8') as f:
    content = f.read()

checks = [
    'ENTRY_COLORS',
    'function saveEntry',
    'function editEntry',
    'function deleteEntry',
    '_editingEntryId',
    'function addNameSuggestion',
    'function addAcnoSuggestion',
    'function renderLogbook',
    'function renderSummary',
    'function generatePdfReport',
    'function exportToExcelCSV',
    'f_entrytype',
    'entryConfirmPopup',
    'function confirmWipe',
    'LogittaIDB',
    'LogittaSync'
]

print('=== FUNCTION / FEATURE PRESENCE CHECK ===')
for c in checks:
    found = c in content
    status = 'FOUND' if found else 'MISSING'
    print(f"{c:30}: {status}")

# Check script extraction and syntax
scripts = re.findall(r'<script>(.*?)</script>', content, re.DOTALL)
print(f"\nFound {len(scripts)} inline script block(s).")

with open('temp_check.js', 'w', encoding='utf-8') as f:
    f.write("\n".join(scripts))

print("Wrote temp_check.js for node syntax verification.")
