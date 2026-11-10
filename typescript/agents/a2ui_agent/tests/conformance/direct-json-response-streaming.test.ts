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

import {expect} from 'vitest';

import {DirectJsonParser} from '../../src/inference-formats/direct-json/parser.js';
import {StreamPart} from '../../src/parser/response-part.js';
import {ResponseStream} from '../../src/parser/response-stream.js';
import {FileSystemCatalogProvider} from '../../src/processor/catalog-providers.js';
import {LoadedCase, loadCases} from './loader.js';
import {
  SuiteVersion,
  caseDeclaresV1,
  injectedCatalogId,
  liftParts,
  loadCatalogFromRelativePath,
  lowerText,
} from './lowering.js';
import {
  assertKnownKeys,
  CASE_METADATA_KEYS,
  categoryOf,
  conformancePath,
  EXPECT_ERROR_KEYS,
  forEachSuiteVersion,
  KNOWN_FAILURES,
} from './suite-helpers.js';

/** Protocol versions this SDK does not implement, with the reason for skipping. */
const UNSUPPORTED_VERSIONS = new Map<string, string>([['0.8', 'this SDK does not implement v0.8']]);

const PARSE_CHUNK_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'steps',
  'expect_close',
  'expect_error',
  'expect_matches_single_shot',
]);
const PARSE_CHUNK_ARGS_KEYS = new Set([
  'format',
  'catalog',
  'catalogs',
  'progressive_keys',
  'wrapped',
  'after_rejected_block',
]);
const PARSE_CHUNK_STEP_KEYS = new Set([
  'input',
  'expect',
  'expect_error',
  'expect_partial_results',
  'expect_in_block',
]);

interface StreamingArgs {
  format: string;
  catalog?: string;
  catalogs?: string[];
  progressive_keys?: string[];
  wrapped?: boolean;
  after_rejected_block?: 'end' | 'continue';
}

interface ExpectedError {
  category: string;
  message?: string;
}

interface Step {
  input: string;
  expect?: Array<Record<string, unknown>>;
  expect_error?: ExpectedError;
  expect_partial_results?: Array<Record<string, unknown>>;
  expect_in_block?: boolean;
}

function catalogPaths(args: StreamingArgs): string[] {
  if (args.catalogs) return args.catalogs;
  if (args.catalog) return [args.catalog];
  throw new Error('Case declares no catalog');
}

/** The protocol version the case targets, without a leading "v". */
function declaredVersion(args: StreamingArgs): string | undefined {
  const path = catalogPaths(args)[0];
  const file = path.split('/').pop()!;
  const [match] = file.match(/v\d+_\d+(_\d+)?/) ?? [];
  if (match) return match.slice(1).replace(/_/g, '.');
  const document = new FileSystemCatalogProvider(conformancePath(path)).load().toSchema() as {
    protocolVersion?: string;
  };
  return document.protocolVersion?.replace(/^v/, '');
}

function makeParser(
  args: StreamingArgs,
  lower = false,
  bufferIncompleteComponents = false,
): DirectJsonParser {
  if (args.format !== 'direct_json') {
    throw new Error(`Unexpected format '${args.format}'`);
  }
  const catalogs = catalogPaths(args).map(file => loadCatalogFromRelativePath(file, lower));
  return new DirectJsonParser(catalogs, {
    progressiveKeys: args.progressive_keys ?? [],
    bufferIncompleteComponents,
  });
}

/** A part in the suite's shape: text, messages or an error, one per part. */
function partToDict(part: StreamPart): Record<string, unknown> {
  if (part.type === 'text') return {text: part.text};
  if (part.type === 'error') return {error: {category: categoryOf(part.error)}};
  return {a2ui: part.a2ui};
}

/** Runs `fn`, expects it to throw `expected`, and returns the error. */
function expectError(fn: () => unknown, expected: ExpectedError): unknown {
  assertKnownKeys(
    expected as unknown as Record<string, unknown>,
    EXPECT_ERROR_KEYS,
    'expect_error',
  );
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'the step should raise').toBeDefined();
  expect(categoryOf(thrown)).toBe(expected.category);
  if (expected.message) {
    expect((thrown as Error).message).toMatch(new RegExp(expected.message, 'i'));
  }
  return thrown;
}

