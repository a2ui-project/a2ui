// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import A2UIJSON
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON

/// Bidirectional translator between legacy A2UI JSON Schema catalogs (v0.9, v0.9.1, v1.0) and the
/// canonical in-memory ``CatalogModel`` representation.
public enum CatalogJSONSchemaCodec {
  private static let emptyObjectSchema: Schema = try! Schema(
    rawSchema: .object(["type": .string("object")]),
    context: A2UISchemaRegistry.makeContext()
  )

  private static let untranslatableObjectKeywords: Set<String> = [
    "patternProperties", "not", "if", "then", "else", "dependentRequired", "dependentSchemas",
    "propertyNames", "minProperties", "maxProperties", "oneOf",
  ]

  private static let untranslatableValueKeywords: Set<String> = [
    "patternProperties", "not", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "propertyNames", "dependentRequired", "dependentSchemas", "prefixItems", "contains",
    "minContains", "maxContains",
  ]

  private static let metadataOnlyKeys: Set<String> = [
    "title", "description", "default", "deprecated", "x-deprecated-reason", "examples", "$comment",
  ]

  private static let excludedDefKeys: Set<String> = [
    "anyComponent", "anyFunction", "theme", "CatalogComponentCommon", "ComponentCommon",
  ]

  private struct DecodeContext {
    let localDefs: OrderedDictionary<String, JSONValue>
    let knownTypeNames: Set<String>
    var visitedRefs: Set<String> = []
  }

  private struct EncodeContext {
    let version: A2UIProtocolVersion
    let localTypes: [String: TypeDefinition]
    let useAbsoluteCommonURIs: Bool
    let inlineLocalTypes: Bool
    var visitedRefs: Set<String> = []
  }

  // MARK: - Public Catalog JSON Schema <-> CatalogModel

  /// Parses a legacy JSON Schema catalog document (v0.9, v0.9.1, or v1.0) into a ``CatalogModel``.
  public static func fromJSONSchema(
    _ rawSchema: JSONValue,
    catalogID: String? = nil,
    protocolVersion: String? = nil
  ) throws -> CatalogModel {
    guard let root = rawSchema.objectValue else {
      throw A2UICatalogError("Catalog JSON Schema must be an object.")
    }
    let resolvedID = catalogID ?? root["catalogId"]?.stringValue ?? root["id"]?.stringValue
    guard let resolvedID, !resolvedID.isEmpty else {
      throw A2UICatalogError("catalog_id must be provided or exist in catalog schema")
    }

    let rawVersion =
      protocolVersion
      ?? root["protocolVersion"]?.stringValue
      ?? root["protocol_version"]?.stringValue
      ?? inferProtocolVersion(from: root)
    let resolvedVersion = CatalogDocumentCodec.normalizeProtocolVersion(rawVersion)
    let isV10 = isAtLeastV10(resolvedVersion)

    if isV10 {
      try validateV10Identifiers(root)
      try checkV10ExternalRefs(rawSchema)
    }

    let rawDefs = root["$defs"]?.objectValue ?? [:]
    let types = extractLocalTypes(from: rawDefs)
    let decodeCtx = DecodeContext(localDefs: rawDefs, knownTypeNames: Set(types.keys))

    let allowedComponents = extractUnionAllowedNames(
      in: rawDefs["anyComponent"],
      prefix: "#/components/"
    )
    let allowedFunctions = extractUnionAllowedNames(
      in: rawDefs["anyFunction"],
      prefix: "#/functions/"
    )

    var components: [ComponentDefinition] = []
    if let compsObj = root["components"]?.objectValue {
      for (name, compSchema) in compsObj {
        if let allowedComponents, !allowedComponents.contains(name) { continue }
        let meta: [String: JSONValue]?
        if isV10 {
          meta = try MetadataValidator.validate(
            compSchema["metadata"],
            pathPrefix: "components.\(name).metadata"
          )
        } else {
          meta = compSchema["metadata"]?.dictionaryValue
        }
        components.append(
          extractComponentDefinition(
            from: name,
            schema: compSchema,
            context: decodeCtx,
            allowedParents: compSchema["allowedParents"]?.arrayValue?.compactMap(\.stringValue),
            allowedChildren: compSchema["allowedChildren"]?.arrayValue?.compactMap(\.stringValue),
            metadata: meta,
            defaultAllowsAdditionalProperties: !isV10
          )
        )
      }
    }

    let allFunctions = try parseFunctions(from: root["functions"], context: decodeCtx)
    if isV10 {
      for fn in allFunctions { try fn.validateCallerConstraints() }
    }
    let functions =
      allowedFunctions.map { allowed in allFunctions.filter { allowed.contains($0.name) } }
      ?? allFunctions

    let rawTheme = root["theme"] ?? rawDefs["theme"]
    let surfaceProperties = rawTheme.map {
      extractSurfacePropertiesDefinition(from: $0, context: decodeCtx)
    }

    return CatalogModel(
      formatVersion: CatalogDocumentCodec.supportedFormatVersion,
      catalogID: resolvedID,
      protocolVersion: resolvedVersion,
      title: root["title"]?.stringValue,
      description: root["description"]?.stringValue,
      instructions: root["instructions"]?.stringValue,
      metadata: root["metadata"]?.dictionaryValue,
      types: types,
      surfaceProperties: surfaceProperties,
      components: components,
      functions: functions
    )
  }

  /// Translates a single component JSON Schema into a canonical ``ComponentDefinition``.
  public static func componentDefinition(
    from name: String,
    schema: JSONValue,
    allowedParents: [String]? = nil,
    allowedChildren: [String]? = nil,
    metadata: [String: JSONValue]? = nil
  ) -> ComponentDefinition {
    extractComponentDefinition(
      from: name,
      schema: schema,
      context: DecodeContext(localDefs: [:], knownTypeNames: []),
      allowedParents: allowedParents,
      allowedChildren: allowedChildren,
      metadata: metadata,
      defaultAllowsAdditionalProperties: true
    )
  }

  /// Translates a function argument JSON Schema into a canonical ``FunctionDefinition``.
  public static func functionDefinition(
    from name: String,
    returnType: FunctionReturnType,
    argsSchema: JSONValue,
    description: String? = nil,
    allowedCallers: AllowedCallers = .rendererOnly,
    requiresUserActivation: Bool = false
  ) -> FunctionDefinition {
    extractFunctionDefinition(
      from: name,
      returnDefinition: FunctionReturnDefinition(returnType: returnType),
      argsSchema: argsSchema,
      description: description,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      deprecated: false,
      deprecatedReason: nil,
      context: DecodeContext(localDefs: [:], knownTypeNames: [])
    )
  }

  /// Translates a v0.9 / v0.9.1 theme JSON Schema into a canonical ``SurfacePropertiesDefinition``.
  public static func surfacePropertiesDefinition(
    from themeSchema: JSONValue
  ) -> SurfacePropertiesDefinition {
    extractSurfacePropertiesDefinition(
      from: themeSchema,
      context: DecodeContext(localDefs: [:], knownTypeNames: [])
    )
  }

  /// Serializes a canonical ``CatalogModel`` into a backward-compatible JSON Schema catalog.
  public static func toJSONSchema(
    _ model: CatalogModel,
    protocolVersion: A2UIProtocolVersion = .v10,
    componentEnvelopeRef: String? = nil
  ) -> JSONValue {
    let envelopeRef =
      componentEnvelopeRef
      ?? (protocolVersion.isAtLeastV10
        ? "common_types.json#/$defs/ComponentCommon"
        : "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon")
    let ctx = EncodeContext(
      version: protocolVersion,
      localTypes: model.types,
      useAbsoluteCommonURIs: false,
      inlineLocalTypes: false
    )

    var root: OrderedDictionary<String, JSONValue> = [
      "$schema": .string("https://json-schema.org/draft/2020-12/schema"),
      "$id": .string(model.catalogID),
    ]
    if protocolVersion.isAtLeastV10 {
      root["protocolVersion"] = .string(protocolVersion.rawValue)
    }
    if let title = model.title { root["title"] = .string(title) }
    if let description = model.description { root["description"] = .string(description) }
    root["catalogId"] = .string(model.catalogID)
    if protocolVersion.isAtLeastV10, let instructions = model.instructions {
      root["instructions"] = .string(instructions)
    }
    if let metadata = model.metadata, !metadata.isEmpty {
      var ordered: OrderedDictionary<String, JSONValue> = [:]
      for key in metadata.keys.sorted() { ordered[key] = metadata[key] }
      root["metadata"] = .object(ordered)
    }

    var componentsDict: OrderedDictionary<String, JSONValue> = [:]
    for comp in model.components {
      var defsNeeded: Set<String> = []
      componentsDict[comp.name] = buildInlineComponentSchema(
        comp,
        envelopeRef: envelopeRef,
        context: ctx,
        referencedDefs: &defsNeeded
      )
    }
    if !componentsDict.isEmpty {
      root["components"] = .object(componentsDict)
    }

    var functionNames: [String] = []
    if !model.functions.isEmpty {
      var funcsDict: OrderedDictionary<String, JSONValue> = [:]
      for fn in model.functions where !fn.name.hasPrefix("@") {
        functionNames.append(fn.name)
        var defsNeeded: Set<String> = []
        funcsDict[fn.name] =
          protocolVersion.isAtLeastV10
          ? buildV10FunctionSchema(
            fn,
            context: ctx,
            alwaysCloseArgs: false,
            alwaysEmitCallerFlags: false,
            referencedDefs: &defsNeeded
          )
          : buildV09MapFunctionSchema(fn, context: ctx, referencedDefs: &defsNeeded)
      }
      if !funcsDict.isEmpty { root["functions"] = .object(funcsDict) }
    }

    if !protocolVersion.isAtLeastV10, let surfaceProperties = model.surfaceProperties {
      var defsNeeded: Set<String> = []
      let themeObj = buildSurfacePropertiesSchema(
        surfaceProperties,
        context: EncodeContext(
          version: protocolVersion,
          localTypes: model.types,
          useAbsoluteCommonURIs: false,
          inlineLocalTypes: false
        ),
        referencedDefs: &defsNeeded
      )
      root["theme"] = themeObj["properties"] ?? themeObj
    }

    var defs: OrderedDictionary<String, JSONValue> = [:]
    if protocolVersion.isAtLeastV10 {
      defs["anyComponent"] = makeCatalogUnion(
        names: Array(componentsDict.keys),
        section: "components",
        discriminator: "component"
      )
      defs["anyFunction"] = makeCatalogUnion(names: functionNames, section: "functions")
    }
    for (name, schema) in typeDefsJSONSchema(model.types, version: protocolVersion) {
      defs[name] = schema
    }
    if !defs.isEmpty {
      root["$defs"] = .object(defs)
    }
    return .object(root)
  }

