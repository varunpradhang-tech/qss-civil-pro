import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Settings, LogOut, LogIn } from 'lucide-react';
import { useUI } from '../state/ui.js';

/** Round avatar button in the header that opens a small account dropdown. */
export function ProfileMenu() {
  const { account, plan, setAccount } = useUI();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const initials = account ? account.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : 'GU';
  const go = (path: string) => { setOpen(false); navigate(path); };

  return (
    <div className="profile-menu" ref={ref}>
      <button
        type="button"
        className="avatar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
      >
        {initials}
      </button>
      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-head">
            <strong>{account?.name ?? 'Guest user'}</strong>
            <span>{account?.email ?? 'Not logged in'}</span>
            <span className={`plan-chip${plan === 'premium' ? ' is-premium' : ''}`}>{plan === 'premium' ? '★ Premium' : 'Free plan'}</span>
          </div>
          <button type="button" role="menuitem" onClick={() => go('/profile')}><User size={16} /> Profile</button>
          <button type="button" role="menuitem" onClick={() => go('/settings')}><Settings size={16} /> Settings</button>
          <div className="profile-dropdown-sep" />
          {account ? (
            <button type="button" role="menuitem" className="danger-item" onClick={() => { setOpen(false); setAccount(null); }}>
              <LogOut size={16} /> Log out
            </button>
          ) : (
            <button type="button" role="menuitem" onClick={() => go('/profile')}><LogIn size={16} /> Log in</button>
          )}
        </div>
      )}
    </div>
  );
}
