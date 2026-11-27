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
  CATALOG_DOCUMENT_FORMAT_VERSION,
  type CatalogModel,
  type ComponentDefinition,
  type ComponentParameterDefinition,
  type DataTypeDefinition,
  type EnumTypeDefinition,
  type TypeDefinition,
} from '../../catalog/model/catalog_model.js';

/** Protobuf scalar / composite field kinds modeled after `FieldDescriptorProto.Type`. */
export type ProtoFieldKind =
  | 'string'
  | 'double'
  | 'float'
  | 'int32'
  | 'int64'
  | 'uint32'
  | 'uint64'
  | 'sint32'
  | 'sint64'
  | 'fixed32'
  | 'fixed64'
  | 'sfixed32'
  | 'sfixed64'
  | 'bool'
  | 'bytes'
  | 'enum'
  | 'message';

/** Structured descriptor for a single protobuf enum value. */
export interface ProtoEnumValueDescriptor {
  readonly name: string;
  readonly number: number;
}

/** Structured descriptor for a protobuf `enum` declaration. */
export interface ProtoEnumDescriptor {
  readonly name: string;
  readonly values: readonly ProtoEnumValueDescriptor[];
  readonly description?: string;
}

/** Structured descriptor for a protobuf message field. */
export interface ProtoFieldDescriptor {
  readonly name: string;
  readonly number: number;
  readonly kind: ProtoFieldKind;
  /** Qualified or local type name when `kind` is `'message'` or `'enum'`. */
  readonly typeName?: string;
  readonly repeated?: boolean;
  readonly required?: boolean;
  /** Value descriptor when modeling a protobuf `map<string, V>` field. */
  readonly mapValue?: {readonly kind: ProtoFieldKind; readonly typeName?: string};
  /** Enclosing `oneof` group name when this field belongs to a protobuf `oneof`. */
  readonly oneofGroup?: string;
  readonly description?: string;
  /** Optional A2UI semantic role hint (e.g. `'child'` for a component ID string field). */
  readonly a2uiRole?: 'child';
}

/** Structured descriptor for a protobuf `message` declaration. */
export interface ProtoMessageDescriptor {
  readonly name: string;
  /** Optional explicit A2UI component name override (otherwise strips `PropsProto`/`Proto`). */
  readonly componentName?: string;
  readonly description?: string;
  readonly fields: readonly ProtoFieldDescriptor[];
  readonly nestedMessages?: readonly ProtoMessageDescriptor[];
  readonly nestedEnums?: readonly ProtoEnumDescriptor[];
  readonly checkable?: boolean;
  readonly allowedParents?: readonly string[];
  readonly allowedChildren?: readonly string[];
}

/** Structured descriptor modeling a parsed `google.protobuf.FileDescriptorProto`. */
export interface ProtoFileDescriptor {
  readonly package: string;
  readonly messages: readonly ProtoMessageDescriptor[];
  readonly enums?: readonly ProtoEnumDescriptor[];
}

/** Built-in mapping from Google3 security protos to A2UI `StringTypeDefinition.format` names. */
export const DEFAULT_SECURITY_PROTO_FORMATS: Readonly<Record<string, string>> = Object.freeze({
  'webutil.html.types.SafeHtmlProto': 'safe-html',
  'webutil.html.types.TrustedResourceUrlProto': 'trusted-resource-url',
  'webutil.html.types.SafeUrlProto': 'safe-url',
  'webutil.html.types.SafeStyleProto': 'safe-style',
  'webutil.html.types.SafeScriptProto': 'safe-script',
});

/** Options for {@link protoDescriptorToCatalogModel}. */
export interface ReverseCodegenOptions {
  /** Target catalog identifier URI. */
  readonly catalogId: string;
  /** Target A2UI protocol version. Defaults to `'1.0'`. */
  readonly protocolVersion?: string;
  readonly title?: string;
  readonly description?: string;
  /**
   * Explicit subset of top-level message names to expose as catalog components.
   * When omitted, all top-level messages not used solely as helper/wrapper types are exposed.
   */
  readonly componentMessages?: readonly string[];
  /** Additional or overriding mappings from fully-qualified proto name -> A2UI string format. */
  readonly securityProtoFormats?: Readonly<Record<string, string>>;
  /**
   * Whether fields carrying recognized security protos default to `dynamic: true`
   * so they accept both authentic opaque instances and `@path` bindings. Defaults to `true`.
   */
  readonly dynamicSecurityProtos?: boolean;
}

