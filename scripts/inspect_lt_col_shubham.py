import zipfile, xml.etree.ElementTree as ET

with zipfile.ZipFile('log entries.xlsx', 'r') as z:
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ss = [t.text or '' for t in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('.//ns:t', ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
    s1 = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    
    rows = []
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
        
        p = cells.get('E', '').strip()
        cp = cells.get('F', '').strip()
        
        if 'lt col' in p.lower() and 'shubh' in p.lower() or 'lt col' in cp.lower() and 'shubh' in cp.lower():
            rows.append((r_idx, cells.get('A'), cells.get('B'), cells.get('C'), cells.get('D'), p, cp, cells.get('G'), cells.get('H'), cells.get('I'), cells.get('J'), cells.get('Q'), cells.get('R'), cells.get('S'), cells.get('T'), cells.get('U'), cells.get('V')))

print(f"Total rows with Lt col Shubham: {len(rows)}")
for r in rows:
    print(f"Row {r[0]:3d} (S.No {r[1]}): AC={r[3]} #{r[4]} | Pilot={r[5]!r} | CoPilot={r[6]!r} | Route={r[7]!r} | Role={r[9]!r} | FT={r[10]} | Q(Dual)={r[11]} R(Plt)={r[12]} S(CP)={r[13]} T(NiDual)={r[14]} U(NiPlt)={r[15]} V(NiCP)={r[16]}")
