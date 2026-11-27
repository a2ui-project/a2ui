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

import {
  AT_COMPONENT_MIXIN_KEYS,
  ComponentMixinLayout,
  ComponentMixinValue,
  SplitComponent,
  componentMixinLayout,
  splitComponentEnvelope,
} from '../catalog/component_envelope.js';
import {getLegacySchemaAdapter} from '../catalog/legacy_schema_adapter.js';
import type {DataTypeDefinition, TypeDefinition} from '../catalog/model/catalog_model.js';
import {
  allowedReturnTypesForDefinition,
  definitionEnvelopeLayout,
} from '../catalog/model/model_semantics.js';
import {
  formatValidationIssue,
  validateComponentProperties,
  validateFunctionArguments,
  validateSurfaceProperties,
  type ValidationIssue,
  type ValidationOutcome,
} from '../catalog/model/model_validator.js';
import type {CatalogInterface, ComponentApi, FunctionApi} from '../catalog/types.js';
import {validateMetadata} from '../common/metadata.js';
import {isAtLeastVersion} from '../common/semver.js';
import {isValidUax31Identifier} from '../common/uax31.js';
import {A2uiErrorDetail, A2uiValidationError} from '../errors.js';
import {
  validateAccessibilityAttributes,
  validateComponentMetadata,
} from '../processing/wire-validators.js';
import {getKnownSchemaKeys, validateReservedDirectives} from '../resolution/data-context.js';
import {MAX_FUNCTION_CALL_ARGS} from '../types/helpers.js';
import {IndexApi} from '../v1_0/functions/system_functions.js';
import type {ValidationConfig} from './integrity-checker.js';

/**
 * Looks up a reserved `@`-prefixed system function, which belongs to no
 * catalog and is available on every v1.0 surface.
 */
function getSystemFunctionApi(name: string): typeof IndexApi | undefined {
  return name === IndexApi.name ? IndexApi : undefined;
}

function assertSystemCallNamesNoCatalog(name: string, call: Record<string, unknown>): void {
  if (call['catalogId'] !== undefined) {
    throw new A2uiValidationError(
      `System function '${name}' belongs to no catalog and must not name a catalogId.`,
    );
  }
}

/**
 * Builds the error message for a v1.0 function call whose `catalogId` is not
 * a string.
 */
export function nonStringCatalogIdMessage(name: string): string {
  return `Function call '${name}' has a non-string 'catalogId'.`;
}

/**
 * Rejects a renderer call to a catalog function whose `allowedCallers` is
 * `agentOnly`.
 */
export function assertRendererMayCall(
  catalog: {readonly functions: ReadonlyMap<string, {readonly allowedCallers?: string}>},
  name: string,
): void {
  if (catalog.functions.get(name)?.allowedCallers !== 'agentOnly') return;
  throw new A2uiValidationError(
    `Function '${name}' cannot be called by renderer (allowedCallers is agentOnly).`,
  );
}

/**
 * Decides whether a v1.0 nested function call runs in its component's catalog.
 */
export function nestedCallRunsInCatalog(
  callCatalogId: string | undefined,
  catalogId: string,
  {catalogIsDefault}: {catalogIsDefault: boolean},
): boolean {
  if (callCatalogId === undefined) {
    return catalogIsDefault;
  }
  return callCatalogId === catalogId;
}

type ValidationSlot =
  | {readonly kind: 'model'; readonly typeDef: TypeDefinition}
  | {readonly kind: 'legacy'; readonly schema: unknown};

const ACCESSIBILITY_TYPE_DEF: TypeDefinition = {
  type: 'object',
  properties: [
    {name: 'label', type: 'string', dynamic: true},
    {name: 'description', type: 'string', dynamic: true},
    {name: 'live', type: 'enum', values: ['off', 'polite', 'assertive'], valueType: 'string'},
    {name: 'hidden', type: 'boolean', dynamic: true},
  ],
};

