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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {describe, expect, test} from 'vitest';

import {
  CatalogConfig,
  DirectJsonFormat,
  ExpressFormat,
  Skill,
  SkillGenerator,
  SkillSet,
} from '../../src/index.js';
import {CatalogApi} from '../../src/internal/web-core.js';
import {loadBasicCatalog, REPO_ROOT} from '../helpers/basic-catalogs.js';
import {classify, KNOWN_FAILURES, loadCases, LoadedCase} from './loader.js';
import {conformancePath, errorClassFor} from './suite-helpers.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');

interface SkillCaseContext {
  args: Record<string, unknown>;
  catalog?: CatalogApi;
  generator: SkillGenerator;
}

function buildSkillContext(testCase: LoadedCase): SkillCaseContext {
  const args = (testCase.args as Record<string, unknown>) || {};
  const catRelPath = args.catalog as string | undefined;
  let catalog: CatalogApi | undefined;
  if (catRelPath) {
    const absCatPath = path.resolve(REPO_ROOT, catRelPath);
    const catConfig = CatalogConfig.fromPath(absCatPath);
    catalog = catConfig.transformedCatalog;
  }

  const fmtName = (args.format as string | undefined) ?? 'express';
  const fmt =
    fmtName === 'express'
      ? new ExpressFormat(catalog ? [catalog] : [])
      : new DirectJsonFormat(catalog ? [catalog] : [basicCatalogV10]);
  const generator = new SkillGenerator(fmt);
  return {args, catalog, generator};
}

function runFromFormatCase(testCase: LoadedCase, {args, generator}: SkillCaseContext): void {
  const monoName = (args.name as string | undefined) ?? 'a2ui';
  const skillObj = generator.generateSkill({name: monoName});
  const expectedRel = testCase.expected_file as string;
  const expectedContent = fs.readFileSync(path.resolve(REPO_ROOT, expectedRel), 'utf-8');
  expect(skillObj.toMarkdown()).toBe(expectedContent);
}

function runCoreSyntaxCase(testCase: LoadedCase, {args, generator}: SkillCaseContext): void {
  const coreName = (args.name as string | undefined) ?? 'a2ui-core';
  const skillObj = generator.generateCoreSkill({name: coreName});
  const expectedRel = testCase.expected_file as string;
  const expectedContent = fs.readFileSync(path.resolve(REPO_ROOT, expectedRel), 'utf-8');
  expect(skillObj.toMarkdown()).toBe(expectedContent);
}

function runFromCatalogCase(testCase: LoadedCase, {catalog, generator}: SkillCaseContext): void {
  const skillObj = generator.generateCatalogSkill({catalog});
  const expectedRel = testCase.expected_file as string;
  const expectedContent = fs.readFileSync(path.resolve(REPO_ROOT, expectedRel), 'utf-8');
  expect(skillObj.toMarkdown()).toBe(expectedContent);
}

function runSkillSetCase(testCase: LoadedCase, {generator}: SkillCaseContext): void {
  const skillSet = generator.generateSkillSet();
  const expectedKeys = (testCase.expected_skills as string[]) || [];
  const dict = skillSet.toDict();
  for (const k of expectedKeys) {
    expect(Object.hasOwn(dict, k), `expected skill ${k}`).toBe(true);
  }
  const expectedFiles = (testCase.expected_skill_files as Record<string, string>) || {};
  for (const [k, goldenRel] of Object.entries(expectedFiles)) {
    const golden = fs.readFileSync(path.resolve(REPO_ROOT, goldenRel), 'utf-8');
    expect(dict[k], `content of ${k}`).toBe(golden);
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-skill-export-'));
  try {
    for (const rel of (args.pre_existing_files as string[] | undefined) ?? []) {
      const abs = path.join(tempDir, rel);
      fs.mkdirSync(path.dirname(abs), {recursive: true});
      fs.writeFileSync(abs, 'pre-existing', 'utf-8');
    }

    const run = () => {
      const skillSet = new SkillSet();
      for (const s of (args.skills as LiteralSkill[] | undefined) ?? []) {
        skillSet.add(new Skill(s));
      }
      skillSet.exportToDirectory(tempDir);
    };
    if (testCase.expect_error) {
      expect(run).toThrow(errorClassFor(testCase));
    } else {
      run();
    }

    for (const rel of (testCase.expected_files as string[] | undefined) ?? []) {
      expect(fs.existsSync(path.join(tempDir, rel)), `expected ${rel} to exist`).toBe(true);
    }
    for (const rel of (testCase.expected_absent_files as string[] | undefined) ?? []) {
      expect(fs.existsSync(path.join(tempDir, rel)), `expected ${rel} to be removed`).toBe(false);
    }
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

const SKILL_ACTION_HANDLERS: Record<
  string,
  (testCase: LoadedCase, ctx: SkillCaseContext) => void | Promise<void>
> = {
  from_format: runFromFormatCase,
  core_syntax: runCoreSyntaxCase,
  from_catalog: runFromCatalogCase,
  skill_set: runSkillSetCase,
};

describe('Conformance: skill.yaml', () => {
  for (const testCase of loadCases([conformancePath('agent/skill.yaml')])) {
    const verdict = classify(testCase);
    const {action, name} = testCase;
    const testName = `${action} · ${name}`;

    const testFn = async () => {
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
    };

    if (!verdict.runnable) {
      test.skip(`${testName} (${verdict.reason})`, testFn);
    } else if (KNOWN_FAILURES.has(name)) {
      test.fails(`${testName} (known gap: ${KNOWN_FAILURES.get(name)})`, testFn);
    } else {
      test(testName, testFn);
    }
  }
});
