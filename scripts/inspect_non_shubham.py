import zipfile, xml.etree.ElementTree as ET

with zipfile.ZipFile('log entries.xlsx', 'r') as z:
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ss = [t.text or '' for t in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('.//ns:t', ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
    s1 = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    
    for r in s1.findall('.//ns:row', ns):
        r_idx = int(r.attrib.get('r'))
        if r_idx <= 3: continue
        cells = {}
        for c in r.findall('.//ns:c', ns):
            col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
            t = c.attrib.get('t')
            v = c.find('.//ns:v', ns)
            val = v.text if v is not None else ''
            if t == 's' and val: val = ss[int(val)]
            cells[col] = val
        if not (cells.get('A') or cells.get('B') or cells.get('C')): continue
        p = cells.get('E', '')
        cp = cells.get('F', '')
        if 'shubh' not in p.lower() and 'shubh' not in cp.lower():
            s_no = cells.get('A', '')
            role = cells.get('I', '')
            rem = cells.get('G', '')
            print(f"Row {r_idx:3d} (S.No {s_no}): Pilot={p!r}, CoPilot={cp!r}, Role={role!r}, Remarks={rem!r}")
