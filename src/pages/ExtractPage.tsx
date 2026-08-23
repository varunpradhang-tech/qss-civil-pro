import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, Plus, Copy, Trash2, Ruler, FileSpreadsheet, Info, Download,
  ArrowRight, Layers, Hash, ShieldCheck, Loader2, X, CheckCircle2,
} from 'lucide-react';
import { useStore, type Sheet } from '../state/store.js';
import { parseInWorker } from '../workers/parseClient.js';
import { MENU, RULES, RULE_FIELDS, FIELD_LABEL, type MemberRow } from '../takeoff/rules.js';
import { downloadBlob } from '../export/download.js';
import { membersToCsv } from '../export/mb.js';
import { buildMbXlsx } from '../export/xlsx.js';
import { buildSlabReferenceDxf } from '../export/dxf.js';
import { overlayPanelNumbersOnPdf } from '../export/pdf.js';
import { slabReferenceGeometry } from '../export/dxf.js';
import { useUI, displayQuantity } from '../state/ui.js';
import { PageHeader } from '../components/PageHeader.js';
import { PremiumBadge } from '../components/PremiumBadge.js';

const REQUIREMENTS = [
  'Grid lines are shown on the drawing',
  'X-axis grid-to-grid distances are dimensioned',
  'Y-axis grid-to-grid distances are dimensioned',
];

