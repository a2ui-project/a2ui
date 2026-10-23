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
  inlinePeerAndLocalRefs,
  linkCatalogs,
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
import {checkParserCatalogs} from '../../utils/catalog-checks.js';
import {DirectJsonDecompiler} from './decompiler.js';

export type DirectJsonExamples =
  | Record<string, AgentToRendererMessage[] | string>
  | ReadonlyArray<AgentToRendererMessage[] | string>;

/**
 * Renders the Direct JSON prompt snippet: the payload rules, a schema block with the
 * protocol schemas, one schema block per catalog, and any examples inside `<a2ui-json>` tags.
 */
export class DirectJsonPromptGenerator extends PromptGenerator {
  private readonly decompiler = new DirectJsonDecompiler();

  /**
   * @param catalogs Active catalogs to describe. The generator describes copies of them
   *     linked to each other, so cross-catalog `$ref`s resolve; they are not changed.
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
    super(linkCatalogs(catalogs));
    checkParserCatalogs(catalogs);
  }

  /**
   * The payload rules, then a schema block with the protocol schemas: the agent-to-renderer
   * schema and the common types schema pruned to what the active catalogs and that schema
   * use. The protocol schemas live here rather than in the catalog instructions, so output
   * that combines several catalogs' instructions holds them once.
   */
  override generateBaseRules(): string {
    const targets = this.catalogs;
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
    const peerResolvedDocs = targets.map(c => {
      const doc = c.toJson();
      const peers = c.peerCatalogs ?? [];
      return peers.length > 0
        ? (inlinePeerAndLocalRefs(doc, doc, peers) as Record<string, unknown>)
        : doc;
    });
    const commonTypesSchema = pruneCommonTypesSchema(
      loadCommonTypesSchema(version),
      ...catalogDocs,
      ...peerResolvedDocs,
      a2rSchema,
    );

    const sections = [`### Agent to Renderer Schema:\n${JSON.stringify(a2rSchema)}`];

    const commonDefs = commonTypesSchema.$defs;
    if (
      typeof commonDefs === 'object' &&
      commonDefs !== null &&
      Object.keys(commonDefs).length > 0
    ) {
      sections.push(`### Common Types Schema:\n${JSON.stringify(commonTypesSchema)}`);
    }

    return `${DEFAULT_WORKFLOW_RULES}\n\n${schemaBlock(sections)}`;
  }

  /** A schema block holding one catalog's serialized JSON document (`catalog.toJson()`). */
  protected override renderCatalogInstructions(catalog: CatalogApi): string {
    return schemaBlock([`### Catalog Schema:\n${JSON.stringify(catalog.toJson())}`]);
  }

  private isTurnArray(
    examples: DirectJsonExamples,
  ): examples is ReadonlyArray<AgentToRendererMessage[] | string> {
    return Array.isArray(examples);
  }

  /**
   * Renders the examples.
   *
   * Examples keyed by catalog id are filtered to `catalog` when it is given. An ordered
   * list of turns is not tied to a catalog, so every turn is rendered either way, as in
   * Python's `DirectJsonPromptGenerator.generate_examples`.
   */
  override generateExamples(catalog?: CatalogApi): string {
    if (!this.examples) {
      return '';
    }
    if (catalog && !this.isTurnArray(this.examples)) {
      return this.renderExamples(catalog);
    }
    const turns = this.isTurnArray(this.examples) ? this.examples : Object.values(this.examples);
    return this.renderTurns(turns);
  }

  protected renderExamples(catalog: CatalogApi): string {
    if (!this.examples) {
      return '';
    }
    if (this.isTurnArray(this.examples)) {
      return this.renderTurns(this.examples);
    }
    const exampleMessages = this.examples[catalog.id];
    if (!exampleMessages) {
      return '';
    }
    return this.renderExampleTurn(exampleMessages);
  }

  private renderTurns(turns: ReadonlyArray<AgentToRendererMessage[] | string>): string {
    return turns
      .map(turn => this.renderExampleTurn(turn))
      .filter(s => s.length > 0)
      .join('\n\n');
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
}

/** Wraps sections between the schema block start and end lines. */
function schemaBlock(sections: readonly string[]): string {
  return [A2UI_SCHEMA_BLOCK_START, ...sections, A2UI_SCHEMA_BLOCK_END].join('\n\n');
}
