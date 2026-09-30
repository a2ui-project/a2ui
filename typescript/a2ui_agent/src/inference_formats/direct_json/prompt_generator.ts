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

import {AgentToRendererMessage} from '../../internal/web_core.js';
import {
  A2UI_SCHEMA_BLOCK_END,
  A2UI_SCHEMA_BLOCK_START,
  DEFAULT_WORKFLOW_RULES,
} from '../../parser/constants.js';
import {PromptGenerator} from '../../prompt/generator.js';
import {SchemaCatalog} from '../../types.js';
import {messageJsonSchemas} from '../../utils/message-schemas.js';
import {toWireProtocolVersion} from '../../utils/protocol_version.js';
import {DirectJsonDecompiler} from './decompiler.js';

/**
 * Renders the Direct JSON prompt snippet: the payload rules, the message envelopes and
 * catalog schemas inside a schema block, and any examples inside `<a2ui-json>` tags.
 */
export class DirectJsonPromptGenerator extends PromptGenerator {
  private readonly decompiler = new DirectJsonDecompiler();

  /**
   * @param catalogs Active catalogs to describe.
   * @param examples Optional examples keyed by catalog id, either as messages or as
   *     preformatted text.
   * @param allowedMessages Optional allowlist of envelope names (`createSurface`,
   *     `updateComponents`, ...). Only these envelopes are described. Without it, every
   *     envelope of the catalogs' protocol versions is described.
   */
  constructor(
    catalogs: SchemaCatalog[],
    private readonly examples?: Record<string, AgentToRendererMessage[] | string>,
    private readonly allowedMessages?: readonly string[],
  ) {
    super(catalogs);
  }

  generateBaseRules(): string {
    return DEFAULT_WORKFLOW_RULES;
  }

  /**
   * The schema block: message envelopes once per protocol version, then each catalog.
   */
  override generateCatalogInstructions(catalog?: SchemaCatalog): string {
    const targets = catalog ? [catalog] : this.catalogs;
    const versions = [...new Set(targets.map(c => toWireProtocolVersion(c.protocolVersion)))];
    const sections = [
      A2UI_SCHEMA_BLOCK_START,
      ...versions.map(version => this.renderEnvelopes(version)),
      ...targets.map(c => this.renderCatalogInstructions(c)),
      A2UI_SCHEMA_BLOCK_END,
    ];
    return sections.join('\n\n');
  }

  protected renderCatalogInstructions(catalog: SchemaCatalog): string {
    const parts = [`### Catalog ${catalog.id}:`];
    if (catalog.instructions) {
      parts.push(catalog.instructions);
    }
    parts.push(JSON.stringify(catalog.catalogSchema));
    return parts.join('\n');
  }

  protected renderExamples(catalog: SchemaCatalog): string {
    const exampleMessages = this.examples?.[catalog.id];
    if (!exampleMessages) {
      return '';
    }
    // A string is preformatted example text and goes into the prompt as is, the way
    // Python's load_examples inserts the raw contents of each example file.
    if (typeof exampleMessages === 'string') {
      return exampleMessages;
    }
    const decompiled = this.decompiler.decompile(exampleMessages);
    return this.decompiler.wrap([{type: 'a2ui', a2uiRaw: decompiled, isFinal: true}]);
  }

  private renderEnvelopes(version: string): string {
    const all = messageJsonSchemas(version);
    const allowed = this.allowedMessages;
    const envelopes = Object.fromEntries(
      Object.entries(all).filter(([name]) => !allowed || allowed.includes(name)),
    );
    return `### Messages (${version}):\n${JSON.stringify(envelopes)}`;
  }
}
