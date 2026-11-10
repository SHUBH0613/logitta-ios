import json
from collections import Counter

with open('Logitta_Backup_Import.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

entries = data['entries']

pilot_names = Counter(e['pilot'] for e in entries)
copilot_names = Counter(e['copilot'] for e in entries)

print("=== PILOT NAMES containing 'shubh' ===")
for name, cnt in pilot_names.items():
    if 'shubh' in name.lower():
        print(f"  {name!r}: {cnt} entries")

print("\n=== COPILOT NAMES containing 'shubh' ===")
for name, cnt in copilot_names.items():
    if 'shubh' in name.lower():
        print(f"  {name!r}: {cnt} entries")

print("\n=== ENTRIES WHERE NEITHER PILOT NOR COPILOT CONTAINS 'shubh' ===")
non_shubh = []
for i, e in enumerate(entries):
    p = e['pilot'].lower()
    cp = e['copilot'].lower()
    if 'shubh' not in p and 'shubh' not in cp:
        non_shubh.append((i+1, e['date'], e['month'], e['year'], e['acName'], e['pilot'], e['copilot'], e['route'], e['day_pilot'], e['day_copilot'], e['day_dual']))

print(f"Total entries without 'shubh': {len(non_shubh)}")
for r in non_shubh:
    print(f"  Entry {r[0]:3d} ({r[1]} {r[2]} {r[3]} {r[4]}): Pilot={r[5]!r}, CoPilot={r[6]!r}, Route={r[7]!r}, DayP={r[8]}, DayCP={r[9]}, DayDual={r[10]}")
