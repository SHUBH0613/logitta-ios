import sys

with open('app.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update getActiveAcId
old_getActive = '''function getActiveAcId(){
  // Returns the currently-active aircraft id, or null if none set or the
  // referenced aircraft has been deleted.
  const id = _storeGet(K_ACTIVE, null);
  if(!id) return null;
  const acs = getAC();
  return acs.find(a=>a.id===id) ? id : null;
}'''

new_getActive = '''function getActiveAcId(){
  // Returns the currently-active aircraft id, or null if none set or the
  // referenced aircraft has been deleted.
  const id = _storeGet(K_ACTIVE, null);
  const acs = getAC();
  if(!acs.length) return null;
  if(id && acs.find(a=>a.id===id)) return id;
  // Fallback: auto-select ALH MK1 (or first available aircraft) so the Summary page
  // is never empty/broken with 0h!
  const defaultAc = acs.find(a => (a.name||'').toLowerCase().includes('alh')) || acs[0];
  if(defaultAc){
    _storeSet(K_ACTIVE, defaultAc.id);
    return defaultAc.id;
  }
  return null;
}'''

assert old_getActive in text, "old_getActive not found!"
text = text.replace(old_getActive, new_getActive)

# 2. Update confirmImport
old_confirmImport = '''  // Active-aircraft references an id that may not exist in the imported set; clear it.
  // User can re-set it from Prior Experience afterwards.
  setActiveAcId(null);
  _pendingImportData = null;'''

new_confirmImport = '''  // Set the primary imported aircraft (e.g. ALH MK1 or first) as active so Summary immediately works!
  const importedAcs = d.aircraft || getAC();
  const defAc = importedAcs.find(a => (a.name||'').toLowerCase().includes('alh')) || importedAcs[0];
  setActiveAcId(defAc ? defAc.id : null);
  _pendingImportData = null;'''

assert old_confirmImport in text, "old_confirmImport not found!"
text = text.replace(old_confirmImport, new_confirmImport)

# 3. Update sum-picker-bar to have aircraft dropdown
old_sum_picker = '''  <!-- ════════ Month picker bar at the top ════════ -->
  <div class="sum-picker-bar">
    <div class="sum-picker-info">
      <div class="sum-picker-lbl">Active Aircraft</div>
      <div class="sum-picker-ac">${activeAcName}</div>
    </div>'''

new_sum_picker = '''  <!-- ════════ Month picker bar at the top ════════ -->
  <div class="sum-picker-bar">
    <div class="sum-picker-info">
      <div class="sum-picker-lbl">Active Aircraft</div>
      <div class="sum-picker-selects">
        <select class="sum-picker-select" id="sumAcSel" onchange="setActiveAcId(this.value); renderSummary();" aria-label="Active Aircraft" style="font-weight:700;color:var(--gold);max-width:140px">
          ${acs.map(a => `<option value="${a.id}" ${a.id===activeId?'selected':''}>${a.name}</option>`).join('')}
        </select>
      </div>
    </div>'''

assert old_sum_picker in text, "old_sum_picker not found!"
text = text.replace(old_sum_picker, new_sum_picker)

# 4. Update selfPilot in renderLogbook and renderLogbookSearch
old_self1 = "const selfPilot = e.pilot === 'SELF' || (e.pilot||'').toUpperCase().includes('SELF');"
new_self1 = "const selfPilot = e.pilot && (e.pilot.toUpperCase().includes('SELF') || e.pilot.toLowerCase().includes('shubham') || e.pilot.toLowerCase().includes(((getSettings()||{}).name||'').toLowerCase()));"
assert old_self1 in text, "old_self1 not found!"
text = text.replace(old_self1, new_self1)

old_self2 = "const selfPilot = (e.pilot||'').toUpperCase().includes('SELF');"
new_self2 = "const selfPilot = e.pilot && (e.pilot.toUpperCase().includes('SELF') || e.pilot.toLowerCase().includes('shubham') || e.pilot.toLowerCase().includes(((getSettings()||{}).name||'').toLowerCase()));"
assert old_self2 in text, "old_self2 not found!"
text = text.replace(old_self2, new_self2)

with open('app.js', 'w', encoding='utf-8', newline='') as f:
    f.write(text)

print("Successfully updated app.js!")
