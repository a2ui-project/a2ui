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

import {A2uiCatalogError} from '../../errors.js';
import {
  AgentToRendererMessage,
  CatalogApi,
  normalizeVersionString,
} from '../../internal/web-core.js';
import {
  A2UI_SCHEMA_BLOCK_END,
  A2UI_SCHEMA_BLOCK_START,
  DEFAULT_WORKFLOW_RULES,
} from '../../parser/constants.js';
import {PromptGenerator} from '../../prompt/generator.js';
import {
  loadAgentToRendererSchema,
  loadCommonTypesSchema,
  pruneCommonTypesSchema,
  pruneMessagesSchema,
} from '../../utils/message-schemas.js';
import {DirectJsonDecompiler} from './decompiler.js';

export type DirectJsonExamples =
  | Record<string, AgentToRendererMessage[] | string>
  | ReadonlyArray<AgentToRendererMessage[] | string>;

/**
 * Renders the Direct JSON prompt snippet: the payload rules, the protocol and
 * catalog schemas inside a schema block, and any examples inside `<a2ui-json>` tags.
 */
export class DirectJsonPromptGenerator extends PromptGenerator {
  private readonly decompiler = new DirectJsonDecompiler();

  /**
   * @param catalogs Active catalogs to describe.
   * @param examples Optional examples keyed by catalog id or provided as an ordered list
   *     of turns, either as messages or as preformatted text.
   * @param allowedMessages Optional allowlist of message names (`createSurface`,
   *     `updateComponents`, ...). Only these messages are described. Without it, every
   *     message of the catalogs' protocol version is described.
   */
  constructor(
    catalogs: CatalogApi[],
    private readonly examples?: DirectJsonExamples,
    private readonly allowedMessages?: readonly string[],
  ) {
    super(catalogs);
    const versions = new Set(catalogs.map(c => normalizeVersionString(c.protocolVersion ?? '0.9')));
    if (versions.size > 1) {
      throw new A2uiCatalogError(
        `The schema prompt's catalogs target different protocol versions: ${[...versions].sort().join(', ')}.`,
      );
    }
  }

  generateBaseRules(): string {
    return DEFAULT_WORKFLOW_RULES;
  }

  /**
   * The schema block: agent-to-renderer schema, pruned common types schema, then each
   * catalog's serialized JSON document (`catalog.toJson()`).
   */
  override generateCatalogInstructions(catalog?: CatalogApi): string {
    const targets = catalog ? [catalog] : this.catalogs;
    if (targets.length === 0) {
      throw new A2uiCatalogError('The schema prompt needs at least one catalog.');
    }
    const versions = new Set(targets.map(c => normalizeVersionString(c.protocolVersion ?? '0.9')));
    if (versions.size > 1) {
      throw new A2uiCatalogError(
        `The schema prompt's catalogs target different protocol versions: ${[...versions].sort().join(', ')}.`,
      );
    }

    const version = targets[0].protocolVersion ?? '0.9';
    let a2rSchema = loadAgentToRendererSchema(version);
    if (this.allowedMessages !== undefined) {
      a2rSchema = pruneMessagesSchema(a2rSchema, version, this.allowedMessages);
    }

    const catalogDocs = targets.map(c => c.toJson());
    const commonTypesSchema = pruneCommonTypesSchema(
      loadCommonTypesSchema(version),
      ...catalogDocs,
      a2rSchema,
    );

    const sections = [
      A2UI_SCHEMA_BLOCK_START,
      `### Agent to Renderer Schema:\n${JSON.stringify(a2rSchema)}`,
    ];

    const commonDefs = commonTypesSchema.$defs;
    if (
      typeof commonDefs === 'object' &&
      commonDefs !== null &&
      Object.keys(commonDefs).length > 0
    ) {
      sections.push(`### Common Types Schema:\n${JSON.stringify(commonTypesSchema)}`);
    }

    for (const catalogDoc of catalogDocs) {
      sections.push(`### Catalog Schema:\n${JSON.stringify(catalogDoc)}`);
    }

    sections.push(A2UI_SCHEMA_BLOCK_END);
    return sections.join('\n\n');
  }

  protected renderCatalogInstructions(catalog: CatalogApi): string {
    return `### Catalog Schema:\n${JSON.stringify(catalog.toJson())}`;
  }

  private isTurnArray(
    examples: DirectJsonExamples,
  ): examples is ReadonlyArray<AgentToRendererMessage[] | string> {
    return Array.isArray(examples);
  }

  override generateExamples(catalog?: CatalogApi): string {
    if (!this.examples) {
      return '';
    }
    if (catalog) {
      return this.renderExamples(catalog);
    }
    const turns = this.isTurnArray(this.examples) ? this.examples : Object.values(this.examples);
    return turns
      .map(turn => this.renderExampleTurn(turn))
      .filter(s => s.length > 0)
      .join('\n\n');
  }

  protected renderExamples(catalog: CatalogApi): string {
    if (!this.examples || this.isTurnArray(this.examples)) {
      return '';
    }
    const exampleMessages = this.examples[catalog.id];
    if (!exampleMessages) {
      return '';
    }
    return this.renderExampleTurn(exampleMessages);
  }

  private renderExampleTurn(exampleMessages: AgentToRendererMessage[] | string): string {
    // A string is preformatted example text and goes into the prompt as is, the way
    // Python's load_examples inserts the raw contents of each example file.
    if (typeof exampleMessages === 'string') {
      return exampleMessages;
    }
    const decompiled = this.decompiler.decompile(exampleMessages);
    return this.decompiler.wrap([{type: 'a2ui', a2uiRaw: decompiled, isFinal: true}]);
  }

  override generate(): string {
    const parts = [
      `## Workflow Description:\n${this.generateBaseRules()}`,
      this.generateCatalogInstructions(),
    ];
    const examplesStr = this.generateExamples();
    if (examplesStr.length > 0) {
      parts.push(`### Examples:\n${examplesStr}`);
    }
    return parts.join('\n\n');
  }
}
