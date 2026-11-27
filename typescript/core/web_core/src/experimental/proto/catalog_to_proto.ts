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

import type {
  CatalogModel,
  ComponentDefinition,
  DataTypeDefinition,
  EnumTypeDefinition,
  ObjectTypeDefinition,
  ParameterDefinition,
  TypeDefinition,
  UnionTypeDefinition,
} from '../../catalog/model/catalog_model.js';

/** Error thrown when `CatalogModel` -> `.proto` codegen detects an ABI-breaking lockfile conflict. */
export class A2uiProtoCodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'A2uiProtoCodegenError';
  }
}

/**
 * Sidecar field-number lockfile preserving Protobuf wire ABI stability across
 * `CatalogModel` edits (such as reordering `parameters` for LLM prompt quality).
 */
export interface ProtoTagLockfile {
  readonly lockfileVersion: '1.0';
  readonly catalogId: string;
  /** Allocated field numbers keyed by qualified message name -> parameter/field name -> tag. */
  readonly components: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Allocated enum numbers keyed by qualified enum name -> literal value -> number. */
  readonly enums: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Canonical wire-type signatures per message field, used to reject ABI-breaking type changes. */
  readonly fieldWireTypes?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Retired field numbers per message (emitted as `reserved` and forbidden from reuse). */
  readonly retired?: Readonly<Record<string, readonly number[]>>;
  /** Retired enum numbers per enum (emitted as `reserved` and forbidden from reuse). */
  readonly retiredEnums?: Readonly<Record<string, readonly number[]>>;
}

/** External proto mapping for a `StringTypeDefinition.format` value. */
export interface OpaqueFormatProtoMapping {
  /** Fully-qualified protobuf message name (e.g. `'webutil.html.types.TrustedResourceUrlProto'`). */
  readonly protoType: string;
  /** Optional `.proto` import path (e.g. `'webutil/html/types/proto/html.proto'`). */
  readonly importPath?: string;
}

/** Configuration options for {@link generateProtoFromCatalogModel}. */
export interface ProtoCodegenOptions {
  /** Protobuf package declaration (e.g. `'a2ui.catalogs.basic.v1'`). */
  readonly protoPackage: string;
  /** Import path for the A2UI v1.0 envelope proto. Defaults to `'a2ui/v1_0/envelope.proto'`. */
  readonly envelopeImportPath?: string;
  /** Existing lockfile whose allocated tags and wire types must be preserved. */
  readonly lockfile?: ProtoTagLockfile;
  /** Optional mapping from `StringTypeDefinition.format` values to external proto message types. */
  readonly opaqueFormatProtos?: Readonly<Record<string, OpaqueFormatProtoMapping>>;
}

/** Output produced by {@link generateProtoFromCatalogModel}. */
export interface ProtoCodegenResult {
  /** Generated Protobuf Edition 2023 `.proto` source file text. */
  readonly protoSource: string;
  /** Updated monotonic field-number lockfile to persist alongside the catalog. */
  readonly lockfile: ProtoTagLockfile;
}

const PROTO_KEYWORDS = new Set([
  'edition',
  'syntax',
  'import',
  'weak',
  'public',
  'package',
  'option',
  'inf',
  'nan',
  'repeated',
  'optional',
  'required',
  'oneof',
  'map',
  'reserved',
  'enum',
  'message',
  'extend',
  'extensions',
  'service',
  'rpc',
  'stream',
  'returns',
  'to',
  'max',
  'default',
  'group',
]);

function toSnakeCase(input: string): string {
  const snake = input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const safe = snake.length > 0 && /^[0-9]/.test(snake) ? `f_${snake}` : snake || 'field';
  return PROTO_KEYWORDS.has(safe) ? `${safe}_value` : safe;
}

function toPascalCase(input: string): string {
  const parts = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const pascal = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  if (!pascal) return 'Unnamed';
  return /^[0-9]/.test(pascal) ? `T${pascal}` : pascal;
}

function toUpperSnakeCase(input: string): string {
  const snake = input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return snake || 'VALUE';
}

function nextAvailableTag(used: ReadonlySet<number>, retired: ReadonlySet<number>): number {
  let max = 0;
  for (const t of used) {
    if (t > max) max = t;
  }
  for (const t of retired) {
    if (t > max) max = t;
  }
  let candidate = max + 1;
  if (candidate >= 19000 && candidate <= 19999) {
    candidate = 20000;
  }
  while (used.has(candidate) || retired.has(candidate)) {
    candidate++;
    if (candidate >= 19000 && candidate <= 19999) {
      candidate = 20000;
    }
  }
  return candidate;
}

function formatReservedTags(tags: readonly number[]): string {
  const sorted = [...new Set(tags)].sort((a, b) => a - b);
  return `reserved ${sorted.join(', ')};`;
}

interface AllocatedField {
  readonly paramName: string;
  readonly protoFieldName: string;
  readonly tag: number;
  readonly protoType: string;
  readonly repeated: boolean;
  readonly mapKeyType?: string;
  readonly comment?: string;
}

interface GeneratedNestedBlock {
  readonly lines: string[];
}

class TagAllocator {
  readonly nextComponents: Record<string, Record<string, number>> = {};
  readonly nextFieldWireTypes: Record<string, Record<string, string>> = {};
  readonly nextEnums: Record<string, Record<string, number>> = {};
  readonly nextRetired: Record<string, number[]> = {};
  readonly nextRetiredEnums: Record<string, number[]> = {};

  constructor(private readonly prev?: ProtoTagLockfile) {
    if (prev?.retired) {
      for (const [msg, tags] of Object.entries(prev.retired)) {
        this.nextRetired[msg] = [...tags].sort((a, b) => a - b);
      }
    }
    if (prev?.retiredEnums) {
      for (const [en, tags] of Object.entries(prev.retiredEnums)) {
        this.nextRetiredEnums[en] = [...tags].sort((a, b) => a - b);
      }
    }
  }

