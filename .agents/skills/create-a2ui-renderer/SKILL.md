---
name: create-a2ui-renderer
description: Meta-skill for synthesizing target application .agents/skills/render-ui skills from A2UI component catalog schemas.
---

# `create-a2ui-renderer` Meta-Skill

This meta-skill instructs an AI Agent on how to read A2UI component catalog definitions and synthesize a bespoke, self-contained target skill at `.agents/skills/render-ui/`.

---

## Direct SDK CLI Execution

If the `a2ui_agent` Python package is installed, you can generate the target skill automatically via the CLI:

```bash
uv run python -m a2ui.skill_generator \
  --name render-ui \
  --target-language javascript \
  --catalog path/to/component-catalog.json \
  --output .agents/skills/render-ui
```

---

## Agent-Native Synthesis Protocol

If running without the SDK installed, follow these steps to synthesize the skill manually:

### Step 1: Read Catalog Schema
Read the component catalog schema (JSON or YAML) from the project directory (e.g. `catalog/component-catalog.json` or `catalogs/`).

### Step 2: Create Output Files

Create the following files under `.agents/skills/render-ui/`:

#### 1. `.agents/skills/render-ui/SKILL.md`
Generate the prompt contract documentation, listing each component name, description, and property type from the catalog schema.

#### 2. `.agents/skills/render-ui/lib/builder.js`
Generate JavaScript builder classes for all components declared in the catalog schema:

```javascript
export class Component {
  constructor(type, props = {}) {
    this.type = type;
    this.props = props;
  }

  toDict() {
    const result = { type: this.type };
    for (const [key, value] of Object.entries(this.props)) {
      if (value !== undefined) {
        if (value instanceof Component) {
          result[key] = value.toDict();
        } else if (Array.isArray(value)) {
          result[key] = value.map(v => v instanceof Component ? v.toDict() : v);
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  }
}

// Generate a class for each catalog component:
export class FlightCard extends Component {
  constructor(props = {}) {
    super('FlightCard', props);
  }
}

export class HotelCard extends Component {
  constructor(props = {}) {
    super('HotelCard', props);
  }
}
```

#### 3. `.agents/skills/render-ui/lib/emitter.js`
Generate the A2UI JavaScript message emitter:

```javascript
export function updateComponents(payload, surfaceId = "main") {
  const data = (payload && typeof payload.toDict === "function") ? payload.toDict() : payload;
  const message = {
    version: "0.9",
    action: "ui.updateComponents",
    surface_id: surfaceId,
    payload: data
  };

  console.log("---A2UI_START---");
  console.log(JSON.stringify(message));
  console.log("---A2UI_END---");

  if (typeof window !== "undefined") {
    window.postMessage({ type: "A2UI_RENDER", data: message }, "*");
  }
}
```

#### 4. `.agents/skills/render-ui/references/`
1. Convert any example A2UI JSON payloads found in the project into executable JavaScript code snippets (`references/01_example.js`) using `lib/builder.js`.
2. **Generate `references/README.md`**: Create a markdown index file listing and describing all generated reference modules in `references/` along with instructions on running pre-flight CLI self-tests.

```javascript
import { FlightCard, HotelCard } from '../lib/builder.js';
import { updateComponents } from '../lib/emitter.js';

const flight = new FlightCard({
  origin: "SFO",
  destination: "CDG",
  airline: "Air France",
  price: "$920"
});

updateComponents(flight);
```

---

## Step 3: Verification
Verify that `.agents/skills/render-ui/SKILL.md`, `.agents/skills/render-ui/lib/builder.js`, and `.agents/skills/render-ui/references/README.md` exist and pass Node.js pre-flight tests.