function mergeAdjacentText(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  for (const p of parts) {
    if (merged.length > 0 && 'text' in merged[merged.length - 1] && 'text' in p) {
      merged[merged.length - 1] = {
        text: `${merged[merged.length - 1].text}${p.text}`,
      };
    } else {
      merged.push(p);
    }
  }
  return merged;
}

function runCase(testCase: LoadedCase, version: SuiteVersion): void {
  assertKnownKeys(testCase, PARSE_CHUNK_CASE_KEYS, 'parse_chunk case');
  const isLowered = version === 'v0.9-lowered';
  const injId = isLowered ? injectedCatalogId(testCase) : undefined;
  const toExpected = (parts: StreamPart[]) => {
    const dicts = parts.map(partToDict);
    return isLowered ? liftParts(dicts, {injectedCatalogId: injId}) : dicts;
  };
  const args = testCase.args as unknown as StreamingArgs;
  assertKnownKeys(
    args as unknown as Record<string, unknown>,
    PARSE_CHUNK_ARGS_KEYS,
    'parse_chunk args',
  );
  const wrapped = args.wrapped ?? true;
  const parser = makeParser(args, isLowered, isLowered && caseDeclaresV1(testCase.args));
  const stream: ResponseStream<StreamPart> = parser.openStream({
    wrapped,
    afterRejectedBlock: args.after_rejected_block ?? 'end',
  });
  const chunks: string[] = [];
  const yielded: Array<Record<string, unknown>> = [];

  for (const [index, step] of (testCase.steps as Step[]).entries()) {
    assertKnownKeys(
      step as unknown as Record<string, unknown>,
      PARSE_CHUNK_STEP_KEYS,
      'parse_chunk step',
    );
    const chunk = isLowered ? lowerText(step.input, injId) : step.input;
    chunks.push(chunk);
    if (step.expect_error) {
      const error = expectError(() => stream.feed(chunk), step.expect_error);
      if (step.expect_partial_results) {
        const partial = (error as {partialResults?: StreamPart[]}).partialResults ?? [];
        expect(toExpected(partial), `step ${index}: partial results`).toEqual(
          step.expect_partial_results,
        );
      }
      if (step.expect_in_block !== undefined) {
        expect(stream.isInBlock, `step ${index}: in block`).toBe(step.expect_in_block);
      }
      return;
    }
    const parts = toExpected(stream.feed(chunk));
    expect(parts, `step ${index}: ${step.input}`).toEqual(step.expect);
    if (step.expect_in_block !== undefined) {
      expect(stream.isInBlock, `step ${index}: in block`).toBe(step.expect_in_block);
    }
    yielded.push(...parts);
  }

  if (testCase.expect_error) {
    expectError(() => stream.close(), testCase.expect_error as ExpectedError);
    return;
  }

  const closed = toExpected(stream.close());
  if (testCase.expect_close) {
    expect(closed, 'close').toEqual(testCase.expect_close);
  }
  yielded.push(...closed);

  if (testCase.expect_matches_single_shot) {
    const singleShot = makeParser(args, isLowered).parseResponse(chunks.join(''), {wrapped});
    expect(mergeAdjacentText(yielded)).toEqual(mergeAdjacentText(toExpected(singleShot)));
  }
}

forEachSuiteVersion(
  'Conformance: direct_json/response_streaming.yaml',
  loadCases([conformancePath('agent/direct_json/response_streaming.yaml')]),
  (testCase, version) => runCase(testCase, version),
  {
    knownFailures: KNOWN_FAILURES,
    skipReason: testCase => {
      const version = declaredVersion(testCase.args as unknown as StreamingArgs);
      return version ? UNSUPPORTED_VERSIONS.get(version) : undefined;
    },
  },
);