  allocateMessageFields(
    messageKey: string,
    fields: readonly {readonly name: string; readonly wireSignature: string}[],
  ): {readonly tags: Map<string, number>; readonly retired: readonly number[]} {
    const prevMap = this.prev?.components[messageKey] ?? {};
    const prevWireTypes = this.prev?.fieldWireTypes?.[messageKey] ?? {};
    const retiredSet = new Set<number>(this.prev?.retired?.[messageKey] ?? []);

    // Validate the incoming lockfile has no retired-tag reuse or duplicate tags.
    const seenPrevTags = new Map<number, string>();
    for (const [prevName, prevTag] of Object.entries(prevMap)) {
      if (!Number.isInteger(prevTag) || prevTag < 1 || (prevTag >= 19000 && prevTag <= 19999)) {
        throw new A2uiProtoCodegenError(
          `Invalid tag ${prevTag} for '${messageKey}.${prevName}' in lockfile.`,
        );
      }
      if (retiredSet.has(prevTag)) {
        throw new A2uiProtoCodegenError(
          `Lockfile reuses retired tag ${prevTag} for '${messageKey}.${prevName}'.`,
        );
      }
      const conflict = seenPrevTags.get(prevTag);
      if (conflict !== undefined) {
        throw new A2uiProtoCodegenError(
          `Lockfile assigns duplicate tag ${prevTag} to '${messageKey}.${conflict}' and '${messageKey}.${prevName}'.`,
        );
      }
      seenPrevTags.set(prevTag, prevName);
    }

    const usedTags = new Set<number>(Object.values(prevMap));
    const currentNames = new Set<string>();
    for (const f of fields) {
      if (currentNames.has(f.name)) {
        throw new A2uiProtoCodegenError(
          `Duplicate field name '${f.name}' requested for message '${messageKey}'.`,
        );
      }
      currentNames.add(f.name);
    }
    const allocated = new Map<string, number>();
    const outTags: Record<string, number> = {};
    const outWireTypes: Record<string, string> = {};

    // First lock existing fields and verify wire-type compatibility.
    for (const field of fields) {
      if (Object.hasOwn(prevMap, field.name)) {
        const tag = prevMap[field.name];
        const prevWire = prevWireTypes[field.name];
        if (prevWire !== undefined && prevWire !== field.wireSignature) {
          throw new A2uiProtoCodegenError(
            `Incompatible wire type change for '${messageKey}.${field.name}' (tag ${tag}): ` +
              `locked as '${prevWire}', got '${field.wireSignature}'. ` +
              `Retire tag ${tag} and allocate a new field name or tag.`,
          );
        }
        allocated.set(field.name, tag);
        outTags[field.name] = tag;
        outWireTypes[field.name] = field.wireSignature;
      }
    }

    // Retire tags for fields that were previously locked but are now removed.
    for (const [prevName, prevTag] of Object.entries(prevMap)) {
      if (!currentNames.has(prevName)) {
        retiredSet.add(prevTag);
      }
    }

    // Monotonically allocate new tags for newly added fields (never reusing retired tags).
    for (const field of fields) {
      if (!allocated.has(field.name)) {
        const tag = nextAvailableTag(usedTags, retiredSet);
        usedTags.add(tag);
        allocated.set(field.name, tag);
        outTags[field.name] = tag;
        outWireTypes[field.name] = field.wireSignature;
      }
    }

    this.nextComponents[messageKey] = outTags;
    this.nextFieldWireTypes[messageKey] = outWireTypes;
    const sortedRetired = [...retiredSet].sort((a, b) => a - b);
    if (sortedRetired.length > 0) {
      this.nextRetired[messageKey] = sortedRetired;
    } else {
      delete this.nextRetired[messageKey];
    }
    return {tags: allocated, retired: sortedRetired};
  }

  allocateEnumValues(
    enumKey: string,
    values: readonly string[],
  ): {readonly numbers: Map<string, number>; readonly retired: readonly number[]} {
    const prevMap = this.prev?.enums[enumKey] ?? {};
    const retiredSet = new Set<number>(this.prev?.retiredEnums?.[enumKey] ?? []);

    const seenPrevNums = new Map<number, string>();
    for (const [prevVal, prevNum] of Object.entries(prevMap)) {
      if (!Number.isInteger(prevNum) || prevNum < 1) {
        throw new A2uiProtoCodegenError(
          `Invalid enum number ${prevNum} for '${enumKey}.${prevVal}' in lockfile (0 is reserved for UNSPECIFIED).`,
        );
      }
      if (retiredSet.has(prevNum)) {
        throw new A2uiProtoCodegenError(
          `Lockfile reuses retired enum number ${prevNum} for '${enumKey}.${prevVal}'.`,
        );
      }
      const conflict = seenPrevNums.get(prevNum);
      if (conflict !== undefined) {
        throw new A2uiProtoCodegenError(
          `Lockfile assigns duplicate enum number ${prevNum} to '${enumKey}.${conflict}' and '${enumKey}.${prevVal}'.`,
        );
      }
      seenPrevNums.set(prevNum, prevVal);
    }

    const usedNums = new Set<number>(Object.values(prevMap));
    const currentVals = new Set(values);
    const allocated = new Map<string, number>();
    const outNums: Record<string, number> = {};

    for (const val of values) {
      if (Object.hasOwn(prevMap, val)) {
        const num = prevMap[val];
        allocated.set(val, num);
        outNums[val] = num;
      }
    }

    for (const [prevVal, prevNum] of Object.entries(prevMap)) {
      if (!currentVals.has(prevVal)) {
        retiredSet.add(prevNum);
      }
    }

    for (const val of values) {
      if (!allocated.has(val)) {
        const num = nextAvailableTag(usedNums, retiredSet);
        usedNums.add(num);
        allocated.set(val, num);
        outNums[val] = num;
      }
    }

    this.nextEnums[enumKey] = outNums;
    const sortedRetired = [...retiredSet].sort((a, b) => a - b);
    if (sortedRetired.length > 0) {
      this.nextRetiredEnums[enumKey] = sortedRetired;
    } else {
      delete this.nextRetiredEnums[enumKey];
    }
    return {numbers: allocated, retired: sortedRetired};
  }

