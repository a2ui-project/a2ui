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
 * Hand-written, zero-dependency, Closure-Compiler-safe protocol wire validators
 * for A2UI v0.9, v0.9.1, and v1.0 message envelopes and common envelope payloads.
 *
 * All wire keys are quoted or accessed via bracket notation so property renaming
 * during advanced minification never alters wire validation behavior.
 */

import {normalizeVersionString} from '../common/semver.js';
import {isValidUax31Identifier} from '../common/uax31.js';
import {
  describeValueType,
  isPlainRecord,
  isValidRfc3339DateTime,
} from '../catalog/model/format_validators.js';
import {
  validateCatalogValue,
  type ValidationIssue,
  type ValidationOutcome,
} from '../catalog/model/model_validator.js';

const V10_VALIDATION_ERROR_CODES = new Set([
  'VALIDATION_FAILED',
  'UNALLOWED_PARENT',
  'UNALLOWED_CHILD',
]);

function pushTypeIssue(
  issues: ValidationIssue[],
  path: readonly (string | number)[],
  expected: string,
  value: unknown,
): void {
  const rec = describeValueType(value);
  issues.push({
    path,
    code: 'invalid_type',
    expected,
    received: rec,
    message: value === undefined ? 'Required' : `Expected ${expected}, received ${rec}`,
  });
}

function checkV10Version(raw: Record<string, unknown>, issues: ValidationIssue[]): void {
  const version = raw['version'];
  if (version !== '1.0') {
    issues.push({
      path: ['version'],
      code: version === undefined ? 'invalid_type' : 'invalid_literal',
      expected: "'1.0'",
      received: version === undefined ? 'undefined' : describeValueType(version),
      message: version === undefined ? 'Required' : 'Invalid literal value, expected "1.0"',
    });
  }
}

function checkStrictKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  const unknown = Object.keys(obj).filter(k => !allowed.has(k));
  if (unknown.length > 0) {
    issues.push({
      path,
      code: 'unrecognized_keys',
      keys: unknown,
      message: `Unrecognized key(s) in object: ${unknown.map(k => `'${k}'`).join(', ')}`,
    });
  }
}

function checkRequiredString(
  obj: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  const val = obj[key];
  if (typeof val !== 'string') {
    pushTypeIssue(issues, [...path, key], 'string', val);
  }
}

function checkOptionalString(
  obj: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  const val = obj[key];
  if (val !== undefined && typeof val !== 'string') {
    pushTypeIssue(issues, [...path, key], 'string', val);
  }
}

function checkOptionalBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  const val = obj[key];
  if (val !== undefined && typeof val !== 'boolean') {
    pushTypeIssue(issues, [...path, key], 'boolean', val);
  }
}

function checkExtensions(
  val: unknown,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  if (!isPlainRecord(val)) {
    pushTypeIssue(issues, path, 'object', val);
    return;
  }
  for (const key of Object.keys(val)) {
    if (!isValidUax31Identifier(key)) {
      issues.push({
        path: [...path, key],
        code: 'custom',
        message: `Invalid extension key "${key}": Keys MUST be Unicode identifiers (UAX #31).`,
      });
    }
  }
}

function checkMetadataObject(
  val: unknown,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  if (!isPlainRecord(val)) {
    pushTypeIssue(issues, path, 'object', val);
    return;
  }
  checkStrictKeys(val, new Set(['extensions']), path, issues);
  if (val['extensions'] !== undefined) {
    checkExtensions(val['extensions'], [...path, 'extensions'], issues);
  }
}

