# A2UI JupyterLab renderer

`a2ui-jupyter` displays A2UI v1.0 surfaces as notebook output and forwards
renderer messages to Python. It uses `anywidget` and the A2UI React renderer.
It requires Python 3.11 or newer and `ipykernel` 6.29 to 7.0, or 7.4 or newer
(see [Kernel compatibility](#kernel-compatibility)).

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
waits are not supported.

## Kernel compatibility

A cell that awaits `next_action` or `next_message` can only finish if the kernel
delivers frontend messages while that cell is still running. How this works
depends on the `ipykernel` version of the kernel that runs the notebook (not the
version in the environment that runs JupyterLab):

| `ipykernel`  | Status        | Notes                                                                                                                                                                                                                                                                                         |
| ------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.4 or newer | Supported     | The kernel delivers widget messages natively. Cells started while a cell waits run concurrently.                                                                                                                                                                                              |
| 6.29 to 7.0  | Supported     | `a2ui-jupyter` uses [`jupyter-ui-poll`](https://github.com/Kirill888/jupyter-ui-poll) to process widget messages while the cell waits. Cells started during the wait are queued and run after it finishes. The kernel status indicator can briefly show idle while the cell is still waiting. |
| 7.1 to 7.3   | Not supported | These versions cannot deliver widget messages to a waiting cell without leaving the cell marked as running. The package excludes them, and awaiting raises `RuntimeError` if one is installed anyway. Upgrade to 7.4 or newer.                                                                |

Installing this package does not upgrade a kernel that is already running.
Restart the kernel after changing `ipykernel`.

## After the user submits

The renderer does not hide or disable a surface after an action. As with the
other A2UI renderers, the code that receives the action decides what happens
next, by sending more messages to the surface. Common choices:

1. Replace the form with a confirmation by sending `updateComponents` with new
   children for the root component. The [example notebook](./examples/manual_smoke_test.ipynb)
   does this.
2. Keep the form and show the result by sending `updateDataModel`.
3. Remove the surface with `deleteSurface`.
4. Disable the button. Add a check to the Button, for example
   `"@checks": [{"condition": {"@call": "not", "args": {"value": {"@path": "/submitted"}}}, "message": "Already submitted"}]`,
   then set `/submitted` to `true` with `updateDataModel`. A Button whose check
   fails is disabled.

Clicks made before your update reaches the browser are queued. A later
`next_action()` returns those queued actions first, so check the action's
`name` and `context`, or ignore actions you no longer expect.

## Performance

Each `send` call sends one message to the views that are displayed. The full
message log, which lets views displayed later replay the surface, is synced at
most every 200 ms and whenever the surface is displayed. As a result,
`surface.message_log` can lag behind recent `send` calls by up to 200 ms while a
cell is running. The log keeps every message for the life of the surface, so
for long-running streams create a new surface instead of updating one surface
indefinitely.

Each widget loads a JavaScript bundle of about 900 KB. When widget state is
saved, the bundle and the message log of every surface are stored in the
notebook file.

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
the name and replaces the form with a confirmation. Interrupt the kernel to
cancel the wait.
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
