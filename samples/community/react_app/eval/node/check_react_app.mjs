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

/**
 * Compile and type-check worker for ReactApp sources, used by the eval scorers.
 *
 * Reads one JSON request per line on stdin, `{"id": ..., "source": "..."}`, and writes one JSON
 * response per line on stdout:
 *
 *   {"id": ..., "transpiled": bool, "transpileError": string | null,
 *    "typeErrors": [{"line": n, "column": n, "message": "..."}], "ms": n}
 *
 * Transpiling uses Sucrase with the options of the frame runtime. Type checking uses the
 * TypeScript compiler against the runtime's `a2ui.d.ts` and `@types/react`, reusing the previous
 * program so that a warm check takes a few hundred milliseconds. Both packages come from the
 * ReactApp Yarn project (`samples/community/react_app/node_modules`).
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const labsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(labsDir, 'typescript', 'react_app_runtime', 'package.json'));
const {transform} = require('sucrase');
const ts = require('typescript');

const typingsPath = join(labsDir, 'typescript', 'react_app_runtime', 'src', 'a2ui.d.ts');
const reactTypes = dirname(require.resolve('@types/react/package.json'));
const APP_FILE = '/virtual/App.tsx';

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  isolatedModules: true,
  types: [],
  baseUrl: '/',
  paths: {
    react: [join(reactTypes, 'index.d.ts')],
    'react/jsx-runtime': [join(reactTypes, 'jsx-runtime.d.ts')],
  },
};

const typings = readFileSync(typingsPath, 'utf8');
let previousProgram;

function typeCheck(source) {
  const files = new Map([
    [APP_FILE, source],
    ['/virtual/a2ui.d.ts', typings],
  ]);
  const host = ts.createCompilerHost(compilerOptions);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = name => files.get(name) ?? readFile(name);
  host.fileExists = name => files.has(name) || fileExists(name);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, shouldCreate) =>
    files.has(name)
      ? ts.createSourceFile(name, files.get(name), version, true, ts.ScriptKind.TSX)
      : getSourceFile(name, version, onError, shouldCreate);
  const program = ts.createProgram({
    rootNames: [APP_FILE, '/virtual/a2ui.d.ts'],
    options: compilerOptions,
    host,
    oldProgram: previousProgram,
  });
  previousProgram = program;
  const app = program.getSourceFile(APP_FILE);
  return ts
    .getPreEmitDiagnostics(program, app)
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    .slice(0, 20)
    .map(diagnostic => {
      const position =
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : {line: -1, character: -1};
      return {
        line: position.line + 1,
        column: position.character + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      };
    });
}

function check(source) {
  const started = performance.now();
  let transpiled = true;
  let transpileError = null;
  try {
    transform(source, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'automatic',
      production: true,
      filePath: 'App.tsx',
      disableESTransforms: true,
    });
  } catch (error) {
    transpiled = false;
    transpileError = error instanceof Error ? error.message : String(error);
  }
  const typeErrors = transpiled ? typeCheck(source) : [];
  return {transpiled, transpileError, typeErrors, ms: Math.round(performance.now() - started)};
}

const lines = createInterface({input: process.stdin});
lines.on('line', line => {
  if (!line.trim()) {
    return;
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  let response;
  try {
    response = {id: request.id, ...check(String(request.source ?? ''))};
  } catch (error) {
    response = {
      id: request.id,
      transpiled: false,
      transpileError: `Checker failed: ${error instanceof Error ? error.message : String(error)}`,
      typeErrors: [],
      ms: 0,
    };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