  /// Compiles a ``ComponentDefinition`` into a standalone `JSONSchema.Schema`.
  public static func compileComponentSchema(
    _ definition: ComponentDefinition,
    protocolVersion: A2UIProtocolVersion = .v10,
    localTypes: [String: TypeDefinition] = [:]
  ) throws -> Schema {
    let raw = buildCompiledComponentSchema(
      definition,
      version: protocolVersion,
      localTypes: localTypes
    )
    return try Schema(rawSchema: raw, context: A2UISchemaRegistry.makeContext())
  }

  /// Compiles a ``FunctionDefinition``'s arguments into a standalone `JSONSchema.Schema`.
  public static func compileFunctionArgsSchema(
    _ definition: FunctionDefinition,
    protocolVersion: A2UIProtocolVersion = .v10,
    localTypes: [String: TypeDefinition] = [:]
  ) throws -> Schema {
    let ctx = EncodeContext(
      version: protocolVersion,
      localTypes: localTypes,
      useAbsoluteCommonURIs: true,
      inlineLocalTypes: true
    )
    var defsNeeded: Set<String> = []
    var raw = buildFunctionArgsSchema(
      definition,
      context: ctx,
      forceClosedArgs: false,
      referencedDefs: &defsNeeded
    )
    raw = attachingDefsIfNeeded(
      raw, names: defsNeeded, version: protocolVersion, localTypes: localTypes)
    return try Schema(rawSchema: raw, context: A2UISchemaRegistry.makeContext())
  }

  /// Compiles a ``SurfacePropertiesDefinition`` into a standalone `JSONSchema.Schema`.
  public static func compileSurfacePropertiesSchema(
    _ definition: SurfacePropertiesDefinition,
    protocolVersion: A2UIProtocolVersion = .v091,
    localTypes: [String: TypeDefinition] = [:]
  ) throws -> Schema {
    let ctx = EncodeContext(
      version: protocolVersion,
      localTypes: localTypes,
      useAbsoluteCommonURIs: true,
      inlineLocalTypes: true
    )
    var defsNeeded: Set<String> = []
    var raw = buildSurfacePropertiesSchema(definition, context: ctx, referencedDefs: &defsNeeded)
    raw = attachingDefsIfNeeded(
      raw, names: defsNeeded, version: protocolVersion, localTypes: localTypes)
    return try Schema(rawSchema: raw, context: A2UISchemaRegistry.makeContext())
  }

  // MARK: - Internal / Package Inline Helpers

  package static func compileComponentSchemaOrEmpty(
    _ definition: ComponentDefinition,
    protocolVersion: A2UIProtocolVersion = .v10,
    localTypes: [String: TypeDefinition] = [:]
  ) -> Schema {
    (try? compileComponentSchema(
      definition,
      protocolVersion: protocolVersion,
      localTypes: localTypes
    )) ?? emptyObjectSchema
  }

  internal static func compileFunctionArgsSchemaOrEmpty(
    _ definition: FunctionDefinition,
    protocolVersion: A2UIProtocolVersion = .v10,
    localTypes: [String: TypeDefinition] = [:]
  ) -> Schema {
    (try? compileFunctionArgsSchema(
      definition,
      protocolVersion: protocolVersion,
      localTypes: localTypes
    )) ?? emptyObjectSchema
  }

  internal static func compileSurfacePropertiesSchemaOrNil(
    _ definition: SurfacePropertiesDefinition?,
    protocolVersion: A2UIProtocolVersion = .v091,
    localTypes: [String: TypeDefinition] = [:]
  ) -> Schema? {
    guard let definition else { return nil }
    return try? compileSurfacePropertiesSchema(
      definition,
      protocolVersion: protocolVersion,
      localTypes: localTypes
    )
  }

  internal static func inlineComponentJSONSchema(
    _ definition: ComponentDefinition,
    version: A2UIProtocolVersion,
    envelopeRef: String,
    localTypes: [String: TypeDefinition]
  ) -> JSONValue {
    let ctx = EncodeContext(
      version: version,
      localTypes: localTypes,
      useAbsoluteCommonURIs: false,
      inlineLocalTypes: !version.isAtLeastV10
    )
    var defsNeeded: Set<String> = []
    let raw = buildInlineComponentSchema(
      definition,
      envelopeRef: envelopeRef,
      context: ctx,
      minimalV09Envelope: true,
      referencedDefs: &defsNeeded
    )
    if !version.isAtLeastV10 {
      return attachingDefsIfNeeded(
        raw,
        names: defsNeeded,
        version: version,
        localTypes: localTypes,
        useAbsoluteCommonURIs: false
      )
    }
    return raw
  }

  internal static func inlineV10FunctionJSONSchema(
    _ definition: FunctionDefinition,
    localTypes: [String: TypeDefinition],
    alwaysCloseArgs: Bool = true
  ) -> JSONValue {
    let ctx = EncodeContext(
      version: .v10,
      localTypes: localTypes,
      useAbsoluteCommonURIs: false,
      inlineLocalTypes: false
    )
    var defsNeeded: Set<String> = []
    return buildV10FunctionSchema(
      definition,
      context: ctx,
      alwaysCloseArgs: alwaysCloseArgs,
      alwaysEmitCallerFlags: true,
      referencedDefs: &defsNeeded
    )
  }

  internal static func inlineV09FunctionJSONSchema(
    _ definition: FunctionDefinition,
    version: A2UIProtocolVersion,
    localTypes: [String: TypeDefinition]
  ) -> JSONValue {
    let ctx = EncodeContext(
      version: version,
      localTypes: localTypes,
      useAbsoluteCommonURIs: false,
      inlineLocalTypes: true
    )
    var defsNeeded: Set<String> = []
    var obj: OrderedDictionary<String, JSONValue> = ["name": .string(definition.name)]
    if let desc = definition.description { obj["description"] = .string(desc) }
    obj["parameters"] = buildFunctionArgsSchema(
      definition,
      context: ctx,
      forceClosedArgs: false,
      referencedDefs: &defsNeeded
    )
    obj["returnType"] = .string(definition.returnType.functionReturnType.rawValue)
    return .object(obj)
  }

  internal static func inlineSurfacePropertiesJSONSchema(
    _ definition: SurfacePropertiesDefinition,
    version: A2UIProtocolVersion,
    localTypes: [String: TypeDefinition]
  ) -> JSONValue {
    let ctx = EncodeContext(
      version: version,
      localTypes: localTypes,
      useAbsoluteCommonURIs: false,
      inlineLocalTypes: true
    )
    var defsNeeded: Set<String> = []
    return buildSurfacePropertiesSchema(definition, context: ctx, referencedDefs: &defsNeeded)
  }

  internal static func typeDefsJSONSchema(
    _ types: [String: TypeDefinition],
    version: A2UIProtocolVersion,
    useAbsoluteCommonURIs: Bool = false
  ) -> OrderedDictionary<String, JSONValue> {
    let ctx = EncodeContext(
      version: version,
      localTypes: types,
      useAbsoluteCommonURIs: useAbsoluteCommonURIs,
      inlineLocalTypes: false
    )
    var defs: OrderedDictionary<String, JSONValue> = [:]
    for name in types.keys.sorted() {
      guard let typeDef = types[name] else { continue }
      var defsNeeded: Set<String> = []
      defs[name] = typeToJSONSchema(typeDef, context: ctx, referencedDefs: &defsNeeded)
    }
    return defs
  }

  /// Translates a single property JSON Schema into a ``TypeDefinition`` (used by runtime helpers).
  internal static func translateStandalonePropertyType(_ schema: JSONValue) -> TypeDefinition {
    translateType(schema, context: DecodeContext(localDefs: [:], knownTypeNames: []))
  }

  // MARK: - Private JSON Schema -> Model Extraction

  /// Extracts valid local `$defs` data types using fixed-point pruning so self- and
  /// mutually-recursive definitions survive while untranslatable defs never leave dangling `.ref`s.
  private static func extractLocalTypes(
    from rawDefs: OrderedDictionary<String, JSONValue>
  ) -> [String: TypeDefinition] {
    var candidateNames = Set(
      rawDefs.keys.filter {
        !excludedDefKeys.contains($0) && UnicodeIdentifierValidator.isValidIdentifier($0)
      }
    )
    while true {
      let ctx = DecodeContext(localDefs: rawDefs, knownTypeNames: candidateNames)
      var translated: [String: TypeDefinition] = [:]
      var dropped = false
      for name in candidateNames {
        guard let defSchema = rawDefs[name] else { continue }
        let typeDef = translateType(defSchema, context: ctx)
        if typeDef.isDataType && !typeDef.containsRawJSONSchema {
          translated[name] = typeDef
        } else {
          candidateNames.remove(name)
          dropped = true
        }
      }
      if !dropped {
        return translated
      }
    }
  }

  private struct ComponentExtractionState {
    var properties: OrderedDictionary<String, JSONValue> = [:]
    var deferredCommonProperties: OrderedDictionary<String, JSONValue> = [:]
    var propertyBlockHasID: [String: Bool] = [:]
    var required: Set<String> = []
    var atLeastOneOf: [[String]] = []
    var isCheckable = false
    var declaresID = false
    var description: String?
    var hasUntranslatableRoot = false
    var allowsAdditionalProperties: Bool
  }

