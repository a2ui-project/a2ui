# Visual Parity Tests

Visual parity tests ensure the React renderer produces pixel-identical output to
the Lit renderer (the reference implementation).

## Overview

These tests compare screenshots of the same A2UI components rendered by both
implementations:

- **Lit renderer** (Shadow DOM) - Reference implementation at `localhost:5002`
- **React renderer** (Light DOM) - Test subject at `localhost:5001`

Tests pass when the pixel difference is ≤1%.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Playwright Test Runner                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────────────┐            ┌─────────────────┐        │
│   │  Lit Dev Server │            │ React Dev Server│        │
│   │  localhost:5002 │            │  localhost:5001 │        │
│   └────────┬────────┘            └────────┬────────┘        │
│            │                              │                  │
│            ▼                              ▼                  │
│   ┌─────────────────┐            ┌─────────────────┐        │
│   │  Screenshot A   │◄─compare──►│  Screenshot B   │        │
│   │   (reference)   │ pixelmatch │  (test subject) │        │
│   └─────────────────┘            └─────────────────┘        │
│                                                              │
│                         ▼                                    │
│              ┌───────────────────┐                          │
│              │    Diff Result    │                          │
│              │  0.00% = PASS     │                          │
│              │  >1.00% = FAIL    │                          │
│              └───────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

1.  Build the React renderer first: `bash cd renderers/react npm install npm run
build`

2.  Install visual-parity dependencies: `bash cd visual-parity npm install`

### Running Tests

```bash
# Run all visual parity tests
npm test

# Run tests for a specific component
npm test -- --grep "button"

# Run tests for a specific theme
npm test -- --grep "Theme: lit"

# Run with UI mode (interactive)
npm run test:ui

# View test report
npm run test:report
```

### Development Mode

Run both dev servers to manually inspect components:

```bash
# Start both servers
npm run dev

# Or start individually
npm run dev:react  # localhost:5001
npm run dev:lit    # localhost:5002
```

Then open: - http://localhost:5001?fixture=buttonPrimary&theme=lit (React) -
http://localhost:5002?fixture=buttonPrimary&theme=lit (Lit)

## Project Structure

```
visual-parity/
├── fixtures/
│   ├── index.ts              # Aggregates all fixtures
│   ├── types.ts              # ComponentFixture interface
│   ├── themes/               # Theme definitions
│   │   ├── index.ts
│   │   ├── minimalTheme.ts
│   │   └── visualParityTheme.ts
│   ├── components/           # Per-component fixtures
│   │   ├── button.ts
│   │   ├── text.ts
│   │   ├── card.ts
│   │   └── ...
│   └── nested/               # Complex layout fixtures
│       └── layouts.ts
├── react/                    # React test app
│   ├── src/
│   │   ├── main.tsx
│   │   └── FixturePage.tsx
│   └── vite.config.ts
├── lit/                      # Lit test app
│   ├── src/
│   │   └── main.ts
│   └── vite.config.ts
├── tests/
│   └── visual-parity.spec.ts # Playwright test suite
├── playwright.config.ts
└── package.json
```

## Adding New Fixtures

### 1. Create a Fixture

Add to `fixtures/components/<component>.ts`:

```typescript
import type {ComponentFixture} from '../types';

export const myNewFixture: ComponentFixture = {
  root: 'component-1', // ID of root component
  components: [
    {
      id: 'text-1',
      component: {
        Text: {text: {literalString: 'Hello World'}},
      },
    },
    {
      id: 'component-1',
      component: {
        Button: {child: 'text-1', primary: true},
      },
    },
  ],
  // Optional: initial data model values
  data: {
    '/path/to/value': 'initial value',
  },
};

export const myComponentFixtures = {
  myNewFixture,
};
```

### 2. Export the Fixture

Add to `fixtures/components/index.ts`:

```typescript
export * from './myComponent';
import {myComponentFixtures} from './myComponent';
// Add to allFixtures aggregation
```

Add to `fixtures/index.ts`:

```typescript
import {myComponentFixtures} from './components';

export const allFixtures = {
  ...existingFixtures,
  ...myComponentFixtures,
};
```

### 3. Run the Test

```bash
npm test -- --grep "myNewFixture"
```

## Fixture Format

```typescript
interface ComponentFixture {
  root: string; // ID of the root component to render
  components: Array<{
    id: string; // Unique component ID
    component: Record<string, unknown>; // A2UI component definition
  }>;
  data?: Record<string, unknown>; // Initial data model values (JSON Pointer paths)
}
```

## Themes

Tests run across multiple themes to ensure theme switching works:

| Theme          | Description                       |
| -------------- | --------------------------------- |
| `lit`          | Default litTheme from @a2ui/react |
| `visualParity` | Alternate theme for testing       |
| `minimal`      | Stripped-down theme               |

To test a specific theme: `bash npm test -- --grep "Theme: minimal"`

## Skipped Fixtures

Some fixtures are skipped due to known implementation differences:

| Fixture           | Reason                                                   |
| ----------------- | -------------------------------------------------------- |
| `multipleChoice*` | Implementation differs: React uses radio/checkboxes, Lit |

: : uses `<select>` :

## Troubleshooting

### Vite Cache Issues

If you see `504 Outdated Optimize Dep` errors:

```bash
rm -rf node_modules/.vite react/node_modules/.vite lit/node_modules/.vite
npm run dev:react  # or dev:lit
```

### React Changes Not Reflected

The visual parity apps import from the **built** `@a2ui/react` package. After
making changes:

```bash
# 1. Rebuild React renderer
cd renderers/react
npm run build

# 2. Clear Vite cache and restart
cd visual-parity
rm -rf node_modules/.vite react/node_modules/.vite
npm run dev:react
```

### Test Failures

When a test fails, Playwright saves screenshots to `test-results/`. Compare them
to identify the visual difference.

To debug a specific fixture: ```bash

# Run with headed browser

npm test -- --grep "buttonPrimary" --headed

# Or use UI mode

npm run test:ui ```

## Key Modules

| Module             | Purpose                               |
| ------------------ | ------------------------------------- |
| `@playwright/test` | Browser automation and test framework |
| `pixelmatch`       | Pixel-by-pixel image comparison       |
| `pngjs`            | PNG image parsing                     |
| `vite`             | Dev server for React and Lit apps     |

## Thresholds

| Parameter              | Value     | Purpose                             |
| ---------------------- | --------- | ----------------------------------- |
| `PIXEL_DIFF_THRESHOLD` | 0.01 (1%) | Per-pixel color tolerance           |
| `MAX_DIFF_PERCENT`     | 1%        | Maximum % of pixels that can differ |

## Related Documentation

- [PARITY.md](./PARITY.md) - CSS transformation approach for React/Lit parity
