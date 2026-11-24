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
 * Runs `conformance/agent/macros/macros.yaml` against `MacroExpander`, with the reference
 * macros of `macro-suite.ts`.
 *
 * Each case is checked as Python's harness checks it: a golden or `expect` case against
 * its expectations, and an `expect_error` case against the error category. Macros target
 * v1.0, so cases that need v0.9 macros are skipped.
 */

import {readFileSync} from 'fs';

import {expect} from 'vitest';

import {
  A2uiCatalogError,
  A2uiRecursionError,
  A2uiValidationError,
  type AgentToRendererMessage,
  type CatalogApi,
  validatePayload,
} from '../../src/index.js';
import {LoadedCase, loadCases} from './loader.js';
import {
  GOLDEN_DIR,
  macroVersion,
  runCatalogCase,
  runTransportCase,
  SUITE,
  validationCatalogs,
} from './macro-suite.js';
import {
  assertKnownKeys,
  CASE_METADATA_KEYS,
  conformancePath,
  describeSuite,
  EXPECT_ERROR_KEYS,
} from './suite-helpers.js';

const MACRO_CASE_KEYS = new Set([
  ...CASE_METADATA_KEYS,
  'base_catalogs',
  'catalog_id',
  'colliding_macro',
  'empty_macros',
  'envelope_version',
  'expander_catalog_id',
  'expander_protocol_version',
  'expander_scoped',
  'expect',
  'expect_error',
  'golden',
  'id',
  'input',
  'macro_catalog_id',
  'macro_version',
  'messages',
  'on_error',
  'passthrough_components',
  'surface_catalogs',
  'surface_id',
  'validation',
  'validation_catalogs',
  'version',
]);

const MACRO_EXPECT_KEYS = new Set([
  'absent_any_component_references',
  'absent_components',
  'absent_property_on_all_components',
  'any_component_references',
  'augmented_components',
  'catalog_id',
  'component_count',
  'component_properties',
  'component_types',
  'components',
  'create_surface_catalog_id',
  'has_any_component_discriminator',
  'has_any_function',
  'protocol_version',
]);

const CATALOG_ACTIONS = new Set([
  'to_catalog',
  'transform_catalog',
  'transform_to_inference_catalog',
]);

const VALIDATION_KEYS = new Set([
  'allow_dangling_references',
  'allow_missing_root',
  'allow_orphan_components',
  'skip_renderer_validation',
]);

const ERROR_BY_CATEGORY: Record<string, new (...args: never[]) => Error> = {
  CatalogError: A2uiCatalogError,
  RecursionError: A2uiRecursionError,
  ValidationError: A2uiValidationError,
};

/**
 * Cases that check that the expander rejects an envelope version other than v1.0. They
 * don't depend on the version of the macros, so they run with the v1.0 reference macros.
 */
const VERSION_REJECTION_CASES = new Set(['13_error_envelope_version_mismatch']);

/** Cases whose behavior lands in a later commit of this change. */
const PENDING = new Set([
  '13_error_envelope_version_mismatch',
  '19_envelope_attributes_preservation',
  '20_mixable_catalogs_resolution',
  '30_root_envelope_deep_merge_and_declared_override',
  '33_runtime_failure_and_undeclared_property_fallback',
  '33b_error_on_error_raise_surfaces_validation_error',
  '34_v1_0_multi_catalog_foo_bar_baz_and_defaultless_surface',
  '35_v1_0_auto_stamping_from_base_catalogs_on_defaultless_surface',
  '35b_error_ambiguous_primitive_on_defaultless_surface',
  '36_surface_lifecycle_delete_recreate_and_null_catalog_id',
  '37a_stateless_surface_catalogs_override_expands',
  '37b_stateless_surface_catalogs_override_skips',
  '37c_scoped_expander_skips_untracked_and_invalid_catalog_id',
  '37d_default_macro_catalog_id_expands_after_base_registration',
  '37e_standalone_macro_catalog_surface_default',
  '38a_custom_catalog_collision_and_same_name_wrapper',
  '38b_scoped_nested_macro_and_non_basic_surface',
  '39a_error_deferred_self_recursion_untracked',
  '39b_error_mutual_recursion_defaultless_surface',
  '39c_error_mutual_recursion_foreign_surface',
  '40c_error_lower_v0_9_envelope_with_v1_0_macros',
  '40i_error_v1_0_macro_emitting_reserved_surface_component',
]);