  private static func extractComponentDefinition(
    from name: String,
    schema: JSONValue,
    context: DecodeContext,
    allowedParents: [String]?,
    allowedChildren: [String]?,
    metadata: [String: JSONValue]?,
    defaultAllowsAdditionalProperties: Bool
  ) -> ComponentDefinition {
    var mergedDefs = context.localDefs
    if let schemaDefs = schema["$defs"]?.objectValue {
      for (k, v) in schemaDefs where mergedDefs[k] == nil { mergedDefs[k] = v }
    }
    let ctx = DecodeContext(localDefs: mergedDefs, knownTypeNames: context.knownTypeNames)
    var state = ComponentExtractionState(
      allowsAdditionalProperties: defaultAllowsAdditionalProperties
    )
    extractComponentSchema(schema, root: schema, context: ctx, into: &state)
    // Append deferred CatalogComponentCommon properties (e.g. v0.9 `weight`) after component's own.
    for (k, v) in state.deferredCommonProperties where state.properties[k] == nil {
      state.properties[k] = v
      state.propertyBlockHasID[k] = false
    }

    let parameters = buildComponentParameters(from: &state, context: ctx)
    // Explicit `Optional<JSONValue>.none` prevents `JSONValue`'s `ExpressibleByNilLiteral`
    // conformance from promoting `nil` to `Optional.some(.null)`.
    let rawRoot: JSONValue? =
      state.hasUntranslatableRoot ? Optional(schema) : Optional<JSONValue>.none

    return ComponentDefinition(
      name: name,
      description: schema["description"]?.stringValue ?? state.description,
      isCheckable: state.isCheckable,
      parameters: parameters,
      atLeastOneOf: state.atLeastOneOf,
      allowedParents: allowedParents
        ?? schema["allowedParents"]?.arrayValue?.compactMap(\.stringValue),
      allowedChildren: allowedChildren
        ?? schema["allowedChildren"]?.arrayValue?.compactMap(\.stringValue),
      metadata: metadata ?? schema["metadata"]?.dictionaryValue,
      deprecated: schema["deprecated"]?.boolValue ?? false,
      deprecatedReason: schema["x-deprecated-reason"]?.stringValue,
      rawJSONSchema: rawRoot,
      allowsAdditionalProperties: state.allowsAdditionalProperties,
      v09DeclaresID: state.allowsAdditionalProperties || state.declaresID
    )
  }

  private static func extractComponentSchema(
    _ schema: JSONValue,
    root: JSONValue,
    context: DecodeContext,
    into state: inout ComponentExtractionState
  ) {
    guard let obj = schema.objectValue else { return }
    if state.description == nil, let desc = obj["description"]?.stringValue {
      state.description = desc
    }
    if obj["additionalProperties"]?.boolValue == false
      || obj["unevaluatedProperties"]?.boolValue == false
    {
      state.allowsAdditionalProperties = false
    } else if obj["additionalProperties"]?.boolValue == true
      || obj["unevaluatedProperties"]?.boolValue == true
    {
      state.allowsAdditionalProperties = true
    }

    for key in obj.keys where untranslatableObjectKeywords.contains(key) {
      state.hasUntranslatableRoot = true
    }

    if let ref = obj["$ref"]?.stringValue {
      let refName = ref.split(separator: "/").last.map(String.init) ?? ""
      if refName == "Checkable" {
        state.isCheckable = true
        return
      }
      if refName == "ComponentCommon" {
        state.declaresID = true
        return
      }
      if ref.hasPrefix("#"), !context.visitedRefs.contains(ref),
        let target = resolveLocalPointer(ref, in: root) ?? context.localDefs[refName]
      {
        if refName == "CatalogComponentCommon", let props = target["properties"]?.objectValue {
          for (k, v) in props { state.deferredCommonProperties[k] = v }
          return
        }
        var nextCtx = context
        nextCtx.visitedRefs.insert(ref)
        extractComponentSchema(target, root: root, context: nextCtx, into: &state)
      }
      return
    }

    if let props = obj["properties"]?.objectValue {
      let blockHasID = props["id"] != nil
      if blockHasID { state.declaresID = true }
      for (key, value) in props {
        state.properties[key] = value
        state.propertyBlockHasID[key] = blockHasID
      }
    }
    if let req = obj["required"]?.arrayValue {
      for item in req { if let name = item.stringValue { state.required.insert(name) } }
    }
    if let anyOf = obj["anyOf"]?.arrayValue {
      if let group = extractRequiredGroup(from: anyOf) {
        state.atLeastOneOf.append(group)
      } else {
        state.hasUntranslatableRoot = true
        for branch in anyOf {
          extractComponentSchema(branch, root: root, context: context, into: &state)
        }
      }
    }
    if let oneOf = obj["oneOf"]?.arrayValue {
      state.hasUntranslatableRoot = true
      for branch in oneOf {
        extractComponentSchema(branch, root: root, context: context, into: &state)
      }
    }
    if let allOf = obj["allOf"]?.arrayValue {
      for branch in allOf {
        extractComponentSchema(branch, root: root, context: context, into: &state)
      }
    }
  }

  private static func buildComponentParameters(
    from state: inout ComponentExtractionState,
    context: DecodeContext
  ) -> [ParameterDefinition] {
    var parameters: [ParameterDefinition] = []
    for (propName, propSchema) in state.properties {
      if propName == "component" || propName == "@catalogId" || propName == "@accessibility"
        || propName == "@metadata"
      {
        continue
      }
      if (propName == "@checks" || propName == "checks") && isCheckRuleListSchema(propSchema) {
        state.isCheckable = true
        continue
      }
      if propName == "accessibility" && refSuffix(of: propSchema) == "AccessibilityAttributes" {
        continue
      }
      let blockHasID = state.propertyBlockHasID[propName] ?? false
      if propName == "id",
        refSuffix(of: propSchema) == "ComponentId" || propSchema["type"]?.stringValue == "string"
      {
        continue
      }
      if propName == "catalogId", blockHasID, propSchema["type"]?.stringValue == "string" {
        continue
      }
      if propName == "metadata" {
        if refSuffix(of: propSchema) == "ComponentCommonMetadata" { continue }
        let metaKeys = propSchema["properties"]?.objectValue?.keys.map { $0 } ?? []
        if blockHasID && propSchema["type"]?.stringValue == "object" && metaKeys == ["extensions"] {
          continue
        }
      }
      let translated = translateType(propSchema, context: context)
      parameters.append(
        ParameterDefinition(
          name: propName,
          type: translated.strippingParameterMetadata(),
          required: state.required.contains(propName),
          description: translated.description,
          deprecated: translated.deprecated,
          deprecatedReason: translated.deprecatedReason
        )
      )
    }
    return parameters
  }

  private static func extractSurfacePropertiesDefinition(
    from themeSchema: JSONValue,
    context: DecodeContext
  ) -> SurfacePropertiesDefinition {
    guard let obj = themeSchema.objectValue else {
      return SurfacePropertiesDefinition(rawJSONSchema: themeSchema)
    }
    let hasObjectWrapper =
      obj["type"]?.stringValue == "object" || obj["properties"] != nil || obj["allOf"] != nil
    if hasObjectWrapper {
      guard let merged = extractMergedObjectSchema(themeSchema, context: context) else {
        return SurfacePropertiesDefinition(
          description: obj["description"]?.stringValue,
          rawJSONSchema: themeSchema
        )
      }
      return SurfacePropertiesDefinition(
        description: obj["description"]?.stringValue,
        properties: merged.properties,
        additionalProperties: merged.additionalProperties,
        rawJSONSchema: Optional<JSONValue>.none
      )
    }
    let properties = translateObjectMembers(obj, required: [], context: context)
    return SurfacePropertiesDefinition(
      description: nil,
      properties: properties,
      additionalProperties: .allowed,
      rawJSONSchema: Optional<JSONValue>.none
    )
  }

  private static func parseFunctions(
    from rawFunctions: JSONValue?,
    context: DecodeContext
  ) throws -> [FunctionDefinition] {
    guard let rawFunctions else { return [] }
    if let obj = rawFunctions.objectValue {
      return obj.map { name, fnValue in
        parseSingleFunction(name: name, fnValue: fnValue, context: context)
      }
    }
    if let arr = rawFunctions.arrayValue {
      return try arr.enumerated().map { index, fnValue in
        guard let name = fnValue["name"]?.stringValue, !name.isEmpty else {
          throw A2UICatalogError("Function at index \(index) is missing a valid 'name'.")
        }
        return parseSingleFunction(name: name, fnValue: fnValue, context: context)
      }
    }
    return []
  }

  private static func parseSingleFunction(
    name: String,
    fnValue: JSONValue,
    context: DecodeContext
  ) -> FunctionDefinition {
    let argsSchema = extractFunctionArgsSchema(from: fnValue)
    let rawReturnType =
      fnValue["returnType"]?.stringValue
      ?? fnValue["properties"]?["returnType"]?["const"]?.stringValue
      ?? "any"
    let returnDef = CatalogDocumentCodec.parseReturnShorthand(rawReturnType) ?? .any
    let callers =
      fnValue["allowedCallers"]?.stringValue.flatMap(AllowedCallers.init(rawValue:))
      ?? .rendererOnly
    return extractFunctionDefinition(
      from: name,
      returnDefinition: returnDef,
      argsSchema: argsSchema,
      description: fnValue["description"]?.stringValue,
      allowedCallers: callers,
      requiresUserActivation: fnValue["requiresUserActivation"]?.boolValue ?? false,
      deprecated: fnValue["deprecated"]?.boolValue ?? false,
      deprecatedReason: fnValue["x-deprecated-reason"]?.stringValue,
      context: context
    )
  }

