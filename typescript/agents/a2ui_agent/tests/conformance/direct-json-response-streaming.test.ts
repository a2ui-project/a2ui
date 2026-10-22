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

import * as fs from 'fs';
import {describe, expect, test} from 'vitest';

import {
  A2uiCompilationParseError,
  A2uiCompilationValidationError,
  A2uiValidationError,
  DirectJsonParser,
  FileSystemCatalogProvider,
  ParseError,
  ResponsePart,
} from '../../src/index.js';
import {loadCases, LoadedCase} from './loader.js';
import {conformancePath, registerCase} from './suite-helpers.js';

/**
 * Cases that run but do not pass yet, with the reason for each.
 *
 * An expected failure still runs, and the suite asserts that it fails, so fixing the gap
 * turns the test red and prompts removing the entry.
 */
const KNOWN_FAILURES = new Map<string, string>([
  // #3269 changes these two shared cases to hold back a message for a surface that does not
  // exist yet, as this stream does. The cases change here once #3269 lands, since the Python and
  // Dart SDKs on main still emit the message.
  [
    'test_stream_update_before_create_surface_fails_v09',
    'the shared case still expects the message emitted; #3269 updates it',
  ],
  [
    'test_stream_data_model_before_create_surface_fails_v09',
    'the shared case still expects the message emitted; #3269 updates it',
  ],
]);

/** Protocol versions this SDK does not implement, with the reason for skipping. */
const UNSUPPORTED_VERSIONS = new Map<string, string>([['0.8', 'this SDK does not implement v0.8']]);

interface StreamingArgs {
  format: string;
  catalog?: string;
  catalogs?: string[];
  progressive_keys?: string[];
  wrapped?: boolean;
}

interface Step {
  input: string;
  expect?: Array<Record<string, unknown>>;
  expect_error?: {category: string; message?: string};
}

function catalogPaths(args: StreamingArgs): string[] {
  return args.catalogs ?? (args.catalog ? [args.catalog] : []);
}

/** The `protocolVersion` the case's first catalog document declares. */
function declaredVersion(args: StreamingArgs): string | undefined {
  const [first] = catalogPaths(args);
  if (!first) return undefined;
  const document = JSON.parse(fs.readFileSync(conformancePath(first), 'utf8')) as {
    protocolVersion?: string;
  };
  return document.protocolVersion?.replace(/^v/, '');
}

function makeParser(args: StreamingArgs): DirectJsonParser {
  if (args.format !== 'direct_json') {
    throw new Error(`Unexpected format '${args.format}'`);
  }
  const catalogs = catalogPaths(args).map(file =>
    new FileSystemCatalogProvider(conformancePath(file)).load(),
  );
  // The suite's default progressive set is empty: a case that relies on healing names its keys.
  return new DirectJsonParser(catalogs, {progressiveKeys: args.progressive_keys ?? []});
}

/** A part in the suite's shape: text or messages, never both. */
function partToDict(part: ResponsePart): Record<string, unknown> {
  return part.type === 'text' ? {text: part.text} : {a2ui: part.a2ui};
}

function expectError(fn: () => unknown, expected: NonNullable<Step['expect_error']>): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'the step should raise').toBeDefined();
  if (expected.category === 'ParseError') {
    expect(thrown instanceof ParseError || thrown instanceof A2uiCompilationParseError).toBe(true);
  } else if (expected.category === 'ValidationError') {
    expect(
      thrown instanceof A2uiValidationError || thrown instanceof A2uiCompilationValidationError,
    ).toBe(true);
  } else {
    throw new Error(`Unknown error category '${expected.category}'`);
  }
  if (expected.message) {
    expect((thrown as Error).message).toMatch(new RegExp(expected.message));
  }
}

function runCase(testCase: LoadedCase): void {
  const args = testCase.args as unknown as StreamingArgs;
  const wrapped = args.wrapped ?? true;
  const parser = makeParser(args);
  const stream = parser.openStream({wrapped});
  const chunks: string[] = [];
  const yielded: Array<Record<string, unknown>> = [];

  for (const [index, step] of (testCase.steps as Step[]).entries()) {
    chunks.push(step.input);
    if (step.expect_error) {
      expectError(() => stream.feed(step.input), step.expect_error);
      return;
    }
    const parts = stream.feed(step.input).map(partToDict);
    expect(parts, `step ${index}: ${step.input}`).toEqual(step.expect);
    yielded.push(...parts);
  }

  // Every case ends on a complete response, so closing the stream emits nothing more and
  // throws nothing.
  expect(stream.close()).toEqual([]);

  if (testCase.expect_matches_single_shot) {
    const singleShot = makeParser(args).parseResponse(chunks.join(''), {wrapped});
    expect(singleShot.map(partToDict)).toEqual(yielded);
  }
}

describe('Conformance: direct_json/response_streaming.yaml', () => {
  for (const testCase of loadCases([
    conformancePath('agent/direct_json/response_streaming.yaml'),
  ])) {
    const version = declaredVersion(testCase.args as unknown as StreamingArgs);
    const unsupported = version ? UNSUPPORTED_VERSIONS.get(version) : undefined;
    if (unsupported) {
      test.skip(`${testCase.action} · ${testCase.name} (${unsupported})`, () => {});
      continue;
    }
    registerCase(testCase, KNOWN_FAILURES, () => runCase(testCase));
  }
});
