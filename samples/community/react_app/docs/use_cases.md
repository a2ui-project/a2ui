# ReactApp use cases

Three use cases drive the prototype. Each one combines native A2UI components with one `ReactApp`, and each uses both the data model and functions over the [bridge](bridge_protocol.md). For each case this document traces one turn step by step: the user prompt, the relevant part of the system prompt, the model's Express output, the compiled A2UI messages, the transport frames, the bridge messages, the agent function round trip where there is one, what the user sees, and the latency checkpoints.

The traces describe the intended behavior of the prototype. Code and payloads are shortened where marked with `…`. The demo agent uses `gemini-3.5-flash`, the basic catalog and the ReactApp catalog, plus a demo catalog that declares the agent functions `estimateTravelTime` and `querySales`.

## Latency checkpoints

Every trace refers to the same checkpoints. The demo measures them and shows them in its Performance tab.

| Id | Checkpoint | Measured at |
| --- | --- | --- |
| T0 | Request sent | Client, when the user submits the prompt. |
| T1 | First token | Agent, first chunk from the model stream. |
| T2 | First A2UI message | Client, first SSE frame with an A2UI message. |
| T3 | Native components painted | Client, after the first `updateComponents` renders. |
| T4 | ReactApp source complete | Agent, when the Express stream closes the `r"""` string and the `ReactApp` component is emitted. |
| T5 | Iframe ready | Client, when the sandbox proxy reports ready to the `ReactApp` element. |
| T6 | Initialized | App frame, `reactApp/initialize` response received. |
| T7 | `ui/rendered` | Client, when the `ui/rendered` notification arrives. |
| T8 | Stream complete | Client, end of the SSE response. |

Native components render while the app's source is still streaming (T3 is before T4); the `ReactApp` shows a "writing app…" placeholder until its component arrives. The fixture test in `typescript/react_app/e2e` measures T5 to T7 for a hard-coded app.

## 1. Loan amortization explorer

The user explores how the interest rate and the annual payment change a 10-year loan. Native sliders drive a chart drawn by a ReactApp. Clicking a bar in the chart updates a native text. A native button sends the plan to the agent.

Uses: `useData` (read live, write the selected year), `setData`, local function `formatCurrency` through `callFunction`, `VegaChart` with `onSelect`, native `event` action.

### 1.1. User prompt

> I borrowed $250,000. Show me how the balance goes down over 10 years, and let me play with the interest rate and how much I pay per year. When I click a year, tell me what's left. Add a button to email me the plan.

### 1.2. System prompt excerpt

The system prompt is the Express prompt for the basic, ReactApp and demo catalogs, followed by `react_app_prompt()`:

```text
## ReactApp

Use `ReactApp` only for interactive UI the native components can't express …
Connect native components and the app through shared data model paths …

### Modules
The app is one TSX file that default-exports `App`. It can import only `react` and `a2ui`.

### The `a2ui` module
declare module 'a2ui' {
  export function useData<T extends JsonValue>(path: string, fallback: T): [T, (value: T | ((previous: T) => T)) => void];
  export function callFunction<R = JsonValue>(name: string, args?: {[key: string]: JsonValue}, …): Promise<R>;
  …
}

### Styling
Use the primitives (`Card`, `Stack`, `Text`, `Button`, `Slider`) or `var(--a2ui-*)` …

### Example
chart = ReactApp(title="Balance by year", height=340, source=r"""
import { useEffect, useMemo, useState } from "react";
…
""")
```

### 1.3. Model output (Express)