  toLockfile(catalogId: string): ProtoTagLockfile {
    return {
      lockfileVersion: '1.0',
      catalogId,
      components: this.nextComponents,
      enums: this.nextEnums,
      ...(Object.keys(this.nextFieldWireTypes).length > 0
        ? {fieldWireTypes: this.nextFieldWireTypes}
        : {}),
      ...(Object.keys(this.nextRetired).length > 0 ? {retired: this.nextRetired} : {}),
      ...(Object.keys(this.nextRetiredEnums).length > 0
        ? {retiredEnums: this.nextRetiredEnums}
        : {}),
    };
  }
}

interface ResolvedFieldType {
  readonly protoType: string;
  readonly wireSignature: string;
  readonly repeated: boolean;
  readonly mapKeyType?: string;
  readonly comment?: string;
  readonly nestedBlocks: readonly GeneratedNestedBlock[];
}

function indentLines(lines: readonly string[], spaces: number): string[] {
  const pad = ' '.repeat(spaces);
  return lines.map(line => (line.length > 0 ? `${pad}${line}` : ''));
}

function sanitizeComment(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

function claimUniqueTypeName(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let suffix = 2;
  while (used.has(`${preferred}${suffix}`)) {
    suffix++;
  }
  const candidate = `${preferred}${suffix}`;
  used.add(candidate);
  return candidate;
}

function claimUniqueFieldName(
  preferred: string,
  used: Set<string>,
  fallbackSuffix?: number,
): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  if (fallbackSuffix !== undefined) {
    const tagged = `${preferred}_${fallbackSuffix}`;
    if (!used.has(tagged)) {
      used.add(tagged);
      return tagged;
    }
  }
  let suffix = 2;
  while (used.has(`${preferred}_${suffix}`)) {
    suffix++;
  }
  const candidate = `${preferred}_${suffix}`;
  used.add(candidate);
  return candidate;
}

function formatConstraintComment(typeDef: TypeDefinition): string | undefined {
  const notes: string[] = [];
  if (typeDef.type === 'string') {
    if (typeDef.format !== undefined) {
      const fmts = Array.isArray(typeDef.format)
        ? typeDef.format.join(' | ')
        : String(typeDef.format);
      notes.push(`format=${sanitizeComment(fmts)}`);
    }
    if (typeDef.pattern !== undefined) notes.push(`pattern=${sanitizeComment(typeDef.pattern)}`);
    if (typeDef.minLength !== undefined) notes.push(`minLength=${typeDef.minLength}`);
    if (typeDef.maxLength !== undefined) notes.push(`maxLength=${typeDef.maxLength}`);
  } else if (typeDef.type === 'number' || typeDef.type === 'integer') {
    if (typeDef.min !== undefined) notes.push(`min=${typeDef.min}`);
    if (typeDef.max !== undefined) notes.push(`max=${typeDef.max}`);
  } else if (typeDef.type === 'array') {
    if (typeDef.minItems !== undefined) notes.push(`minItems=${typeDef.minItems}`);
    if (typeDef.maxItems !== undefined) notes.push(`maxItems=${typeDef.maxItems}`);
    if (typeDef.uniqueItems) notes.push('uniqueItems=true');
  } else if (typeDef.type === 'child') {
    notes.push('A2UI Child component ID');
  }
  return notes.length > 0 ? sanitizeComment(notes.join(', ')) : undefined;
}

/**
 * Generates an Edition 2023 `.proto` file and monotonic {@link ProtoTagLockfile}
 * from a canonical {@link CatalogModel}.
 *
 * Guarantees wire ABI stability: reordering `parameters` in `model` preserves
 * 100% identical field tag numbers when the previous `options.lockfile` is passed,
 * while incompatible wire-type changes or retired-tag reuse throw
 * {@link A2uiProtoCodegenError}.
 */
