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

import {CatalogInterface} from '../catalog/types.js';
import {isAtLeastVersion} from '../common/semver.js';
import {isValidUax31Identifier} from '../common/uax31.js';
import {A2uiValidationError} from '../errors.js';
import {formatZodIssue} from '../processing/format-zod-issue.js';
import type {ValidationConfig} from '../validating/integrity-checker.js';

/**
 * Envelope keys that are addressed by the processor rather than described by a
 * component's property schema, and so must be removed before the payload is
 * checked against that schema.
 */
const COMPONENT_ENVELOPE_KEYS = ['id', 'component', 'catalogId', 'catalogID'] as const;

/**
 * Validates A2UI payloads against the schemas of a single catalog.
 *
 * The validator is deliberately scoped to one catalog. Multi-catalog payloads
 * are resolved to a target catalog by the caller, which then constructs a
 * validator for it; that keeps catalog resolution and schema checking in
 * separate places and mirrors Python's `PayloadValidator`.
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
  /** True when this catalog's protocol version mandates UAX #31 identifiers. */
  private readonly enforceIdentifiers: boolean;

  /**
   * Initializes a new `PayloadValidator`.
   *
   * @param catalog Catalog whose schemas define what a valid payload is.
   * @param config Validation strictness. When omitted, unknown components and
   *   functions are tolerated.
   * @param availableCatalogs Optional map of compatible catalogs available on
   *   the surface, used to validate nested function calls that specify a
   *   `catalogId` override.
   */
  constructor(
    private readonly catalog: CatalogInterface<any, any>,
    private readonly config?: ValidationConfig,
    private readonly availableCatalogs?: ReadonlyMap<string, CatalogInterface<any, any>>,
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
   * @throws {A2uiValidationError} If the identifier, the component type, any
   *   property, or any nested function call fails validation.
   */
  validateComponent(comp: Record<string, unknown>, knownType?: string): void {
    const id = comp['id'];
    if (typeof id !== 'string' || !id) {
      throw new A2uiValidationError(
        `Component '${comp['component']}' is missing an 'id'; entries require a valid string 'id'.`,
      );
    }

    this.assertIdentifier(id, `Component id '${id}' must be a valid UAX #31 identifier`);

    const declaredType = comp['component'];
    const componentType = typeof declaredType === 'string' ? declaredType : knownType;
    if (!componentType) {
      throw new A2uiValidationError(`Cannot create component ${id} without a type.`);
    }

    const componentApi = this.catalog.components.get(componentType);
    if (!componentApi) {
      if (!this.allowUnknown) {
        throw new A2uiValidationError(
          `Unknown component type '${componentType}' not found in catalog '${this.catalog.id}'.`,
        );
      }
      return;
    }

    const properties = stripEnvelopeKeys(comp);
    const result = componentApi.schema.safeParse(properties);
    if (!result.success) {
      const formattedErrors = result.error.errors.map(formatZodIssue).join(', ');
      throw new A2uiValidationError(
        `Validation failed for component '${componentType}' (${id}): ${formattedErrors}`,
        result.error.issues,
      );
    }

    this.validateNestedFunctions(properties);
  }

  /**
   * Recursively walks a component's property values and validates any nested
   * function call objects (`{call, args}`) against their target catalog.
   */
  private validateNestedFunctions(val: unknown): void {
    if (Array.isArray(val)) {
      for (const item of val) {
        this.validateNestedFunctions(item);
      }
      return;
    }

    if (typeof val !== 'object' || val === null) {
      return;
    }

    const record = val as Record<string, unknown>;
    const rawName = record['call'] ?? record['function'];
    if (typeof rawName === 'string' && rawName.length > 0) {
      const rawArgs = record['args'];
      const argsDict =
        typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : {};
      const callCatalogId =
        typeof record['catalogId'] === 'string' && record['catalogId'].length > 0
          ? record['catalogId']
          : undefined;

      if (callCatalogId && callCatalogId !== this.catalog.id) {
        if (this.availableCatalogs) {
          const targetCat = this.availableCatalogs.get(callCatalogId);
          if (!targetCat) {
            throw new A2uiValidationError(
              `Unknown catalog ID '${callCatalogId}' for function '${rawName}'.`,
            );
          }
          new PayloadValidator(targetCat, this.config, this.availableCatalogs).validateFunction(
            rawName,
            argsDict,
          );
        } else {
          // Single-catalog validator without surface context: still enforce
          // UAX #31 identifier syntax on the function name and argument keys.
          this.assertIdentifier(
            rawName,
            `Function name '${rawName}' must be a valid UAX #31 identifier`,
          );
          for (const argName of Object.keys(argsDict)) {
            this.assertIdentifier(
              argName,
              `Function argument '${argName}' in function '${rawName}' must be a valid UAX #31 identifier`,
            );
          }
        }
      } else {
        this.validateFunction(rawName, argsDict);
      }
    }

    for (const [k, v] of Object.entries(record)) {
      if (k !== 'id' && k !== 'component') {
        this.validateNestedFunctions(v);
      }
    }
  }

  /**
   * Validates the arguments of a function call against the catalog definition.
   *
   * @param name Name of the function being called.
   * @param args Arguments supplied by the payload.
   * @throws {A2uiValidationError} If the function name, an argument name, or an
   *   argument value fails validation.
   */
  validateFunction(name: string, args?: Record<string, unknown>): void {
    this.assertIdentifier(name, `Function name '${name}' must be a valid UAX #31 identifier`);

    if (args && typeof args === 'object' && !Array.isArray(args)) {
      for (const argName of Object.keys(args)) {
        this.assertIdentifier(
          argName,
          `Function argument '${argName}' in function '${name}' must be a valid UAX #31 identifier`,
        );
      }
    }

    const fn = this.catalog.functions.get(name);
    if (!fn) {
      if (!this.allowUnknown) {
        throw new A2uiValidationError(`Unrecognized function '${name}'`);
      }
      return;
    }

    if (!fn.schema) return;

    const result = fn.schema.safeParse(args ?? {});
    if (!result.success) {
      const formattedErrors = result.error.errors.map(formatZodIssue).join(', ');
      throw new A2uiValidationError(
        `Validation failed for function '${name}': ${formattedErrors}`,
        result.error.issues,
      );
    }
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
      throw new A2uiValidationError(
        `Validation failed for theme: ${formattedErrors}`,
        result.error.issues,
      );
    }
    return result.data;
  }

  /**
   * Throws when identifier enforcement is active and the name does not qualify.
   *
   * @param name Identifier to check.
   * @param message Error text to raise.
   */
  private assertIdentifier(name: string, message: string): void {
    if (!this.enforceIdentifiers) return;
    if (!isValidUax31Identifier(name)) {
      throw new A2uiValidationError(message);
    }
  }
}

/**
 * Returns a component payload's properties, without the envelope keys the
 * processor consumes itself.
 *
 * @param comp Raw component payload.
 * @returns A new object holding only schema-described properties.
 */
function stripEnvelopeKeys(comp: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(comp)) {
    if ((COMPONENT_ENVELOPE_KEYS as readonly string[]).includes(key)) continue;
    properties[key] = value;
  }
  return properties;
}