const INTEGER_KINDS = new Set<ProtoFieldKind>([
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
]);

function normalizeTypeName(raw: string): string {
  return raw.startsWith('.') ? raw.slice(1) : raw;
}

function toCamelCase(name: string): string {
  if (!name.includes('_')) return name;
  const parts = name.split('_').filter(Boolean);
  if (parts.length === 0) return name;
  return parts
    .map((part, idx) =>
      idx === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');
}

function toUpperSnakePrefix(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

function deriveComponentName(msg: ProtoMessageDescriptor): string {
  if (msg.componentName) return msg.componentName;
  return msg.name.replace(/(?:PropsProto|ComponentProto|Props|Proto)$/, '') || msg.name;
}

function convertEnumDescriptor(enumDesc: ProtoEnumDescriptor): EnumTypeDefinition {
  const prefix = `${toUpperSnakePrefix(enumDesc.name)}_`;
  const values: string[] = [];
  for (const entry of enumDesc.values) {
    if (
      entry.number === 0 &&
      (entry.name === 'UNSPECIFIED' || entry.name.endsWith('_UNSPECIFIED'))
    ) {
      continue;
    }
    const stripped = entry.name.startsWith(prefix) ? entry.name.slice(prefix.length) : entry.name;
    values.push(toCamelCase(stripped.toLowerCase()));
  }
  return {
    type: 'enum',
    values: values.length > 0 ? values : ['unspecified'],
    valueType: 'string',
    ...(enumDesc.description ? {description: enumDesc.description} : {}),
  };
}

/**
 * Checks whether a message descriptor is an A2UI `Dynamic<T>` wrapper message:
 * a single `oneof` containing a `literal` branch plus `a2ui.v1_0.DataBinding`
 * (and optionally `a2ui.v1_0.FunctionCall`).
 */
function unwrapDynamicWrapperMessage(
  msg: ProtoMessageDescriptor,
): ProtoFieldDescriptor | undefined {
  if (msg.fields.length < 2 || msg.fields.length > 3) return undefined;
  const oneofName = msg.fields[0].oneofGroup;
  if (!oneofName || !msg.fields.every(f => f.oneofGroup === oneofName)) {
    return undefined;
  }
  let literalField: ProtoFieldDescriptor | undefined;
  let hasDataBinding = false;
  for (const f of msg.fields) {
    const norm = f.typeName ? normalizeTypeName(f.typeName) : '';
    if (f.kind === 'message' && norm === 'a2ui.v1_0.DataBinding') {
      hasDataBinding = true;
    } else if (f.kind === 'message' && norm === 'a2ui.v1_0.FunctionCall') {
      continue;
    } else if (!literalField) {
      literalField = f;
    } else {
      return undefined;
    }
  }
  return hasDataBinding && literalField ? literalField : undefined;
}

function markDynamicIfSupported(typeDef: TypeDefinition): TypeDefinition {
  switch (typeDef.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'enum':
    case 'any':
    case 'object':
    case 'array':
    case 'union':
      return {...typeDef, dynamic: true};
    default:
      return typeDef;
  }
}

function isSimpleDistinctVariant(t: TypeDefinition): string {
  switch (t.type) {
    case 'string':
    case 'enum':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      return t.type;
  }
}

/**
 * Reverse-generates a canonical {@link CatalogModel} from a structured Protobuf
 * {@link ProtoFileDescriptor} (modeling a parsed `FileDescriptorSet`).
 *
 * Recognizes A2UI v1.0 wire primitives (`a2ui.v1_0.Dynamic*`, `Child`, `ChildList`,
 * `Action`, `CheckRule`, `AccessibilityAttributes`), Google3 security protos
 * (`webutil.html.types.SafeHtmlProto` -> `format: 'safe-html'`,
 * `webutil.html.types.TrustedResourceUrlProto` -> `format: 'trusted-resource-url'`),
 * enums, `Dynamic<Enum>` wrappers, nested messages, maps, and `oneof` unions.
 *
 * The returned model serializes directly via `serializeCatalogDocument` into a
 * valid `formatVersion: "1.0"` Catalog Document ready for `@a2ui/agent` prompt
 * generators and `@a2ui/web_core` zero-Zod validation.
 */
export function protoDescriptorToCatalogModel(
  descriptor: ProtoFileDescriptor,
  options: ReverseCodegenOptions,
): CatalogModel {
  const securityFormats: Record<string, string> = {
    ...DEFAULT_SECURITY_PROTO_FORMATS,
    ...(options.securityProtoFormats ?? {}),
  };
  const dynamicSecurityProtos = options.dynamicSecurityProtos ?? true;
  const pkgPrefix = descriptor.package ? `${descriptor.package}.` : '';

  const topLevelMessages = new Map<string, ProtoMessageDescriptor>();
  for (const msg of descriptor.messages) {
    topLevelMessages.set(msg.name, msg);
    if (pkgPrefix) {
      topLevelMessages.set(`${pkgPrefix}${msg.name}`, msg);
    }
  }

  const topLevelEnums = new Map<string, ProtoEnumDescriptor>();
  for (const en of descriptor.enums ?? []) {
    topLevelEnums.set(en.name, en);
    if (pkgPrefix) {
      topLevelEnums.set(`${pkgPrefix}${en.name}`, en);
    }
  }

  const emittedTypes: Record<string, DataTypeDefinition> = {};

  interface LookupScope {
    readonly messages: ReadonlyMap<string, ProtoMessageDescriptor>;
    readonly enums: ReadonlyMap<string, ProtoEnumDescriptor>;
    readonly parent?: LookupScope;
  }

  const rootScope: LookupScope = {
    messages: topLevelMessages,
    enums: topLevelEnums,
  };

  const makeChildScope = (msg: ProtoMessageDescriptor, parent: LookupScope): LookupScope => {
    const msgs = new Map<string, ProtoMessageDescriptor>();
    for (const nested of msg.nestedMessages ?? []) {
      msgs.set(nested.name, nested);
    }
    const enums = new Map<string, ProtoEnumDescriptor>();
    for (const nested of msg.nestedEnums ?? []) {
      enums.set(nested.name, nested);
    }
    return {messages: msgs, enums, parent};
  };

  const findEnum = (
    name: string,
    scope: LookupScope,
  ): {enumDesc: ProtoEnumDescriptor; isTopLevel: boolean} | undefined => {
    const norm = normalizeTypeName(name);
    let cur: LookupScope | undefined = scope;
    while (cur) {
      const found = cur.enums.get(norm);
      if (found) {
        return {enumDesc: found, isTopLevel: cur.parent === undefined};
      }
      cur = cur.parent;
    }
    // Try short suffix match for qualified names within the same package.
    const shortName = norm.split('.').pop()!;
    let curShort: LookupScope | undefined = scope;
    while (curShort) {
      const found = curShort.enums.get(shortName);
      if (found) {
        return {enumDesc: found, isTopLevel: curShort.parent === undefined};
      }
      curShort = curShort.parent;
    }
    return undefined;
  };

  const findMessage = (name: string, scope: LookupScope): ProtoMessageDescriptor | undefined => {
    const norm = normalizeTypeName(name);
    let cur: LookupScope | undefined = scope;
    while (cur) {
      const found = cur.messages.get(norm);
      if (found) return found;
      cur = cur.parent;
    }
    const shortName = norm.split('.').pop()!;
    let curShort: LookupScope | undefined = scope;
    while (curShort) {
      const found = curShort.messages.get(shortName);
      if (found) return found;
      curShort = curShort.parent;
    }
    return undefined;
  };

  const convertMessageFields = (
    msg: ProtoMessageDescriptor,
    scope: LookupScope,
    visitedMessages: ReadonlySet<string>,
  ): ComponentParameterDefinition[] => {
    const childScope = makeChildScope(msg, scope);
    const params: ComponentParameterDefinition[] = [];
    const emittedOneofs = new Set<string>();

    for (const field of msg.fields) {
      if (field.oneofGroup) {
        if (emittedOneofs.has(field.oneofGroup)) continue;
        emittedOneofs.add(field.oneofGroup);
        const groupFields = msg.fields.filter(f => f.oneofGroup === field.oneofGroup);
        const converted = groupFields.map(gf => ({
          fieldName: toCamelCase(gf.name),
          typeDef: convertFieldType(gf, childScope, visitedMessages),
        }));
        // If two variants share the same base JSON type (e.g. two strings), wrap each in a
        // discriminated 1-property object so the exclusive union stays unambiguous.
        const kindCounts = new Map<string, number>();
        for (const item of converted) {
          const k = isSimpleDistinctVariant(item.typeDef);
          kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
        }
        const variants: TypeDefinition[] = converted.map(item => {
          const k = isSimpleDistinctVariant(item.typeDef);
          if ((kindCounts.get(k) ?? 0) > 1) {
            return {
              type: 'object',
              properties: [{name: item.fieldName, required: true, ...item.typeDef}],
            };
          }
          return item.typeDef;
        });
        params.push({
          name: toCamelCase(field.oneofGroup),
          type: 'union',
          exclusive: true,
          variants,
        });
        continue;
      }

      const typeDef = convertFieldType(field, childScope, visitedMessages);
      params.push({
        name: toCamelCase(field.name),
        ...(field.required ? {required: true} : {}),
        ...(field.description ? {description: field.description} : {}),
        ...typeDef,
      });
    }

    return params;
  };

  const convertScalarOrRef = (
    kind: ProtoFieldKind,
    typeName: string | undefined,
    a2uiRole: 'child' | undefined,
    scope: LookupScope,
    visitedMessages: ReadonlySet<string>,
  ): TypeDefinition => {
    if (kind === 'string') {
      return a2uiRole === 'child' ? {type: 'child'} : {type: 'string'};
    }
    if (kind === 'bytes') {
      return {type: 'string', format: 'byte'};
    }
    if (kind === 'double' || kind === 'float') {
      return {type: 'number'};
    }
    if (INTEGER_KINDS.has(kind)) {
      return {type: 'integer'};
    }
    if (kind === 'bool') {
      return {type: 'boolean'};
    }
    if (kind === 'enum') {
      if (typeName) {
        const match = findEnum(typeName, scope);
        if (match) {
          const enumDef = convertEnumDescriptor(match.enumDesc);
          if (match.isTopLevel) {
            emittedTypes[match.enumDesc.name] = enumDef;
            return {type: 'ref', ref: match.enumDesc.name};
          }
          return enumDef;
        }
      }
      return {type: 'string'};
    }

    // kind === 'message'
    const norm = typeName ? normalizeTypeName(typeName) : '';
    switch (norm) {
      case 'a2ui.v1_0.DynamicString':
        return {type: 'string', dynamic: true};
      case 'a2ui.v1_0.DynamicNumber':
        return {type: 'number', dynamic: true};
      case 'a2ui.v1_0.DynamicInteger':
        return {type: 'integer', dynamic: true};
      case 'a2ui.v1_0.DynamicBoolean':
        return {type: 'boolean', dynamic: true};
      case 'a2ui.v1_0.DynamicValue':
        return {type: 'any', dynamic: true, nullable: false};
      case 'a2ui.v1_0.DynamicStringList':
        return {type: 'array', items: {type: 'string'}, dynamic: true};
      case 'a2ui.v1_0.Child':
        return {type: 'child'};
      case 'a2ui.v1_0.ChildList':
        return {type: 'childList'};
      case 'a2ui.v1_0.Action':
        return {type: 'action'};
      case 'a2ui.v1_0.CheckRule':
        return {type: 'checkRule'};
      case 'a2ui.v1_0.AccessibilityAttributes':
        return {type: 'accessibility'};
      case 'a2ui.v1_0.DataBinding':
        return {type: 'dataBinding'};
      case 'a2ui.v1_0.FunctionCall':
        return {type: 'functionCall'};
      case 'google.protobuf.Struct':
        return {type: 'object', additionalProperties: true};
      case 'google.protobuf.Value':
        return {type: 'any', nullable: true};
    }

    // Check Google3 security protos (e.g. SafeHtmlProto, TrustedResourceUrlProto).
    if (norm && Object.hasOwn(securityFormats, norm)) {
      return {
        type: 'string',
        format: securityFormats[norm],
        ...(dynamicSecurityProtos ? {dynamic: true} : {}),
      };
    }

    // Resolve local/nested message descriptors.
    if (typeName) {
      const targetMsg = findMessage(typeName, scope);
      if (targetMsg) {
        if (visitedMessages.has(targetMsg.name)) {
          return {type: 'object', additionalProperties: true};
        }
        const nextVisited = new Set(visitedMessages);
        nextVisited.add(targetMsg.name);

        // Unwrap `Dynamic<Enum>` or `Dynamic<SecurityProto>` wrapper messages cleanly!
        const unwrappedLiteral = unwrapDynamicWrapperMessage(targetMsg);
        if (unwrappedLiteral) {
          const literalScope = makeChildScope(targetMsg, scope);
          const innerType = convertFieldType(unwrappedLiteral, literalScope, nextVisited);
          if (innerType.type === 'ref' && emittedTypes[innerType.ref]) {
            return markDynamicIfSupported(emittedTypes[innerType.ref]);
          }
          return markDynamicIfSupported(innerType);
        }

        const nestedParams = convertMessageFields(targetMsg, scope, nextVisited);
        return {
          type: 'object',
          properties: nestedParams,
          ...(targetMsg.description ? {description: targetMsg.description} : {}),
        };
      }
    }

    return {type: 'object', additionalProperties: true};
  };

  const convertFieldType = (
    field: ProtoFieldDescriptor,
    scope: LookupScope,
    visitedMessages: ReadonlySet<string>,
  ): TypeDefinition => {
    if (field.mapValue) {
      const valType = convertScalarOrRef(
        field.mapValue.kind,
        field.mapValue.typeName,
        undefined,
        scope,
        visitedMessages,
      );
      return {
        type: 'object',
        additionalProperties: valType,
      };
    }

    const base = convertScalarOrRef(
      field.kind,
      field.typeName,
      field.a2uiRole,
      scope,
      visitedMessages,
    );

    if (field.repeated) {
      return {
        type: 'array',
        items: base,
      };
    }
    return base;
  };

  // Identify top-level messages that are strictly helper/nested/dynamic-wrapper types
  // referenced by component messages when `componentMessages` is not explicitly given.
  const explicitSet = options.componentMessages ? new Set(options.componentMessages) : undefined;
  const helperNames = new Set<string>();
  if (!explicitSet) {
    for (const msg of descriptor.messages) {
      if (unwrapDynamicWrapperMessage(msg)) {
        helperNames.add(msg.name);
      }
    }
  }

  const components: ComponentDefinition[] = [];
  for (const msg of descriptor.messages) {
    if (explicitSet) {
      if (!explicitSet.has(msg.name)) continue;
    } else if (helperNames.has(msg.name)) {
      continue;
    }
    const visited = new Set<string>([msg.name]);
    const parameters = convertMessageFields(msg, rootScope, visited);
    components.push({
      name: deriveComponentName(msg),
      ...(msg.description ? {description: msg.description} : {}),
      ...(msg.checkable ? {checkable: true} : {}),
      ...(parameters.length > 0 ? {parameters} : {}),
      ...(msg.allowedParents !== undefined ? {allowedParents: [...msg.allowedParents]} : {}),
      ...(msg.allowedChildren !== undefined ? {allowedChildren: [...msg.allowedChildren]} : {}),
    });
  }

  return {
    formatVersion: CATALOG_DOCUMENT_FORMAT_VERSION,
    catalogId: options.catalogId,
    protocolVersion: options.protocolVersion ?? '1.0',
    ...(options.title !== undefined ? {title: options.title} : {}),
    ...(options.description !== undefined ? {description: options.description} : {}),
    ...(Object.keys(emittedTypes).length > 0 ? {types: emittedTypes} : {}),
    ...(components.length > 0 ? {components} : {}),
  };
}
