import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { ExtractPage } from './pages/ExtractPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { PricingPage } from './pages/PricingPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TermsPage } from './pages/TermsPage.js';
import { AboutPage } from './pages/AboutPage.js';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ExtractPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="*" element={<ExtractPage />} />
      </Route>
    </Routes>
  );
}
