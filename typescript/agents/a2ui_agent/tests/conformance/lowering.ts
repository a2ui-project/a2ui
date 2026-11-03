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
 * Helpers for lowering v1.0 agent conformance cases to v0.9 and lifting results back to v1.0.
 */

import {readFileSync} from 'fs';
import {basename} from 'path';

import {AgentToRendererMessage, InMemoryCatalogProvider} from '../../src/index.js';
import {CatalogApi} from '../../src/internal/web-core.js';
import {LoadedCase} from './loader.js';
import {conformancePath} from './suite-helpers.js';

export type SuiteVersion = 'v1.0' | 'v0.9-lowered';

export const SUITE_VERSIONS: readonly SuiteVersion[] = ['v1.0', 'v0.9-lowered'];

const RESERVED_KEYS_TO_V09: Record<string, string> = {'@path': 'path', '@call': 'call'};
const RESERVED_KEYS_TO_V10: Record<string, string> = {path: '@path', call: '@call'};

const VERSION_FIELD_RE = /([\u201c"]version[\u201d"]\s*:\s*[\u201c"])(v?1\.0|v0\.9)([\u201d"])/g;
const RESERVED_KEY_FIELD_RE = /"@(path|call)"(?=\s*:)/g;
const CREATE_SURFACE_OPEN_RE = /"createSurface"\s*:\s*\{/g;

const ONE_CATALOG_PER_SURFACE =
  'v0.9 names one catalog per surface, so the case runs as written in v1.0 only.';
const RESERVED_PLAIN_KEYS =
  'v0.9 reserves the plain path and call keys for data bindings and function calls, so a map literal that uses them runs as written in v1.0 only.';
const NO_USER_MESSAGE =
  'The v0.9 Action has no userMessage field, so an event carrying one runs as written in v1.0 only.';

export const V1_ONLY_CASES: Readonly<Record<string, string>> = {
  // Express cases
  test_compile_express_event_user_message: NO_USER_MESSAGE,
  test_compile_express_event_user_message_binding_with_context: NO_USER_MESSAGE,
  test_decompile_express_event_action_with_user_message: NO_USER_MESSAGE,
  test_compile_express_event_user_message_function_call: NO_USER_MESSAGE,
  test_decompile_express_event_action_with_function_call_user_message: NO_USER_MESSAGE,
  test_compile_express_surface_targeting_names_a_catalog: ONE_CATALOG_PER_SURFACE,
  test_decompile_express_two_surfaces_in_two_catalogs: ONE_CATALOG_PER_SURFACE,
  test_decompile_express_event_action_with_nested_context:
    "A v0.9 DynamicValue holds no map, so a map in an event's context runs as written in v1.0 only.",
  test_decompile_express_non_identifier_id_before_v1_0_derives_a_variable:
    'Already written against a v0.9 catalog to test pre-v1.0 component id derivation, so it runs as written without lowering.',
  test_decompile_express_non_identifier_id_from_v1_0_is_a_validation_error:
    'Before v1.0, component ids that are not UAX 31 identifiers are derived into variables rather than rejected.',
  test_compile_express_non_identifier_id_from_v1_0_is_a_validation_error:
    'Before v1.0, component ids need not be UAX 31 identifiers.',
  test_compile_express_map_literal_keeps_keys_named_like_express_constructs: RESERVED_PLAIN_KEYS,
  test_compile_express_map_literal_keeps_quoted_keys_named_like_constructs: RESERVED_PLAIN_KEYS,
  test_compile_express_map_literals_in_function_arguments_keep_their_keys: RESERVED_PLAIN_KEYS,
  test_decompile_express_map_with_keys_named_like_express_constructs: RESERVED_PLAIN_KEYS,
  test_decompile_express_map_with_plain_call_and_args_keys: RESERVED_PLAIN_KEYS,
  test_decompile_express_map_with_a_binding_key_beside_other_keys:
    'Lowered to v0.9, the @path key becomes the plain path key, which v0.9 reserves for data bindings, so the case runs as written in v1.0 only.',
  test_compile_express_map_with_call_like_keys_still_rejects_bindings:
    'Lowered to v0.9, this SDK does not reject a binding nested in a free-form object property.',
  test_compile_express_surface_extensions_variable_reference:
    'Surface extensions are only supported in A2UI v1.0 or later.',
  test_compile_express_empty_extensions_preserved:
    'Surface and component extensions require A2UI v1.0 or later.',
  test_compile_express_standalone_call_renderer_or_agent_function:
    'Protocol v0.9 has no callRendererFunction message.',
  test_compile_express_standalone_call_agent_only_function:
    'Protocol v0.9 has no callRendererFunction message.',
  test_compile_express_standalone_call_renderer_only_function_is_validation_error:
    'Protocol v0.9 has no callRendererFunction message.',
  test_compile_express_standalone_call_user_activation_function_is_validation_error:
    'Protocol v0.9 has no callRendererFunction message.',
  test_generate_prompt_express_callable_from_filtering:
    'Protocol v0.9 function schema does not support callableFrom.',
  test_generate_prompt_express_includes_at_syntax_rule:
    'Protocol v0.9 uses plain path and call keys rather than @path and @call.',
  // Direct JSON cases
  test_compile_json_newline_in_create_surface_data_model_preserved:
    'v0.9 createSurface does not carry inline dataModel.',
  test_parse_response_call_renderer_function_renderer_or_agent_succeeds:
    'Protocol v0.9 has no callRendererFunction message.',
  test_parse_response_call_renderer_function_agent_only_succeeds:
    'Protocol v0.9 has no callRendererFunction message.',
  test_parse_response_call_renderer_function_renderer_only_is_validation_error:
    'Protocol v0.9 has no callRendererFunction message.',
  test_parse_response_call_renderer_function_user_activation_is_validation_error:
    'Protocol v0.9 has no callRendererFunction message.',
  test_stream_create_surface_inline_components_v10:
    'v0.9 createSurface does not carry inline components.',
  test_stream_create_surface_inline_components_in_small_chunks_v10:
    'v0.9 createSurface does not carry inline components.',
  test_stream_multi_catalog_resolution_v10: ONE_CATALOG_PER_SURFACE,
  test_stream_component_catalog_id_arrives_late_v10: ONE_CATALOG_PER_SURFACE,
  test_stream_catalog_id_split_across_chunks_v10: ONE_CATALOG_PER_SURFACE,
  test_stream_second_block_calling_renderer_only_function_fails_v10:
    'Protocol v0.9 function schema does not support callableFrom.',
  test_decompile_json_call_renderer_function: 'Protocol v0.9 has no callRendererFunction message.',
  test_decompile_json_catalog_qualified_components: ONE_CATALOG_PER_SURFACE,
};

/** Swaps between v1.0 and v0.9 version strings. */
export function swapVersion(version: unknown): unknown {
  if (version === '1.0' || version === 'v1.0') return 'v0.9';
  if (version === 'v0.9') return '1.0';
  return version;
}

function isVersionAtLeast10(versionStr: unknown): boolean {
  if (typeof versionStr !== 'string') return false;
  const normalized = versionStr.startsWith('v') ? versionStr.slice(1) : versionStr;
  return normalized.startsWith('1.');
}

function replaceChildRefs(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(replaceChildRefs);
  }
  if (node !== null && typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$ref' && typeof v === 'string' && v.endsWith('#/$defs/Child')) {
        result[k] = v.slice(0, -'#/$defs/Child'.length) + '#/$defs/ComponentId';
      } else {
        result[k] = replaceChildRefs(v);
      }
    }
    return result;
  }
  return node;
}

