# QSS shared drawing-processing service

## Safety status

Remote processing is **disabled by default**. With `VITE_QSS_REMOTE_PROCESSING` unset or `false`, QSS uses the existing browser Web Worker and existing extraction/calculation rules. This integration does not modify beam, slab, opening, shuttering, concrete, steel, or Excel formulas.

## Deployment shape

```text
Web / Android / iOS
        |
        | versioned job API
        v
Netlify processing-job proxy
        |
        | server-only bearer token
        v
External asynchronous QSS processor
        |
        +-- private object storage for original drawings
        +-- CAD normalisation
        +-- optional AI interpretation for unresolved evidence
        +-- deterministic extraction and calculation engine
```

Netlify never receives the large drawing body. The processor creates short-lived signed upload URLs and the client uploads directly to private object storage. This avoids Netlify function body-size and execution-time limits.

## Versioned API

The shared contract is defined in `src/processing/contracts.ts`. Web and future mobile clients must use the same `apiVersion`. An incompatible response is rejected rather than silently interpreted.

Required processor endpoints:

- `GET /v1/health`
- `POST /v1/jobs`
- `POST /v1/jobs/:id/start`
- `GET /v1/jobs/:id`

The job creation response contains one signed upload target per input file. The completed job contains normalised drawings, extracted members, evidence, warnings, and the extraction version.

## Evidence and AI rules

- The deterministic CAD parser remains authoritative for exact geometry.
- AI may supply unresolved semantics such as a beam-size association or schedule/section link.
- Every AI-supported value must include source evidence and confidence.
- AI must not overwrite a confident deterministic value.
- Low-confidence or conflicting values must be marked for review.
- Final quantities are calculated by the rule engine, never by free-form AI output.

## Netlify configuration

Keep the feature disabled until the processor passes regression testing:

```text
VITE_QSS_REMOTE_PROCESSING=false
```

When the external processor is deployed, add these server-only Netlify variables:

```text
QSS_PROCESSOR_URL=https://processor.example.com
QSS_PROCESSOR_TOKEN=<random server token>
```

Only after health, upload, parsing, evidence and regression tests pass should the frontend flag be changed to `VITE_QSS_REMOTE_PROCESSING=true`.

Never use a `VITE_` prefix for tokens or AI keys because Vite variables are embedded in the public application bundle.

## Mobile integration

Android and iOS use the same create/upload/start/status contract. They do not contain CAD or AI secrets and do not need independent calculation logic. A result produced for the same job and extraction version must be identical on web, Android and iOS.

## Release gate

Before enabling remote processing:

1. Tag the current stable release.
2. Run every existing unit and golden-drawing test locally.
3. Process the verified drawing set through both local and remote paths.
4. Compare member identities, dimensions, deductions, formulas and totals.
5. Investigate every unexplained difference; do not update snapshots blindly.
6. Test cancellation, timeout, corrupt files, duplicate filenames and unavailable-service scenarios.
7. Enable the feature for internal users only.
8. Expand access only after reviewed production jobs match the stable engine.

