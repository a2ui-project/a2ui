/**
 * @license
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

import {CatalogConfig} from './catalog_config.js';
import {RendererCapabilities, AgentToRendererMessage} from '../internal/web_core.js';
import {InferenceFormatFactory} from '../inference_format/base.js';
import {A2uiRequestProcessor} from './processor.js';
import {resolveCatalogs} from '../utils/catalog_resolver.js';
import {DirectJsonFormatFactory} from '../inference_formats/direct_json/format.js';
import {A2uiCatalogError} from '../errors.js';

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
    private readonly examples?: Record<string, AgentToRendererMessage[]>,
    inferenceFormatFactory?: InferenceFormatFactory,
  ) {
    this.factory = inferenceFormatFactory || new DirectJsonFormatFactory();
  }

  /**
   * Creates a processor negotiated against one renderer's capabilities.
   *
   * Validates the configured examples against the resolved catalogs and throws if an
   * example uses a component the negotiated catalogs do not support.
   */
  createProcessor(
    rendererCapabilities: RendererCapabilities,
    inferenceFormatFactory?: InferenceFormatFactory,
  ): A2uiRequestProcessor {
    const activeCatalogs = resolveCatalogs(this.catalogs, rendererCapabilities);

    if (this.examples) {
      for (const msgs of Object.values(this.examples)) {
        for (const msg of msgs) {
          const components: {component?: string}[] = [];
          if ('createSurface' in msg && msg.createSurface?.components)
            components.push(...msg.createSurface.components);
          if ('updateComponents' in msg && msg.updateComponents?.components)
            components.push(...msg.updateComponents.components);

          for (const comp of components) {
            const compName = comp.component;
            if (compName) {
              const supported = activeCatalogs.some(cat => cat.components.has(compName));
              if (!supported) {
                throw new A2uiCatalogError(`Example uses unsupported component '${compName}'`);
              }
            }
          }
        }
      }
    }

    const formatFactory = inferenceFormatFactory || this.factory;
    return new A2uiRequestProcessor(activeCatalogs, this.examples, formatFactory);
  }
}