  private static func extractFunctionDefinition(
    from name: String,
    returnDefinition: FunctionReturnDefinition,
    argsSchema: JSONValue,
    description: String?,
    allowedCallers: AllowedCallers,
    requiresUserActivation: Bool,
    deprecated: Bool,
    deprecatedReason: String?,
    context: DecodeContext
  ) -> FunctionDefinition {
    guard let obj = argsSchema.objectValue,
      let merged = extractMergedObjectSchema(argsSchema, context: context)
    else {
      return FunctionDefinition(
        name: name,
        description: description ?? argsSchema["description"]?.stringValue,
        returnType: returnDefinition,
        allowedCallers: allowedCallers,
        requiresUserActivation: requiresUserActivation,
        deprecated: deprecated,
        deprecatedReason: deprecatedReason,
        rawJSONSchema: argsSchema
      )
    }
    return FunctionDefinition(
      name: name,
      description: description ?? obj["description"]?.stringValue,
      returnType: returnDefinition,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      parameters: merged.properties,
      atLeastOneOf: merged.atLeastOneOf,
      additionalParameters: merged.additionalProperties,
      deprecated: deprecated || (obj["deprecated"]?.boolValue ?? false),
      deprecatedReason: deprecatedReason ?? obj["x-deprecated-reason"]?.stringValue,
      rawJSONSchema: Optional<JSONValue>.none
    )
  }

  private struct ObjectSchemaParts {
    var rawProps: OrderedDictionary<String, JSONValue> = [:]
    var required: Set<String> = []
    var atLeastOneOf: [[String]] = []
    var explicitAdditional: AdditionalProperties?
  }

  /// Extracts a merged object schema (supporting `properties`, `required`, single-group `anyOf`,
  /// `allOf` of `anyOf`-required groups, and `allOf` of local-ref / object sub-schemas).
  /// Returns `nil` when the schema contains untranslatable object keywords.
  private static func extractMergedObjectSchema(
    _ schema: JSONValue,
    context: DecodeContext
  ) -> (
    properties: [ParameterDefinition],
    additionalProperties: AdditionalProperties,
    atLeastOneOf: [[String]]
  )? {
    var parts = ObjectSchemaParts()
    guard collectObjectSchemaParts(schema, context: context, into: &parts) else { return nil }
    let properties = translateObjectMembers(
      parts.rawProps,
      required: parts.required,
      context: context
    )
    return (properties, parts.explicitAdditional ?? .allowed, parts.atLeastOneOf)
  }

  private static func collectObjectSchemaParts(
    _ schema: JSONValue,
    context: DecodeContext,
    into parts: inout ObjectSchemaParts
  ) -> Bool {
    guard let obj = schema.objectValue else { return false }
    if obj.keys.contains(where: { untranslatableObjectKeywords.contains($0) }) { return false }

    if let ref = obj["$ref"]?.stringValue {
      guard ref.hasPrefix("#/$defs/"), !context.visitedRefs.contains(ref) else { return false }
      let defName = String(ref.dropFirst("#/$defs/".count))
      guard let target = context.localDefs[defName] else { return false }
      var nextCtx = context
      nextCtx.visitedRefs.insert(ref)
      return collectObjectSchemaParts(target, context: nextCtx, into: &parts)
    }

    if let props = obj["properties"]?.objectValue {
      for (k, v) in props { parts.rawProps[k] = v }
    }
    if let req = obj["required"]?.arrayValue {
      for item in req { if let s = item.stringValue { parts.required.insert(s) } }
    }
    if let anyOf = obj["anyOf"]?.arrayValue {
      guard let group = extractRequiredGroup(from: anyOf) else { return false }
      parts.atLeastOneOf.append(group)
    }
    if let allOf = obj["allOf"]?.arrayValue {
      for branch in allOf {
        guard collectObjectSchemaParts(branch, context: context, into: &parts) else { return false }
      }
    }
    if obj["additionalProperties"] != nil || obj["unevaluatedProperties"] != nil {
      parts.explicitAdditional = translateAdditionalProperties(object: obj, context: context)
    }
    return true
  }

  private static func translateObjectMembers(
    _ rawProps: OrderedDictionary<String, JSONValue>,
    required: Set<String>,
    context: DecodeContext
  ) -> [ParameterDefinition] {
    rawProps.map { key, propSchema in
      let translated = translateType(propSchema, context: context)
      return ParameterDefinition(
        name: key,
        type: translated.strippingParameterMetadata(),
        required: required.contains(key),
        description: translated.description,
        deprecated: translated.deprecated,
        deprecatedReason: translated.deprecatedReason
      )
    }
  }

