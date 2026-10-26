// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Runs the timing cases of conformance/core/message_processor_scaling.yaml,
// which time `MessageProcessor.processMessages` on a payload written at two
// sizes and compare the median times.
//
// Times depend on the machine and its load, so these cases are not part of
// `yarn test`. Run them with `yarn test:timing`, which runs this file alone.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {loadConformanceSuite, measureGrowth, readRepositoryJson} from './timing.mjs';

import {Catalog, MessageProcessor, RELAXED_VALIDATION} from '../../dist/src/index.js';

const SUITE = 'core/message_processor_scaling.yaml';

/** The validation configs a case's `args.validation_config` names. */
const VALIDATION_CONFIGS = {
  none: undefined,
  relaxed: RELAXED_VALIDATION,
};

function runCase(testCase) {
  assert.equal(testCase.operation, 'process_messages');
  const catalogs = testCase.catalogPaths.map(catalogPath =>
    Catalog.fromJson(readRepositoryJson(catalogPath), testCase.protocolVersion),
  );
  const configName = testCase.args.validation_config;
  assert.ok(configName in VALIDATION_CONFIGS, `Unknown validation config ${configName}`);
  const validationConfig = VALIDATION_CONFIGS[configName];

  const result = measureGrowth(testCase, payload => {
    const messages = JSON.parse(payload);
    return () =>
      new MessageProcessor(catalogs, undefined, {validationConfig}).processMessages(messages);
  });
  const [smaller, larger] = result.sizes;
  const [smallerMs, largerMs] = result.medianMs;
  console.log(
    `${testCase.name}: ${smallerMs.toFixed(2)} ms at ${smaller}, ` +
      `${largerMs.toFixed(2)} ms at ${larger}, ratio ${result.ratio.toFixed(2)}`,
  );
}

describe(`conformance ${SUITE}`, () => {
  const cases = loadConformanceSuite(SUITE);

  it('suite is not empty', () => {
    assert.ok(cases.length > 0);
  });

  for (const testCase of cases) {
    it(testCase.name, () => runCase(testCase));
  }
});
