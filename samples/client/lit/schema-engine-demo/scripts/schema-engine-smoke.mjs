/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Headless smoke test of the demo's catalogs, with each validator adapter:
 *
 * - both catalogs (zod 4 and plain JSON Schema) resolve the expected node
 *   tree, and a data model update changes it;
 * - a v1.0 message with a v0.9-style binding (`{path}` without `@`) is
 *   rejected with an error that names the field;
 * - the demo and `@a2ui/schema-zod4` resolve zod 4.
 *
 * Run `yarn build:tsc` first (`yarn smoke` does).
 */

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createAjvValidator} from '@a2ui/validator-ajv';
import {createCfWorkerValidator} from '@a2ui/validator-cfworker';
import {MessageProcessor} from '@a2ui/web_core';
import {A2uiValidationError} from '@a2ui/web_core/errors';
import {peekValue} from '@a2ui/web_core/reactivity';
import {NodeResolver, ResolvedBinding, isComponentNode} from '@a2ui/web_core/resolution';

import {
  createDemoCatalogs,
  invalidMessages,
  surfaceMessages,
  updateMessages,
} from '../dist/tsc/catalogs.js';

/** A resolved node as plain data: its type, its props' values, its children. */
function tree(node) {
  const props = {};
  let children;
  for (const [key, value] of Object.entries(peekValue(node.props))) {
    if (Array.isArray(value) && value.every(isComponentNode)) children = value.map(tree);
    else props[key] = value instanceof ResolvedBinding ? value.value : value;
  }
  return children ? {type: node.type, props, children} : {type: node.type, props};
}

const badge = (label, active, tone) => ({
  type: 'Badge',
  props: tone ? {label, active, tone} : {label, active},
});

function expected(title, status, ready) {
  return {
    type: 'Panel',
    props: {title},
    children: [
      badge(status, ready),
      badge('Ready to ship', ready),
      badge('Always on', true, 'accent'),
    ],
  };
}

const validators = {ajv: createAjvValidator, cfworker: createCfWorkerValidator};
let checks = 0;

for (const [engine, create] of Object.entries(validators)) {
  const validator = create();
  const catalogs = createDemoCatalogs(validator);
  const processor = new MessageProcessor([catalogs.zod, catalogs.json], undefined, {validator});

  for (const [name, catalog] of Object.entries(catalogs)) {
    const id = `${engine}-${name}`;
    const title = `${name} catalog`;
    processor.processMessages(surfaceMessages(id, catalog.id, title));
    const surface = processor.model.getSurface(id);
    const resolver = new NodeResolver(surface, catalog);

    assert.deepEqual(tree(peekValue(resolver.rootNode)), expected(title, 'Pending', false), id);
    console.log(`ok [${engine}] ${name} catalog renders Panel > 3 Badges (Pending, inactive)`);
    checks++;

    processor.processMessages(updateMessages(id));
    assert.deepEqual(tree(peekValue(resolver.rootNode)), expected(title, 'Shipped', true), id);
    console.log(`ok [${engine}] ${name} catalog: updateDataModel -> Shipped, active`);
    checks++;

    let error;
    try {
      processor.processMessages(invalidMessages(id));
    } catch (e) {
      error = e;
    }
    assert.ok(
      error instanceof A2uiValidationError,
      `${id}: expected A2uiValidationError, got ${error}`,
    );
    assert.match(error.message, /label/, `${id}: the error names the field`);
    console.log(
      `ok [${engine}] ${name} catalog rejects {path:'/x'}: ${error.message.split('\n')[0]}`,
    );
    checks++;

    resolver.dispose();
  }
  processor.dispose();
}

// The demo and @a2ui/schema-zod4 both resolve zod 4 (the workspace pins zod 3
// elsewhere; the root package.json `resolutions` give these two zod 4).
const here = dirname(fileURLToPath(import.meta.url));
const zodVersion = from => createRequire(`${from}/`)('zod/package.json').version;
const demoZod = zodVersion(here);
const zod4Pkg = dirname(fileURLToPath(import.meta.resolve('@a2ui/schema-zod4')));
const helperZod = zodVersion(zod4Pkg);
assert.match(demoZod, /^4\./, `the demo resolves zod ${demoZod}`);
assert.match(helperZod, /^4\./, `@a2ui/schema-zod4 resolves zod ${helperZod}`);
console.log(`ok zod: demo -> ${demoZod}, @a2ui/schema-zod4 -> ${helperZod}`);
checks++;

console.log(`\n${checks} checks passed`);
