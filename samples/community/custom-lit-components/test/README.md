# Custom component verification pages

This directory contains pages that verify the custom component integration in
[..](../README.md) renders correctly against the published `@a2ui/*` packages.

CI (`.github/workflows/community_code.yml`) builds both pages as part of
`yarn workspace custom-lit-components run build`, so a broken import or a renderer API change fails
the `Community Code CI / web` job. Open them in a browser for the visual check.

## How to run

### 1. Start the dev server

From `samples/community`, run:

```bash
yarn workspace custom-lit-components run dev
```

### 2. Access the pages

Open your browser and navigate to the local server (usually port 5173):

- **Component override test**:
  [http://localhost:5173/test/override-test.html](http://localhost:5173/test/override-test.html)
  _Verifies that a standard component (`TextField`) can be overridden by a custom implementation._

- **Org chart integration test**:
  [http://localhost:5173/test/org-chart-test.html](http://localhost:5173/test/org-chart-test.html)
  _Verifies that `OrgChart` renders and dispatches `a2uiaction` events when a node is clicked. The
  clicked node is echoed into a `#action-status` element below the chart._

## Files

- `override-test.html` & `override-test.ts`: registers and renders a custom `TextField` override.
- `org-chart-test.html` & `org-chart-test.ts`: renders `OrgChart` and reports its click actions.
