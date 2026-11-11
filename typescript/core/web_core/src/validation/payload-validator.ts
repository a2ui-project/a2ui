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

import {z} from 'zod';

import {
  AT_COMPONENT_MIXIN_KEYS,
  ComponentMixinLayout,
  ComponentMixinValue,
  SplitComponent,
  componentMixinLayout,
  splitComponentEnvelope,
} from '../catalog/component_envelope.js';
import {isChildListSchema, isChildSchema} from '../catalog/reference-map.js';
import {CatalogInterface} from '../catalog/types.js';
import {validateMetadata} from '../common/metadata.js';
import {isAtLeastVersion} from '../common/semver.js';
import {isValidUax31Identifier} from '../common/uax31.js';
import {A2uiErrorDetail, A2uiValidationError} from '../errors.js';
import {formatZodIssue} from '../processing/format-zod-issue.js';
import {
  getKnownSchemaKeys,
  RESERVED_DATA_DIRECTIVES,
  RESERVED_PROPERTY_DIRECTIVES,
  validateReservedDirectives,
} from '../resolution/data-context.js';
import {type BehaviorNode, scrapeComponentBehavior} from '../resolution/generic-binder.js';
import {
  extractRefDefName,
  getUnionOptions,
  isSingleChildRefObject,
  isStaticListChildRefObject,
  isTemplateRefObject,
  unwrapZodField,
  withV10Directives,
} from '../resolution/ref-fields.js';
import {AccessibilityAttributesSchema, ComponentCommonSchema} from '../types/common-types.js';
import {MAX_FUNCTION_CALL_ARGS} from '../types/helpers.js';
import {IndexApi} from '../v1_0/functions/system_functions.js';
import {V10_CHILD_REF_OPTIONS} from '../v1_0/standard_defs.js';
import type {ValidationConfig} from './integrity-checker.js';

const V10_AT_CHILD_REF_OPTIONS = withV10Directives(V10_CHILD_REF_OPTIONS);
const PRE_V10_FORBIDDEN_AT_DIRECTIVES = new Set(['@child', '@action', '@functionCall']);

/**
 * Looks up a reserved `@`-prefixed system function, which belongs to no
 * catalog and is available on every v1.0 surface.
 *
 * A function rather than a module-level map, because `system_functions` and
 * this module sit on an import cycle through `data-context`.
 *
 * @param name Function name, including its `@` prefix.
 * @returns The system function's API, or `undefined` if none has that name.
 */
function getSystemFunctionApi(name: string): typeof IndexApi | undefined {
  return name === IndexApi.name ? IndexApi : undefined;
}

/**
 * Rejects a call to a reserved `@` system function that names a catalog.
 *
 * A system function belongs to no catalog, so a `catalogId` on its call can
 * never be honored.
 *
 * @param name Function name, including its `@` prefix.
 * @param call Raw function call object.
 * @throws {A2uiValidationError} If the call carries a `catalogId`.
 */
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
 *
 * @param name Name of the function being called.
 * @returns The error message.
 */
export function nonStringCatalogIdMessage(name: string): string {
  return `Function call '${name}' has a non-string 'catalogId'.`;
}

/**
 * Rejects a renderer call to a catalog function whose `allowedCallers` is
 * `agentOnly`.
 *
 * A call held in a component (a property binding, a check or an action) is
 * made by the renderer. A function whose `allowedCallers` is `agentOnly` runs
 * only for an agent's `callRendererFunction`, so it can't be bound into a
 * component. `DataContext` refuses such a call when it is evaluated, with the
 * same message.
 *
 * @param catalog The catalog the call runs in.
 * @param name The called function.
 * @throws {A2uiValidationError} If the catalog declares the function
 *   `agentOnly`. The error names no path; the caller sets the call's location.
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
 *
 * A call runs in the catalog it names, or else in the surface's default
 * catalog. So a call that names no `catalogId` runs in the component's
 * catalog only when that catalog is the surface default.
 *
 * @param callCatalogId The `catalogId` the call names, if any.
 * @param catalogId ID of the component's catalog.
 * @param options.catalogIsDefault Whether the component's catalog is the
 *   surface's default catalog.
 * @returns Whether the call runs in the component's catalog.
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

/**
 * Validates A2UI payloads against the schemas of a single catalog.
 *
 * The validator is deliberately scoped to one catalog. Multi-catalog payloads
 * are resolved to a target catalog by the caller, which then constructs a
 * validator for it; that keeps catalog resolution and schema checking in
 * separate places and mirrors Python's `PayloadValidator`.
 *
 * From v1.0 `validateComponent` fully validates a nested function call that
 * runs in this catalog (see `nestedCallRunsInCatalog`): a call that names
 * this catalog, or names no `catalogId` in a component that names none
 * either. Any other call runs in a catalog this validator can't see, so only
 * its identifiers are checked; `MessageProcessor` resolves such a call's
 * catalog and checks it there. Any string, the empty string included, names a
 * catalog, and a non-string `catalogId` on a call is rejected. Reserved `@`
 * system functions belong to no catalog: they are always validated fully, and
 * a `catalogId` on one is rejected. A call held in a component is a renderer
 * call, so a fully checked call may not call an `agentOnly` function (see
 * `assertRendererMayCall`). Below v1.0, which has no `allowedCallers`, that
 * check is skipped.
 *
 * A component that names no `catalogId` is taken to be in the surface's
 * default catalog, where calls that name none run, so its catalogless calls
 * are judged here. `MessageProcessor` knows the surface default and passes a
 * component's `catalogId` only when its catalog is another one.
 *
 * Below v1.0 a call cannot select a catalog, so every nested call is
 * validated against this catalog whatever `catalogId` it carries.
 *
 * Every method throws on failure rather than returning a list of problems.
 * Python's `validate_component` returns its errors instead, but TypeScript
 * callers, in particular `MessageProcessor`, depend on an exception to trigger
 * atomic rollback of a partially applied update.
 *
 * Identifier checks apply only to catalogs declaring protocol version 1.0 or
 * later, matching the version gate Python applies.
 */
export class PayloadValidator {
  /** Whether this catalog's protocol version mandates UAX #31 identifiers. */
  private readonly enforceIdentifiers: boolean;

