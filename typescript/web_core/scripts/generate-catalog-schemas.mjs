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

import {readFileSync, writeFileSync} from 'node:fs';

/**
 * @fileoverview Schema-driven catalog code generator.
 *
 * Generates TypeScript ComponentApi and FunctionApi definitions directly from
 * specification JSON Schemas without hardcoded property lists or wrapper types.
 *
 * The generator resolves $ref pointers (local and cross-file) and merges allOf
 * inheritance branches into flat property dictionaries. Referenced definitions
 * from common_types.json are resolved dynamically without hardcoding schema names,
 * and component properties are annotated with REF markers to allow runtime schema
 * reconstruction and definition pruning.
 */

const HEADER = `/*
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

// AUTO-GENERATED FILE - DO NOT EDIT MANUALLY
// Generated from specification/ catalogs via scripts/generate-catalog-schemas.mjs
`;

/**
 * Escapes a string for single-quoted JS literals.
 */
function escapeStr(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/**
 * Converts a function name to a PascalCase identifier, stripping @ and delimiter characters.
 */
function toPascalCase(name) {
  const cleanName = name.startsWith('@') ? name.substring(1) : name;
  return cleanName
    .replace(/[-_./]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/^[a-z]/, c => c.toUpperCase());
}

/**
 * Resolves a $ref pointer to its definition name (e.g. "#/$defs/DynamicString" -> "DynamicString").
 */
function extractRefName(ref) {
  if (typeof ref !== 'string') return null;
  const defIdx = ref.indexOf('#/$defs/');
  if (defIdx !== -1) {
    return ref.substring(defIdx + 8);
  }
  const slashIdx = ref.lastIndexOf('/');
  if (slashIdx !== -1) {
    return ref.substring(slashIdx + 1);
  }
  return ref;
}

/**
 * Finds the first matching definition in a list of schemas.
 */
function findInSchemaList(schemas, commonDefs) {
  if (!Array.isArray(schemas)) return null;
  for (const s of schemas) {
    const name = findReferencedDefName(s, commonDefs);
    if (name) return name;
  }
  return null;
}

/**
 * Finds any referenced definition name inside $ref, allOf, or oneOf.
 */
function findReferencedDefName(schema, commonDefs) {
  if (!schema || typeof schema !== 'object') return null;
  if (typeof schema.$ref === 'string') {
    const name = extractRefName(schema.$ref);
    if (name && commonDefs[name]) return name;
  }
  return findInSchemaList(schema.allOf, commonDefs) || findInSchemaList(schema.oneOf, commonDefs);
}

/**
 * Attaches default values and descriptions to a Zod code string.
 */
function applyModifiers(baseCode, propSchema, isRequired) {
  let code = baseCode;
  if (propSchema.default !== undefined) {
    code +=
      typeof propSchema.default === 'string'
        ? `.default('${escapeStr(propSchema.default)}')`
        : `.default(${propSchema.default})`;
  }
  if (propSchema.description) {
    code += `.describe('${escapeStr(propSchema.description)}')`;
  }
  return isRequired ? code : `${code}.optional()`;
}

/**
 * Generates Zod code for primitive schemas.
 */
function generatePrimitiveZod(propSchema) {
  if (propSchema.type === 'string') return 'z.string()';
  if (propSchema.type === 'integer') return 'z.number().int()';
  if (propSchema.type === 'number') return 'z.number()';
  if (propSchema.type === 'boolean') return 'z.boolean()';
  return null;
}

/**
 * Generates Zod code for object schemas with child properties.
 */
function generateObjectSchemaZod(schema, commonDefs, usedImports, indent = '      ') {
  if (!schema.properties) return 'z.record(z.any())';
  const objProps = [];
  const itemReq = schema.required || [];
  for (const [subKey, subSchema] of Object.entries(schema.properties)) {
    const subCode = generatePropertyZod(subKey, subSchema, itemReq, commonDefs, usedImports);
    objProps.push(`${indent}'${subKey}': ${subCode}`);
  }
  return `z.object({\n${objProps.join(',\n')},\n${indent.substring(2)}})`;
}

/**
 * Generates Zod code for array schemas.
 */
function generateArrayZod(propSchema, commonDefs, usedImports) {
  const items = propSchema.items;
  let itemsCode = 'z.any()';
  if (items) {
    const itemDefName = findReferencedDefName(items, commonDefs);
    if (itemDefName) {
      usedImports.add(`${itemDefName}Schema`);
      itemsCode = `${itemDefName}Schema`;
    } else if (items.type === 'string') {
      itemsCode = 'z.string()';
    } else if (items.type === 'boolean') {
      itemsCode = 'z.boolean()';
    } else if (Array.isArray(items.enum)) {
      itemsCode = `z.enum([${items.enum.map(v => `'${v}'`).join(', ')}])`;
    } else if (items.type === 'number' || items.type === 'integer') {
      itemsCode = 'z.number()';
    } else if (items.type === 'object' && items.properties) {
      itemsCode = generateObjectSchemaZod(items, commonDefs, usedImports, '          ');
    }
  }
  let code = `z.array(${itemsCode})`;
  if (propSchema.minItems !== undefined) {
    code += `.min(${propSchema.minItems})`;
  }
  return code;
}

/**
 * Generates Zod expression for a component or function property schema.
 */
function generatePropertyZod(propName, propSchema, requiredList = [], commonDefs, usedImports) {
  const isRequired = requiredList.includes(propName);
  const desc = propSchema.description;

  // 1. Schema-driven $ref resolution via common_types $defs
  const defName = findReferencedDefName(propSchema, commonDefs);
  if (defName) {
    usedImports.add(`${defName}Schema`);
    const marker = desc ? `REF:#/$defs/${defName}|${escapeStr(desc)}` : `REF:#/$defs/${defName}`;
    const code = `${defName}Schema.describe('${marker}')`;
    return isRequired ? code : `${code}.optional()`;
  }

  // 2. Arrays
  if (propSchema.type === 'array') {
    return applyModifiers(
      generateArrayZod(propSchema, commonDefs, usedImports),
      propSchema,
      isRequired,
    );
  }

  // 3. Enums
  if (Array.isArray(propSchema.enum)) {
    const enumCode = `z.enum([${propSchema.enum.map(v => `'${v}'`).join(', ')}])`;
    return applyModifiers(enumCode, propSchema, isRequired);
  }

  // 4. Primitive types
  const primCode = generatePrimitiveZod(propSchema);
  if (primCode) {
    return applyModifiers(primCode, propSchema, isRequired);
  }

  // 5. Objects
  if (propSchema.type === 'object') {
    return applyModifiers(
      generateObjectSchemaZod(propSchema, commonDefs, usedImports),
      propSchema,
      isRequired,
    );
  }

  // Generic fallback
  const fallback = isRequired ? "z.any().refine(v => v !== undefined, 'Required')" : 'z.any()';
  return desc ? `${fallback}.describe('${escapeStr(desc)}')` : fallback;
}

/**
 * Merges properties and required arrays from a source schema into a target.
 */
function mergeSchemaProperties(target, source) {
  if (source.properties && typeof source.properties === 'object') {
    target.properties = {...target.properties, ...source.properties};
  }
  if (Array.isArray(source.required)) {
    target.required = [...new Set([...target.required, ...source.required])];
  }
}

/**
 * Recursively flattens a schema (handling allOf and $refs) to extract all component properties and required fields.
 */
function flattenSchema(schema, catalogDefs = {}, commonDefs = {}, visited = new Set()) {
  if (!schema || typeof schema !== 'object' || visited.has(schema)) {
    return {properties: {}, required: []};
  }
  visited.add(schema);

  const result = {properties: {}, required: []};

  if (typeof schema.$ref === 'string') {
    const refName = extractRefName(schema.$ref);
    const resolved = refName ? catalogDefs[refName] || commonDefs[refName] : null;
    if (resolved) {
      mergeSchemaProperties(result, flattenSchema(resolved, catalogDefs, commonDefs, visited));
    }
  }

  mergeSchemaProperties(result, schema);

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      mergeSchemaProperties(result, flattenSchema(sub, catalogDefs, commonDefs, visited));
    }
  }

  return result;
}

