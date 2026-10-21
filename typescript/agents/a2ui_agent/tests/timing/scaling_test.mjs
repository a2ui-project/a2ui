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

// Runs the timing suites of the agent SDK, conformance/agent/direct_json/scaling.yaml and
// conformance/agent/express/scaling.yaml. A case times streaming or compiling a payload
// written at two sizes, or streaming against compiling one payload, and compares the median
// times.
//
// Times depend on the machine and its load, so these cases are not part of `yarn test`. Run
// them with `yarn test:timing`, which runs this file alone.

import assert from 'node:assert/strict';
import * as path from 'node:path';
import {describe, it} from 'node:test';

// Test-only import of web_core's shared timing helper.
import {
  CONFORMANCE_DIR,
  loadConformanceSuite,
  measureGrowth,
  measureOverhead,
} from '../../../../core/web_core/tests/timing/timing.mjs';

import {
  DirectJsonFormatFactory,
  ExpressFormatFactory,
  FileSystemCatalogProvider,
  RendererState,
} from '../../dist/src/index.js';

const SUITES = ['agent/direct_json/scaling.yaml', 'agent/express/scaling.yaml'];

/** Builds the format a case names, before the timing starts. */
function makeFormat(args) {
  const catalogs = [new FileSystemCatalogProvider(path.join(CONFORMANCE_DIR, args.catalog)).load()];
  switch (args.format) {
    case 'direct_json':
      return {
        catalogs,
        format: new DirectJsonFormatFactory({
          progressiveKeys: args.progressive_keys ?? [],
        }).createFormat(catalogs),
      };
    case 'express':
      return {catalogs, format: new ExpressFormatFactory().createFormat(catalogs)};
    default:
      throw new Error(`Unknown format ${args.format}`);
  }
}

/**
 * The messages of an earlier response that created the surfaces a Direct JSON payload
 * updates without creating them.
 *
 * Such a case adds components to a surface an earlier response created, so each timed run
 * starts on a state that holds it: the surface, with a root `Column` that lists the
 * components the payload adds, so the tree check at the end of the block passes. An Express
 * payload is not JSON, and its cases create their surfaces.
 */
function earlierResponse(testCase, payload, catalogs) {
  if (testCase.args.format !== 'direct_json') return [];
  let messages = JSON.parse(payload);
  if (!Array.isArray(messages)) messages = [messages];
  const created = new Set();
  const earlier = new Map();
  for (const message of messages) {
    if (message.createSurface) created.add(message.createSurface.surfaceId);
    const body = message.updateComponents ?? message.updateDataModel;
    if (!body || created.has(body.surfaceId)) continue;
    if (!earlier.has(body.surfaceId))
      earlier.set(body.surfaceId, {version: message.version, ids: []});
    for (const component of body.components ?? [])
      earlier.get(body.surfaceId).ids.push(component.id);
  }
  return [...earlier].flatMap(([surfaceId, {version, ids}]) => [
    {version, createSurface: {surfaceId, catalogId: catalogs[0].id}},
    {
      version,
      updateComponents: {surfaceId, components: [{id: 'root', component: 'Column', children: ids}]},
    },
  ]);
}

/**
 * Returns the operation a case times on a payload.
 *
 * `parse_chunk` streams the response in chunks of `chunk_size` characters and closes the
 * stream. `compile` reads the payload whole with `parseResponse(payload, {wrapped: false})`,
 * which compiles the block and checks it against a new state, as compiling in the other SDKs
 * checks it.
 */
function prepare(testCase, setup, operation, payload) {
  const {format, catalogs} = setup;
  const earlier = earlierResponse(testCase, payload, catalogs);
  const newState = () => {
    const state = new RendererState(catalogs);
    if (earlier.length > 0) state.apply(earlier);
    return state;
  };
  switch (operation) {
    case 'parse_chunk': {
      const response = `<a2ui-json>${payload}</a2ui-json>`;
      const chunks = [];
      for (let i = 0; i < response.length; i += testCase.chunk_size) {
        chunks.push(response.slice(i, i + testCase.chunk_size));
      }
      return () => {
        const stream = format.createParser().openStream({state: newState()});
        for (const chunk of chunks) stream.feed(chunk);
        stream.close();
      };
    }
    case 'compile':
      return () =>
        format.createParser().parseResponse(payload, {wrapped: false, state: newState()});
    default:
      throw new Error(`Unknown operation ${operation}`);
  }
}

function runCase(testCase) {
  const setup = makeFormat(testCase.args);
  switch (testCase.action) {
    case 'measure_growth': {
      const result = measureGrowth(testCase, payload =>
        prepare(testCase, setup, testCase.operation, payload),
      );
      const [smaller, larger] = result.sizes;
      const [smallerMs, largerMs] = result.medianMs;
      console.log(
        `${testCase.name}: ${smallerMs.toFixed(2)} ms at ${smaller}, ` +
          `${largerMs.toFixed(2)} ms at ${larger}, ratio ${result.ratio.toFixed(2)}`,
      );
      return;
    }
    case 'measure_overhead': {
      const result = measureOverhead(
        testCase,
        payload => prepare(testCase, setup, testCase.operation, payload),
        payload => prepare(testCase, setup, testCase.baseline, payload),
      );
      const [baselineMs, measuredMs] = result.medianMs;
      console.log(
        `${testCase.name}: ${testCase.operation} ${measuredMs.toFixed(2)} ms, ` +
          `${testCase.baseline} ${baselineMs.toFixed(2)} ms, ratio ${result.ratio.toFixed(2)}`,
      );
      return;
    }
    default:
      throw new Error(`Unknown action ${testCase.action}`);
  }
}

for (const suite of SUITES) {
  describe(`conformance ${suite}`, () => {
    const cases = loadConformanceSuite(suite);

    it('suite is not empty', () => {
      assert.ok(cases.length > 0);
    });

    for (const testCase of cases) {
      it(testCase.name, () => runCase(testCase));
    }
  });
}
