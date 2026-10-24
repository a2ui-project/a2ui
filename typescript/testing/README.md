# @a2ui/testing

A test harness for A2UI surfaces. A test addresses the surface only through the
identifiers in its A2UI JSON: component ids, property names, data model paths,
and action names. No renderer type, CSS selector, or DOM node appears in a
test, so the same test file can run against any platform that implements the
driver contract.

The harness knows nothing about any particular catalog beyond the basic one.
Catalog packages extend it with **plugins**. For surfaces that call MCP tools,
pair it with [`@a2ui/catalog-mcp/testing`](../catalogs/mcp/README.md#testing-a-surface).

The package is experimental and targets protocol v0.9 and v0.9.1.

## Install

The package is a Yarn workspace of this repository and is not yet published.
Add it as a `devDependency` with `"@a2ui/testing": "workspace:*"`.

## Write a test

Put a test next to the surface JSON it exercises:

```ts
import {describe, expect, it} from 'vitest';
import {createSurfaceHarness} from '@a2ui/testing';
import {stubMcp} from '@a2ui/catalog-mcp/testing';

import surface from './weather_surface.json';

describe('weather surface', () => {
  it('fetches a forecast and shows it in the card', async () => {
    const mcp = stubMcp({
      tools: {
        get_forecast: args => ({
          content: [{type: 'text', text: JSON.stringify({temp: '72°F', city: args.city})}],
        }),
      },
    });
    const h = await createSurfaceHarness({messages: surface, plugins: [mcp]});

    expect(h.prop('title', 'text')).toBe('Weather');

    await h.setValue('city_field', 'Seattle');
    await h.click('search_button');

    expect(mcp.calls).toEqual([{name: 'get_forecast', arguments: {city: 'Seattle'}}]);
    expect(h.data('/forecast/temp')).toBe('72°F');
    expect(h.prop('temp_text', 'text')).toBe('72°F');
    expect(h.errors).toEqual([]);

    h.dispose();
  });
});
```

The harness runs under any test runner. Its own tests use `node:test`.

## API

`createSurfaceHarness(options)` returns a `SurfaceHarness`:

| Member                             | Reads or does                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `data(path, surfaceId?)`           | Value at a JSON Pointer in the surface data model.                              |
| `setData(path, value, surfaceId?)` | Writes the data model directly. Seeds state; does not simulate input.           |
| `prop(id, name, options?)`         | One property of a component, with data bindings and function calls resolved.    |
| `props(id, options?)`              | All resolved properties of a component.                                         |
| `component(id, surfaceId?)`        | The component as declared, with raw properties.                                 |
| `exists(id, surfaceId?)`           | Whether the id is on the surface.                                               |
| `rendered(id, options?)`           | Whether the component is reachable from the surface root.                       |
| `children(id, options?)`           | Child references. Children of a `List` template carry the `scope` of each item. |
| `click(id, options?)`              | Runs the component's `action`, then waits for plugins and renders.              |
| `setValue(id, value, options?)`    | Enters a value into an input component whose `value` is bound to a data path.   |
| `process(messages)`                | Feeds further A2UI messages, as a streaming agent would.                        |
| `settle()`                         | Waits until pending plugin work and renders have completed.                     |
| `actions`                          | Every `event` action dispatched to the agent.                                   |
| `errors`                           | Every error any surface reported.                                               |
| `surfaces()`, `surface(id?)`       | Live surface ids, and the surface model for assertions the API does not cover.  |
| `dispose()`                        | Releases every surface, plugin, and driver resource.                            |

Options: `messages`, `plugins`, `functions` (extra catalog functions),
`catalogs` (catalogs to register as they are), `driver`, and `throwOnError`.

### Components inside a template

A `List` whose `children` is `{componentId, path}` instantiates the template
once per item. Address an instance by the data path of its item:

```ts
expect(h.children('entry_list')).toEqual([
  {id: 'entry_row', scope: '/entries/0'},
  {id: 'entry_row', scope: '/entries/1'},
]);
await h.click('entry_button', {scope: '/entries/1'});
expect(h.prop('entry_name', 'text', {scope: '/entries/1'})).toBe('docs');
```

### Errors

Every error a surface reports is recorded in `errors`. `click`, `setValue`, and
`process` throw a `SurfaceHarnessError` listing the new errors, so a broken
expression, an unbound path, or a failing function fails the test at the step
that caused it. Pass `throwOnError: false` to the harness or to one call to
record instead.

### Catalogs

Every `catalogId` the payload or a plugin names is served by a catalog holding
the basic components, the basic functions, the functions every plugin
contributes, and any `functions` passed in. Pass `catalogs` to register
catalogs as they are.

## Plugins

A `SurfaceHarnessPlugin` is how a catalog package ships its own test support:

| Member                 | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `catalogIds`           | Catalog ids to synthesize even when the payload does not name them.   |
| `functions(processor)` | Functions added to every synthesized catalog. May keep the processor. |
| `pending()`            | Whether asynchronous work is outstanding.                             |
| `settle()`             | Waits for outstanding work. The harness calls it until nothing pends. |
| `dispose()`            | Releases resources.                                                   |

`@a2ui/catalog-mcp/testing` exports `stubMcp`, a plugin that registers
`callMcpTool` against an in-memory MCP server and records every tool call.

## Drivers

A driver implements `SurfaceDriver`: `props`, `click`, `setValue`, `mount`,
`settle`, and `dispose`. The default `core` driver runs on `@a2ui/web_core`
state alone. It runs the same binder closures a renderer hands to its widgets,
so recorded actions, function calls, and data model writes match a rendered
surface, without a DOM.

A driver for a rendering framework mounts the surface in `mount`, maps a
`ComponentRef` to a rendered element in `click` and `setValue`, and waits for
the framework's render cycle in `settle`.