  /**
   * Initializes a new `PayloadValidator`.
   *
   * @param catalog Catalog whose schemas define what a valid payload is.
   * @param config Validation strictness. When omitted, unknown components and
   *   functions are tolerated.
   */
  constructor(
    private readonly catalog: CatalogInterface<any, any>,
    private readonly config?: ValidationConfig,
  ) {
    this.enforceIdentifiers = isAtLeastVersion(catalog.protocolVersion, '1.0');
  }

  /**
   * Whether unrecognized components and functions are tolerated.
   *
   * An absent config means the caller is not validating at all, so unknown
   * elements pass. This preserves the gate `MessageProcessor` applied before
   * this class existed, and matches Python, whose `validate_components_update`
   * returns early when `config is None`.
   */
  private get allowUnknown(): boolean {
    return this.config ? (this.config.allowUnknownElements ?? false) : true;
  }

  /**
   * Validates a single component payload against its catalog definition,
   * including any nested function calls within its properties.
   *
   * @param comp Raw component payload, including its `id` and `component`
   *   envelope keys.
   * @param knownType Component type to assume when the payload omits
   *   `component`, as happens on a partial update to an existing component.
   * @param options Validation options. `skipNestedFunctions` leaves the
   *   function calls in the properties unchecked, as pre-1.0 renderers did
   *   when validation was off.
   * @throws {A2uiValidationError} If the identifier, the component type, any
   *   property, or any nested function call fails validation.
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

    const componentApi = this.catalog.components.get(componentType);
    // From v1.0 the envelope mixins (`@metadata`, `@catalogId`,
    // `@accessibility`, `@checks`, or their legacy bare names) are split from
    // the component's own properties. Below v1.0 every key but `id` and
    // `component` is a property.
    const split: SplitComponent = this.enforceIdentifiers
      ? splitComponentEnvelope(comp, componentMixinLayout(componentApi?.schema))
      : {properties: stripStructuralKeys(comp), mixins: {}};
    const properties = split.properties;
    // Decides which nested calls run in this catalog; see
    // `nestedCallRunsInCatalog`.
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
      // The component's properties can't be checked without its schema, but
      // the v1.0 directives and function calls in them still run, so they are
      // checked all the same. `MessageProcessor` relies on this for the calls
      // it leaves to component validation.
      this.validateEnvelopeMixins(
        split.mixins,
        undefined,
        properties,
        componentType,
        id,
        componentCatalogId,
      );
      if (this.enforceIdentifiers) {
        this.validateV10Directives(properties, undefined, componentType, id);
      } else {
        this.validatePreV10AtDirectives(properties, undefined, componentType, id);
      }
      if (!options?.skipNestedFunctions) {
        this.validateNestedFunctions(properties, componentCatalogId);
      }
      return;
    }

    const behavior = this.enforceIdentifiers
      ? scrapeComponentBehavior(componentApi.schema, V10_AT_CHILD_REF_OPTIONS)
      : undefined;
    const layout = this.enforceIdentifiers ? componentMixinLayout(componentApi.schema) : undefined;

    if (this.enforceIdentifiers) {
      this.validateEnvelopeMixins(
        split.mixins,
        layout,
        properties,
        componentType,
        id,
        componentCatalogId,
      );
      this.validateV10Directives(properties, behavior, componentType, id, '', false, layout);
    } else {
      const knownKeys = getKnownSchemaKeys(componentApi.schema);
      const legacyAccessibilitySchema =
        !knownKeys?.has('accessibility') && 'accessibility' in properties
          ? AccessibilityAttributesSchema
          : undefined;
      this.validatePreV10AtDirectives(
        properties,
        componentApi.schema,
        componentType,
        id,
        '',
        legacyAccessibilitySchema,
      );
      this.validateLegacyAccessibility(properties, knownKeys, componentType, id);
    }

    const schemaProps = this.enforceIdentifiers
      ? normalizePropsForSchema(properties, componentApi.schema)
      : properties;
    const result = componentApi.schema.safeParse(schemaProps);
    if (!result.success) {
      const formattedErrors = result.error.errors.map(formatZodIssue).join(', ');
      const details = zodIssuesToDetails(result.error.issues);
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
      this.validateNestedFunctions(properties, componentCatalogId, '', behavior, false, layout);
    }
  }

  /**
   * Validates a pre-1.0 component's `ComponentCommon` `accessibility` when the
   * component schema does not declare it, removing it from `properties`
   * before strict component schema parsing.
   *
   * Below v1.0 `metadata` and `catalogId` are not part of the protocol, so a
   * component carrying them is checked against its own schema like any other
   * property.
   */
  private validateLegacyAccessibility(
    properties: Record<string, unknown>,
    knownKeys: Set<string> | null | undefined,
    componentType: string,
    id: string,
  ): void {
    if (!('accessibility' in properties) || knownKeys?.has('accessibility')) return;
    const accVal = properties['accessibility'];
    delete properties['accessibility'];
    this.parseEnvelopeValue(AccessibilityAttributesSchema.optional(), accVal, '/accessibility', {
      componentType,
      id,
    });
    this.validateNestedFunctions(accVal, undefined, '/accessibility');
  }

