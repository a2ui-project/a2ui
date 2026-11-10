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
import loanExampleJson from '../../../../catalog/v1/examples/loan_explorer.json' with {type: 'json'};
import {codeFrame} from './app_root.js';
import {findDataPaths, findImports, findUnavailableImports} from './source_scan.js';
import {CompileError, transpileApp} from './transpile.js';

const loanExample = loanExampleJson as {
  messages: Array<{updateComponents?: {components: Array<Record<string, unknown>>}}>;
};

function exampleSource(): string {
  for (const message of loanExample.messages) {
    for (const component of message.updateComponents?.components ?? []) {
      if (component['component'] === 'ReactApp') {
        return component['source'] as string;
      }
    }
  }
  throw new Error('No ReactApp in the example.');
}

describe('findImports', () => {
  it('finds static, re-export, side-effect and dynamic imports', () => {
    const source = [
      'import React, {useState} from "react";',
      "import type {Theme} from 'a2ui';",
      'import "./styles.css";',
      "export {x} from 'lodash';",
      'const mod = await import("d3");',
    ].join('\n');

    expect(findImports(source)).toEqual(['react', 'a2ui', './styles.css', 'lodash', 'd3']);
  });

  it('reports only the modules the frame does not provide', () => {
    expect(findUnavailableImports(exampleSource())).toEqual([]);
    expect(
      findUnavailableImports('import _ from "lodash";\nimport {useData} from "a2ui";'),
    ).toEqual(['lodash']);
  });
});

describe('findDataPaths', () => {
  it('finds literal paths passed to useData, getData and subscribe, with or without generics', () => {
    const source = [
      'const [rate] = useData<number>("/loan/rate", 5);',
      "const [rows] = useData<{ a: number }[]>('/rows', []);",
      'getData(`/user/name`);',
      'subscribe("relative/path", v => v);',
      'useData(`/items/${index}`, null);',
      'useData(pathVariable, 0);',
    ].join('\n');

    expect(findDataPaths(source)).toEqual(['/loan/rate', '/rows', '/user/name', 'relative/path']);
  });

  it('finds the paths of the loan example', () => {
    expect(findDataPaths(exampleSource())).toEqual([
      '/loan/principal',
      '/loan/rate',
      '/loan/annualPayment',
      '/loan/selectedYear',
    ]);
  });
});

describe('transpileApp', () => {
  it('strips types and compiles JSX to the automatic runtime, keeping ES imports', () => {
    const code = transpileApp(
      'import {useState} from "react";\ntype P = {n: number};\nexport default function App() {\n  const [n] = useState<number>(1);\n  return <div className="x">{n as number}</div>;\n}\n',
    );

    expect(code).toContain('from "react/jsx-runtime"');
    expect(code).toContain('import {useState} from "react"');
    expect(code).toContain('export default function App()');
    expect(code).not.toContain('type P');
    expect(code).not.toContain('<div');
  });

  it('compiles the loan example', () => {
    expect(() => transpileApp(exampleSource())).not.toThrow();
  });

  it('reports syntax errors with a 1-based line and column', () => {
    let error: unknown;
    try {
      transpileApp('export default function App() {\n  const x = ;\n  return null;\n}\n');
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(CompileError);
    expect((error as CompileError).line).toBe(2);
    expect((error as CompileError).column).toBeGreaterThan(0);
  });
});

describe('codeFrame', () => {
  it('shows the lines around the error with a marker', () => {
    const frame = codeFrame('a\nb\nc\nd\ne\nf', 3, 2);

    expect(frame).toBe(
      ['  1 | a', '  2 | b', '> 3 | c', '    |  ^', '  4 | d', '  5 | e'].join('\n'),
    );
  });
});
