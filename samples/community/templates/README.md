# A2UI Templates Community Demo

This demo demonstrates **A2UI Server-Side Template Expansion** using the updated A2UI Agent SDK and the standard Basic Catalog.

## Overview

- **Templates System**: Parameterized layout subtrees (e.g. `UserProfile`, `TeamCard`, `TeamRoster`, `TeamGoalList`, `TeamFeedbackBoard`) are defined on the server and exposed to the LLM agent via synthetic inference catalogs.
- **Express DSL & Synchronous Expansion**: The LLM outputs compact A2UI Express DSL. The backend compiler parses the DSL and resolves/expands templates into standard A2UI messages (`Card`, `Column`, `Row`, `Text`, `Divider`, `Icon`, `Button`) in a single synchronous pass.
- **Basic Catalog Compatibility**: All templates expand into primitive components from the official A2UI Basic Catalog, eliminating custom renderer dependencies.

---

## Running the Demo

### 1. Start the Backend Server

```bash
cd samples/community/templates
uv run uvicorn server:app --reload --port 8000
```

*(Optional: export `GEMINI_API_KEY=your_key` to test live Gemini inference in addition to preset templates).*

### 2. Start the Frontend Client

```bash
cd samples/community/templates/client
yarn install
yarn dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.
