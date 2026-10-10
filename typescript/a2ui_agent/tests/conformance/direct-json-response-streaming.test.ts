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
  FileSystemCatalogProvider,
  ParseError,
  ResponsePart,
} from '../../src/index.js';
import {DirectJsonParser} from '../../src/inference-formats/direct-json/parser.js';
import {DirectJsonStreamProcessorImpl} from '../../src/inference-formats/direct-json/streaming.js';
import {STRICT_VALIDATION} from '../../src/internal/web-core.js';
import {loadCases, LoadedCase} from './loader.js';
import {conformancePath, registerCase} from './suite-helpers.js';

/**
 * Cases that run but do not pass yet, with the reason for each.
 *
 * `DirectJsonStreamProcessorImpl` follows the rules of the earlier streaming suite,
 * `agent/legacy/streaming_parser.yaml`, which this suite replaced. Each group below is one
 * rule of this suite it does not follow yet. See "Streaming follows the legacy suite" in
 * KNOWN_GAPS.md.
 */
const KNOWN_FAILURES = new Map<string, string>([
  ...group('text outside a block keeps the whitespace at its edges instead of trimming it', [
    'test_chunk_open_tag_split_across_chunks',
    'test_chunk_text_then_block_at_part_boundaries',
    'test_chunk_two_blocks_in_one_stream',
    'test_chunk_whole_response_in_one_chunk',
    'test_stream_interleaved_text_v09',
    'test_stream_multiple_blocks_v09',
    'test_stream_open_tag_split_v09',
  ]),
  ...group(
    'a message is emitted only once the block closes, not as soon as it reads, and an unwrapped stream is not read',
    [
      'test_chunk_boundary_inside_a_string_literal',
      'test_chunk_close_tag_and_trailing_text_in_one_chunk',
      'test_chunk_close_tag_split_across_chunks_does_not_re_emit',
      'test_chunk_key_outside_the_progressive_set_withholds',
      'test_chunk_partial_child_list_template_withholds',
      'test_chunk_partial_child_reference_withholds',
      'test_chunk_partial_children_list_withholds',
      'test_chunk_partial_component_name_withholds',
      'test_chunk_partial_data_binding_path_withholds',
      'test_chunk_payload_withheld_until_it_parses',
      'test_chunk_progressive_key_inside_a_component_waits',
      'test_chunk_progressive_keys_name_the_healable_properties',
      'test_chunk_string_holding_a_close_tag_split_across_chunks',
      'test_chunk_unwrapped_stream_compiles_the_body',
    ],
  ),
  ...group(
    'a message still arriving is pruned or given placeholder components, rather than withheld until it reads whole',
    [
      'test_chunk_closed_components_emit_while_the_next_arrives',
      'test_chunk_data_model_key_without_a_value_withholds',
      'test_stream_child_before_root_v09',
      'test_stream_children_list_v09',
      'test_stream_component_catalog_id_arrives_late_v10',
      'test_stream_concurrent_surfaces_v09',
      'test_stream_cut_escape_sequence_v09',
      'test_stream_cut_number_withholds_v09',
      'test_stream_cut_surrogate_pair_v09',
      'test_stream_data_model_cut_key_and_value_v09',
      'test_stream_data_model_keeps_earlier_entries_v09',
      'test_stream_data_model_key_without_value_withholds_v09',
      'test_stream_data_model_trailing_key_without_value_withholds_v09',
      'test_stream_data_model_updates_after_components_v09',
      'test_stream_data_model_value_cut_at_key_withholds_v09',
      'test_stream_incremental_yielding_v09',
      'test_stream_multi_catalog_resolution_v10',
      'test_stream_no_placeholder_components_v09',
      'test_stream_open_children_object_withholds_v09',
      'test_stream_open_nested_object_withholds_v09',
      'test_stream_single_child_reference_v09',
      'test_stream_template_child_v09',
    ],
  ),
  ...group(
    'an invalid message raises as it arrives rather than when the block closes, and a cycle raises A2uiRecursionError rather than a validation error',
    [
      'test_stream_circular_reference_fails_v09',
      'test_stream_create_surface_missing_catalog_id_v09',
      'test_stream_message_without_version_fails_v09',
      'test_stream_self_reference_fails_v09',
      'test_stream_unknown_message_fails_v09',
    ],
  ),
  ...group(
    'messages for a surface the block has not created are dropped or accepted, and an orphan is dropped, rather than reported when the block closes',
    [
      'test_stream_data_model_before_create_surface_fails_v09',
      'test_stream_delete_surface_before_create_surface_v09',
      'test_stream_orphan_component_fails_v09',
      'test_stream_update_before_create_surface_fails_v09',
    ],
  ),
]);

function group(reason: string, names: string[]): Array<[string, string]> {
  return names.map(name => [name, reason]);
}

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
  const processor = new DirectJsonStreamProcessorImpl(catalogs, {
    progressiveKeys: args.progressive_keys ?? [],
    validationConfig: STRICT_VALIDATION,
  });
  return new DirectJsonParser(catalogs, processor);
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
  const chunks: string[] = [];
  const yielded: Array<Record<string, unknown>> = [];

  for (const [index, step] of (testCase.steps as Step[]).entries()) {
    chunks.push(step.input);
    if (step.expect_error) {
      expectError(() => parser.parseChunk(step.input, wrapped), step.expect_error);
      return;
    }
    const parts = parser.parseChunk(step.input, wrapped).map(partToDict);
    expect(parts, `step ${index}: ${step.input}`).toEqual(step.expect);
    yielded.push(...parts);
  }

  if (testCase.expect_matches_single_shot) {
    const singleShot = makeParser(args).parseResponse(chunks.join(''), wrapped);
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
