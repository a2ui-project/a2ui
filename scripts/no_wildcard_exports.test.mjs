/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const IGNORED_DIRS = new Set([
  '.angular',
  '.git',
  '.next',
  '.venv',
  '.wireit',
  '.worktrees',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'lib',
  'node_modules',
  'out-tsc',
  'venv',
]);

const LEGACY_SEGMENTS = new Set(['v0_8', '0.8']);

const GENERATED_SCHEMA_INDEX_ALLOWLIST = new Set([
  'typescript/core/web_core/src/v0_9/schema/index.ts',
  'typescript/core/web_core/src/v1_0/schema/index.ts',
]);

const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

const REGEX_PRECEDING_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

function isRegexPrecedingKeyword(out, endIndex) {
  let start = endIndex;
  while (start > 0 && /[A-Za-z0-9_$]/.test(out[start - 1])) {
    start--;
  }
  let prevIdx = start - 1;
  while (prevIdx >= 0 && /\s/.test(out[prevIdx])) {
    prevIdx--;
  }
  if (prevIdx >= 0 && out[prevIdx] === '.') {
    return false;
  }
  return REGEX_PRECEDING_KEYWORDS.has(out.slice(start, endIndex + 1).join(''));
}

function canStartRegexLiteral(out, slashIndex) {
  let j = slashIndex - 1;
  while (j >= 0 && /\s/.test(out[j])) {
    j--;
  }
  if (j < 0) {
    return true;
  }
  const prev = out[j];
  if ((prev === '+' || prev === '-') && out[j - 1] === prev) {
    return false;
  }
  if (prev === '!') {
    let k = j - 1;
    while (k >= 0 && /\s/.test(out[k])) {
      k--;
    }
    if (k < 0) {
      return true;
    }
    const beforeBang = out[k];
    if (
      beforeBang === ')' ||
      beforeBang === ']' ||
      beforeBang === "'" ||
      beforeBang === '"' ||
      beforeBang === '`'
    ) {
      return false;
    }
    if (/[A-Za-z0-9_$]/.test(beforeBang)) {
      return isRegexPrecedingKeyword(out, k);
    }
    return true;
  }
  if (prev === '>') {
    return out[j - 1] === '=';
  }
  if ('=([&|?:;{},~+-*%^'.includes(prev)) {
    return true;
  }
  if (/[A-Za-z_$]/.test(prev)) {
    return isRegexPrecedingKeyword(out, j);
  }
  return false;
}

function findRegexLiteralEnd(source, slashIndex) {
  let i = slashIndex + 1;
  if (
    i >= source.length ||
    source[i] === '/' ||
    source[i] === '*' ||
    source[i] === '\n' ||
    source[i] === '\r'
  ) {
    return -1;
  }
  let inCharClass = false;
  while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
    if (source[i] === '\\') {
      i++;
      if (i >= source.length || source[i] === '\n' || source[i] === '\r') {
        return -1;
      }
      i++;
      continue;
    }
    if (source[i] === '[') {
      inCharClass = true;
    } else if (source[i] === ']') {
      inCharClass = false;
    } else if (source[i] === '/' && !inCharClass) {
      if (source[i + 1] === '/') {
        return -1;
      }
      let end = i + 1;
      while (end < source.length && /[A-Za-z]/.test(source[end])) {
        end++;
      }
      return end;
    }
    i++;
  }
  return -1;
}

/**
 * Replaces comment, regex-literal, string-literal, and template-literal
 * contents with spaces while preserving line breaks and quote delimiters so
 * module specifiers (`from '...'`) remain matchable at exact line numbers.
 *
 * @param {string} source
 * @returns {string}
 */
