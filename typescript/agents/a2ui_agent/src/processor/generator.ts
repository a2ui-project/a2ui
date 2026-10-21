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

import {A2uiCatalogError, A2uiValidationError} from '../errors.js';
import {InferenceFormatFactory} from '../inference-format.js';
import {ExpressFormatFactory} from '../inference-formats/express/format.js';
import {AgentToRendererMessage, RendererCapabilities} from '../internal/web-core.js';
import {resolveCatalogs} from '../utils/catalog-resolver.js';
import {validatePayload} from '../utils/validation.js';
import {CatalogConfig} from './catalog-config.js';
import {A2uiRequestProcessor, A2uiRequestProcessorOptions} from './processor.js';

/**
 * Agent-lifetime object holding every catalog the agent supports.
 *
 * Construct one at startup and keep it. Per request, ask it for a processor bound to
 * that caller's renderer capabilities.
 */
export class A2uiGenerator {
  private readonly factory: InferenceFormatFactory;

  constructor(
    private readonly catalogs: CatalogConfig[],
    private readonly examples?: Record<string, AgentToRendererMessage[] | string>,
    inferenceFormatFactory?: InferenceFormatFactory,
  ) {
    this.factory = inferenceFormatFactory || new ExpressFormatFactory();
  }

  /**
   * Creates a processor negotiated against one renderer's capabilities.
   *
   * Checks each configured example against the resolved catalogs, as `validatePayload`
   * does, and throws if a renderer holding them would reject it. Text examples are not
   * checked.
   *
   * @param rendererCapabilities The capabilities of the renderer the processor serves.
   * @param inferenceFormatFactory Overrides the generator's format for this processor.
   * @param options The renderer state a canvas agent keeps for the conversation, bound to
   *     the processor so that its `parseResponse` and `openStream` use it.
   * @throws {A2uiCatalogError} If `rendererCapabilities` is missing, since there is
   *     nothing to negotiate against, if negotiation leaves no catalog, or if
   *     `options.state` holds other catalogs than the negotiated ones.
   * @throws {A2uiValidationError} If the capabilities lack an entry for the catalogs'
   *     protocol version, if an example message is not an object, or if a renderer holding
   *     the negotiated catalogs would reject an example.
   */
  createProcessor(
    rendererCapabilities: Record<string, RendererCapabilities> | RendererCapabilities,
    inferenceFormatFactory?: InferenceFormatFactory,
    options: A2uiRequestProcessorOptions = {},
  ): A2uiRequestProcessor {
    if (!rendererCapabilities) {
      throw new A2uiCatalogError(
        'createProcessor requires renderer capabilities to negotiate against',
      );
    }
    const activeCatalogs = resolveCatalogs(this.catalogs, rendererCapabilities);

    if (this.examples) {
      for (const [exampleName, msgs] of Object.entries(this.examples)) {
        // Preformatted text examples are not parsed here.
        if (typeof msgs === 'string') continue;
        for (const msg of msgs) {
          if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
            throw new A2uiValidationError(
              `Example '${exampleName}' contains a message that is not an object`,
            );
          }
        }
        try {
          validatePayload(activeCatalogs, msgs);
        } catch (e) {
          if (!(e instanceof A2uiValidationError)) throw e;
          throw new A2uiValidationError(
            `Example '${exampleName}' is invalid for the negotiated catalogs: ${e.message}`,
            e.details,
          );
        }
      }
    }

    const formatFactory = inferenceFormatFactory || this.factory;
    return new A2uiRequestProcessor(activeCatalogs, this.examples, formatFactory, options);
  }
}