  /**
   * Validates the v1.0 envelope mixins a component carries.
   *
   * A mixin the component's schema declares with its standard schema (such
   * as `checks` on a `Checkable` component) is put back into `properties`
   * under that schema's key, so the component schema checks it. Any other
   * mixin is checked here: `@metadata` against `ComponentCommon` (including
   * the UAX #31 `extensions` keys), `@catalogId` as a string,
   * `@accessibility` against `AccessibilityAttributes`. `@checks` is
   * rejected on a component that is not checkable.
   *
   * @param mixins The component's envelope mixins.
   * @param layout The component's mixin layout, or `undefined` when the
   *   component type is unknown to the catalog.
   * @param properties The component's own properties, which this may extend.
   * @param componentType The component's type, for error messages.
   * @param id The component's id, for error messages.
   * @param componentCatalogId The catalog the component names, if any.
   * @throws {A2uiValidationError} If a mixin is invalid.
   */
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
        this.parseEnvelopeValue(
          ComponentCommonSchema.shape['@metadata'],
          mixin.value,
          path,
          subject,
        );
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
          this.parseEnvelopeValue(
            AccessibilityAttributesSchema.optional(),
            mixin.value,
            path,
            subject,
          );
          this.validateNestedFunctions(mixin.value, componentCatalogId, path, undefined, true);
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
          this.validateNestedFunctions(mixin.value, componentCatalogId, path, undefined, true);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Parses an envelope value against its schema.
   *
   * @throws {A2uiValidationError} If the value does not satisfy the schema,
   *   with paths under `path`.
   */
  private parseEnvelopeValue(
    schema: z.ZodTypeAny,
    value: unknown,
    path: string,
    {componentType, id}: {componentType: string; id: string},
  ): void {
    const result = schema.safeParse(value);
    if (result.success) return;
    const formattedErrors = result.error.errors.map(formatZodIssue).join(', ');
    const details = zodIssuesToDetails(result.error.issues, path);
    throw new A2uiValidationError(
      `Validation failed for component '${componentType}' (${id}): ${formattedErrors}`,
      details,
      'VALIDATION_ERROR',
      {path: details[0]?.path},
    );
  }

