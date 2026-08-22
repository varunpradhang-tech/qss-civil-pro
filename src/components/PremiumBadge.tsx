import { Star } from 'lucide-react';

/** Consistent gold "★ Premium" chip used everywhere the Premium plan is referenced. */
export function PremiumBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`premium-badge ${className}`.trim()}>
      <Star size={11} strokeWidth={0} fill="currentColor" />
      Premium
    </span>
  );
}