/** Lowers a v1.0 catalog document object to v0.9. */
export function lowerCatalogDocument(
  document: Record<string, unknown>,
  defaultCatalogId?: string,
): Record<string, unknown> {
  const proto = document['protocolVersion'];
  if (proto !== undefined && !isVersionAtLeast10(proto)) {
    const copy = structuredClone(document);
    if (defaultCatalogId && !('catalogId' in copy)) {
      copy['catalogId'] = defaultCatalogId;
    }
    return copy;
  }

  const doc = replaceChildRefs(structuredClone(document)) as Record<string, unknown>;
  doc['protocolVersion'] = '0.9';
  if (defaultCatalogId && !('catalogId' in doc)) {
    doc['catalogId'] = defaultCatalogId;
  }

  const functions = doc['functions'];
  if (functions !== null && typeof functions === 'object' && !Array.isArray(functions)) {
    const loweredFunctions: Record<string, unknown> = {};
    for (const [fnName, fnVal] of Object.entries(functions as Record<string, unknown>)) {
      if (fnVal !== null && typeof fnVal === 'object' && !Array.isArray(fnVal)) {
        const fnCopy: Record<string, unknown> = {...(fnVal as Record<string, unknown>)};
        delete fnCopy['callableFrom'];
        if (fnCopy['returnType'] === 'validationResult') {
          fnCopy['returnType'] = 'boolean';
        }
        const props = fnCopy['properties'];
        if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
          const propsCopy: Record<string, unknown> = {...(props as Record<string, unknown>)};
          if ('@call' in propsCopy) {
            propsCopy['call'] = propsCopy['@call'];
            delete propsCopy['@call'];
          }
          const retProp = propsCopy['returnType'];
          if (
            retProp !== null &&
            typeof retProp === 'object' &&
            (retProp as Record<string, unknown>)['const'] === 'validationResult'
          ) {
            propsCopy['returnType'] = {const: 'boolean'};
          }
          fnCopy['properties'] = propsCopy;
        }
        if (Array.isArray(fnCopy['required'])) {
          fnCopy['required'] = (fnCopy['required'] as unknown[]).map(r =>
            r === '@call' ? 'call' : r,
          );
        }
        loweredFunctions[fnName] = fnCopy;
      } else {
        loweredFunctions[fnName] = fnVal;
      }
    }
    doc['functions'] = loweredFunctions;
  }

  const defs = doc['$defs'];
  if (defs !== null && typeof defs === 'object') {
    const anyFn = (defs as Record<string, unknown>)['anyFunction'];
    if (anyFn !== null && typeof anyFn === 'object') {
      const disc = (anyFn as Record<string, unknown>)['discriminator'];
      if (
        disc !== null &&
        typeof disc === 'object' &&
        (disc as Record<string, unknown>)['propertyName'] === '@call'
      ) {
        (disc as Record<string, unknown>)['propertyName'] = 'call';
      }
    }
  }

  return doc;
}