export function generateProtoFromCatalogModel(
  model: CatalogModel,
  options: ProtoCodegenOptions,
): ProtoCodegenResult {
  const allocator = new TagAllocator(options.lockfile);
  const extraImports = new Set<string>();
  let needsStructImport = false;
  const opaqueFormatProtos = options.opaqueFormatProtos ?? {};

  // Pre-compute top-level proto symbol names for catalog-local `types` so
  // `{ type: 'ref' }` preserves `dynamic: true` wrappers on enums and objects.
  const topLevelUsedNames = new Set<string>();
  const topLevelRefTargets = new Map<
    string,
    {
      readonly baseName: string;
      readonly dynamicName?: string;
      readonly protoType: string;
      readonly wireSignature: string;
    }
  >();
  for (const [typeName, typeDef] of Object.entries(model.types ?? {})) {
    const baseName = claimUniqueTypeName(toPascalCase(typeName), topLevelUsedNames);
    const hasTopLevelDynamicWrapper =
      (typeDef.type === 'enum' && Boolean(typeDef.dynamic)) ||
      (typeDef.type === 'object' &&
        (typeDef.properties?.length ?? 0) > 0 &&
        Boolean(typeDef.dynamic));
    if (hasTopLevelDynamicWrapper) {
      const dynamicName = claimUniqueTypeName(`Dynamic${baseName}`, topLevelUsedNames);
      topLevelRefTargets.set(typeName, {
        baseName,
        dynamicName,
        protoType: dynamicName,
        wireSignature: `ref:${dynamicName}`,
      });
    } else {
      topLevelRefTargets.set(typeName, {
        baseName,
        protoType: baseName,
        wireSignature: `ref:${baseName}`,
      });
    }
  }

  const emitEnumBlock = (
    enumName: string,
    enumKey: string,
    enumDef: EnumTypeDefinition,
  ): {readonly block: GeneratedNestedBlock; readonly protoType: string} => {
    const uniqueValues: string[] = [];
    const seenValues = new Set<string>();
    for (const v of enumDef.values) {
      const strVal = String(v);
      if (!seenValues.has(strVal)) {
        seenValues.add(strVal);
        uniqueValues.push(strVal);
      }
    }
    const {numbers, retired} = allocator.allocateEnumValues(enumKey, uniqueValues);
    const prefix = toUpperSnakeCase(enumName);
    const lines: string[] = [`enum ${enumName} {`];
    lines.push(`  ${prefix}_UNSPECIFIED = 0;`);
    if (retired.length > 0) {
      lines.push(`  ${formatReservedTags(retired)}`);
    }
    const usedIdentifiers = new Set<string>([`${prefix}_UNSPECIFIED`]);
    for (const rawVal of uniqueValues) {
      const num = numbers.get(rawVal)!;
      let ident = `${prefix}_${toUpperSnakeCase(rawVal)}`;
      if (usedIdentifiers.has(ident)) {
        ident = `${ident}_${num}`;
      }
      let extra = 2;
      while (usedIdentifiers.has(ident)) {
        ident = `${prefix}_${toUpperSnakeCase(rawVal)}_${num}_${extra++}`;
      }
      usedIdentifiers.add(ident);
      lines.push(`  ${ident} = ${num};`);
    }
    lines.push('}');
    return {block: {lines}, protoType: enumName};
  };

  const emitDynamicWrapperBlock = (
    wrapperName: string,
    literalProtoType: string,
  ): GeneratedNestedBlock => ({
    lines: [
      `message ${wrapperName} {`,
      '  oneof source {',
      `    ${literalProtoType} literal = 1;`,
      '    a2ui.v1_0.DataBinding data_binding = 2;',
      '    a2ui.v1_0.FunctionCall function_call = 3;',
      '  }',
      '}',
    ],
  });

  const emitObjectMessageBlock = (
    msgName: string,
    msgKey: string,
    params: readonly ParameterDefinition[],
    atLeastOneOf?: readonly (readonly string[])[],
    checkable?: boolean,
  ): GeneratedNestedBlock => {
    const nestedBlocks: GeneratedNestedBlock[] = [];
    const usedNestedTypes = new Set<string>([msgName]);
    const claimNested = (preferred: string) => claimUniqueTypeName(preferred, usedNestedTypes);
    const resolvedFields: Array<{
      readonly param: ParameterDefinition;
      readonly resolved: ResolvedFieldType;
    }> = [];

    for (const param of params) {
      const resolved = resolveFieldType(
        param,
        `${msgKey}.${toPascalCase(param.name)}`,
        toPascalCase(param.name),
        claimNested,
      );
      nestedBlocks.push(...resolved.nestedBlocks);
      resolvedFields.push({param, resolved});
    }

    const {tags, retired} = allocator.allocateMessageFields(
      msgKey,
      resolvedFields.map(f => ({name: f.param.name, wireSignature: f.resolved.wireSignature})),
    );

    // Sort by tag number before disambiguating snake_case field names so
    // parameter reorders in CatalogModel keep 100% deterministic field names.
    const sortedByTag = [...resolvedFields].sort(
      (a, b) => tags.get(a.param.name)! - tags.get(b.param.name)!,
    );
    const usedProtoFieldNames = new Set<string>();
    const allocated: AllocatedField[] = sortedByTag.map(({param, resolved}) => {
      const tag = tags.get(param.name)!;
      const protoFieldName = claimUniqueFieldName(
        toSnakeCase(param.name),
        usedProtoFieldNames,
        tag,
      );
      return {
        paramName: param.name,
        protoFieldName,
        tag,
        protoType: resolved.protoType,
        repeated: resolved.repeated,
        mapKeyType: resolved.mapKeyType,
        comment: resolved.comment,
      };
    });

    const lines: string[] = [`message ${msgName} {`];
    if (checkable) {
      lines.push('  // Checkable component: validation rules travel on envelope Component.checks.');
    }
    if (atLeastOneOf && atLeastOneOf.length > 0) {
      const groups = atLeastOneOf.map(g => `[${g.join(', ')}]`).join(', ');
      lines.push(`  // CatalogModel constraint: atLeastOneOf ${sanitizeComment(groups)}`);
    }
    if (retired.length > 0) {
      lines.push(`  ${formatReservedTags(retired)}`);
    }
    for (const block of nestedBlocks) {
      lines.push(...indentLines(block.lines, 2));
      lines.push('');
    }
    for (const field of allocated) {
      if (field.comment) {
        lines.push(`  // ${sanitizeComment(field.comment)}`);
      }
      if (field.mapKeyType) {
        lines.push(
          `  map<${field.mapKeyType}, ${field.protoType}> ${field.protoFieldName} = ${field.tag};`,
        );
      } else if (field.repeated) {
        lines.push(`  repeated ${field.protoType} ${field.protoFieldName} = ${field.tag};`);
      } else {
        lines.push(`  ${field.protoType} ${field.protoFieldName} = ${field.tag};`);
      }
    }
    lines.push('}');
    return {lines};
  };

  const emitUnionMessageBlock = (
    unionName: string,
    unionKey: string,
    unionDef: UnionTypeDefinition,
  ): GeneratedNestedBlock => {
    const nestedBlocks: GeneratedNestedBlock[] = [];
    const usedNestedTypes = new Set<string>([unionName]);
    const claimNested = (preferred: string) => claimUniqueTypeName(preferred, usedNestedTypes);
    const usedVariantNames = new Set<string>();
    const variantSpecs: Array<{
      readonly name: string;
      readonly protoType: string;
      readonly wireSignature: string;
    }> = [];

    let hasExplicitDataBinding = false;
    let hasExplicitFunctionCall = false;

    for (let i = 0; i < unionDef.variants.length; i++) {
      const variant = unionDef.variants[i];
      if (variant.type === 'dataBinding') hasExplicitDataBinding = true;
      if (variant.type === 'functionCall') hasExplicitFunctionCall = true;
      const variantHint =
        variant.type === 'ref'
          ? toPascalCase(variant.ref)
          : variant.type === 'enum'
            ? 'EnumVariant'
            : variant.type === 'object'
              ? 'ObjectVariant'
              : `${toPascalCase(variant.type)}Variant`;
      const variantBaseName =
        unionDef.variants.filter(v => v.type === variant.type).length > 1
          ? `${variantHint}${i + 1}`
          : variantHint;
      const variantKey = `${unionKey}.${variantBaseName}`;
      const resolved = resolveFieldType(variant, variantKey, variantBaseName, claimNested);
      nestedBlocks.push(...resolved.nestedBlocks);

      // Protobuf forbids `repeated` and `map` directly inside `oneof`; wrap them in a message.
      let oneofProtoType = resolved.protoType;
      let wireSig = resolved.wireSignature;
      if (resolved.mapKeyType) {
        const mapWrapper = claimNested(`${variantBaseName}Map`);
        nestedBlocks.push({
          lines: [
            `message ${mapWrapper} {`,
            `  map<${resolved.mapKeyType}, ${resolved.protoType}> entries = 1;`,
            '}',
          ],
        });
        oneofProtoType = mapWrapper;
        wireSig = `map_wrapper<${resolved.mapKeyType},${resolved.wireSignature}>`;
      } else if (resolved.repeated) {
        const listWrapper = claimNested(`${variantBaseName}List`);
        nestedBlocks.push({
          lines: [`message ${listWrapper} {`, `  repeated ${resolved.protoType} values = 1;`, '}'],
        });
        oneofProtoType = listWrapper;
        wireSig = `list_wrapper<${resolved.wireSignature}>`;
      }

      const uniqueFieldName = claimUniqueFieldName(
        toSnakeCase(variantBaseName),
        usedVariantNames,
        i + 1,
      );
      variantSpecs.push({
        name: uniqueFieldName,
        protoType: oneofProtoType,
        wireSignature: wireSig,
      });
    }

    if (unionDef.dynamic) {
      if (!hasExplicitDataBinding) {
        const bindingFieldName = !usedVariantNames.has('data_binding')
          ? claimUniqueFieldName('data_binding', usedVariantNames)
          : claimUniqueFieldName('a2ui_data_binding', usedVariantNames);
        variantSpecs.push({
          name: bindingFieldName,
          protoType: 'a2ui.v1_0.DataBinding',
          wireSignature: 'a2ui.v1_0.DataBinding',
        });
      }
      if (!hasExplicitFunctionCall) {
        const callFieldName = !usedVariantNames.has('function_call')
          ? claimUniqueFieldName('function_call', usedVariantNames)
          : claimUniqueFieldName('a2ui_function_call', usedVariantNames);
        variantSpecs.push({
          name: callFieldName,
          protoType: 'a2ui.v1_0.FunctionCall',
          wireSignature: 'a2ui.v1_0.FunctionCall',
        });
      }
    }

    const {tags, retired} = allocator.allocateMessageFields(
      unionKey,
      variantSpecs.map(v => ({name: v.name, wireSignature: v.wireSignature})),
    );
    const sorted = [...variantSpecs].sort((a, b) => tags.get(a.name)! - tags.get(b.name)!);

    const lines: string[] = [`message ${unionName} {`];
    if (retired.length > 0) {
      lines.push(`  ${formatReservedTags(retired)}`);
    }
    for (const block of nestedBlocks) {
      lines.push(...indentLines(block.lines, 2));
      lines.push('');
    }
    lines.push('  oneof variant {');
    for (const spec of sorted) {
      lines.push(`    ${spec.protoType} ${spec.name} = ${tags.get(spec.name)!};`);
    }
    lines.push('  }');
    lines.push('}');
    return {lines};
  };

  const resolveFieldType = (
    typeDef: TypeDefinition,
    qualifiedKey: string,
    suggestedName: string,
    claimNested: (preferred: string) => string,
  ): ResolvedFieldType => {
    const comment = formatConstraintComment(typeDef);
    switch (typeDef.type) {
      case 'string': {
        const singleFormat =
          typeof typeDef.format === 'string'
            ? typeDef.format
            : Array.isArray(typeDef.format) && typeDef.format.length === 1
              ? typeDef.format[0]
              : undefined;
        const opaqueMapping = singleFormat ? opaqueFormatProtos[singleFormat] : undefined;
        if (opaqueMapping) {
          if (opaqueMapping.importPath) {
            extraImports.add(opaqueMapping.importPath);
          }
          if (typeDef.dynamic) {
            const wrapperName = claimNested(`Dynamic${suggestedName}`);
            return {
              protoType: wrapperName,
              wireSignature: `dynamic_opaque:${opaqueMapping.protoType}`,
              repeated: false,
              comment,
              nestedBlocks: [emitDynamicWrapperBlock(wrapperName, opaqueMapping.protoType)],
            };
          }
          return {
            protoType: opaqueMapping.protoType,
            wireSignature: `opaque:${opaqueMapping.protoType}`,
            repeated: false,
            comment,
            nestedBlocks: [],
          };
        }
        const protoType = typeDef.dynamic ? 'a2ui.v1_0.DynamicString' : 'string';
        return {protoType, wireSignature: protoType, repeated: false, comment, nestedBlocks: []};
      }
      case 'number': {
        const protoType = typeDef.dynamic ? 'a2ui.v1_0.DynamicNumber' : 'double';
        return {protoType, wireSignature: protoType, repeated: false, comment, nestedBlocks: []};
      }
      case 'integer': {
        const protoType = typeDef.dynamic ? 'a2ui.v1_0.DynamicInteger' : 'int64';
        return {protoType, wireSignature: protoType, repeated: false, comment, nestedBlocks: []};
      }
      case 'boolean': {
        const protoType = typeDef.dynamic ? 'a2ui.v1_0.DynamicBoolean' : 'bool';
        return {protoType, wireSignature: protoType, repeated: false, comment, nestedBlocks: []};
      }
      case 'enum': {
        const isStringEnum =
          (typeDef.valueType ??
            (typeof typeDef.values[0] === 'string' ? 'string' : typeof typeDef.values[0])) ===
          'string';
        if (!isStringEnum) {
          const scalar =
            typeDef.valueType === 'boolean' || typeof typeDef.values[0] === 'boolean'
              ? typeDef.dynamic
                ? 'a2ui.v1_0.DynamicBoolean'
                : 'bool'
              : typeDef.dynamic
                ? 'a2ui.v1_0.DynamicNumber'
                : 'double';
          return {
            protoType: scalar,
            wireSignature: scalar,
            repeated: false,
            comment: sanitizeComment(`enum values: ${typeDef.values.map(String).join(' | ')}`),
            nestedBlocks: [],
          };
        }
        const enumTypeName = claimNested(suggestedName);
        const {block, protoType} = emitEnumBlock(enumTypeName, qualifiedKey, typeDef);
        if (typeDef.dynamic) {
          const wrapperName = claimNested(`Dynamic${enumTypeName}`);
          return {
            protoType: wrapperName,
            wireSignature: `dynamic_enum:${qualifiedKey}`,
            repeated: false,
            comment,
            nestedBlocks: [block, emitDynamicWrapperBlock(wrapperName, protoType)],
          };
        }
        return {
          protoType,
          wireSignature: `enum:${qualifiedKey}`,
          repeated: false,
          comment,
          nestedBlocks: [block],
        };
      }
      case 'const': {
        const protoType =
          typeof typeDef.value === 'string'
            ? 'string'
            : typeof typeDef.value === 'number'
              ? 'double'
              : typeof typeDef.value === 'boolean'
                ? 'bool'
                : 'google.protobuf.Value';
        if (protoType === 'google.protobuf.Value') needsStructImport = true;
        return {
          protoType,
          wireSignature: `const:${protoType}`,
          repeated: false,
          comment: sanitizeComment(`const=${JSON.stringify(typeDef.value)}`),
          nestedBlocks: [],
        };
      }
      case 'any': {
        if (typeDef.dynamic) {
          return {
            protoType: 'a2ui.v1_0.DynamicValue',
            wireSignature: 'a2ui.v1_0.DynamicValue',
            repeated: false,
            comment,
            nestedBlocks: [],
          };
        }
        needsStructImport = true;
        return {
          protoType: 'google.protobuf.Value',
          wireSignature: 'google.protobuf.Value',
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      }
      case 'dataBinding':
        return {
          protoType: 'a2ui.v1_0.DataBinding',
          wireSignature: 'a2ui.v1_0.DataBinding',
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      case 'functionCall':
        return {
          protoType: 'a2ui.v1_0.FunctionCall',
          wireSignature: 'a2ui.v1_0.FunctionCall',
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      case 'child':
        return {
          protoType: 'string',
          wireSignature: 'string',
          repeated: false,
          comment: comment ?? 'A2UI Child component ID',
          nestedBlocks: [],
        };
      case 'childList':
        return {
          protoType: 'a2ui.v1_0.ChildList',
          wireSignature: 'a2ui.v1_0.ChildList',
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      case 'action':
        return {
          protoType: 'a2ui.v1_0.Action',
          wireSignature: 'a2ui.v1_0.Action',
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      case 'checkRule':
        return {
          protoType: 'a2ui.v1_0.CheckRule',
          wireSignature: 'a2ui.v1_0.CheckRule',
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      case 'accessibility':
        return {
          protoType: 'a2ui.v1_0.AccessibilityAttributes',
          wireSignature: 'a2ui.v1_0.AccessibilityAttributes',
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      case 'ref': {
        const target = topLevelRefTargets.get(typeDef.ref);
        if (target) {
          return {
            protoType: target.protoType,
            wireSignature: target.wireSignature,
            repeated: false,
            comment,
            nestedBlocks: [],
          };
        }
        const refTypeName = toPascalCase(typeDef.ref);
        return {
          protoType: refTypeName,
          wireSignature: `ref:${refTypeName}`,
          repeated: false,
          comment,
          nestedBlocks: [],
        };
      }
      case 'object': {
        const objDef = typeDef as ObjectTypeDefinition;
        const hasProps = (objDef.properties?.length ?? 0) > 0;
        if (
          !hasProps &&
          !objDef.dynamic &&
          objDef.additionalProperties &&
          typeof objDef.additionalProperties === 'object'
        ) {
          const valResolved = resolveFieldType(
            objDef.additionalProperties,
            `${qualifiedKey}.Value`,
            `${suggestedName}Value`,
            claimNested,
          );
          let mapValType = valResolved.protoType;
          let mapValWireSig = valResolved.wireSignature;
          const mapNestedBlocks = [...valResolved.nestedBlocks];
          if (valResolved.mapKeyType) {
            const innerMapWrapper = claimNested(`${suggestedName}ValueMap`);
            mapNestedBlocks.push({
              lines: [
                `message ${innerMapWrapper} {`,
                `  map<${valResolved.mapKeyType}, ${valResolved.protoType}> entries = 1;`,
                '}',
              ],
            });
            mapValType = innerMapWrapper;
            mapValWireSig = `map_wrapper<${valResolved.mapKeyType},${valResolved.wireSignature}>`;
          } else if (valResolved.repeated) {
            const innerListWrapper = claimNested(`${suggestedName}ValueList`);
            mapNestedBlocks.push({
              lines: [
                `message ${innerListWrapper} {`,
                `  repeated ${valResolved.protoType} items = 1;`,
                '}',
              ],
            });
            mapValType = innerListWrapper;
            mapValWireSig = `list_wrapper<${valResolved.wireSignature}>`;
          }
          return {
            protoType: mapValType,
            wireSignature: `map<string,${mapValWireSig}>`,
            repeated: false,
            mapKeyType: 'string',
            comment,
            nestedBlocks: mapNestedBlocks,
          };
        }
        if (!hasProps) {
          needsStructImport = true;
          if (objDef.dynamic) {
            const wrapperName = claimNested(`Dynamic${suggestedName}`);
            return {
              protoType: wrapperName,
              wireSignature: 'dynamic_struct',
              repeated: false,
              comment,
              nestedBlocks: [emitDynamicWrapperBlock(wrapperName, 'google.protobuf.Struct')],
            };
          }
          return {
            protoType: 'google.protobuf.Struct',
            wireSignature: 'google.protobuf.Struct',
            repeated: false,
            comment,
            nestedBlocks: [],
          };
        }
        const msgTypeName = claimNested(suggestedName);
        const msgBlock = emitObjectMessageBlock(
          msgTypeName,
          qualifiedKey,
          objDef.properties!,
          objDef.atLeastOneOf,
        );
        if (objDef.dynamic) {
          const wrapperName = claimNested(`Dynamic${msgTypeName}`);
          return {
            protoType: wrapperName,
            wireSignature: `dynamic_msg:${qualifiedKey}`,
            repeated: false,
            comment,
            nestedBlocks: [msgBlock, emitDynamicWrapperBlock(wrapperName, msgTypeName)],
          };
        }
        return {
          protoType: msgTypeName,
          wireSignature: `msg:${qualifiedKey}`,
          repeated: false,
          comment,
          nestedBlocks: [msgBlock],
        };
      }
      case 'array': {
        const singleItemFormat =
          typeDef.items?.type === 'string'
            ? typeof typeDef.items.format === 'string'
              ? typeDef.items.format
              : Array.isArray(typeDef.items.format) && typeDef.items.format.length === 1
                ? typeDef.items.format[0]
                : undefined
            : undefined;
        if (
          typeDef.dynamic &&
          typeDef.items?.type === 'string' &&
          !typeDef.items.dynamic &&
          !(singleItemFormat && opaqueFormatProtos[singleItemFormat])
        ) {
          return {
            protoType: 'a2ui.v1_0.DynamicStringList',
            wireSignature: 'a2ui.v1_0.DynamicStringList',
            repeated: false,
            comment,
            nestedBlocks: [],
          };
        }
        const itemTypeDef: TypeDefinition = typeDef.items ?? {type: 'any', nullable: true};
        const itemName = `${suggestedName}Item`;
        const itemResolved = resolveFieldType(
          itemTypeDef,
          `${qualifiedKey}.${itemName}`,
          itemName,
          claimNested,
        );

        // Protobuf forbids `repeated repeated T` (2D arrays) and `repeated map<K, V>`;
        // wrap nested repeated/map elements in a helper message so structure is preserved.
        let elementProtoType = itemResolved.protoType;
        let elementWireSig = itemResolved.wireSignature;
        const elementNestedBlocks = [...itemResolved.nestedBlocks];
        if (itemResolved.mapKeyType) {
          const mapWrapper = claimNested(`${itemName}Map`);
          elementNestedBlocks.push({
            lines: [
              `message ${mapWrapper} {`,
              `  map<${itemResolved.mapKeyType}, ${itemResolved.protoType}> entries = 1;`,
              '}',
            ],
          });
          elementProtoType = mapWrapper;
          elementWireSig = `map_wrapper<${itemResolved.mapKeyType},${itemResolved.wireSignature}>`;
        } else if (itemResolved.repeated) {
          const listWrapper = claimNested(`${itemName}List`);
          elementNestedBlocks.push({
            lines: [
              `message ${listWrapper} {`,
              `  repeated ${itemResolved.protoType} items = 1;`,
              '}',
            ],
          });
          elementProtoType = listWrapper;
          elementWireSig = `list_wrapper<${itemResolved.wireSignature}>`;
        }

        if (typeDef.dynamic) {
          const listName = claimNested(`${suggestedName}List`);
          const wrapperName = claimNested(`Dynamic${suggestedName}`);
          const listBlock: GeneratedNestedBlock = {
            lines: [`message ${listName} {`, `  repeated ${elementProtoType} values = 1;`, '}'],
          };
          return {
            protoType: wrapperName,
            wireSignature: `dynamic_list:${elementWireSig}`,
            repeated: false,
            comment,
            nestedBlocks: [
              ...elementNestedBlocks,
              listBlock,
              emitDynamicWrapperBlock(wrapperName, listName),
            ],
          };
        }
        return {
          protoType: elementProtoType,
          wireSignature: `repeated:${elementWireSig}`,
          repeated: true,
          comment,
          nestedBlocks: elementNestedBlocks,
        };
      }
      case 'union': {
        const unionName = claimNested(`${suggestedName}Union`);
        const unionBlock = emitUnionMessageBlock(unionName, qualifiedKey, typeDef);
        return {
          protoType: unionName,
          wireSignature: `union:${qualifiedKey}`,
          repeated: false,
          comment,
          nestedBlocks: [unionBlock],
        };
      }
      case 'rawJsonSchema': {
        needsStructImport = true;
        return {
          protoType: 'google.protobuf.Value',
          wireSignature: 'google.protobuf.Value',
          repeated: false,
          comment: 'rawJsonSchema fallback',
          nestedBlocks: [],
        };
      }
    }
  };

  const emitTopLevelType = (name: string, typeDef: DataTypeDefinition): string[] => {
    const target = topLevelRefTargets.get(name)!;
    const pascalName = target.baseName;
    if (typeDef.type === 'enum') {
      const {block} = emitEnumBlock(pascalName, `types.${pascalName}`, typeDef);
      if (target.dynamicName) {
        return [
          ...block.lines,
          '',
          ...emitDynamicWrapperBlock(target.dynamicName, pascalName).lines,
        ];
      }
      return block.lines;
    }
    if (typeDef.type === 'object' && (typeDef.properties?.length ?? 0) > 0) {
      const objBlock = emitObjectMessageBlock(
        pascalName,
        `types.${pascalName}`,
        typeDef.properties!,
        typeDef.atLeastOneOf,
      );
      if (target.dynamicName) {
        return [
          ...objBlock.lines,
          '',
          ...emitDynamicWrapperBlock(target.dynamicName, pascalName).lines,
        ];
      }
      return objBlock.lines;
    }
    if (typeDef.type === 'union') {
      return emitUnionMessageBlock(pascalName, `types.${pascalName}`, typeDef).lines;
    }
    const usedNested = new Set<string>([pascalName]);
    const inner = resolveFieldType(
      typeDef,
      `types.${pascalName}.Value`,
      `${pascalName}Value`,
      preferred => claimUniqueTypeName(preferred, usedNested),
    );
    const {tags, retired} = allocator.allocateMessageFields(`types.${pascalName}`, [
      {name: 'value', wireSignature: inner.wireSignature},
    ]);
    const lines: string[] = [`message ${pascalName} {`];
    if (retired.length > 0) {
      lines.push(`  ${formatReservedTags(retired)}`);
    }
    for (const nested of inner.nestedBlocks) {
      lines.push(...indentLines(nested.lines, 2));
      lines.push('');
    }
    if (inner.comment) {
      lines.push(`  // ${sanitizeComment(inner.comment)}`);
    }
    const fieldDecl = inner.mapKeyType
      ? `map<${inner.mapKeyType}, ${inner.protoType}> value = ${tags.get('value')!};`
      : inner.repeated
        ? `repeated ${inner.protoType} value = ${tags.get('value')!};`
        : `${inner.protoType} value = ${tags.get('value')!};`;
    lines.push(`  ${fieldDecl}`);
    lines.push('}');
    return lines;
  };

  const bodySections: string[] = [];

  // 1. Emit catalog-local reusable `types` (referenced via `{ type: 'ref' }`).
  const typeEntries = Object.entries(model.types ?? {});
  if (typeEntries.length > 0) {
    bodySections.push(
      '// ============================================================================',
    );
    bodySections.push('// Catalog-Local Types');
    bodySections.push(
      '// ============================================================================',
    );
    bodySections.push('');
    for (const [typeName, typeDef] of typeEntries) {
      bodySections.push(...emitTopLevelType(typeName, typeDef));
      bodySections.push('');
    }
  }

  // 2. Emit component messages.
  const components: readonly ComponentDefinition[] = model.components ?? [];
  if (components.length > 0) {
    bodySections.push(
      '// ============================================================================',
    );
    bodySections.push(
      '// Catalog Component Payloads (packed in a2ui.v1_0.Component.typed_payload)',
    );
    bodySections.push(
      '// ============================================================================',
    );
    bodySections.push('');
    for (const comp of components) {
      const msgName = claimUniqueTypeName(toPascalCase(comp.name), topLevelUsedNames);
      if (comp.description) {
        bodySections.push(`// ${sanitizeComment(comp.description.replace(/\s+/g, ' '))}`);
      }
      const block = emitObjectMessageBlock(
        msgName,
        comp.name,
        comp.parameters ?? [],
        comp.atLeastOneOf,
        comp.checkable,
      );
      bodySections.push(...block.lines);
      bodySections.push('');
    }
  }

  const envelopeImport = options.envelopeImportPath ?? 'a2ui/v1_0/envelope.proto';
  const needsEnvelopeImport = bodySections.some(
    line => !line.trimStart().startsWith('//') && line.includes('a2ui.v1_0.'),
  );
  const headerLines: string[] = [
    `// Generated from A2UI CatalogModel: ${sanitizeComment(model.catalogId)}`,
    'edition = "2023";',
    '',
    `package ${options.protoPackage};`,
    '',
  ];
  if (needsEnvelopeImport) {
    headerLines.push(`import "${envelopeImport}";`);
  }
  if (needsStructImport) {
    headerLines.push('import "google/protobuf/struct.proto";');
  }
  for (const imp of [...extraImports].sort()) {
    headerLines.push(`import "${imp}";`);
  }
  if (needsEnvelopeImport || needsStructImport || extraImports.size > 0) {
    headerLines.push('');
  }

  return {
    protoSource: [...headerLines, ...bodySections].join('\n'),
    lockfile: allocator.toLockfile(model.catalogId),
  };
}