function validateLegacySchema(schema: unknown, value: unknown): ValidationOutcome {
  const adapter = getLegacySchemaAdapter();
  if (adapter?.isLegacySchema(schema)) {
    return adapter.validate(schema, value);
  }
  if (
    schema &&
    typeof schema === 'object' &&
    'safeParse' in schema &&
    typeof (schema as {safeParse?: unknown}).safeParse === 'function'
  ) {
    const res = (
      schema as {
        safeParse(
          v: unknown,
        ):
          | {success: true; data: unknown}
          | {success: false; error: {issues: readonly ValidationIssue[]}};
      }
    ).safeParse(value);
    return res.success
      ? {success: true, data: res.data}
      : {success: false, issues: res.error.issues};
  }
  return {success: true, data: value};
}

function layoutForComponent(componentApi: ComponentApi | undefined): ComponentMixinLayout {
  if (!componentApi) return {customKeys: new Set(), schemaKeys: new Map()};
  if (componentApi.definition) {
    return definitionEnvelopeLayout(componentApi.definition);
  }
  return componentMixinLayout(componentApi.schema);
}

/**
 * Validates A2UI payloads against the definitions or legacy schemas of a single catalog.
 */
export class PayloadValidator {
  /** Whether this catalog's protocol version mandates UAX #31 identifiers. */
  private readonly enforceIdentifiers: boolean;

  constructor(
    private readonly catalog: CatalogInterface<any, any>,
    private readonly config?: ValidationConfig,
  ) {
    this.enforceIdentifiers = isAtLeastVersion(catalog.protocolVersion, '1.0');
  }

  private get allowUnknown(): boolean {
    return this.config ? (this.config.allowUnknownElements ?? false) : true;
  }

  /**
   * Validates a single component payload against its catalog definition,
   * including any nested function calls within its properties.
   */
  validateComponent(
    comp: Record<string, unknown>,
    knownType?: string,
    options?: {skipNestedFunctions?: boolean},
  ): void {
    const id = comp['id'];
    if (typeof id !== 'string' || !id) {
      const msg = `Component '${comp['component']}' is missing an 'id'; entries require a valid string 'id'.`;
      throw new A2uiValidationError(
        msg,
        [{path: '/id', code: 'missing_field', message: msg}],
        'VALIDATION_ERROR',
        {path: '/id'},
      );
    }

    this.assertIdentifier(
      id,
      `Component id '${id}' must be a valid UAX #31 identifier`,
      false,
      '/id',
    );

    const declaredType = comp['component'];
    const componentType = typeof declaredType === 'string' ? declaredType : knownType;
    if (!componentType) {
      const msg = `Cannot create component ${id} without a type.`;
      throw new A2uiValidationError(
        msg,
        [{path: '/component', code: 'missing_field', message: msg}],
        'VALIDATION_ERROR',
        {path: '/component'},
      );
    }

    this.assertIdentifier(
      componentType,
      `Component type '${componentType}' must be a valid UAX #31 identifier`,
      false,
      '/component',
    );

    const componentApi = this.catalog.components.get(componentType) as ComponentApi | undefined;
    const layout = layoutForComponent(componentApi);
    const split: SplitComponent = this.enforceIdentifiers
      ? splitComponentEnvelope(comp, layout)
      : {properties: stripStructuralKeys(comp), mixins: {}};
    const properties = split.properties;
    const rawCatalogId = split.mixins.catalogId?.value;
    const componentCatalogId = typeof rawCatalogId === 'string' ? rawCatalogId : undefined;

    if (!componentApi) {
      if (!this.allowUnknown) {
        const msg = `Unknown component type '${componentType}' not found in catalog '${this.catalog.id}'.`;
        throw new A2uiValidationError(
          msg,
          [{path: '/component', code: 'invalid_value', message: msg}],
          'VALIDATION_ERROR',
          {path: '/component'},
        );
      }
      this.validateEnvelopeMixins(
        split.mixins,
        undefined,
        properties,
        componentType,
        id,
        componentCatalogId,
      );
      if (!options?.skipNestedFunctions) {
        this.validateNestedFunctions(properties, componentCatalogId);
      }
      return;
    }

    if (this.enforceIdentifiers) {
      this.validateEnvelopeMixins(
        split.mixins,
        layout,
        properties,
        componentType,
        id,
        componentCatalogId,
      );
    } else {
      const knownKeys = componentApi.definition
        ? new Set((componentApi.definition.parameters ?? []).map(p => p.name))
        : componentApi.schema
          ? getKnownSchemaKeys(componentApi.schema)
          : null;
      this.validateLegacyAccessibility(properties, knownKeys, componentType, id);
    }

    const result = componentApi.definition
      ? validateComponentProperties(componentApi.definition, properties, {
          types: this.catalog.types,
          protocolVersion: String(this.catalog.protocolVersion),
        })
      : validateLegacySchema(componentApi.schema, properties);

    if (!result.success) {
      const formattedErrors = result.issues.map(formatValidationIssue).join(', ');
      const details = issuesToDetails(result.issues);
      const uniquePaths = new Set(details.map(d => d.path));
      const firstPath = uniquePaths.size === 1 ? details[0]?.path : undefined;
      throw new A2uiValidationError(
        `Validation failed for component '${componentType}' (${id}): ${formattedErrors}`,
        details,
        'VALIDATION_ERROR',
        {path: firstPath && firstPath !== '/' ? firstPath : undefined},
      );
    }
    if (!options?.skipNestedFunctions) {
      const rootSlot: ValidationSlot | undefined = componentApi.definition
        ? {
            kind: 'model',
            typeDef: {
              type: 'object',
              properties: componentApi.definition.parameters,
            },
          }
        : componentApi.schema
          ? {kind: 'legacy', schema: componentApi.schema}
          : undefined;
      this.validateNestedFunctions(properties, componentCatalogId, '', rootSlot);
    }
  }

