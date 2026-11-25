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

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {dirname, join, resolve} from 'path';

import {load} from 'js-yaml';
import {expect} from 'vitest';

import {
  AgentToRendererMessage,
  CatalogConfig,
  DirectJsonFormat,
  ExpressFormat,
  Skill,
  SkillGenerator,
  SkillSet,
} from '../../src/index.js';
import {CatalogApi} from '../../src/internal/web-core.js';
import {EXAMPLES_HEADING} from '../../src/prompt/generator.js';
import {loadBasicCatalog, REPO_ROOT} from '../helpers/basic-catalogs.js';
import {classify, KNOWN_FAILURES, loadCases, LoadedCase} from './loader.js';
import {
  assertExpectedError,
  assertKnownKeys,
  CASE_METADATA_KEYS,
  conformancePath,
  describeSuite,
} from './suite-helpers.js';

const basicCatalogV10 = loadBasicCatalog('1.0');

const SINGLE_SKILL_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'expected_frontmatter',
  'expected_filename',
  'expect_contains',
  'expect_absent',
]);
const SKILL_SET_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'expected_skills',
  'expected_lookups',
]);
const EXPORT_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'args',
  'expect_error',
  'expected_files',
  'expected_absent_files',
]);
const SKILL_CASE_KEYS: Record<string, ReadonlySet<string>> = {
  from_format: SINGLE_SKILL_CASE_KEYS,
  core_syntax: SINGLE_SKILL_CASE_KEYS,
  from_catalog: SINGLE_SKILL_CASE_KEYS,
  skill_set: SKILL_SET_CASE_KEYS,
  export_to_directory: EXPORT_CASE_KEYS,
  monolithic_skill_equals_prompt_snippet: new Set([...CASE_METADATA_KEYS, 'args']),
};

const FORMAT_ARGS = ['format', 'catalog', 'catalogs', 'examples'];
const SKILL_ARGS_KEYS: Record<string, ReadonlySet<string>> = {
  from_format: new Set([...FORMAT_ARGS, 'name', 'description', 'skill_catalogs']),
  core_syntax: new Set([...FORMAT_ARGS, 'name', 'description']),
  from_catalog: new Set([
    ...FORMAT_ARGS,
    'skill_catalog',
    'name',
    'description',
    'include_examples',
  ]),
  skill_set: new Set([...FORMAT_ARGS, 'skill_catalogs', 'core_name']),
  monolithic_skill_equals_prompt_snippet: new Set(['format', 'catalogs']),
};

interface SkillCaseArgs {
  name?: string;
  description?: string;
  skill_catalogs?: string[];
  skill_catalog?: string;
  include_examples?: boolean;
  core_name?: string;
}

interface SkillCaseContext {
  args: SkillCaseArgs;
  catalogs: CatalogApi[];
  /** The format's catalog loaded from `path`. */
  catalogAt: (path: string) => CatalogApi;
  format: ExpressFormat | DirectJsonFormat;
  generator: SkillGenerator;
}

/** Loads the messages of one prompt example, relative to the repository root. */
function loadExample(path: string): AgentToRendererMessage[] {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf-8')) as AgentToRendererMessage[];
}

function buildSkillContext(testCase: LoadedCase): SkillCaseContext {
  const args = (testCase.args as Record<string, unknown>) || {};
  const catRelPaths =
    (args.catalogs as string[] | undefined) ?? (args.catalog ? [args.catalog as string] : []);
  const catalogsByPath = new Map(
    catRelPaths.map(rel => [
      rel,
      CatalogConfig.fromPath(resolve(REPO_ROOT, rel)).transformedCatalog,
    ]),
  );
  const catalogs = [...catalogsByPath.values()];
  const catalogAt = (path: string): CatalogApi => {
    const catalog = catalogsByPath.get(path);
    if (!catalog) {
      throw new Error(`${path} is not one of the format's catalogs`);
    }
    return catalog;
  };
  const turns = ((args.examples as string[] | undefined) ?? []).map(loadExample);

  const fmtName = (args.format as string | undefined) ?? 'express';
  const format =
    fmtName === 'express'
      ? new ExpressFormat(catalogs, {
          examples: turns.length > 0 ? {[catalogs[0].id]: turns} : undefined,
        })
      : new DirectJsonFormat(
          catalogs.length > 0 ? catalogs : [basicCatalogV10],
          turns.length > 0 ? turns : undefined,
        );
  const generator = new SkillGenerator(format);
  return {args: args as SkillCaseArgs, catalogs, catalogAt, format, generator};
}