function checkV10ComponentsList(
  val: unknown,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(val)) {
    pushTypeIssue(issues, path, 'array', val);
    return;
  }
  if (val.length < 1) {
    issues.push({
      path,
      code: 'too_small',
      message: 'Array must contain at least 1 element(s)',
    });
    return;
  }
  for (let i = 0; i < val.length; i++) {
    const item = val[i];
    const itemPath = [...path, i];
    if (!isPlainRecord(item)) {
      pushTypeIssue(issues, itemPath, 'object', item);
      continue;
    }
    checkRequiredString(item, 'id', itemPath, issues);
    checkRequiredString(item, 'component', itemPath, issues);
    if (item['component'] === 'Surface') {
      issues.push({
        path: itemPath,
        code: 'custom',
        message:
          'Component type cannot be "Surface". "Surface" is a top-level protocol container defined in createSurface, not a child component.',
      });
    }
  }
}

function checkV10FunctionCall(
  val: unknown,
  path: readonly (string | number)[],
  requireCatalogId: boolean,
  issues: ValidationIssue[],
): void {
  if (!isPlainRecord(val)) {
    pushTypeIssue(issues, path, 'object', val);
    return;
  }
  const hasAtCall = Object.hasOwn(val, '@call') && val['@call'] !== undefined;
  const hasCall = Object.hasOwn(val, 'call') && val['call'] !== undefined;
  if (hasAtCall && typeof val['@call'] !== 'string') {
    pushTypeIssue(issues, [...path, '@call'], 'string', val['@call']);
  }
  if (hasCall && typeof val['call'] !== 'string') {
    pushTypeIssue(issues, [...path, 'call'], 'string', val['call']);
  }
  if (!hasAtCall && !hasCall) {
    issues.push({
      path,
      code: 'custom',
      message: "Either '@call' or 'call' must be provided.",
    });
  } else if (hasAtCall && hasCall) {
    issues.push({
      path,
      code: 'custom',
      message: "Cannot specify both '@call' and 'call'.",
    });
  }
  if (val['args'] !== undefined && !isPlainRecord(val['args'])) {
    const received = describeValueType(val['args']);
    issues.push({
      path: [...path, 'args'],
      code: 'invalid_type',
      expected: 'object',
      received,
      message: `Function call must pass an object for 'args', received ${received}`,
    });
  }
  if (requireCatalogId) {
    checkRequiredString(val, 'catalogId', path, issues);
  } else {
    checkOptionalString(val, 'catalogId', path, issues);
  }
}

function checkFunctionResponse(
  val: unknown,
  path: readonly (string | number)[],
  issues: ValidationIssue[],
): void {
  if (!isPlainRecord(val)) {
    pushTypeIssue(issues, path, 'object', val);
    return;
  }
  checkStrictKeys(val, new Set(['functionCallId', 'value', 'error']), path, issues);
  checkRequiredString(val, 'functionCallId', path, issues);
  const hasValue = Object.hasOwn(val, 'value');
  const hasError = Object.hasOwn(val, 'error');
  if (hasError) {
    const errObj = val['error'];
    const errPath = [...path, 'error'];
    if (!isPlainRecord(errObj)) {
      pushTypeIssue(issues, errPath, 'object', errObj);
    } else {
      checkStrictKeys(errObj, new Set(['code', 'message']), errPath, issues);
      checkRequiredString(errObj, 'code', errPath, issues);
      checkRequiredString(errObj, 'message', errPath, issues);
    }
  }
  if ((hasValue && hasError) || (!hasValue && !hasError)) {
    issues.push({
      path,
      code: 'custom',
      message: 'FunctionResponse must have either "value" or "error", but not both or neither.',
    });
  }
}

/**
 * Validates a v0.9 / v0.9.1 server-to-client message envelope without Zod.
 */
