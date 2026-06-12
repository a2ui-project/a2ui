# Contact sample verification tests

This directory contains tests to verify custom component integration specifically within the `contact` sample application environment.

## How to run

These tests run via the Vite development server used by the contact sample.

### 1. Start the dev server

From the `web/lit/samples/contact` directory, run:

```bash
yarn dev
```

### 2. Access the tests

Open your browser and navigate to the local server (usually port 5173):

- **Component override test**:
  [http://localhost:5173/ui/custom-components/test/override-test.html](http://localhost:5173/ui/custom-components/test/override-test.html)
  _Verifies that a standard component (TextField) can be overridden by a custom implementation._

- **Hierarchy graph integration test**:
  [http://localhost:5173/ui/custom-components/test/hierarchy-test.html](http://localhost:5173/ui/custom-components/test/hierarchy-test.html)
  _Verifies that the HierarchyGraph component renders correctly within the contact app's build setup._

## Files

- `override-test.html` & `override-test.ts`: Implements and tests a custom `TextField` override.
- `hierarchy-test.html`: Tests the `HierarchyGraph` component.
