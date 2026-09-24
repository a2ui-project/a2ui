/*
 * Copyright 2026 Google LLC
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

import {describe, it, expect} from 'vitest';
import {
  A2uiCompilationError,
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiError,
} from '../../src/errors.js';
import type {ResponsePart} from '../../src/parser/response_part.js';

describe('A2uiCompilationError', () => {
  it('formats message with message only', () => {
    const err = new A2uiCompilationError('Compilation failed', {rawContent: 'content'});
    expect(err.message).toBe('Compilation failed');
  });

  it('formats message with line only', () => {
    const err = new A2uiCompilationError('Compilation failed', {
      rawContent: 'content',
      line: 10,
    });
    expect(err.message).toBe('Compilation failed - Line 10');
  });

  it('formats message with line and column', () => {
    const err = new A2uiCompilationError('Compilation failed', {
      rawContent: 'content',
      line: 10,
      column: 5,
    });
    expect(err.message).toBe('Compilation failed - Line 10, Col 5');
  });

  it('formats message with line, column, and help message', () => {
    const err = new A2uiCompilationError('Compilation failed', {
      rawContent: 'content',
      line: 10,
      column: 5,
      helpMessage: 'Check syntax',
    });
    expect(err.message).toBe('Compilation failed - Line 10, Col 5 - Help: Check syntax');
  });

  it('omits column when line is not defined', () => {
    const err = new A2uiCompilationError('Compilation failed', {
      rawContent: 'content',
      column: 5,
    });
    expect(err.message).toBe('Compilation failed');
  });

  it('omits empty helpMessage', () => {
    const err = new A2uiCompilationError('Compilation failed', {
      rawContent: 'content',
      line: 10,
      helpMessage: '',
    });
    expect(err.message).toBe('Compilation failed - Line 10');
  });

  it('preserves all constructor fields', () => {
    const partial: ResponsePart[] = [{type: 'text', text: 'prefix'}];
    const err = new A2uiCompilationError('Original message', {
      rawContent: 'raw text',
      line: 7,
      column: 12,
      helpMessage: 'Help hint',
      partialResults: partial,
    });
    expect(err.detail).toBe('Original message');
    expect(err.rawContent).toBe('raw text');
    expect(err.line).toBe(7);
    expect(err.column).toBe(12);
    expect(err.helpMessage).toBe('Help hint');
    expect(err.partialResults).toBe(partial);
    expect(err.name).toBe('A2uiCompilationError');
  });

  it('defaults partialResults to an empty array', () => {
    const err = new A2uiCompilationError('Failed', {rawContent: 'raw text'});
    expect(err.partialResults).toEqual([]);
  });

  it('is an instance of A2uiError and Error', () => {
    const err = new A2uiCompilationError('Failed', {rawContent: 'raw text'});
    expect(err).toBeInstanceOf(A2uiError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('A2uiCompilationParseError', () => {
  it('instantiates with name and options', () => {
    const err = new A2uiCompilationParseError('Syntax failure', {
      rawContent: 'raw dsl',
      line: 3,
      column: 14,
      helpMessage: 'Check grammar',
    });
    expect(err.name).toBe('A2uiCompilationParseError');
    expect(err.detail).toBe('Syntax failure');
    expect(err.rawContent).toBe('raw dsl');
    expect(err.line).toBe(3);
    expect(err.column).toBe(14);
    expect(err.helpMessage).toBe('Check grammar');
    expect(err.message).toBe('Syntax failure - Line 3, Col 14 - Help: Check grammar');
    expect(err).toBeInstanceOf(A2uiCompilationError);
    expect(err).toBeInstanceOf(A2uiError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('A2uiCompilationValidationError', () => {
  it('instantiates with name and options', () => {
    const err = new A2uiCompilationValidationError('Catalog failure', {
      rawContent: 'raw dsl',
      line: 5,
      column: 2,
      helpMessage: 'Check property names',
    });
    expect(err.name).toBe('A2uiCompilationValidationError');
    expect(err.detail).toBe('Catalog failure');
    expect(err.rawContent).toBe('raw dsl');
    expect(err.line).toBe(5);
    expect(err.column).toBe(2);
    expect(err.helpMessage).toBe('Check property names');
    expect(err.message).toBe('Catalog failure - Line 5, Col 2 - Help: Check property names');
    expect(err).toBeInstanceOf(A2uiCompilationError);
    expect(err).toBeInstanceOf(A2uiError);
    expect(err).toBeInstanceOf(Error);
  });
});
