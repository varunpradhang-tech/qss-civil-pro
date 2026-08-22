import { useUI } from '../state/ui.js';

/** Segmented Free / Premium toggle in the header.
 *  A testing affordance to preview free vs premium behavior — flips the plan directly. */
export function PlanSwitch() {
  const { plan, setPlan } = useUI();
  return (
    <div className="plan-switch" data-active={plan} role="group" aria-label="Plan">
      <button
        type="button"
        className={`plan-switch-option${plan === 'free' ? ' is-on' : ''}`}
        aria-pressed={plan === 'free'}
        onClick={() => setPlan('free')}
      >
        Free
      </button>
      <button
        type="button"
        className={`plan-switch-option${plan === 'premium' ? ' is-on' : ''}`}
        aria-pressed={plan === 'premium'}
        onClick={() => setPlan('premium')}
      >
        Premium
      </button>
    </div>
  );
}
