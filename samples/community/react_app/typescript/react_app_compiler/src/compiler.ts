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
 * Server-side compiler of ReactApp sources.
 *
 * `compile` transpiles the TSX with Sucrase, with the options of the frame runtime, so the output
 * can go into the component's `compiled` property and the frame skips its own transpile. It then
 * type-checks the source with a TypeScript language service against the runtime's `a2ui.d.ts`,
 * `@types/react` and the bindings `.d.ts` of the request. The language service stays warm between
 * calls: the library files are parsed once, so a warm check costs only the app itself.
 */

import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve, sep} from 'node:path';

import {transform} from 'sucrase';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/** Where a diagnostic comes from. */
export type DiagnosticPhase = 'transpile' | 'type';

/** One problem in the app source; positions are 1-based. */
export interface CompileDiagnostic {
  readonly phase: DiagnosticPhase;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  /** The TypeScript error code, for type errors. */
  readonly code?: number;
}

/** The result of {@link ReactAppCompiler.compile}. */
export interface CompileResult {
  /** Whether the source transpiled and type-checked without errors. */
  readonly ok: boolean;
  /** The transpiled ES module, when Sucrase succeeded (even with type errors). */
  readonly compiled: string | null;
  readonly diagnostics: readonly CompileDiagnostic[];
  readonly timings: {
    readonly transpileMs: number;
    readonly typecheckMs: number;
    readonly totalMs: number;
  };
}

/** Options of one compile. */
export interface CompileOptions {
  /** Declarations of the `a2ui:bindings` module the app may import. */
  readonly bindings?: string;
  /** Skip the type check (transpile only). */
  readonly skipTypeCheck?: boolean;
}

/** Options of {@link createReactAppCompiler}. */
export interface ReactAppCompilerOptions {
  /** Path of the `a2ui` module declarations; defaults to the runtime package's `a2ui.d.ts`. */
  readonly typingsPath?: string;
}

/**
 * Compiler options of the type check. Strict, except for implicit `any`: models leave callback
 * parameters of chart libraries untyped, and that never fails at runtime.
 */
export const TYPE_CHECK_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  strict: true,
  noImplicitAny: false,
  noEmit: true,
  skipLibCheck: true,
  isolatedModules: true,
  allowJs: false,
  types: [],
};

/**
 * Declarations that keep habits from Node-flavored React code from failing the check: models type
 * timers as `NodeJS.Timeout`, which in a browser is a number.
 */
const COMPAT_DECLARATIONS = `declare namespace NodeJS {
  type Timeout = ReturnType<typeof setTimeout>;
  type Timer = ReturnType<typeof setInterval>;
}
`;

const APP_FILE = '/react-app/App.tsx';
const TYPINGS_FILE = '/react-app/a2ui.d.ts';
const BINDINGS_FILE = '/react-app/a2ui-bindings.d.ts';
const COMPAT_FILE = '/react-app/compat.d.ts';

function defaultTypingsPath(): string {
  return require.resolve('@a2ui-labs/react-app-runtime/a2ui.d.ts');
}

function resolveAllowedDirs(reactTypes: string, settings: ts.CompilerOptions): readonly string[] {
  const dirs = new Set<string>([
    resolve(reactTypes),
    resolve(dirname(ts.getDefaultLibFilePath(settings))),
  ]);
  const reactRequire = createRequire(join(reactTypes, 'package.json'));
  for (const dep of ['csstype', '@types/prop-types']) {
    try {
      dirs.add(resolve(dirname(reactRequire.resolve(`${dep}/package.json`))));
    } catch {
      // Optional peer/transitive type package not present.
    }
  }
  return [...dirs];
}

function isUnderAllowedDir(target: string, allowedDirs: readonly string[]): boolean {
  const resolved = resolve(target);
  return allowedDirs.some(dir => resolved === dir || resolved.startsWith(`${dir}${sep}`));
}

function isAncestorOfAllowedDir(target: string, allowedDirs: readonly string[]): boolean {
  const resolved = resolve(target);
  return allowedDirs.some(
    dir =>
      resolved === dir ||
      resolved.startsWith(`${dir}${sep}`) ||
      dir.startsWith(`${resolved === sep ? '' : resolved}${sep}`),
  );
}

/** Sucrase with the options of the frame runtime (`react_app_runtime/src/runtime/transpile.ts`). */
export function transpile(source: string): string {
  return transform(source, {
    transforms: ['typescript', 'jsx'],
    jsxRuntime: 'automatic',
    production: true,
    filePath: 'App.tsx',
    disableESTransforms: true,
  }).code;
}

