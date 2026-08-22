import { ScrollText, ShieldCheck, MonitorSmartphone, HardHat } from 'lucide-react';
import { PageHeader } from '../components/PageHeader.js';

const STATS = [
  { value: '17', label: 'IS-1200 measurement rules' },
  { value: '±0.5%', label: 'Slab auto-extraction accuracy' },
  { value: '100%', label: 'Runs in your browser — no upload' },
];

const VALUES = [
  { icon: ShieldCheck, title: 'Measurement you can defend', body: 'Every quantity traces to an IS-1200 mode of measurement and an editable member row — no black-box numbers you can’t reproduce in front of a client.' },
  { icon: MonitorSmartphone, title: 'Local-first by design', body: 'Drawings are parsed in your browser with WebAssembly. Nothing is uploaded to a server, so confidential project files never leave your machine.' },
  { icon: HardHat, title: 'Built for real estimators', body: 'The workflow mirrors how surveyors actually work — drawing type, work group, rule, then a member table you can correct — instead of forcing a rigid template.' },
];

export function AboutPage() {
  return (
    <section className="page">
      <PageHeader eyebrow="Our story" title="Quantity surveying, rebuilt for the browser">
        QSS Pro turns structural CAD drawings into billing-grade IS-1200 quantities — shuttering, concrete, and steel — without AutoCAD, a backend, or a spreadsheet template.
      </PageHeader>

      <div className="stat-band">
        {STATS.map((s) => (
          <div key={s.label} className="stat-item"><strong>{s.value}</strong><span>{s.label}</span></div>
        ))}
      </div>

      <div className="value-grid">
        {VALUES.map((v) => (
          <div key={v.title} className="card value-card">
            <span className="value-icon"><v.icon size={20} /></span>
            <h3>{v.title}</h3>
            <p>{v.body}</p>
          </div>
        ))}
      </div>

      <div className="card prose about-mission">
        <h2 className="section-title"><ScrollText size={20} /> Why we built it</h2>
        <p>Takeoff still runs on hand measurement and fragile spreadsheets. Consultants mark drawings, juniors key numbers into Excel, and everyone re-checks by hand at billing time. QSS Pro keeps the engineer in control of every dimension while removing the repetitive arithmetic — reading marked CAD dimensions, applying the correct code rule, and recomputing the moment a value changes.</p>
        <p>It is a modern, deployable web app built on the rule-based approach proven in the field, so the numbers match how quantities are actually measured on site.</p>
      </div>
    </section>
  );
}