/** Loads a catalog from a relative conformance path, optionally lowering it to v0.9. */
export function loadCatalogFromRelativePath(relativePath: string, lower = false): CatalogApi {
  const fullPath = conformancePath(relativePath);
  const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  const defaultId = basename(relativePath, '.json');
  const doc = lower ? lowerCatalogDocument(raw, defaultId) : raw;
  return new InMemoryCatalogProvider(doc).load();
}

function readRawCatalogDoc(entry: unknown): {doc: Record<string, unknown>; defaultId?: string} {
  const inner =
    entry !== null && typeof entry === 'object' && 'catalog' in (entry as Record<string, unknown>)
      ? (entry as Record<string, unknown>)['catalog']
      : entry;
  if (typeof inner === 'string') {
    const doc = JSON.parse(readFileSync(conformancePath(inner), 'utf8')) as Record<string, unknown>;
    return {doc, defaultId: basename(inner, '.json')};
  }
  if (inner !== null && typeof inner === 'object') {
    return {doc: inner as Record<string, unknown>, defaultId: 'inline'};
  }
  return {doc: {}};
}

/** Returns the declared protocolVersion of the first catalog in args, or undefined. */
export function caseCatalogVersion(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  let entry = args['catalog'];
  if (entry === undefined && Array.isArray(args['catalogs']) && args['catalogs'].length > 0) {
    entry = args['catalogs'][0];
  }
  if (entry === undefined) return undefined;
  const {doc} = readRawCatalogDoc(entry);
  return typeof doc['protocolVersion'] === 'string' ? doc['protocolVersion'] : undefined;
}

/** Returns true if any catalog in args declares v1.0 or later. */
export function caseDeclaresV1(args: Record<string, unknown> | undefined): boolean {
  if (!args) return true;
  const entries: unknown[] = [];
  if (args['catalog'] !== undefined) entries.push(args['catalog']);
  if (Array.isArray(args['catalogs'])) entries.push(...args['catalogs']);
  if (entries.length === 0) return true;
  return entries.some(entry => {
    const {doc} = readRawCatalogDoc(entry);
    const proto = doc['protocolVersion'];
    return proto === undefined || isVersionAtLeast10(proto);
  });
}

