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

import {A2uiError} from './internal/web_core.js';
import type {ResponsePart} from './parser/response_part.js';

export {
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiIntegrityError,
  A2uiRecursionError,
} from './internal/web_core.js';

/**
 * Error raised on malformed model output during parsing.
 */
export class ParseError extends A2uiError {
  /**
   * Initializes a new `ParseError` instance.
   *
   * @param message Human-readable error description.
   */
  constructor(message: string) {
    super(message, 'PARSE_ERROR');
    this.name = 'ParseError';
  }
}

/**
 * Exception raised when compiling/parsing an A2UI format block fails.
 */
export class A2uiCompilationError extends A2uiError {
  readonly detail: string;
  readonly rawContent: string;
  readonly line?: number;
  readonly column?: number;
  readonly helpMessage?: string;
  partialResults: ResponsePart[];

  constructor(
    message: string,
    options: {
      rawContent: string;
      line?: number;
      column?: number;
      helpMessage?: string;
      partialResults?: ResponsePart[];
    },
  ) {
    const parts = [message];
    if (options.line !== undefined) {
      let loc = `Line ${options.line}`;
      if (options.column !== undefined) {
        loc += `, Col ${options.column}`;
      }
      parts.push(loc);
    }
    if (options.helpMessage) {
      parts.push(`Help: ${options.helpMessage}`);
    }
    super(parts.join(' - '), 'COMPILATION_ERROR');
    this.name = 'A2uiCompilationError';
    this.detail = message;
    this.rawContent = options.rawContent;
    this.line = options.line;
    this.column = options.column;
    this.helpMessage = options.helpMessage;
    this.partialResults = options.partialResults ?? [];
  }
}

/**
 * TEMPORARY — this belongs in `@a2ui/web_core`, not here.
 *
 * Local stand-in for catalog-related errors.
 *
 * @remarks
 * This is a local stand-in, not a permanent part of the agent SDK's surface.
 * `A2uiCatalogError` is specified by `blueprints/modules/a2ui_core.blueprint.md`
 * and is expected to land in `@a2ui/web_core/errors`. Once it does:
 *   1. delete this declaration,
 *   2. re-export the core one from `src/internal/web_core.ts`,
 *   3. remove this entry from the "Temporary shims" table in the package README.
 * No other file should need to change, because nothing imports it directly.
 *
 * @see blueprints/codebases/typescript/a2ui_agent/design_doc.blueprint.md — section 1
 *
 * TODO(web_core): remove once `A2uiCatalogError` is exported from core.
 */
export class A2uiCatalogError extends A2uiError {
  /**
   * Initializes a new `A2uiCatalogError` instance.
   *
   * @param message Human-readable error description.
   */
  constructor(message: string) {
    super(message, 'CATALOG_ERROR');
    this.name = 'A2uiCatalogError';
  }
}
