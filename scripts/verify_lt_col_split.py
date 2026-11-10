import json
from collections import Counter

with open('Logitta_Backup_Import.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

pilots = Counter(e['pilot'] for e in data['entries'] if 'shubh' in e['pilot'].lower() or 'agarwal' in e['pilot'].lower())
copilots = Counter(e['copilot'] for e in data['entries'] if 'shubh' in e['copilot'].lower() or 'agarwal' in e['copilot'].lower())

print('=== PILOT NAMES ===')
for k, v in pilots.items():
    print(f'  {k!r}: {v}')

print('\n=== COPILOT NAMES ===')
for k, v in copilots.items():
    print(f'  {k!r}: {v}')

print('\n=== CHECK SAMPLE OF THE 26 SORTIES ===')
sample_ids = [1757269800244, 1758911400257, 1758911400258, 1768415400294, 1788805800386]
for e in data['entries']:
    if e['id'] in sample_ids:
        print(f"Sortie Date={e['date']} {e['month']} {e['year']} | Pilot={e['pilot']!r} | CoPilot={e['copilot']!r} | Route={e['route']!r}")
