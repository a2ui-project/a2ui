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

import {InferenceFormat} from '../inference-format.js';
import {CatalogApi} from '../internal/web-core.js';
import {cleanCatalogName, resolveCatalogsList, Skill, SkillSet} from './skill.js';

export interface GenerateSkillOptions {
  name?: string;
  description?: string;
  catalogs?: readonly CatalogApi[];
}

export interface GenerateCatalogSkillOptions {
  catalog?: CatalogApi;
  name?: string;
  description?: string;
  includeExamples?: boolean;
}

export interface GenerateCoreSkillOptions {
  name?: string;
  description?: string;
}

export interface GenerateSkillSetOptions {
  catalogs?: readonly CatalogApi[];
  coreName?: string;
}

function isCatalogApi(value: unknown): value is CatalogApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('id' in value || 'components' in value || 'catalogId' in value || 'catalog_id' in value)
  );
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
  generateSkill(
    nameOrOptions?: string | GenerateSkillOptions,
    description?: string,
    catalogs?: readonly CatalogApi[],
  ): Skill {
    let resolvedName = 'a2ui';
    let resolvedDesc = description;
    let explicitCatalogs = catalogs;

    if (typeof nameOrOptions === 'object' && nameOrOptions !== null) {
      resolvedName = nameOrOptions.name ?? 'a2ui';
      resolvedDesc = nameOrOptions.description;
      explicitCatalogs = nameOrOptions.catalogs;
    } else if (typeof nameOrOptions === 'string') {
      resolvedName = nameOrOptions;
    }

    const resolvedCatalogs = resolveCatalogsList(explicitCatalogs, this.fmt);
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
      resolvedDesc || 'Generates interactive user interface components for user requests.';

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
   * If `catalog` is not specified, defaults to the catalog configured on the inference format.
   */
  generateCatalogSkill(
    catalogOrOptions?: CatalogApi | GenerateCatalogSkillOptions,
    name?: string,
    description?: string,
    includeExamples = true,
  ): Skill {
    let targetCatalog: CatalogApi | undefined;
    let resolvedName = name;
    let resolvedDesc = description;
    let shouldIncludeExamples = includeExamples;

    if (catalogOrOptions !== undefined) {
      if (isCatalogApi(catalogOrOptions)) {
        targetCatalog = catalogOrOptions;
      } else {
        targetCatalog = catalogOrOptions.catalog;
        resolvedName = catalogOrOptions.name ?? name;
        resolvedDesc = catalogOrOptions.description ?? description;
        shouldIncludeExamples = catalogOrOptions.includeExamples ?? includeExamples;
      }
    }

    if (targetCatalog === undefined) {
      const formatCatalogs = resolveCatalogsList(undefined, this.fmt);
      if (formatCatalogs.length > 0) {
        targetCatalog = formatCatalogs[0];
      } else {
        throw new Error(
          'No catalog provided or configured on the inference format to compile catalog skill.',
        );
      }
    }

    const examples = shouldIncludeExamples
      ? (this.fmt.promptGenerator.generateExamples(targetCatalog) ?? '')
      : '';
    return this.buildCatalogSkill(targetCatalog, examples, resolvedName, resolvedDesc);
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
  generateCoreSkill(
    nameOrOptions?: string | GenerateCoreSkillOptions,
    description?: string,
  ): Skill {
    let resolvedName = 'a2ui-core';
    let resolvedDesc = description;
    if (typeof nameOrOptions === 'object' && nameOrOptions !== null) {
      resolvedName = nameOrOptions.name ?? 'a2ui-core';
      resolvedDesc = nameOrOptions.description;
    } else if (typeof nameOrOptions === 'string') {
      resolvedName = nameOrOptions;
    }

    const baseRules = this.fmt.promptGenerator.generateBaseRules() || '';
    const desc =
      resolvedDesc || 'Core A2UI protocol instructions and syntax rules for UI generation.';

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
  generateSkillset(
    catalogsOrOptions?: readonly CatalogApi[] | GenerateSkillSetOptions,
    coreName = 'a2ui-core',
  ): SkillSet {
    let explicitCatalogs: readonly CatalogApi[] | undefined;
    let resolvedCoreName = coreName;

    if (Array.isArray(catalogsOrOptions)) {
      explicitCatalogs = catalogsOrOptions;
    } else if (typeof catalogsOrOptions === 'object' && catalogsOrOptions !== null) {
      explicitCatalogs = (catalogsOrOptions as GenerateSkillSetOptions).catalogs;
      resolvedCoreName = (catalogsOrOptions as GenerateSkillSetOptions).coreName ?? coreName;
    }

    const skillSet = new SkillSet();

    // 1. Core Syntax Skill
    skillSet.add(this.generateCoreSkill(resolvedCoreName));

    // 2. Per-Catalog Skills
    // A format whose examples aren't kept per catalog returns the same
    // examples for each catalog, so only the first catalog skill gets them.
    const resolvedCatalogs = resolveCatalogsList(explicitCatalogs, this.fmt);
    const promptGen = this.fmt.promptGenerator;
    const seenExamples = new Set<string>();
    for (const cat of resolvedCatalogs) {
      const examples = promptGen.generateExamples(cat) ?? '';
      skillSet.add(this.buildCatalogSkill(cat, seenExamples.has(examples) ? '' : examples));
      seenExamples.add(examples);
    }

    return skillSet;
  }

  /**
   * Alias for {@link generateSkillset}.
   */
  generateSkillSet(
    catalogsOrOptions?: readonly CatalogApi[] | GenerateSkillSetOptions,
    coreName = 'a2ui-core',
  ): SkillSet {
    return this.generateSkillset(catalogsOrOptions, coreName);
  }
}