  private validateLegacyAccessibility(
    properties: Record<string, unknown>,
    knownKeys: Set<string> | null | undefined,
    componentType: string,
    id: string,
  ): void {
    if (!('accessibility' in properties) || knownKeys?.has('accessibility')) return;
    const accVal = properties['accessibility'];
    delete properties['accessibility'];
    this.assertOutcome(
      validateAccessibilityAttributes(accVal, String(this.catalog.protocolVersion)),
      '/accessibility',
      {componentType, id},
    );
    this.validateNestedFunctions(accVal, undefined, '/accessibility', {
      kind: 'model',
      typeDef: ACCESSIBILITY_TYPE_DEF,
    });
  }

  private validateEnvelopeMixins(
    mixins: SplitComponent['mixins'],
    layout: ComponentMixinLayout | undefined,
    properties: Record<string, unknown>,
    componentType: string,
    id: string,
    componentCatalogId?: string,
  ): void {
    const subject = {componentType, id};
    for (const [key, mixin] of Object.entries(mixins) as Array<
      [keyof SplitComponent['mixins'], ComponentMixinValue]
    >) {
      const path = `/${mixin.wireKey}`;
      if (key === 'metadata') {
        this.assertOutcome(validateComponentMetadata(mixin.value), path, subject);
        rethrowAt(path, () => validateMetadata(mixin.value));
      }
      const schemaKey = layout?.schemaKeys.get(key);
      if (schemaKey !== undefined) {
        properties[schemaKey] = mixin.value;
        continue;
      }
      switch (key) {
        case 'catalogId':
          if (typeof mixin.value !== 'string') {
            const msg = `Component '${id}' has a non-string '${mixin.wireKey}'.`;
            throw new A2uiValidationError(
              msg,
              [{path, code: 'invalid_value', message: msg}],
              'VALIDATION_ERROR',
              {path},
            );
          }
          break;
        case 'accessibility':
          this.assertOutcome(
            validateAccessibilityAttributes(mixin.value, String(this.catalog.protocolVersion)),
            path,
            subject,
          );
          this.validateNestedFunctions(mixin.value, componentCatalogId, path, {
            kind: 'model',
            typeDef: ACCESSIBILITY_TYPE_DEF,
          });
          break;
        case 'checks':
          if (layout) {
            const msg = `Component '${componentType}' (${id}) is not checkable and does not accept '${mixin.wireKey}'.`;
            throw new A2uiValidationError(
              msg,
              [{path, code: 'invalid_value', message: msg}],
              'VALIDATION_ERROR',
              {path},
            );
          }
          this.validateNestedFunctions(mixin.value, componentCatalogId, path);
          break;
        default:
          break;
      }
    }
  }