function stripCommentsAndLiterals(source) {
  const out = [];
  const stack = ['code'];
  let i = 0;

  const pushBlank = ch => {
    out.push(ch === '\n' ? '\n' : ' ');
  };

  while (i < source.length) {
    const top = stack[stack.length - 1];
    const ch = source[i];
    const next = source[i + 1];

    if (top === 'template') {
      if (ch === '\\') {
        pushBlank(ch);
        i++;
        if (i < source.length) {
          pushBlank(source[i]);
          i++;
        }
        continue;
      }
      if (ch === '$' && next === '{') {
        out.push(' ', ' ');
        i += 2;
        stack.push({kind: 'template_expr', braceDepth: 1});
        continue;
      }
      if (ch === '`') {
        out.push('`');
        i++;
        stack.pop();
        continue;
      }
      pushBlank(ch);
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      out.push(' ', ' ');
      i += 2;
      while (i < source.length && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        pushBlank(source[i]);
        i++;
      }
      if (i < source.length) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      out.push(quote);
      i++;
      while (i < source.length && source[i] !== quote && source[i] !== '\n') {
        if (source[i] === '\\') {
          pushBlank(source[i]);
          i++;
          if (i < source.length) {
            pushBlank(source[i]);
            i++;
          }
          continue;
        }
        pushBlank(source[i]);
        i++;
      }
      if (i < source.length && source[i] === quote) {
        out.push(quote);
        i++;
      }
      continue;
    }

    if (ch === '`') {
      out.push('`');
      i++;
      stack.push('template');
      continue;
    }

    if (ch === '/' && canStartRegexLiteral(out, out.length)) {
      const regexEnd = findRegexLiteralEnd(source, i);
      if (regexEnd !== -1) {
        while (i < regexEnd) {
          out.push(' ');
          i++;
        }
        continue;
      }
    }

    if (typeof top === 'object' && top.kind === 'template_expr') {
      if (ch === '{') {
        top.braceDepth++;
      } else if (ch === '}') {
        top.braceDepth--;
        if (top.braceDepth === 0) {
          out.push(' ');
          i++;
          stack.pop();
          continue;
        }
      }
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

const WILDCARD_EXPORT_RE = /(?<![.$\w])export(?:\s+type)?\s*\*\s*from\s*['"]/g;

/**
 * Finds wildcard barrel re-exports (`export * from '...'` and
 * `export type * from '...'`) while permitting namespace re-exports
 * (`export * as Ns from '...'`).
 *
 * @param {string} source
 * @returns {Array<{line: number, snippet: string}>}
 */
export function findWildcardExports(source) {
  const sanitized = stripCommentsAndLiterals(source);
  const lines = source.split('\n');
  const matches = [];

  for (const match of sanitized.matchAll(WILDCARD_EXPORT_RE)) {
    const index = match.index ?? 0;
    let line = 1;
    for (let pos = 0; pos < index; pos++) {
      if (sanitized[pos] === '\n') {
        line++;
      }
    }
    matches.push({
      line,
      snippet: lines[line - 1]?.trim() ?? match[0].trim(),
    });
  }

  return matches;
}

function isTypeScriptSourceFile(fileName) {
  if (fileName.endsWith('.d.ts')) {
    return false;
  }
  return TS_EXTENSIONS.some(ext => fileName.endsWith(ext));
}

function collectTypeScriptFiles(dir, results = []) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      if (
        entry.name.startsWith('.') ||
        IGNORED_DIRS.has(entry.name) ||
        LEGACY_SEGMENTS.has(entry.name)
      ) {
        continue;
      }
      collectTypeScriptFiles(resolve(dir, entry.name), results);
    } else if (entry.isFile() && isTypeScriptSourceFile(entry.name)) {
      results.push(resolve(dir, entry.name));
    }
  }
  return results;
}

describe('findWildcardExports', () => {
  it('flags value and type wildcard barrel re-exports', () => {
    const source = [
      "export * from './foo.js';",
      'export type * from "./bar.js";',
      "export*from'./compact.js';",
      "export\n  *\n  from './multiline.js';",
      "export /* inline */ * /* comment */ from './commented.js';",
    ].join('\n');

    const hits = findWildcardExports(source);
    assert.deepEqual(
      hits.map(h => h.line),
      [1, 2, 3, 4, 7],
    );
  });

  it('allows explicit named exports and namespace re-exports', () => {
    const source = [
      "export {foo, type Bar} from './foo.js';",
      "export type {Baz} from './baz.js';",
      "export * as FooNamespace from './foo.js';",
      "export type * as BarTypes from './bar.js';",
      'export * as "arbitrary-ns" from "./baz.js";',
    ].join('\n');

    assert.deepEqual(findWildcardExports(source), []);
  });

  it('ignores wildcard export text inside comments, strings, templates, and regexes', () => {
    const source = [
      "// export * from './commented.js';",
      "/* export * from './block-comment.js'; */",
      'const single = "export * from \'./in-string.js\'";',
      'const double = \'export type * from "./in-string.js"\';',
      "const tpl = `\nexport * from './in-template.js';\n`;",
      'const re = /`/g;',
      "const afterRegex = 'safe';",
    ].join('\n');

    assert.deepEqual(findWildcardExports(source), []);
  });

  it('still catches wildcard exports after regex literals containing backticks', () => {
    const source = [
      'const stripBackticks = s => s.replace(/`/g, "");',
      'const hasBacktick = str => { return !/`/g.test(str); };',
      "export * from './sneaky.js';",
    ].join('\n');

    const hits = findWildcardExports(source);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 3);
  });

  it('does not misclassify JSX closing tags before multiline templates as regex literals', () => {
    const source = [
      "const single = <span>label</span> || `\nexport * from './in-template.js';\n`;",
      "const nested = <div><b>bold</b></div> || `\nexport * from './also-in-template.js';\n`;",
      "export * from './after-jsx.js';",
    ].join('\n');

    const hits = findWildcardExports(source);
    assert.deepEqual(
      hits.map(h => h.line),
      [7],
    );
  });

  it('does not misclassify division after postfix operators or unclosed slashes as regex literals', () => {
    const source = [
      "const nonNull = foo! / bar + arr[0]! / getDenom()! + `\nexport * from './tpl-1.js';\n`;",
      "const incDec = count++ / total + idx-- / scale + `\nexport * from './tpl-2.js';\n`;",
      "const unclosed = {a: 1} / denom + `\nexport * from './tpl-3.js';\n`; // trailing comment",
      "export * from './after-postfix.js';",
    ].join('\n');

    const hits = findWildcardExports(source);
    assert.deepEqual(
      hits.map(h => h.line),
      [10],
    );
  });
});

