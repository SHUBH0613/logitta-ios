import json

with open('Logitta_Backup_Import.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

for i, e in enumerate(data['entries']):
    p = e['pilot']
    cp = e['copilot']
    if 'shubh' in p.lower() or 'shubh' in cp.lower():
        d = f"{e['date']} {e['month']} {e['year']}"
        ac = e['acName']
        shubh_p = p if 'shubh' in p.lower() else ''
        shubh_cp = cp if 'shubh' in cp.lower() else ''
        print(f"Sortie {i+1:3d} ({d:11s} {ac:8s}): Pilot={shubh_p!r:25s} CoPilot={shubh_cp!r:25s}")