  private assertOutcome(
    outcome: ValidationOutcome,
    path: string,
    {componentType, id}: {componentType: string; id: string},
  ): void {
    if (outcome.success) return;
    const formattedErrors = outcome.issues.map(formatValidationIssue).join(', ');
    const details = issuesToDetails(outcome.issues, path);
    throw new A2uiValidationError(
      `Validation failed for component '${componentType}' (${id}): ${formattedErrors}`,
      details,
      'VALIDATION_ERROR',
      {path: details[0]?.path},
    );
  }

  private assertFunctionIdentifiers(name: string, args: unknown): void {
    this.assertIdentifier(name, `Function name '${name}' must be a valid UAX #31 identifier`, true);
    if (
      this.enforceIdentifiers &&
      args !== undefined &&
      args !== null &&
      (typeof args !== 'object' || Array.isArray(args))
    ) {
      throw new A2uiValidationError(
        `Validation failed for function '${name}': Expected object, received ${Array.isArray(args) ? 'array' : typeof args}`,
      );
    }
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      const keys = Object.keys(args);
      if (keys.length > MAX_FUNCTION_CALL_ARGS) {
        throw new A2uiValidationError(
          `Function call '${name}' exceeds maximum allowed arguments count (${MAX_FUNCTION_CALL_ARGS})`,
        );
      }
      for (const argName of keys) {
        this.assertIdentifier(
          argName,
          `Function argument '${argName}' in function '${name}' must be a valid UAX #31 identifier`,
        );
      }
    }
  }

  private checkNestedCallRecord(
    record: Record<string, unknown>,
    rawName: string,
    componentCatalogId: string | undefined,
    slot?: ValidationSlot,
  ): void {
    const rawArgs = record['args'];
    const argsDict = (rawArgs !== undefined ? rawArgs : {}) as Record<string, unknown>;
    if (!this.enforceIdentifiers) {
      this.validateFunction(rawName, argsDict);
      this.assertPreV10ReturnType(record, rawName, slot);
      return;
    }
    if (rawName.startsWith('@')) {
      assertSystemCallNamesNoCatalog(rawName, record);
      this.validateFunction(rawName, argsDict);
      return;
    }
    const callCatalogId = record['catalogId'];
    if (callCatalogId !== undefined && typeof callCatalogId !== 'string') {
      throw new A2uiValidationError(nonStringCatalogIdMessage(rawName));
    }
    if (
      nestedCallRunsInCatalog(callCatalogId, this.catalog.id, {
        catalogIsDefault: componentCatalogId === undefined,
      })
    ) {
      assertRendererMayCall(this.catalog, rawName);
      this.validateFunction(rawName, argsDict);
    } else {
      this.assertFunctionIdentifiers(rawName, argsDict);
    }
  }

  private assertPreV10ReturnType(
    record: Record<string, unknown>,
    rawName: string,
    slot?: ValidationSlot,
  ): void {
    const fn = this.catalog.functions.get(rawName);
    const declaredReturnType = record['returnType'];
    if (
      declaredReturnType !== undefined &&
      fn &&
      fn.returnType !== 'any' &&
      declaredReturnType !== fn.returnType
    ) {
      throw returnTypeError(rawName, fn.returnType, String(declaredReturnType));
    }
    const allowedSlotTypes = slot
      ? slot.kind === 'model'
        ? allowedReturnTypesForDefinition(slot.typeDef, this.catalog.types)
        : getLegacySchemaAdapter()?.allowedReturnTypesForSchema(slot.schema)
      : undefined;
    if (!allowedSlotTypes) return;
    const declaredMismatch =
      declaredReturnType !== undefined &&
      (typeof declaredReturnType !== 'string' || !allowedSlotTypes.has(declaredReturnType));
    const fnMismatch =
      fn !== undefined && fn.returnType !== 'any' && !allowedSlotTypes.has(fn.returnType);
    if (declaredMismatch || fnMismatch) {
      const actualType =
        declaredReturnType !== undefined ? String(declaredReturnType) : String(fn?.returnType);
      throw returnTypeError(rawName, [...allowedSlotTypes].join("' | '"), actualType);
    }
  }

  private validateNestedFunctions(
    val: unknown,
    componentCatalogId: string | undefined,
    currentPath = '',
    slot?: ValidationSlot,
  ): void {
    if (Array.isArray(val)) {
      this.validateNestedArray(val, componentCatalogId, currentPath, slot);
      return;
    }

    if (typeof val !== 'object' || val === null) {
      return;
    }

    const record = val as Record<string, unknown>;
    if (this.enforceIdentifiers) {
      this.validateRecordDirectives(record, currentPath);
    }
    const rawName = this.enforceIdentifiers
      ? record['@call']
      : (record['call'] ?? record['function']);
    const isCallRecord =
      typeof rawName === 'string' && (this.enforceIdentifiers || rawName.length > 0);
    if (isCallRecord) {
      rethrowAt(currentPath, () =>
        this.checkNestedCallRecord(record, rawName, componentCatalogId, slot),
      );
    }

    this.validateNestedRecordChildren(
      record,
      isCallRecord ? rawName : undefined,
      componentCatalogId,
      currentPath,
      slot,
    );
  }

  private validateNestedArray(
    items: readonly unknown[],
    componentCatalogId: string | undefined,
    currentPath: string,
    slot?: ValidationSlot,
  ): void {
    const itemSlot = this.resolveElementSlot(slot);
    for (let i = 0; i < items.length; i++) {
      this.validateNestedFunctions(items[i], componentCatalogId, `${currentPath}/${i}`, itemSlot);
    }
  }

  private validateRecordDirectives(record: Record<string, unknown>, currentPath: string): void {
    const keys = Object.keys(record);
    validateReservedDirectives(
      currentPath === '' ? keys.filter(key => !AT_COMPONENT_MIXIN_KEYS.has(key)) : keys,
      this.catalog.protocolVersion,
    );
  }

  private validateNestedRecordChildren(
    record: Record<string, unknown>,
    callName: string | undefined,
    componentCatalogId: string | undefined,
    currentPath: string,
    slot?: ValidationSlot,
  ): void {
    const callArgsSlot =
      callName !== undefined
        ? this.resolveCallArgsSlot(record, callName, componentCatalogId)
        : undefined;
    const recordSlot = callName === undefined ? this.narrowSlot(slot, record) : undefined;
    for (const [k, v] of Object.entries(record)) {
      const childSlot =
        callName !== undefined
          ? k === 'args'
            ? callArgsSlot
            : undefined
          : this.resolvePropertySlot(recordSlot, k, record);
      this.validateNestedFunctions(v, componentCatalogId, `${currentPath}/${k}`, childSlot);
    }
  }

  private resolveElementSlot(slot: ValidationSlot | undefined): ValidationSlot | undefined {
    if (!slot) return undefined;
    if (slot.kind === 'legacy') {
      const elem = getLegacySchemaAdapter()?.elementSchema(slot.schema);
      return elem !== undefined ? {kind: 'legacy', schema: elem} : undefined;
    }
    const itemDef = modelElementType(slot.typeDef, this.catalog.types);
    return itemDef ? {kind: 'model', typeDef: itemDef} : undefined;
  }

  private narrowSlot(
    slot: ValidationSlot | undefined,
    record: Record<string, unknown>,
  ): ValidationSlot | undefined {
    if (!slot) return undefined;
    if (slot.kind === 'legacy') {
      const narrowed = getLegacySchemaAdapter()?.narrowRecordSchema(slot.schema, record);
      return narrowed !== undefined ? {kind: 'legacy', schema: narrowed} : undefined;
    }
    return slot;
  }

  private resolvePropertySlot(
    slot: ValidationSlot | undefined,
    key: string,
    record: Record<string, unknown>,
  ): ValidationSlot | undefined {
    if (!slot) return undefined;
    if (slot.kind === 'legacy') {
      const prop = getLegacySchemaAdapter()?.propertySchema(slot.schema, key, record);
      return prop !== undefined ? {kind: 'legacy', schema: prop} : undefined;
    }
    const propDef = modelPropertyType(slot.typeDef, key, this.catalog.types);
    return propDef ? {kind: 'model', typeDef: propDef} : undefined;
  }

  private resolveCallArgsSlot(
    record: Record<string, unknown>,
    rawName: string,
    componentCatalogId: string | undefined,
  ): ValidationSlot | undefined {
    const fnToSlot = (fn: FunctionApi | undefined): ValidationSlot | undefined => {
      if (!fn) return undefined;
      if (fn.definition) {
        return {
          kind: 'model',
          typeDef: {
            type: 'object',
            properties: fn.definition.parameters,
            additionalProperties: fn.definition.additionalParameters,
          },
        };
      }
      return fn.schema ? {kind: 'legacy', schema: fn.schema} : undefined;
    };

    if (!this.enforceIdentifiers) {
      return fnToSlot(this.catalog.functions.get(rawName));
    }
    if (rawName.startsWith('@')) {
      return fnToSlot(getSystemFunctionApi(rawName));
    }
    const callCatalogId = record['catalogId'];
    if (
      (callCatalogId === undefined || typeof callCatalogId === 'string') &&
      nestedCallRunsInCatalog(callCatalogId, this.catalog.id, {
        catalogIsDefault: componentCatalogId === undefined,
      })
    ) {
      return fnToSlot(this.catalog.functions.get(rawName));
    }
    return undefined;
  }

  /**
   * Validates the arguments of a function call against the catalog definition.
   */
  validateFunction(name: string, args?: Record<string, unknown>): Record<string, unknown> {
    this.assertFunctionIdentifiers(name, args);

    const fn = (
      this.enforceIdentifiers && name.startsWith('@')
        ? getSystemFunctionApi(name)
        : this.catalog.functions.get(name)
    ) as FunctionApi | undefined;
    if (!fn) {
      if (!this.allowUnknown) {
        throw new A2uiValidationError(`Unrecognized function '${name}'`);
      }
      return (args ?? {}) as Record<string, unknown>;
    }

    if (!fn.definition && !fn.schema) {
      if (
        args !== undefined &&
        (typeof args !== 'object' || args === null || Array.isArray(args))
      ) {
        throw new A2uiValidationError(
          `Validation failed for function '${name}': Expected object, received ${Array.isArray(args) ? 'array' : typeof args}`,
          undefined,
          'VALIDATION_ERROR',
          {path: '/args'},
        );
      }
      return (args ?? {}) as Record<string, unknown>;
    }

    const result = fn.definition
      ? validateFunctionArguments(fn.definition, args ?? {}, {
          types: this.catalog.types,
          protocolVersion: String(this.catalog.protocolVersion),
        })
      : validateLegacySchema(fn.schema, args ?? {});

    if (!result.success) {
      const formattedErrors = result.issues.map(formatValidationIssue).join(', ');
      const details = issuesToDetails(result.issues, '/args');
      throw new A2uiValidationError(
        `Validation failed for function '${name}': ${formattedErrors}`,
        details,
        'VALIDATION_ERROR',
        {path: details[0]?.path},
      );
    }
    return result.data as Record<string, unknown>;
  }

  /**
   * Validates a surface theme against the catalog's theme schema or canonical
   * `surfaceProperties` definition.
   */
  validateTheme(theme: unknown): unknown {
    const themeSchema = this.catalog.themeSchema;
    const surfaceProps = this.catalog.surfaceProperties;
    if (!themeSchema && !surfaceProps) return theme;

    const result = themeSchema
      ? validateLegacySchema(themeSchema, theme)
      : validateSurfaceProperties(surfaceProps!, theme, {
          types: this.catalog.types,
          protocolVersion: String(this.catalog.protocolVersion),
        });
    if (!result.success) {
      const formattedErrors = result.issues.map(formatValidationIssue).join(', ');
      const details = issuesToDetails(result.issues, '/theme');
      throw new A2uiValidationError(
        `Validation failed for theme: ${formattedErrors}`,
        details,
        'VALIDATION_ERROR',
        {path: details[0]?.path ?? '/theme'},
      );
    }
    return result.data;
  }

  private assertIdentifier(
    name: string,
    message: string,
    allowLeadingAt = false,
    path?: string,
  ): void {
    if (!this.enforceIdentifiers) return;
    if (!isValidUax31Identifier(name, allowLeadingAt)) {
      throw new A2uiValidationError(
        message,
        path ? [{path, code: 'invalid_value', message}] : undefined,
        'VALIDATION_ERROR',
        {path},
      );
    }
  }
}

