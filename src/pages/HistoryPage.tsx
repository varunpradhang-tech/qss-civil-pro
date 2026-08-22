import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, FolderOpen, Trash2, Clock } from 'lucide-react';
import { useStore } from '../state/store.js';
import { PageHeader } from '../components/PageHeader.js';

export function HistoryPage() {
  const s = useStore();
  const navigate = useNavigate();
  useEffect(() => { void s.refreshProjects(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="page">
      <PageHeader eyebrow="Saved locally" title="History">
        Saved quantity takeoffs are stored in this browser.
      </PageHeader>

      <div className="history-actions">
        <button className="primary-button" type="button" onClick={() => { void s.refreshProjects(); s.setStatus('Takeoff saved.'); }}><Save size={15} /> Save current takeoff</button>
        <span>{s.savedProjects.length ? `${s.savedProjects.length} saved` : 'No saved takeoffs yet.'}</span>
      </div>

      <div className="history-list">
        {s.savedProjects.map((p) => (
          <div key={p.id} className="history-card">
            <div className="history-meta"><strong>{p.name}</strong><div className="metric-label"><Clock size={12} /> {p.panels} members · {new Date(p.updatedAt).toLocaleString()}</div></div>
            <div className="inline-actions">
              <button className="ghost-button" type="button" onClick={() => { void s.openProject(p.id); navigate('/'); }}><FolderOpen size={15} /> Open</button>
              <button className="danger-button" type="button" onClick={() => s.deleteSavedProject(p.id)}><Trash2 size={15} /> Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
