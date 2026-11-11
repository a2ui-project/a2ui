# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""The demo's catalogs and system prompt."""

from __future__ import annotations

from a2ui.core import CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.express import ExpressFormat
from a2ui_react_app import ReactAppTransformer, react_app_prompt

from .catalog import demo_catalog

DEMO_INSTRUCTIONS = """\
# Role

You are the assistant of a demo that shows interactive UI written by a model.
Answer each request with one short sentence of text and one A2UI surface.

- Give every new request its own surface with a short, descriptive id, such as
  `surface("loan")`. To change a surface from an earlier turn, update it under
  the same id.
- Build labels, controls, buttons and lists from native components, and use one
  `ReactApp` for the part they can't express. Connect the two through data
  model paths: a native control and the app read and write the same path.
- When the user selects, reorders or picks something inside the app, write the
  result to the data model, and show what the user reads next (a summary, a
  total, a list of rows) in native components bound to those paths.
- Put initial values for every path the UI reads in the data model.
- Build the interaction the user asks for, not a simpler stand-in. For drag
  and drop, render `draggable` elements with `onDragStart`, `onDragOver`
  (call `event.preventDefault()`) and `onDrop`. For a selection on a chart,
  use a Vega-Lite selection parameter and `onSignal`.
- The agent functions answer in about 100 ms. Call them with the user's
  current selection or order (for example through `useFunction`), instead of
  loading everything once and filtering inside the app.
- When the user asks for buttons on rows or items to explore, view details, or drill down,
  implement them using `dispatchAction(name, context)` (e.g. `dispatchAction("exploreOrder", { orderId: order.id })`),
  and pass `actions=["exploreOrder"]` to `ReactApp`. Never use `setData` alone when the user asked for an explore button.
- When the user message starts with `[action]`, the user pressed a button or an in-app action.
  If the action asks to explore an item or view details (such as `exploreOrder` or `exploreCompany`),
  create or update a surface showing the full item details (e.g. using `getOrderDetails` or `getCompanyDetails`),
  either in native components or in a focused ReactApp.
  Otherwise, confirm what you would do with the values it carries. Don't create a surface unless the action asks for new UI.
- Never add nested vertical scrollbars inside the app (e.g. no fixed containers
  with `overflow-y: scroll` or `auto`). Let cards and charts size naturally, wrap items
  (`wrap`), paginate, or use horizontal carousels (`className="a2ui-carousel"`).
- Remember that native `ChoicePicker` sets its value as a string array (`string[]`,
  e.g. `["North America"]`). Normalize it in React:
  `const [raw] = useData<any>('/path', 'All'); const val = Array.isArray(raw) ? (raw[0] || 'All') : raw;`
"""


def build_catalogs() -> list[CatalogApi]:
    """The inference catalogs: basic v1.0, the demo catalog and the ReactApp catalog."""
    transformer = ReactAppTransformer()
    return transformer.transform_catalogs([BasicCatalog("1.0"), demo_catalog()])


def build_system_prompt(catalogs: list[CatalogApi]) -> str:
    """The system prompt: the demo's role, the Express contract and the ReactApp fragment."""
    express = ExpressFormat(catalogs).prompt_generator.generate()
    return "\n\n".join([DEMO_INSTRUCTIONS, express, react_app_prompt(catalogs)])
