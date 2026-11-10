import zipfile, xml.etree.ElementTree as ET

with zipfile.ZipFile('log entries.xlsx', 'r') as z:
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('.//ns:si', ns):
            ss.append(''.join([t.text or '' for t in si.findall('.//ns:t', ns)]))
    
    s1 = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    for r in s1.findall('.//ns:row', ns):
        r_idx = int(r.attrib.get('r'))
        cells = {}
        for c in r.findall('.//ns:c', ns):
            col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
            t = c.attrib.get('t')
            v = c.find('.//ns:v', ns)
            val = v.text if v is not None else ''
            if t == 's' and val:
                val = ss[int(val)]
            cells[col] = val
        if r_idx > 3 and (cells.get('A') or cells.get('B') or cells.get('C')):
            ft = round(float(cells.get('J', 0) or 0) * 1440)
            breakdown_sum = sum(round(float(cells.get(c, 0) or 0) * 1440) for c in ['Q', 'R', 'S', 'T', 'U', 'V'])
            if ft != breakdown_sum:
                print(f"Row {r_idx:3d}: J={ft}m, Sum={breakdown_sum}m | AC={cells.get('C')} | D/N={cells.get('H')} | Role={cells.get('I')} | Q={cells.get('Q')} R={cells.get('R')} S={cells.get('S')} T={cells.get('T')} U={cells.get('U')} V={cells.get('V')}")
