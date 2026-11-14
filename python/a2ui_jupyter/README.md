# A2UI JupyterLab renderer

`a2ui-jupyter` displays A2UI v1.0 surfaces as notebook output and forwards
renderer messages to Python. It uses `anywidget` and the A2UI React renderer.
It requires Python 3.11 or newer.

## Install

```bash
pip install a2ui-jupyter
```

The package has no kernel dependency. Install it into the environment of the
Jupyter kernel that runs your notebook. The awaited methods need a kernel of a
suitable version (see [Kernel compatibility](#kernel-compatibility)). In
JupyterLite, see [JupyterLite](#jupyterlite).

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
depends on the version of the IPython kernel that runs the notebook (not the
version in the environment that runs JupyterLab):

| IPython kernel version | Status        | Notes                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.4 or newer           | Supported     | The kernel delivers widget messages natively. Cells started while a cell waits run concurrently.                                                                                                                                                                                              |
| 6.9.2 to 7.0           | Supported     | `a2ui-jupyter` uses [`jupyter-ui-poll`](https://github.com/Kirill888/jupyter-ui-poll) to process widget messages while the cell waits. Cells started during the wait are queued and run after it finishes. The kernel status indicator can briefly show idle while the cell is still waiting. |
| 7.1 to 7.3             | Not supported | These versions cannot deliver widget messages to a waiting cell without leaving the cell marked as running. The package excludes them, and awaiting raises `RuntimeError` if one is installed anyway. Upgrade to 7.4 or newer.                                                                |

The 6.9.2 minimum applies on Python 3.11. On Python 3.12 and newer the
minimum is 6.29.0, because 6.9.2 imports `imp`, which Python 3.12 removed. The
6.9.2 row was tested on Python 3.11 with jupyter-client 7.x. The browser UI was not
tested with 6.9.2.

The table applies only to IPython kernels. Other kernels, such as JupyterLite's
xeus-python kernel, are not covered by the table. There, `A2UISurface` imports and
displays surfaces, but the awaited methods (`next_action`, `next_message`) were
not tested.

Installing this package does not upgrade a kernel that is already running.
Restart the kernel after changing the kernel version.

## JupyterLite

[JupyterLite](https://jupyterlite.readthedocs.io/) runs the xeus-python kernel
in the browser. Install `a2ui-jupyter` the same way as in other environments. Two
dependencies have compiled parts, so they cannot be installed from PyPI in the
browser. Install them from emscripten-forge first:

```python
%conda install regex
%pip install --local rpds-py
```

Then install the packages from the JupyterLite site's bundled wheels:

```python
%pip install --local a2ui-core
%pip install --local a2ui-jupyter
```

`--local` installs the wheels that the site bundles. Then run:

```python
from IPython.display import display

from a2ui_jupyter import A2UISurface

surface = A2UISurface()
display(surface)
```

This sequence was verified in a JupyterLite build that bundles the `a2ui-core`
and `a2ui-jupyter` wheels. The notebook imports and displays a surface there.

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
uv run --package a2ui-jupyter python -m jupyterlab
```

JupyterLab needs a Python kernel to run notebooks. Install one into the same
environment. `a2ui-jupyter` does not depend on a specific kernel package.

In JupyterLab, open [`examples/manual_smoke_test.ipynb`](./examples/manual_smoke_test.ipynb)
and select a Python kernel. Run the form cell. While it waits, enter
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
