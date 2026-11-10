import zipfile
import xml.etree.ElementTree as ET
import json
import os
from datetime import datetime, timedelta

xlsx_path = 'log entries.xlsx'
output_json_path = 'Logitta_Backup_Import.json'

MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

def excel_date_to_dmy(serial):
    try:
        f = float(serial)
        base = datetime(1899, 12, 30)
        dt = base + timedelta(days=f)
        return str(dt.day), MONTHS[dt.month - 1], str(dt.year), dt
    except Exception:
        return '', '', '', None

def excel_time_to_mins(val):
    try:
        if not val:
            return 0
        f = float(val)
        return round(f * 1440)
    except Exception:
        return 0

def clean_tail(t):
    if not t:
        return ''
    s = str(t).strip()
    if s.endswith('.0') and s[:-2].replace('.', '').isdigit():
        s = s[:-2]
    if s.lower() == 'sml':
        return 'SML'
    return s

def clean_route(r):
    if not r:
        return ''
    s = str(r).strip()
    if s.endswith('.0') and s[:-2].isdigit():
        return s[:-2]
    return s

def normalize_pilot_name(name, ac_name, dt):
    if not name:
        return ''
    s = name.strip()
    low = s.lower()
    # Lt Col Shubham / Lt Col Shubham Agarwal is a DIFFERENT officer (not the user)!
    if 'lt col' in low and ('shubh' in low or 'agarwal' in low or 'aggarwal' in low):
        if 'agarwal' in low or 'aggarwal' in low:
            return 'Lt Col Shubham Agarwal'
        return 'Lt Col Shubham'
    # Normalize all variations of the user (Capt Shubham or Lt Shubham)
    if 'shubh' in low or 'shubhan' in low:
        # If Chetak (CTK) or early 2023, user flew as Lt Shubham
        if 'CTK' in ac_name or (dt and dt.year == 2023 and dt.month <= 6):
            return 'Lt Shubham'
        else:
            return 'Capt Shubham'
    return s

# Read Excel XML directly
with zipfile.ZipFile(xlsx_path, 'r') as z:
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss_tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in ss_tree.findall('.//ns:si', ns):
            shared_strings.append(''.join([t.text or '' for t in si.findall('.//ns:t', ns)]))

    s1_tree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    data_rows = []
    
    for r in s1_tree.findall('.//ns:row', ns):
        row_idx = int(r.attrib.get('r'))
        cells = {}
        for c in r.findall('.//ns:c', ns):
            col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
            t_type = c.attrib.get('t')
            v_el = c.find('.//ns:v', ns)
            val = v_el.text if v_el is not None else ''
            if t_type == 's' and val != '':
                val = shared_strings[int(val)]
            cells[col] = val
        if row_idx > 3 and (cells.get('A') or cells.get('B') or cells.get('C')):
            data_rows.append((row_idx, cells))

print(f"Total raw data rows found: {len(data_rows)}")

# Aircraft catalogue definition - ALH MK1 first so it defaults as active!
aircraft_list = [
    {
        "id": "ac_alhmk1",
        "name": "ALH MK1",
        "data": {
            "day_dual": 0, "day_pilot": 0, "day_copilot": 0,
            "night_dual": 0, "night_pilot": 0, "night_copilot": 0,
            "nvg": 0, "sim": 0, "imc": 0, "sif": 0,
            "instr_day": 0, "instr_night": 0, "wso": 0
        }
    },
    {
        "id": "ac_ctk",
        "name": "CTK",
        "data": {
            "day_dual": 0, "day_pilot": 0, "day_copilot": 0,
            "night_dual": 0, "night_pilot": 0, "night_copilot": 0,
            "nvg": 0, "sim": 0, "imc": 0, "sif": 0,
            "instr_day": 0, "instr_night": 0, "wso": 0
        }
    },
    {
        "id": "ac_alhsml",
        "name": "ALH SML",
        "data": {
            "day_dual": 0, "day_pilot": 0, "day_copilot": 0,
            "night_dual": 0, "night_pilot": 0, "night_copilot": 0,
            "nvg": 0, "sim": 0, "imc": 0, "sif": 0,
            "instr_day": 0, "instr_night": 0, "wso": 0
        }
    }
]

ac_map = {
    'CTK': ('ac_ctk', 'CTK'),
    'ALH MK 1': ('ac_alhmk1', 'ALH MK1'),
    'ALH MK1': ('ac_alhmk1', 'ALH MK1'),
    'ALH SML': ('ac_alhsml', 'ALH SML'),
}

entries = []
pilots_set = set()
copilots_set = set()
acnos_set = set()

# Running totals for verification
tot_flying = 0
tot_day_dual = 0
tot_day_pilot = 0
tot_day_copilot = 0
tot_night_dual = 0
tot_night_pilot = 0
tot_night_copilot = 0
tot_imc = 0
tot_sif = 0

