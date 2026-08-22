import { PageHeader } from '../components/PageHeader.js';

export function TermsPage() {
  return (
    <section className="page">
      <PageHeader eyebrow="Legal" title="Terms & Conditions">
        Basic terms for using QSS Pro quantity results.
      </PageHeader>

      <div className="card prose">
        <p>QSS Pro calculates quantities from uploaded drawings and selected measurement rules. Users must verify drawings, dimensions, revisions, and final billing quantities before submission.</p>
        <p>Quantities are intended to follow the applicable IS-code mode of measurement, but project contract conditions and consultant notes take priority where applicable.</p>
        <p>The Free plan provides total quantity only. The Premium plan provides detailed member-wise quantity sheets and Excel / reference downloads.</p>
      </div>
    </section>
  );
}
