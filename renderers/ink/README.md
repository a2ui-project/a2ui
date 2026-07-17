# @a2ui/ink

Ink (terminal) renderer for [A2UI](https://a2ui.org/) v0.9.x.

Reuses `@a2ui/web_core` for protocol / state / binding. This package maps the
**basic catalog** onto [Ink](https://github.com/vadimdemedes/ink) widgets.

## Catalog coverage

| Component                   | Terminal mapping                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Text                        | Ink `Text`; variants via bold/underline/color; Markdown markers stripped (no MD renderer in terminal) |
| Row / Column / List         | `Box` flex layouts; `justify`/`align` and child `weight` (flex-grow) honored                          |
| Card / Divider              | bordered container / full-width rule                                                                  |
| Button                      | focus + Enter/Space; `primary` green+bold, `borderless` underlined link style                         |
| CheckBox / ChoicePicker     | focus + Enter/Space; `chips` displayStyle, filterable options, validation errors                      |
| TextField / DateTimeInput   | focus + type; `number`/ISO input filtering, `obscured` masking, format hints, validation errors       |
| Slider / Tabs               | focus + ←/→; slider honors `step`                                                                     |
| Modal                       | focus trigger row, Enter/Space opens inline, Esc closes                                               |
| Icon                        | glyph map covering the full catalog icon set                                                          |
| Image / Video / AudioPlayer | framed placeholders sized by variant (no media in terminal)                                           |

Interaction is **keyboard selection**, not pointer click (Tab focus → activate).

## Setup

```bash
yarn install
yarn workspace @a2ui/ink build
```

## Demo (all official examples)

```bash
cd renderers/ink
yarn demo --list                 # list example ids
yarn demo 00_simple-text
yarn demo 19_software-purchase
yarn demo 34_child-list-template
yarn demo 36_modal
```

Partial names work (`yarn demo software-purchase`).

## Explorer (gallery)

Interactive terminal gallery — list / filter / preview all official examples,
with a message stepper and data-model inspector (like React's `a2ui_explorer`):

```bash
cd renderers/ink
yarn explorer
yarn explorer 32_advanced-form
```

Keys: ↑/↓ Enter to open · `/` filter · in preview Ctrl+S step messages ·
Ctrl+D data model · Ctrl+L back to list. See [explorer/README.md](explorer/README.md).

## Live demo (same agent as React shell)

Uses the [Restaurant Finder Agent](../../samples/agent/adk/restaurant_finder/)
over A2A — the same backend as `samples/client/react/shell`.

**Mock (no agent / no API key):**

```bash
cd renderers/ink
yarn demo:live --mock --auto
```

**Live agent:**

```bash
# Terminal 1 — start the agent (needs GEMINI_API_KEY in .env)
cd samples/agent/adk/restaurant_finder
uv run .

# Terminal 2 — Ink client
cd renderers/ink
yarn demo:live --auto
# or: yarn demo:live --auto "Find sushi near me"
```

Keys: type a query + Enter to send; after the UI renders, Tab/Enter to interact;
Ctrl+N for a new query (Esc cancels back to the UI); Ctrl+C to quit. Override
agent URL with `--url` or `$A2A_AGENT_URL`.

## Usage

```tsx
import {render} from 'ink';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/ink/v0_9';

const processor = new MessageProcessor([basicCatalog], async action => {
  console.log(action);
});
processor.processMessages(messages);
const surface = [...processor.model.surfacesMap.values()][0]!;
render(<A2uiSurface surface={surface} />);
```
