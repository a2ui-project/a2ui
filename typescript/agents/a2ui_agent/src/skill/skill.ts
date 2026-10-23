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
 * Skill and SkillSet domain objects for A2UI skill packages.
 */

import * as fs from 'fs';
import * as path from 'path';

import {A2uiValidationError} from '../errors.js';
import {InferenceFormat} from '../inference-format.js';
import {CatalogApi} from '../internal/web-core.js';

const YAML_LINE_WIDTH = 80;

/**
 * Derives a clean, LLM-friendly catalog name from a catalog ID or URL.
 */
export function cleanCatalogName(catalog: unknown): string {
  const rawObj = catalog as
    | {id?: unknown; catalogId?: unknown; catalog_id?: unknown}
    | null
    | undefined;
  const candidateId = rawObj?.id ?? rawObj?.catalogId ?? rawObj?.catalog_id;
  let rawId = typeof candidateId === 'string' && candidateId.length > 0 ? candidateId : 'basic';
  if (rawId.includes('/') || rawId.includes('\\')) {
    rawId = rawId.replace(/\\/g, '/');
    const parts = rawId.split('/').filter(p => p.length > 0 && !p.endsWith('.json'));
    if (parts.length > 0) {
      let cand = parts[parts.length - 1];
      if (cand.startsWith('v') && parts.length > 1) {
        cand = parts[parts.length - 2];
      }
      rawId = cand;
    }
  }
  return rawId.toLowerCase();
}

/**
 * Resolves catalogs from an explicit sequence or the format's prompt generator.
 */
export function resolveCatalogsList(
  catalogs: readonly CatalogApi[] | undefined,
  fmt: InferenceFormat,
): CatalogApi[] {
  return [...(catalogs ?? fmt.promptGenerator.catalogs)];
}

/**
 * Whether a string can be emitted as an unquoted YAML plain scalar.
 */
function isPlainYamlString(value: string): boolean {
  if (value.length === 0) return false;
  if (/^\s|\s$/.test(value)) return false;
  if (/[\n\r\t]/.test(value)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return false;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return false;
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value)) return false;
  if (value.includes(': ') || value.includes(' #')) return false;
  return true;
}

/**
 * Wraps a plain YAML scalar following PyYAML's `Emitter.write_plain` column rules.
 */
function formatPlainYamlScalar(keyPrefix: string, text: string, indent: number): string {
  if (!isPlainYamlString(text)) {
    return `${keyPrefix} ${JSON.stringify(text)}`;
  }
  let out = `${keyPrefix} `;
  let column = keyPrefix.length + 1;
  const continuationIndent = ' '.repeat(indent + 2);
  let spaces = false;
  let start = 0;
  let end = 0;

  while (end <= text.length) {
    const ch = end < text.length ? text[end] : undefined;
    if (spaces) {
      if (ch !== ' ') {
        if (start + 1 === end && column > YAML_LINE_WIDTH) {
          out += `\n${continuationIndent}`;
          column = continuationIndent.length;
        } else {
          const slice = text.slice(start, end);
          out += slice;
          column += slice.length;
        }
        start = end;
      }
    } else if (ch === undefined || ch === ' ') {
      const slice = text.slice(start, end);
      out += slice;
      column += slice.length;
      start = end;
    }
    if (ch !== undefined) {
      spaces = ch === ' ';
    }
    end += 1;
  }
  return out;
}

/**
 * Serializes a frontmatter value as YAML.
 */
