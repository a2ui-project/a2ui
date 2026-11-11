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

/**
 * The `a2ui:bindings` module: typed wrappers over `callFunction`, one per catalog function.
 *
 * The agent generates the module's declarations from its catalogs and puts them in the prompt.
 * The implementation is the same for every function, so the frame builds it here from the names
 * the app imports, and nothing extra travels with the app.
 */

import reservedWords from '../reserved_words.json';

/** The module name apps import typed functions from. */
export const BINDINGS_MODULE = 'a2ui:bindings';

const RESERVED: ReadonlySet<string> = new Set(reservedWords.words);
const NAME = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
const IDENTIFIER = new RegExp(String.raw`^${NAME}$`);
const SPECIFIER = String.raw`(?:"a2ui:bindings"|'a2ui:bindings')`;
/**
 * A static `import … from` or `export … from` of the module, or a bare `import "a2ui:bindings"`.
 * Group 1 is the keyword, group 2 everything up to the specifier, whose clause can't hold quotes
 * or semicolons. Other strings that spell the module name don't match.
 */
const FROM_CLAUSE = new RegExp(
  String.raw`(?<![\w$.])(import|export)(?![\w$])((?:[^;'"\x60]*?(?<![\w$])from)?\s*)${SPECIFIER}`,
  'g',
);
const NAMESPACE = new RegExp(String.raw`\*\s*as\s+(${NAME})`);
const NAMED = /\{([^}]*)\}/;
const DEFAULT_IMPORT = new RegExp(String.raw`^(${NAME})\s*(?:,|$)`);

/** Whether `name` can be exported by the bindings module: an ASCII identifier, not reserved. */
export function isBindingName(name: string): boolean {
  return IDENTIFIER.test(name) && !RESERVED.has(name);
}

function escapeRegExp(text: string): string {
  return text.replace(/[$]/g, '\\$&');
}

/**
 * Reads one import or export clause (the text between the keyword and `from`): the names it
 * imports, and the local names bound to the whole module (namespace and default imports).
 */
function readClause(keyword: string, clause: string): {names: string[]; objects: string[]} {
  const names: string[] = [];
  const objects: string[] = [];
  const body = clause.replace(/(?<![\w$])from\s*$/, '').trim();
  const namespace = NAMESPACE.exec(body);
  if (namespace) {
    objects.push(namespace[1]);
  }
  const named = NAMED.exec(body);
  if (named) {
    for (const part of named[1].split(',')) {
      const [imported, local] = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .map(text => text.trim());
      if (imported === 'default' && local) {
        objects.push(local);
      } else if (imported) {
        names.push(imported);
      }
    }
  }
  const defaultImport = keyword === 'import' ? DEFAULT_IMPORT.exec(body) : null;
  if (defaultImport) {
    objects.push(defaultImport[1]);
  }
  return {names, objects};
}

/**
 * The function names an ES module takes from `a2ui:bindings`: named imports and re-exports
 * (`{a, b as c}` gives `a` and `b`), and the members used on a namespace or default import
 * (`fns.a(...)`). Names that the module can't export are left out.
 */
export function bindingNames(code: string): string[] {
  const names = new Set<string>();
  const objects = new Set<string>();
  for (const match of code.matchAll(FROM_CLAUSE)) {
    const clause = readClause(match[1], match[2]);
    clause.names.forEach(name => names.add(name));
    clause.objects.forEach(object => objects.add(object));
  }
  for (const object of objects) {
    const member = new RegExp(
      String.raw`(?<![\w$.])${escapeRegExp(object)}\s*\??\.\s*(${NAME})`,
      'g',
    );
    for (const use of code.matchAll(member)) {
      names.add(use[1]);
    }
  }
  return [...names].filter(isBindingName).sort();
}

/**
 * The source of a bindings module exporting `names`, each as a named export and as a member of
 * the default export.
 */
export function bindingsModuleSource(names: readonly string[]): string {
  const exported = names.filter(isBindingName);
  return [
    'import {callFunction} from "a2ui";',
    'const bind = name => (args, options) => callFunction(name, args ?? {}, options);',
    ...exported.map(name => `export const ${name} = bind(${JSON.stringify(name)});`),
    `export default {${exported.join(', ')}};`,
  ].join('\n');
}

/**
 * Points the `a2ui:bindings` imports and re-exports of `code` at a bindings module made for it.
 * `toUrl` turns module source into a URL the frame can import (a blob URL in the browser). Code
 * that doesn't import the module is returned unchanged.
 */
export function linkBindings(code: string, toUrl: (source: string) => string): string {
  if (!new RegExp(FROM_CLAUSE.source).test(code)) {
    return code;
  }
  const url = JSON.stringify(toUrl(bindingsModuleSource(bindingNames(code))));
  return code.replace(
    FROM_CLAUSE,
    (_match, keyword: string, clause: string) => `${keyword}${clause}${url}`,
  );
}
