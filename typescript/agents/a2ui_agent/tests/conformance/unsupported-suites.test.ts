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

import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join, relative} from 'path';

import {describe, expect, test} from 'vitest';

import {CONFORMANCE_ROOT, loadCases} from './loader.js';
import {getActiveCase, recordCase, setActiveCase} from './manifest.js';
import {
  assertKnownKeys,
  conformancePath,
  describeSuite,
  KNOWN_FAILURES,
  SUPERSEDED,
  UnknownConformanceKeyError,
  UNSUPPORTED,
} from './suite-helpers.js';

export const ACTIVE_SUITES: ReadonlySet<string> = new Set([
  'agent/agent_functions.yaml',
  'agent/catalog_provider.yaml',
  'agent/catalog_resolution.yaml',
  'agent/catalog_transformer.yaml',
  'agent/direct_json/compiler.yaml',
  'agent/direct_json/decompiler.yaml',
  'agent/direct_json/prompt_generator.yaml',
  'agent/direct_json/response_parser.yaml',
  'agent/direct_json/response_streaming.yaml',
  'agent/express/compiler.yaml',
  'agent/express/decompiler.yaml',
  'agent/express/prompt_generator.yaml',
  'agent/express/response_parser.yaml',
  'agent/express/response_streaming.yaml',
  'agent/legacy/inference_format.yaml',
  'agent/legacy/parser.yaml',
  'agent/multi_catalog_formats.yaml',
  'agent/renderer_capabilities.yaml',
  'agent/renderer_function_calls.yaml',
  'agent/renderer_state.yaml',
  'agent/request_processor.yaml',
  'agent/skill.yaml',
  'agent/streamed_answer.yaml',
]);

export const PERFORMANCE_SUITES: ReadonlySet<string> = new Set([
  'agent/direct_json/scaling.yaml',
  'agent/express/scaling.yaml',
]);

export const UNSUPPORTED_SUITES: Readonly<Record<string, string>> = {
  'agent/a2ui_xml/compiler.yaml':
    'the a2ui-xml format is an experimental Python agent inference format not implemented in TypeScript',
  'agent/a2ui_xml/decompiler.yaml':
    'the a2ui-xml format is an experimental Python agent inference format not implemented in TypeScript',
  'agent/a2ui_xml/prompt_generator.yaml':
    'the a2ui-xml format is an experimental Python agent inference format not implemented in TypeScript',
  'agent/a2ui_xml/response_parser.yaml':
    'the a2ui-xml format is an experimental Python agent inference format not implemented in TypeScript',
  'agent/a2ui_xml/response_streaming.yaml':
    'the a2ui-xml format is an experimental Python agent inference format not implemented in TypeScript',
  'agent/atom/compiler.yaml': 'Elemental and Atom are experimental and Python-only',
  'agent/builder/builder.yaml':
    'the fluent builder API is a Python-only helper not implemented in TypeScript',
  'agent/elemental/compiler.yaml': 'Elemental and Atom are experimental and Python-only',
  'agent/macros/macros.yaml':
    'the composite macro API is a Python-only helper not implemented in TypeScript',
  'agent/legacy/streaming_parser.yaml':
    'superseded by direct_json/response_streaming.yaml and express/response_streaming.yaml',
};

function discoverAgentSuites(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...discoverAgentSuites(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      results.push(relative(CONFORMANCE_ROOT, fullPath).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

for (const [suite, reason] of Object.entries(UNSUPPORTED_SUITES)) {
  describeSuite(`Conformance (skipped): ${suite}`, loadCases([conformancePath(suite)]), () => {}, {
    skipReason: () => reason,
  });
}

describe('conformance suite and manifest invariants', () => {
  test('accounts for every conformance/agent/**/*.yaml file', () => {
    const onDisk = new Set(discoverAgentSuites(conformancePath('agent')));
    const unsupported = new Set(Object.keys(UNSUPPORTED_SUITES));

    expect([...ACTIVE_SUITES].filter(s => PERFORMANCE_SUITES.has(s))).toEqual([]);
    expect([...ACTIVE_SUITES].filter(s => unsupported.has(s))).toEqual([]);
    expect([...PERFORMANCE_SUITES].filter(s => unsupported.has(s))).toEqual([]);

    const union = new Set([...ACTIVE_SUITES, ...PERFORMANCE_SUITES, ...unsupported]);
    expect([...union].sort()).toEqual([...onDisk].sort());
  });

  test('every KNOWN_FAILURES, SUPERSEDED, and UNSUPPORTED key matches a suite::case on disk', () => {
    const files = discoverAgentSuites(conformancePath('agent')).map(s => conformancePath(s));
    const allCases = loadCases(files);
    const validKeys = new Set(allCases.map(c => `${c.sourceFile}::${c.name}`));

    for (const [label, map] of [
      ['KNOWN_FAILURES', KNOWN_FAILURES],
      ['SUPERSEDED', SUPERSEDED],
      ['UNSUPPORTED', UNSUPPORTED],
    ] as const) {
      const stale = [...map.keys()].filter(k => !validKeys.has(k));
      expect(stale, `Stale keys in ${label}`).toEqual([]);
    }
  });

  test('recordCase trims reason and omits whitespace-only reasons', () => {
    const prevDir = process.env['A2UI_CONFORMANCE_MANIFEST_DIR'];
    const tempDir = mkdtempSync(join(tmpdir(), 'a2ui-ts-agent-manifest-'));
    try {
      process.env['A2UI_CONFORMANCE_MANIFEST_DIR'] = tempDir;
      recordCase('agent/sample.yaml', 'case_trimmed', 'skipped', '  padded reason \n');
      recordCase('agent/sample.yaml', 'case_blank', 'passed', '   ');

      const files = readdirSync(tempDir);
      expect(files.length).toBe(1);
      const lines = readFileSync(join(tempDir, files[0]), 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as Record<string, string>);
      expect(lines).toEqual([
        {
          harness: 'ts-agent',
          suite: 'agent/sample.yaml',
          case: 'case_trimmed',
          status: 'skipped',
          reason: 'padded reason',
        },
        {
          harness: 'ts-agent',
          suite: 'agent/sample.yaml',
          case: 'case_blank',
          status: 'passed',
        },
      ]);
    } finally {
      if (prevDir === undefined) {
        delete process.env['A2UI_CONFORMANCE_MANIFEST_DIR'];
      } else {
        process.env['A2UI_CONFORMANCE_MANIFEST_DIR'] = prevDir;
      }
      rmSync(tempDir, {recursive: true, force: true});
    }
  });

  test('setActiveCase isolates concurrent tasks via WeakMap and assertKnownKeys throws UnknownConformanceKeyError', () => {
    const taskA = {};
    const taskB = {};
    setActiveCase(taskA, {suite: 'agent/a.yaml', name: 'case_a'});
    setActiveCase(taskB, {suite: 'agent/b.yaml', name: 'case_b'});
    expect(getActiveCase(taskA)?.name).toBe('case_a');
    expect(getActiveCase(taskB)?.name).toBe('case_b');
    setActiveCase(taskA, undefined);
    expect(getActiveCase(taskA)).toBeUndefined();
    expect(getActiveCase(taskB)?.name).toBe('case_b');

    expect(() => assertKnownKeys({ok: 1, bogus: 2}, new Set(['ok']), 'test_case')).toThrow(
      UnknownConformanceKeyError,
    );
  });
});
