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

/**
 * SkillGenerator for compiling InferenceFormat and Catalog into Skill and SkillSet packages.
 */

import {A2uiCatalogError} from '../errors.js';
import {InferenceFormat} from '../inference-format.js';
import {CatalogApi} from '../internal/web-core.js';
import {cleanCatalogName, resolveCatalogsList, Skill, SkillSet} from './skill.js';

export interface GenerateSkillOptions {
  /** Skill name. Defaults to `a2ui`. */
  name?: string;
  /** LLM-facing description. Defaults to a generic one. */
  description?: string;
  /** Catalogs to compile. Defaults to the catalogs bound to the format. */
  catalogs?: readonly CatalogApi[];
}

export interface GenerateCatalogSkillOptions {
  /** Catalog to compile. Defaults to the first catalog bound to the format. */
  catalog?: CatalogApi;
  /** Skill name. Defaults to `a2ui-<catalog name>`. */
  name?: string;
  /** LLM-facing description. Defaults to one derived from the catalog name. */
  description?: string;
  /** Whether to append the catalog's examples. Defaults to `true`. */
  includeExamples?: boolean;
}

export interface GenerateCoreSkillOptions {
  /** Skill name. Defaults to `a2ui-core`. */
  name?: string;
  /** LLM-facing description. Defaults to a generic one. */
  description?: string;
}

export interface GenerateSkillSetOptions {
  /** Catalogs to compile, one skill each. Defaults to the catalogs bound to the format. */
  catalogs?: readonly CatalogApi[];
  /** Name of the core syntax skill. Defaults to `a2ui-core`. */
  coreName?: string;
}

/**
 * Compiles InferenceFormat rules and Catalog instances into Skill and SkillSet packages.
 */
export class SkillGenerator {
  constructor(public readonly fmt: InferenceFormat) {}

  /**
   * Compiles an InferenceFormat into a single unified (monolithic) Skill.
   *
   * If `catalogs` is not specified, defaults to the catalogs configured on the inference format.
   */
  generateSkill(options: GenerateSkillOptions = {}): Skill {
    const resolvedName = options.name ?? 'a2ui';
    const resolvedCatalogs = resolveCatalogsList(options.catalogs, this.fmt);
    const promptGen = this.fmt.promptGenerator;

    const baseRules = promptGen.generateBaseRules();

    const catBlocks: string[] = [];
    const exBlocks: string[] = [];
    for (const c of resolvedCatalogs) {
      const inst = promptGen.generateCatalogInstructions(c);
      if (inst) {
        catBlocks.push(inst);
      }
      const ex = promptGen.generateExamples(c);
      // A format whose examples aren't kept per catalog returns the same
      // examples for each catalog, so they're added once.
      if (ex && !exBlocks.includes(ex)) {
        exBlocks.push(ex);
      }
    }

    const bodyParts: string[] = [];
    if (baseRules) {
      bodyParts.push(baseRules);
    }
    if (catBlocks.length > 0) {
      bodyParts.push(...catBlocks);
    }
    if (exBlocks.length > 0) {
      bodyParts.push('### Examples:\n\n' + exBlocks.join('\n\n'));
    }

    const contentStr = bodyParts.join('\n\n') + '\n';
    const desc =
      options.description || 'Generates interactive user interface components for user requests.';

    return new Skill({
      name: resolvedName,
      description: desc,
      content: contentStr,
      filename: `${resolvedName}/SKILL.md`,
    });
  }

  /**
   * Compiles a single catalog into a dedicated catalog Skill.
   *
   * If `catalog` is not specified, defaults to the first catalog configured on the inference
   * format.
   *
   * @throws {A2uiCatalogError} If no catalog is given and the format has none.
   */
  generateCatalogSkill(options: GenerateCatalogSkillOptions = {}): Skill {
    let targetCatalog = options.catalog;
    if (targetCatalog === undefined) {
      const formatCatalogs = resolveCatalogsList(undefined, this.fmt);
      if (formatCatalogs.length === 0) {
        throw new A2uiCatalogError(
          'No catalog provided or configured on the inference format to compile catalog skill.',
        );
      }
      targetCatalog = formatCatalogs[0];
    }

    const includeExamples = options.includeExamples ?? true;
    const examples = includeExamples
      ? (this.fmt.promptGenerator.generateExamples(targetCatalog) ?? '')
      : '';
    return this.buildCatalogSkill(targetCatalog, examples, options.name, options.description);
  }

  private buildCatalogSkill(
    catalog: CatalogApi,
    examples: string,
    name?: string,
    description?: string,
  ): Skill {
    const cleanName = cleanCatalogName(catalog);
    const skillName = name || `a2ui-${cleanName}`;

    let catBody = this.fmt.promptGenerator.generateCatalogInstructions(catalog) || '';
    if (examples) {
      catBody += `\n\n### Examples:\n\n${examples}`;
    }

    // The catalog document's own `description` describes the catalog, not
    // when to use the skill, so it is not used here.
    const desc =
      description ||
      `UI component catalog signatures for ${cleanName}. Use when building ${cleanName} user interface components.`;

    return new Skill({
      name: skillName,
      description: desc,
      content: catBody.trim() + '\n',
      filename: `${skillName}/SKILL.md`,
    });
  }

  /**
   * Compiles core syntax rules for an inference format into a base core skill.
   */
  generateCoreSkill(options: GenerateCoreSkillOptions = {}): Skill {
    const resolvedName = options.name ?? 'a2ui-core';
    const baseRules = this.fmt.promptGenerator.generateBaseRules() || '';
    const desc =
      options.description || 'Core A2UI protocol instructions and syntax rules for UI generation.';

    return new Skill({
      name: resolvedName,
      description: desc,
      content: baseRules.trim() + '\n',
      filename: `${resolvedName}/SKILL.md`,
    });
  }

  /**
   * Generates standard modular skills (`a2ui-core` + 1 skill per catalog) for an inference format.
   *
   * If `catalogs` is not specified, defaults to the catalogs configured on the inference format.
   */
  generateSkillSet(options: GenerateSkillSetOptions = {}): SkillSet {
    const skillSet = new SkillSet();

    // 1. Core Syntax Skill
    skillSet.add(this.generateCoreSkill({name: options.coreName ?? 'a2ui-core'}));

    // 2. Per-Catalog Skills
    // A format whose examples aren't kept per catalog returns the same
    // examples for each catalog, so only the first catalog skill gets them.
    const resolvedCatalogs = resolveCatalogsList(options.catalogs, this.fmt);
    const promptGen = this.fmt.promptGenerator;
    const seenExamples = new Set<string>();
    for (const cat of resolvedCatalogs) {
      const examples = promptGen.generateExamples(cat) ?? '';
      skillSet.add(this.buildCatalogSkill(cat, seenExamples.has(examples) ? '' : examples));
      seenExamples.add(examples);
    }

    return skillSet;
  }
}