function derefModelType(
  typeDef: TypeDefinition,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  visited: ReadonlySet<string>,
): {
  readonly resolved: TypeDefinition;
  readonly nextVisited: ReadonlySet<string>;
  readonly cyclic: boolean;
} {
  let current = typeDef;
  let nextVisited = visited;
  while (current.type === 'ref') {
    if (nextVisited.has(current.ref)) {
      return {resolved: {type: 'any'}, nextVisited, cyclic: true};
    }
    const target = types?.[current.ref];
    if (!target) {
      return {resolved: {type: 'any'}, nextVisited, cyclic: false};
    }
    if (nextVisited === visited) {
      nextVisited = new Set(visited);
    }
    (nextVisited as Set<string>).add(current.ref);
    current = target;
  }
  return {resolved: current, nextVisited, cyclic: false};
}

function modelElementType(
  typeDef: TypeDefinition,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  visited: ReadonlySet<string> = new Set(),
): TypeDefinition | undefined {
  const {resolved, nextVisited, cyclic} = derefModelType(typeDef, types, visited);
  if (cyclic) return undefined;
  if (resolved.type === 'array') return resolved.items;
  if (resolved.type === 'union') {
    const itemVariants = resolved.variants
      .map(v => modelElementType(v, types, nextVisited))
      .filter((v): v is TypeDefinition => v !== undefined);
    if (itemVariants.length === 1) return itemVariants[0];
    if (itemVariants.length > 1) return {type: 'union', variants: itemVariants, exclusive: false};
  }
  return undefined;
}

