/*
 * Copyright 2024 Google LLC
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

import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

import {beforeAll, describe, expect, it} from 'vitest';

import {createReactAppCompiler, type ReactAppCompiler} from './compiler.js';

const thisFile = fileURLToPath(import.meta.url);
const packageDir = join(dirname(thisFile), '..');
const loanExample = JSON.parse(
  readFileSync(
    join(packageDir, '..', '..', 'catalog', 'v1', 'examples', 'loan_explorer.json'),
    'utf8',
  ),
) as {messages: Array<{updateComponents?: {components: Array<Record<string, unknown>>}}>};
const loanSource = loanExample.messages
  .flatMap(message => message.updateComponents?.components ?? [])
  .find(component => component['component'] === 'ReactApp')!['source'] as string;

const BINDINGS = `declare module 'a2ui:bindings' {
  import type {CallFunctionOptions, JsonValue} from 'a2ui';
  /** Total travel minutes. */
  export function estimateTravelTime(args: {stops: JsonValue[]}, options?: CallFunctionOptions): Promise<number>;
}
`;

describe('createReactAppCompiler', () => {
  let compiler: ReactAppCompiler;

  beforeAll(() => {
    compiler = createReactAppCompiler();
  });

  it('compiles the loan example to an ES module with no diagnostics', () => {
    const result = compiler.compile(loanSource);

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.compiled).toContain('from "react/jsx-runtime"');
    expect(result.compiled).toContain('from "a2ui"');
  });

  it('reports type errors with positions and still returns the transpiled code', () => {
    const result = compiler.compile(
      'import { useData } from "a2ui";\nexport default function App() {\n  const [n] = useData<number>("/n", "zero");\n  return <p>{n}</p>;\n}\n',
    );

    expect(result.ok).toBe(false);
    expect(result.compiled).not.toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({phase: 'type', line: 3, code: 2345}),
    ]);
  });

  it('reports syntax errors as transpile diagnostics without type-checking', () => {
    const result = compiler.compile('export default function App() {\n  const x = ;\n}\n');

    expect(result.ok).toBe(false);
    expect(result.compiled).toBeNull();
    expect(result.diagnostics).toEqual([expect.objectContaining({phase: 'transpile', line: 2})]);
  });

  it('allows implicit any and NodeJS timer types', () => {
    const result = compiler.compile(
      'import { useEffect } from "react";\nconst label = (d) => String(d);\nexport default function App() {\n  useEffect(() => { const t: NodeJS.Timeout = setInterval(() => {}, 100); return () => clearInterval(t); }, []);\n  return <p>{label(1)}</p>;\n}\n',
    );

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts interfaces as data model types and rejects Dates and functions', () => {
    const good = compiler.compile(
      'import { setData, useData } from "a2ui";\ninterface Product { id: string; price: number }\nexport default function App() {\n  const [items, setItems] = useData<Product[]>("/products", []);\n  setData<Product>("/selected", items[0]);\n  return <p onClick={() => setItems([])}>{items.length}</p>;\n}\n',
    );
    const bad = compiler.compile(
      'import { setData } from "a2ui";\nexport default function App() {\n  setData("/when", new Date());\n  return null;\n}\n',
    );

    expect(good.diagnostics).toEqual([]);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]?.code).toBe(2345);
  });

  it('type-checks calls into the bindings module', () => {
    const app = (call: string) =>
      `import { estimateTravelTime } from "a2ui:bindings";\nexport default function App() {\n  ${call};\n  return null;\n}\n`;

    expect(
      compiler.compile(app('estimateTravelTime({ stops: [] })'), {bindings: BINDINGS}).ok,
    ).toBe(true);
    const wrong = compiler.compile(app('estimateTravelTime({ stop: "x" })'), {bindings: BINDINGS});
    expect(wrong.ok).toBe(false);
    expect(wrong.diagnostics[0]?.message).toContain('stop');
    const missing = compiler.compile(app('estimateTravelTime({ stops: [] })'));
    expect(missing.diagnostics[0]?.message).toContain('a2ui:bindings');
  });

  it('refuses to resolve or read server files outside the allowlisted type libraries', () => {
    const target = thisFile.replace(/\.ts$/, '');
    const result = compiler.compile(
      `import * as secret from ${JSON.stringify(target)};\nexport default function App() {\n  return <p>{String(secret)}</p>;\n}\n`,
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({phase: 'type', code: 2307})]);
    expect(result.diagnostics[0]?.message).not.toContain('createReactAppCompiler');
  });

  it('reuses the warm language service across compiles', () => {
    compiler.compile(loanSource);
    const result = compiler.compile(loanSource.replace('10;', '12;'));

    expect(result.ok).toBe(true);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
  });
});

describe('worker', () => {
  it('answers compile requests line by line after a ready line', async () => {
    const worker = spawn(process.execPath, [join(packageDir, 'dist', 'worker.js')], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const lines = createInterface({input: worker.stdout});
    const responses: Array<Record<string, unknown>> = [];
    const done = new Promise<void>(resolve => {
      lines.on('line', line => {
        responses.push(JSON.parse(line) as Record<string, unknown>);
        if (responses.length === 3) {
          resolve();
        }
      });
    });
    worker.stdin.write(`${JSON.stringify({id: 1, op: 'compile', source: loanSource})}\n`);
    worker.stdin.write(`${JSON.stringify({id: 2, op: 'ping'})}\n`);
    await done;
    worker.kill();

    expect(responses[0]).toMatchObject({id: 0, ready: true});
    expect(responses[1]).toMatchObject({id: 1, ok: true, diagnostics: []});
    expect(responses[2]).toEqual({id: 2, ok: true});
  });
});
