import zipfile
import xml.etree.ElementTree as ET

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
    
    mismatches = []
    rows_data = []
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
            ft = round(float(cells.get('J', 0) or 0) * 1440)
            breakdown_sum = sum(round(float(cells.get(c, 0) or 0) * 1440) for c in ['Q', 'R', 'S', 'T', 'U', 'V'])
            if ft != breakdown_sum:
                mismatches.append((row_idx, ft, breakdown_sum, cells.get('C'), cells.get('H'), cells.get('I')))
            rows_data.append(cells)

print(f"Total entries: {len(rows_data)}")
print(f"Mismatches between Flying Time (J) and Q..V breakdown: {len(mismatches)}")
if mismatches:
    print("First 5 mismatches (row, J_mins, QV_mins, AC, Day/Night, Role):")
    for m in mismatches[:5]:
        print(" ", m)
