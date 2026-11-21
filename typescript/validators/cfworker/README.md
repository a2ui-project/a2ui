# @a2ui/validator-cfworker

`@cfworker/json-schema` adapter implementing `JsonSchemaValidator` from `@a2ui/web_core/schema-engine`. Suited to edge runtimes without code generation.

```ts
import {createCfWorkerValidator} from '@a2ui/validator-cfworker';
const validator = createCfWorkerValidator(); // `format` is an annotation (except `uri`: non-empty, no whitespace); pass {formats: true} to assert it
```
