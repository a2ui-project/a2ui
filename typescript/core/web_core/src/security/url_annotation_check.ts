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
 * @fileoverview Finds catalog properties whose names look like URLs but that
 * carry no `x-a2ui-url-context`, which the resolver would therefore not check
 * against the URL security policy. `tools/build_catalog/url_annotations.py`
 * applies the same rules to catalog files.
 *
 * Package-internal.
 */

import {BASIC_CATALOG_URL_PROPERTIES} from './basic_catalog_url_properties.js';
import {isUrlContextAnnotation, URL_CONTEXT_KEYWORD} from './url_schema.js';

const URL_LIKE_NAME = /^(?:url|uri|href|src)$|(?<=[A-Za-z0-9])(?:Url|URL|Uri|URI)$|_(?:url|uri)$/;
const NON_STRING_TYPES = new Set(['object', 'array', 'number', 'integer', 'boolean', 'null']);

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a property name looks like it holds a URL: `url`, `uri`, `href`,
 * `src`, or a name ending in `Url`, `Uri`, `_url`, or `_uri`.
 *
 * @param name The property name.
 */
export function looksLikeUrlProperty(name: string): boolean {
  return URL_LIKE_NAME.test(name);
}

/** Whether a property schema may hold a string, and so a URL. */
function mayHoldString(schema: unknown): boolean {
  if (!isJsonObject(schema)) return true;
  const declared = schema['type'];
  if (typeof declared === 'string') return !NON_STRING_TYPES.has(declared);
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.some(t => typeof t !== 'string' || !NON_STRING_TYPES.has(t));
  }
  return true;
}

function resolveLocalRef(root: JsonObject, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (isJsonObject(current) && Object.hasOwn(current, part)) current = current[part];
    else if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else return undefined;
  }
  return current;
}

/**
 * Lists the component properties of a catalog document whose URL mark is
 * missing or unknown.
 *
 * Walks every component's properties, following local `$ref`s, `allOf`,
 * `anyOf`, `oneOf`, nested object `properties`, and array `items`. A property
 * is reported when its name looks like a URL, its schema may hold a string,
 * and it has no `x-a2ui-url-context`, unless the built-in list of a basic
 * catalog covers it. A mark other than `media`, `navigation`, `iframe`, or
 * `none` is reported wherever it appears. Functions are not walked: function
 * implementations check their URLs through `DataContext.sanitizeUrl`.
 *
 * @param document The catalog document.
 * @param catalogId The catalog's ID, which selects a built-in list.
 *   Defaults to the ID the document declares.
 * @returns One message per problem, such as
 *   `ProductCard.imageUrl: no x-a2ui-url-context`, in document order.
 */
export function findUrlAnnotationProblems(document: unknown, catalogId?: string): string[] {
  if (!isJsonObject(document) || !isJsonObject(document['components'])) return [];
  const id = catalogId ?? document['catalogId'] ?? document['$id'];
  const builtIn =
    typeof id === 'string' && Object.hasOwn(BASIC_CATALOG_URL_PROPERTIES, id)
      ? BASIC_CATALOG_URL_PROPERTIES[id]
      : {};
  const problems: string[] = [];
  const reported = new Set<string>();
  const report = (label: string, message: string) => {
    if (reported.has(label)) return;
    reported.add(label);
    problems.push(message);
  };

  const check = (prop: unknown, component: string, path: string, name: string) => {
    const label = `${component}.${path}`;
    const mark = isJsonObject(prop) ? prop[URL_CONTEXT_KEYWORD] : undefined;
    if (mark !== undefined) {
      if (!isUrlContextAnnotation(mark)) {
        report(label, `${label}: unknown ${URL_CONTEXT_KEYWORD} value ${JSON.stringify(mark)}`);
      }
      return;
    }
    if (!looksLikeUrlProperty(name) || !mayHoldString(prop)) return;
    const componentBuiltIn = Object.hasOwn(builtIn, component) ? builtIn[component] : {};
    if (Object.hasOwn(componentBuiltIn, path)) return;
    report(label, `${label}: no ${URL_CONTEXT_KEYWORD}`);
  };

  const walk = (schema: unknown, component: string, path: string, seen: ReadonlySet<string>) => {
    if (!isJsonObject(schema)) return;
    const ref = schema['$ref'];
    if (typeof ref === 'string' && !seen.has(ref)) {
      walk(resolveLocalRef(document, ref), component, path, new Set([...seen, ref]));
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      const branches = schema[keyword];
      if (Array.isArray(branches)) {
        for (const branch of branches) walk(branch, component, path, seen);
      }
    }
    const properties = schema['properties'];
    if (isJsonObject(properties)) {
      for (const [name, prop] of Object.entries(properties)) {
        const propPath = path ? `${path}.${name}` : name;
        check(prop, component, propPath, name);
        walk(prop, component, propPath, seen);
      }
    }
    if (isJsonObject(schema['items'])) walk(schema['items'], component, `${path}[]`, seen);
  };

  for (const [component, schema] of Object.entries(document['components'])) {
    walk(schema, component, '', new Set());
  }
  return problems;
}

const warnedCatalogIds = new Set<string>();

/**
 * Warns once per catalog ID, through `console.warn`, about the problems
 * {@link findUrlAnnotationProblems} finds in a catalog document.
 *
 * @param document The catalog document.
 * @param catalogId The catalog's ID.
 */
export function warnAboutUrlAnnotations(document: unknown, catalogId: string): void {
  if (warnedCatalogIds.has(catalogId)) return;
  const problems = findUrlAnnotationProblems(document, catalogId);
  if (problems.length === 0) return;
  warnedCatalogIds.add(catalogId);
  console.warn(
    `Catalog ${catalogId} has URL properties the URL security policy won't check:\n` +
      problems.map(p => `  ${p}`).join('\n') +
      `\nMark each URL property with ${URL_CONTEXT_KEYWORD} (media, navigation, or iframe), ` +
      'or with "none" if it does not hold a URL.',
  );
}