function skipReason(testCase: LoadedCase): string | undefined {
  const needsV09Macros =
    !testCase['empty_macros'] &&
    macroVersion(testCase) !== '1.0' &&
    !VERSION_REJECTION_CASES.has(testCase.name);
  if (needsV09Macros) {
    return 'macros support v1.0 only';
  }
  if (PENDING.has(testCase.name)) {
    return 'not implemented yet';
  }
  return undefined;
}

function runCase(testCase: LoadedCase): CatalogApi | AgentToRendererMessage[] | undefined {
  if (CATALOG_ACTIONS.has(testCase.action)) {
    return runCatalogCase(testCase);
  }
  if (testCase.action === 'build') {
    const messages = runTransportCase(testCase);
    if (messages.length > 0) {
      validateLowered(testCase, messages);
    }
    return messages;
  }
  throw new Error(`Unsupported action ${testCase.action}`);
}

/**
 * Checks lowered messages the way a renderer holding the case's catalogs would, unless the
 * case says the renderer would reject them. `validatePayload` accepts a missing root,
 * dangling references and unreachable components on a surface the payload doesn't
 * create, which covers the relaxations the cases ask for.
 */
function validateLowered(testCase: LoadedCase, messages: unknown): void {
  const validation = (testCase['validation'] ?? {}) as Record<string, unknown>;
  assertKnownKeys(validation, VALIDATION_KEYS, 'validation');
  if (!validation['skip_renderer_validation']) {
    validatePayload(validationCatalogs(testCase), messages);
  }
}

function expectTransport(
  messages: AgentToRendererMessage[],
  expected: Record<string, unknown>,
): void {
  const records = messages as unknown as Array<Record<string, Record<string, unknown>>>;
  const components = records.flatMap(
    message =>
      (message['updateComponents']?.['components'] ?? []) as Array<Record<string, unknown>>,
  );
  if ('create_surface_catalog_id' in expected) {
    const created = records.filter(message => 'createSurface' in message);
    expect(created).toHaveLength(1);
    expect(created[0]['createSurface']['catalogId']).toBe(expected['create_surface_catalog_id']);
  }
  if ('components' in expected) {
    expect(components).toEqual(expected['components']);
  }
  if ('component_types' in expected) {
    expect(components.map(component => component['component'])).toEqual(
      expected['component_types'],
    );
  }
  if ('absent_property_on_all_components' in expected) {
    const property = expected['absent_property_on_all_components'] as string;
    expect(components.filter(component => property in component)).toEqual([]);
  }
}

function expectError(testCase: LoadedCase): void {
  const expected = testCase['expect_error'] as Record<string, unknown>;
  assertKnownKeys(expected, EXPECT_ERROR_KEYS, 'expect_error');
  const errorClass = ERROR_BY_CATEGORY[expected['category'] as string];
  let thrown: unknown;
  try {
    runCase(testCase);
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `Expected case ${testCase.name} to throw`).toBeInstanceOf(errorClass);
  if (typeof expected['message'] === 'string') {
    expect((thrown as Error).message).toMatch(new RegExp(expected['message']));
  }
}

function refTargets(catalog: CatalogApi): string[] {
  const defs = (catalog.validationSchema['$defs'] ?? {}) as Record<string, unknown>;
  const anyComponent = (defs['anyComponent'] ?? {}) as {oneOf?: Array<{$ref?: string}>};
  return (anyComponent.oneOf ?? []).map(ref => ref.$ref ?? '');
}

