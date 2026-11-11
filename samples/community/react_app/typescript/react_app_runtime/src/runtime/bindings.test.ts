/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, expect, it} from 'vitest';

import {bindingNames, bindingsModuleSource, isBindingName, linkBindings} from './bindings.js';
import {findUnavailableImports} from './source_scan.js';
import {transpileApp} from './transpile.js';

const BLOB = 'blob:bindings-1';

function link(code: string): {linked: string; made: string[]} {
  const made: string[] = [];
  const linked = linkBindings(code, source => {
    made.push(source);
    return BLOB;
  });
  return {linked, made};
}

describe('bindingNames', () => {
  it('finds named imports, aliases and namespace members', () => {
    const code = [
      'import { estimateTravelTime, formatCurrency as money } from "a2ui:bindings";',
      "import * as fns from 'a2ui:bindings';",
      'fns.querySales({region: "EMEA"}); fns.querySales({});',
    ].join('\n');

    expect(bindingNames(code)).toEqual(['estimateTravelTime', 'formatCurrency', 'querySales']);
  });

  it('finds the named part of a default plus named import, and members of the default', () => {
    const code = 'import fns, { formatCurrency } from "a2ui:bindings";\nfns.querySales({});';

    expect(bindingNames(code)).toEqual(['formatCurrency', 'querySales']);
  });

  it('finds members of namespaces whose names start with $', () => {
    const code = 'import * as $f from "a2ui:bindings";\n$f.go({}); $f?.stop({});';

    expect(bindingNames(code)).toEqual(['go', 'stop']);
  });

  it('treats {default as d} as the default import', () => {
    const code = 'import { default as d } from "a2ui:bindings";\nd.go({});';

    expect(bindingNames(code)).toEqual(['go']);
  });

  it('finds re-exported names', () => {
    expect(bindingNames('export { go, stop as halt } from "a2ui:bindings";')).toEqual([
      'go',
      'stop',
    ]);
  });

  it('leaves out reserved words and names that are not ASCII identifiers', () => {
    const code =
      'import { delete as del, package as pkg, eval as ev, café, go } from "a2ui:bindings";';

    expect(bindingNames(code)).toEqual(['go']);
  });

  it('ignores members of objects that do not come from the module', () => {
    const code = 'import { go } from "a2ui:bindings";\nconst fns = {}; fns.other();';

    expect(bindingNames(code)).toEqual(['go']);
  });
});

describe('isBindingName', () => {
  it('accepts ASCII identifiers and rejects reserved and strict-mode words', () => {
    expect(['go', '$f', '_x1'].map(isBindingName)).toEqual([true, true, true]);
    expect(
      ['default', 'delete', 'eval', 'arguments', 'package', 'interface', 'implements', 'await'].map(
        isBindingName,
      ),
    ).toEqual(Array(8).fill(false));
    expect(['café', '1go', 'go\n', 'a-b', ''].map(isBindingName)).toEqual(Array(5).fill(false));
  });
});

describe('bindingsModuleSource', () => {
  it('builds named and default exports of callFunction wrappers', () => {
    expect(bindingsModuleSource(['estimateTravelTime', 'go'])).toBe(
      [
        'import {callFunction} from "a2ui";',
        'const bind = name => (args, options) => callFunction(name, args ?? {}, options);',
        'export const estimateTravelTime = bind("estimateTravelTime");',
        'export const go = bind("go");',
        'export default {estimateTravelTime, go};',
      ].join('\n'),
    );
  });

  it('never exports a name that would make the module fail to load', () => {
    const source = bindingsModuleSource(['default', 'go\n', 'go']);

    expect(source).not.toContain('export const default');
    expect(source).toContain('export default {go};');
  });

  it('builds a module that loads and calls callFunction', async () => {
    const stub = 'export const callFunction = (name, args, options) => ({name, args, options});';
    const source = bindingsModuleSource(['go']).replace(
      '"a2ui"',
      JSON.stringify(`data:text/javascript,${encodeURIComponent(stub)}`),
    );

    const module = (await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`
    )) as {go: (args?: unknown) => unknown; default: {go: unknown}};

    expect(module.go({to: 'x'})).toEqual({name: 'go', args: {to: 'x'}, options: undefined});
    expect(module.go()).toEqual({name: 'go', args: {}, options: undefined});
    expect(module.default.go).toBe(module.go);
  });
});

describe('linkBindings', () => {
  it('rewrites the imports of transpiled code to the made module', () => {
    const code = transpileApp(
      'import { estimateTravelTime } from "a2ui:bindings";\nexport default function App() { estimateTravelTime({stops: []}); return null; }\n',
    );

    const {linked, made} = link(code);

    expect(linked).toContain(`from "${BLOB}"`);
    expect(linked).not.toContain('a2ui:bindings');
    expect(made).toEqual([bindingsModuleSource(['estimateTravelTime'])]);
  });

  it('rewrites only import and export specifiers, not other strings', () => {
    const code = [
      'import { go } from "a2ui:bindings";',
      'export { stop } from "a2ui:bindings";',
      'const label = "a2ui:bindings";',
      "const other = 'a2ui:bindings';",
    ].join('\n');

    const {linked} = link(code);

    expect(linked).toBe(
      [
        `import { go } from "${BLOB}";`,
        `export { stop } from "${BLOB}";`,
        'const label = "a2ui:bindings";',
        "const other = 'a2ui:bindings';",
      ].join('\n'),
    );
  });

  it('leaves code that does not import the module alone', () => {
    const {linked, made} = link('const label = "a2ui:bindings";\nexport default 1;');

    expect(linked).toBe('const label = "a2ui:bindings";\nexport default 1;');
    expect(made).toEqual([]);
  });
});

describe('source scan', () => {
  it('treats a2ui:bindings as an available module', () => {
    expect(findUnavailableImports('import { x } from "a2ui:bindings";')).toEqual([]);
  });
});