function modelPropertyType(
  typeDef: TypeDefinition,
  key: string,
  types: Readonly<Record<string, DataTypeDefinition>> | undefined,
  visited: ReadonlySet<string> = new Set(),
): TypeDefinition | undefined {
  const {resolved, nextVisited, cyclic} = derefModelType(typeDef, types, visited);
  if (cyclic) return undefined;
  if (resolved.type === 'object') {
    const declared = resolved.properties?.find(p => p.name === key);
    if (declared) return declared;
    if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      return resolved.additionalProperties;
    }
  }
  if (resolved.type === 'union') {
    const matches = resolved.variants
      .map(v => modelPropertyType(v, key, types, nextVisited))
      .filter((v): v is TypeDefinition => v !== undefined);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return {type: 'union', variants: matches, exclusive: false};
  }
  return undefined;
}

function issuesToDetails(issues: readonly ValidationIssue[], prefix = ''): A2uiErrorDetail[] {
  return issues.map(issue => {
    const segments = issue.path.map(s => String(s).replace(/~/g, '~0').replace(/\//g, '~1'));
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys) && issue.keys.length > 0) {
      segments.push(String(issue.keys[0]).replace(/~/g, '~0').replace(/\//g, '~1'));
    }
    const relPath = segments.length > 0 ? `/${segments.join('/')}` : '';
    const fullPath = `${prefix}${relPath}` || '/';
    const isMissing =
      (issue.code === 'invalid_type' && issue.received === 'undefined') ||
      issue.message === 'Required';
    return {
      path: fullPath,
      code: isMissing ? 'missing_field' : 'invalid_value',
      message: issue.message,
    };
  });
}

function stripStructuralKeys(comp: Record<string, unknown>): Record<string, unknown> {
  const {id: _id, component: _component, ...properties} = comp;
  return properties;
}

function rethrowAt(path: string, check: () => void): void {
  try {
    check();
  } catch (err: unknown) {
    if (err instanceof A2uiValidationError) {
      err.path = err.path && err.path !== '/' ? `${path}${err.path}` : path;
    }
    throw err;
  }
}

function returnTypeError(rawName: string, expected: string, received: string): A2uiValidationError {
  const msg = `Validation failed for function '${rawName}': Expected returnType '${expected}', received '${received}'`;
  return new A2uiValidationError(
    msg,
    [{path: '/returnType', code: 'invalid_value', message: msg}],
    'VALIDATION_ERROR',
    {path: '/returnType'},
  );
}
