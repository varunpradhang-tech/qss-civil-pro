import { useUI } from '../state/ui.js';
import { PageHeader } from '../components/PageHeader.js';
import { PremiumBadge } from '../components/PremiumBadge.js';

const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Bhojpuri', 'Punjabi', 'Bengali', 'Odia', 'Tamil', 'Telugu', 'Kannada', 'Spanish', 'German', 'Chinese', 'Garhwali'];

export function SettingsPage() {
  const { plan, units, setUnits, language, setLanguage, saveData, setSaveData } = useUI();

  return (
    <section className="page">
      <PageHeader eyebrow="Preferences" title="Settings">
        Language, theme, unit display, and data-saving preference.
      </PageHeader>

      <div className="card form-card">
        <div className="form-grid settings-grid">
          <label>Language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l.toLowerCase()}>{l}</option>)}
            </select>
          </label>
          <label>Theme
            <select defaultValue="system" onChange={(e) => { document.body.className = e.target.value === 'system' ? '' : `theme-${e.target.value}`; }}>
              <option value="system">Default as device</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
          <label>Area unit
            <select value={units.area} onChange={(e) => setUnits({ ...units, area: e.target.value })}><option value="sqm">sqm</option><option value="sqft">sqft</option></select>
          </label>
          <label>Running length unit
            <select><option value="rmt">rmt</option><option value="rft">rft</option></select>
          </label>
          <label>Volume unit
            <select value={units.volume} onChange={(e) => setUnits({ ...units, volume: e.target.value })}><option value="cum">cum</option><option value="cft">cft</option></select>
          </label>
          <label>Steel unit
            <select value={units.weight} onChange={(e) => setUnits({ ...units, weight: e.target.value })}><option value="kg">kg</option><option value="mt">mt</option></select>
          </label>
          <label>Save data
            <select value={saveData} onChange={(e) => setSaveData(e.target.value)}><option value="7days">Keep for 7 days</option><option value="premium">Keep more than 1 week - Premium</option></select>
          </label>
        </div>
        {saveData === 'premium' && plan === 'free' && (
          <div className="premium-message"><strong>Premium required <PremiumBadge /></strong><span>Saving project data for more than one week is available in the Premium plan.</span></div>
        )}
      </div>
    </section>
  );
}
