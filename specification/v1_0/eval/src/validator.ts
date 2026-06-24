/*
 * Copyright 2025 Google LLC
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

import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {GeneratedResult, ValidatedResult, IssueSeverity, ProtocolSchemas} from './types';
import {logger} from './logger';

export class Validator {
  private ajv: Ajv;
  private validateFn: any;
  private basicFunctions = new Set<string>();

  constructor(
    private schemas: ProtocolSchemas,
    private outputDir?: string,
  ) {
    // Set strict: false to be lenient with unknown keywords, if any.
    this.ajv = new Ajv({allErrors: true, strict: false});
    addFormats(this.ajv);
    for (const [name, schema] of Object.entries(schemas)) {
      if (schema) {
        this.ajv.addSchema(schema, name);
      }
    }
    this.validateFn = this.ajv.getSchema(
      'https://a2ui.org/specification/v1_0/server_to_client.json',
    );

    // Populate basic functions from the catalog schema
    // schemas are keyed by filename in index.ts
    const catalogSchema = schemas['catalogs/basic/catalog.json'];
    if (
      catalogSchema &&
      typeof catalogSchema.functions === 'object' &&
      catalogSchema.functions !== null
    ) {
      for (const funcName of Object.keys(catalogSchema.functions)) {
        this.basicFunctions.add(funcName);
      }
    }

    if (this.basicFunctions.size === 0) {
      logger.warn(
        "No basic functions loaded from schema 'catalogs/basic/catalog.json'. Function validation will fail open.",
      );
    }
  }

  async run(results: GeneratedResult[]): Promise<ValidatedResult[]> {
    logger.info(`Starting Phase 2: Schema Validation (${results.length} items)`);
    const validatedResults: ValidatedResult[] = [];
    let passedCount = 0;
    let failedCount = 0;

    // Run schema validation sequentially (pure CPU bound).

    for (const result of results) {
      if (result.error || !result.components) {
        validatedResults.push({...result, validationErrors: []}); // Already failed generation
        continue;
      }

      const errors: string[] = [];
      const components = result.components;

      // AJV Validation
      if (this.ajv) {
        for (const message of components) {
          // Smart validation: check which key is present and validate against that specific definition
          // to avoid noisy "oneOf" errors.
          let validated = false;
          const schemaUri = 'https://a2ui.org/specification/v1_0/server_to_client.json';

          if (message.createSurface) {
            validated = this.ajv.validate(`${schemaUri}#/$defs/CreateSurfaceMessage`, message);
          } else if (message.updateComponents) {
            validated = this.ajv.validate(`${schemaUri}#/$defs/UpdateComponentsMessage`, message);
          } else if (message.updateDataModel) {
            validated = this.ajv.validate(`${schemaUri}#/$defs/UpdateDataModelMessage`, message);
          } else if (message.deleteSurface) {
            validated = this.ajv.validate(`${schemaUri}#/$defs/DeleteSurfaceMessage`, message);
          } else {
            // Fallback to top-level validation if no known key matches (or if it's empty/invalid structure)
            validated = this.validateFn(message);
          }

          if (!validated) {
            const originalErrors = [...(this.ajv.errors || [])];

            // Map out every component generated in the message to perform targeted validation
            // and eliminate `oneOf` noise entirely.
            const pathToObject = new Map<string, any>();
            const visited = new Set<any>();
            const traverse = (obj: any, currentPath: string = '') => {
              if (typeof obj !== 'object' || obj === null || visited.has(obj)) {
                return;
              }
              visited.add(obj);

              if (Array.isArray(obj)) {
                obj.forEach((item, index) => traverse(item, `${currentPath}/${index}`));
              } else if (typeof obj === 'object' && obj !== null) {
                if (typeof obj.component === 'string') {
                  pathToObject.set(currentPath, obj);
                }
                for (const [key, value] of Object.entries(obj)) {
                  traverse(value, `${currentPath}/${key}`);
                }
              }
            };
            traverse(message);

            const targetedErrors: any[] = [];
            const handledPaths = new Set<string>();

            // Perform targeted validation for every identified component
            for (const [path, obj] of pathToObject.entries()) {
              const componentName = obj.component;
              let isValid = false;

              try {
                isValid = this.ajv.validate(
                  `catalogs/basic/catalog.json#/components/${componentName}`,
                  obj,
                );
              } catch (e) {
                // If the schema isn't found, it's a hallucinated component.
                targetedErrors.push({
                  instancePath: path,
                  message: `Unknown or hallucinated component type '${componentName}'`,
                  params: {component: componentName},
                });
                isValid = true; // prevents further noise collection, we already handled it
              }

              if (!isValid && this.ajv.errors) {
                this.ajv.errors.forEach(err => {
                  // Prepend the base path so the error correctly identifies where in the message it occurred
                  targetedErrors.push({
                    ...err,
                    instancePath: `${path}${err.instancePath}`,
                  });
                });
              }
              handledPaths.add(path);
            }

            // Filter the original errors to only keep structural errors that are OUTSIDE the
            // bounds of the components we already handled manually.
            const filteredOriginalErrors = originalErrors.filter(err => {
              if (err.keyword === 'oneOf' || err.keyword === 'anyOf') return false; // Always drop these at the top level

              // If this error happened inside a path we already handled, drop it
              for (const handledPath of handledPaths) {
                if (
                  err.instancePath === handledPath ||
                  err.instancePath.startsWith(`${handledPath}/`)
                ) {
                  return false;
                }
              }
              return true;
            });

            // Combine and format the errors
            const deduplicatedFinalErrors = [...filteredOriginalErrors, ...targetedErrors];

            errors.push(
              ...deduplicatedFinalErrors.map((err: any) => {
                // Determine the component name for the current instance path
                let componentNameStr = '';
                const pathParts = err.instancePath.split('/');
                let currentPath = err.instancePath;
                while (pathParts.length > 0) {
                  const obj = pathToObject.get(currentPath);
                  if (obj && obj.component) {
                    componentNameStr = ` (${obj.component})`;
                    break;
                  }
                  pathParts.pop();
                  currentPath = pathParts.join('/');
                }

                let msg = `${err.instancePath}${componentNameStr} ${err.message}`;
                if (err.params && Object.keys(err.params).length > 0) {
                  msg += ' (\n';
                  for (const [key, value] of Object.entries(err.params)) {
                    const formattedValue =
                      typeof value === 'object' && value !== null
                        ? JSON.stringify(value)
                        : String(value);
                    msg += `    ${key}: ${formattedValue}\n`;
                  }
                  msg += '  )';
                }
                return msg;
              }),
            );
          }
        }
      }

      // Custom Validation (Referential Integrity, etc.)
      this.validateCustom(components, errors);

      if (errors.length > 0) {
        failedCount++;
        if (this.outputDir) {
          this.saveFailure(result, errors);
        }
      } else {
        passedCount++;
      }

      validatedResults.push({
        ...result,
        validationErrors: errors,
      });
    }

    logger.info(`Phase 2: Validation Complete. Passed: ${passedCount}, Failed: ${failedCount}`);
    return validatedResults;
  }

  private saveFailure(result: GeneratedResult, errors: string[]) {
    if (!this.outputDir) return;
    const modelDir = path.join(this.outputDir, `output-${result.modelName.replace(/[\/:]/g, '_')}`);
    const detailsDir = path.join(modelDir, 'details');
    const failureData = {
      pass: false,
      reason: 'Schema validation failure',
      issues: errors.map(e => ({
        issue: e,
        severity: 'criticalSchema' as IssueSeverity,
      })),
      overallSeverity: 'criticalSchema' as IssueSeverity,
    };

    fs.writeFileSync(
      path.join(detailsDir, `${result.prompt.name}.${result.runNumber}.failed.yaml`),
      yaml.dump(failureData),
    );
  }

  private validateCustom(messages: any[], errors: string[]) {
    let hasUpdateComponents = false;
    let hasRootComponent = false;
    const createdSurfaces = new Set<string>();
    const activeSurfaces = new Set<string>();

    for (const message of messages) {
      if (message.updateComponents) {
        hasUpdateComponents = true;
        const surfaceId = message.updateComponents.surfaceId;
        if (surfaceId && !createdSurfaces.has(surfaceId)) {
          errors.push(
            `updateComponents message received for surface '${surfaceId}' before createSurface message.`,
          );
        }
        if (surfaceId && createdSurfaces.has(surfaceId) && !activeSurfaces.has(surfaceId)) {
          errors.push(
            `updateComponents message received for inactive or deleted surface '${surfaceId}'.`,
          );
        }

        this.validateUpdateComponents(message.updateComponents, errors);

        // Check for root component in this message
        if (Array.isArray(message.updateComponents.components)) {
          for (const comp of message.updateComponents.components) {
            if (comp && typeof comp === 'object' && comp.id === 'root') {
              hasRootComponent = true;
            }
          }
        }
      } else if (message.createSurface) {
        this.validateCreateSurface(message.createSurface, errors);
        const surfaceId = message.createSurface.surfaceId;
        if (surfaceId) {
          if (activeSurfaces.has(surfaceId)) {
            errors.push(
              `Duplicate createSurface message received for surface '${surfaceId}' without prior deleteSurface.`,
            );
          }
          createdSurfaces.add(surfaceId);
          activeSurfaces.add(surfaceId);
        }

        const createSurface = message.createSurface;
        if (createSurface.components) {
          hasUpdateComponents = true;

          if (Array.isArray(createSurface.components)) {
            this.validateComponentsList(createSurface.components, errors);

            // Check for root component in nested components
            for (const comp of createSurface.components) {
              if (comp && typeof comp === 'object' && comp.id === 'root') {
                hasRootComponent = true;
              }
            }
          } else {
            errors.push('createSurface.components must be an array of components.');
          }
        }
      } else if (message.updateDataModel) {
        this.validateUpdateDataModel(message.updateDataModel, errors);
        const surfaceId = message.updateDataModel.surfaceId;
        if (surfaceId) {
          if (!createdSurfaces.has(surfaceId)) {
            errors.push(
              `updateDataModel message received for surface '${surfaceId}' before createSurface message.`,
            );
          } else if (!activeSurfaces.has(surfaceId)) {
            errors.push(
              `updateDataModel message received for inactive or deleted surface '${surfaceId}'.`,
            );
          }
        }
      } else if (message.deleteSurface) {
        this.validateDeleteSurface(message.deleteSurface, errors);
        const surfaceId = message.deleteSurface.surfaceId;
        if (surfaceId) {
          if (!activeSurfaces.has(surfaceId)) {
            errors.push(
              `deleteSurface message received for inactive or non-existent surface '${surfaceId}'.`,
            );
          }
          activeSurfaces.delete(surfaceId);
        }
      } else {
        errors.push(`Unknown message type in output: ${JSON.stringify(message)}`);
      }
    }

    // Algorithmic check for root component
    if (hasUpdateComponents && !hasRootComponent) {
      errors.push(
        "Missing root component: At least one 'updateComponents' message must contain a component with id: 'root'.",
      );
    }

    this.validateFunctionCalls(messages, errors);
  }

  private validateFunctionCalls(root: any, errors: string[]) {
    if (!root || typeof root !== 'object') return;

    if (Array.isArray(root)) {
      for (const item of root) {
        this.validateFunctionCalls(item, errors);
      }
      return;
    }

    // Check if it's a FunctionCall
    if (
      root.call &&
      typeof root.call === 'string' &&
      (Object.keys(root).length === 2 || Object.keys(root).length === 3)
    ) {
      const functionName = root.call;

      if (this.basicFunctions.has(functionName)) {
        // Dummy validation: Always succeed for basic functions.
        return;
      }

      // Unknown functions are ignored here; strict schema validation should handle them if necessary.
    }

    // Recurse into properties
    for (const key in root) {
      this.validateFunctionCalls(root[key], errors);
    }
  }

  // ... Copied helper functions ...
  private validateCreateSurface(data: any, errors: string[]) {
    if (data.surfaceId === undefined) {
      errors.push("createSurface must have a 'surfaceId' property.");
    }
    if (data.catalogId === undefined) {
      errors.push("createSurface must have a 'catalogId' property.");
    }
    const allowed = [
      'surfaceId',
      'catalogId',
      'surfaceProperties',
      'sendDataModel',
      'components',
      'dataModel',
    ];
    for (const key in data) {
      if (!allowed.includes(key)) {
        errors.push(`createSurface has unexpected property: ${key}`);
      }
    }
  }

  private validateDeleteSurface(data: any, errors: string[]) {
    if (data.surfaceId === undefined) {
      errors.push("DeleteSurface must have a 'surfaceId' property.");
    }
    const allowed = ['surfaceId'];
    for (const key in data) {
      if (!allowed.includes(key)) {
        errors.push(`DeleteSurface has unexpected property: ${key}`);
      }
    }
  }

  private validateUpdateComponents(data: any, errors: string[]) {
    if (data.surfaceId === undefined) {
      errors.push("UpdateComponents must have a 'surfaceId' property.");
    }
    if (!data.components || !Array.isArray(data.components)) {
      errors.push("UpdateComponents must have a 'components' array.");
      return;
    }

    this.validateComponentsList(data.components, errors);
  }

  private validateComponentsList(components: any[], errors: string[]) {
    const componentIds = new Set<string>();
    for (const c of components) {
      if (!c || typeof c !== 'object') continue;
      const id = c.id;
      if (id) {
        if (componentIds.has(id)) {
          errors.push(`Duplicate component ID found: ${id}`);
        }
        componentIds.add(id);
      }

      // Smart Component Validation
      if (this.ajv && c.component) {
        const componentType = c.component;
        const schemaUri = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

        const defRef = `${schemaUri}#/components/${componentType}`;

        const valid = this.ajv.validate(defRef, c);
        if (!valid) {
          errors.push(
            ...(this.ajv.errors || []).map(
              (err: any) =>
                `${err.instancePath} ${err.message} (in component '${c.id || 'unknown'}')`,
            ),
          );
        }
      }
    }

    for (const component of components) {
      if (component && typeof component === 'object') {
        this.validateComponent(component, componentIds, errors);
      }
    }
  }

  private validateUpdateDataModel(data: any, errors: string[]) {
    if (data.surfaceId === undefined) {
      errors.push("UpdateDataModel must have a 'surfaceId' property.");
    }
    this.validateDataModelUpdate(data, errors);
  }

  private validateDataModelUpdate(data: any, errors: string[]) {
    // Schema validation handles types and basic structure.
    // 'op' is removed in v1.0, so we don't need to validate it or its relationship with 'value'.
    // We strictly rely on the schema for this message type now.
    // Check if 'value' is present. If it is NOT present, it implies a deletion (if path is present).
    // If path is missing and value is missing, it deletes the entire root (valid but rare).
  }

  private validateComponent(component: any, allIds: Set<string>, errors: string[]) {
    const id = component.id;
    if (!id) {
      errors.push(`Component is missing an 'id'.`);
      return;
    }

    const componentType = component.component;
    if (!componentType || typeof componentType !== 'string') {
      errors.push(`Component '${id}' is missing 'component' property.`);
      return;
    }

    // Basic required checks that might be missed by AJV if it's lenient or if we want specific messages
    // Actually AJV covers most of this, but the custom logic for 'children' and 'refs' is key.

    const checkRefs = (ids: (string | undefined)[]) => {
      for (const id of ids) {
        if (id && !allIds.has(id)) {
          errors.push(`Component ${JSON.stringify(id)} references non-existent component ID.`);
        }
      }
    };

    switch (componentType) {
      case 'Row':
      case 'Column':
      case 'List':
        if (component.children) {
          if (Array.isArray(component.children)) {
            checkRefs(component.children);
          } else if (typeof component.children === 'object' && component.children !== null) {
            if (component.children.componentId) {
              checkRefs([component.children.componentId]);
            }
          }
        }
        break;
      case 'Card':
        checkRefs([component.child]);
        break;
      case 'Tabs':
        if (component.tabs && Array.isArray(component.tabs)) {
          component.tabs.forEach((tab: any) => {
            checkRefs([tab.child]);
          });
        }
        break;
      case 'Modal':
        checkRefs([component.trigger, component.content]);
        break;
      case 'Button':
        checkRefs([component.child]);
        break;
    }
  }
}