function transpileDiagnostic(error: unknown): CompileDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const position = /\((\d+):(\d+)\)\s*$/.exec(message);
  return {
    phase: 'transpile',
    message,
    line: position ? Number(position[1]) : 1,
    column: position ? Number(position[2]) + 1 : 1,
  };
}

/** A compiler with a warm language service. Not safe for concurrent use; calls are synchronous. */
export interface ReactAppCompiler {
  compile(source: string, options?: CompileOptions): CompileResult;
}

/** Creates a compiler. The first type check loads the libraries (about a second). */
export function createReactAppCompiler(options: ReactAppCompilerOptions = {}): ReactAppCompiler {
  const reactTypes = dirname(require.resolve('@types/react/package.json'));
  const compilerOptions: ts.CompilerOptions = {
    ...TYPE_CHECK_OPTIONS,
    baseUrl: '/',
    paths: {
      react: [join(reactTypes, 'index.d.ts')],
      'react/jsx-runtime': [join(reactTypes, 'jsx-runtime.d.ts')],
    },
  };
  const allowedDirs = resolveAllowedDirs(reactTypes, compilerOptions);
  const files = new Map<string, {text: string; version: number}>([
    [
      TYPINGS_FILE,
      {text: readFileSync(options.typingsPath ?? defaultTypingsPath(), 'utf8'), version: 1},
    ],
    [COMPAT_FILE, {text: COMPAT_DECLARATIONS, version: 1}],
    [BINDINGS_FILE, {text: 'export {};\n', version: 1}],
    [APP_FILE, {text: '', version: 0}],
  ]);
  const setFile = (name: string, text: string) => {
    const current = files.get(name);
    if (current && current.text === text) {
      return;
    }
    files.set(name, {text, version: (current?.version ?? 0) + 1});
  };
  const readAllowedFile = (name: string): string | undefined => {
    const virtual = files.get(name);
    if (virtual) {
      return virtual.text;
    }
    return isUnderAllowedDir(name, allowedDirs) ? ts.sys.readFile(name) : undefined;
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: name => String(files.get(name)?.version ?? 0),
    getScriptSnapshot: name => {
      const text = readAllowedFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: settings => ts.getDefaultLibFilePath(settings),
    fileExists: name =>
      files.has(name) || (isUnderAllowedDir(name, allowedDirs) && ts.sys.fileExists(name)),
    readFile: readAllowedFile,
    readDirectory: (path, extensions, exclude, include, depth) =>
      isUnderAllowedDir(path, allowedDirs)
        ? ts.sys.readDirectory(path, extensions, exclude, include, depth)
        : [],
    directoryExists: name =>
      name === '/' ||
      name === '/react-app' ||
      (isAncestorOfAllowedDir(name, allowedDirs) && ts.sys.directoryExists(name)),
    getDirectories: name =>
      isUnderAllowedDir(name, allowedDirs) ? ts.sys.getDirectories(name) : [],
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  const typeCheck = (source: string, bindings: string | undefined): CompileDiagnostic[] => {
    setFile(APP_FILE, source);
    setFile(BINDINGS_FILE, bindings ?? 'export {};\n');
    const diagnostics = [
      ...service.getSyntacticDiagnostics(APP_FILE),
      ...service.getSemanticDiagnostics(APP_FILE),
    ];
    return diagnostics
      .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
      .slice(0, 30)
      .map(diagnostic => {
        const position =
          diagnostic.file && diagnostic.start !== undefined
            ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
            : {line: 0, character: 0};
        return {
          phase: 'type' as const,
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
          line: position.line + 1,
          column: position.character + 1,
          code: diagnostic.code,
        };
      });
  };

  return {
    compile(source, compileOptions = {}) {
      const started = performance.now();
      let compiled: string | null = null;
      const diagnostics: CompileDiagnostic[] = [];
      try {
        compiled = transpile(source);
      } catch (error) {
        diagnostics.push(transpileDiagnostic(error));
      }
      const transpiled = performance.now();
      if (compiled !== null && !compileOptions.skipTypeCheck) {
        diagnostics.push(...typeCheck(source, compileOptions.bindings));
      }
      const finished = performance.now();
      return {
        ok: compiled !== null && diagnostics.length === 0,
        compiled,
        diagnostics,
        timings: {
          transpileMs: Math.round(transpiled - started),
          typecheckMs: Math.round(finished - transpiled),
          totalMs: Math.round(finished - started),
        },
      };
    },
  };
}
