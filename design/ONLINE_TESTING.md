# QSS online-only testing workflow

## Policy

- `main` is production. Do not test unfinished calculation changes directly on it.
- `staging` is the permanent online testing branch.
- Feature changes go through a pull request and the GitHub **QSS quality gate**.
- Netlify deploys only code stored in GitHub. `localhost:8888` is no longer an acceptance environment.
- Remote/AI processing stays disabled until its results match the stable engine on the verified drawing corpus.

## One-time Netlify setup

1. Open the QSS project in Netlify.
2. Go to **Project configuration → Build & deploy → Continuous deployment → Branches and deploy contexts**.
3. Configure branch deploys and add the `staging` branch.
4. Keep production branch as `main`.
5. Keep Deploy Previews enabled for pull requests.
6. Do not set `VITE_QSS_REMOTE_PROCESSING=true` yet.

The staging URL normally follows Netlify's branch-deploy form, for example
`https://staging--qss-civil-pro.netlify.app`. Use the exact URL shown by Netlify.

## Daily workflow

1. Changes are committed to a feature branch, not `main`.
2. Push the feature branch to GitHub.
3. Open a pull request into `staging`.
4. Wait for **QSS quality gate** to pass:
   - locked dependency install
   - TypeScript check
   - regression tests
   - production build
5. Open the Netlify Deploy Preview and test the uploaded drawings there.
6. Record expected and actual member counts, dimensions, deductions and totals.
7. Merge into `staging` only after review.
8. Promote `staging` to `main` only when the full verified drawing corpus passes.

## Temporary staging while Netlify deploy credits are paused

The `staging` branch can be published by GitHub Pages at:

`https://varunpradhang-tech.github.io/qss-civil-pro/`

This temporary host runs the existing browser CAD parser and quantity engine.
Netlify Functions are not available there, so CloudConvert-based PDF/DWG reference
exports are not part of this temporary staging test. Quantity extraction and the
client-side Excel workflow remain the intended test scope.

## Required drawing regression record

Every accepted drawing must eventually have a manifest containing:

- anonymised drawing identifier and checksum
- drawing roles (framing plan, slab schedule, beam detail, section, notes)
- work item and output type
- expected member count
- expected member marks, sizes and dimensions
- expected deductions and formulas
- verified total and permitted tolerance
- reviewer and verification date

Never replace an expected result merely because new code produces a different result. Investigate the difference first.

## External processor activation gate

The web/mobile client may use the external processor only after:

1. `/v1/health`, job creation, signed upload, start and polling work online.
2. Drawings are deleted according to the retention policy.
3. The processor passes the same verified drawing corpus as the stable web engine.
4. Every AI-supported value returns source evidence and confidence.
5. Conflicts and low confidence are shown as review items.
6. A staging-only Netlify environment value enables remote processing.
7. Production remains disabled until staging is formally accepted.