export function validateV09AgentToRendererMessage(
  raw: unknown,
): ValidationOutcome<Record<string, unknown>> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(raw)) {
    pushTypeIssue(issues, [], 'object', raw);
    return {success: false, issues};
  }
  const version = raw['version'];
  if (version !== 'v0.9' && version !== 'v0.9.1') {
    issues.push({
      path: ['version'],
      code: version === undefined ? 'invalid_type' : 'invalid_enum_value',
      expected: "'v0.9' | 'v0.9.1'",
      received: version === undefined ? 'undefined' : String(version),
      options: ['v0.9', 'v0.9.1'],
      message:
        version === undefined
          ? 'Required'
          : `Invalid enum value. Expected 'v0.9' | 'v0.9.1', received '${String(version)}'`,
    });
  }

  const actions = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'].filter(
    k => Object.hasOwn(raw, k),
  );
  if (actions.length !== 1) {
    issues.push({
      path: [],
      code: 'custom',
      message: 'Message must contain exactly one v0.9 action key.',
    });
    return {success: false, issues};
  }
  const actionKey = actions[0];
  checkStrictKeys(raw, new Set(['version', actionKey]), [], issues);
  const body = raw[actionKey];
  if (!isPlainRecord(body)) {
    pushTypeIssue(issues, [actionKey], 'object', body);
    return {success: false, issues};
  }

  switch (actionKey) {
    case 'createSurface':
      checkStrictKeys(
        body,
        new Set(['surfaceId', 'catalogId', 'theme', 'sendDataModel']),
        [actionKey],
        issues,
      );
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      checkRequiredString(body, 'catalogId', [actionKey], issues);
      checkOptionalBoolean(body, 'sendDataModel', [actionKey], issues);
      break;
    case 'updateComponents': {
      checkStrictKeys(body, new Set(['surfaceId', 'components']), [actionKey], issues);
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      const comps = body['components'];
      if (!Array.isArray(comps)) {
        pushTypeIssue(issues, [actionKey, 'components'], 'array', comps);
      } else if (comps.length < 1) {
        issues.push({
          path: [actionKey, 'components'],
          code: 'too_small',
          message: 'Array must contain at least 1 element(s)',
        });
      } else {
        for (let i = 0; i < comps.length; i++) {
          if (!isPlainRecord(comps[i])) {
            pushTypeIssue(issues, [actionKey, 'components', i], 'object', comps[i]);
          }
        }
      }
      break;
    }
    case 'updateDataModel':
      checkStrictKeys(body, new Set(['surfaceId', 'path', 'value']), [actionKey], issues);
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      checkOptionalString(body, 'path', [actionKey], issues);
      break;
    case 'deleteSurface':
      checkStrictKeys(body, new Set(['surfaceId']), [actionKey], issues);
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      break;
  }

  return issues.length === 0 ? {success: true, data: raw} : {success: false, issues};
}

/**
 * Validates a v1.0 agent-to-renderer message envelope without Zod.
 */