for s_no, (row_idx, c) in enumerate(data_rows, start=1):
    d_str, m_str, y_str, dt = excel_date_to_dmy(c.get('B', ''))
    
    raw_ac = (c.get('C') or '').strip()
    if raw_ac in ac_map:
        ac_id, ac_name = ac_map[raw_ac]
    else:
        norm = raw_ac.replace(' ', '').upper()
        if 'MK1' in norm:
            ac_id, ac_name = 'ac_alhmk1', 'ALH MK1'
        elif 'SML' in norm:
            ac_id, ac_name = 'ac_alhsml', 'ALH SML'
        elif 'CTK' in norm:
            ac_id, ac_name = 'ac_ctk', 'CTK'
        else:
            ac_id = f"ac_{norm.lower()}"
            ac_name = raw_ac
            aircraft_list.append({"id": ac_id, "name": ac_name, "data": {k:0 for k in aircraft_list[0]['data']}})

    acno = clean_tail(c.get('D', ''))
    raw_pilot = (c.get('E') or '').strip()
    raw_copilot = (c.get('F') or '').strip()
    
    # Clean names
    pilot = normalize_pilot_name(raw_pilot, ac_name, dt)
    copilot = normalize_pilot_name(raw_copilot, ac_name, dt)
    route = clean_route(c.get('G', ''))

    if pilot: pilots_set.add(pilot)
    if copilot: copilots_set.add(copilot)
    if acno: acnos_set.add(acno)

    dn = (c.get('H') or '').strip().lower()
    is_night = 'night' in dn
    entry_type = 'red' if is_night else 'blue'

    role = (c.get('I') or '').strip()
    ft_mins = excel_time_to_mins(c.get('J', 0))

    q_day_dual = excel_time_to_mins(c.get('Q', 0))
    r_day_pilot = excel_time_to_mins(c.get('R', 0))
    s_day_copilot = excel_time_to_mins(c.get('S', 0))

    t_night_dual = excel_time_to_mins(c.get('T', 0))
    u_night_pilot = excel_time_to_mins(c.get('U', 0))
    v_night_copilot = excel_time_to_mins(c.get('V', 0))

    # Apply fix for 17 rows where Q..V were empty but J and Role were specified
    breakdown_sum = q_day_dual + r_day_pilot + s_day_copilot + t_night_dual + u_night_pilot + v_night_copilot
    if breakdown_sum == 0 and ft_mins > 0:
        if role == 'Co-Pilot':
            if is_night:
                v_night_copilot = ft_mins
            else:
                s_day_copilot = ft_mins
        elif role == 'Dual':
            if is_night:
                t_night_dual = ft_mins
            else:
                q_day_dual = ft_mins
        else:
            if is_night:
                u_night_pilot = ft_mins
            else:
                r_day_pilot = ft_mins

    # Instrument time
    instr_time = excel_time_to_mins(c.get('L', 0))
    act_imc = excel_time_to_mins(c.get('X', 0))
    sim_imc = excel_time_to_mins(c.get('Y', 0))
    itype = (c.get('K') or '').strip().lower()

    if act_imc == 0 and sim_imc == 0 and instr_time > 0:
        if 'sim' in itype:
            sim_imc = instr_time
        else:
            act_imc = instr_time

    if dt:
        entry_id = int(dt.timestamp() * 1000) + s_no
    else:
        entry_id = 1674432000000 + s_no * 60000

    entry_obj = {
        "id": entry_id,
        "date": d_str,
        "month": m_str,
        "year": y_str,
        "entryType": entry_type,
        "acId": ac_id,
        "acName": ac_name,
        "acno": acno,
        "pilot": pilot,
        "copilot": copilot,
        "route": route,
        "day_dual": q_day_dual,
        "day_pilot": r_day_pilot,
        "day_copilot": s_day_copilot,
        "night_dual": t_night_dual,
        "night_pilot": u_night_pilot,
        "night_copilot": v_night_copilot,
        "nvg": 0,
        "sim": 0,
        "imc": act_imc,
        "sif": sim_imc,
        "instr_day": 0,
        "instr_night": 0,
        "wso": 0
    }

    entries.append(entry_obj)

    tot_flying += ft_mins
    tot_day_dual += q_day_dual
    tot_day_pilot += r_day_pilot
    tot_day_copilot += s_day_copilot
    tot_night_dual += t_night_dual
    tot_night_pilot += u_night_pilot
    tot_night_copilot += v_night_copilot
    tot_imc += act_imc
    tot_sif += sim_imc

name_suggestions = sorted(list(pilots_set.union(copilots_set)), key=lambda s: s.lower())
acno_suggestions = sorted(list(acnos_set), key=lambda s: s.lower())

backup_payload = {
    "app": "Logitta",
    "version": 1,
    "exportedAt": datetime.now().isoformat() + "Z",
    "settings": {
        "name": "Capt Shubham",
        "unit": "Army Aviation",
        "catir": "",
        "catirDate": "",
        "accent": "gold",
        "mode": "dark",
        "fs": "md",
        "haptics": True
    },
    "aircraft": aircraft_list,
    "entries": entries,
    "nameSuggestions": name_suggestions,
    "acnoSuggestions": acno_suggestions
}

with open(output_json_path, 'w', encoding='utf-8') as f:
    json.dump(backup_payload, f, indent=2, ensure_ascii=False)

print(f"\nRegenerated {output_json_path} successfully!")
print(f"Total entries: {len(entries)}")
print(f"Total flying: {tot_flying}m ({tot_flying//60}h {tot_flying%60:02d}m)")
print(f"Unique names: {len(name_suggestions)}")
print(f"Unique acnos: {len(acno_suggestions)}")