/**
 * Extracts function arguments schema, required fields, and returnType.
 */
function extractFunctionDefinition(funcName, funcDef, catalogDefs = {}, commonDefs = {}) {
  let returnType = funcDef.returnType;
  if (!returnType && funcDef.properties?.returnType?.const) {
    returnType = funcDef.properties.returnType.const;
  }
  if (!returnType) {
    returnType = 'boolean';
  }

  let argsSchema = funcDef.properties?.args;
  if (!argsSchema && Array.isArray(funcDef.allOf)) {
    for (const sub of funcDef.allOf) {
      if (sub.properties?.args) {
        argsSchema = sub.properties.args;
        break;
      }
    }
  }

  const {properties: argsProps, required: argsRequired} = argsSchema
    ? flattenSchema(argsSchema, catalogDefs, commonDefs)
    : {properties: {}, required: []};

  return {returnType, argsProps, argsRequired, description: funcDef.description};
}

/**
 * Generates TypeScript component APIs from a catalog schema.
 */
export function generateComponentsFile(version, catalogJson, commonDefs, options = {}) {
  const catalogDefs = catalogJson.$defs || {};
  const usedImports = new Set();
  const discriminatorProp = catalogJson.discriminator?.propertyName || 'component';
  const idProp = 'id';
  const commonTypesImportPath = options.commonTypesImportPath || '../../schema/common-types.js';
  const typesImportPath = options.typesImportPath || '../../../catalog/types.js';

  const compNames = Object.keys(catalogJson.components || {});
  const apiNames = [];
  let bodyCode = '';

  for (const compName of compNames) {
    const compDef = catalogJson.components[compName];
    const {properties, required} = flattenSchema(compDef, catalogDefs, commonDefs);
    const apiName = `${compName}Api`;
    apiNames.push(apiName);

    bodyCode += `export const ${apiName} = {\n`;
    bodyCode += `  name: '${compName}',\n`;
    bodyCode += `  schema: z\n`;
    bodyCode += `    .object({\n`;

    for (const [propName, propDef] of Object.entries(properties)) {
      if (propName === discriminatorProp || propName === idProp) {
        continue;
      }
      const zodCode = generatePropertyZod(propName, propDef, required, commonDefs, usedImports);
      bodyCode += `      '${propName}': ${zodCode},\n`;
    }

    bodyCode += `    })\n`;
    bodyCode += `    .strict(),\n`;
    bodyCode += `} satisfies ComponentApi;\n\n`;
  }

  let out = HEADER;
  out += `import {z} from 'zod';
import {ComponentApi} from '${typesImportPath}';
import {
  ${Array.from(usedImports).sort().join(',\n  ')},
} from '${commonTypesImportPath}';

`;

  out += bodyCode;

  out += `export const BASIC_COMPONENTS: ComponentApi[] = [\n`;
  for (const name of apiNames) {
    out += `  ${name},\n`;
  }
  out += `];\n`;

  return out;
}

