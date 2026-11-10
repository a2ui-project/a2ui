/*
 * Copyright 2026 Google LLC
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
 * Runs the `url_policy_check` and `url_policy_resolution` cases of
 * `conformance/core/url_security_policy.yaml`.
 */

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {Catalog, ComponentApi} from '../../src/catalog/types.js';
import {basicCatalog as v1BasicCatalog} from '../../src/catalogs/basic/v1/catalog.js';
import {MessageProcessor} from '../../src/processing/message-processor.js';
import {ComponentContext} from '../../src/resolution/component-context.js';
import {GenericBinder} from '../../src/resolution/generic-binder.js';
import {AllowlistUrlSecurityPolicy} from '../../src/security/allowlist_url_security_policy.js';
import {
  applyUrlSecurityPolicy,
  PermissiveUrlSecurityPolicy,
  type UrlContext,
  type UrlSecurityPolicy,
} from '../../src/security/url_security_policy.js';
import {A2uiErrorPayload, SurfaceModel} from '../../src/state/surface-model.js';

type Json = Record<string, unknown>;

interface PolicySpec {
  type: 'permissive' | 'allowlist';
  media?: string[];
  navigation?: string[];
  iframe?: string[];
  allowRelative?: UrlContext[];
  allowSvgDataUrls?: boolean;
  rewrite?: Partial<Record<UrlContext, {prefix: string}>>;
}

interface CheckCase {
  name: string;
  policy: PolicySpec;
  steps: Array<{url: string; context: UrlContext; expect: string | null}>;
}

interface ResolutionExpect {
  components?: Record<string, Json>;
  openedUrls?: string[];
  errors?: Array<{code?: string; surfaceId?: string; message?: string}>;
}

interface ResolutionCase {
  name: string;
  protocolVersion?: string;
  catalogPaths?: string[];
  catalogs?: Json[];
  policy: PolicySpec;
  messages: unknown[];
  expect: ResolutionExpect;
  steps?: Array<{
    messages?: unknown[];
    dispatchAction?: {surfaceId: string; componentId: string; userActivation?: boolean};
    expect: ResolutionExpect;
  }>;
}

const KNOWN_KEYS = {
  check: new Set(['name', 'description', 'action', 'policy', 'steps']),
  checkStep: new Set(['url', 'context', 'expect']),
  policy: new Set([
    'type',
    'media',
    'navigation',
    'iframe',
    'allowRelative',
    'allowSvgDataUrls',
    'rewrite',
  ]),
  resolution: new Set([
    'name',
    'description',
    'action',
    'protocolVersion',
    'catalogPaths',
    'catalogs',
    'policy',
    'messages',
    'expect',
    'steps',
  ]),
  resolutionStep: new Set(['messages', 'dispatchAction', 'expect']),
  dispatchAction: new Set(['surfaceId', 'componentId', 'userActivation']),
  expect: new Set(['components', 'openedUrls', 'errors']),
  error: new Set(['code', 'surfaceId', 'message']),
};

function assertKnownKeys(obj: unknown, allowed: Set<string>, where: string): void {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    assert.ok(allowed.has(key), `${where}: unknown key '${key}'`);
  }
}

/** Builds the policy a case describes. */
function buildPolicy(spec: PolicySpec, where: string): UrlSecurityPolicy {
  assertKnownKeys(spec, KNOWN_KEYS.policy, `${where}.policy`);
  if (spec.type === 'permissive') {
    return new PermissiveUrlSecurityPolicy({allowSvgDataUrls: spec.allowSvgDataUrls});
  }
  assert.equal(spec.type, 'allowlist', `${where}: unknown policy type '${spec.type}'`);
  const rewrite: Partial<Record<UrlContext, (url: string) => string>> = {};
  for (const [context, hook] of Object.entries(spec.rewrite ?? {})) {
    // Only absolute http(s) URLs are proxied; others pass unchanged.
    rewrite[context as UrlContext] = url =>
      /^https?:\/\//i.test(url) ? `${hook!.prefix}${encodeURIComponent(url)}` : url;
  }
  return new AllowlistUrlSecurityPolicy({
    media: spec.media,
    navigation: spec.navigation,
    iframe: spec.iframe,
    allowRelative: spec.allowRelative,
    allowSvgDataUrls: spec.allowSvgDataUrls,
    rewrite,
  });
}

/** Runs one `url_policy_check` case. */
export function runUrlPolicyCheckCase(testCase: CheckCase): void {
  assertKnownKeys(testCase, KNOWN_KEYS.check, testCase.name);
  const policy = buildPolicy(testCase.policy, testCase.name);
  testCase.steps.forEach((step, i) => {
    assertKnownKeys(step, KNOWN_KEYS.checkStep, `${testCase.name}.steps[${i}]`);
    const actual = applyUrlSecurityPolicy(policy, step.url, step.context) ?? null;
    assert.equal(
      actual,
      step.expect,
      `${testCase.name}.steps[${i}]: ${JSON.stringify(step.url)} as ${step.context}`,
    );
  });
}

/** Catalogs web_core implements itself, which carry function implementations. */
const SDK_CATALOGS = new Map<string, Catalog<ComponentApi>>([[v1BasicCatalog.id, v1BasicCatalog]]);

function loadCatalogs(testCase: ResolutionCase, conformanceRoot: string): Catalog<ComponentApi>[] {
  const documents = [
    ...(testCase.catalogPaths ?? []).map(
      p => JSON.parse(readFileSync(join(conformanceRoot, '..', p), 'utf8')) as Json,
    ),
    ...(testCase.catalogs ?? []),
  ];
  return documents.map(doc => {
    const sdk = SDK_CATALOGS.get(doc['catalogId'] as string);
    return sdk ?? (Catalog.fromJson(doc) as unknown as Catalog<ComponentApi>);
  });
}

