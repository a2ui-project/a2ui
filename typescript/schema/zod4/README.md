# @a2ui/schema-zod4

zod 4 helpers for writing `@a2ui/web_core` catalog schemas. The A2UI common types
(`DynamicString`, `Child`, `ChildList`, `Action`, ...) are zod 4 schemas that convert to
`$ref`s into the protocol's `common_types.json`, which is how web_core finds a component's
bindings and child references.

```ts
import {Catalog} from '@a2ui/web_core/catalog';
import {component, DynamicString, ChildList, Action} from '@a2ui/schema-zod4'; // v1.0
// import {component, DynamicString} from '@a2ui/schema-zod4/v0_9'; // v0.9 ({path}, {call})
import {z} from 'zod';

const Card = {
  name: 'Card',
  schema: component({
    title: DynamicString.describe('The card title'),
    children: ChildList.optional(),
    onOpen: Action.optional(),
    size: z.enum(['s', 'l']).default('s'),
  }),
};
const catalog = new Catalog('https://example.com/catalog.json', '1.0', [Card]);
```

- `component(shape)` is `z.object(shape)` as a `CatalogSchema`; `catalogSchema(schema)` wraps
  any zod schema. Both validate with zod and convert with `a2uiJsonSchema(schema)`, which is
  `z.toJSONSchema` with an `override` that writes each common type as
  `{$ref: 'common_types.json#/$defs/<Name>'}` (keeping a `description` and other annotations the
  use adds).
- Pass zod schemas through these helpers: a plain zod schema given to a catalog converts with
  zod's own JSON Schema, which inlines the common types.
- The root and `./v1_0` export the v1.0 types (`{'@path'}`, `{'@call'}`); `./v0_9` the v0.9
  ones (`{path}`, `{call}`; `Child` is a `ComponentId`). The root also exports both as the
  `v0_9` and `v1_0` namespaces.
- Requires zod 4.3.6 or later.
