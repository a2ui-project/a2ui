# A2UI JupyterLab renderer

`a2ui-jupyter` displays A2UI v1.0 surfaces as notebook output and forwards
renderer messages to Python. It uses `anywidget` and the A2UI React renderer.
It requires Python 3.11 or newer. The kernel must use `ipykernel` 7.4 or newer
for cells that await user input.

## Build the widget bundle

The Python package includes a JavaScript bundle built from the repository's
TypeScript workspace. From the repository root, run:

```bash
corepack yarn workspace @a2ui/jupyter build
```

Then install the Python package in the same environment as the Jupyter kernel.
For a source checkout, run `uv sync --all-packages` from the repository root.

## Use in a notebook

```python
from a2ui_jupyter import A2UISurface

surface = A2UISurface()
surface.send(
    [
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "example",
                "catalogId": "https://a2ui.org/specification/v1_0/basic_catalog.json",
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": "example",
                "components": [
                    {
                        "id": "root",
                        "component": "Text",
                        "text": "Hello from A2UI",
                    }
                ],
            },
        },
    ]
)
surface
```

`send` validates every message as an A2UI v1.0 agent-to-renderer message before
sending any of them. Renderer-to-agent messages are validated before they are
delivered to callbacks or queues:

```python
surface.on_action(print)
action = await surface.next_action()
```

Use `surface.on_message(handler)` or `await surface.next_message()` to receive
all renderer-to-agent messages, including agent-function calls, renderer
function responses, and errors. Replies to `callAgentFunction` messages can be
sent through `surface.send`.

The awaited methods require top-level `await` in an IPython kernel. Blocking
waits are not supported. The `ipykernel>=7.4.0` requirement is provisional;
kernel interrupts, notebook save/reopen behavior, and JupyterLab browser
compatibility are still being tested.

## Manual JupyterLab test

Build the bundle, install the Python workspace, and install JupyterLab into the
same environment:

```bash
corepack yarn workspace @a2ui/jupyter build
uv sync --all-packages
uv pip install jupyterlab
uv run --package a2ui-jupyter python -m ipykernel install --user \
  --name a2ui-jupyter --display-name "Python (A2UI)"
uv run --package a2ui-jupyter python -m jupyterlab
```

In JupyterLab, open [`examples/manual_smoke_test.ipynb`](./examples/manual_smoke_test.ipynb)
and select the `Python (A2UI)` kernel. Run the form cell. While it waits, enter
a name and click **Submit**. The cell returns an `action` message containing
the name and updates the form's status. Cells started while it waits are queued
until it finishes. Interrupt the kernel to cancel the wait.
After rebuilding the bundle, restart the notebook kernel and refresh JupyterLab
so the widget loads the new JavaScript.

### Saved widget output

JupyterLab saves a widget output as a model ID. If that model is no longer
available in the kernel and its state was not saved with the notebook, reopening
the notebook can report "widget model not found" before any cell runs. Clear
the affected cell's output, save the notebook, and rerun the form cell to create
a new widget.

To save widget state with future notebook saves, enable **Settings > Save Widget
State Automatically** in JupyterLab before saving. Saved widget state can restore
the display; it does not restore Python variables or a pending wait after a
kernel restart. The saved state includes surface messages and their data.
Rerun the form cell to interact with a new kernel.

## Tests

The Python tests include message validation and queue behavior. The TypeScript
tests cover the browser message bridge and rendering. Run them from the
repository root:

```bash
corepack yarn workspace @a2ui/jupyter test
uv run pytest python/a2ui_jupyter/tests
```