```text
Here is an interactive plan for your loan.
<a2ui>
surface("loan")
$/loan/principal = 250000
$/loan/rate = 5
$/loan/annualPayment = 30000
$/loan/selectedYear = 0
$/loan/selectedYearSummary = "Click a bar to see a year."
root = Column(children=[heading, principal_text, rate_slider, payment_slider, chart, summary_text, email_button])
heading = Text(text="## Your loan")
principal_text = Text(text=formatString("Principal: ${formatCurrency(value:${/loan/principal}, currency:'USD')}"))
rate_slider = Slider(label="Interest rate (%)", min=1, max=12, value=$/loan/rate)
payment_slider = Slider(label="Annual payment (USD)", min=10000, max=60000, value=$/loan/annualPayment)
chart = ReactApp(title="Balance by year", height=340, dataPaths=["/loan"], functions=["formatCurrency"], source=r"""
import { useEffect, useMemo, useState } from "react";
import { Card, Stack, Text, VegaChart, callFunction, setData, theme, useData } from "a2ui";

export default function App() {
  const [principal] = useData<number>("/loan/principal", 250000);
  const [rate] = useData<number>("/loan/rate", 5);
  const [payment] = useData<number>("/loan/annualPayment", 30000);
  const [selectedYear, setSelectedYear] = useData<number>("/loan/selectedYear", 0);
  …
  return (
    <Card title="Balance by year">
      <VegaChart spec={spec} data={{ table: rows }} height={240}
        onSelect={(datum) => datum && setSelectedYear(datum.year as number)} />
    </Card>
  );
}
""")
summary_text = Text(text=$/loan/selectedYearSummary)
email_label = Text(text="Email me this plan")
email_button = Button(child=email_label, variant="primary", action=Event("emailPlan", {rate: $/loan/rate, annualPayment: $/loan/annualPayment, selectedYear: $/loan/selectedYear}))
</a2ui>
```

The full app is in [`catalog/v1/examples/loan_explorer.json`](../catalog/v1/examples/loan_explorer.json).

### 1.4. Compiled A2UI messages

With two or more catalogs the Express compiler creates a surface without a default catalog and stamps every component with its catalog:

```json
{"version": "1.0", "createSurface": {"surfaceId": "loan"}}
{"version": "1.0", "updateDataModel": {"surfaceId": "loan", "value": {"loan": {"principal": 250000, "rate": 5, "annualPayment": 30000, "selectedYear": 0, "selectedYearSummary": "Click a bar to see a year."}}}}
{"version": "1.0", "updateComponents": {"surfaceId": "loan", "components": [
  {"id": "root", "component": "Column", "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json", "children": ["heading", "…"]},
  {"id": "rate_slider", "component": "Slider", "catalogId": "…/basic/catalog.json", "label": "Interest rate (%)", "min": 1, "max": 12, "value": {"@path": "/loan/rate"}},
  {"id": "chart", "component": "ReactApp", "catalogId": "https://a2ui.org/labs/react_app/v1/catalog.json", "title": "Balance by year", "height": 340, "dataPaths": ["/loan"], "functions": ["formatCurrency"], "source": "import { useEffect … }"},
  "…"
]}}
```

`ReactAppTransformer.transform_to_transport` checks the `ReactApp` component before it ships: `source` is a non-empty string with a default export, it imports only allowed modules, and `dataPaths` entries are JSON pointers. In Phase 4 it also compiles and type-checks the source and fills `compiled`.

### 1.5. Transport (SSE)

The demo agent streams one SSE event per A2UI message, plus timing events:

```text
event: timing
data: {"checkpoint": "T1", "ms": 412}

event: a2ui
data: {"version": "1.0", "createSurface": {"surfaceId": "loan"}}

event: a2ui
data: {"version": "1.0", "updateDataModel": {…}}

event: a2ui
data: {"version": "1.0", "updateComponents": {"surfaceId": "loan", "components": [root, heading, principal_text, rate_slider, payment_slider]}}

event: a2ui
data: {"version": "1.0", "updateComponents": {"surfaceId": "loan", "components": [chart]}}

event: a2ui
data: {"version": "1.0", "updateComponents": {"surfaceId": "loan", "components": [summary_text, email_label, email_button]}}

event: done
data: {"checkpoints": {…}}
```

The Express stream emits components progressively, so the sliders arrive before the long `source` string closes.

### 1.6. Bridge messages

After the `chart` component arrives, the `ReactApp` element loads the sandbox proxy, sends it the app document, and the runtime starts:

```text
app → host  {"jsonrpc":"2.0","id":1,"method":"reactApp/initialize","params":{"protocolVersion":"1","runtimeVersion":"0.1.0","paths":["/loan/principal","/loan/rate","/loan/annualPayment","/loan/selectedYear"]}}
host → app  {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"1","theme":{"colorScheme":"light","cssVars":{"--a2ui-color-primary":"#c8553d", …}},"containerSize":{"width":640,"height":340},"dataSnapshot":{"/loan/principal":250000,"/loan/rate":5,"/loan/annualPayment":30000,"/loan/selectedYear":0},"deniedPaths":[]}}
app → host  {"jsonrpc":"2.0","id":2,"method":"function/call","params":{"name":"formatCurrency","args":{"value":232500,"currency":"USD"}}}
…           (one call per year, ids 2–11)
host → app  {"jsonrpc":"2.0","id":2,"result":{"value":"$232,500.00"}}
app → host  {"jsonrpc":"2.0","method":"ui/rendered","params":{"timings":{"runtimeReady":38,"initialized":44,"compiled":51,"rendered":83,"transpileMs":4}}}
```

The user drags the rate slider from 5 to 7. The native slider writes `/loan/rate`; the host's subscription fires:

```text
host → app  {"jsonrpc":"2.0","method":"data/changed","params":{"path":"/loan/rate","value":6}}
host → app  {"jsonrpc":"2.0","method":"data/changed","params":{"path":"/loan/rate","value":7}}
app → host  function/call formatCurrency × 10 (new balances)
```

The user clicks the bar for year 4:

```text
app → host  {"jsonrpc":"2.0","id":31,"method":"data/set","params":{"path":"/loan/selectedYear","value":4,"seq":1}}
host → app  {"jsonrpc":"2.0","id":31,"result":{"seq":1,"value":4}}
app → host  {"jsonrpc":"2.0","id":32,"method":"data/set","params":{"path":"/loan/selectedYearSummary","value":"After year 4: $160,214.00 left to pay","seq":2}}
host → app  {"jsonrpc":"2.0","id":32,"result":{"seq":2,"value":"After year 4: $160,214.00 left to pay"}}
```

The host suppresses the echo of both writes, so the app gets no `data/changed` for them. The native `summary_text`, bound to `/loan/selectedYearSummary`, updates.

The user presses "Email me this plan". That's a native button: the renderer sends an `action` message to the agent with `{rate: 7, annualPayment: 30000, selectedYear: 4}`. No bridge traffic is involved.

### 1.7. What the user sees

1. T2–T3: the heading, principal and both sliders appear; below them, a "writing app…" placeholder with the shape of a chart.
2. T4–T7: the placeholder becomes the bar chart, with bars in the theme's secondary color.
3. Dragging a slider redraws the bars live (the chart updates its dataset in place).
4. Clicking a bar colors it with the primary color, and the text below the chart reads "After year 4: $160,214.00 left to pay".
5. The button sends the plan; the agent answers in the next turn.

### 1.8. Latency budget

T5 to T7 (iframe ready to rendered) SHOULD stay under 300 ms with a warm cache; the first load also fetches React and the runtime (about 200 KB gzipped). Vega loads on the first `VegaChart` render and is cached as immutable after that. The overall budget is T7 within 3 s of T8.

## 2. Drag-to-reorder trip itinerary

Drag and drop doesn't exist in the basic catalog, so a ReactApp renders the list of stops and lets the user reorder them. Each new order goes to an agent function that estimates the travel time. A native button books the trip in the chosen order.

Uses: `useData` (read and write `/trip/stops`), agent function `estimateTravelTime` through `useFunction` (async, remote, stale responses dropped), loading state, native `event` action.

### 2.1. User prompt

> I'm visiting the Louvre, Montmartre, the Eiffel Tower and Notre-Dame tomorrow. Let me drag them into the order I want and tell me how long the travel takes. Then let me book that order.

### 2.2. System prompt excerpt

Same as 1.2, plus the demo catalog's function signature, which the Express prompt lists under the demo catalog:

```text
estimateTravelTime(stops: list) -> number   # Agent function. Total travel minutes between the stops, in order.
```

### 2.3. Model output (Express)

