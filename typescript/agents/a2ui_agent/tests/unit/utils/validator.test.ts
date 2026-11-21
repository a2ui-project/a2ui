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

import {A2uiConfigurationError, NO_VALIDATOR_MESSAGE} from '@a2ui/web_core/errors';
import {describe, expect, it} from 'vitest';

import {
  A2uiGenerator,
  A2uiRequestProcessor,
  CatalogConfig,
  DirectJsonFormat,
  DirectJsonParser,
  ExpressFormat,
  ExpressParser,
  InMemoryCatalogProvider,
  type JsonSchemaValidator,
  readRendererCapabilities,
  RendererState,
  RendererToAgentMessageProcessor,
  resolveCatalogs,
  validatePayload,
} from '../../../src/index.js';
import {loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const BASIC = loadBasicCatalog('1.0');
const none = undefined as unknown as JsonSchemaValidator;

describe('the JSON Schema validator', () => {
  it.each<[string, () => unknown]>([
    ['RendererState', () => new RendererState([BASIC], none)],
    ['validatePayload', () => validatePayload([BASIC], none, [])],
    ['DirectJsonParser', () => new DirectJsonParser([BASIC], none)],
    ['ExpressParser', () => new ExpressParser([BASIC], none)],
    ['DirectJsonFormat', () => new DirectJsonFormat([BASIC], none)],
    ['ExpressFormat', () => new ExpressFormat([BASIC], none)],
    ['A2uiRequestProcessor', () => new A2uiRequestProcessor([BASIC], none)],
    ['A2uiGenerator', () => new A2uiGenerator([new CatalogConfig(BASIC)], none)],
    ['InMemoryCatalogProvider', () => new InMemoryCatalogProvider({}, none, '1.0', 'c').load()],
    [
      'RendererToAgentMessageProcessor',
      () => new RendererToAgentMessageProcessor({catalogs: [], validator: none}),
    ],
    [
      'resolveCatalogs with an accepted inline catalog',
      () =>
        resolveCatalogs(
          [new CatalogConfig(BASIC)],
          none,
          {
            '1.0': {
              supportedCatalogIds: [],
              inlineCatalogs: [{catalogId: 'c', protocolVersion: '1.0', components: {}}],
            },
          },
          true,
        ),
    ],
    [
      'readRendererCapabilities with an inline catalog',
      () =>
        readRendererCapabilities(
          {
            a2uiRendererCapabilities: {
              '1.0': {
                supportedCatalogIds: [],
                inlineCatalogs: [{catalogId: 'c', protocolVersion: '1.0', components: {}}],
              },
            },
          },
          none,
        ),
    ],
  ])('is required by %s', (_, make) => {
    expect(make).toThrow(A2uiConfigurationError);
    expect(make).toThrow(NO_VALIDATOR_MESSAGE);
  });
});
