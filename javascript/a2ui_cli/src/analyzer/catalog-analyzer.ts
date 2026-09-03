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

import {z} from 'zod';
import {Catalog, ComponentApi, FunctionApi} from '@a2ui/web_core/v0_9';
import {
  AnalysedCatalog,
  AnalysedComponentApi,
  AnalysedFunctionApi,
  EnumType,
  PropertyDescriptor,
  TypeDescriptor,
} from './types.js';

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class CatalogAnalyzer {
  private enums = new Map<string, EnumType>();

  static analyze(catalog: Catalog<ComponentApi, FunctionApi>): AnalysedCatalog {
    const analyzer = new CatalogAnalyzer();
    return analyzer.analyzeCatalog(catalog);
  }

  analyzeCatalog(catalog: Catalog<ComponentApi, FunctionApi>): AnalysedCatalog {
    this.enums.clear();

    const components = new Map<string, AnalysedComponentApi>();
    for (const [name, comp] of catalog.components.entries()) {
      components.set(name, this.analyzeComponent(comp));
    }

    const functions = new Map<string, AnalysedFunctionApi>();
    for (const [name, fn] of catalog.functions.entries()) {
      functions.set(name, this.analyzeFunction(fn));
    }

    const specVersion = (catalog as any).specVersion || 'v0.9.1';

    return {
      catalogId: catalog.id,
      specVersion,
      components,
      functions,
      enums: new Map(this.enums),
    };
  }

  private analyzeComponent(comp: ComponentApi): AnalysedComponentApi {
    const properties = new Map<string, PropertyDescriptor>();
    const requiredProps: string[] = [];
    let isCheckable = false;

    const schema = comp.schema;
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      for (const [propName, propZod] of Object.entries(shape)) {
        if (propName === 'checks' || propName === 'isValid') {
          isCheckable = true;
        }
        const {type, description, defaultValue, isRequired} = this.analyzeZodType(
          comp.name,
          propName,
          propZod as z.ZodTypeAny,
        );

        if (isRequired) {
          requiredProps.push(propName);
        }

        properties.set(propName, {
          name: propName,
          type,
          description,
          defaultValue,
          isRequired,
        });
      }
    }

    return {
      name: comp.name,
      description: schema.description,
      properties,
      requiredProperties: requiredProps,
      isCheckable,
    };
  }

  private analyzeFunction(fn: FunctionApi): AnalysedFunctionApi {
    const parameters = new Map<string, PropertyDescriptor>();
    const requiredParams: string[] = [];

    const schema = fn.schema;
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      for (const [paramName, paramZod] of Object.entries(shape)) {
        const {type, description, defaultValue, isRequired} = this.analyzeZodType(
          fn.name,
          paramName,
          paramZod as z.ZodTypeAny,
        );
        if (isRequired) {
          requiredParams.push(paramName);
        }
        parameters.set(paramName, {
          name: paramName,
          type,
          description,
          defaultValue,
          isRequired,
        });
      }
    }

    let returnTypeDesc: TypeDescriptor | undefined;
    if (fn.returnType) {
      switch (fn.returnType) {
        case 'string':
          returnTypeDesc = {kind: 'primitive', primitive: 'string'};
          break;
        case 'number':
          returnTypeDesc = {kind: 'primitive', primitive: 'float'};
          break;
        case 'boolean':
          returnTypeDesc = {kind: 'primitive', primitive: 'boolean'};
          break;
        default:
          returnTypeDesc = {kind: 'primitive', primitive: 'any'};
          break;
      }
    }

    return {
      name: fn.name,
      description: (fn as any).description || schema?.description,
      parameters,
      requiredParameters: requiredParams,
      returnType: returnTypeDesc,
    };
  }

  private analyzeZodType(
    parentName: string,
    propName: string,
    zodType: z.ZodTypeAny,
  ): {
    type: TypeDescriptor;
    description?: string;
    defaultValue?: any;
    isRequired: boolean;
  } {
    let current = zodType;
    let isRequired = true;
    let defaultValue: any = undefined;
    let description = current.description;

    // Unwrap ZodDefault, ZodOptional, ZodNullable repeatedly
    while (true) {
      if (current instanceof z.ZodOptional) {
        isRequired = false;
        current = current._def.innerType;
        if (!description) description = current.description;
      } else if (current instanceof z.ZodDefault) {
        defaultValue = current._def.defaultValue();
        isRequired = false;
        current = current._def.innerType;
        if (!description) description = current.description;
      } else if (current instanceof z.ZodNullable) {
        isRequired = false;
        current = current._def.innerType;
        if (!description) description = current.description;
      } else {
        break;
      }
    }

    // Check REF pointer in description
    const refMatch = description?.match(/REF:([^|]+)(?:\|(.*))?/);
    const cleanDescription =
      refMatch?.[2] || description?.replace(/REF:[^|]+(\|)?/, '') || description;

    if (refMatch) {
      const refPath = refMatch[1];
      if (refPath.includes('ChildList')) {
        return {
          type: {kind: 'component_list', allowedComponents: []},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('ComponentId')) {
        return {
          type: {kind: 'component_ref', allowedComponents: []},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('Action')) {
        return {
          type: {kind: 'action'},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('CheckRule')) {
        return {
          type: {kind: 'check_rule'},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('DataBinding')) {
        return {
          type: {kind: 'data_binding'},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('DynamicStringList')) {
        return {
          type: {
            kind: 'dynamic',
            inner: {
              kind: 'list',
              elementType: {kind: 'primitive', primitive: 'string'},
            },
          },
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('DynamicString')) {
        return {
          type: {kind: 'dynamic', inner: {kind: 'primitive', primitive: 'string'}},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('DynamicNumber')) {
        return {
          type: {kind: 'dynamic', inner: {kind: 'primitive', primitive: 'float'}},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('DynamicBoolean')) {
        return {
          type: {kind: 'dynamic', inner: {kind: 'primitive', primitive: 'boolean'}},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
      if (refPath.includes('DynamicValue')) {
        return {
          type: {kind: 'dynamic', inner: {kind: 'primitive', primitive: 'any'}},
          description: cleanDescription,
          defaultValue,
          isRequired,
        };
      }
    }

    // Inspect Zod type constructors
    if (current instanceof z.ZodEnum) {
      let enumName = `${parentName}${capitalize(propName)}`;
      if (
        (parentName === 'Row' || parentName === 'Column') &&
        (propName === 'justify' || propName === 'align')
      ) {
        enumName = `Flex${capitalize(propName)}`;
      }
      const enumType: EnumType = {
        kind: 'enum',
        name: enumName,
        values: current._def.values,
        description: cleanDescription,
      };
      this.enums.set(enumName, enumType);
      return {
        type: enumType,
        description: cleanDescription,
        defaultValue,
        isRequired,
      };
    }

    if (current instanceof z.ZodString) {
      return {
        type: {kind: 'primitive', primitive: 'string'},
        description: cleanDescription,
        defaultValue,
        isRequired,
      };
    }

    if (current instanceof z.ZodNumber) {
      return {
        type: {kind: 'primitive', primitive: 'float'},
        description: cleanDescription,
        defaultValue,
        isRequired,
      };
    }

    if (current instanceof z.ZodBoolean) {
      return {
        type: {kind: 'primitive', primitive: 'boolean'},
        description: cleanDescription,
        defaultValue,
        isRequired,
      };
    }

    if (current instanceof z.ZodArray) {
      const elem = this.analyzeZodType(parentName, `${propName}Item`, current._def.type);
      return {
        type: {kind: 'list', elementType: elem.type},
        description: cleanDescription,
        defaultValue,
        isRequired,
      };
    }

    if (current instanceof z.ZodRecord) {
      const val = this.analyzeZodType(parentName, `${propName}Value`, current._def.valueType);
      return {
        type: {kind: 'map', valueType: val.type},
        description: cleanDescription,
        defaultValue,
        isRequired,
      };
    }

    return {
      type: {kind: 'primitive', primitive: 'any'},
      description: cleanDescription,
      defaultValue,
      isRequired,
    };
  }
}
