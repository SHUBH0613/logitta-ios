import os
import re

def build_single_html():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    index_path = os.path.join(base_dir, 'index.html')
    styles_path = os.path.join(base_dir, 'styles.css')
    idb_path = os.path.join(base_dir, 'idb-storage.js')
    sync_path = os.path.join(base_dir, 'sync.js')
    app_path = os.path.join(base_dir, 'app.js')
    out_path = os.path.join(base_dir, 'LOGITTA_OFFLINE.html')
    desktop_path = os.path.join(os.path.expanduser('~'), 'OneDrive', 'Desktop', 'LOGITTA_OFFLINE.html')

    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()

    with open(styles_path, 'r', encoding='utf-8') as f:
        css = f.read()

    with open(idb_path, 'r', encoding='utf-8') as f:
        idb_js = f.read()

    with open(sync_path, 'r', encoding='utf-8') as f:
        sync_js = f.read()

    with open(app_path, 'r', encoding='utf-8') as f:
        app_js = f.read()

    # Excel / Numbers CSV Export JS helper
    excel_export_js = """
// ════════════════════════════════════════════════════
// EXCEL / APPLE NUMBERS CSV EXPORT
// ════════════════════════════════════════════════════
function exportToExcelCSV() {
  const entries = typeof getEntries === 'function' ? getEntries() : [];
  if (!entries || !entries.length) {
    if (typeof showToast === 'function') showToast('No sorties logged yet to export', true);
    else alert('No sorties logged yet to export');
    return;
  }

  const headers = [
    'Date', 'Month', 'Year',
    'Aircraft Type', 'Aircraft No',
    'Pilot', 'Co-Pilot', 'Route', 'Ink / Type',
    'Day Dual (HH:MM)', 'Day Pilot (HH:MM)', 'Day Co-Pilot (HH:MM)', 'Total Day (HH:MM)',
    'Night Dual (HH:MM)', 'Night Pilot (HH:MM)', 'Night Co-Pilot (HH:MM)', 'Total Night (HH:MM)',
    'NVG (HH:MM)', 'Simulator (HH:MM)', 'IMC (HH:MM)', 'SIF (HH:MM)',
    'Instr Day (HH:MM)', 'Instr Night (HH:MM)', 'WSO (HH:MM)',
    'Grand Total Hours (HH:MM)'
  ];

  function escapeCSV(val) {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return '"' + s + '"';
  }

  function minsToHM(mins) {
    if (!mins) return '0:00';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h + ':' + String(m).padStart(2, '0');
  }

  const rows = [headers.join(',')];

  entries.forEach(e => {
    const dayDual = e.day_dual || 0;
    const dayPilot = e.day_pilot || 0;
    const dayCopilot = e.day_copilot || 0;
    const dayTotal = dayDual + dayPilot + dayCopilot;

    const nightDual = e.night_dual || 0;
    const nightPilot = e.night_pilot || 0;
    const nightCopilot = e.night_copilot || 0;
    const nightTotal = nightDual + nightPilot + nightCopilot;

    const grandTotal = dayTotal + nightTotal;

    const row = [
      escapeCSV(e.date || ''),
      escapeCSV(e.month || ''),
      escapeCSV(e.year || ''),
      escapeCSV(e.acName || e.actype || ''),
      escapeCSV(e.acno || ''),
      escapeCSV(e.pilot || ''),
      escapeCSV(e.copilot || ''),
      escapeCSV(e.route || ''),
      escapeCSV((e.entryType || '').toUpperCase()),
      escapeCSV(minsToHM(dayDual)),
      escapeCSV(minsToHM(dayPilot)),
      escapeCSV(minsToHM(dayCopilot)),
      escapeCSV(minsToHM(dayTotal)),
      escapeCSV(minsToHM(nightDual)),
      escapeCSV(minsToHM(nightPilot)),
      escapeCSV(minsToHM(nightCopilot)),
      escapeCSV(minsToHM(nightTotal)),
      escapeCSV(minsToHM(e.nvg || 0)),
      escapeCSV(minsToHM(e.sim || 0)),
      escapeCSV(minsToHM(e.imc || 0)),
      escapeCSV(minsToHM(e.sif || 0)),
      escapeCSV(minsToHM(e.instr_day || 0)),
      escapeCSV(minsToHM(e.instr_night || 0)),
      escapeCSV(minsToHM(e.wso || 0)),
      escapeCSV(minsToHM(grandTotal))
    ];
    rows.push(row.join(','));
  });

  const csvContent = '\\uFEFF' + rows.join('\\r\\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = 'Logitta_Logbook_' + dateStr + '.csv';

  if (navigator.canShare && typeof File !== 'undefined') {
    try {
      const file = new File([blob], fileName, { type: 'text/csv' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: 'Logitta Logbook Spreadsheet',
          text: 'Open in Excel or Apple Numbers'
        }).then(() => { if (typeof showToast === 'function') showToast('Exported to Excel / Numbers ✓'); })
          .catch(e => {
            if (e.name !== 'AbortError') {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            }
          });
        return;
      }
    } catch (_) {}
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  if (typeof showToast === 'function') showToast('Downloaded ' + fileName + ' (Open in Excel or Numbers)');
}
"""

    # Add Excel export button into Settings and Export modal if not already present
    excel_btn_settings = """      <button class="export-sett-btn" onclick="exportToExcelCSV()">
        <span><svg class="ico ico-mr" aria-hidden="true"><use href="#i-book"/></svg>Export to Excel (.csv)</span><span class="arrow">›</span>
      </button>"""
    
    if 'exportToExcelCSV()' not in html:
        html = html.replace(
            '<button class="export-sett-btn" onclick="openPdfReportModal()">',
            excel_btn_settings + '\n      <button class="export-sett-btn" onclick="openPdfReportModal()">'
        )

        excel_btn_modal = """    <button class="save-opt" onclick="exportToExcelCSV()">
      <div class="save-opt-ico"><svg class="ico" aria-hidden="true"><use href="#i-book"/></svg></div>
      <div class="save-opt-info">
        <div class="save-opt-title">Export Logbook to Excel (.csv)</div>
        <div class="save-opt-desc">Spreadsheet format — opens directly in Apple Numbers or Microsoft Excel.</div>
      </div>
      <div class="save-opt-arrow">›</div>
    </button>"""
        html = html.replace(
            '<button class="save-opt" onclick="exportVia(\'copy\')">',
            excel_btn_modal + '\n\n    <button class="save-opt" onclick="exportVia(\'copy\')">'
        )

    # Replace external CSS link with inline <style>
    style_tag = f"""<style>
/* Robust system font fallbacks when offline */
@font-face {{
  font-family: 'Share Tech Mono Fallback';
  src: local('Menlo'), local('Consolas'), local('Courier New'), monospace;
}}
{css}
</style>"""
    html = re.sub(r'<link\s+rel=["\']stylesheet["\']\s+href=["\']styles\.css["\']\s*>', lambda _: style_tag, html)

    # Replace external script tags with unified inline script
    full_js = f"""
{idb_js}

{sync_js}

{excel_export_js}

{app_js}
"""
    # Remove individual script tags
    html = re.sub(r'<script\s+src=["\']idb-storage\.js["\']\s*></script>', '', html)
    html = re.sub(r'<script\s+src=["\']sync\.js["\']\s*></script>', '', html)
    html = re.sub(r'<script\s+src=["\']app\.js["\']\s*></script>', lambda _: f'<script>\n{full_js}\n</script>', html)

    # Save to local workspace
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"Generated standalone offline HTML: {out_path} ({len(html)} bytes)")

    # Save to user's Desktop
    try:
        with open(desktop_path, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Copied to Desktop: {desktop_path}")
    except Exception as e:
        print(f"Could not copy to Desktop: {e}")

if __name__ == '__main__':
    build_single_html()
