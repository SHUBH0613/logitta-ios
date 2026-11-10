import json
with open('Logitta_Backup_Import.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for i, e in enumerate(data['entries']):
    p = e['pilot'].lower()
    cp = e['copilot'].lower()
    if ('shubh' in p and 'singh' in cp) or ('singh' in p and 'shubh' in cp):
        print(f"Sortie {i+1}: Date={e['date']} {e['month']} {e['year']} | Pilot={e['pilot']} | CoPilot={e['copilot']}")