export function validateV10AgentToRendererMessage(
  raw: unknown,
): ValidationOutcome<Record<string, unknown>> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(raw)) {
    pushTypeIssue(issues, [], 'object', raw);
    return {success: false, issues};
  }
  checkV10Version(raw, issues);

  const knownActions = [
    'createSurface',
    'updateComponents',
    'updateDataModel',
    'deleteSurface',
    'callRendererFunction',
    'agentFunctionResponse',
  ];
  const actions = knownActions.filter(k => Object.hasOwn(raw, k));
  if (actions.length !== 1) {
    issues.push({
      path: [],
      code: 'custom',
      message: 'Message must contain exactly one v1.0 action key.',
    });
    return {success: false, issues};
  }
  const actionKey = actions[0];
  checkStrictKeys(raw, new Set(['version', actionKey]), [], issues);
  const body = raw[actionKey];
  if (!isPlainRecord(body)) {
    pushTypeIssue(issues, [actionKey], 'object', body);
    return {success: false, issues};
  }

  switch (actionKey) {
    case 'createSurface':
      checkStrictKeys(
        body,
        new Set(['surfaceId', 'catalogId', 'sendDataModel', 'components', 'dataModel', 'metadata']),
        [actionKey],
        issues,
      );
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      checkOptionalString(body, 'catalogId', [actionKey], issues);
      checkOptionalBoolean(body, 'sendDataModel', [actionKey], issues);
      if (body['components'] !== undefined) {
        checkV10ComponentsList(body['components'], [actionKey, 'components'], issues);
      }
      if (body['dataModel'] !== undefined && !isPlainRecord(body['dataModel'])) {
        pushTypeIssue(issues, [actionKey, 'dataModel'], 'object', body['dataModel']);
      }
      if (body['metadata'] !== undefined) {
        checkMetadataObject(body['metadata'], [actionKey, 'metadata'], issues);
      }
      break;
    case 'updateComponents':
      checkStrictKeys(body, new Set(['surfaceId', 'components']), [actionKey], issues);
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      checkV10ComponentsList(body['components'], [actionKey, 'components'], issues);
      break;
    case 'updateDataModel':
      checkStrictKeys(body, new Set(['surfaceId', 'path', 'value']), [actionKey], issues);
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      checkOptionalString(body, 'path', [actionKey], issues);
      if (!Object.hasOwn(body, 'value')) {
        pushTypeIssue(issues, [actionKey, 'value'], 'any', undefined);
      }
      break;
    case 'deleteSurface':
      checkStrictKeys(body, new Set(['surfaceId']), [actionKey], issues);
      checkRequiredString(body, 'surfaceId', [actionKey], issues);
      break;
    case 'callRendererFunction':
      checkStrictKeys(
        body,
        new Set(['surfaceId', 'functionCallId', 'callFunction']),
        [actionKey],
        issues,
      );
      checkOptionalString(body, 'surfaceId', [actionKey], issues);
      checkRequiredString(body, 'functionCallId', [actionKey], issues);
      checkV10FunctionCall(body['callFunction'], [actionKey, 'callFunction'], true, issues);
      break;
    case 'agentFunctionResponse':
      checkFunctionResponse(body, [actionKey], issues);
      break;
  }

  return issues.length === 0 ? {success: true, data: raw} : {success: false, issues};
}

/**
 * Validates a v1.0 `action` renderer-to-agent message without Zod.
 */
export function validateV10ActionMessage(raw: unknown): ValidationOutcome<Record<string, unknown>> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(raw)) {
    pushTypeIssue(issues, [], 'object', raw);
    return {success: false, issues};
  }
  checkV10Version(raw, issues);
  checkStrictKeys(raw, new Set(['version', 'action']), [], issues);
  const action = raw['action'];
  if (!isPlainRecord(action)) {
    pushTypeIssue(issues, ['action'], 'object', action);
    return {success: false, issues};
  }
  checkRequiredString(action, 'name', ['action'], issues);
  checkOptionalString(action, 'userMessage', ['action'], issues);
  checkRequiredString(action, 'surfaceId', ['action'], issues);
  checkRequiredString(action, 'sourceComponentId', ['action'], issues);
  const ts = action['timestamp'];
  if (typeof ts !== 'string') {
    pushTypeIssue(issues, ['action', 'timestamp'], 'string', ts);
  } else if (!isValidRfc3339DateTime(ts)) {
    issues.push({
      path: ['action', 'timestamp'],
      code: 'invalid_string',
      message: 'Invalid datetime',
    });
  }
  if (!isPlainRecord(action['context'])) {
    pushTypeIssue(issues, ['action', 'context'], 'object', action['context']);
  }
  if (action['metadata'] !== undefined) {
    checkMetadataObject(action['metadata'], ['action', 'metadata'], issues);
  }
  return issues.length === 0 ? {success: true, data: raw} : {success: false, issues};
}

/**
 * Validates a v1.0 `error` renderer-to-agent message without Zod.
 */