/** Returns the catalogId of the first catalog in args. */
export function firstCatalogId(
  args: Record<string, unknown> | undefined,
  defaultCatalog = 'test_data/catalogs/simplified_catalog_v1_0.json',
): string | undefined {
  let entry = args?.['catalog'];
  if (entry === undefined && Array.isArray(args?.['catalogs']) && args['catalogs'].length > 0) {
    entry = args['catalogs'][0];
  }
  if (entry === undefined) {
    entry = defaultCatalog;
  }
  const {doc, defaultId} = readRawCatalogDoc(entry);
  return (doc['catalogId'] as string | undefined) ?? defaultId;
}

/** Returns the catalogId to inject into v0.9 createSurface payloads, or undefined. */
export function injectedCatalogId(
  testCase: LoadedCase,
  defaultCatalog = 'test_data/catalogs/simplified_catalog_v1_0.json',
): string | undefined {
  if (JSON.stringify(testCase).includes('catalogId')) {
    return undefined;
  }
  return firstCatalogId(testCase.args, defaultCatalog);
}

/** Lowers a raw JSON payload string from v1.0 to v0.9. */
export function lowerText(text: string, catalogId?: string): string {
  let lowered = text
    .replace(VERSION_FIELD_RE, (_m, p1, p2, p3) => `${p1}${String(swapVersion(p2))}${p3}`)
    .replace(RESERVED_KEY_FIELD_RE, '"$1"');
  if (catalogId !== undefined) {
    lowered = lowered.replace(
      CREATE_SURFACE_OPEN_RE,
      `"createSurface": {"catalogId": ${JSON.stringify(catalogId)}, `,
    );
  }
  return lowered;
}

function renameKeysIn(node: unknown, lower: boolean): unknown {
  if (Array.isArray(node)) {
    return node.map(item => renameKeysIn(item, lower));
  }
  if (node !== null && typeof node === 'object') {
    const map = node as Record<string, unknown>;
    const isTemplate = 'componentId' in map;
    const keyMap = lower ? RESERVED_KEYS_TO_V09 : RESERVED_KEYS_TO_V10;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map)) {
      const nextKey = isTemplate ? k : (keyMap[k] ?? k);
      result[nextKey] = renameKeysIn(v, lower);
    }
    return result;
  }
  return node;
}

function renameReservedKeys(
  message: Record<string, unknown>,
  lower: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(message)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const body: Record<string, unknown> = {};
      for (const [fieldK, fieldV] of Object.entries(v as Record<string, unknown>)) {
        if (fieldK === 'components' || fieldK === 'callFunction') {
          body[fieldK] = renameKeysIn(fieldV, lower);
        } else {
          body[fieldK] = structuredClone(fieldV);
        }
      }
      result[k] = body;
    } else {
      result[k] = structuredClone(v);
    }
  }
  return result;
}

/** Lowers v1.0 message objects into v0.9 message objects. */
export function lowerMessages(
  messages: readonly Record<string, unknown>[],
  defaultCatalogId?: string,
): AgentToRendererMessage[] {
  const lowered: Record<string, unknown>[] = [];
  for (const message of messages) {
    const msg = renameReservedKeys(message, true);
    msg['version'] = swapVersion(msg['version']);
    const createBody = msg['createSurface'];
    if (createBody !== null && typeof createBody === 'object' && !Array.isArray(createBody)) {
      const create: Record<string, unknown> = {...(createBody as Record<string, unknown>)};
      const components = create['components'];
      const dataModel = create['dataModel'];
      delete create['components'];
      delete create['dataModel'];
      if (defaultCatalogId !== undefined && !('catalogId' in create)) {
        create['catalogId'] = defaultCatalogId;
      }
      const surfaceId = create['surfaceId'];
      lowered.push({version: msg['version'], createSurface: create});
      if (components !== undefined) {
        lowered.push({
          version: msg['version'],
          updateComponents: {surfaceId, components},
        });
      }
      if (dataModel !== undefined) {
        lowered.push({
          version: msg['version'],
          updateDataModel: {surfaceId, path: '/', value: dataModel},
        });
      }
    } else {
      lowered.push(msg);
    }
  }
  return lowered as unknown as AgentToRendererMessage[];
}

