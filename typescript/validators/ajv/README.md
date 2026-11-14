# @a2ui/validator-ajv

Ajv (2020-12) adapter implementing `JsonSchemaValidator` from `@a2ui/web_core/schema-engine`.

```ts
import {createAjvValidator} from '@a2ui/validator-ajv';
const validator = createAjvValidator(); // `format` is an annotation; pass {formats: true} to assert it with ajv-formats
```