export function validateV10ErrorMessage(raw: unknown): ValidationOutcome<Record<string, unknown>> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(raw)) {
    pushTypeIssue(issues, [], 'object', raw);
    return {success: false, issues};
  }
  checkV10Version(raw, issues);
  checkStrictKeys(raw, new Set(['version', 'error']), [], issues);
  const err = raw['error'];
  if (!isPlainRecord(err)) {
    pushTypeIssue(issues, ['error'], 'object', err);
    return {success: false, issues};
  }
  const code = err['code'];
  if (typeof code === 'string' && V10_VALIDATION_ERROR_CODES.has(code)) {
    checkStrictKeys(err, new Set(['code', 'surfaceId', 'path', 'message']), ['error'], issues);
    checkRequiredString(err, 'surfaceId', ['error'], issues);
    checkRequiredString(err, 'path', ['error'], issues);
    checkRequiredString(err, 'message', ['error'], issues);
  } else {
    if (typeof code !== 'string') {
      pushTypeIssue(issues, ['error', 'code'], 'string', code);
    }
    checkRequiredString(err, 'message', ['error'], issues);
    const hasSurface = err['surfaceId'] !== undefined;
    const hasCallId = err['functionCallId'] !== undefined;
    if (hasSurface && typeof err['surfaceId'] !== 'string') {
      pushTypeIssue(issues, ['error', 'surfaceId'], 'string', err['surfaceId']);
    }
    if (hasCallId && typeof err['functionCallId'] !== 'string') {
      pushTypeIssue(issues, ['error', 'functionCallId'], 'string', err['functionCallId']);
    }
    if (hasSurface === hasCallId) {
      issues.push({
        path: ['error'],
        code: 'custom',
        message:
          'Generic error must specify either surfaceId or functionCallId, not both or neither.',
      });
    }
  }
  return issues.length === 0 ? {success: true, data: raw} : {success: false, issues};
}

/**
 * Validates a v1.0 `rendererFunctionResponse` renderer-to-agent message without Zod.
 */
export function validateV10RendererFunctionResponseMessage(
  raw: unknown,
): ValidationOutcome<Record<string, unknown>> {
  const issues: ValidationIssue[] = [];
  if (!isPlainRecord(raw)) {
    pushTypeIssue(issues, [], 'object', raw);
    return {success: false, issues};
  }
  checkV10Version(raw, issues);
  checkStrictKeys(raw, new Set(['version', 'rendererFunctionResponse']), [], issues);
  checkFunctionResponse(raw['rendererFunctionResponse'], ['rendererFunctionResponse'], issues);
  return issues.length === 0 ? {success: true, data: raw} : {success: false, issues};
}

/**
 * Validates an inbound agent-to-renderer wire envelope for the given protocol version.
 *
 * Returns `null` when `protocolVersion` is unsupported so callers can raise
 * their domain-specific catalog error.
 */
export function validateAgentToRendererEnvelope(
  raw: unknown,
  protocolVersion: string,
): ValidationOutcome<Record<string, unknown>> | null {
  const normalized = normalizeVersionString(protocolVersion);
  if (normalized === '0.9' || normalized.startsWith('0.9.')) {
    return validateV09AgentToRendererMessage(raw);
  }
  if (normalized === '1.0') {
    return validateV10AgentToRendererMessage(raw);
  }
  return null;
}

/**
 * Validates a component `@metadata` envelope object (`{ extensions?: Extensions }`)
 * without Zod.
 */
export function validateComponentMetadata(
  raw: unknown,
): ValidationOutcome<Record<string, unknown> | undefined> {
  if (raw === undefined) {
    return {success: true, data: undefined};
  }
  const issues: ValidationIssue[] = [];
  checkMetadataObject(raw, [], issues);
  return issues.length === 0
    ? {success: true, data: raw as Record<string, unknown>}
    : {success: false, issues};
}

/**
 * Validates a component `@accessibility` / legacy `accessibility` attributes object
 * (`{ label?, description?, live?, hidden? }`) without Zod.
 */
export function validateAccessibilityAttributes(
  raw: unknown,
  protocolVersion?: string,
): ValidationOutcome<Record<string, unknown> | undefined> {
  if (raw === undefined) {
    return {success: true, data: undefined};
  }
  return validateCatalogValue({type: 'accessibility'}, raw, {
    protocolVersion,
  }) as ValidationOutcome<Record<string, unknown> | undefined>;
}
