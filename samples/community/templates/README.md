# A2UI templates community demo

This sample demonstrates server-side template expansion in the A2UI Python Agent SDK using the standard Basic Catalog and React client renderer.

---

## Overview

- **Static declarative templates**: Parameterized layout subtrees (such as `UserProfile`, `TeamCard`, `TeamRoster`, `TeamGoalList`, `TeamFeedbackBoard`) defined in JSON and expanded into Basic Catalog primitives (`Card`, `Column`, `Row`, `Text`, `Divider`, `Icon`, `Button`).
- **Dynamic server resolvers**: Programmatic templates (such as `EmployeeSalaryCard`) that run Python resolver callbacks to query internal databases. The model only receives and passes identifiers, while sensitive numbers are injected server-side.
- **Express DSL & synchronous expansion**: The language model outputs concise Express DSL. The backend parser expands templates synchronously without requiring custom client components.
- **Interactive studio & library**: The React client includes an Interactive Chat with suggested prompt chips and latency/token metrics, alongside a 3-Stage Dynamic Template Studio showing input arguments, underlying blueprint JSON, and live rendered output.

---

## Running the demo

### 1. Start the backend server

```bash
cd samples/community/templates
uv run uvicorn server:app --reload --port 8000
```

To test live Gemini generation in addition to the preset templates, set your API key and optional model:

```bash
export GEMINI_API_KEY="your-api-key"
export GEMINI_MODEL="gemini-flash-latest"  # Optional, defaults to gemini-flash-latest
```

### 2. Start the frontend client

```bash
cd samples/community/templates/client
yarn install
yarn dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Testing

Run the Playwright end-to-end integration test suite:

```bash
node samples/community/templates/test_e2e.mjs
```