/**
 * Checks a generated skill against the case, and its body against `body`, built from the
 * sections of the format's own prompt.
 */
function expectSkill(testCase: LoadedCase, skill: Skill, body: string): void {
  // The frontmatter is compared parsed, since SDKs may quote and wrap the same values
  // differently.
  const markdown = skill.toMarkdown();
  expect(markdown.startsWith('---\n')).toBe(true);
  const closing = '\n---\n\n';
  const end = markdown.indexOf(closing);
  expect(load(markdown.slice('---\n'.length, end))).toEqual(testCase.expected_frontmatter);
  expect(markdown.slice(end + closing.length)).toBe(`${body.trim()}\n`);
  if (testCase.expected_filename !== undefined) {
    expect(skill.filename).toBe(testCase.expected_filename);
  }
  for (const text of (testCase.expect_contains as string[] | undefined) ?? []) {
    expect(skill.content).toContain(text);
  }
  for (const text of (testCase.expect_absent as string[] | undefined) ?? []) {
    expect(skill.content).not.toContain(text);
  }
}

/** The body a catalog skill holds: the catalog's section, then its examples unless left out. */
function catalogBody(
  format: SkillCaseContext['format'],
  catalog: CatalogApi,
  includeExamples = true,
): string {
  const promptGen = format.promptGenerator;
  const examples = includeExamples ? promptGen.generateExamples(catalog) : '';
  const instructions = promptGen.generateCatalogInstructions(catalog);
  return examples ? `${instructions}\n\n${EXAMPLES_HEADING}${examples}` : instructions;
}

/** The body of a monolithic skill for catalogs that are not the format's own. */
function catalogsBody(format: SkillCaseContext['format'], catalogs: CatalogApi[]): string {
  const promptGen = format.promptGenerator;
  const examples: string[] = [];
  for (const catalog of catalogs) {
    const text = promptGen.generateExamples(catalog);
    if (text && !examples.includes(text)) {
      examples.push(text);
    }
  }
  const sections = [
    promptGen.generateBaseRules(),
    ...catalogs.map(catalog => promptGen.generateCatalogInstructions(catalog)),
  ];
  if (examples.length > 0) {
    sections.push(`${EXAMPLES_HEADING}${examples.join('\n\n')}`);
  }
  return sections.filter(section => section).join('\n\n');
}

// The handlers pass the generator's arguments only when the case gives them, so that a case
// without them checks the defaults.

function runFromFormatCase(
  testCase: LoadedCase,
  {args, catalogAt, format, generator}: SkillCaseContext,
): void {
  const snippet = format.promptGenerator.generate();
  const skillCatalogs = args.skill_catalogs?.map(catalogAt);
  const skill = generator.generateSkill({
    name: args.name,
    description: args.description,
    catalogs: skillCatalogs,
  });
  expectSkill(testCase, skill, skillCatalogs ? catalogsBody(format, skillCatalogs) : snippet);
  expect(format.promptGenerator.generate()).toBe(snippet);
}

function runCoreSyntaxCase(
  testCase: LoadedCase,
  {args, format, generator}: SkillCaseContext,
): void {
  expectSkill(
    testCase,
    generator.generateCoreSkill({name: args.name, description: args.description}),
    format.promptGenerator.generateBaseRules(),
  );
}

function runFromCatalogCase(
  testCase: LoadedCase,
  {args, catalogAt, catalogs, format, generator}: SkillCaseContext,
): void {
  const given = args.skill_catalog === undefined ? undefined : catalogAt(args.skill_catalog);
  const skill = generator.generateCatalogSkill({
    catalog: given,
    name: args.name,
    description: args.description,
    includeExamples: args.include_examples,
  });
  expectSkill(
    testCase,
    skill,
    catalogBody(format, given ?? catalogs[0], args.include_examples ?? true),
  );
}

function runSkillSetCase(
  testCase: LoadedCase,
  {args, catalogAt, catalogs, generator}: SkillCaseContext,
): void {
  const skillCatalogs = args.skill_catalogs?.map(catalogAt);
  const skillSet = generator.generateSkillSet({catalogs: skillCatalogs, coreName: args.core_name});
  const dict = skillSet.toDict();
  expect(Object.keys(dict)).toEqual(testCase.expected_skills);
  const expected = [
    generator.generateCoreSkill({name: args.core_name}),
    ...(skillCatalogs ?? catalogs).map(catalog => generator.generateCatalogSkill({catalog})),
  ];
  expect(Object.values(dict)).toEqual(expected.map(skill => skill.toMarkdown()));
  const lookups = (testCase.expected_lookups as Record<string, string | null> | undefined) ?? {};
  for (const [query, filename] of Object.entries(lookups)) {
    expect(skillSet.get(query)?.filename ?? null, `get(${JSON.stringify(query)})`).toBe(filename);
  }
}

