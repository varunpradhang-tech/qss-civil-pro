import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { Ruler, History, Tag, FileText, Building2, type LucideIcon } from 'lucide-react';
import { PlanSwitch } from './PlanSwitch.js';
import { ProfileMenu } from './ProfileMenu.js';

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'Extract', icon: Ruler, end: true },
  { to: '/history', label: 'History', icon: History },
  { to: '/pricing', label: 'Pricing', icon: Tag },
  { to: '/terms', label: 'Terms', icon: FileText },
  { to: '/about', label: 'About us', icon: Building2 },
];

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  return (
    <div className="site">
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="QSS Pro home">
            <span className="brand-mark">QSS</span>
            <span className="brand-name">Pro</span>
          </Link>

          <nav className={`main-nav${menuOpen ? ' is-open' : ''}`} aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                <n.icon size={15} /> {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            <PlanSwitch />
            <ProfileMenu />
            <button
              type="button"
              className={`nav-toggle${menuOpen ? ' is-open' : ''}`}
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>

      <main className="site-main">
        <div className="page-container">
          <Outlet />
        </div>
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="footer-mark">QSS</span>
            <span className="footer-word">Pro</span>
          </div>
          <p className="footer-tag">Rule-based civil quantity takeoff — IS-1200 measurement, in your browser.</p>
          <p className="footer-fine">© {new Date().getFullYear()} QSS Pro · Verify all quantities before billing.</p>
        </div>
      </footer>
    </div>
  );
}
