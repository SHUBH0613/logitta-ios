import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

xlsx_path = 'log entries.xlsx'

def excel_date_to_dmy(serial):
    try:
        f = float(serial)
        base = datetime(1899, 12, 30)
        dt = base + timedelta(days=f)
        months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
        return str(dt.day), months[dt.month - 1], str(dt.year), dt
    except Exception as e:
        return '', '', '', None

def excel_time_to_mins(val):
    try:
        f = float(val)
        # Excel times are fraction of 24h day
        # 1.0 day = 24 * 60 = 1440 mins
        # e.g. 0.041666666666666664 * 1440 = 60 mins
        # e.g. 0.020833333333333332 * 1440 = 30 mins
        mins = round(f * 1440)
        return mins
    except:
        return 0

with zipfile.ZipFile(xlsx_path, 'r') as z:
    wb_xml = z.read('xl/workbook.xml')
    wb_tree = ET.fromstring(wb_xml)
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    sheets = [s.attrib['name'] for s in wb_tree.findall('.//ns:sheet', ns)]
    
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss_tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in ss_tree.findall('.//ns:si', ns):
            shared_strings.append(''.join([t.text or '' for t in si.findall('.//ns:t', ns)]))

    # Read sheet2 (Summary Control)
    if len(sheets) > 1:
        sheet2_xml = z.read('xl/worksheets/sheet2.xml')
        s2_tree = ET.fromstring(sheet2_xml)
        print("=== Sheet 2: Summary Control ===")
        for r in s2_tree.findall('.//ns:row', ns)[:15]:
            row_idx = r.attrib.get('r')
            cells = {}
            for c in r.findall('.//ns:c', ns):
                col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
                t_type = c.attrib.get('t')
                v_el = c.find('.//ns:v', ns)
                val = v_el.text if v_el is not None else ''
                if t_type == 's' and val != '':
                    val = shared_strings[int(val)]
                cells[col] = val
            print(f"Row {row_idx}: {cells}")

    # Inspect sheet1 actual data count
    sheet1_xml = z.read('xl/worksheets/sheet1.xml')
    s1_tree = ET.fromstring(sheet1_xml)
    data_rows = []
    headers = {}
    
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
        if row_idx == 3:
            headers = cells
        elif row_idx > 3:
            # check if row has actual data (e.g. S.No or Date)
            if cells.get('A') or cells.get('B') or cells.get('C'):
                data_rows.append((row_idx, cells))

    print(f"\nTotal valid data rows in Sheet1: {len(data_rows)}")
    print("Sample of first 3 parsed data rows:")
    for r_idx, c in data_rows[:3]:
        d, m, y, dt = excel_date_to_dmy(c.get('B', ''))
        ft_mins = excel_time_to_mins(c.get('J', '0'))
        print(f"  Row {r_idx}: Date={d} {m} {y}, AC={c.get('C')} #{c.get('D')}, Pilot={c.get('E')}, CoPilot={c.get('F')}, Time={ft_mins}m ({ft_mins//60}h{ft_mins%60:02d}m)")
    
    print("Sample of last 3 parsed data rows:")
    for r_idx, c in data_rows[-3:]:
        d, m, y, dt = excel_date_to_dmy(c.get('B', ''))
        ft_mins = excel_time_to_mins(c.get('J', '0'))
        print(f"  Row {r_idx}: Date={d} {m} {y}, AC={c.get('C')} #{c.get('D')}, Pilot={c.get('E')}, CoPilot={c.get('F')}, Time={ft_mins}m ({ft_mins//60}h{ft_mins%60:02d}m)")
