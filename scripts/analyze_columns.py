import zipfile
import xml.etree.ElementTree as ET
from collections import Counter

xlsx_path = 'log entries.xlsx'

with zipfile.ZipFile(xlsx_path, 'r') as z:
    wb_tree = ET.fromstring(z.read('xl/workbook.xml'))
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss_tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in ss_tree.findall('.//ns:si', ns):
            shared_strings.append(''.join([t.text or '' for t in si.findall('.//ns:t', ns)]))

    s1_tree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    
    headers = {}
    rows = []
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
        elif row_idx > 3 and (cells.get('A') or cells.get('B') or cells.get('C')):
            rows.append(cells)

print("Headers (Row 3):", headers)
print("\nUnique Aircraft Types:", Counter([r.get('C', '').strip() for r in rows]))
print("\nUnique Day/Night:", Counter([r.get('H', '').strip() for r in rows]))
print("\nUnique Roles:", Counter([r.get('I', '').strip() for r in rows]))
print("\nUnique Instrument Types:", Counter([r.get('K', '').strip() for r in rows]))

# Check how hours are populated across M to AB
hour_cols = ['J', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB']
hour_counts = {}
for col in hour_cols:
    non_zero = sum(1 for r in rows if float(r.get(col, 0) or 0) > 0)
    hour_counts[col + f" ({headers.get(col, '')})"] = non_zero

print("\nNon-zero entry counts for hour columns:")
for k, v in hour_counts.items():
    print(f"  {k:35}: {v}")