/** Drops function-valued and undefined keys, which aren't JSON. */
function toJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== 'function' && v !== undefined) out[k] = toJson(v);
    }
    return out;
  }
  return value;
}

/**
 * Checks `actual` against `expected`: `null` matches an absent or null value
 * at any depth, objects check only the keys `expected` names, and everything
 * else compares as JSON.
 */
function assertMatches(actual: unknown, expected: unknown, where: string): void {
  if (expected === null) {
    assert.ok(
      actual === undefined || actual === null,
      `${where}: expected null, got ${JSON.stringify(actual)}`,
    );
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected an array, got ${JSON.stringify(actual)}`);
    assert.equal(actual.length, expected.length, `${where}: length`);
    expected.forEach((item, i) => assertMatches(actual[i], item, `${where}[${i}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(
      actual && typeof actual === 'object' && !Array.isArray(actual),
      `${where}: expected an object, got ${JSON.stringify(actual)}`,
    );
    for (const [key, value] of Object.entries(expected)) {
      assertMatches((actual as Json)[key], value, `${where}.${key}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, where);
}

/** Runs one `url_policy_resolution` case. */
export async function runUrlPolicyResolutionCase(
  testCase: ResolutionCase,
  conformanceRoot: string,
): Promise<void> {
  const name = testCase.name;
  assertKnownKeys(testCase, KNOWN_KEYS.resolution, name);
  const openedUrls: string[] = [];
  const errors: A2uiErrorPayload[] = [];
  const processor = new MessageProcessor(loadCatalogs(testCase, conformanceRoot), undefined, {
    urlSecurityPolicy: buildPolicy(testCase.policy, name),
    openUrlHandler: url => {
      openedUrls.push(url);
    },
    reportErrorsOnly: true,
  });
  processor.model.onSurfaceCreated.subscribe(surface => {
    surface.onError.subscribe(error => {
      errors.push(error);
    });
  });
  const binders = new Map<string, GenericBinder<Json>>();
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  const surfaceFor = (componentId: string): SurfaceModel<ComponentApi> => {
    for (const surface of processor.model.surfacesMap.values()) {
      if (surface.componentsModel.get(componentId)) return surface;
    }
    throw new Error(`${name}: no surface has component '${componentId}'`);
  };
  const propsOf = (componentId: string): Json => {
    let binder = binders.get(componentId);
    if (!binder) {
      const surface = surfaceFor(componentId);
      const model = surface.componentsModel.get(componentId)!;
      const api = model.catalog.components.get(model.type)!;
      binder = new GenericBinder<Json>(new ComponentContext(surface, componentId), api.schema);
      binder.subscribe(() => {});
      binders.set(componentId, binder);
    }
    return toJson(binder.snapshot) as Json;
  };
  const check = (expect: ResolutionExpect, where: string, afterAction: boolean) => {
    assertKnownKeys(expect, KNOWN_KEYS.expect, where);
    for (const [id, props] of Object.entries(expect.components ?? {})) {
      assertMatches(propsOf(id), props, `${where}.components.${id}`);
    }
    if (!afterAction) {
      assert.ok(
        expect.openedUrls === undefined && expect.errors === undefined,
        `${where}: openedUrls and errors are only checked after dispatchAction`,
      );
      return;
    }
    assert.deepEqual(openedUrls, expect.openedUrls ?? [], `${where}.openedUrls`);
    const expectedErrors = expect.errors ?? [];
    assert.equal(
      errors.length,
      expectedErrors.length,
      `${where}.errors: ${JSON.stringify(errors.map(e => e.code))}`,
    );
    expectedErrors.forEach((expected, i) => {
      assertKnownKeys(expected, KNOWN_KEYS.error, `${where}.errors[${i}]`);
      if (expected.code !== undefined) assert.equal(errors[i].code, expected.code);
      if (expected.surfaceId !== undefined) assert.equal(errors[i].surfaceId, expected.surfaceId);
      if (expected.message !== undefined) {
        assert.match(String(errors[i].message), new RegExp(expected.message));
      }
    });
  };

  processor.processMessages(testCase.messages as never);
  await flush();
  check(testCase.expect, `${name}.expect`, false);

  for (const [i, step] of (testCase.steps ?? []).entries()) {
    const where = `${name}.steps[${i}]`;
    assertKnownKeys(step, KNOWN_KEYS.resolutionStep, where);
    assert.ok(
      (step.messages === undefined) !== (step.dispatchAction === undefined),
      `${where}: a step has exactly one of messages and dispatchAction`,
    );
    openedUrls.length = 0;
    errors.length = 0;
    if (step.messages) {
      processor.processMessages(step.messages as never);
      await flush();
      check(step.expect, `${where}.expect`, false);
      continue;
    }
    const dispatch = step.dispatchAction!;
    assertKnownKeys(dispatch, KNOWN_KEYS.dispatchAction, `${where}.dispatchAction`);
    const surface = processor.model.getSurface(dispatch.surfaceId);
    assert.ok(surface, `${where}: no surface '${dispatch.surfaceId}'`);
    const context = new ComponentContext(surface, dispatch.componentId);
    const action = context.componentModel.properties['action'];
    let resolved = context.dataContext.resolveAction(action, {
      userActivation: dispatch.userActivation ?? true,
    });
    if (resolved && typeof (resolved as Promise<unknown>).then === 'function') {
      resolved = await resolved;
    }
    if (resolved && typeof resolved === 'object' && 'event' in resolved) {
      await context.dispatchAction(resolved);
    }
    await flush();
    check(step.expect, `${where}.expect`, true);
  }

  for (const binder of binders.values()) binder.dispose();
  processor.dispose();
}
