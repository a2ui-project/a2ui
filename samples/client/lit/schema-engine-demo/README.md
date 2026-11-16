# A2UI schema engine demo

Two A2UI v1.0 surfaces rendered side by side by `@a2ui/lit`, validated with
`createAjvValidator()` from `@a2ui/validator-ajv`:

- **Left:** a catalog written with zod 4 and `@a2ui/schema-zod4` (`component`,
  `DynamicString`, `DynamicBoolean`, `ChildList`).
- **Right:** the same components as plain JSON Schema, compiled with
  `fromJsonSchema(schema, validator, {version: '1.0'})`. No schema library.

Both catalogs have a `Panel` (a `title` over `children`) and a `Badge` (a
`label`, an `active` flag and a `tone`). The badges are bound to the data
model, so **Update data model** changes both surfaces. **Send an invalid
message** sends a v1.0 binding spelled the v0.9 way (`{path: '/x'}`), which
the processor rejects.

The catalogs live in `src/catalogs.ts`, which has no DOM dependency; the Lit
elements in `src/elements.ts` are paired with them at startup.

## Run it

```sh
yarn install                                   # at the repository root
cd samples/client/lit/schema-engine-demo
yarn dev                                       # builds the dependencies, then serves the app
```

## Smoke test

```sh
yarn smoke   # or: yarn test (smoke test, then the production build)
```

`scripts/schema-engine-smoke.mjs` runs the same catalogs headless with both
`@a2ui/validator-ajv` and `@a2ui/validator-cfworker`: it checks the resolved
node tree of each surface before and after a data model update, that the
invalid message is rejected with an error naming `label`, and that the demo
and `@a2ui/schema-zod4` resolve zod 4. The root `package.json` resolves zod 4
for this package (`@a2ui/schema-engine-demo/zod`); the rest of the workspace
uses zod 3.