```text
<a2ui>
surface("trip")
$/trip/stops = [{id: "louvre", name: "Louvre"}, {id: "montmartre", name: "Montmartre"}, {id: "eiffel", name: "Eiffel Tower"}, {id: "notre_dame", name: "Notre-Dame"}]
root = Column(children=[title, planner, book_button])
title = Text(text="## Your day in Paris")
planner = ReactApp(title="Reorder your stops", height=360, dataPaths=["/trip"], functions=["estimateTravelTime"], source=r"""
import { useState } from "react";
import { Card, Stack, Text, useData, useFunction } from "a2ui";

type Stop = { id: string; name: string };

export default function App() {
  const [stops, setStops] = useData<Stop[]>("/trip/stops", []);
  const [dragging, setDragging] = useState<number | null>(null);
  const { data: minutes, loading } = useFunction<number>("estimateTravelTime", { stops });

  function move(from: number, to: number) {
    const next = [...stops];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setStops(next);
  }

  return (
    <Card title="Drag to reorder">
      <Stack gap={1}>
        {stops.map((stop, index) => (
          <div key={stop.id} draggable className="a2ui-draggable"
            onDragStart={() => setDragging(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => { if (dragging !== null) move(dragging, index); setDragging(null); }}>
            <Text>{index + 1}. {stop.name}</Text>
          </div>
        ))}
        <Text variant="numeric" tone="muted">
          {loading ? "Estimating travel time…" : `Total travel: ${minutes} min`}
        </Text>
      </Stack>
    </Card>
  );
}
""")
book_label = Text(text="Book this order")
book_button = Button(child=book_label, variant="primary", action=Event("confirmItinerary", {stops: $/trip/stops}))
</a2ui>
```

### 2.4. Compiled A2UI messages

```json
{"version": "1.0", "createSurface": {"surfaceId": "trip"}}
{"version": "1.0", "updateDataModel": {"surfaceId": "trip", "value": {"trip": {"stops": [{"id": "louvre", "name": "Louvre"}, "…"]}}}}
{"version": "1.0", "updateComponents": {"surfaceId": "trip", "components": [
  {"id": "planner", "component": "ReactApp", "catalogId": "https://a2ui.org/labs/react_app/v1/catalog.json", "title": "Reorder your stops", "height": 360, "dataPaths": ["/trip"], "functions": ["estimateTravelTime"], "source": "import { useState } …"},
  {"id": "book_button", "component": "Button", "catalogId": "…/basic/catalog.json", "child": "book_label", "variant": "primary", "action": {"event": {"name": "confirmItinerary", "context": {"stops": {"@path": "/trip/stops"}}}}},
  "…"
]}}
```

### 2.5. Transport (SSE)

As in 1.5, one `a2ui` event per message. The agent function call travels on the same session: the renderer sends a `callAgentFunction` message to the agent's renderer-message endpoint (an HTTP POST in the demo), and the response arrives as an `agentFunctionResponse` message on the SSE stream:

```text
POST /renderer-message
{"version":"1.0","callAgentFunction":{"surfaceId":"trip","functionCallId":"fc-7","callFunction":{"@call":"estimateTravelTime","catalogId":"https://a2ui.org/labs/demo/v1/catalog.json","args":{"stops":[…]}}}}

event: a2ui
data: {"version":"1.0","agentFunctionResponse":{"functionCallId":"fc-7","value":74}}
```

The message shapes are defined by `specification/v1_0/json/renderer_to_agent.json` and `agent_to_renderer.json`.

### 2.6. Bridge messages

On first render, `useFunction` calls the agent function for the initial order:

```text
app → host  {"jsonrpc":"2.0","id":2,"method":"function/call","params":{"name":"estimateTravelTime","args":{"stops":[{"id":"louvre","name":"Louvre"},…]}}}
            (host: ReactApp catalog doesn't declare it → demo catalog declares it, schema-only → invoker routes to callAgentFunction)
host → app  {"jsonrpc":"2.0","id":2,"result":{"value":74}}
```

The user drags Notre-Dame to the top, then quickly drags the Eiffel Tower to second place:

```text
app → host  {"jsonrpc":"2.0","id":3,"method":"data/set","params":{"path":"/trip/stops","value":[notre_dame, louvre, montmartre, eiffel],"seq":1}}
app → host  {"jsonrpc":"2.0","id":4,"method":"function/call","params":{"name":"estimateTravelTime","args":{"stops":[notre_dame, louvre, montmartre, eiffel]}}}
host → app  {"jsonrpc":"2.0","id":3,"result":{"seq":1,"value":[…]}}
app → host  {"jsonrpc":"2.0","id":5,"method":"data/set","params":{"path":"/trip/stops","value":[notre_dame, eiffel, louvre, montmartre],"seq":2}}
app → host  {"jsonrpc":"2.0","id":6,"method":"function/call","params":{"name":"estimateTravelTime","args":{"stops":[notre_dame, eiffel, louvre, montmartre]}}}
host → app  {"jsonrpc":"2.0","id":5,"result":{"seq":2,"value":[…]}}
host → app  {"jsonrpc":"2.0","id":6,"result":{"value":58}}
host → app  {"jsonrpc":"2.0","id":4,"result":{"value":81}}      ← older call answers last
```

`useFunction` keeps only the answer to the latest call (id 6), so the late answer to id 4 is dropped and the total stays at 58 minutes.

### 2.7. Agent function round trip

1. The host invokes `estimateTravelTime` through `ComponentContextFrameHost.invokeFunction`. The demo catalog declares it without an implementation, so the catalog invoker validates the arguments against its schema and calls `surface.callAgentFunction`.
2. The message processor sends `callAgentFunction` through its outbound listener, which the demo client wires to `POST /renderer-message`.
3. The agent's `RendererToAgentMessageProcessor` finds the `AgentFunction` in its catalog and runs the handler (a mock that sums distances between the stops).
4. The agent answers with an `agentFunctionResponse`; the processor resolves the pending promise, and the host replies to the frame.

The web_core processor caches settled answers by arguments, so dragging back to an order seen before answers at once without a network round trip.

### 2.8. What the user sees

1. The title and the "Book this order" button render first; the planner placeholder follows.
2. The list of four stops appears with "Estimating travel time…" under it, then "Total travel: 74 min".
3. While the user drags, the list reorders at once and the total shows "Estimating travel time…" until the latest estimate arrives.
4. "Book this order" sends `confirmItinerary` with the current order from `/trip/stops`.

### 2.9. Latency checkpoints

Besides T0–T8, the demo records each `function/call` from request to response. The mock agent function answers in under 50 ms on the server, so the round trip is dominated by the HTTP request (typically 20–80 ms locally).

## 3. Sales explorer with brush selection

A scatter plot of sales lets the user drag a rectangle to select a region and a time range. The selection calls an agent function that queries the matching sales rows, which the app writes to the data model, where a native `List` with a template shows them.

Uses: `VegaChart` with a brush selection and `onSignal`, agent function `querySales` through `useFunction` (large result, stale responses dropped), `setData` of a large array, native `List` bound to the rows the app wrote.

### 3.1. User prompt

> Plot our 2025 sales by month and amount for each region. Let me drag over the chart to pick a region and a few months, and list the matching orders below.

### 3.2. System prompt excerpt

As in 1.2, plus:

```text
querySales(region: string, from: string, to: string) -> list   # Agent function. Orders in the region between two ISO dates.
```

### 3.3. Model output (Express)

