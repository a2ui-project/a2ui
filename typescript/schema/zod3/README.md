# @a2ui/schema-zod3

zod 3 adapter for `@a2ui/web_core` catalogs. web_core reads a schema's JSON Schema through
Standard JSON Schema, which zod 3 does not implement; `fromZod3(schema)` adds it with
`zod-to-json-schema`, and validates with zod's own `~standard.validate` (zod 3.24 or later).

```ts
import {Catalog} from '@a2ui/web_core/catalog';
import {component, fromZod3, DynamicString, ChildList} from '@a2ui/schema-zod3'; // v1.0
// import {component, DynamicString} from '@a2ui/schema-zod3/v0_9'; // v0.9 ({path}, {call})
import {z} from 'zod';

const Card = {
  name: 'Card',
  schema: component({title: DynamicString, children: ChildList.optional()}),
};
const Legacy = {name: 'Legacy', schema: fromZod3(z.object({text: z.string()}))};
const catalog = new Catalog('https://example.com/catalog.json', '1.0', [Card, Legacy]);
```

- The common types (`DynamicString`, `Child`, `ChildList`, `Action`, ...) are zod 3 schemas
  that `a2uiJsonSchema(schema)` writes as `{$ref: 'common_types.json#/$defs/<Name>'}`, with
  the `description` a use adds, so web_core finds bindings and child references.
- JSON Schema targets: `draft-2020-12` (zod-to-json-schema's 2019-09 output), `draft-07`,
  `openapi-3.0`.
- The root and `./v1_0` export the v1.0 types; `./v0_9` the v0.9 ones. The root also exports
  both as the `v0_9` and `v1_0` namespaces.
