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

import {describe, expect} from 'vitest';

import {
  A2uiRequestProcessor,
  AnswerPart,
  DirectJsonFormatFactory,
  FileSystemCatalogProvider,
  StreamedAnswer,
} from '../../src/index.js';
import {MessageProcessor} from '../../src/internal/web-core.js';
import {loadCases} from './loader.js';
import {categoryOf, conformancePath, registerCase} from './suite-helpers.js';

/** Cases that run but do not pass yet, with the reason for each. */
const KNOWN_FAILURES = new Map<string, string>();

interface AnswerArgs {
  format: string;
  catalog: string;
  renderer_catalogs?: string[];
}

interface Step {
  input: string;
  expect_parts: Array<Record<string, unknown>>;
  expect_in_block?: boolean;
}

function load(file: string) {
  return new FileSystemCatalogProvider(conformancePath(file)).load();
}

/** A part in the suite's shape: text, a surface by its id, or an error by its category. */
function partToDict(part: AnswerPart, renderer: MessageProcessor): Record<string, unknown> {
  if (part.type === 'text') return {text: part.text};
  if (part.type === 'error') return {error: {category: categoryOf(part.error)}};
  expect(part.surface).toBe(renderer.model.getSurface(part.surface.id));
  return {surface: part.surface.id};
}

describe('Conformance: streamed_answer.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/streamed_answer.yaml')])) {
    registerCase(testCase, KNOWN_FAILURES, () => {
      const args = testCase.args as unknown as AnswerArgs;
      if (args.format !== 'direct_json') {
        throw new Error(`Unexpected format '${args.format}'`);
      }
      const processor = new A2uiRequestProcessor(
        [load(args.catalog)],
        undefined,
        new DirectJsonFormatFactory(),
      );
      const renderer = new MessageProcessor(
        (args.renderer_catalogs ?? [args.catalog]).map(load) as never,
      );
      const open = () => new StreamedAnswer(processor, {renderer});

      const expectError = testCase.expect_error as {category: string} | undefined;
      if (expectError) {
        let thrown: unknown;
        try {
          open();
        } catch (e) {
          thrown = e;
        }
        expect(categoryOf(thrown)).toBe(expectError.category);
        return;
      }

      const answer = open();
      const parts = () => answer.parts.map(part => partToDict(part, renderer));
      for (const [index, step] of (testCase.steps as Step[]).entries()) {
        answer.feed(step.input);
        expect(parts(), `step ${index}: ${step.input}`).toEqual(step.expect_parts);
        if (step.expect_in_block !== undefined) {
          expect(answer.isInBlock, `step ${index}: in block`).toBe(step.expect_in_block);
        }
      }
      answer.close();
      if (testCase.expect_close) {
        expect(parts(), 'close').toEqual(testCase.expect_close);
      }
    });
  }
});
