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

import {loadCases} from './loader.js';
import {conformancePath, describeSuite} from './suite-helpers.js';

const UNSUPPORTED_SUITES: ReadonlyArray<{suite: string; reason: string}> = [
  {
    suite: 'agent/builder/builder.yaml',
    reason: 'the fluent builder API is a Python-only helper not implemented in TypeScript',
  },
  {
    suite: 'agent/macros/macros.yaml',
    reason: 'the composite macro API is a Python-only helper not implemented in TypeScript',
  },
  {
    suite: 'agent/elemental/compiler.yaml',
    reason: 'Elemental and Atom are experimental and Python-only',
  },
  {
    suite: 'agent/atom/compiler.yaml',
    reason: 'Elemental and Atom are experimental and Python-only',
  },
  {
    suite: 'agent/legacy/streaming_parser.yaml',
    reason: 'superseded by direct_json/response_streaming.yaml and express/response_streaming.yaml',
  },
  {
    suite: 'agent/direct_json/scaling.yaml',
    reason: 'timing suite runs separately under yarn test:timing',
  },
  {
    suite: 'agent/express/scaling.yaml',
    reason: 'timing suite runs separately under yarn test:timing',
  },
];

for (const {suite, reason} of UNSUPPORTED_SUITES) {
  describeSuite(`Conformance (skipped): ${suite}`, loadCases([conformancePath(suite)]), () => {}, {
    skipReason: () => reason,
  });
}
