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

import {A2uiCatalogError} from '../errors.js';
import {CatalogApi} from '../internal/web_core.js';

/**
 * Abstract base class for format-specific prompt generation.
 *
 * A generator renders the snippet of system prompt that tells the model how to write A2UI
 * for the active catalogs: the format's rules, the catalog schemas, and any examples. The
 * rest of the system prompt, such as the agent's role and workflow, belongs to the agent
 * developer, who places the snippet wherever it fits.
 */
export abstract class PromptGenerator {
  /**
   * Initializes a new PromptGenerator instance.
   *
   * @param catalogs Active catalogs to render instructions for.
   * @throws {A2uiCatalogError} If no catalog is given, since the model would then have
   *     nothing it could be told to write.
   */
  constructor(public readonly catalogs: CatalogApi[]) {
    if (catalogs.length === 0) {
      throw new A2uiCatalogError('A prompt snippet needs at least one active catalog.');
    }
  }

  /**
   * Catalog-agnostic syntax contracts, grammar, and sentinel tags.
   */
  abstract generateBaseRules(): string;

  /**
   * Signatures for one catalog, or for all active catalogs.
   */
  generateCatalogInstructions(catalog?: CatalogApi): string {
    const targets = catalog ? [catalog] : this.catalogs;
    return targets
      .map(c => this.renderCatalogInstructions(c))
      .filter(s => s.length > 0)
      .join('\n\n');
  }

  /**
   * Few-shot examples for one catalog, or for all active catalogs.
   */
  generateExamples(catalog?: CatalogApi): string {
    const targets = catalog ? [catalog] : this.catalogs;
    return targets
      .map(c => this.renderExamples(c))
      .filter(s => s.length > 0)
      .join('\n\n');
  }

  /** Format-specific rendering for a single catalog's instructions. */
  protected abstract renderCatalogInstructions(catalog: CatalogApi): string;

  /** Format-specific rendering for a single catalog's examples. */
  protected abstract renderExamples(catalog: CatalogApi): string;

  /**
   * Renders the prompt snippet: base rules, catalog instructions, and examples.
   *
   * Formats override the pieces, never this method.
   */
  generate(): string {
    return [this.generateBaseRules(), this.generateCatalogInstructions(), this.generateExamples()]
      .filter(s => s.length > 0)
      .join('\n\n');
  }
}
