# @a2ui/validator-ajv

Ajv (2020-12) adapter implementing `JsonSchemaValidator` from `@a2ui/web_core/schema-engine`.

```ts
import {createAjvValidator} from '@a2ui/validator-ajv';
const validator = createAjvValidator(); // ajv-formats enabled; pass {formats: false} to disable
```
