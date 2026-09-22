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

import {SchemaCatalog} from '../types.js';

/** Options for assembling a complete system prompt. */
export interface PromptOptions {
  roleDescription?: string;
  workflowDescription?: string;
  uiDescription?: string;
  includeSchema?: boolean;
  includeExamples?: boolean;
  validateExamples?: boolean;
}

/**
 * Abstract base class for format-specific prompt generation.
 */
export abstract class PromptGenerator {
  /**
   * Initializes a new PromptGenerator instance.
   *
   * @param catalogs Bound schema catalogs to render instructions for.
   */
  constructor(public readonly catalogs: SchemaCatalog[]) {}

  /**
   * Catalog-agnostic syntax contracts, grammar, and sentinel tags.
   */
  abstract generateBaseRules(): string;

  /**
   * Signatures for one catalog, or for all bound catalogs.
   */
  generateCatalogInstructions(includeSchema = true, catalog?: SchemaCatalog): string {
    const targets = catalog ? [catalog] : this.catalogs;
    return targets
      .map(c => this.renderCatalogInstructions(c, includeSchema))
      .filter(s => s.length > 0)
      .join('\n\n');
  }

  /**
   * Few-shot examples for one catalog, or for all bound catalogs.
   */
  generateExamples(catalog?: SchemaCatalog, validate = false): string {
    const targets = catalog ? [catalog] : this.catalogs;
    return targets
      .map(c => this.renderExamples(c, validate))
      .filter(s => s.length > 0)
      .join('\n\n');
  }

  /** Format-specific rendering for a single catalog's instructions. */
  protected abstract renderCatalogInstructions(
    catalog: SchemaCatalog,
    includeSchema: boolean,
  ): string;

  /** Format-specific rendering for a single catalog's examples. */
  protected abstract renderExamples(catalog: SchemaCatalog, validate: boolean): string;

  /**
   * Template method assembling the complete prompt.
   *
   * Composes role, workflow, and UI descriptions with format-specific
   * base rules, catalog instructions, and examples.
   * Formats override the pieces, never this method.
   *
   * @param options Configures what sections are included in the prompt.
   */
  generate(options?: PromptOptions): string {
    const opts = {
      includeSchema: true,
      includeExamples: false,
      validateExamples: false,
      ...options,
    };

    const parts: string[] = [];

    if (opts.roleDescription) {
      parts.push(opts.roleDescription);
    }
    if (opts.workflowDescription) {
      parts.push(opts.workflowDescription);
    }
    if (opts.uiDescription) {
      parts.push(opts.uiDescription);
    }

    parts.push(this.generateBaseRules());
    parts.push(this.generateCatalogInstructions(opts.includeSchema));

    if (opts.includeExamples) {
      const examples = this.generateExamples(undefined, opts.validateExamples);
      if (examples) {
        parts.push(examples);
      }
    }

    return parts.join('\n\n');
  }
}