describe('repository wildcard barrel export ban', () => {
  it('keeps GENERATED_SCHEMA_INDEX_ALLOWLIST entries valid and auto-generated', () => {
    for (const relPath of GENERATED_SCHEMA_INDEX_ALLOWLIST) {
      const fullPath = resolve(REPO_ROOT, relPath);
      assert.ok(existsSync(fullPath), `Allowlisted generated file does not exist: ${relPath}`);
      const content = readFileSync(fullPath, 'utf8');
      assert.ok(
        content.includes('// AUTO-GENERATED FILE'),
        `Allowlisted file is missing AUTO-GENERATED header: ${relPath}`,
      );
      assert.ok(
        findWildcardExports(content).length > 0,
        `Allowlisted file no longer contains export *: ${relPath}`,
      );
    }
  });

  it('contains no `export *` barrel re-exports outside deprecated v0_8 / 0.8 and generated schema index files', () => {
    const files = collectTypeScriptFiles(REPO_ROOT).sort();
    assert.ok(files.length > 0, 'Expected to discover TypeScript source files');

    const violations = [];
    for (const filePath of files) {
      const relPath = relative(REPO_ROOT, filePath).split(sep).join('/');
      if (GENERATED_SCHEMA_INDEX_ALLOWLIST.has(relPath)) {
        continue;
      }
      const hits = findWildcardExports(readFileSync(filePath, 'utf8'));
      for (const hit of hits) {
        violations.push(`${relPath}:${hit.line}: ${hit.snippet}`);
      }
    }

    assert.deepEqual(
      violations,
      [],
      [
        'Found wildcard barrel exports (`export *`). Replace with explicit named exports (`export { ... }`) or namespace exports (`export * as ...`):',
        ...violations.map(v => `  - ${v}`),
      ].join('\n'),
    );
  });
});