```text
<a2ui>
surface("sales")
$/sales/points = […]            (monthly totals per region, 48 points)
$/sales/selection = {}
$/sales/rows = []
root = Column(children=[title, explorer, rows_heading, rows])
title = Text(text="## 2025 sales")
explorer = ReactApp(title="Sales by month", height=380, dataPaths=["/sales"], functions=["querySales"], source=r"""
import { useEffect, useState } from "react";
import { Card, Stack, Text, VegaChart, setData, useData, useFunction } from "a2ui";

type Point = { region: string; month: string; amount: number };
type Brush = { month?: [number, number]; region?: string[] };

export default function App() {
  const [points] = useData<Point[]>("/sales/points", []);
  const [brush, setBrush] = useState<Brush>({});
  const region = brush.region?.[0] ?? null;
  const range = brush.month ? brush.month.map((t) => new Date(t).toISOString().slice(0, 10)) : null;
  const args = region && range ? { region, from: range[0], to: range[1] } : null;
  const { data: rows, loading } = useFunction<object[]>("querySales", args);

  useEffect(() => {
    setData("/sales/selection", args ?? {});
    setData("/sales/rows", rows ?? []);
  }, [rows]);

  const spec = {
    data: { name: "points" },
    params: [{ name: "brush", select: { type: "interval", encodings: ["x"] } }],
    mark: "point",
    encoding: {
      x: { field: "month", type: "temporal", title: "Month" },
      y: { field: "amount", type: "quantitative", title: "Sales" },
      color: { field: "region", type: "nominal" },
    },
  };

  return (
    <Card title="Drag across months to select">
      <Stack gap={2}>
        <VegaChart spec={spec} data={{ points }} onSignal={{ brush: (value) => setBrush(value as Brush) }} />
        <Text variant="caption" tone="muted">{loading ? "Loading orders…" : `${rows?.length ?? 0} orders`}</Text>
      </Stack>
    </Card>
  );
}
""")
rows_heading = Text(text="### Matching orders")
rows = List(children=_template($/sales/rows, row))
row = Text(text=formatString("${customer}: ${amount}"))
</a2ui>
```

### 3.4. Compiled A2UI messages

As in 2.4: a defaultless surface, the data model with 48 points, the `ReactApp` stamped with the ReactApp catalog, and the `List` with a template `{"componentId": "row", "path": "/sales/rows"}`.

### 3.5. Transport (SSE)

As in 2.5. `querySales` responses can be large (hundreds of rows); the A2UI transport has no size limit, and host-to-app bridge messages have none either. The app's `data/set` of `/sales/rows` is limited to 64 KB by the bridge's payload limit, so the app writes at most the first 200 rows and the agent function returns at most 500.

### 3.6. Bridge messages

The user drags across March to May with the brush:

```text
(Vega signal "brush" fires on every mouse move)
app → host  {"jsonrpc":"2.0","id":7,"method":"function/call","params":{"name":"querySales","args":{"region":"EMEA","from":"2025-03-01","to":"2025-04-15"}}}
app → host  {"jsonrpc":"2.0","id":8,"method":"function/call","params":{"name":"querySales","args":{"region":"EMEA","from":"2025-03-01","to":"2025-05-31"}}}
host → app  {"jsonrpc":"2.0","id":8,"result":{"value":[…112 rows…]}}
host → app  {"jsonrpc":"2.0","id":7,"result":{"value":[…64 rows…]}}      ← stale, dropped by useFunction
app → host  {"jsonrpc":"2.0","id":9,"method":"data/set","params":{"path":"/sales/selection","value":{"region":"EMEA","from":"2025-03-01","to":"2025-05-31"},"seq":4}}
app → host  {"jsonrpc":"2.0","id":10,"method":"data/set","params":{"path":"/sales/rows","value":[…112 rows…],"seq":5}}
host → app  results for 9 and 10
```

Meanwhile the agent can push a new `updateDataModel` for `/sales/points` (for example when the user asks "add 2024"), and the host forwards it:

```text
host → app  {"jsonrpc":"2.0","method":"data/changed","params":{"path":"/sales/points","value":[…96 points…]}}
```

This trace checks two-way sync: the app writes `/sales/rows` (which the native `List` renders) while the agent writes `/sales/points` (which the app renders), with no echoes.

### 3.7. Agent function round trip

As in 2.7. Calls with identical arguments share one in-flight request in the message processor, so a brush that wiggles back and forth doesn't flood the agent.

### 3.8. What the user sees

1. The heading and the empty "Matching orders" list render first, then the scatter plot.
2. Dragging across the chart draws a gray rectangle; the caption reads "Loading orders…", then "112 orders".
3. The native list below fills with one line per order. It always matches the last selection, even when an earlier query answers late.

### 3.9. Latency checkpoints

As in 2.9. The Performance tab also shows the size of the largest bridge message, since this case pushes the most data through the bridge.
