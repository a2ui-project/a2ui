# @a2ui/web_core

The `@a2ui/web_core` package provides state management, protocol parsing, and schema generation for the A2UI framework. It is framework-agnostic and provides the foundational engine for renderer packages such as Angular, React, and Lit.

## Features

- **Protocol Handling**: Implements A2UI specification message validation and state handling across all supported protocol versions.
- **State Management**: Reactive data and component models using `@preact/signals-core`.
- **DataContext**: Data binding, scoping, and function evaluation with dependency tracking.
- **Catalog System**: Component and function catalogs supporting runtime validation and schema generation.
- **Schema-Driven Types**: Generates the TypeScript types of the common types and the basic catalogs' component props directly from the specification JSON schemas.

## Architecture

Rendering is driven by a `SurfaceGroupModel` and its constituent `SurfaceModel` instances, with `DataModel` managing reactive state, `DataContext` providing expression evaluation, and `MessageProcessor` validating and applying incoming protocol messages.

### Message Validation

`MessageProcessor` validates protocol messages against the specification's own JSON Schemas with a `JsonSchemaValidator` the application supplies, such as `createAjvValidator()` from `@a2ui/validator-ajv`:

```ts
import {MessageProcessor} from '@a2ui/web_core';
import {createAjvValidator} from '@a2ui/validator-ajv';

const processor = new MessageProcessor(catalogs, undefined, {validator: createAjvValidator()});
```

### Outbound Agent Messages

Pass `outboundListener` with `unifiedOutbound: true` to route all renderer-to-agent wire messages (actions, processing errors, `callAgentFunction` requests, and `rendererFunctionResponse` replies) through a single callback:

```ts
import {MessageProcessor} from '@a2ui/web_core';

const processor = new MessageProcessor(catalogs, undefined, {
  validator,
  outboundListener: send,
  unifiedOutbound: true,
});
```

## Schemas and Generated Types

web_core validates against the specification's JSON documents themselves, with the application's `JsonSchemaValidator`; it depends on no schema library. Catalog entries are `CatalogSchema`s: synchronous Standard Schemas that implement Standard JSON Schema, such as `fromJsonSchema(json, validator)`. A zod 3 schema is not read; wrap it with `fromZod3()` from `@a2ui/schema-zod3`.

The TypeScript types of each version's common types (`src/v0_9/generated-common-types.ts`, `src/v1_0/generated-common-types.ts`) and of the basic catalogs' component props (`generated-types.ts`) are generated from the JSON documents in `specification/` and `catalogs/`:

```bash
yarn generate
```

The message types (`src/v0_9/message-types.ts`, `src/v1_0/message-types.ts`) are written by hand after the message documents.

### Child references

A component property is a single child reference or a child list when it references the common types' `ComponentId`, `Child` or `ChildList` with `$ref`.

## Catalog Serialization

A `Catalog` has three serialization entry points:

- `Catalog.fromJson(json, protocolVersion?, catalogId?)` loads a catalog document into the catalog's model. Each entry is a `JsonComponentApi` or `JsonFunctionApi` whose model is its JSON Schema definition as written (`jsonSchema`); its `schema` is compiled from the definition with the validator as the catalog loads. The catalog keeps the document-level fields (metadata, named `$defs`, other top-level keys). `protocolVersion`, when given, takes precedence over the version the document declares and selects the loading rules, while `toJson` still writes the document's own `protocolVersion`; without it the document's version applies, then `DEFAULT_PROTOCOL_VERSION`. `catalogId` replaces the document's own ID.
- `catalog.toJson()` assembles the unbundled catalog document from the model, computing the `anyComponent` and `anyFunction` unions. A catalog loaded with `fromJson` returns its document unchanged (minus any entries omitted from the document's `anyComponent.oneOf` or `anyFunction.oneOf` unions, which `fromJson` filters out on load). An entry defined in code is generated from its schema's JSON Schema (`~standard.jsonSchema`) in the layout of the catalog's protocol version. The result is computed once per catalog; each call returns a fresh copy.
- `catalog.validationSchema` is the self-contained schema used to validate payloads: common types and the catalog's own `$defs` are bundled into `$defs` and every `$ref` is local. It is computed once per catalog; each read returns a fresh copy.

```ts
import {Catalog} from '@a2ui/web_core';

const catalog = Catalog.fromJson(document, undefined, undefined, {validator});
const unchanged = catalog.toJson(); // deep-equals document
const schema = catalog.validationSchema; // bundled JSON Schema
```

The `Catalog` constructor takes a `CatalogOptions` object as its fifth argument, with the `themeSchema`, the document-level fields (`instructions`, `schemaUri`, `schemaId`, `title`, `description`, `declaredProtocolVersion`, `declaresCatalogId`, `declaresComponents`, `functionsLayout`, `unions`, `defs`, `extensionFields`) that `toJson` emits, and, for a catalog defined in code, `commonTypesUri` and `themeLocation`. `validator` is the validator the catalog's plain JSON Schemas (an `AgentFunction` built from a JSON Schema object, the `@index` arguments) compile with; without it, the validator of the catalog's `fromJsonSchema` entries, or of the `MessageProcessor` the catalog is registered with, is used. `catalog.withEntries(components, functions)` returns a catalog with the same fields and other entries, as catalog transformers need.

`catalog.derive(options)` returns a new catalog under its own id, built from entries of `catalog` and new ones. In `components` and `functions`, a name keeps the entry of that name and an object adds an entry. The new catalog does not keep the source's `$id`, title, description or instructions, since the instructions of the basic catalog, for example, name its id in their examples:

```ts
const chatCatalog = createBasicCatalog(validator).derive({
  catalogId: 'https://example.com/catalogs/chat.json',
  components: ['Text', 'Image', 'Row', 'Column', 'Button', carousel],
  functions: ['openUrl'],
  instructions,
});
```

### Built-in basic catalogs

The built-in basic catalogs are their published catalog documents, loaded with `Catalog.fromJson` the first time they are asked for with a validator; nothing is built when a module is imported. Each version exports a memoised factory, `createBasicCatalog(validator)`, which returns the same catalog for the same validator:

```ts
import {createAjvValidator} from '@a2ui/validator-ajv';
import {createBasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';

const validator = createAjvValidator();
const basicCatalog = createBasicCatalog(validator); // catalogs/basic/v1/catalog.json
```

`@a2ui/web_core/v0_9/basic_catalog` and `@a2ui/web_core/v0_8/basic_catalog` export the v0.9 and v0.8 factories. The v0.9 and v1 catalogs pair each component with its Web Component element and each function with its implementation; `toJson()` of each returns its published document. The props types of the components (`TextProps`, `ButtonProps`, ...) are generated from the same documents by `scripts/generate-basic-catalog-types.mjs` into `generated-types.ts`, which runs as part of `yarn generate`.

## Development

### Building

The package uses `wireit` for build orchestration:

```bash
yarn build
```

### Testing

Run unit tests:

```bash
yarn test
```

Run conformance test suite:

```bash
node tests/conformance/conformance_test.mjs
```

Run the timing cases of `conformance/core/message_processor_scaling.yaml`, which check that processing a surface sent in many small messages takes time in proportion to its size. Times depend on the machine and its load, so `yarn test` leaves these cases out:

```bash
yarn test:timing
```

### Formatting & Linting

```bash
yarn format
yarn lint
```
