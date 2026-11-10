import zipfile, xml.etree.ElementTree as ET

with zipfile.ZipFile('log entries.xlsx', 'r') as z:
    ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('.//ns:si', ns):
            ss.append(''.join([t.text or '' for t in si.findall('.//ns:t', ns)]))
    
    s1 = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    for r in s1.findall('.//ns:row', ns):
        r_idx = r.attrib.get('r')
        if r_idx in ['3', '342', '360', '361', '363', '365', '430', '431', '432']:
            row_dict = {}
            for c in r.findall('.//ns:c', ns):
                col = ''.join([ch for ch in c.attrib.get('r') if ch.isalpha()])
                t = c.attrib.get('t')
                v = c.find('.//ns:v', ns)
                val = v.text if v is not None else ''
                if t == 's' and val:
                    val = ss[int(val)]
                row_dict[col] = val
            print(f"Row {r_idx}: {row_dict}\n")
