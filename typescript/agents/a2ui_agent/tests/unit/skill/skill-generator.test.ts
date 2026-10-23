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

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  CatalogConfig,
  ExpressFormat,
  InMemoryCatalogProvider,
  InferenceFormat,
  Parser,
  PromptGenerator,
  Skill,
  SkillGenerator,
  SkillSet,
} from '../../../src/index.js';
import {CatalogApi} from '../../../src/internal/web-core.js';
import {REPO_ROOT} from '../../helpers/basic-catalogs.js';

const SPEC_DIR = path.join(REPO_ROOT, 'specification', 'v1_0');
const CATALOG_PATH = path.join(REPO_ROOT, 'catalogs', 'basic', 'v1', 'catalog.json');

describe('SkillGenerator', () => {
  let tempDir: string;
  let catalog: CatalogApi;
  let expressFmt: ExpressFormat;
  let generator: SkillGenerator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-skill-test-'));
    const catalogConfig = CatalogConfig.fromPath(CATALOG_PATH);
    catalog = catalogConfig.transformedCatalog;
    expressFmt = new ExpressFormat([catalog]);
    generator = new SkillGenerator(expressFmt);
  });

  afterEach(() => {
    fs.rmSync(tempDir, {recursive: true, force: true});
  });

  it('generates a monolithic Skill object via generateSkill()', () => {
    const skillObj = generator.generateSkill({name: 'a2ui-custom-monolithic'});

    expect(skillObj.name).toBe('a2ui-custom-monolithic');
    expect(skillObj.filename).toContain('a2ui-custom-monolithic');
    const content = skillObj.toMarkdown();
    expect(content.startsWith('---')).toBe(true);
    expect(content).toContain('A2UI Express DSL Output Contract');
  });

  it('generates a catalog skill with clean LLM name via generateCatalogSkill()', () => {
    const skillObj = generator.generateCatalogSkill({catalog});

    expect(skillObj.name).toBe('a2ui-basic');
    expect(skillObj.filename).toContain('a2ui-basic/SKILL.md');
    const content = skillObj.toMarkdown();
    expect(content).toContain('Positional Component Signatures');
  });

  it('generates a base grammar skill via generateCoreSkill()', () => {
    const coreSkill = generator.generateCoreSkill({name: 'a2ui-base-core'});

    expect(coreSkill.name).toBe('a2ui-base-core');
    expect(coreSkill.content).toContain('A2UI Express DSL Output Contract');
  });

  it('generates a modular SkillSet package via generateSkillset()', () => {
    const skillSet = generator.generateSkillset();

    expect(skillSet.has('a2ui-core/SKILL.md')).toBe(true);
    expect(skillSet.has('a2ui-basic/SKILL.md')).toBe(true);
    expect(skillSet.length).toBe(2);

    const coreSk = skillSet.get('a2ui-core');
    expect(coreSk?.name).toBe('a2ui-core');

    const basicSk = skillSet.get('a2ui-basic');
    expect(basicSk?.name).toBe('a2ui-basic');
  });

  it('exports SkillSet to directory, wiping stale skill files while preserving sibling skills', () => {
    // 1. Pre-populate directory with a stale file inside a matching skill folder,
    // an unrelated sibling skill, and a root note
    const staleCoreDir = path.join(tempDir, 'a2ui-core');
    fs.mkdirSync(staleCoreDir, {recursive: true});
    const staleFile = path.join(staleCoreDir, 'stale_note.txt');
    fs.writeFileSync(staleFile, 'old data', 'utf-8');

    const unrelatedSkillDir = path.join(tempDir, 'unrelated-custom-skill');
    fs.mkdirSync(unrelatedSkillDir, {recursive: true});
    const unrelatedFile = path.join(unrelatedSkillDir, 'SKILL.md');
    fs.writeFileSync(unrelatedFile, 'custom content', 'utf-8');

    const rootNote = path.join(tempDir, 'root_note.txt');
    fs.writeFileSync(rootNote, 'keep me', 'utf-8');

    // 2. Export skillset
    const skillSet = generator.generateSkillset();
    const exported = skillSet.exportToDirectory(tempDir);

    // 3. Assert skills were written
    expect(exported).toHaveProperty('a2ui-core/SKILL.md');
    expect(fs.existsSync(path.join(tempDir, 'a2ui-core', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'a2ui-basic', 'SKILL.md'))).toBe(true);

    // 4. Assert stale file in matching skill folder was wiped
    expect(fs.existsSync(staleFile)).toBe(false);

    // 5. Assert unrelated sibling skill and root note were strictly preserved
    expect(fs.existsSync(unrelatedFile)).toBe(true);
    expect(fs.readFileSync(unrelatedFile, 'utf-8')).toBe('custom content');
    expect(fs.existsSync(rootNote)).toBe(true);
  });

  it('cleans only the directory holding a nested skill file, not its ancestors', () => {
    // A skill whose filename nests under `src/skills/` must not wipe `src/`.
    const siblingFile = path.join(tempDir, 'src', 'keep.ts');
    fs.mkdirSync(path.dirname(siblingFile), {recursive: true});
    fs.writeFileSync(siblingFile, 'keep me', 'utf-8');

    const staleFile = path.join(tempDir, 'src', 'skills', 'nested', 'stale.txt');
    fs.mkdirSync(path.dirname(staleFile), {recursive: true});
    fs.writeFileSync(staleFile, 'old data', 'utf-8');

    const skillSet = new SkillSet();
    skillSet.add(
      new Skill({
        name: 'nested',
        description: 'Nested skill',
        content: '# Nested',
        filename: 'src/skills/nested/SKILL.md',
      }),
    );
    skillSet.exportToDirectory(tempDir);

    expect(fs.existsSync(path.join(tempDir, 'src', 'skills', 'nested', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(staleFile)).toBe(false);
    expect(fs.readFileSync(siblingFile, 'utf-8')).toBe('keep me');
  });

  it('rejects a Skill filename that could escape the export directory', () => {
    for (const filename of ['../x/SKILL.md', '/abs/SKILL.md', 'a/./b.md', 'a//b.md']) {
      expect(
        () => new Skill({name: 'bad', description: 'd', content: '# Bad', filename}),
        filename,
      ).toThrow(/must be a relative path/);
    }
    expect(() => new SkillSet({'../x/SKILL.md': new Skill('ok', 'd', '# Ok')})).toThrow(
      /must be a relative path/,
    );
    // Accepted: nested relative paths and a bare file at the root.
    expect(
      new Skill({name: 'n', description: 'd', content: 'c', filename: 'a/b/SKILL.md'}).filename,
    ).toBe('a/b/SKILL.md');
    expect(
      new Skill({name: 'n', description: 'd', content: 'c', filename: 'FLAT.md'}).filename,
    ).toBe('FLAT.md');
  });

  it('enforces SkillSet.get matching rules (exact key, exact name, min-3-char substring)', () => {
    const skillSet = generator.generateSkillset();

    // 1. Exact key match
    expect(skillSet.get('a2ui-core/SKILL.md')?.name).toBe('a2ui-core');

    // 2. Exact name match
    expect(skillSet.get('a2ui-core')?.name).toBe('a2ui-core');

    // 3. Substring match with >= 3 characters
    expect(skillSet.get('basic')?.name).toBe('a2ui-basic');

    // 4. Substring match with < 3 characters must NOT match
    expect(skillSet.get('ba')).toBeUndefined();
    expect(skillSet.get('c')).toBeUndefined();

    // 5. Non-matching string returns undefined
    expect(skillSet.get('nonexistent')).toBeUndefined();
  });

  it('defaults generateCatalogSkill() to the catalog bound to the format', () => {
    const skillObj = generator.generateCatalogSkill();
    expect(skillObj.name).toBe('a2ui-basic');
    expect(skillObj.content).toContain('Positional Component Signatures');
  });

  it('accepts explicit catalog arguments overriding format defaults', () => {
    const testingCatalogPath = path.join(SPEC_DIR, 'test', 'testing_catalog.json');
    const testingCatalog = CatalogConfig.fromPath(
      testingCatalogPath,
      [],
      'v1.0',
    ).transformedCatalog;

    // 1. generateCatalogSkill with explicit catalog generates for that catalog
    const catSkill = generator.generateCatalogSkill({catalog: testingCatalog});
    expect(catSkill.name).toBe('a2ui-specification');

    // 2. generateSkillset with explicit catalogs only includes the specified catalog
    const skillSet = generator.generateSkillset({catalogs: [testingCatalog]});
    expect(skillSet.length).toBe(2);
    expect(skillSet.has('a2ui-core/SKILL.md')).toBe(true);
    expect(skillSet.has('a2ui-specification/SKILL.md')).toBe(true);
    expect(skillSet.has('a2ui-basic/SKILL.md')).toBe(false);

    // 3. generateSkill with explicit catalogs only includes the specified catalog
    const monoSkill = generator.generateSkill({catalogs: [testingCatalog]});
    expect(monoSkill.content).toContain('TestComponent(value)');
    expect(monoSkill.content).not.toContain('Button(');
  });

  it('handles promptGenerator returning undefined/empty in generateCoreSkill() defensively', () => {
    const mockFmt = {
      promptGenerator: {
        generateBaseRules: () => undefined as unknown as string,
      } as unknown as PromptGenerator,
      supportsStreaming: false,
      createParser: () => ({}) as unknown as Parser,
    } satisfies InferenceFormat;
    const gen = new SkillGenerator(mockFmt);
    const skill = gen.generateCoreSkill();
    expect(skill.content).toBe('\n');
  });

  it('handles promptGenerator returning undefined/empty in generateCatalogSkill() defensively', () => {
    const mockFmt = {
      catalogs: [catalog],
      promptGenerator: {
        generateCatalogInstructions: () => undefined as unknown as string,
        generateExamples: () => undefined as unknown as string,
      } as unknown as PromptGenerator,
      supportsStreaming: false,
      createParser: () => ({}) as unknown as Parser,
    } satisfies InferenceFormat;
    const gen = new SkillGenerator(mockFmt);
    const skill = gen.generateCatalogSkill({catalog});
    expect(skill.content).toBe('\n');
  });

  it('adds examples shared by catalogs only once', () => {
    const other = new InMemoryCatalogProvider(
      {
        catalogId: 'https://a2ui.org/other',
        protocolVersion: 'v1.0',
        components: {},
        functions: {},
      },
      'v1.0',
      'https://a2ui.org/other',
    ).load();

    const generateExamplesMock = vi.fn(() => 'SHARED EXAMPLES');
    const mockFmt = {
      promptGenerator: {
        catalogs: [catalog, other],
        generateBaseRules: () => 'RULES',
        generateCatalogInstructions: () => 'INST',
        generateExamples: generateExamplesMock,
      } as unknown as PromptGenerator,
      supportsStreaming: false,
      createParser: () => ({}) as unknown as Parser,
    } satisfies InferenceFormat;
    const gen = new SkillGenerator(mockFmt);

    const skill = gen.generateSkill();
    expect(skill.content.split('SHARED EXAMPLES').length - 1).toBe(1);

    generateExamplesMock.mockClear();
    const skillSet = gen.generateSkillset();
    const examplesPerSkill = Object.values(skillSet.toDict())
      .map(text => text.split('SHARED EXAMPLES').length - 1)
      .sort((a, b) => a - b);
    expect(examplesPerSkill).toEqual([0, 0, 1]);
    // Each catalog's examples are loaded and transformed once.
    expect(generateExamplesMock).toHaveBeenCalledTimes(2);
  });

  it('supports Skill options constructor and SkillSet iteration and collection methods', () => {
    const skill = new Skill({
      name: 'a2ui-test',
      description: 'Test skill',
      content: 'Body content',
      metadata: {version: '1.0', tags: ['ui', 'express']},
    });
    expect(skill.filename).toBe('a2ui-test/SKILL.md');
    expect(skill.toString()).toBe(skill.toMarkdown());
    expect(skill.toMarkdown()).toContain(
      'metadata:\n  version: "1.0"\n  tags:\n  - ui\n  - express',
    );

    const skillSet = new SkillSet({[skill.filename]: skill});
    expect([...skillSet]).toEqual([skill.filename]);
    expect([...skillSet.keys()]).toEqual([skill.filename]);
    expect([...skillSet.values()]).toEqual([skill]);
    expect([...skillSet.entries()]).toEqual([[skill.filename, skill]]);
    expect([...skillSet.items()]).toEqual([[skill.filename, skill]]);
    expect(skillSet.size).toBe(1);
    expect(skillSet.toDict()).toEqual({[skill.filename]: skill.toMarkdown()});
  });
});
