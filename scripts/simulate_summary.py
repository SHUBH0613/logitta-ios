import json

with open('Logitta_Backup_Import.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

entries = data['entries']
acs = data['aircraft']

print("=== Simulating Logitta Summary Page ===")
print(f"Total Aircraft in backup: {[a['name'] for a in acs]}")

# Case 1: Active aircraft is NULL (what happened right after import!)
print("\n--- CASE 1: activeAc is NULL (Default after import) ---")
activeId = None
activeAc = None
selM, selY = 'NOV', '2026'

monthAcEntries = [e for e in entries if e.get('acId') == activeId and e.get('month') == selM and str(e.get('year')) == selY]
print(f"Hero Total Flying NOV 2026: {sum(e['day_dual']+e['day_pilot']+e['day_copilot']+e['night_dual']+e['night_pilot']+e['night_copilot'] for e in monthAcEntries)} mins (0h)")
print(f"Con Trg Day: 0h, Night: 0h (Both gauges = 0h)")
print(f"Captain Con Trg: 0h")
print(f"Monthly Summary Table: 'No active aircraft set. Choose one from Prior Experience.'")

# Case 2: Active aircraft is ALH MK1 ('ac_alhmk1')
print("\n--- CASE 2: activeAc is ALH MK1 ('ac_alhmk1') ---")
activeId = 'ac_alhmk1'
activeAc = [a for a in acs if a['id'] == activeId][0]

monthAcEntries = [e for e in entries if e.get('acId') == activeId and e.get('month') == selM and str(e.get('year')) == selY]
tot_mins = sum(e['day_dual']+e['day_pilot']+e['day_copilot']+e['night_dual']+e['night_pilot']+e['night_copilot'] for e in monthAcEntries)
tot_day_pilot = sum(e['day_pilot'] for e in monthAcEntries)
tot_day_copilot = sum(e['day_copilot'] for e in monthAcEntries)

print(f"Hero Total Flying NOV 2026: {tot_mins} mins ({tot_mins//60}h {tot_mins%60:02d}m)")
print(f"  Day Pilot: {tot_day_pilot} mins ({tot_day_pilot//60}h {tot_day_pilot%60:02d}m)")
print(f"  Day Co-Pilot: {tot_day_copilot} mins ({tot_day_copilot//60}h {tot_day_copilot%60:02d}m)")
print(f"  Entries count in NOV 2026: {len(monthAcEntries)}")

# Check Con-Trg calculation for ALH MK1 ending NOV 2026
# Day: pilot-time in last 3 calendar months ending 30 Nov 2026 (Sep, Oct, Nov 2026)
from datetime import datetime
refEnd = datetime(2026, 11, 30, 23, 59, 59)
cap = refEnd.timestamp() * 1000
cutoffDay = datetime(2026, 8, 30, 0, 0, 0).timestamp() * 1000
cutoffNight = datetime(2026, 5, 30, 0, 0, 0).timestamp() * 1000

conDayPlt = 0
conNightPlt = 0
for e in entries:
    if e['acId'] != activeId: continue
    m_idx = MONTHS.index(e['month'])
    d = int(e['date'])
    y = int(e['year'])
    ts = datetime(y, m_idx + 1, d, 12, 0, 0).timestamp() * 1000
    if ts > cap: continue
    if ts >= cutoffDay:
        conDayPlt += e['day_pilot']
    if ts >= cutoffNight:
        conNightPlt += e['night_pilot']

print(f"Con Trg Day Pilot (last 3 mo): {conDayPlt} mins ({conDayPlt//60}h {conDayPlt%60:02d}m)")
print(f"Con Trg Night Pilot (last 6 mo): {conNightPlt} mins ({conNightPlt//60}h {conNightPlt%60:02d}m)")
