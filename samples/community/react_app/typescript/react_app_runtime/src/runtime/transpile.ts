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

import {transform} from 'sucrase';

/** A compile error with its position in the source, when Sucrase reports one. */
export class CompileError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = 'CompileError';
  }
}

/**
 * Transpiles the TSX source of an app into an ES module: types are stripped and JSX becomes
 * calls into `react/jsx-runtime`. Import statements are kept, so the import map of the frame
 * resolves them.
 *
 * @throws {CompileError} When Sucrase can't parse the source.
 */
export function transpileApp(source: string): string {
  try {
    return transform(source, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'automatic',
      production: true,
      filePath: 'App.tsx',
      disableESTransforms: true,
    }).code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Sucrase ends parse errors with "(line:column)".
    const position = /\((\d+):(\d+)\)\s*$/.exec(message);
    throw new CompileError(
      message,
      position ? Number(position[1]) : undefined,
      position ? Number(position[2]) + 1 : undefined,
    );
  }
}
