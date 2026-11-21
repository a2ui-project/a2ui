# @a2ui/validator-ajv

Ajv (2020-12) adapter implementing `JsonSchemaValidator` from `@a2ui/web_core/schema-engine`.

```ts
import {createAjvValidator} from '@a2ui/validator-ajv';
const validator = createAjvValidator(); // `format` is an annotation (except `uri`: non-empty, no whitespace); pass {formats: true} to assert it with ajv-formats
```

Ajv compiles each schema to JavaScript with `new Function`, so under a Content Security Policy it needs `'unsafe-eval'` in `script-src`. Apps with a strict CSP, and edge runtimes that forbid code generation, should use [`@a2ui/validator-cfworker`](../cfworker), which interprets schemas instead.