  /**
   * Asserts that a v1.0 call's envelope is well formed without consulting its
   * catalog: the function name and all argument keys satisfy UAX #31
   * identifier syntax, and `args`, when present, is an object.
   *
   * @param name Function name to check.
   * @param args Function arguments object whose keys are checked.
   * @throws {A2uiValidationError} If the function name or any argument key is
   *   not a valid UAX #31 identifier, or `args` is not an object.
   */
  private assertFunctionIdentifiers(name: string, args: unknown): void {
    this.assertIdentifier(name, `Function name '${name}' must be a valid UAX #31 identifier`, true);
    // The call envelope types `args` as an object, whatever catalog the call
    // runs in.
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

  /**
   * Recursively walks a component's property values and validates any nested
   * function call objects.
   *
   * From v1.0 a call that runs in this catalog (see `nestedCallRunsInCatalog`)
   * is validated against this catalog. Any other call runs in a catalog this
   * validator cannot see, so only its envelope (name and argument
   * identifiers) is checked; `MessageProcessor` validates it against the
   * catalog it resolves to. A non-string `catalogId` is rejected. Reserved `@`
   * system functions belong to no catalog and are validated fully.
   *
   * @param val Property value or subtree to inspect.
   * @param componentCatalogId The `catalogId` the component names, if any.
   * @throws {A2uiValidationError} If any nested function call fails schema or identifier validation.
   */
  private checkNestedCallRecord(
    record: Record<string, unknown>,
    rawName: string,
    componentCatalogId: string | undefined,
  ): void {
    const rawArgs = record['args'];
    const argsDict = (rawArgs !== undefined ? rawArgs : {}) as Record<string, unknown>;
    if (!this.enforceIdentifiers) {
      // `allowedCallers` arrived in v1.0, so below it a binding may call any
      // function the catalog declares.
      this.validateFunction(rawName, argsDict);
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

  private validatePreV10AtDirectives(
    val: unknown,
    schemaOrSchemas: z.ZodTypeAny | readonly z.ZodTypeAny[] | undefined,
    componentType: string,
    id: string,
    currentPath = '',
    legacyAccessibilitySchema?: z.ZodTypeAny,
  ): void {
    if (val === null || typeof val !== 'object') {
      return;
    }
    const baseSchemas =
      schemaOrSchemas === undefined
        ? undefined
        : Array.isArray(schemaOrSchemas)
          ? schemaOrSchemas
          : [schemaOrSchemas];
    const expanded = baseSchemas ? expandPreV10Schemas(baseSchemas, val) : undefined;

    if (Array.isArray(val)) {
      const elemSchemas: z.ZodTypeAny[] = [];
      if (expanded) {
        for (const s of expanded) {
          if (s._def?.typeName === 'ZodArray') {
            elemSchemas.push(s._def.type as z.ZodTypeAny);
          }
        }
      }
      const nextSchemas = elemSchemas.length > 0 ? elemSchemas : undefined;
      for (let i = 0; i < val.length; i++) {
        this.validatePreV10AtDirectives(
          val[i],
          nextSchemas,
          componentType,
          id,
          `${currentPath}/${i}`,
        );
      }
      return;
    }

    const record = val as Record<string, unknown>;
    const objSchemas: z.AnyZodObject[] = [];
    const recordValueSchemas: z.ZodTypeAny[] = [];
    if (expanded) {
      for (const s of expanded) {
        const typeName = s._def?.typeName as string | undefined;
        if (typeName === 'ZodObject') {
          objSchemas.push(s as z.AnyZodObject);
        } else if (typeName === 'ZodRecord' && (s._def as {valueType?: z.ZodTypeAny}).valueType) {
          recordValueSchemas.push((s._def as {valueType: z.ZodTypeAny}).valueType);
        }
      }
    }

    for (const [k, v] of Object.entries(record)) {
      const propPath = `${currentPath}/${k}`;
      const explicitPropSchemas: z.ZodTypeAny[] = [];
      for (const objSchema of objSchemas) {
        const shape = (
          typeof objSchema.shape === 'function' ? objSchema.shape() : objSchema.shape
        ) as Record<string, z.ZodTypeAny>;
        if (Object.hasOwn(shape, k)) {
          explicitPropSchemas.push(shape[k]);
        }
      }
      if (PRE_V10_FORBIDDEN_AT_DIRECTIVES.has(k) && explicitPropSchemas.length === 0) {
        throwComponentValidationErrorAt(
          propPath,
          `Directive '${k}' is only supported from A2UI v1.0 and is not declared by component '${componentType}' (${id}).`,
        );
      }
      let nextSchemas: readonly z.ZodTypeAny[] | undefined;
      if (explicitPropSchemas.length > 0) {
        nextSchemas = explicitPropSchemas;
      } else if (currentPath === '' && k === 'accessibility' && legacyAccessibilitySchema) {
        nextSchemas = [legacyAccessibilitySchema];
      } else if (expanded) {
        const fallbackSchemas: z.ZodTypeAny[] = [...recordValueSchemas];
        for (const objSchema of objSchemas) {
          const catchall = (objSchema._def as {catchall?: z.ZodTypeAny}).catchall;
          if (catchall && catchall._def?.typeName !== 'ZodNever') {
            fallbackSchemas.push(catchall);
          }
        }
        nextSchemas = fallbackSchemas.length > 0 ? fallbackSchemas : undefined;
      }
      this.validatePreV10AtDirectives(v, nextSchemas, componentType, id, propPath);
    }
  }

  private validateV10Directives(
    val: unknown,
    behavior: BehaviorNode | undefined,
    componentType: string,
    id: string,
    currentPath = '',
    inDynamicValue = false,
    layout?: ComponentMixinLayout,
  ): void {
    if (Array.isArray(val)) {
      if (behavior?.type === 'CHECKABLE') {
        for (let i = 0; i < val.length; i++) {
          const rule = val[i];
          const rulePath = `${currentPath}/${i}`;
          if (isPlainRecord(rule)) {
            this.validateV10Directives(rule, undefined, componentType, id, rulePath, true, layout);
          }
        }
        return;
      }
      const elemBehavior = behavior?.type === 'ARRAY' ? behavior.element : undefined;
      for (let i = 0; i < val.length; i++) {
        this.validateV10Directives(
          val[i],
          elemBehavior,
          componentType,
          id,
          `${currentPath}/${i}`,
          inDynamicValue,
          layout,
        );
      }
      return;
    }

    if (!isPlainRecord(val)) {
      return;
    }

    const keys = Object.keys(val);
    const isDynamicContext = inDynamicValue || behavior?.type === 'DYNAMIC';

    if (currentPath === '') {
      rethrowAt('/', () =>
        validateReservedDirectives(
          keys.filter(key => !AT_COMPONENT_MIXIN_KEYS.has(key)),
          this.catalog.protocolVersion,
          RESERVED_DATA_DIRECTIVES,
        ),
      );
      const shape = behavior?.type === 'OBJECT' ? behavior.shape : undefined;
      const catchall = behavior?.type === 'OBJECT' ? behavior.catchall : undefined;
      for (const [k, v] of Object.entries(val)) {
        if (AT_COMPONENT_MIXIN_KEYS.has(k)) {
          if (k === '@accessibility' || k === '@checks') {
            this.validateV10Directives(v, undefined, componentType, id, `/${k}`, true, layout);
          }
          continue;
        }
        if ((k === 'accessibility' || k === 'checks') && !layout?.customKeys.has(k)) {
          this.validateV10Directives(v, undefined, componentType, id, `/${k}`, true, layout);
          continue;
        }
        const childBehavior = shape && Object.hasOwn(shape, k) ? shape[k] : catchall;
        this.validateV10Directives(v, childBehavior, componentType, id, `/${k}`, false, layout);
      }
      return;
    }

    rethrowAt(currentPath, () =>
      validateReservedDirectives(
        keys,
        this.catalog.protocolVersion,
        isDynamicContext ? RESERVED_DATA_DIRECTIVES : RESERVED_PROPERTY_DIRECTIVES,
      ),
    );

    if (isDynamicContext) {
      this.validateDynamicObjectDirectives(val, keys, componentType, id, currentPath);
      return;
    }

    if (Object.hasOwn(val, '@child')) {
      validateAtChildDirective(val, keys, componentType, id, currentPath);
      return;
    }

    if (Object.hasOwn(val, '@action')) {
      this.validateAtActionDirective(val, keys, componentType, id, currentPath);
      return;
    }

    if (Object.hasOwn(val, '@functionCall')) {
      this.validateAtFunctionCallDirective(val, keys, componentType, id, currentPath);
      return;
    }

    // TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
    if (behavior?.type === 'ACTION') {
      if (Object.hasOwn(val, 'event') && isPlainRecord(val['event'])) {
        const ev = val['event'];
        if ('userMessage' in ev && ev['userMessage'] !== undefined) {
          this.validateV10Directives(
            ev['userMessage'],
            undefined,
            componentType,
            id,
            `${currentPath}/event/userMessage`,
            true,
            layout,
          );
        }
        if ('context' in ev && isPlainRecord(ev['context'])) {
          for (const [ck, cv] of Object.entries(ev['context'])) {
            this.validateV10Directives(
              cv,
              undefined,
              componentType,
              id,
              `${currentPath}/event/context/${ck}`,
              true,
              layout,
            );
          }
        }
        return;
      }
      if (Object.hasOwn(val, 'functionCall') && isPlainRecord(val['functionCall'])) {
        const fnVal = val['functionCall'];
        if (Object.hasOwn(fnVal, '@call')) {
          this.validateCallDirectiveArgs(fnVal, componentType, id, `${currentPath}/functionCall`);
        } else if (isPlainRecord(fnVal['args'])) {
          for (const [ak, av] of Object.entries(fnVal['args'])) {
            this.validateV10Directives(
              av,
              undefined,
              componentType,
              id,
              `${currentPath}/functionCall/args/${ak}`,
              true,
              layout,
            );
          }
        }
        return;
      }
    }

    if (Object.hasOwn(val, '@call')) {
      if (Object.hasOwn(val, '@path')) {
        throwComponentValidationErrorAt(
          currentPath,
          `Invalid dynamic directive in component '${componentType}' (${id}): '@path' and '@call' cannot appear on the same object.`,
        );
      }
      this.validateCallDirectiveArgs(val, componentType, id, currentPath);
      return;
    }

    if (Object.hasOwn(val, '@path')) {
      if (typeof val['@path'] !== 'string' || val['@path'].length === 0) {
        throwComponentValidationErrorAt(
          currentPath,
          `Invalid '@path' directive in component '${componentType}' (${id}): '@path' must be a non-empty string.`,
        );
      }
      return;
    }

    const shape = behavior?.type === 'OBJECT' ? behavior.shape : undefined;
    const catchall = behavior?.type === 'OBJECT' ? behavior.catchall : undefined;
    for (const [k, v] of Object.entries(val)) {
      const childBehavior = shape && Object.hasOwn(shape, k) ? shape[k] : catchall;
      this.validateV10Directives(
        v,
        childBehavior,
        componentType,
        id,
        `${currentPath}/${k}`,
        false,
        layout,
      );
    }
  }

  private validateDynamicObjectDirectives(
    val: Record<string, unknown>,
    keys: string[],
    componentType: string,
    id: string,
    currentPath: string,
  ): void {
    if (Object.hasOwn(val, '@path') && Object.hasOwn(val, '@call')) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid dynamic directive in component '${componentType}' (${id}): '@path' and '@call' cannot appear on the same object.`,
      );
    }
    if (Object.hasOwn(val, '@call')) {
      this.validateCallDirectiveArgs(val, componentType, id, currentPath);
      return;
    }
    for (const k of keys) {
      this.validateV10Directives(val[k], undefined, componentType, id, `${currentPath}/${k}`, true);
    }
  }

  private validateCallDirectiveArgs(
    val: Record<string, unknown>,
    componentType: string,
    id: string,
    currentPath: string,
  ): void {
    if (typeof val['@call'] !== 'string') {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@call' directive in component '${componentType}' (${id}): '@call' must be a string.`,
      );
    }
    if (
      'catalogId' in val &&
      val['catalogId'] !== undefined &&
      typeof val['catalogId'] !== 'string'
    ) {
      throwComponentValidationErrorAt(
        `${currentPath}/catalogId`,
        nonStringCatalogIdMessage(val['@call']),
      );
    }
    if (isPlainRecord(val['args'])) {
      for (const [ak, av] of Object.entries(val['args'])) {
        this.validateV10Directives(
          av,
          undefined,
          componentType,
          id,
          `${currentPath}/args/${ak}`,
          true,
        );
      }
    }
  }

  private validateAtActionDirective(
    val: Record<string, unknown>,
    keys: string[],
    componentType: string,
    id: string,
    currentPath: string,
  ): void {
    if (keys.length !== 1) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@action' directive in component '${componentType}' (${id}): '@action' must be the only key in the object.`,
      );
    }
    const inner = val['@action'];
    if (!isPlainRecord(inner)) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@action' directive in component '${componentType}' (${id}): value must be an object.`,
      );
    }
    rethrowAt(`${currentPath}/@action`, () =>
      validateReservedDirectives(
        Object.keys(inner),
        this.catalog.protocolVersion,
        RESERVED_DATA_DIRECTIVES,
      ),
    );
    for (const k of Object.keys(inner)) {
      if (k !== 'name' && k !== 'userMessage' && k !== 'context') {
        throwComponentValidationErrorAt(
          `${currentPath}/@action/${k}`,
          `Invalid '@action' directive in component '${componentType}' (${id}): unrecognized key '${k}'.`,
        );
      }
    }
    if (typeof inner['name'] !== 'string' || inner['name'].length === 0) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@action' directive in component '${componentType}' (${id}): 'name' must be a non-empty string.`,
      );
    }
    if ('userMessage' in inner && inner['userMessage'] !== undefined) {
      const msg = inner['userMessage'];
      if (typeof msg !== 'string' && !isPlainRecord(msg)) {
        throwComponentValidationErrorAt(
          `${currentPath}/@action/userMessage`,
          `Invalid '@action' userMessage in component '${componentType}' (${id}): must be a DynamicString.`,
        );
      }
      this.validateV10Directives(
        msg,
        undefined,
        componentType,
        id,
        `${currentPath}/@action/userMessage`,
        true,
      );
    }
    if ('context' in inner && inner['context'] !== undefined) {
      const ctx = inner['context'];
      if (!isPlainRecord(ctx)) {
        throwComponentValidationErrorAt(
          `${currentPath}/@action/context`,
          `Invalid '@action' context in component '${componentType}' (${id}): 'context' must be an object.`,
        );
      }
      rethrowAt(`${currentPath}/@action/context`, () =>
        validateReservedDirectives(
          Object.keys(ctx),
          this.catalog.protocolVersion,
          RESERVED_DATA_DIRECTIVES,
        ),
      );
      for (const [ck, cv] of Object.entries(ctx)) {
        this.validateV10Directives(
          cv,
          undefined,
          componentType,
          id,
          `${currentPath}/@action/context/${ck}`,
          true,
        );
      }
    }
  }

  private validateAtFunctionCallDirective(
    val: Record<string, unknown>,
    keys: string[],
    componentType: string,
    id: string,
    currentPath: string,
  ): void {
    if (keys.length !== 1) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@functionCall' directive in component '${componentType}' (${id}): '@functionCall' must be the only key in the object.`,
      );
    }
    const inner = val['@functionCall'];
    if (!isPlainRecord(inner)) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@functionCall' directive in component '${componentType}' (${id}): value must be an object.`,
      );
    }
    rethrowAt(`${currentPath}/@functionCall`, () =>
      validateReservedDirectives(
        Object.keys(inner),
        this.catalog.protocolVersion,
        RESERVED_DATA_DIRECTIVES,
      ),
    );
    this.validateCallDirectiveArgs(inner, componentType, id, `${currentPath}/@functionCall`);
  }

  private validateNestedFunctions(
    val: unknown,
    componentCatalogId: string | undefined,
    currentPath = '',
    behavior?: BehaviorNode,
    inDynamicValue = false,
    layout?: ComponentMixinLayout,
    actionContextKind?: 'atAction' | 'legacyEvent',
  ): void {
    if (Array.isArray(val)) {
      if (behavior?.type === 'CHECKABLE') {
        for (let i = 0; i < val.length; i++) {
          this.validateNestedFunctions(
            val[i],
            componentCatalogId,
            `${currentPath}/${i}`,
            undefined,
            true,
            layout,
          );
        }
        return;
      }
      const elemBehavior = behavior?.type === 'ARRAY' ? behavior.element : undefined;
      for (let i = 0; i < val.length; i++) {
        this.validateNestedFunctions(
          val[i],
          componentCatalogId,
          `${currentPath}/${i}`,
          elemBehavior,
          inDynamicValue,
          layout,
        );
      }
      return;
    }

    if (typeof val !== 'object' || val === null) {
      return;
    }

    const record = val as Record<string, unknown>;
    const isDynamicContext = inDynamicValue || behavior?.type === 'DYNAMIC';
    if (this.enforceIdentifiers) {
      // The component envelope mixins (`@metadata` and the like) are allowed
      // at the root of a component only; nested anywhere else they are
      // unrecognized directives.
      const keys = Object.keys(record);
      validateReservedDirectives(
        currentPath === '' ? keys.filter(key => !AT_COMPONENT_MIXIN_KEYS.has(key)) : keys,
        this.catalog.protocolVersion,
        currentPath === ''
          ? RESERVED_DATA_DIRECTIVES
          : isDynamicContext
            ? RESERVED_DATA_DIRECTIVES
            : RESERVED_PROPERTY_DIRECTIVES,
      );
    }
    const rawName = this.enforceIdentifiers
      ? record['@call']
      : (record['call'] ?? record['function']);
    if (typeof rawName === 'string' && (this.enforceIdentifiers || rawName.length > 0)) {
      try {
        this.checkNestedCallRecord(record, rawName, componentCatalogId);
      } catch (err: unknown) {
        if (err instanceof A2uiValidationError && currentPath) {
          err.path = err.path && err.path !== '/' ? `${currentPath}${err.path}` : currentPath;
        }
        throw err;
      }
    }

    const shape = behavior?.type === 'OBJECT' ? behavior.shape : undefined;
    const catchall = behavior?.type === 'OBJECT' ? behavior.catchall : undefined;
    const isCallRecord = this.enforceIdentifiers
      ? Object.hasOwn(record, '@call')
      : typeof record['call'] === 'string' || typeof record['function'] === 'string';

    for (const [k, v] of Object.entries(record)) {
      const nextChildBehavior =
        currentPath === '' && AT_COMPONENT_MIXIN_KEYS.has(k)
          ? undefined
          : shape && Object.hasOwn(shape, k)
            ? shape[k]
            : catchall;
      const isRootMixinDynamic =
        currentPath === '' &&
        (k === '@accessibility' ||
          k === '@checks' ||
          ((k === 'accessibility' || k === 'checks') && !layout?.customKeys.has(k)));
      const nextActionKind =
        this.enforceIdentifiers && Object.hasOwn(record, '@action') && k === '@action'
          ? 'atAction'
          : behavior?.type === 'ACTION' && k === 'event'
            ? 'legacyEvent'
            : undefined;
      const isActionDynamicField =
        (actionContextKind === 'atAction' || actionContextKind === 'legacyEvent') &&
        (k === 'context' || k === 'userMessage');
      const isLegacyActionFnSlot = behavior?.type === 'ACTION' && k === 'functionCall';
      const nextInDynamic =
        isDynamicContext ||
        isRootMixinDynamic ||
        (isCallRecord && k === 'args') ||
        isActionDynamicField ||
        isLegacyActionFnSlot ||
        nextChildBehavior?.type === 'DYNAMIC';
      this.validateNestedFunctions(
        v,
        componentCatalogId,
        `${currentPath}/${k}`,
        nextChildBehavior,
        nextInDynamic,
        layout,
        nextActionKind,
      );
    }
  }

  /**
   * Validates the arguments of a function call against the catalog definition.
   *
   * @param name Name of the function being called.
   * @param args Arguments supplied by the payload.
   * @returns The parsed arguments object (including any schema defaults).
   * @throws {A2uiValidationError} If the function name, an argument name, or an
   *   argument value fails validation.
   */
  validateFunction(name: string, args?: Record<string, unknown>): Record<string, unknown> {
    this.assertFunctionIdentifiers(name, args);

    const fn =
      this.enforceIdentifiers && name.startsWith('@')
        ? getSystemFunctionApi(name)
        : this.catalog.functions.get(name);
    if (!fn) {
      if (!this.allowUnknown) {
        throw new A2uiValidationError(`Unrecognized function '${name}'`);
      }
      return (args ?? {}) as Record<string, unknown>;
    }

    if (!fn.schema) {
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

    const result = fn.schema.safeParse(args ?? {});
    if (!result.success) {
      const formattedErrors = result.error.errors.map(formatZodIssue).join(', ');
      const details = zodIssuesToDetails(result.error.issues, '/args');
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
   * Validates a surface theme against the catalog's theme schema.
   *
   * A catalog that declares no theme schema accepts any theme.
   *
   * @param theme Theme payload supplied on `createSurface`.
   * @returns The parsed theme, which a schema may have defaulted or coerced.
   * @throws {A2uiValidationError} If the theme does not satisfy the schema.
   */
  validateTheme(theme: unknown): unknown {
    const themeSchema = this.catalog.themeSchema;
    if (!themeSchema) return theme;

    const result = themeSchema.safeParse(theme);
    if (!result.success) {
      const formattedErrors = result.error.errors.map(formatZodIssue).join(', ');
      const details = zodIssuesToDetails(result.error.issues, '/theme');
      throw new A2uiValidationError(
        `Validation failed for theme: ${formattedErrors}`,
        details,
        'VALIDATION_ERROR',
        {path: details[0]?.path ?? '/theme'},
      );
    }
    return result.data;
  }

  /**
   * Asserts that an identifier is valid if identifier enforcement is enabled.
   *
   * @param name Identifier to check.
   * @param message Error message to use when validation fails.
   * @param allowLeadingAt Whether a leading `@` is permitted.
   * @param path Optional JSON Pointer path for error context.
   * @throws {A2uiValidationError} If identifier enforcement is active and `name` is invalid.
   */
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

/**
 * Converts Zod validation issues into structured `A2uiErrorDetail` entries.
 */
function zodIssuesToDetails(issues: readonly z.ZodIssue[], prefix = ''): A2uiErrorDetail[] {
  return issues.map(issue => {
    const segments = issue.path.map(s => String(s).replace(/~/g, '~0').replace(/\//g, '~1'));
    if (
      issue.code === 'unrecognized_keys' &&
      'keys' in issue &&
      Array.isArray(issue.keys) &&
      issue.keys.length > 0
    ) {
      segments.push(String(issue.keys[0]).replace(/~/g, '~0').replace(/\//g, '~1'));
    }
    const relPath = segments.length > 0 ? `/${segments.join('/')}` : '';
    const fullPath = `${prefix}${relPath}` || '/';
    const isMissing =
      (issue.code === 'invalid_type' && 'received' in issue && issue.received === 'undefined') ||
      issue.message === 'Required';
    return {
      path: fullPath,
      code: isMissing ? 'missing_field' : 'invalid_value',
      message: issue.message,
    };
  });
}

/**
 * Strips the structural `id` and `component` keys from a pre-1.0 component
 * payload, returning only component properties.
 *
 * Below v1.0 `metadata` and `catalogId` are not envelope fields, so a
 * component that declares them keeps them as properties.
 *
 * @param comp Raw component payload.
 * @returns New object without `id` or `component`.
 */
function stripStructuralKeys(comp: Record<string, unknown>): Record<string, unknown> {
  const {id: _id, component: _component, ...properties} = comp;
  return properties;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function throwComponentValidationErrorAt(path: string, message: string): never {
  const normPath = path || '/';
  throw new A2uiValidationError(
    message,
    [{path: normPath, code: 'invalid_value', message}],
    'VALIDATION_ERROR',
    {path: normPath},
  );
}

function validateAtChildDirective(
  val: Record<string, unknown>,
  keys: string[],
  componentType: string,
  id: string,
  currentPath: string,
): void {
  const childVal = val['@child'];
  if (keys.length === 1) {
    if (typeof childVal === 'string') {
      if (childVal.length === 0) {
        throwComponentValidationErrorAt(
          currentPath,
          `Invalid '@child' directive in component '${componentType}' (${id}): '@child' must be a non-empty string.`,
        );
      }
      return;
    }
    if (Array.isArray(childVal)) {
      for (const entry of childVal) {
        if (typeof entry !== 'string' || entry.length === 0) {
          throwComponentValidationErrorAt(
            currentPath,
            `Invalid '@child' directive list in component '${componentType}' (${id}): all entries must be non-empty strings.`,
          );
        }
      }
      return;
    }
    throwComponentValidationErrorAt(
      currentPath,
      `Invalid '@child' directive in component '${componentType}' (${id}): '@child' must be a non-empty string or string array.`,
    );
  }

  if (keys.length === 2 && Object.hasOwn(val, '@path')) {
    const pathVal = val['@path'];
    if (typeof childVal !== 'string' || childVal.length === 0) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@child' template directive in component '${componentType}' (${id}): '@child' must be a non-empty string when paired with '@path'.`,
      );
    }
    if (typeof pathVal !== 'string' || pathVal.length === 0) {
      throwComponentValidationErrorAt(
        currentPath,
        `Invalid '@child' template directive in component '${componentType}' (${id}): '@path' must be a non-empty string.`,
      );
    }
    return;
  }

  throwComponentValidationErrorAt(
    currentPath,
    `Invalid '@child' directive in component '${componentType}' (${id}): unexpected key combination (${keys.join(', ')}).`,
  );
}

function isActionSchemaNode(schema: z.ZodTypeAny, visited = new Set<z.ZodTypeAny>()): boolean {
  const field = unwrapZodField(schema);
  if (Array.from(field.traversed).some(s => visited.has(s))) return false;
  const nextVisited = new Set(visited);
  for (const s of field.traversed) nextVisited.add(s);

  const defName = field.firstRefDefName || extractRefDefName(schema.description ?? '');
  if (defName === 'Action') return true;

  const current = field.schema;
  const typeName = current?._def?.typeName as string | undefined;
  if (typeName === 'ZodObject') {
    const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const keys = Object.keys(shape);
    return (
      keys.length === 1 &&
      (keys[0] === 'event' ||
        keys[0] === 'functionCall' ||
        keys[0] === '@action' ||
        keys[0] === '@functionCall')
    );
  }
  const unionOptions = getUnionOptions(current);
  if (unionOptions) {
    return unionOptions.some(opt => isActionSchemaNode(opt, nextVisited));
  }
  if (typeName === 'ZodIntersection') {
    const def = current._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    return isActionSchemaNode(def.left, nextVisited) || isActionSchemaNode(def.right, nextVisited);
  }
  if (typeName === 'ZodPipeline') {
    const def = current._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    return isActionSchemaNode(def.in, nextVisited) || isActionSchemaNode(def.out, nextVisited);
  }
  return false;
}

function isChildSlotSchema(schema: z.ZodTypeAny): boolean {
  if (isChildSchema(schema, V10_AT_CHILD_REF_OPTIONS)) {
    return true;
  }
  const field = unwrapZodField(schema);
  if (isSingleChildRefObject(field.schema, undefined, V10_AT_CHILD_REF_OPTIONS)) {
    return true;
  }
  const defName = field.firstRefDefName;
  return Boolean(defName && V10_AT_CHILD_REF_OPTIONS.childRefNames?.has(defName));
}

function isChildListSlotSchema(schema: z.ZodTypeAny): boolean {
  if (isChildListSchema(schema, V10_AT_CHILD_REF_OPTIONS)) {
    return true;
  }
  const field = unwrapZodField(schema);
  if (
    isTemplateRefObject(field.schema, V10_AT_CHILD_REF_OPTIONS) ||
    isStaticListChildRefObject(field.schema, undefined, V10_AT_CHILD_REF_OPTIONS)
  ) {
    return true;
  }
  const defName = field.firstRefDefName;
  return Boolean(
    field.refs.has('child-list') ||
    (defName && V10_AT_CHILD_REF_OPTIONS.childListRefNames?.has(defName)),
  );
}

// TODO(#4168): Remove legacy v1.0 bare Child/ChildList/Action fallback.
function normalizeValueForSchema(
  val: unknown,
  schema: z.ZodTypeAny,
  visited = new Set<z.ZodTypeAny>(),
): unknown {
  if (val === undefined || val === null || !schema) {
    return val;
  }

  const field = unwrapZodField(schema);
  const current = field.schema;
  if (!current?._def || visited.has(current)) {
    return val;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(current);

  if (isActionSchemaNode(schema) && isPlainRecord(val)) {
    if (schema.safeParse(val).success) {
      return val;
    }
    const keys = Object.keys(val);
    if (keys.length === 1) {
      if (Object.hasOwn(val, '@action')) {
        const candidate = {event: val['@action']};
        if (schema.safeParse(candidate).success) return candidate;
      } else if (Object.hasOwn(val, '@functionCall')) {
        const candidate = {functionCall: val['@functionCall']};
        if (schema.safeParse(candidate).success) return candidate;
      } else if (Object.hasOwn(val, 'event')) {
        const candidate = {'@action': val['event']};
        if (schema.safeParse(candidate).success) return candidate;
      } else if (Object.hasOwn(val, 'functionCall')) {
        const candidate = {'@functionCall': val['functionCall']};
        if (schema.safeParse(candidate).success) return candidate;
      }
    }
    return val;
  }

  if (isChildListSlotSchema(schema)) {
    if (!schema.safeParse(val).success) {
      if (isPlainRecord(val) && Object.hasOwn(val, '@child')) {
        if (Array.isArray(val['@child']) && schema.safeParse(val['@child']).success) {
          return val['@child'];
        }
        if (typeof val['@child'] === 'string' && typeof val['@path'] === 'string') {
          const legacyPathCandidate = {componentId: val['@child'], path: val['@path']};
          if (schema.safeParse(legacyPathCandidate).success) return legacyPathCandidate;
          const v10PathCandidate = {componentId: val['@child'], '@path': val['@path']};
          if (schema.safeParse(v10PathCandidate).success) return v10PathCandidate;
        }
      } else if (Array.isArray(val) && val.every(item => typeof item === 'string')) {
        const candidate = {'@child': val};
        if (schema.safeParse(candidate).success) return candidate;
      } else if (
        isPlainRecord(val) &&
        typeof val['componentId'] === 'string' &&
        typeof (val['@path'] ?? val['path']) === 'string'
      ) {
        const candidate = {
          '@child': val['componentId'],
          '@path': (val['@path'] ?? val['path']) as string,
        };
        if (schema.safeParse(candidate).success) return candidate;
      }
    }
  }

  if (isChildSlotSchema(schema)) {
    if (!schema.safeParse(val).success) {
      if (
        isPlainRecord(val) &&
        Object.hasOwn(val, '@child') &&
        !Object.hasOwn(val, '@path') &&
        typeof val['@child'] === 'string' &&
        schema.safeParse(val['@child']).success
      ) {
        return val['@child'];
      }
      if (typeof val === 'string' && schema.safeParse({'@child': val}).success) {
        return {'@child': val};
      }
    }
    return val;
  }

  const typeName = current._def.typeName as string | undefined;
  if (typeName === 'ZodArray' && Array.isArray(val)) {
    const elemSchema = current._def.type as z.ZodTypeAny;
    return val.map(item => normalizeValueForSchema(item, elemSchema, nextVisited));
  }

  if (typeName === 'ZodObject' && isPlainRecord(val)) {
    const shape = (current as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
    const rawCatchall = (current._def as {catchall?: z.ZodTypeAny})['catchall'];
    const catchall =
      rawCatchall && rawCatchall._def?.typeName !== 'ZodNever' ? rawCatchall : undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      const childSchema = Object.hasOwn(shape, k) ? shape[k] : catchall;
      out[k] = childSchema ? normalizeValueForSchema(v, childSchema, nextVisited) : v;
    }
    return out;
  }

  if (typeName === 'ZodRecord' && isPlainRecord(val)) {
    const valueType = (current._def as {valueType?: z.ZodTypeAny})['valueType'];
    if (!valueType) return val;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = normalizeValueForSchema(v, valueType, nextVisited);
    }
    return out;
  }

  if (typeName === 'ZodIntersection') {
    const def = current._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
    const leftNorm = normalizeValueForSchema(val, def.left, nextVisited);
    return normalizeValueForSchema(leftNorm, def.right, nextVisited);
  }

  if (typeName === 'ZodPipeline') {
    const def = current._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
    const inField = unwrapZodField(def.in);
    if (inField.hasTransform) {
      return normalizeValueForSchema(val, def.in, nextVisited);
    }
    const inNorm = normalizeValueForSchema(val, def.in, nextVisited);
    return normalizeValueForSchema(inNorm, def.out, nextVisited);
  }

  const unionOptions = getUnionOptions(current);
  if (unionOptions) {
    if (schema.safeParse(val).success) {
      return val;
    }
    for (const opt of unionOptions) {
      const candidate = normalizeValueForSchema(val, opt, nextVisited);
      if (opt.safeParse(candidate).success) {
        return candidate;
      }
    }
  }

  return val;
}

function expandPreV10Schemas(
  schemas: readonly z.ZodTypeAny[],
  val: unknown,
  visited = new Set<z.ZodTypeAny>(),
): z.ZodTypeAny[] {
  const result: z.ZodTypeAny[] = [];
  for (const s of schemas) {
    const field = unwrapZodField(s);
    let seen = false;
    for (const t of field.traversed) {
      if (visited.has(t)) {
        seen = true;
        break;
      }
    }
    if (seen) continue;
    const nextVisited = new Set(visited);
    for (const t of field.traversed) {
      nextVisited.add(t);
    }
    const current = field.schema;
    const typeName = current?._def?.typeName as string | undefined;
    const unionOpts = getUnionOptions(current);
    if (unionOpts) {
      const matching = unionOpts.filter(opt => opt.safeParse(val).success);
      result.push(
        ...expandPreV10Schemas(matching.length > 0 ? matching : unionOpts, val, nextVisited),
      );
    } else if (typeName === 'ZodIntersection') {
      const def = current._def as {left: z.ZodTypeAny; right: z.ZodTypeAny};
      result.push(...expandPreV10Schemas([def.left, def.right], val, nextVisited));
    } else if (typeName === 'ZodPipeline') {
      const def = current._def as {in: z.ZodTypeAny; out: z.ZodTypeAny};
      const inField = unwrapZodField(def.in);
      result.push(
        ...expandPreV10Schemas(
          inField.hasTransform ? [def.in] : [def.in, def.out],
          val,
          nextVisited,
        ),
      );
    } else if (current) {
      result.push(current);
    }
  }
  return result;
}

function normalizePropsForSchema(
  properties: Record<string, unknown>,
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  const normalized = normalizeValueForSchema(properties, schema);
  return isPlainRecord(normalized) ? normalized : properties;
}

/**
 * Runs `check`, prefixing the path of any `A2uiValidationError` it throws.
 *
 * @param path JSON Pointer of the value `check` validates.
 * @param check The check to run.
 */
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
