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

import {A2uiError} from './internal/web-core.js';
import type {ResponsePart} from './parser/response-part.js';

export {
  A2uiCatalogError,
  A2uiError,
  A2uiValidationError,
  A2uiDataError,
  A2uiExpressionError,
  A2uiStateError,
  A2uiIntegrityError,
  A2uiRecursionError,
} from './internal/web-core.js';

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
 * Raised when a format block cannot be read at all.
 *
 * The block is malformed on its own terms: the notation's grammar rejects it,
 * or it is missing a part the notation requires before it names anything for
 * the catalog to check.
 *
 * Note: TypeScript has single inheritance, so this class cannot also extend ParseError.
 */
export class A2uiCompilationParseError extends A2uiCompilationError {
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
    super(message, options);
    this.name = 'A2uiCompilationParseError';
  }
}

/**
 * Raised when a readable format block says something the catalog refuses.
 *
 * The block parses, so the failure is about what it names rather than how it
 * is written: a property the component does not declare, a value outside a
 * property's enum, a binding on a property that takes only a literal.
 *
 * Note: TypeScript has single inheritance, so this class cannot also extend A2uiValidationError.
 */
export class A2uiCompilationValidationError extends A2uiCompilationError {
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
    super(message, options);
    this.name = 'A2uiCompilationValidationError';
  }
}
