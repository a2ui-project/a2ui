# Meta-Skill Execution Walkthrough: Creating a Bespoke `render-ui` Skill (JavaScript/JSX)

This document shows a reference walkthrough of an AI Managed Agent using `create-a2ui-renderer` at setup time using JavaScript/JSX.

---

## Example Input Catalog (`catalogs/trip_catalog.json`)

```json
{
  "components": {
    "FlightCard": {
      "description": "Displays flight details",
      "properties": {
        "origin": {"type": "string"},
        "destination": {"type": "string"},
        "price": {"type": "string"}
      }
    }
  }
}
```

---

## Agent Output Skill Folder (`.agents/skills/render-ui/`)

### File 1: `.agents/skills/render-ui/SKILL.md`
```markdown
---
name: render-ui
description: Render UI skill for Trip Agent
---

# Render UI Skill

## Available Catalogs & Components

### `FlightCard`
Displays flight details.
- `origin` (string)
- `destination` (string)
- `price` (string)
```

### File 2: `.agents/skills/render-ui/lib/builder.js`
```javascript
export class Component {
  constructor(type, props = {}) {
    this.type = type;
    Object.assign(this, props);
  }
  toDict() {
    return { type: this.type, ...this };
  }
}

export class FlightCard extends Component {
  constructor(props = {}) {
    super('FlightCard', props);
  }
}
```

### File 3: `.agents/skills/render-ui/references/01_flight_card.js`
```javascript
import { FlightCard } from '../lib/builder.js';
import { emitUI } from '../lib/emitter.js';

const flight = new FlightCard({ origin: "SFO", destination: "CDG", price: "$920" });
emitUI(flight);
```