interface LiteralSkill {
  name: string;
  description: string;
  content: string;
  filename?: string;
}

/**
 * Runs an `export_to_directory` case. It needs no inference format, so it is dispatched
 * before `buildSkillContext`, as the Python runner does.
 */
function runExportToDirectoryCase(testCase: LoadedCase): void {
  const args = (testCase.args as Record<string, unknown>) || {};
  const tempDir = mkdtempSync(join(tmpdir(), 'a2ui-skill-export-'));
  try {
    for (const rel of (args.pre_existing_files as string[] | undefined) ?? []) {
      const abs = join(tempDir, rel);
      mkdirSync(dirname(abs), {recursive: true});
      writeFileSync(abs, 'pre-existing', 'utf-8');
    }

    const run = () => {
      const skillSet = new SkillSet();
      for (const s of (args.skills as LiteralSkill[] | undefined) ?? []) {
        skillSet.add(new Skill(s));
      }
      const written = skillSet.exportToDirectory(tempDir);
      expect(written).toEqual(skillSet.toDict());
      for (const [rel, markdown] of Object.entries(written)) {
        expect(readFileSync(join(tempDir, rel), 'utf-8')).toBe(markdown);
      }
    };
    if (testCase.expect_error) {
      assertExpectedError(run, testCase);
    } else {
      run();
    }

    for (const rel of (testCase.expected_files as string[] | undefined) ?? []) {
      expect(existsSync(join(tempDir, rel)), `expected ${rel} to exist`).toBe(true);
    }
    for (const rel of (testCase.expected_absent_files as string[] | undefined) ?? []) {
      expect(existsSync(join(tempDir, rel)), `expected ${rel} to be removed`).toBe(false);
    }
  } finally {
    rmSync(tempDir, {recursive: true, force: true});
  }
}

function runMonolithicSkillEqualsPromptSnippetCase(
  _testCase: LoadedCase,
  {format, generator}: SkillCaseContext,
): void {
  const skillObj = generator.generateSkill();
  const snippet = format.promptGenerator.generate();
  expect(skillObj.content).toBe(`${snippet}\n`);
  // The serialized skill trims whitespace at the body's ends. The body follows the line
  // that closes the frontmatter; schema blocks in it also end with `---`.
  const markdown = skillObj.toMarkdown();
  const closing = '\n---\n\n';
  const body = markdown.slice(markdown.indexOf(closing) + closing.length);
  expect(body).toBe(`${snippet.trim()}\n`);
}

const SKILL_ACTION_HANDLERS: Record<
  string,
  (testCase: LoadedCase, ctx: SkillCaseContext) => void | Promise<void>
> = {
  from_format: runFromFormatCase,
  core_syntax: runCoreSyntaxCase,
  from_catalog: runFromCatalogCase,
  skill_set: runSkillSetCase,
  monolithic_skill_equals_prompt_snippet: runMonolithicSkillEqualsPromptSnippetCase,
};

describeSuite(
  'Conformance: skill.yaml',
  loadCases([conformancePath('agent/skill.yaml')]),
  async testCase => {
    const {action} = testCase;
    const allowedKeys = SKILL_CASE_KEYS[action];
    if (allowedKeys) {
      assertKnownKeys(testCase, allowedKeys, `${action} case`);
    }
    if (Object.hasOwn(SKILL_ARGS_KEYS, action)) {
      assertKnownKeys(
        testCase.args as Record<string, unknown>,
        SKILL_ARGS_KEYS[action],
        `${action} args`,
      );
    }
    if (action === 'export_to_directory') {
      runExportToDirectoryCase(testCase);
      return;
    }
    const handler = Object.hasOwn(SKILL_ACTION_HANDLERS, action)
      ? SKILL_ACTION_HANDLERS[action]
      : undefined;
    if (!handler) {
      throw new Error(`Unhandled conformance action: ${action}`);
    }
    const ctx = buildSkillContext(testCase);
    await handler(testCase, ctx);
  },
  {
    knownFailures: KNOWN_FAILURES,
    skipReason: testCase => {
      const verdict = classify(testCase);
      return verdict.runnable ? undefined : verdict.reason;
    },
  },
);
