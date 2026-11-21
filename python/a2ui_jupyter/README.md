# A2UI Jupyter renderer

`a2ui-jupyter` displays A2UI v1.0 surfaces as notebook output in JupyterLab
and JupyterLite, and forwards renderer messages to the kernel. It uses
`anywidget` and the A2UI React renderer. The Python package requires Python
3.11 or newer.

## Installation

The package has not been published yet. After publication, install it with:

```bash
pip install a2ui-jupyter
```

The package has no kernel dependency. Install it into the environment of the
Jupyter kernel that runs your notebook. The awaited methods need a kernel of a
suitable version (see [Kernel support](#kernel-support)). In
JupyterLite, see [JupyterLite](#jupyterlite).

## Build

The Python package includes a JavaScript bundle built from the repository's
TypeScript workspace. From the repository root, run:

```bash
corepack yarn workspace @a2ui/jupyter build
```

Then install the Python package in the same environment as the Jupyter kernel.
For a source checkout, run `uv sync --all-packages` from the repository root.
Build the bundle before building a source distribution or wheel: the generated
files are not checked into Git, and the distribution build fails if they are
missing.

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
                "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
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

The awaited methods require top-level `await` in a supported IPython kernel.
They do not work in JupyterLite; use `on_action` or `on_message` callbacks
there. See [Why a form does not block the notebook](#why-a-form-does-not-block-the-notebook).

## Why a form does not block the notebook

A2UI surfaces in Jupyter are not modal dialogs. Displaying a form does not stop
you from running other cells until the form is submitted, and there is no
call that waits synchronously for the user. A cancel button has no special
meaning either: it sends an ordinary action, like any other button.

The reason is how the click reaches Python. The browser sends each click as a
widget (comm) message to the kernel, and the kernel that runs your cells is
the same kernel that must handle that message. So a cell can wait for a click
only if the kernel handles widget messages while the cell is still running:

1. A synchronous wait, such as a loop that sleeps until a value is set, never
   ends in any kernel. The loop holds the kernel's only Python thread, so the
   message with the click is never handled. `A2UISurface` therefore has no
   blocking wait method.
2. In JupyterLab with ipykernel 7.4 or newer, `await surface.next_action()`
   works because the kernel handles widget messages while the cell awaits.
   The same mechanism lets you run other cells during the wait, so the form
   does not block them.
3. In JupyterLab with ipykernel 6.9.2 to 7.0, the kernel handles requests one
   at a time. `a2ui-jupyter` uses `jupyter-ui-poll` to handle widget messages
   during the wait and defers other cells until the wait ends. This is the
   only setup where the notebook waits for the form, and it comes from the
   polling workaround, not from a design choice.
4. In JupyterLite, the browser-side kernel manager passes every message for a
   kernel, cell executions and widget messages alike, through one lock. The
   widget message with the click waits for the running cell to finish, and the
   cell waits for the click, so the cell would stay busy forever. This applies
   to every JupyterLite kernel, including Pyodide and xeus-python, and no
   Python code in the kernel can change it. `next_action()` and
   `next_message()` therefore raise `RuntimeError` in JupyterLite instead of
   hanging.

To write a notebook that works in every kernel, register a callback with
`on_action` or `on_message` and let the cell finish. The callback runs when the
user acts, and it decides what happens to the form. See
[After the user submits](#after-the-user-submits) and the
[examples](./examples).

## Examples

The [examples](./examples) folder contains Python notebooks for JupyterLab and
JupyterLite. Keep these examples with the renderer so that changes to its API
can be tested alongside them. The separate
[JupyterLite demo](https://github.com/MRYingLEE/a2ui-jupyterlite-demo.git)
contains deployment configuration and kernel-specific smoke tests.
Each notebook starts with the same setup cell (`renderer-init`). It sets
`KERNEL` to `cpython`, `pyodide`, or `xpython` and defines `new_surface`, which
creates a surface that uses the basic catalog. Copy the cell unchanged when you
add a notebook. The package must already be installed in the selected Python
kernel, or the Pyodide setup cell installs it.

- `01_text_and_layout.ipynb`: text, rows, columns, cards, and dividers.
- `02_button_action.ipynb`: a button that sends an action to a callback.
- `03_login_form.ipynb`: text fields with `checks` validation and a login action.
- `04_streaming_updates.ipynb`: appending to a data model and editing components in place.
- `05_event_handlers.ipynb`: `on_action` and `on_message` handlers and unsubscribing.
- `06_agent_function_call.ipynb`: a button that calls an agent function and replies with `agentFunctionResponse`.

The interactive examples use callbacks rather than waiting for clicks in a
running cell. The same notebook can therefore be selected with an IPython,
Pyodide, or xeus-python kernel; kernel installation differs.

## Kernel support

### IPython kernel compatibility

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

The table applies only to IPython kernels. JupyterLite kernels, including
Pyodide and xeus-python, cannot deliver renderer messages to a waiting cell
(see [Why a form does not block the notebook](#why-a-form-does-not-block-the-notebook)),
so `next_action` and `next_message` raise `RuntimeError` there. Use callbacks
instead, as the examples do. Run the demo smoke test to verify interaction in
your own JupyterLite build.

Installing this package does not upgrade a kernel that is already running.
Restart the kernel after changing the kernel version.

## JupyterLite

[JupyterLite](https://jupyterlite.readthedocs.io/) can run different kernels.
The steps below apply to a site using xeus-python. Install `a2ui-jupyter` the
same way as in other environments. Two dependencies have compiled parts, so
they cannot be installed from PyPI in the browser. Install them from
emscripten-forge first:

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

In the Jupyter renderer, a surface is hidden after an action whose name
contains `submit`, preventing repeat submissions while the action is handled.
The surface becomes visible again when the agent sends `updateComponents` or
`createSurface` for it. Other actions do not hide the surface. The code that
receives an action still decides what happens next by sending more messages.
Common choices:

1. Replace the form with a confirmation by sending `updateComponents` with new
   children for the root component. The [example notebook](./examples/smoke_test.ipynb)
   does this.
2. Keep the form and show the result by sending `updateDataModel` followed by
   `updateComponents` to make the surface visible again.
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

## Manual test

To test the Python package in JupyterLab, build the bundle, install the Python
workspace, and install JupyterLab into the same environment:

```bash
corepack yarn workspace @a2ui/jupyter build
uv sync --all-packages
uv pip install jupyterlab
uv run --package a2ui-jupyter python -m jupyterlab
```

JupyterLab needs a Python kernel to run notebooks. Install one into the same
environment. `a2ui-jupyter` does not depend on a specific kernel package.

In JupyterLab, open [`examples/smoke_test.ipynb`](./examples/smoke_test.ipynb)
and select a Python kernel. Run the setup cell and the surface cell, enter a name, and click
**Submit**. The callback replaces the form with a confirmation. The next cell
shows the `action` message containing the name.
After rebuilding the bundle, restart the notebook kernel and refresh JupyterLab
so the widget loads the new JavaScript.

## Saved widget output

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
