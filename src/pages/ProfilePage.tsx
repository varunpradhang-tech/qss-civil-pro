import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, KeyRound, LogIn, IdCard, Crown } from 'lucide-react';
import { useUI } from '../state/ui.js';
import { PageHeader } from '../components/PageHeader.js';
import { PremiumBadge } from '../components/PremiumBadge.js';

export function ProfilePage() {
  const { plan, setPlan, account, setAccount } = useUI();
  const navigate = useNavigate();

  const [userName, setUserName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginOtp, setLoginOtp] = useState('');
  const [sentOtp, setSentOtp] = useState('');
  const [otpStatus, setOtpStatus] = useState('Not logged in');

  return (
    <section className="page">
      <PageHeader eyebrow="Account" title="Profile">
        Login, plan status, and premium access.
      </PageHeader>

      <div className="profile-grid">
        <div className="profile-card">
          <strong><KeyRound size={16} /> Login with email OTP</strong>
          <label>User name<input type="text" placeholder="Your name" value={userName} onChange={(e) => setUserName(e.target.value)} /></label>
          <label>Email ID<input type="email" placeholder="name@example.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} /></label>
          <div className="inline-actions">
            <button className="primary-button" type="button" onClick={() => {
              if (!/.+@.+\..+/.test(loginEmail)) { setOtpStatus('Enter a valid email first.'); return; }
              const code = String(Math.floor(100000 + Math.random() * 900000));
              setSentOtp(code); setOtpStatus(`OTP sent to ${loginEmail} — demo code ${code} (no email backend in this build)`);
            }}><Mail size={15} /> Send OTP</button>
            <span>{otpStatus}</span>
          </div>
          <label>OTP<input type="text" inputMode="numeric" placeholder="Enter OTP" value={loginOtp} onChange={(e) => setLoginOtp(e.target.value)} /></label>
          <button className="ghost-button" type="button" onClick={() => {
            if (sentOtp && loginOtp === sentOtp) {
              const id = 'QSS-' + Math.abs([...loginEmail].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36).toUpperCase();
              setAccount({ name: userName || 'User', email: loginEmail, id }); setOtpStatus('Logged in.');
            } else setOtpStatus('OTP does not match. Send a new code.');
          }}><LogIn size={15} /> Verify login</button>
        </div>

        <div className="profile-card">
          <strong><IdCard size={16} /> Account ID</strong>
          <div className="account-lines">
            <div><span>Name</span><strong>{account?.name ?? 'Guest user'}</strong></div>
            <div><span>Email</span><strong>{account?.email ?? 'Not logged in'}</strong></div>
            <div><span>User ID</span><strong>{account?.id ?? 'Not generated'}</strong></div>
          </div>
          <p>User ID helps restore premium plan and history when the same user changes device.</p>
        </div>

        <div className="profile-card plan-card">
          <strong><Crown size={16} /> Plan details</strong>
          <div className="plan-summary"><span>Current plan</span>{plan === 'premium' ? <PremiumBadge className="lg" /> : <strong>Free</strong>}</div>
          <p>Free users can extract total quantity. Premium users can view member-wise takeoff, download Excel MB sheets, and keep project data for more than one week.</p>
          {plan === 'premium'
            ? <button className="ghost-button" type="button" onClick={() => setPlan('free')}>Switch to Free</button>
            : <button className="primary-button" type="button" onClick={() => navigate('/pricing')}>See premium plans</button>}
        </div>
      </div>
    </section>
  );
}