/** Lifts v0.9 message objects back to the v1.0 conformance shape. */
export function liftMessages(
  messages: readonly unknown[],
  options: {join?: boolean; injectedCatalogId?: string} = {},
): Record<string, unknown>[] {
  const {join = false, injectedCatalogId: injId} = options;
  const lifted: Record<string, unknown>[] = [];
  for (const rawMsg of messages) {
    const msg = renameReservedKeys(rawMsg as Record<string, unknown>, false);
    const last = lifted[lifted.length - 1];
    const lastCreate =
      last && typeof last['createSurface'] === 'object' && last['createSurface'] !== null
        ? (last['createSurface'] as Record<string, unknown>)
        : undefined;
    const lastSurfaceId = lastCreate?.['surfaceId'];

    const updComp = msg['updateComponents'] as Record<string, unknown> | undefined;
    if (
      join &&
      lastCreate !== undefined &&
      updComp !== undefined &&
      updComp !== null &&
      updComp['surfaceId'] === lastSurfaceId &&
      !('components' in lastCreate)
    ) {
      lastCreate['components'] = updComp['components'];
      continue;
    }

    const updDm = msg['updateDataModel'] as Record<string, unknown> | undefined;
    if (
      join &&
      lastCreate !== undefined &&
      updDm !== undefined &&
      updDm !== null &&
      updDm['surfaceId'] === lastSurfaceId &&
      updDm['path'] === '/' &&
      !('dataModel' in lastCreate)
    ) {
      lastCreate['dataModel'] = updDm['value'];
      continue;
    }

    const createBody = msg['createSurface'] as Record<string, unknown> | undefined;
    if (createBody !== undefined && createBody !== null) {
      const create: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(createBody)) {
        if (k === 'sendDataModel' && v === false) continue;
        if (injId !== undefined && k === 'catalogId' && v === injId) continue;
        create[k] = v;
      }
      lifted.push({
        version: swapVersion(msg['version']),
        createSurface: create,
      });
    } else {
      lifted.push({
        ...msg,
        version: swapVersion(msg['version']),
      });
    }
  }
  return lifted;
}

/** Lifts parsed response parts from v0.9 to v1.0. */
export function liftParts<T>(
  parts: readonly T[],
  options: {join?: boolean; injectedCatalogId?: string} = {},
): T[] {
  return parts.map(part => {
    if (part !== null && typeof part === 'object' && 'a2ui' in (part as Record<string, unknown>)) {
      const p = part as unknown as {a2ui: unknown[]};
      return {
        ...p,
        a2ui: liftMessages(p.a2ui, options),
      } as unknown as T;
    }
    return part;
  });
}

/** Returns a skip reason if the case cannot run lowered to v0.9, or undefined. */
export function v09SkipReason(testCase: LoadedCase): string | undefined {
  if (testCase.name in V1_ONLY_CASES) {
    return V1_ONLY_CASES[testCase.name];
  }
  if (testCase.sourceFile === 'agent/multi_catalog_formats.yaml') {
    return ONE_CATALOG_PER_SURFACE;
  }
  const args = testCase.args;
  if (args) {
    if (Array.isArray(args['catalogs']) && args['catalogs'].length > 1) {
      return ONE_CATALOG_PER_SURFACE;
    }
    const fmt = args['format'];
    if (fmt === 'elemental' || fmt === 'atom') {
      return `Experimental format ${fmt} does not target lowered v0.9 suites.`;
    }
    const catVer = caseCatalogVersion(args);
    if (catVer === '0.8' || catVer === 'v0.8' || catVer === '0.9' || catVer === 'v0.9') {
      return `Case already targets protocol version ${catVer}.`;
    }
    if (fmt === 'direct_json' && testCase.action === 'generate_prompt_snippet') {
      return "The Direct JSON snippet embeds the schemas of the catalogs' version, so the case runs as written in v1.0 only.";
    }
  }
  if (JSON.stringify(testCase).includes('"callRendererFunction"')) {
    return 'Protocol v0.9 has no callRendererFunction message.';
  }
  return undefined;
}