  private static func translateType(
    _ schema: JSONValue,
    context: DecodeContext
  ) -> TypeDefinition {
    guard let obj = schema.objectValue else { return .rawJSONSchema(schema) }

    let desc = obj["description"]?.stringValue
    let deprecated = obj["deprecated"]?.boolValue ?? false
    let depReason = obj["x-deprecated-reason"]?.stringValue

    // Legacy "REF:<uri>|<optional description>" smuggling convention.
    if let desc, desc.hasPrefix("REF:") {
      let parts = desc.dropFirst(4).split(separator: "|", maxSplits: 1)
      let refURI = parts.first.map(String.init) ?? ""
      let customDesc = parts.count > 1 && !parts[1].isEmpty ? String(parts[1]) : nil
      if let mapped = translateRef(
        refURI,
        defaultValue: obj["default"],
        description: customDesc,
        deprecated: deprecated,
        deprecatedReason: depReason,
        context: context
      ) {
        return mapped
      }
      // Preserve unrecognized REF smuggling (e.g. custom common type) for legacy processRefs.
      return .rawJSONSchema(schema)
    }

    if let ref = obj["$ref"]?.stringValue {
      if let mapped = translateRef(
        ref,
        defaultValue: obj["default"],
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason,
        context: context
      ) {
        return mapped
      }
      return .rawJSONSchema(schema)
    }

    // Non-nullable static `any`: `{"not": {"type": "null"}}`.
    if let notObj = obj["not"]?.objectValue,
      notObj.count == 1,
      notObj["type"]?.stringValue == "null",
      obj.keys.allSatisfy({ $0 == "not" || metadataOnlyKeys.contains($0) })
    {
      return .any(
        dynamic: false,
        nullable: false,
        defaultValue: obj["default"],
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    }

    let typeName = obj["type"]?.stringValue

    // DateTimeInput min/max pattern or merged object `allOf` (e.g. CompositeOption / multi-group).
    if let allOf = obj["allOf"]?.arrayValue {
      if let dynamicFormatted = translateDynamicFormattedAllOf(
        allOf,
        defaultValue: obj["default"],
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      ) {
        return dynamicFormatted
      }
      if let merged = extractMergedObjectSchema(schema, context: context),
        typeName == "object" || obj["properties"] != nil || !merged.properties.isEmpty
          || !merged.atLeastOneOf.isEmpty
      {
        return .object(
          dynamic: false,
          properties: merged.properties,
          additionalProperties: merged.additionalProperties,
          atLeastOneOf: merged.atLeastOneOf,
          defaultValue: obj["default"]?.dictionaryValue,
          description: desc,
          deprecated: deprecated,
          deprecatedReason: depReason
        )
      }
      return .rawJSONSchema(schema)
    }

    if obj.keys.contains(where: { untranslatableValueKeywords.contains($0) }) {
      return .rawJSONSchema(schema)
    }

    if let constVal = obj["const"] {
      guard isJSONScalar(constVal) else { return .rawJSONSchema(schema) }
      return .const(
        value: constVal,
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    }

    if let enumValues = obj["enum"]?.arrayValue, !enumValues.isEmpty {
      guard let valueType = homogeneousEnumValueType(enumValues, declaredType: typeName) else {
        return .rawJSONSchema(schema)
      }
      return .enum(
        values: enumValues,
        valueType: valueType,
        dynamic: false,
        defaultValue: obj["default"],
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    }

    // Multi-format string: `{"type": "string", "oneOf": [{"format": "date"}, ...]}`.
    if typeName == "string" {
      let multiFormats: [String]?
      if let oneOf = obj["oneOf"]?.arrayValue {
        guard let extracted = extractFormatOnlyBranches(oneOf) else {
          return .rawJSONSchema(schema)
        }
        multiFormats = extracted
      } else if let anyOf = obj["anyOf"]?.arrayValue {
        guard let extracted = extractFormatOnlyBranches(anyOf) else {
          return .rawJSONSchema(schema)
        }
        multiFormats = extracted
      } else {
        multiFormats = obj["format"]?.stringValue.map { [$0] }
      }
      return .string(
        dynamic: false,
        formats: multiFormats,
        pattern: obj["pattern"]?.stringValue,
        minLength: obj["minLength"]?.intValue,
        maxLength: obj["maxLength"]?.intValue,
        defaultValue: obj["default"]?.stringValue,
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    }

    // Object with `atLeastOneOf` (`anyOf`) before generic value union.
    if typeName == "object" || obj["properties"] != nil {
      guard let merged = extractMergedObjectSchema(schema, context: context) else {
        return .rawJSONSchema(schema)
      }
      return .object(
        dynamic: false,
        properties: merged.properties,
        additionalProperties: merged.additionalProperties,
        atLeastOneOf: merged.atLeastOneOf,
        defaultValue: obj["default"]?.dictionaryValue,
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    }

    if let oneOf = obj["oneOf"]?.arrayValue {
      return translateUnionBranches(
        oneOf,
        exclusive: true,
        defaultValue: obj["default"],
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason,
        context: context,
        original: schema
      )
    }

    if let anyOf = obj["anyOf"]?.arrayValue {
      return translateUnionBranches(
        anyOf,
        exclusive: false,
        defaultValue: obj["default"],
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason,
        context: context,
        original: schema
      )
    }

    if let typeArray = obj["type"]?.arrayValue {
      let typeNames = typeArray.compactMap(\.stringValue)
      let nonNull = typeNames.filter { $0 != "null" }
      if nonNull.count >= 2 && nonNull.count == typeNames.count {
        let variants = nonNull.compactMap(simplePrimitiveType)
        if variants.count == nonNull.count {
          return .union(
            variants: variants,
            exclusive: false,
            dynamic: false,
            defaultValue: obj["default"],
            description: desc,
            deprecated: deprecated,
            deprecatedReason: depReason
          )
        }
      }
      return .rawJSONSchema(schema)
    }

    switch typeName {
    case "number":
      return .number(
        dynamic: false,
        min: obj["minimum"]?.doubleValue,
        max: obj["maximum"]?.doubleValue,
        defaultValue: obj["default"]?.doubleValue,
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    case "integer":
      return .integer(
        dynamic: false,
        min: obj["minimum"]?.intValue,
        max: obj["maximum"]?.intValue,
        defaultValue: obj["default"]?.intValue,
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    case "boolean":
      return .boolean(
        dynamic: false,
        defaultValue: obj["default"]?.boolValue,
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    case "array":
      return .array(
        dynamic: false,
        items: obj["items"].map { translateType($0, context: context) },
        minItems: obj["minItems"]?.intValue,
        maxItems: obj["maxItems"]?.intValue,
        uniqueItems: obj["uniqueItems"]?.boolValue ?? false,
        defaultValue: obj["default"]?.arrayValue,
        description: desc,
        deprecated: deprecated,
        deprecatedReason: depReason
      )
    default:
      if obj["items"] != nil {
        return .array(
          dynamic: false,
          items: obj["items"].map { translateType($0, context: context) },
          minItems: obj["minItems"]?.intValue,
          maxItems: obj["maxItems"]?.intValue,
          uniqueItems: obj["uniqueItems"]?.boolValue ?? false,
          defaultValue: obj["default"]?.arrayValue,
          description: desc,
          deprecated: deprecated,
          deprecatedReason: depReason
        )
      }
      if obj.keys.allSatisfy({ metadataOnlyKeys.contains($0) }) {
        return .any(
          dynamic: true,
          nullable: true,
          defaultValue: obj["default"],
          description: desc,
          deprecated: deprecated,
          deprecatedReason: depReason
        )
      }
      return .rawJSONSchema(schema)
    }
  }

  private static func translateRef(
    _ ref: String,
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    context: DecodeContext
  ) -> TypeDefinition? {
    let suffix = ref.split(separator: "/").last.map(String.init) ?? ""
    let base: TypeDefinition?
    switch suffix {
    case "DynamicString": base = .string(dynamic: true)
    case "DynamicNumber": base = .number(dynamic: true)
    case "DynamicBoolean": base = .boolean(dynamic: true)
    case "DynamicStringList": base = .array(dynamic: true, items: .string())
    case "DynamicValue": base = .any(dynamic: true, nullable: false)
    case "DataBinding": base = .dataBinding()
    case "FunctionCall": base = .functionCall()
    case "Child", "ComponentId": base = .child()
    case "ChildList": base = .childList()
    case "Action": base = .action()
    case "CheckRule": base = .checkRule()
    case "AccessibilityAttributes": base = .accessibility()
    default:
      if ref.hasPrefix("#/$defs/") {
        if context.knownTypeNames.contains(suffix) {
          base = .ref(suffix)
        } else if !context.visitedRefs.contains(ref), let target = context.localDefs[suffix] {
          var nextCtx = context
          nextCtx.visitedRefs.insert(ref)
          base = translateType(target, context: nextCtx)
        } else {
          base = nil
        }
      } else {
        base = nil
      }
    }
    guard var result = base else { return nil }
    result = result.withDefault(defaultValue)
    if let description { result.description = description }
    if deprecated { result.deprecated = true }
    if let deprecatedReason { result.deprecatedReason = deprecatedReason }
    return result
  }

  private static func translateDynamicFormattedAllOf(
    _ branches: [JSONValue],
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?
  ) -> TypeDefinition? {
    guard branches.count == 2 else { return nil }
    var hasDynamicString = false
    var formats: [String]?
    for branch in branches {
      if refSuffix(of: branch) == "DynamicString" {
        hasDynamicString = true
      } else if branch["if"]?["type"]?.stringValue == "string", let thenSchema = branch["then"] {
        if let single = thenSchema["format"]?.stringValue {
          formats = [single]
        } else if let oneOf = thenSchema["oneOf"]?.arrayValue,
          let extracted = extractFormatOnlyBranches(oneOf)
        {
          formats = extracted
        }
      }
    }
    guard hasDynamicString, let formats else { return nil }
    return .string(
      dynamic: true,
      formats: formats,
      defaultValue: defaultValue?.stringValue,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func translateUnionBranches(
    _ branches: [JSONValue],
    exclusive: Bool,
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool,
    deprecatedReason: String?,
    context: DecodeContext,
    original: JSONValue
  ) -> TypeDefinition {
    var hasDataBinding = false
    var hasFunctionCall = false
    var literalBranches: [JSONValue] = []
    for branch in branches {
      if isDataBindingBranch(branch) {
        hasDataBinding = true
      } else if isFunctionCallBranch(branch) {
        hasFunctionCall = true
      } else {
        literalBranches.append(branch)
      }
    }

    if hasDataBinding && hasFunctionCall && !literalBranches.isEmpty {
      if literalBranches.count == 1 {
        var inner = translateType(literalBranches[0], context: context)
        if !inner.containsRawJSONSchema {
          inner = inner.withDynamic(true).withDefault(defaultValue)
          if let description { inner.description = description }
          if deprecated { inner.deprecated = true }
          if let deprecatedReason { inner.deprecatedReason = deprecatedReason }
          return inner
        }
      } else {
        let variants = literalBranches.map { translateType($0, context: context) }
        if !variants.contains(where: \.containsRawJSONSchema) {
          return .union(
            variants: variants,
            exclusive: exclusive,
            dynamic: true,
            defaultValue: defaultValue,
            description: description,
            deprecated: deprecated,
            deprecatedReason: deprecatedReason
          )
        }
      }
    }

    guard branches.count >= 2 else {
      if let only = branches.first { return translateType(only, context: context) }
      return .rawJSONSchema(original)
    }
    return .union(
      variants: branches.map { translateType($0, context: context) },
      exclusive: exclusive,
      dynamic: false,
      defaultValue: defaultValue,
      description: description,
      deprecated: deprecated,
      deprecatedReason: deprecatedReason
    )
  }

  private static func translateAdditionalProperties(
    object: OrderedDictionary<String, JSONValue>,
    context: DecodeContext
  ) -> AdditionalProperties {
    let raw = object["additionalProperties"] ?? object["unevaluatedProperties"]
    guard let raw else { return .allowed }
    if let flag = raw.boolValue { return flag ? .allowed : .disallowed }
    if raw.objectValue != nil { return .typed(translateType(raw, context: context)) }
    return .allowed
  }

  // MARK: - Private Model -> JSON Schema Emission

  private static func buildCompiledComponentSchema(
    _ definition: ComponentDefinition,
    version: A2UIProtocolVersion,
    localTypes: [String: TypeDefinition]
  ) -> JSONValue {
    if let raw = definition.rawJSONSchema { return raw }
    let ctx = EncodeContext(
      version: version,
      localTypes: localTypes,
      useAbsoluteCommonURIs: true,
      inlineLocalTypes: true
    )
    var defsNeeded: Set<String> = []
    var props: OrderedDictionary<String, JSONValue> = [
      "id": .object(["$ref": .string(commonRef("ComponentId", context: ctx))]),
      "component": .object(["const": .string(definition.name)]),
    ]
    if version.isAtLeastV10 {
      props["@catalogId"] = .object(["type": .string("string")])
      props["@accessibility"] = .object([
        "$ref": .string(commonRef("AccessibilityAttributes", context: ctx))
      ])
      props["@metadata"] = .object([
        "type": .string("object"),
        "properties": .object([
          "extensions": .object(["$ref": .string(commonRef("Extensions", context: ctx))])
        ]),
        "additionalProperties": .boolean(false),
      ])
      if definition.isCheckable {
        props["@checks"] = .object([
          "type": .string("array"),
          "items": .object(["$ref": .string(commonRef("CheckRule", context: ctx))]),
        ])
      }
    } else {
      props["accessibility"] = .object([
        "$ref": .string(commonRef("AccessibilityAttributes", context: ctx))
      ])
      if definition.isCheckable {
        props["checks"] = .object([
          "type": .string("array"),
          "items": .object(["$ref": .string(commonRef("CheckRule", context: ctx))]),
        ])
      }
    }

    var required: [JSONValue] = [.string("component")]
    for param in definition.parameters {
      props[param.name] = parameterToJSONSchema(param, context: ctx, referencedDefs: &defsNeeded)
      if param.required { required.append(.string(param.name)) }
    }

    var obj: OrderedDictionary<String, JSONValue> = [
      "type": .string("object"),
      "properties": .object(props),
      "required": .array(required),
    ]
    applyAtLeastOneOf(definition.atLeastOneOf, to: &obj)
    if !definition.allowsAdditionalProperties {
      obj["additionalProperties"] = .boolean(false)
    }
    return attachingDefsIfNeeded(
      .object(obj),
      names: defsNeeded,
      version: version,
      localTypes: localTypes,
      useAbsoluteCommonURIs: true
    )
  }

  private static func buildInlineComponentSchema(
    _ definition: ComponentDefinition,
    envelopeRef: String,
    context: EncodeContext,
    minimalV09Envelope: Bool = false,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    if let raw = definition.rawJSONSchema { return raw }
    var props: OrderedDictionary<String, JSONValue> = [
      "component": .object(["const": .string(definition.name)])
    ]
    var required: [JSONValue] = [.string("component")]
    for param in definition.parameters {
      props[param.name] = parameterToJSONSchema(
        param,
        context: context,
        referencedDefs: &referencedDefs
      )
      if param.required { required.append(.string(param.name)) }
    }

    if context.version.isAtLeastV10 {
      var coreObj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
      if let desc = definition.description, !definition.isCheckable {
        coreObj["description"] = .string(desc)
      }
      coreObj["properties"] = .object(props)
      coreObj["required"] = .array(required)
      applyAtLeastOneOf(definition.atLeastOneOf, to: &coreObj)

      var result: OrderedDictionary<String, JSONValue>
      if definition.isCheckable {
        result = ["type": .string("object")]
        if let desc = definition.description { result["description"] = .string(desc) }
        result["allOf"] = .array([
          .object(["$ref": .string(commonRef("Checkable", context: context))]),
          .object(coreObj),
        ])
      } else {
        result = coreObj
      }
      if let parents = definition.allowedParents {
        result["allowedParents"] = .array(parents.map(JSONValue.string))
      }
      if let children = definition.allowedChildren {
        result["allowedChildren"] = .array(children.map(JSONValue.string))
      }
      if let metadata = definition.metadata {
        var ordered: OrderedDictionary<String, JSONValue> = [:]
        for key in metadata.keys.sorted() { ordered[key] = metadata[key] }
        result["metadata"] = .object(ordered)
      }
      if definition.deprecated { result["deprecated"] = .boolean(true) }
      if let reason = definition.deprecatedReason {
        result["x-deprecated-reason"] = .string(reason)
      }
      return .object(result)
    }

    var allOfBranches: [JSONValue] = [.object(["$ref": .string(envelopeRef)])]
    if definition.isCheckable {
      allOfBranches.append(.object(["$ref": .string(commonRef("Checkable", context: context))]))
    }
    var inner: OrderedDictionary<String, JSONValue> = [
      "properties": .object(props),
      "required": .array(required),
    ]
    if let desc = definition.description { inner["description"] = .string(desc) }
    applyAtLeastOneOf(definition.atLeastOneOf, to: &inner)
    allOfBranches.append(.object(inner))
    var result: OrderedDictionary<String, JSONValue> =
      minimalV09Envelope
      ? ["allOf": .array(allOfBranches)]
      : [
        "type": .string("object"),
        "allOf": .array(allOfBranches),
        "unevaluatedProperties": .boolean(false),
      ]
    if definition.deprecated { result["deprecated"] = .boolean(true) }
    if let reason = definition.deprecatedReason { result["x-deprecated-reason"] = .string(reason) }
    return .object(result)
  }

  private static func buildV10FunctionSchema(
    _ definition: FunctionDefinition,
    context: EncodeContext,
    alwaysCloseArgs: Bool,
    alwaysEmitCallerFlags: Bool,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    var obj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
    if let desc = definition.description { obj["description"] = .string(desc) }
    obj["returnType"] = .string(definition.returnType.functionReturnType.rawValue)
    if alwaysEmitCallerFlags || definition.allowedCallers != .rendererOnly {
      obj["allowedCallers"] = .string(definition.allowedCallers.rawValue)
    }
    if alwaysEmitCallerFlags || definition.requiresUserActivation {
      obj["requiresUserActivation"] = .boolean(definition.requiresUserActivation)
    }
    let argsSchema = buildFunctionArgsSchema(
      definition,
      context: context,
      forceClosedArgs: alwaysCloseArgs,
      referencedDefs: &referencedDefs
    )
    obj["properties"] = .object([
      "@call": .object(["const": .string(definition.name)]),
      "args": argsSchema,
    ])
    let requiresArgs =
      definition.parameters.contains(where: \.required) || !definition.atLeastOneOf.isEmpty
    obj["required"] = .array(
      requiresArgs ? [.string("@call"), .string("args")] : [.string("@call")])
    if definition.deprecated { obj["deprecated"] = .boolean(true) }
    if let reason = definition.deprecatedReason { obj["x-deprecated-reason"] = .string(reason) }
    return .object(obj)
  }

  private static func buildV09MapFunctionSchema(
    _ definition: FunctionDefinition,
    context: EncodeContext,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    var obj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
    if let desc = definition.description { obj["description"] = .string(desc) }
    let argsSchema = buildFunctionArgsSchema(
      definition,
      context: context,
      forceClosedArgs: false,
      referencedDefs: &referencedDefs
    )
    obj["properties"] = .object([
      "call": .object(["const": .string(definition.name)]),
      "args": argsSchema,
      "returnType": .object(["const": .string(definition.returnType.functionReturnType.rawValue)]),
    ])
    let requiresArgs =
      definition.parameters.contains(where: \.required) || !definition.atLeastOneOf.isEmpty
    obj["required"] = .array(requiresArgs ? [.string("call"), .string("args")] : [.string("call")])
    obj["unevaluatedProperties"] = .boolean(false)
    if definition.deprecated { obj["deprecated"] = .boolean(true) }
    if let reason = definition.deprecatedReason { obj["x-deprecated-reason"] = .string(reason) }
    return .object(obj)
  }

  private static func buildFunctionArgsSchema(
    _ definition: FunctionDefinition,
    context: EncodeContext,
    forceClosedArgs: Bool,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    if let raw = definition.rawJSONSchema { return raw }
    let additional: AdditionalProperties =
      forceClosedArgs && definition.additionalParameters == .allowed
      ? .disallowed
      : definition.additionalParameters
    return emitObjectSchema(
      properties: definition.parameters,
      additionalProperties: additional,
      atLeastOneOf: definition.atLeastOneOf,
      useUnevaluatedForClosed: context.version.isAtLeastV10,
      description: nil,
      defaultValue: nil,
      context: context,
      referencedDefs: &referencedDefs
    )
  }

  private static func buildSurfacePropertiesSchema(
    _ definition: SurfacePropertiesDefinition,
    context: EncodeContext,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    if let raw = definition.rawJSONSchema { return raw }
    return emitObjectSchema(
      properties: definition.properties,
      additionalProperties: definition.additionalProperties,
      atLeastOneOf: [],
      useUnevaluatedForClosed: false,
      description: definition.description,
      defaultValue: nil,
      context: context,
      referencedDefs: &referencedDefs
    )
  }

  private static func emitObjectSchema(
    properties: [ParameterDefinition],
    additionalProperties: AdditionalProperties,
    atLeastOneOf: [[String]],
    useUnevaluatedForClosed: Bool,
    description: String?,
    defaultValue: [String: JSONValue]?,
    context: EncodeContext,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    var obj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
    if let description { obj["description"] = .string(description) }
    if !properties.isEmpty {
      var propsDict: OrderedDictionary<String, JSONValue> = [:]
      var required: [JSONValue] = []
      for param in properties {
        propsDict[param.name] = parameterToJSONSchema(
          param,
          context: context,
          referencedDefs: &referencedDefs
        )
        if param.required { required.append(.string(param.name)) }
      }
      obj["properties"] = .object(propsDict)
      if !required.isEmpty { obj["required"] = .array(required) }
    }
    applyAtLeastOneOf(atLeastOneOf, to: &obj)
    switch additionalProperties {
    case .disallowed:
      obj[useUnevaluatedForClosed ? "unevaluatedProperties" : "additionalProperties"] = .boolean(
        false)
    case .allowed:
      break
    case .typed(let valueType):
      obj["additionalProperties"] = typeToJSONSchema(
        valueType,
        context: context,
        referencedDefs: &referencedDefs
      )
    }
    if let defaultValue {
      var ordered: OrderedDictionary<String, JSONValue> = [:]
      for key in defaultValue.keys.sorted() { ordered[key] = defaultValue[key] }
      obj["default"] = .object(ordered)
    }
    return .object(obj)
  }

  private static func parameterToJSONSchema(
    _ param: ParameterDefinition,
    context: EncodeContext,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    var effectiveType = param.type
    if effectiveType.description == nil { effectiveType.description = param.description }
    if param.deprecated { effectiveType.deprecated = true }
    if effectiveType.deprecatedReason == nil {
      effectiveType.deprecatedReason = param.deprecatedReason
    }
    return typeToJSONSchema(effectiveType, context: context, referencedDefs: &referencedDefs)
  }

  private static func typeToJSONSchema(
    _ type: TypeDefinition,
    context: EncodeContext,
    referencedDefs: inout Set<String>
  ) -> JSONValue {
    switch type.kind {
    case .string(let dynamic, let formats, let pattern, let minL, let maxL, let defVal):
      return emitStringJSONSchema(
        dynamic: dynamic,
        formats: formats,
        pattern: pattern,
        minLength: minL,
        maxLength: maxL,
        defaultValue: defVal,
        meta: type,
        context: context
      )

    case .number(let dynamic, let minV, let maxV, let defVal):
      if dynamic && minV == nil && maxV == nil {
        return makeRefObject(
          commonRef("DynamicNumber", context: context),
          defaultValue: defVal.map(CatalogDocumentCodec.encodeNumber),
          meta: type
        )
      }
      var lit: OrderedDictionary<String, JSONValue> = ["type": .string("number")]
      if let minV { lit["minimum"] = CatalogDocumentCodec.encodeNumber(minV) }
      if let maxV { lit["maximum"] = CatalogDocumentCodec.encodeNumber(maxV) }
      return wrapDynamicIfNeeded(
        literal: .object(lit),
        dynamic: dynamic,
        defaultValue: defVal.map(CatalogDocumentCodec.encodeNumber),
        meta: type,
        context: context
      )

    case .integer(let dynamic, let minV, let maxV, let defVal):
      var lit: OrderedDictionary<String, JSONValue> = ["type": .string("integer")]
      if let minV { lit["minimum"] = .integer(minV) }
      if let maxV { lit["maximum"] = .integer(maxV) }
      return wrapDynamicIfNeeded(
        literal: .object(lit),
        dynamic: dynamic,
        defaultValue: defVal.map(JSONValue.integer),
        meta: type,
        context: context
      )

    case .boolean(let dynamic, let defVal):
      if dynamic {
        return makeRefObject(
          commonRef("DynamicBoolean", context: context),
          defaultValue: defVal.map(JSONValue.boolean),
          meta: type
        )
      }
      var obj: OrderedDictionary<String, JSONValue> = ["type": .string("boolean")]
      appendSchemaMetadata(&obj, defaultValue: defVal.map(JSONValue.boolean), meta: type)
      return .object(obj)

    case .enum(let values, let valueType, let dynamic, let defVal):
      let lit: JSONValue = .object([
        "type": .string(valueType.rawValue),
        "enum": .array(values),
      ])
      return wrapDynamicIfNeeded(
        literal: lit,
        dynamic: dynamic,
        defaultValue: defVal,
        meta: type,
        context: context
      )

    case .const(let value):
      var obj: OrderedDictionary<String, JSONValue> = ["const": value]
      appendSchemaMetadata(&obj, defaultValue: nil, meta: type)
      return .object(obj)

    case .any(let dynamic, let nullable, let defVal):
      if dynamic && !nullable {
        return makeRefObject(
          commonRef("DynamicValue", context: context),
          defaultValue: defVal,
          meta: type
        )
      }
      var obj: OrderedDictionary<String, JSONValue> = [:]
      if !dynamic && !nullable {
        obj["not"] = .object(["type": .string("null")])
      }
      appendSchemaMetadata(&obj, defaultValue: defVal, meta: type)
      return .object(obj)

    case .object(let dynamic, let props, let additional, let atLeastOneOf, let defVal):
      let literal = emitObjectSchema(
        properties: props,
        additionalProperties: additional,
        atLeastOneOf: atLeastOneOf,
        useUnevaluatedForClosed: false,
        description: nil,
        defaultValue: nil,
        context: context,
        referencedDefs: &referencedDefs
      )
      return wrapDynamicIfNeeded(
        literal: literal,
        dynamic: dynamic,
        defaultValue: defVal.map { d in
          var ordered: OrderedDictionary<String, JSONValue> = [:]
          for k in d.keys.sorted() { ordered[k] = d[k] }
          return .object(ordered)
        },
        meta: type,
        context: context
      )

    case .array(let dynamic, let items, let minI, let maxI, let unique, let defVal):
      if dynamic, let items, case .string(false, nil, nil, nil, nil, nil) = items.kind,
        minI == nil, maxI == nil, !unique
      {
        return makeRefObject(
          commonRef("DynamicStringList", context: context),
          defaultValue: defVal.map(JSONValue.array),
          meta: type
        )
      }
      var lit: OrderedDictionary<String, JSONValue> = ["type": .string("array")]
      if let items {
        lit["items"] = typeToJSONSchema(items, context: context, referencedDefs: &referencedDefs)
      }
      if let minI { lit["minItems"] = .integer(minI) }
      if let maxI { lit["maxItems"] = .integer(maxI) }
      if unique { lit["uniqueItems"] = .boolean(true) }
      return wrapDynamicIfNeeded(
        literal: .object(lit),
        dynamic: dynamic,
        defaultValue: defVal.map(JSONValue.array),
        meta: type,
        context: context
      )

    case .union(let variants, let exclusive, let dynamic, let defVal):
      var branches = variants.map {
        typeToJSONSchema($0, context: context, referencedDefs: &referencedDefs)
      }
      if dynamic {
        branches.append(.object(["$ref": .string(commonRef("DataBinding", context: context))]))
        branches.append(.object(["$ref": .string(commonRef("FunctionCall", context: context))]))
      }
      var obj: OrderedDictionary<String, JSONValue> = [
        exclusive ? "oneOf" : "anyOf": .array(branches)
      ]
      appendSchemaMetadata(&obj, defaultValue: defVal, meta: type)
      return .object(obj)

    case .ref(let refName, let defVal):
      if context.inlineLocalTypes, let target = context.localTypes[refName] {
        if context.visitedRefs.contains(refName) {
          referencedDefs.insert(refName)
          return makeRefObject("#/$defs/\(refName)", defaultValue: defVal, meta: type)
        }
        var nextCtx = context
        nextCtx.visitedRefs.insert(refName)
        var inlined = typeToJSONSchema(target, context: nextCtx, referencedDefs: &referencedDefs)
        if var dict = inlined.objectValue {
          appendSchemaMetadata(&dict, defaultValue: defVal, meta: type)
          inlined = .object(dict)
        }
        return inlined
      }
      return makeRefObject("#/$defs/\(refName)", defaultValue: defVal, meta: type)

    case .dataBinding, .functionCall, .child, .childList, .action, .checkRule, .accessibility:
      return makeRefObject(
        commonRef(commonTypeName(for: type.kind, version: context.version), context: context),
        defaultValue: nil,
        meta: type
      )

    case .rawJSONSchema(let raw):
      return raw
    }
  }

  private static func emitStringJSONSchema(
    dynamic: Bool,
    formats: [String]?,
    pattern: String?,
    minLength: Int?,
    maxLength: Int?,
    defaultValue: String?,
    meta: TypeDefinition,
    context: EncodeContext
  ) -> JSONValue {
    let hasFormats = !(formats ?? []).isEmpty
    let hasConstraints = pattern != nil || minLength != nil || maxLength != nil
    if dynamic && !hasFormats && !hasConstraints {
      return makeRefObject(
        commonRef("DynamicString", context: context),
        defaultValue: defaultValue.map(JSONValue.string),
        meta: meta
      )
    }
    if dynamic && hasFormats && !hasConstraints, let formats, formats.count > 1 {
      let thenSchema: JSONValue = .object([
        "oneOf": .array(formats.map { .object(["format": .string($0)]) })
      ])
      var obj: OrderedDictionary<String, JSONValue> = [
        "allOf": .array([
          .object(["$ref": .string(commonRef("DynamicString", context: context))]),
          .object([
            "if": .object(["type": .string("string")]),
            "then": thenSchema,
          ]),
        ])
      ]
      appendSchemaMetadata(&obj, defaultValue: defaultValue.map(JSONValue.string), meta: meta)
      return .object(obj)
    }
    var lit: OrderedDictionary<String, JSONValue> = ["type": .string("string")]
    if let formats, formats.count == 1 {
      lit["format"] = .string(formats[0])
    } else if let formats, formats.count > 1 {
      lit["oneOf"] = .array(formats.map { .object(["format": .string($0)]) })
    }
    if let pattern { lit["pattern"] = .string(pattern) }
    if let minLength { lit["minLength"] = .integer(minLength) }
    if let maxLength { lit["maxLength"] = .integer(maxLength) }
    return wrapDynamicIfNeeded(
      literal: .object(lit),
      dynamic: dynamic,
      defaultValue: defaultValue.map(JSONValue.string),
      meta: meta,
      context: context
    )
  }

  private static func wrapDynamicIfNeeded(
    literal: JSONValue,
    dynamic: Bool,
    defaultValue: JSONValue?,
    meta: TypeDefinition,
    context: EncodeContext
  ) -> JSONValue {
    if !dynamic {
      var obj = literal.objectValue ?? [:]
      appendSchemaMetadata(&obj, defaultValue: defaultValue, meta: meta)
      return .object(obj)
    }
    var obj: OrderedDictionary<String, JSONValue> = [
      "oneOf": .array([
        literal,
        .object(["$ref": .string(commonRef("DataBinding", context: context))]),
        .object(["$ref": .string(commonRef("FunctionCall", context: context))]),
      ])
    ]
    appendSchemaMetadata(&obj, defaultValue: defaultValue, meta: meta)
    return .object(obj)
  }

  private static func attachingDefsIfNeeded(
    _ schema: JSONValue,
    names: Set<String>,
    version: A2UIProtocolVersion,
    localTypes: [String: TypeDefinition],
    useAbsoluteCommonURIs: Bool = true
  ) -> JSONValue {
    guard !names.isEmpty, var rootObj = schema.objectValue else { return schema }
    var reachable: Set<String> = []
    var queue = Array(names)
    while let next = queue.popLast() {
      guard reachable.insert(next).inserted, let target = localTypes[next] else { continue }
      collectLocalRefNames(in: target, into: &queue)
    }
    var subset: [String: TypeDefinition] = [:]
    for name in reachable {
      if let target = localTypes[name] { subset[name] = target }
    }
    let defs = typeDefsJSONSchema(
      subset,
      version: version,
      useAbsoluteCommonURIs: useAbsoluteCommonURIs
    )
    if !defs.isEmpty { rootObj["$defs"] = .object(defs) }
    return .object(rootObj)
  }

  private static func collectLocalRefNames(in type: TypeDefinition, into out: inout [String]) {
    switch type.kind {
    case .ref(let name, _):
      out.append(name)
    case .object(_, let props, let additional, _, _):
      for prop in props { collectLocalRefNames(in: prop.type, into: &out) }
      if let extra = additional.typedSchema { collectLocalRefNames(in: extra, into: &out) }
    case .array(_, let items, _, _, _, _):
      if let items { collectLocalRefNames(in: items, into: &out) }
    case .union(let variants, _, _, _):
      for variant in variants { collectLocalRefNames(in: variant, into: &out) }
    default:
      break
    }
  }

  /// Applies one or more `atLeastOneOf` groups cleanly (`anyOf` for 1 group, `allOf` of `anyOf`
  /// for multiple groups so `(a OR b) AND (c OR d)` preserves conjunctive semantics).
  private static func applyAtLeastOneOf(
    _ groups: [[String]],
    to obj: inout OrderedDictionary<String, JSONValue>
  ) {
    guard !groups.isEmpty else { return }
    if groups.count == 1, obj["anyOf"] == nil {
      obj["anyOf"] = .array(groups[0].map { .object(["required": .array([.string($0)])]) })
      return
    }
    let allOfEntries: [JSONValue] = groups.map { group in
      .object(["anyOf": .array(group.map { .object(["required": .array([.string($0)])]) })])
    }
    var existing = obj["allOf"]?.arrayValue ?? []
    existing.append(contentsOf: allOfEntries)
    obj["allOf"] = .array(existing)
  }

  private static func makeRefObject(
    _ ref: String,
    defaultValue: JSONValue?,
    meta: TypeDefinition
  ) -> JSONValue {
    var obj: OrderedDictionary<String, JSONValue> = ["$ref": .string(ref)]
    appendSchemaMetadata(&obj, defaultValue: defaultValue, meta: meta)
    return .object(obj)
  }

  private static func appendSchemaMetadata(
    _ obj: inout OrderedDictionary<String, JSONValue>,
    defaultValue: JSONValue?,
    meta: TypeDefinition
  ) {
    if let desc = meta.description { obj["description"] = .string(desc) }
    if let defaultValue { obj["default"] = defaultValue }
    if meta.deprecated { obj["deprecated"] = .boolean(true) }
    if let reason = meta.deprecatedReason { obj["x-deprecated-reason"] = .string(reason) }
  }

  private static func commonTypeName(
    for kind: TypeDefinition.Kind,
    version: A2UIProtocolVersion
  ) -> String {
    switch kind {
    case .dataBinding: return "DataBinding"
    case .functionCall: return "FunctionCall"
    case .child: return version.isAtLeastV10 ? "Child" : "ComponentId"
    case .childList: return "ChildList"
    case .action: return "Action"
    case .checkRule: return "CheckRule"
    case .accessibility: return "AccessibilityAttributes"
    default: return "DynamicValue"
    }
  }

  private static func commonRef(_ name: String, context: EncodeContext) -> String {
    if context.useAbsoluteCommonURIs {
      return context.version.isAtLeastV10
        ? A2UICommonSchema.v10URI(for: name)
        : A2UICommonSchema.uri(for: name)
    }
    return "common_types.json#/$defs/\(name)"
  }

  private static func makeCatalogUnion(
    names: [String],
    section: String,
    discriminator: String? = nil
  ) -> JSONValue {
    guard !names.isEmpty else { return .object(["not": .object([:])]) }
    let refs: [JSONValue] = names.map { name in
      let token =
        name.replacingOccurrences(of: "~", with: "~0").replacingOccurrences(of: "/", with: "~1")
      return .object(["$ref": .string("#/\(section)/\(token)")])
    }
    var union: OrderedDictionary<String, JSONValue> = ["oneOf": .array(refs)]
    if let discriminator {
      union["discriminator"] = .object(["propertyName": .string(discriminator)])
    }
    return .object(union)
  }

  // MARK: - Private Validation & Pattern Helpers

  private static func inferProtocolVersion(
    from root: OrderedDictionary<String, JSONValue>
  ) -> String {
    if let id = root["$id"]?.stringValue ?? root["catalogId"]?.stringValue {
      if id.contains("/v1_0/") { return "1.0" }
      if id.contains("/v0_9_1/") { return "0.9.1" }
      if id.contains("/v0_9/") { return "0.9" }
    }
    return "0.9"
  }

  private static func isAtLeastV10(_ version: String) -> Bool {
    if let parsed = A2UIProtocolVersion(lenientRawValue: version) {
      return parsed.isAtLeastV10
    }
    return CatalogDocumentCodec.normalizeProtocolVersion(version)
      .compare("1.0", options: .numeric) != .orderedAscending
  }

  private static func validateV10Identifiers(
    _ root: OrderedDictionary<String, JSONValue>
  ) throws {
    if let comps = root["components"]?.objectValue {
      for (name, def) in comps {
        guard name != "Surface" else {
          throw A2UICatalogError("Invalid UAX #31 component identifier: 'Surface' is reserved")
        }
        guard UnicodeIdentifierValidator.isValidIdentifier(name) else {
          throw A2UICatalogError("Invalid UAX #31 component identifier: '\(name)'")
        }
        try validateV10PropertyIdentifiers(in: def, componentName: name)
      }
    }
    if let funcs = root["functions"]?.objectValue {
      for (name, def) in funcs {
        guard !name.hasPrefix("@"), UnicodeIdentifierValidator.isValidIdentifier(name) else {
          throw A2UICatalogError("Invalid UAX #31 function identifier: '\(name)'")
        }
        let params =
          def["parameters"]?.objectValue ?? def["properties"]?["args"]?["properties"]?.objectValue
        if let params {
          for argName in params.keys where !UnicodeIdentifierValidator.isValidIdentifier(argName) {
            throw A2UICatalogError(
              "Invalid UAX #31 argument identifier '\(argName)' in function '\(name)'"
            )
          }
        }
      }
    }
  }

  private static func validateV10PropertyIdentifiers(
    in schema: JSONValue,
    componentName: String
  ) throws {
    if let props = schema["properties"]?.objectValue {
      for propName in props.keys where !UnicodeIdentifierValidator.isValidIdentifier(propName) {
        throw A2UICatalogError(
          "Invalid UAX #31 property identifier '\(propName)' in component '\(componentName)'"
        )
      }
    }
    if let allOf = schema["allOf"]?.arrayValue {
      for branch in allOf {
        try validateV10PropertyIdentifiers(in: branch, componentName: componentName)
      }
    }
  }

  private static func checkV10ExternalRefs(_ node: JSONValue, pointer: String = "") throws {
    if let obj = node.objectValue {
      if let ref = obj["$ref"]?.stringValue, !isSupportedV10Ref(ref) {
        throw A2UICatalogError(
          "Unsupported external $ref '\(ref)' at \(pointer)/$ref: a v1.0 catalog may only "
            + "reference its own components and functions (#/...) or common_types.json."
        )
      }
      for (key, value) in obj {
        let escaped =
          key.replacingOccurrences(of: "~", with: "~0").replacingOccurrences(of: "/", with: "~1")
        try checkV10ExternalRefs(value, pointer: "\(pointer)/\(escaped)")
      }
    } else if let arr = node.arrayValue {
      for (idx, item) in arr.enumerated() {
        try checkV10ExternalRefs(item, pointer: "\(pointer)/\(idx)")
      }
    }
  }

  private static func isSupportedV10Ref(_ ref: String) -> Bool {
    let document =
      ref.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(
        String.init)
      ?? ""
    if document.isEmpty || document == "catalog.json" { return true }
    return document.split(separator: "/", omittingEmptySubsequences: false).last
      == "common_types.json"
  }

  private static func extractUnionAllowedNames(in unionDef: JSONValue?, prefix: String) -> Set<
    String
  >? {
    guard let unionDef else { return nil }
    if let oneOf = unionDef["oneOf"]?.arrayValue {
      let names = oneOf.compactMap { item -> String? in
        guard let ref = item["$ref"]?.stringValue, ref.hasPrefix(prefix) else { return nil }
        return String(ref.dropFirst(prefix.count))
      }
      return names.isEmpty ? nil : Set(names)
    }
    if let notObj = unionDef["not"]?.objectValue, notObj.isEmpty {
      return []
    }
    return nil
  }

  private static func extractFunctionArgsSchema(from funcValue: JSONValue) -> JSONValue {
    if let argsSchema = funcValue["properties"]?["args"], argsSchema.objectValue != nil {
      return argsSchema
    }
    if let paramsObj = funcValue["parameters"]?.objectValue {
      if paramsObj["type"]?.stringValue == "object" || paramsObj["properties"] != nil {
        return .object(paramsObj)
      }
      return .object(["type": .string("object"), "properties": .object(paramsObj)])
    }
    return .object(["type": .string("object")])
  }

  private static func extractRequiredGroup(from anyOf: [JSONValue]) -> [String]? {
    guard anyOf.count >= 2 else { return nil }
    var names: [String] = []
    for branch in anyOf {
      guard let obj = branch.objectValue,
        obj.keys.allSatisfy({ $0 == "required" || metadataOnlyKeys.contains($0) }),
        let req = obj["required"]?.arrayValue, req.count == 1,
        let name = req[0].stringValue
      else {
        return nil
      }
      names.append(name)
    }
    return names.isEmpty ? nil : names
  }

  private static func extractFormatOnlyBranches(_ branches: [JSONValue]) -> [String]? {
    guard !branches.isEmpty else { return nil }
    var formats: [String] = []
    for branch in branches {
      guard let obj = branch.objectValue,
        let fmt = obj["format"]?.stringValue,
        obj.keys.allSatisfy({ $0 == "format" || $0 == "type" || metadataOnlyKeys.contains($0) }),
        obj["type"] == nil || obj["type"]?.stringValue == "string"
      else {
        return nil
      }
      formats.append(fmt)
    }
    return formats
  }

  private static func isCheckRuleListSchema(_ schema: JSONValue) -> Bool {
    guard let items = schema["items"] else { return false }
    return refSuffix(of: items) == "CheckRule"
  }

  private static func refSuffix(of schema: JSONValue) -> String? {
    schema["$ref"]?.stringValue?.split(separator: "/").last.map(String.init)
  }

  private static func isDataBindingBranch(_ branch: JSONValue) -> Bool {
    refSuffix(of: branch) == "DataBinding"
  }

  private static func isFunctionCallBranch(_ branch: JSONValue) -> Bool {
    if refSuffix(of: branch) == "FunctionCall" { return true }
    if let ref = branch["$ref"]?.stringValue, ref.hasSuffix("/anyFunction") { return true }
    if let props = branch["properties"]?.objectValue,
      props["@call"] != nil || props["call"] != nil
    {
      return true
    }
    return false
  }

  private static func isJSONScalar(_ value: JSONValue) -> Bool {
    switch value {
    case .string, .integer, .boolean, .null: return true
    case .number(let n): return n.isFinite
    case .array, .object: return false
    }
  }

  private static func homogeneousEnumValueType(
    _ values: [JSONValue],
    declaredType: String?
  ) -> EnumValueType? {
    let inferred: EnumValueType?
    if let declaredType {
      inferred = EnumValueType(rawValue: declaredType)
    } else if values.first?.stringValue != nil {
      inferred = .string
    } else if values.first?.doubleValue != nil {
      inferred = .number
    } else if values.first?.boolValue != nil {
      inferred = .boolean
    } else {
      inferred = nil
    }
    guard let vt = inferred else { return nil }
    let allMatch = values.allSatisfy { val in
      switch vt {
      case .string: return val.stringValue != nil
      case .number: return val.doubleValue.map(\.isFinite) ?? false
      case .boolean: return val.boolValue != nil
      }
    }
    return allMatch ? vt : nil
  }

  private static func simplePrimitiveType(named name: String) -> TypeDefinition? {
    switch name {
    case "string": return .string()
    case "number": return .number()
    case "integer": return .integer()
    case "boolean": return .boolean()
    case "array": return .array()
    case "object": return .object(additionalProperties: .allowed)
    default: return nil
    }
  }

  private static func resolveLocalPointer(_ ref: String, in root: JSONValue) -> JSONValue? {
    guard ref == "#" || ref.hasPrefix("#/") else { return nil }
    var current = root
    for rawToken in ref.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
      .dropFirst()
    {
      let token =
        rawToken.replacingOccurrences(of: "~1", with: "/").replacingOccurrences(of: "~0", with: "~")
      if let next = current.objectValue?[token] {
        current = next
      } else if let items = current.arrayValue, let index = Int(token),
        items.indices.contains(index)
      {
        current = items[index]
      } else {
        return nil
      }
    }
    return current
  }
}