function serializeYamlValue(key: string, value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  const keyPrefix = `${pad}${key}:`;

  if (typeof value === 'string') {
    return formatPlainYamlScalar(keyPrefix, value, indent);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${keyPrefix} ${String(value)}`;
  }
  if (value === null || value === undefined) {
    return `${keyPrefix} null`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${keyPrefix} []`;
    }
    const items = value.map(item => {
      if (typeof item === 'string' && isPlainYamlString(item)) {
        return `${pad}- ${item}`;
      }
      return `${pad}- ${JSON.stringify(item)}`;
    });
    return `${keyPrefix}\n${items.join('\n')}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return `${keyPrefix} {}`;
    }
    const lines = entries.map(([k, v]) => serializeYamlValue(k, v, indent + 2));
    return `${keyPrefix}\n${lines.join('\n')}`;
  }
  return `${keyPrefix} ${JSON.stringify(value)}`;
}

/**
 * Checks that a skill filename is a relative path that stays inside the directory a
 * `SkillSet` is exported to: no absolute path, no empty segment, and no `.` or `..`
 * segment. Both `/` and `\\` separate segments, so a filename is rejected on every
 * platform it would escape on.
 *
 * @throws {A2uiValidationError} If the filename is not such a path.
 */
export function validateSkillFilename(filename: string): string {
  const segments = filename.split(/[\\/]/);
  const escapes =
    filename === '' ||
    path.posix.isAbsolute(filename) ||
    path.win32.isAbsolute(filename) ||
    segments.some(segment => segment === '' || segment === '.' || segment === '..');
  if (escapes) {
    throw new A2uiValidationError(
      `Skill filename ${JSON.stringify(filename)} must be a relative path without "." or ".." segments.`,
    );
  }
  return filename;
}

/**
 * Resolves the nearest existing ancestor of `target` (or `target` itself) through any
 * symlinks and checks that it is `outputRoot` or inside it. `outputRoot` must already be
 * resolved. The lexical check in {@link validateSkillFilename} cannot see a symlinked
 * directory under the output directory, and removing or writing through one would reach
 * outside it.
 *
 * @throws {A2uiValidationError} If the resolved path is outside `outputRoot`.
 */
function assertResolvesInside(target: string, outputRoot: string, filename: string): void {
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = fs.realpathSync(existing);
  if (real !== outputRoot && !real.startsWith(outputRoot + path.sep)) {
    throw new A2uiValidationError(
      `Skill filename ${JSON.stringify(filename)} resolves through a symlink to ${JSON.stringify(real)}, outside the output directory.`,
    );
  }
}

export interface SkillOptions {
  name: string;
  description: string;
  content: string;
  metadata?: Record<string, unknown>;
  filename?: string;
}

/**
 * Represents a single A2UI Skill package with YAML frontmatter metadata and markdown content.
 *
 * Allows developers to inspect and mutate fields (`name`, `description`, `metadata`, `content`)
 * before serializing back to markdown format.
 *
 * `filename` is the path the skill is written to, relative to the directory a `SkillSet` is
 * exported to. It is checked on construction (see {@link validateSkillFilename}) and is
 * read-only, so `SkillSet.exportToDirectory` can rely on every filename staying inside its
 * output directory. To write a skill somewhere else, construct a new one.
 */
export class Skill {
  name: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
  readonly filename: string;

  constructor(options: SkillOptions) {
    this.name = options.name;
    this.description = options.description;
    this.content = options.content;
    this.metadata = options.metadata ?? {};
    this.filename = validateSkillFilename(options.filename || `${options.name}/SKILL.md`);
  }

  /**
   * Serializes skill object back to a complete markdown string with YAML frontmatter.
   */
  toMarkdown(): string {
    const lines = [
      serializeYamlValue('name', this.name),
      serializeYamlValue('description', this.description),
    ];
    if (Object.keys(this.metadata).length > 0) {
      lines.push(serializeYamlValue('metadata', this.metadata));
    }
    const yamlStr = lines.join('\n').trim();
    return `---\n${yamlStr}\n---\n\n${this.content.trim()}\n`;
  }

  toString(): string {
    return this.toMarkdown();
  }
}

/**
 * Collection of Skill objects representing a modular or multi-skill package.
 */
export class SkillSet implements Iterable<string> {
  private readonly skills = new Map<string, Skill>();

  constructor(skills?: Record<string, Skill> | Iterable<[string, Skill]>) {
    if (skills) {
      const entries =
        typeof (skills as Iterable<[string, Skill]>)[Symbol.iterator] === 'function'
          ? (skills as Iterable<[string, Skill]>)
          : Object.entries(skills as Record<string, Skill>);
      // Keys are the paths the export writes, so they are held to the same rule as
      // `Skill.filename`.
      for (const [k, v] of entries) {
        this.skills.set(validateSkillFilename(k), v);
      }
    }
  }

  /**
   * Adds a Skill to the collection, keyed by its filename.
   *
   * The filename is checked again here: it is read-only in TypeScript, but a JavaScript
   * caller can still reassign it, and the export trusts every key of this map.
   */
  add(skill: Skill): void {
    this.skills.set(validateSkillFilename(skill.filename), skill);
  }

  /**
   * Retrieves a Skill by filename, exact skill name, or substring match (minimum 3 characters).
   */
  get(filename: string): Skill | undefined {
    const exactKey = this.skills.get(filename);
    if (exactKey !== undefined) {
      return exactKey;
    }
    for (const sk of this.skills.values()) {
      if (sk.name === filename) {
        return sk;
      }
    }
    if (filename.length >= 3) {
      for (const sk of this.skills.values()) {
        if (sk.filename.includes(filename)) {
          return sk;
        }
      }
    }
    return undefined;
  }

  /**
   * Checks whether an exact filename key exists in the skill set.
   */
  has(filename: string): boolean {
    return this.skills.has(filename);
  }

  /**
   * Serializes all skills to a dictionary mapping filename to markdown text.
   */
  toDict(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [filename, skill] of this.skills.entries()) {
      result[filename] = skill.toMarkdown();
    }
    return result;
  }

  /**
   * Exports all skills in the set to the specified output directory on disk.
   *
   * The directory holding each skill file (for example, `{outputDir}/a2ui-core`
   * or `{outputDir}/a2ui-basic`) is removed before writing so no stale files
   * persist. A symlink or file at that path is removed as such, not followed.
   * Unrelated sibling directories and files in `outputDir` are preserved, and
   * `outputDir` itself is never removed.
   *
   * Every filename was checked by {@link validateSkillFilename} when it entered
   * the set, and each skill directory's parent is resolved through symlinks before
   * anything is removed, so nothing here can reach outside `outputDir`.
   *
   * @param outputDir Root directory where skill packages should be written.
   * @returns A dictionary mapping skill filenames to generated markdown content.
   * @throws {A2uiValidationError} If a skill directory's parent is a symlink that
   *     resolves outside `outputDir`. Nothing is removed or written in that case.
   */
  exportToDirectory(outputDir: string): Record<string, string> {
    fs.mkdirSync(outputDir, {recursive: true});
    const outputRoot = fs.realpathSync(outputDir);

    // Check every skill directory before touching any, so a bad one aborts the export whole.
    const skillDirsToClean = new Map<string, string>();
    for (const filename of this.skills.keys()) {
      const dirName = path.dirname(filename);
      if (dirName === '.') continue;
      const skillFolder = path.join(outputDir, dirName);
      assertResolvesInside(path.dirname(skillFolder), outputRoot, filename);
      skillDirsToClean.set(skillFolder, filename);
    }

    for (const skillFolder of skillDirsToClean.keys()) {
      // `rmSync` removes a symlink itself rather than its target.
      fs.rmSync(skillFolder, {recursive: true, force: true});
    }

    const results: Record<string, string> = {};
    for (const [filename, skill] of this.skills.entries()) {
      const filePath = path.join(outputDir, filename);
      fs.mkdirSync(path.dirname(filePath), {recursive: true});
      const markdownText = skill.toMarkdown();
      fs.writeFileSync(filePath, markdownText, 'utf-8');
      results[filename] = markdownText;
    }
    return results;
  }

  get size(): number {
    return this.skills.size;
  }

  keys(): IterableIterator<string> {
    return this.skills.keys();
  }

  values(): IterableIterator<Skill> {
    return this.skills.values();
  }

  entries(): IterableIterator<[string, Skill]> {
    return this.skills.entries();
  }

  [Symbol.iterator](): IterableIterator<string> {
    return this.skills.keys();
  }
}
