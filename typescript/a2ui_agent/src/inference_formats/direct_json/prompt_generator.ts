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

import {PromptGenerator} from '../../prompt/generator.js';
import {SchemaCatalog} from '../../types.js';
import {
  A2UI_SCHEMA_BLOCK_START,
  A2UI_SCHEMA_BLOCK_END,
  DEFAULT_WORKFLOW_RULES,
} from '../../parser/constants.js';
import {AgentToRendererMessage} from '../../internal/web_core.js';
import {DirectJsonDecompiler} from './decompiler.js';

export class DirectJsonPromptGenerator extends PromptGenerator {
  private readonly examples?: Record<string, AgentToRendererMessage[]>;
  private readonly decompiler: DirectJsonDecompiler;

  constructor(catalogs: SchemaCatalog[], examples?: Record<string, AgentToRendererMessage[]>) {
    super(catalogs);
    this.examples = examples;
    this.decompiler = new DirectJsonDecompiler();
  }

  generateBaseRules(): string {
    return DEFAULT_WORKFLOW_RULES;
  }

  protected renderCatalogInstructions(catalog: SchemaCatalog, includeSchema: boolean): string {
    if (!includeSchema) {
      return '';
    }

    const instructions = catalog.instructions || '';
    const prefix = instructions ? `${instructions}\n\n` : '';

    const schemaJson = JSON.stringify(catalog.catalogSchema, null, 2);

    return `${prefix}${A2UI_SCHEMA_BLOCK_START}\n${schemaJson}\n${A2UI_SCHEMA_BLOCK_END}`;
  }

  protected renderExamples(catalog: SchemaCatalog, _validate: boolean): string {
    if (!this.examples || !this.examples[catalog.id]) {
      return '';
    }

    const exampleMessages = this.examples[catalog.id];

    const decompiled = this.decompiler.decompile(exampleMessages);
    return this.decompiler.wrap([{type: 'a2ui', a2uiRaw: decompiled, isFinal: true}]);
  }
}
