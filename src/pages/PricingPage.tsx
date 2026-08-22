import { useState } from 'react';
import { Check, Minus, Star, BadgeCheck } from 'lucide-react';
import { useUI, type Plan } from '../state/ui.js';
import { PageHeader } from '../components/PageHeader.js';

type Cycle = 'monthly' | 'yearly';
const YEARLY_SAVING = 20; // %

interface Tier {
  id: Plan;
  name: string;
  tagline: string;
  featured?: boolean;
  price: Record<Cycle, { amount: string; cadence: string; sub?: string }>;
  features: { label: string; included: boolean }[];
}

const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything you need to price a single element fast.',
    price: {
      monthly: { amount: '₹0', cadence: 'forever' },
      yearly: { amount: '₹0', cadence: 'forever' },
    },
    features: [
      { label: 'Total quantity extraction', included: true },
      { label: 'All 17 IS-1200 measurement rules', included: true },
      { label: 'Auto slab & beam extraction from DWG/DXF', included: true },
      { label: 'CSV export', included: true },
      { label: 'Local project storage (7 days)', included: true },
      { label: 'Member-wise & floor-wise takeoff', included: false },
      { label: 'Excel Measurement Book download', included: false },
      { label: 'Reference working-drawing download', included: false },
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    tagline: 'Full billing-grade takeoff for working estimators.',
    featured: true,
    price: {
      monthly: { amount: '₹999', cadence: 'per month' },
      yearly: { amount: '₹799', cadence: 'per month', sub: '₹9,588 billed annually' },
    },
    features: [
      { label: 'Everything in Free', included: true },
      { label: 'Member-wise & floor-wise takeoff', included: true },
      { label: 'Excel Measurement Book (MB) download', included: true },
      { label: 'Reference working-drawing download', included: true },
      { label: 'Project data kept beyond 1 week', included: true },
      { label: 'Steel BBS estimator & unit switching', included: true },
      { label: 'Priority email support', included: true },
      { label: 'Cancel anytime', included: true },
    ],
  },
];

export function PricingPage() {
  const { plan, setPlan } = useUI();
  const [cycle, setCycle] = useState<Cycle>('yearly');

  return (
    <section className="page">
      <PageHeader eyebrow="Plans & pricing" title="Simple pricing that scales with your billing">
        Start free and upgrade when you need billing-grade measurement books. No hidden charges — quantities always follow IS-1200.
      </PageHeader>

      <div className="billing-toggle-row">
        <div className="billing-toggle" data-active={cycle} role="group" aria-label="Billing cycle">
          <button type="button" className={`billing-option${cycle === 'monthly' ? ' is-on' : ''}`} aria-pressed={cycle === 'monthly'} onClick={() => setCycle('monthly')}>Monthly</button>
          <button type="button" className={`billing-option${cycle === 'yearly' ? ' is-on' : ''}`} aria-pressed={cycle === 'yearly'} onClick={() => setCycle('yearly')}>Yearly</button>
        </div>
        <span className="save-pill">Save {YEARLY_SAVING}% with yearly</span>
      </div>

      <div className="pricing-grid">
        {TIERS.map((t) => {
          const current = plan === t.id;
          const p = t.price[cycle];
          const showSaving = t.id === 'premium' && cycle === 'yearly';
          return (
            <div key={t.id} className={`pricing-card${t.featured ? ' is-featured' : ''}${current ? ' is-current' : ''}`}>
              <div className="pricing-badges">
                {t.featured && <span className="pricing-badge"><Star size={11} strokeWidth={0} fill="currentColor" /> Most popular</span>}
                {current && <span className="pricing-badge current-badge"><BadgeCheck size={13} /> Your plan</span>}
              </div>
              <div className="pricing-head">
                <h2 className="pricing-name">{t.id === 'premium' && <Star size={17} strokeWidth={0} fill="var(--gold)" />}{t.name}</h2>
                <p className="pricing-tagline">{t.tagline}</p>
                <div className="pricing-price">
                  <strong>{p.amount}</strong>
                  <span>{p.cadence}</span>
                  {showSaving && <span className="price-saving">Save {YEARLY_SAVING}%</span>}
                </div>
                <p className="pricing-subprice">{p.sub ?? (t.id === 'premium' ? 'Billed monthly · cancel anytime' : 'No card required')}</p>
              </div>
              <ul className="pricing-features">
                {t.features.map((f) => (
                  <li key={f.label} className={f.included ? 'inc' : 'exc'}>
                    <span className="tick" aria-hidden="true">{f.included ? <Check size={12} strokeWidth={3} /> : <Minus size={12} strokeWidth={3} />}</span>{f.label}
                  </li>
                ))}
              </ul>
              <div className="pricing-cta">
                {current ? (
                  <button className="ghost-button pricing-button" type="button" disabled>Current plan</button>
                ) : t.id === 'premium' ? (
                  <button className="primary-button pricing-button" type="button" onClick={() => setPlan('premium')}>Upgrade to Premium</button>
                ) : (
                  <button className="ghost-button pricing-button" type="button" onClick={() => setPlan('free')}>Switch to Free</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="reader-status standard-status pricing-note">
        <strong>Every plan measures to IS-1200</strong>
        <span>The rule engine, formulas, and auto-extraction are identical across plans. Premium unlocks detailed output, downloads, and longer storage — never different numbers.</span>
      </div>
    </section>
  );
}
