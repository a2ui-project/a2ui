# A2UI Ink Explorer

Terminal gallery for `@a2ui/ink` — the CLI counterpart of
[`renderers/react/a2ui_explorer`](../../react/a2ui_explorer).

Loads every official example under
`specification/v0_9_1/catalogs/basic/examples/`.

## Run

```bash
cd renderers/ink
yarn explorer                 # browse list
yarn explorer 32_advanced     # jump to a matching example
yarn explorer --help
```

## Features

| Feature              | How                                                      |
| -------------------- | -------------------------------------------------------- |
| Example browser      | ↑/↓ + Enter                                              |
| Filter               | `/` then type                                            |
| Live preview         | Renders with `A2uiSurface`                               |
| Message stepper      | Ctrl+S applies the next JSON message (progressive build) |
| Reset / apply-all    | Ctrl+X / Ctrl+R                                          |
| Data model inspector | Ctrl+D                                                   |
| Action log           | Ctrl+A (on by default)                                   |
| Back to list         | Ctrl+L                                                   |

Preview shortcuts are **Ctrl-chords only**, so they never steal keystrokes from
TextField / DateTimeInput.