/**
 * Generates TypeScript function APIs from a catalog schema.
 */
export function generateFunctionsFile(version, catalogJson, commonDefs, options = {}) {
  const catalogDefs = catalogJson.$defs || {};
  const usedImports = new Set();
  const funcNames = Object.keys(catalogJson.functions || {});
  const apiNames = [];
  const commonTypesImportPath = options.commonTypesImportPath || '../../schema/common-types.js';
  let bodyCode = '';

  for (const funcName of funcNames) {
    const funcDef = catalogJson.functions[funcName];
    const {returnType, argsProps, argsRequired, description} = extractFunctionDefinition(
      funcName,
      funcDef,
      catalogDefs,
      commonDefs,
    );
    const apiName = `${toPascalCase(funcName)}Api`;
    apiNames.push(apiName);

    bodyCode += `/**\n`;
    if (description) {
      bodyCode += ` * ${description.replace(/\n/g, '\n * ')}\n`;
    }
    bodyCode += ` */\n`;
    bodyCode += `export const ${apiName} = {\n`;
    bodyCode += `  name: '${funcName}' as const,\n`;
    bodyCode += `  returnType: '${returnType}' as const,\n`;
    bodyCode += `  schema: z.object({\n`;

    for (const [argName, argDef] of Object.entries(argsProps)) {
      const zodCode = generatePropertyZod(argName, argDef, argsRequired, commonDefs, usedImports);
      bodyCode += `    '${argName}': ${zodCode},\n`;
    }

    bodyCode += `  }),\n`;
    bodyCode += `};\n\n`;
  }

  let out = HEADER;
  out += `import {z} from 'zod';\n`;
  if (usedImports.size > 0) {
    out += `import {
  ${Array.from(usedImports).sort().join(',\n  ')},
} from '${commonTypesImportPath}';\n\n`;
  } else {
    out += '\n';
  }

  out += bodyCode;

  out += `export const BASIC_FUNCTION_APIS = [\n`;
  for (const name of apiNames) {
    out += `  ${name},\n`;
  }
  out += `];\n\n`;
  out += `export const V09_SPEC_FUNCTION_APIS = BASIC_FUNCTION_APIS;\n`;

  return out;
}

/**
 * Generates component and function TypeScript APIs from a catalog schema and common types definitions.
 *
 * @param {object} options
 * @param {string} [options.version] Protocol version identifier.
 * @param {string} options.catalogPath Path to catalog.json.
 * @param {string} options.commonTypesPath Path to common_types.json.
 * @param {string} [options.componentsOutPath] Path to output component APIs file.
 * @param {string} [options.functionsOutPath] Path to output function APIs file.
 * @param {string} [options.commonTypesImportPath] Relative import path for common types.
 * @param {string} [options.typesImportPath] Relative import path for catalog types.
 */
export function generateCatalogApi({
  version = '',
  catalogPath,
  commonTypesPath,
  componentsOutPath,
  functionsOutPath,
  commonTypesImportPath,
  typesImportPath,
}) {
  const commonJson = JSON.parse(readFileSync(commonTypesPath, 'utf8'));
  const catalogJson = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const commonDefs = commonJson.$defs || {};

  if (componentsOutPath) {
    const componentsTs = generateComponentsFile(version, catalogJson, commonDefs, {
      commonTypesImportPath,
      typesImportPath,
    });
    writeFileSync(componentsOutPath, componentsTs);
  }

  if (functionsOutPath) {
    const functionsTs = generateFunctionsFile(version, catalogJson, commonDefs, {
      commonTypesImportPath,
    });
    writeFileSync(functionsOutPath, functionsTs);
  }
}
