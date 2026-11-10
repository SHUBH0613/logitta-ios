import zipfile, xml.etree.ElementTree as ET

with zipfile.ZipFile('log entries.xlsx', 'r') as z:
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ss = [t.text or '' for t in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('.//ns:t', ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
    s1 = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    count = 0
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
        if cells.get('C') == 'ALH SML':
            count += 1
            non_zeros = {k: round(float(cells.get(k, 0) or 0)*1440) for k in ['J', 'L', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB'] if float(cells.get(k, 0) or 0) > 0}
            if count <= 5:
                print(f"Row {r_idx}: D/N={cells.get('H')} Role={cells.get('I')} NonZeros={non_zeros}")
    print(f"Total ALH SML rows: {count}")
