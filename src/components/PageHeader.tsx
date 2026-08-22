import type { ReactNode } from 'react';

/** Page title + supporting copy, rendered as the teal-wash heading band on every route. */
export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
      <h1 className="page-title">{title}</h1>
      {children && <p className="page-subtitle">{children}</p>}
    </div>
  );
}
