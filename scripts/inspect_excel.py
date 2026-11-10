import zipfile
import xml.etree.ElementTree as ET
import os

xlsx_path = 'log entries.xlsx'

with zipfile.ZipFile(xlsx_path, 'r') as z:
    # 1. Get workbook sheet names
    wb_xml = z.read('xl/workbook.xml')
    wb_tree = ET.fromstring(wb_xml)
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    sheets = [s.attrib['name'] for s in wb_tree.findall('.//ns:sheet', ns)]
    print("Sheets in workbook:", sheets)

    # 2. Get shared strings
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss_xml = z.read('xl/sharedStrings.xml')
        ss_tree = ET.fromstring(ss_xml)
        for si in ss_tree.findall('.//ns:si', ns):
            # concatenate all text inside si
            t_elems = si.findall('.//ns:t', ns)
            val = ''.join([t.text or '' for t in t_elems])
            shared_strings.append(val)
    print(f"Total shared strings: {len(shared_strings)}")

    # 3. Read first sheet
    sheet1_xml = z.read('xl/worksheets/sheet1.xml')
    sheet_tree = ET.fromstring(sheet1_xml)
    
    rows = []
    for row_el in sheet_tree.findall('.//ns:row', ns):
        row_idx = row_el.attrib.get('r')
        cells = {}
        for c in row_el.findall('.//ns:c', ns):
            r = c.attrib.get('r') # e.g. 'A1'
            col_letters = ''.join([ch for ch in r if ch.isalpha()])
            t_type = c.attrib.get('t')
            v_el = c.find('.//ns:v', ns)
            val = v_el.text if v_el is not None else ''
            
            if t_type == 's' and val != '':
                try:
                    val = shared_strings[int(val)]
                except:
                    pass
            elif t_type == 'inlineStr':
                is_el = c.find('.//ns:is/ns:t', ns)
                val = is_el.text if is_el is not None else ''
            cells[col_letters] = val
        rows.append((row_idx, cells))

print(f"Total rows found in sheet1: {len(rows)}")
print("\nFirst 10 rows:")
for r_idx, cells in rows[:10]:
    print(f"Row {r_idx}: {cells}")

if len(rows) > 10:
    print("\nLast 3 rows:")
    for r_idx, cells in rows[-3:]:
        print(f"Row {r_idx}: {cells}")