function expectCatalog(catalog: CatalogApi, expected: Record<string, unknown>): void {
  const document = catalog.toJson();
  const documentComponents = (document['components'] ?? {}) as Record<string, unknown>;
  const defs = (document['$defs'] ?? {}) as Record<string, Record<string, unknown>>;
  const validationComponents = (catalog.validationSchema['components'] ?? {}) as Record<
    string,
    unknown
  >;

  if ('catalog_id' in expected) {
    expect(catalog.id).toBe(expected['catalog_id']);
    expect(document['catalogId']).toBe(expected['catalog_id']);
  }
  if ('component_count' in expected) {
    expect(Object.keys(documentComponents)).toHaveLength(expected['component_count'] as number);
  }
  if ('has_any_component_discriminator' in expected) {
    const discriminator = defs['anyComponent']?.['discriminator'];
    if (expected['has_any_component_discriminator']) {
      expect(discriminator).toEqual({propertyName: 'component'});
    } else {
      expect(discriminator).toBeUndefined();
    }
  }
  if ('has_any_function' in expected) {
    expect('anyFunction' in defs).toBe(Boolean(expected['has_any_function']));
  }
  for (const name of (expected['augmented_components'] ?? []) as string[]) {
    expect(validationComponents, `Expected ${name} in the catalog`).toHaveProperty([name]);
  }
  for (const name of (expected['absent_components'] ?? []) as string[]) {
    expect(validationComponents, `Expected no ${name} in the catalog`).not.toHaveProperty([name]);
  }
  for (const ref of (expected['any_component_references'] ?? []) as string[]) {
    expect(refTargets(catalog)).toContain(ref);
  }
  for (const name of (expected['absent_any_component_references'] ?? []) as string[]) {
    expect(refTargets(catalog).filter(ref => ref.endsWith(`/${name}`))).toEqual([]);
  }
  const componentProperties = (expected['component_properties'] ?? {}) as Record<
    string,
    Record<string, Record<string, unknown>>
  >;
  for (const [name, properties] of Object.entries(componentProperties)) {
    const component = documentComponents[name] as {properties?: Record<string, unknown>};
    expect(component, `${name} not found in the catalog`).toBeDefined();
    for (const [property, schema] of Object.entries(properties)) {
      const actual = component.properties?.[property] as Record<string, unknown> | undefined;
      expect(actual, `Property ${property} missing from ${name}`).toBeDefined();
      for (const [key, value] of Object.entries(schema)) {
        expect(actual?.[key], `${name}.${property}.${key}`).toEqual(value);
      }
    }
  }
  if ('protocol_version' in expected) {
    expect(catalog.protocolVersion).toBe(expected['protocol_version']);
  }
}

describeSuite(
  `Conformance: ${SUITE}`,
  loadCases([conformancePath(SUITE)]),
  testCase => {
    assertKnownKeys(testCase, MACRO_CASE_KEYS, 'macros case');
    if (testCase['expect_error'] !== undefined) {
      expectError(testCase);
      return;
    }
    const result = runCase(testCase);
    if (testCase['golden'] !== undefined) {
      const golden = JSON.parse(
        readFileSync(`${GOLDEN_DIR}/${testCase['golden'] as string}`, 'utf8'),
      ) as unknown;
      expect(result).toEqual(golden);
      return;
    }
    const expected = testCase['expect'] as Record<string, unknown> | undefined;
    if (expected === undefined) {
      throw new Error(`Case ${testCase.name} has no expectation this harness checks`);
    }
    assertKnownKeys(expected, MACRO_EXPECT_KEYS, 'macros expect');
    if (Array.isArray(result)) {
      expectTransport(result, expected);
    } else if (result !== undefined) {
      expectCatalog(result, expected);
    } else {
      throw new Error(`Case ${testCase.name} produced nothing to check`);
    }
  },
  {skipReason},
);