export function ExtractPage() {
  const s = useStore();
  const { plan, units } = useUI();
  const navigate = useNavigate();
  useEffect(() => { void s.refreshProjects(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [blockName, setBlockName] = useState('Block A');
  const [calcAreaMode, setCalcAreaMode] = useState<'drawing' | 'grid'>('drawing');
  const [deductionMode, setDeductionMode] = useState<'manual' | 'none'>('manual');
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [cadExporting, setCadExporting] = useState(false);
  const [referenceFormat, setReferenceFormat] = useState<'dxf' | 'dwg' | 'pdf'>('dxf');
  const [referenceNotice, setReferenceNotice] = useState<{ kind: 'working' | 'success' | 'error'; text: string } | null>(null);
  const [referenceReady, setReferenceReady] = useState<{ url: string; filename: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const wasParsing = useRef(false);

  // After an upload finishes parsing and members are ready, bring the output into view.
  useEffect(() => {
    if (wasParsing.current && !s.parsing && s.members.length > 0) {
      outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    wasParsing.current = s.parsing;
  }, [s.parsing, s.members.length]);

  function openFramingPicker() {
    const el = fileInputRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
    el.click(); // user-gesture initiated → opens the native file dialog
  }
  function handleExtract() {
    s.extractQuantity();
    requestAnimationFrame(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  function removeFile(name: string) {
    setPicked((p) => p.filter((n) => n !== name));
    s.setSheets(s.sheets.filter((sh) => sh.name !== name));
  }

  const disp = (base: number, ruleUnit: 'm2' | 'm3' | 'kg') => displayQuantity(base, ruleUnit, units);
  const qtyText = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const unitLabel = (u: 'm2' | 'm3' | 'kg') => (u === 'm2' ? 'm²' : u === 'm3' ? 'm³' : 'kg');

  const rule = RULES[s.quantityKey];
  const fields = (RULE_FIELDS[s.quantityKey] ?? ['length', 'breadth', 'height', 'nos']) as (keyof MemberRow)[];
  const colCount = 3 + fields.length + 1; // select + member + floor + rule fields + quantity
  const isBeamCap = s.quantityKey === 'beam_concrete' || s.quantityKey === 'beam_shuttering';
  const isFraming = s.drawingType === 'structural' && ['slab', 'beam', 'raft'].includes(s.workGroup);
  const isColumn = s.drawingType === 'structural' && s.workGroup === 'column';
  const rowQty = (r: MemberRow) => rule.calculate(r, s.capMode);
  const total = s.members.reduce((a, r) => a + rowQty(r), 0);
  const canDetail = plan === 'premium' || s.outputType === 'total';
  const showDownloads = canDetail && s.members.length > 0;

  async function parseFiles(files: File[]) {
    if (!files.length) return;
    s.setParsing(true);
    const out: Sheet[] = [];
    try {
      for (const f of files) {
        s.setStatus(`Parsing ${f.name}…`);
        const sourceBytes = await f.arrayBuffer();
        const dwg = await parseInWorker(sourceBytes, f.name, '/wasm');
        out.push({ id: f.name, name: f.name, dwg, sourceBytes, slabDimCount: dwg.dimensions.filter((d) => /slabs no/i.test(d.layer)).length });
      }
      s.setSheets(out);
    } catch (err) { s.setStatus(`Parse failed: ${(err as Error).message}`); } finally { s.setParsing(false); }
  }
  function exportCsv() { downloadBlob(membersToCsv(s.members, s.quantityKey, s.capMode), 'qss-takeoff.csv', 'text/csv;charset=utf-8'); }
  async function exportXlsx() { downloadBlob(await buildMbXlsx(s.members, s.quantityKey, s.capMode, s.projectName), 'qss-mb.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }
  async function exportReferenceCad() {
    setReferenceNotice(null);
    if (referenceReady) URL.revokeObjectURL(referenceReady.url);
    setReferenceReady(null);
    const filename = `${s.projectName}-slab-panel-reference`;
    const dwgs = s.sheets.map((sheet) => sheet.dwg);
    if (referenceFormat === 'dxf') {
      downloadBlob(buildSlabReferenceDxf(dwgs, s.members), `${filename}.dxf`, 'application/dxf');
      s.setStatus(`Downloaded ${filename}.dxf — panel numbers match the Excel Member column.`);
      setReferenceNotice({ kind: 'success', text: `Downloaded ${filename}.dxf` });
      return;
    }
    if (referenceFormat === 'pdf') {
      setCadExporting(true);
      try {
        const geometry = slabReferenceGeometry(dwgs);
        const source = s.sheets.find((sheet) => sheet.dwg === geometry) ?? s.sheets[0];
        if (!source?.sourceBytes) throw new Error('Re-upload the original CAD drawing once to create a full-colour reference PDF.');
        s.setStatus('Converting the original CAD drawing to PDF…');
        setReferenceNotice({ kind: 'working', text: 'Uploading original CAD…' });
        const create = await fetch('/.netlify/functions/cad-pdf-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: source.name }) });
        const job = await create.json();
        if (!create.ok) throw new Error(job.error || 'Could not start CAD-to-PDF conversion');
        const form = new FormData();
        for (const [key, value] of Object.entries(job.form.parameters)) form.append(key, String(value));
        form.append('file', new Blob([source.sourceBytes]), source.name); // file must be last
        const upload = await fetch(job.form.url, { method: 'POST', body: form });
        if (!upload.ok) throw new Error('Original CAD upload failed');
        setReferenceNotice({ kind: 'working', text: 'CloudConvert is creating the PDF…' });
        let pdfUrl = '';
        for (let attempt = 0; attempt < 90; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (attempt > 0 && attempt % 5 === 0) {
            const elapsed = `${attempt * 2} seconds elapsed`;
            s.setStatus(`Converting original CAD to PDF… ${elapsed}`);
            setReferenceNotice({ kind: 'working', text: `Creating PDF… ${elapsed}` });
          }
          const poll = await fetch(`/.netlify/functions/cad-pdf-job?id=${encodeURIComponent(job.id)}`);
          const state = await poll.json();
          if (!poll.ok || state.status === 'error') throw new Error(state.error || 'CAD-to-PDF conversion failed');
          if (state.url) { pdfUrl = state.url; break; }
        }
        if (!pdfUrl) throw new Error('CAD-to-PDF conversion timed out');
        s.setStatus('Adding slab panel numbers to the converted PDF…');
        setReferenceNotice({ kind: 'working', text: 'Adding slab panel numbers…' });
        let basePdf: ArrayBuffer;
        try {
          basePdf = await fetch(pdfUrl).then((res) => { if (!res.ok) throw new Error('CloudConvert download failed'); return res.arrayBuffer(); });
        } catch {
          basePdf = await fetch(`/.netlify/functions/cad-pdf-job?id=${encodeURIComponent(job.id)}&download=1`).then((res) => { if (!res.ok) throw new Error('Converted PDF download failed'); return res.arrayBuffer(); });
        }
        const markedPdf = await overlayPanelNumbersOnPdf(basePdf, geometry, s.members);
        if (markedPdf.size < 100) throw new Error('Marked PDF output was empty');
        if (await markedPdf.slice(0, 5).text() !== '%PDF-') throw new Error('Marked output is not a valid PDF');
        const ready = { url: URL.createObjectURL(markedPdf), filename: `${filename}.pdf` };
        setReferenceReady(ready);
        downloadBlob(markedPdf, `${filename}.pdf`, 'application/pdf');
        s.setStatus(`Downloaded ${filename}.pdf — original CAD appearance preserved and panel numbers match Excel.`);
        setReferenceNotice({ kind: 'success', text: `Downloaded ${filename}.pdf — check your Downloads folder.` });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        s.setStatus(`PDF export failed: ${message}`);
        setReferenceNotice({ kind: 'error', text: `PDF export failed: ${message}` });
        window.alert(`PDF export failed: ${message}`);
      } finally { setCadExporting(false); }
      return;
    }
    setCadExporting(true);
    try {
      const dxf = buildSlabReferenceDxf(dwgs, s.members);
      const res = await fetch('/.netlify/functions/convert-dwg', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dxf, filename }),
      });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({ error: 'DWG conversion failed' }));
        throw new Error(problem.error || 'DWG conversion failed');
      }
      downloadBlob(await res.blob(), `${filename}.dwg`, 'application/acad');
      s.setStatus(`Downloaded ${filename}.dwg — panel numbers match the Excel Member column.`);
      setReferenceNotice({ kind: 'success', text: `Downloaded ${filename}.dwg` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      s.setStatus(`DWG export failed: ${message}`);
      setReferenceNotice({ kind: 'error', text: `DWG export failed: ${message}` });
    } finally { setCadExporting(false); }
  }

  const byFloor: Record<string, number> = {};
  for (const r of s.members) byFloor[r.floor || '—'] = (byFloor[r.floor || '—'] || 0) + rowQty(r);

  return (
    <section className="page">
      <PageHeader title="Extract quantities">
        Upload the required drawings for the selected work item — QSS Pro detects the file format from each uploaded file.
      </PageHeader>

      <div className="requirement-panel">
        <div className="req-head"><ShieldCheck size={15} /> Confirm before upload</div>
        <div className="req-toggles">
          {REQUIREMENTS.map((r) => (
            <label key={r} className="req-toggle">
              <input type="checkbox" defaultChecked />
              <span className="switch"><span className="knob" /></span>
              <span className="req-text">{r}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card form-card">
        <div className="form-grid">
          <label>Drawing type
            <select value={s.drawingType} onChange={(e) => s.setDrawingType(e.target.value as 'structural' | 'architectural')}>
              <option value="structural">Structural drawing</option>
              <option value="architectural">Architectural drawing</option>
            </select>
          </label>
          <label>Project / block name
            <input type="text" value={blockName} onChange={(e) => setBlockName(e.target.value)} />
          </label>
          <label>Work group
            <select value={s.workGroup} onChange={(e) => s.setWorkGroup(e.target.value)}>
              {Object.entries(MENU[s.drawingType]).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}
            </select>
          </label>
          <label>Quantity rule
            <select value={s.quantityKey} onChange={(e) => s.setQuantityKey(e.target.value)}>
              {(MENU[s.drawingType][s.workGroup]?.rules ?? []).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
          </label>
          {isBeamCap && (
            <label>Column caps in beam quantity
              <select value={s.capMode} onChange={(e) => s.setCapMode(e.target.value as 'included' | 'excluded')}>
                <option value="included">Included in beam quantity</option>
                <option value="excluded">Excluded with deduction row</option>
              </select>
            </label>
          )}
          {isFraming && (
            <label>Calculation area
              <select value={calcAreaMode} onChange={(e) => setCalcAreaMode(e.target.value as 'drawing' | 'grid')}>
                <option value="drawing">As per uploaded drawing</option>
                <option value="grid">Specific grid area</option>
              </select>
            </label>
          )}
          <label>Output type
            <select value={s.outputType} onChange={(e) => s.setOutputType(e.target.value as 'total' | 'member' | 'floor')}>
              <option value="total">Total quantity only</option>
              <option value="member">Member-wise quantity{plan === 'free' ? ' - Premium' : ''}</option>
              <option value="floor">Floor-wise quantity{plan === 'free' ? ' - Premium' : ''}</option>
            </select>
          </label>
          <label>Floor / level
            <input type="text" value={s.defaultFloor} onChange={(e) => s.setDefaultFloor(e.target.value)} />
          </label>
          <label>Deduction mode
            <select value={deductionMode} onChange={(e) => setDeductionMode(e.target.value as 'manual' | 'none')}>
              <option value="manual">Manual opening deduction</option>
              <option value="none">No deduction</option>
            </select>
          </label>
        </div>

        {isFraming && calcAreaMode === 'grid' && (
          <div className="form-grid grid-area-panel">
            <label>X grid from<input type="text" placeholder="E/NT" /></label>
            <label>X grid to<input type="text" placeholder="F/NT" /></label>
            <label>Y grid from<input type="text" placeholder="01/T" /></label>
            <label>Y grid to<input type="text" placeholder="02/T" /></label>
          </div>
        )}

        {isColumn && (
          <div className="form-grid column-height-panel">
            <label>Column layout method
              <select>
                <option>Foundation layout + floor-wise column details</option>
                <option>Separate column layout for every floor</option>
              </select>
            </label>
            <label>Column height source
              <select><option>Automatically read from drawings</option><option>Enter height manually</option></select>
            </label>
            <label>Manual column height<input type="number" min={0} step={0.001} defaultValue={3.2} /></label>
            <label>Height unit<select><option>metre</option><option>millimetre</option></select></label>
          </div>
        )}

        <div className="column-batch-panel">
          <strong><Upload size={15} /> Framing plan</strong>
          <span>Upload marked DWG/BAK, PDF, or DXF framing plan. Marked CAD dimensions are used as the main measurement source.</span>
          <label className="file-input">Framing plan file
            <input ref={fileInputRef} type="file" accept=".dxf,.dwg,.bak,.pdf" multiple onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) setPicked(files.map((f) => f.name)); void parseFiles(files); }} />
          </label>
          {picked.length > 0 && (
            <div className="file-pills">
              {picked.map((name) => {
                const parsed = s.sheets.some((sh) => sh.name === name);
                return (
                  <span key={name} className={`file-pill${parsed ? ' is-ready' : ''}`}>
                    {s.parsing && !parsed ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                    <span className="file-pill-name">{name}</span>
                    <button type="button" aria-label={`Remove ${name}`} onClick={() => removeFile(name)}><X size={13} /></button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="extract-panel">
          <button className="primary-button extract-button" type="button" onClick={handleExtract} disabled={s.parsing || !s.dwg}>
            {s.parsing ? <><Loader2 size={16} className="spin" /> Extracting…</> : <><Ruler size={16} /> Extract Quantity</>}
          </button>
          <div className="extract-status-wrap"><span>{s.status}</span></div>
        </div>
      </div>

      {plan === 'premium' && (
        <div className="table-actions">
          <button className="primary-button" type="button" onClick={s.addMember} disabled={!s.dwg && !s.members.length}><Plus size={15} /> Add member</button>
          <button className="ghost-button" type="button" disabled={!selected} onClick={() => { if (selected) s.duplicateMember(selected); }}><Copy size={15} /> Duplicate</button>
          <button className="danger-button" type="button" disabled={!selected} onClick={() => { if (selected) { s.deleteMember(selected); setSelected(null); } }}><Trash2 size={15} /> Delete</button>
        </div>
      )}

      {!canDetail && (
        <div className="premium-message">
          <strong>Unlock member-wise takeoff <PremiumBadge /></strong>
          <span>Free users see total quantity only. Premium users can download the MB Excel sheet and reference working drawing. <button type="button" className="link-button" onClick={() => navigate('/pricing')}>See plans <ArrowRight size={13} /></button></span>
        </div>
      )}

      <div ref={outputRef} className="output-region">
      {s.parsing && (
        <div className="extract-skeleton" role="status" aria-live="polite">
          <div className="sk-loading"><Loader2 size={16} className="spin" /> Extracting quantities from your drawing…</div>
          <div className="sk-table">
            <div className="sk-row sk-head" />
            <div className="sk-row" /><div className="sk-row" /><div className="sk-row" /><div className="sk-row" />
          </div>
          <div className="sk-hero" />
        </div>
      )}
      {!s.parsing && canDetail && s.outputType !== 'floor' && (
        <div className="table-wrap">
          <table id="member-table">
            <thead>
              <tr>
                <th></th><th>Member / room</th><th>Floor</th>
                {fields.map((f) => <th key={f}>{FIELD_LABEL[f] ?? f}</th>)}
                <th>Quantity ({unitLabel(rule.unit)})</th>
              </tr>
            </thead>
            <tbody>
              {s.members.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={colCount}>
                    <button type="button" className="empty-guide" onClick={openFramingPicker}>
                      <span className="empty-guide-icon" aria-hidden="true"><Upload size={20} /></span>
                      <strong>No members yet — upload a drawing to begin</strong>
                      <span>Click here to choose a framing plan (DWG / DXF) — members populate automatically after <b>Extract Quantity</b>. Or use <b>Add member</b> to enter one manually.</span>
                    </button>
                  </td>
                </tr>
              ) : s.members.map((r) => (
                <tr key={r.id} className={r.needsReview ? 'row-review' : undefined} title={r.reviewReason}>
                  <td><input type="radio" name="member-select" checked={selected === r.id} onChange={() => setSelected(r.id)} /></td>
                  <td><input value={r.member} onChange={(e) => s.updateMember(r.id, { member: e.target.value })} /></td>
                  <td><input value={r.floor} onChange={(e) => s.updateMember(r.id, { floor: e.target.value })} /></td>
                  {fields.map((f) => (
                    <td key={f}><input type="number" value={r[f] as number} onChange={(e) => s.updateMember(r.id, { [f]: +e.target.value } as Partial<MemberRow>)} /></td>
                  ))}
                  <td className="qty-cell">{qtyText(disp(rowQty(r), rule.unit).v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!s.parsing && canDetail && s.outputType === 'floor' && (
        <div className="table-wrap">
          <table id="member-table"><thead><tr><th>Floor</th><th>Quantity</th></tr></thead>
            <tbody>{Object.entries(byFloor).map(([f, q]) => { const d = disp(q, rule.unit); return <tr key={f}><td>{f}</td><td className="qty-cell">{qtyText(d.v)} {d.u}</td></tr>; })}</tbody>
          </table>
        </div>
      )}

      {!s.parsing && (
      <div className="inline-results">
        <div className="section-head-row">
          <div>
            <h2 className="section-title">Quantity result</h2>
            <p className="section-lede">Updates instantly as the item, output type, or member dimensions change.</p>
          </div>
          {showDownloads && (
            <div className="download-actions">
              <button className="primary-button download-button" type="button" onClick={exportXlsx}><FileSpreadsheet size={15} /> Excel MB sheet</button>
              {s.quantityKey === 'slab_shuttering' && <><select aria-label="Reference file format" value={referenceFormat} onChange={(e) => setReferenceFormat(e.target.value as 'dxf' | 'dwg' | 'pdf')} disabled={cadExporting}><option value="dxf">DXF — instant</option><option value="dwg">DWG — cloud conversion</option><option value="pdf">PDF — original CAD conversion</option></select><button className="ghost-button download-button" type="button" onClick={exportReferenceCad} disabled={cadExporting}>{cadExporting ? <Loader2 size={15} className="spin" /> : <Download size={15} />} {cadExporting ? `Creating ${referenceFormat.toUpperCase()}…` : `Reference ${referenceFormat.toUpperCase()}`}</button></>}
              {referenceNotice && <span role="status" style={{ color: referenceNotice.kind === 'error' ? '#b91c1c' : referenceNotice.kind === 'success' ? '#15803d' : undefined, maxWidth: 360 }}>{referenceNotice.text}</span>}
              {referenceReady && <a className="ghost-button download-button" href={referenceReady.url} download={referenceReady.filename}><Download size={15} /> Download PDF now</a>}
            </div>
          )}
        </div>
        <div className="result-grid">
          <div className="result-card"><span className="metric-label"><Layers size={13} /> Selected item</span><strong>{rule.label}</strong></div>
          <div className="result-card result-hero"><span className="metric-label">Total quantity</span><strong>{qtyText(disp(total, rule.unit).v)} <em>{disp(total, rule.unit).u}</em></strong></div>
          <div className="result-card"><span className="metric-label"><Hash size={13} /> Rows counted</span><strong>{s.members.length}</strong></div>
        </div>
        <div className="reader-status standard-status">
          <strong><Info size={15} /> IS code mode of measurement</strong>
          <span>{rule.note}</span>
        </div>
      </div>
      )}
      </div>

      {s.members.length > 0 && (
        <button className="frap" type="button" title="Export Excel CSV" aria-label="Export Excel CSV" onClick={exportCsv}><Download size={20} /></button>
      )}
    </section>
  );
}
