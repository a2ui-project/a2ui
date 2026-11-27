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
    "patternProperties",
    "not",
    "if",
    "then",
    "else",
    "dependentRequired",
    "dependentSchemas",
    "propertyNames",
    "minProperties",
    "maxProperties",
    "oneOf",
  ]

  private static let untranslatableValueKeywords: Set<String> = [
    "patternProperties",
    "not",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "propertyNames",
    "dependentRequired",
    "dependentSchemas",
    "prefixItems",
    "contains",
    "minContains",
    "maxContains",
  ]

  private static let metadataOnlyKeys: Set<String> = [
    "title",
    "description",
    "default",
    "deprecated",
    "examples",
    "$comment",
  ]

  // MARK: - Catalog JSON Schema -> CatalogModel

  /// Parses a legacy JSON Schema catalog document (v0.9, v0.9.1, or v1.0) into a ``CatalogModel``.
  ///
  /// - Parameters:
  ///   - rawSchema: Raw catalog JSON Schema object.
  ///   - catalogID: Optional explicit catalog ID override.
  ///   - protocolVersion: Optional explicit protocol version override.
  /// - Returns: Canonical ``CatalogModel``.
  /// - Throws: ``A2UICatalogError`` when the catalog schema is malformed or violates v1.0 rules.
  public static func fromJSONSchema(
    _ rawSchema: JSONValue,
    catalogID: String? = nil,
    protocolVersion: String? = nil
  ) throws -> CatalogModel {
    guard let root = rawSchema.objectValue else {
      throw A2UICatalogError("Catalog JSON Schema must be an object.")
    }
    let resolvedID =
      catalogID
      ?? root["catalogId"]?.stringValue
      ?? root["id"]?.stringValue
    guard let resolvedID, !resolvedID.isEmpty else {
      throw A2UICatalogError("Catalog schema is missing a non-empty 'catalogId'.")
    }

    let resolvedVersion =
      protocolVersion
      ?? root["protocolVersion"]?.stringValue
      ?? root["protocol_version"]?.stringValue
      ?? inferProtocolVersion(from: root)
    let isV10 = isAtLeastV10(resolvedVersion)

    if isV10 {
      try validateV10Identifiers(root)
      try checkV10ExternalRefs(rawSchema)
    }

    let rawDefs = root["$defs"]?.objectValue ?? [:]
    var types: [String: TypeDefinition] = [:]
    let excludedDefKeys: Set<String> = [
      "anyComponent", "anyFunction", "theme", "CatalogComponentCommon", "ComponentCommon",
    ]
    let knownTypeNames = Set(
      rawDefs.keys.filter {
        !excludedDefKeys.contains($0) && UnicodeIdentifierValidator.isValidIdentifier($0)
      }
    )
    for (defName, defSchema) in rawDefs where knownTypeNames.contains(defName) {
      let translated = translateType(
        defSchema,
        localDefs: rawDefs,
        knownTypeNames: knownTypeNames.subtracting([defName]),
        visitedRefs: ["#/$defs/\(defName)"]
      )
      if translated.isDataType && !translated.containsRawJSONSchema {
        types[defName] = translated
      }
    }
    let finalTypeNames = Set(types.keys)

    let allowedComponentNames = extractUnionAllowedNames(
      in: rawDefs["anyComponent"],
      prefix: "#/components/"
    )
    let allowedFunctionNames = extractUnionAllowedNames(
      in: rawDefs["anyFunction"],
      prefix: "#/functions/"
    )

    var components: [ComponentDefinition] = []
    if let compsObj = root["components"]?.objectValue {
      for (name, compSchema) in compsObj {
        if let allowedComponentNames, !allowedComponentNames.contains(name) {
          continue
        }
        let parents = compSchema["allowedParents"]?.arrayValue?.compactMap(\.stringValue)
        let children = compSchema["allowedChildren"]?.arrayValue?.compactMap(\.stringValue)
        let meta = try validateOptionalMetadata(
          compSchema["metadata"],
          pathPrefix: "components.\(name).metadata"
        )
        let compDef = componentDefinition(
          from: name,
          schema: compSchema,
          localDefs: rawDefs,
          knownTypeNames: finalTypeNames,
          allowedParents: parents,
          allowedChildren: children,
          metadata: meta
        )
        components.append(compDef)
      }
    }

    let allDeclaredFunctions = try parseFunctions(
      from: root["functions"],
      localDefs: rawDefs,
      knownTypeNames: finalTypeNames
    )
    if isV10 {
      for fn in allDeclaredFunctions {
        try fn.validateCallerConstraints()
      }
    }
    let functions: [FunctionDefinition]
    if let allowedFunctionNames {
      functions = allDeclaredFunctions.filter { allowedFunctionNames.contains($0.name) }
    } else {
      functions = allDeclaredFunctions
    }

    let rawTheme = root["theme"] ?? rawDefs["theme"]
    let surfaceProperties = rawTheme.map {
      surfacePropertiesDefinition(
        from: $0,
        localDefs: rawDefs,
        knownTypeNames: finalTypeNames
      )
    }

    let metadata = try validateOptionalMetadata(root["metadata"], pathPrefix: "metadata")

    return CatalogModel(
      formatVersion: CatalogDocumentCodec.supportedFormatVersion,
      catalogID: resolvedID,
      protocolVersion: resolvedVersion,
      title: root["title"]?.stringValue,
      description: root["description"]?.stringValue,
      instructions: root["instructions"]?.stringValue,
      metadata: metadata,
      types: types,
      surfaceProperties: surfaceProperties,
      components: components,
      functions: functions
    )
  }

  // MARK: - Component / Function / SurfaceProperties JSON Schema -> Model

  /// Translates a single component JSON Schema into a canonical ``ComponentDefinition``.
  public static func componentDefinition(
    from name: String,
    schema: JSONValue,
    localDefs: OrderedDictionary<String, JSONValue> = [:],
    knownTypeNames: Set<String> = [],
    allowedParents: [String]? = nil,
    allowedChildren: [String]? = nil,
    metadata: [String: JSONValue]? = nil
  ) -> ComponentDefinition {
    var mergedDefs = localDefs
    if let schemaDefs = schema["$defs"]?.objectValue {
      for (k, v) in schemaDefs where mergedDefs[k] == nil {
        mergedDefs[k] = v
      }
    }

    var state = ComponentExtractionState()
    extractComponentSchema(
      schema,
      root: schema,
      localDefs: mergedDefs,
      knownTypeNames: knownTypeNames,
      visitedRefs: [],
      into: &state
    )

    let parameters = buildComponentParameters(
      from: &state,
      localDefs: mergedDefs,
      knownTypeNames: knownTypeNames
    )
    let resolvedParents =
      allowedParents ?? schema["allowedParents"]?.arrayValue?.compactMap(\.stringValue)
    let resolvedChildren =
      allowedChildren ?? schema["allowedChildren"]?.arrayValue?.compactMap(\.stringValue)
    let resolvedMetadata = metadata ?? schema["metadata"]?.dictionaryValue
    let description = schema["description"]?.stringValue ?? state.description
    let deprecated = schema["deprecated"]?.boolValue ?? false

    return ComponentDefinition(
      name: name,
      description: description,
      isCheckable: state.isCheckable,
      parameters: parameters,
      atLeastOneOf: state.atLeastOneOf,
      allowedParents: resolvedParents,
      allowedChildren: resolvedChildren,
      metadata: resolvedMetadata,
      deprecated: deprecated,
      deprecatedReason: nil,
      rawJSONSchema: state.hasUntranslatableRoot ? schema : nil,
      allowsAdditionalProperties: state.allowsAdditionalProperties
    )
  }

  /// Translates a function argument JSON Schema into a canonical ``FunctionDefinition``.
  public static func functionDefinition(
    from name: String,
    returnType: FunctionReturnType,
    argsSchema: JSONValue,
    description: String? = nil,
    allowedCallers: AllowedCallers = .rendererOnly,
    requiresUserActivation: Bool = false,
    localDefs: OrderedDictionary<String, JSONValue> = [:],
    knownTypeNames: Set<String> = []
  ) -> FunctionDefinition {
    let returnDef = FunctionReturnDefinition(returnType: returnType)
    return functionDefinition(
      from: name,
      returnDefinition: returnDef,
      argsSchema: argsSchema,
      description: description,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      localDefs: localDefs,
      knownTypeNames: knownTypeNames
    )
  }

  /// Translates a theme JSON Schema into a canonical ``SurfacePropertiesDefinition``.
  public static func surfacePropertiesDefinition(
    from themeSchema: JSONValue,
    localDefs: OrderedDictionary<String, JSONValue> = [:],
    knownTypeNames: Set<String> = []
  ) -> SurfacePropertiesDefinition {
    guard let obj = themeSchema.objectValue else {
      return SurfacePropertiesDefinition(rawJSONSchema: themeSchema)
    }
    let hasObjectWrapper =
      obj["type"]?.stringValue == "object"
      || obj["properties"]?.objectValue != nil
      || obj["additionalProperties"] != nil
      || obj["unevaluatedProperties"] != nil
    let propsObj: OrderedDictionary<String, JSONValue>
    if hasObjectWrapper {
      if obj.keys.contains(where: { untranslatableObjectKeywords.contains($0) }) {
        return SurfacePropertiesDefinition(
          description: obj["description"]?.stringValue,
          rawJSONSchema: themeSchema
        )
      }
      propsObj = obj["properties"]?.objectValue ?? [:]
    } else {
      propsObj = obj
    }
    let requiredSet = Set(obj["required"]?.arrayValue?.compactMap(\.stringValue) ?? [])
    let params = propsObj.map { propName, propSchema -> ParameterDefinition in
      let translated = translateType(
        propSchema,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: []
      )
      return ParameterDefinition(
        name: propName,
        type: translated.strippingParameterMetadata(),
        required: requiredSet.contains(propName),
        description: translated.description,
        deprecated: translated.isDeprecated,
        deprecatedReason: translated.deprecatedReason
      )
    }
    let additional = translateAdditionalProperties(
      object: obj,
      localDefs: localDefs,
      knownTypeNames: knownTypeNames,
      visitedRefs: []
    )
    return SurfacePropertiesDefinition(
      description: hasObjectWrapper ? obj["description"]?.stringValue : nil,
      properties: params,
      additionalProperties: additional,
      rawJSONSchema: nil
    )
  }

  // MARK: - CatalogModel -> JSON Schema

  /// Serializes a ``CatalogModel`` to a JSON Schema catalog document for `protocolVersion`.
  public static func toJSONSchema(
    _ model: CatalogModel,
    protocolVersion: A2UIProtocolVersion = .v10,
    componentEnvelopeRef: String? = nil
  ) -> JSONValue {
    let envelopeRef = componentEnvelopeRef ?? "common_types.json#/$defs/ComponentCommon"
    var root: OrderedDictionary<String, JSONValue> = [:]

    if protocolVersion.isAtLeastV10 {
      let semver =
        protocolVersion.rawValue.hasPrefix("v")
        ? String(protocolVersion.rawValue.dropFirst())
        : protocolVersion.rawValue
      root["protocolVersion"] = .string(semver)
    }
    root["catalogId"] = .string(model.catalogID)
    if let title = model.title {
      root["title"] = .string(title)
    }
    if let description = model.description {
      root["description"] = .string(description)
    }
    if protocolVersion.isAtLeastV10, let instructions = model.instructions {
      root["instructions"] = .string(instructions)
    }
    if protocolVersion.isAtLeastV10, let metadata = model.metadata, !metadata.isEmpty {
      var orderedMeta: OrderedDictionary<String, JSONValue> = [:]
      for key in metadata.keys.sorted() {
        orderedMeta[key] = metadata[key]
      }
      root["metadata"] = .object(orderedMeta)
    }

    var componentsDict: OrderedDictionary<String, JSONValue> = [:]
    for comp in model.components {
      componentsDict[comp.name] = inlineComponentJSONSchema(
        comp,
        version: protocolVersion,
        envelopeRef: envelopeRef,
        localTypes: model.types,
        useAbsoluteCommonURIs: false,
        inlineLocalTypes: false
      )
    }
    if !componentsDict.isEmpty {
      root["components"] = .object(componentsDict)
    }

    let userFunctions = model.functions.filter { !$0.name.hasPrefix("@") }
    var v10FunctionNames: [String] = []
    if protocolVersion.isAtLeastV10 {
      if !userFunctions.isEmpty {
        var functionsDict: OrderedDictionary<String, JSONValue> = [:]
        for fn in userFunctions {
          functionsDict[fn.name] = inlineV10FunctionJSONSchema(
            fn,
            localTypes: model.types,
            useAbsoluteCommonURIs: false,
            inlineLocalTypes: false
          )
          v10FunctionNames.append(fn.name)
        }
        root["functions"] = .object(functionsDict)
      }
    } else if !userFunctions.isEmpty {
      root["functions"] = .array(
        userFunctions.map {
          inlineV09FunctionJSONSchema(
            $0,
            localTypes: model.types,
            useAbsoluteCommonURIs: false,
            inlineLocalTypes: false
          )
        }
      )
    }

    if !protocolVersion.isAtLeastV10, let surfaceProperties = model.surfaceProperties {
      let themeObj = surfacePropertiesJSONSchema(
        surfaceProperties,
        version: protocolVersion,
        localTypes: model.types,
        useAbsoluteCommonURIs: false,
        inlineLocalTypes: true
      )
      root["theme"] = themeObj["properties"] ?? themeObj
    }

    if protocolVersion.isAtLeastV10 {
      var defs: OrderedDictionary<String, JSONValue> = [
        "anyComponent": makeCatalogUnion(
          names: Array(componentsDict.keys),
          section: "components",
          discriminator: "component"
        ),
        "anyFunction": makeCatalogUnion(names: v10FunctionNames, section: "functions"),
      ]
      for name in model.types.keys.sorted() {
        guard let typeDef = model.types[name] else { continue }
        defs[name] = typeToJSONSchema(
          typeDef,
          version: protocolVersion,
          localTypes: model.types,
          useAbsoluteCommonURIs: false,
          inlineLocalTypes: false
        )
      }
      root["$defs"] = .object(defs)
    } else if !model.types.isEmpty {
      var defs: OrderedDictionary<String, JSONValue> = [:]
      for name in model.types.keys.sorted() {
        guard let typeDef = model.types[name] else { continue }
        defs[name] = typeToJSONSchema(
          typeDef,
          version: protocolVersion,
          localTypes: model.types,
          useAbsoluteCommonURIs: false,
          inlineLocalTypes: false
        )
      }
      root["$defs"] = .object(defs)
    }

    return .object(root)
  }

  /// Generates an inline JSON Schema object for a single component definition.
  public static func inlineComponentJSONSchema(
    _ definition: ComponentDefinition,
    version: A2UIProtocolVersion,
    envelopeRef: String = "common_types.json#/$defs/ComponentCommon",
    localTypes: [String: TypeDefinition] = [:],
    useAbsoluteCommonURIs: Bool = false,
    inlineLocalTypes: Bool = true
  ) -> JSONValue {
    if let raw = definition.rawJSONSchema {
      return raw
    }

    var properties: OrderedDictionary<String, JSONValue> = [
      "component": .object(["const": .string(definition.name)])
    ]
    var required: [JSONValue] = [.string("component")]

    for param in definition.parameters {
      properties[param.name] = parameterToJSONSchema(
        param,
        version: version,
        localTypes: localTypes,
        useAbsoluteCommonURIs: useAbsoluteCommonURIs,
        inlineLocalTypes: inlineLocalTypes
      )
      if param.required {
        required.append(.string(param.name))
      }
    }

    if version.isAtLeastV10 {
      var coreObj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
      if let description = definition.description, !definition.isCheckable {
        coreObj["description"] = .string(description)
      }
      coreObj["properties"] = .object(properties)
      coreObj["required"] = .array(required)
      if !definition.atLeastOneOf.isEmpty {
        coreObj["anyOf"] = encodeAtLeastOneOfJSONSchema(definition.atLeastOneOf)
      }

      var result: OrderedDictionary<String, JSONValue>
      if definition.isCheckable {
        result = ["type": .string("object")]
        if let description = definition.description {
          result["description"] = .string(description)
        }
        result["allOf"] = .array([
          .object([
            "$ref": .string(
              commonRef("Checkable", version: version, absolute: useAbsoluteCommonURIs))
          ]),
          .object(coreObj),
        ])
      } else {
        result = coreObj
      }

      if let allowedParents = definition.allowedParents {
        result["allowedParents"] = .array(allowedParents.map { .string($0) })
      }
      if let allowedChildren = definition.allowedChildren {
        result["allowedChildren"] = .array(allowedChildren.map { .string($0) })
      }
      if let metadata = definition.metadata {
        var orderedMeta: OrderedDictionary<String, JSONValue> = [:]
        for key in metadata.keys.sorted() {
          orderedMeta[key] = metadata[key]
        }
        result["metadata"] = .object(orderedMeta)
      }
      if definition.deprecated {
        result["deprecated"] = .boolean(true)
      }
      return .object(result)
    }

    var allOfBranches: [JSONValue] = [
      .object(["$ref": .string(envelopeRef)])
    ]
    if definition.isCheckable {
      allOfBranches.append(
        .object([
          "$ref": .string(commonRef("Checkable", version: version, absolute: useAbsoluteCommonURIs))
        ])
      )
    }
    var innerObj: OrderedDictionary<String, JSONValue> = [
      "properties": .object(properties),
      "required": .array(required),
    ]
    if let description = definition.description {
      innerObj["description"] = .string(description)
    }
    if !definition.atLeastOneOf.isEmpty {
      innerObj["anyOf"] = encodeAtLeastOneOfJSONSchema(definition.atLeastOneOf)
    }
    allOfBranches.append(.object(innerObj))
    return .object(["allOf": .array(allOfBranches)])
  }

  /// Generates a v1.0 inline JSON Schema definition for a catalog function.
  public static func inlineV10FunctionJSONSchema(
    _ definition: FunctionDefinition,
    localTypes: [String: TypeDefinition] = [:],
    useAbsoluteCommonURIs: Bool = false,
    inlineLocalTypes: Bool = true
  ) -> JSONValue {
    var argsDict =
      functionArgsJSONSchema(
        definition,
        version: .v10,
        localTypes: localTypes,
        useAbsoluteCommonURIs: useAbsoluteCommonURIs,
        inlineLocalTypes: inlineLocalTypes
      ).objectValue ?? ["type": .string("object")]
    _ = argsDict.removeValue(forKey: "description")
    if argsDict["type"] == nil {
      argsDict["type"] = .string("object")
    }
    if argsDict["additionalProperties"] == nil && argsDict["unevaluatedProperties"] == nil {
      argsDict["unevaluatedProperties"] = .boolean(false)
    }

    var fnObj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
    if let description = definition.description {
      fnObj["description"] = .string(description)
    }
    fnObj["returnType"] = .string(definition.returnType.functionReturnType.rawValue)
    fnObj["allowedCallers"] = .string(definition.allowedCallers.rawValue)
    fnObj["requiresUserActivation"] = .boolean(definition.requiresUserActivation)
    fnObj["properties"] = .object([
      "@call": .object(["const": .string(definition.name)]),
      "args": .object(argsDict),
    ])
    let requiredArgs = argsDict["required"]?.arrayValue ?? []
    var requiredFields: [JSONValue] = [.string("@call")]
    if !requiredArgs.isEmpty || !definition.atLeastOneOf.isEmpty {
      requiredFields.append(.string("args"))
    }
    fnObj["required"] = .array(requiredFields)
    return .object(fnObj)
  }

  /// Generates a v0.9 inline JSON Schema entry for a catalog function.
  public static func inlineV09FunctionJSONSchema(
    _ definition: FunctionDefinition,
    localTypes: [String: TypeDefinition] = [:],
    useAbsoluteCommonURIs: Bool = false,
    inlineLocalTypes: Bool = true
  ) -> JSONValue {
    let paramsSchema = functionArgsJSONSchema(
      definition,
      version: .v091,
      localTypes: localTypes,
      useAbsoluteCommonURIs: useAbsoluteCommonURIs,
      inlineLocalTypes: inlineLocalTypes
    )
    var fnObj: OrderedDictionary<String, JSONValue> = [
      "name": .string(definition.name),
      "returnType": .string(definition.returnType.functionReturnType.rawValue),
    ]
    if let description = definition.description {
      fnObj["description"] = .string(description)
    }
    fnObj["parameters"] = paramsSchema
    return .object(fnObj)
  }

  /// Generates a standalone argument-object JSON Schema for a ``FunctionDefinition``.
  public static func functionArgsJSONSchema(
    _ definition: FunctionDefinition,
    version: A2UIProtocolVersion = .v10,
    localTypes: [String: TypeDefinition] = [:],
    useAbsoluteCommonURIs: Bool = true,
    inlineLocalTypes: Bool = true
  ) -> JSONValue {
    if let raw = definition.rawJSONSchema {
      return raw
    }
    var obj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
    if let description = definition.description {
      obj["description"] = .string(description)
    }
    var properties: OrderedDictionary<String, JSONValue> = [:]
    var required: [JSONValue] = []
    for param in definition.parameters {
      properties[param.name] = parameterToJSONSchema(
        param,
        version: version,
        localTypes: localTypes,
        useAbsoluteCommonURIs: useAbsoluteCommonURIs,
        inlineLocalTypes: inlineLocalTypes
      )
      if param.required {
        required.append(.string(param.name))
      }
    }
    obj["properties"] = .object(properties)
    if !required.isEmpty {
      obj["required"] = .array(required)
    }
    if !definition.atLeastOneOf.isEmpty {
      obj["anyOf"] = encodeAtLeastOneOfJSONSchema(definition.atLeastOneOf)
    }
    switch definition.additionalParameters {
    case .disallowed:
      obj["additionalProperties"] = .boolean(false)
    case .allowed:
      obj["additionalProperties"] = .boolean(true)
    case .typed(let extraType):
      obj["additionalProperties"] = typeToJSONSchema(
        extraType,
        version: version,
        localTypes: localTypes,
        useAbsoluteCommonURIs: useAbsoluteCommonURIs,
        inlineLocalTypes: inlineLocalTypes
      )
    }
    return .object(obj)
  }

  /// Generates a JSON Schema object for ``SurfacePropertiesDefinition``.
  public static func surfacePropertiesJSONSchema(
    _ definition: SurfacePropertiesDefinition,
    version: A2UIProtocolVersion = .v091,
    localTypes: [String: TypeDefinition] = [:],
    useAbsoluteCommonURIs: Bool = true,
    inlineLocalTypes: Bool = true
  ) -> JSONValue {
    if let raw = definition.rawJSONSchema {
      return raw
    }
    var obj: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
    if let description = definition.description {
      obj["description"] = .string(description)
    }
    var properties: OrderedDictionary<String, JSONValue> = [:]
    var required: [JSONValue] = []
    for prop in definition.properties {
      properties[prop.name] = parameterToJSONSchema(
        prop,
        version: version,
        localTypes: localTypes,
        useAbsoluteCommonURIs: useAbsoluteCommonURIs,
        inlineLocalTypes: inlineLocalTypes
      )
      if prop.required {
        required.append(.string(prop.name))
      }
    }
    obj["properties"] = .object(properties)
    if !required.isEmpty {
      obj["required"] = .array(required)
    }
    switch definition.additionalProperties {
    case .disallowed:
      obj["additionalProperties"] = .boolean(false)
    case .allowed:
      obj["additionalProperties"] = .boolean(true)
    case .typed(let extraType):
      obj["additionalProperties"] = typeToJSONSchema(
        extraType,
        version: version,
        localTypes: localTypes,
        useAbsoluteCommonURIs: useAbsoluteCommonURIs,
        inlineLocalTypes: inlineLocalTypes
      )
    }
    return .object(obj)
  }

  // MARK: - Compiled JSONSchema.Schema Bridges

  /// Compiles a ``ComponentDefinition`` into a `JSONSchema.Schema` for backward-compatible callers
  /// reading `ComponentAPI.schema`.
  public static func compileComponentSchema(
    _ definition: ComponentDefinition,
    protocolVersion: A2UIProtocolVersion = .v10,
    localTypes: [String: TypeDefinition] = [:]
  ) throws -> Schema {
    if let raw = definition.rawJSONSchema {
      return try Schema(rawSchema: raw, context: A2UISchemaRegistry.makeContext())
    }
    var raw =
      inlineComponentJSONSchema(
        definition,
        version: protocolVersion,
        envelopeRef: commonRef("ComponentCommon", version: protocolVersion, absolute: true),
        localTypes: localTypes,
        useAbsoluteCommonURIs: true,
        inlineLocalTypes: true
      ).objectValue ?? ["type": .string("object")]
    if protocolVersion.isAtLeastV10 {
      let envelopeRef = JSONValue.object([
        "$ref": .string(A2UICommonSchema.v10URI(for: "ComponentCommon"))
      ])
      if var allOf = raw["allOf"]?.arrayValue {
        allOf.insert(envelopeRef, at: 0)
        raw["allOf"] = .array(allOf)
      } else {
        let inner = JSONValue.object(raw)
        raw = [
          "type": .string("object"),
          "allOf": .array([envelopeRef, inner]),
        ]
      }
    }
    if !definition.allowsAdditionalProperties {
      raw["unevaluatedProperties"] = .boolean(false)
    }
    return try Schema(rawSchema: .object(raw), context: A2UISchemaRegistry.makeContext())
  }

  /// Compiles a ``ComponentDefinition`` into a `JSONSchema.Schema`, falling back to an empty object
  /// schema only if compilation fails unexpectedly.
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

  /// Compiles a ``FunctionDefinition`` into a `JSONSchema.Schema` for `FunctionAPI.schema`.
  public static func compileFunctionArgsSchema(
    _ definition: FunctionDefinition,
    protocolVersion: A2UIProtocolVersion = .v10,
    localTypes: [String: TypeDefinition] = [:]
  ) throws -> Schema {
    let raw = functionArgsJSONSchema(
      definition,
      version: protocolVersion,
      localTypes: localTypes,
      useAbsoluteCommonURIs: true,
      inlineLocalTypes: true
    )
    return try Schema(rawSchema: raw, context: A2UISchemaRegistry.makeContext())
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

  /// Compiles a ``SurfacePropertiesDefinition`` into a `JSONSchema.Schema` for `themeSchema`.
  public static func compileSurfacePropertiesSchema(
    _ definition: SurfacePropertiesDefinition,
    protocolVersion: A2UIProtocolVersion = .v091,
    localTypes: [String: TypeDefinition] = [:]
  ) throws -> Schema {
    let raw = surfacePropertiesJSONSchema(
      definition,
      version: protocolVersion,
      localTypes: localTypes,
      useAbsoluteCommonURIs: true,
      inlineLocalTypes: true
    )
    return try Schema(rawSchema: raw, context: A2UISchemaRegistry.makeContext())
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

  // MARK: - Private JSON Schema -> Model Extraction

  private struct ComponentExtractionState {
    var properties: OrderedDictionary<String, JSONValue> = [:]
    var propertyBlockHasID: [String: Bool] = [:]
    var required: Set<String> = []
    var atLeastOneOf: [[String]] = []
    var isCheckable = false
    var description: String?
    var hasUntranslatableRoot = false
    var allowsAdditionalProperties = true
  }

  private static func extractComponentSchema(
    _ schema: JSONValue,
    root: JSONValue,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>,
    visitedRefs: Set<String>,
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
        return
      }
      if ref.hasPrefix("#"), !visitedRefs.contains(ref) {
        var nextVisited = visitedRefs
        nextVisited.insert(ref)
        if let target = resolveLocalPointer(ref, in: root) ?? localDefs[refName] {
          extractComponentSchema(
            target,
            root: root,
            localDefs: localDefs,
            knownTypeNames: knownTypeNames,
            visitedRefs: nextVisited,
            into: &state
          )
        }
      }
      return
    }

    if let props = obj["properties"]?.objectValue {
      let blockHasID = props["id"] != nil
      for (key, value) in props {
        state.properties[key] = value
        state.propertyBlockHasID[key] = blockHasID
      }
    }

    if let req = obj["required"]?.arrayValue {
      for item in req {
        if let name = item.stringValue {
          state.required.insert(name)
        }
      }
    }

    if let anyOf = obj["anyOf"]?.arrayValue {
      if let group = extractRequiredGroup(from: anyOf) {
        state.atLeastOneOf.append(group)
      } else {
        state.hasUntranslatableRoot = true
      }
    }

    if let allOf = obj["allOf"]?.arrayValue {
      for branch in allOf {
        extractComponentSchema(
          branch,
          root: root,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames,
          visitedRefs: visitedRefs,
          into: &state
        )
      }
    }
  }

  private static func buildComponentParameters(
    from state: inout ComponentExtractionState,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>
  ) -> [ParameterDefinition] {
    var parameters: [ParameterDefinition] = []
    for (propName, propSchema) in state.properties {
      if propName == "component" {
        continue
      }
      if propName == "@catalogId" || propName == "@accessibility" || propName == "@metadata" {
        continue
      }
      if propName == "@checks" {
        if isCheckRuleListSchema(propSchema) {
          state.isCheckable = true
          continue
        }
      }
      if propName == "checks" && isCheckRuleListSchema(propSchema) {
        state.isCheckable = true
        continue
      }
      if propName == "accessibility" && refSuffix(of: propSchema) == "AccessibilityAttributes" {
        continue
      }
      let blockHasID = state.propertyBlockHasID[propName] ?? false
      if propName == "id" {
        let isEnvelopeID =
          refSuffix(of: propSchema) == "ComponentId"
          || propSchema["type"]?.stringValue == "string"
        if isEnvelopeID {
          continue
        }
      }
      if propName == "catalogId", blockHasID, propSchema["type"]?.stringValue == "string" {
        continue
      }
      if propName == "metadata" {
        if refSuffix(of: propSchema) == "ComponentCommonMetadata" {
          continue
        }
        let metaKeys = propSchema["properties"]?.objectValue?.keys.map { $0 } ?? []
        if blockHasID && propSchema["type"]?.stringValue == "object" && metaKeys == ["extensions"] {
          continue
        }
      }

      let translated = translateType(
        propSchema,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: []
      )
      parameters.append(
        ParameterDefinition(
          name: propName,
          type: translated.strippingParameterMetadata(),
          required: state.required.contains(propName),
          description: translated.description,
          deprecated: translated.isDeprecated,
          deprecatedReason: translated.deprecatedReason
        )
      )
    }
    return parameters
  }

  private static func parseFunctions(
    from rawFunctions: JSONValue?,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>
  ) throws -> [FunctionDefinition] {
    guard let rawFunctions else { return [] }
    if let obj = rawFunctions.objectValue {
      return obj.map { name, fnValue in
        parseSingleFunction(
          name: name,
          fnValue: fnValue,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames
        )
      }
    }
    if let arr = rawFunctions.arrayValue {
      return try arr.enumerated().map { index, fnValue in
        guard let name = fnValue["name"]?.stringValue, !name.isEmpty else {
          throw A2UICatalogError("Function at index \(index) is missing a valid 'name'.")
        }
        return parseSingleFunction(
          name: name,
          fnValue: fnValue,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames
        )
      }
    }
    throw A2UICatalogError("Field 'functions' must be an object or array.")
  }

  private static func parseSingleFunction(
    name: String,
    fnValue: JSONValue,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>
  ) -> FunctionDefinition {
    let argsSchema = extractFunctionArgsSchema(from: fnValue)
    let rawReturnType = fnValue["returnType"]?.stringValue ?? "any"
    let returnDef = parseFunctionReturnShorthand(rawReturnType)
    let allowedCallers =
      fnValue["allowedCallers"]?.stringValue.flatMap(AllowedCallers.init(rawValue:))
      ?? .rendererOnly
    let requiresUserActivation = fnValue["requiresUserActivation"]?.boolValue ?? false
    let description =
      fnValue["description"]?.stringValue ?? argsSchema["description"]?.stringValue
    return functionDefinition(
      from: name,
      returnDefinition: returnDef,
      argsSchema: argsSchema,
      description: description,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      localDefs: localDefs,
      knownTypeNames: knownTypeNames
    )
  }

  private static func functionDefinition(
    from name: String,
    returnDefinition: FunctionReturnDefinition,
    argsSchema: JSONValue,
    description: String?,
    allowedCallers: AllowedCallers,
    requiresUserActivation: Bool,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>
  ) -> FunctionDefinition {
    guard let obj = argsSchema.objectValue else {
      return FunctionDefinition(
        name: name,
        description: description,
        returnType: returnDefinition,
        allowedCallers: allowedCallers,
        requiresUserActivation: requiresUserActivation,
        rawJSONSchema: argsSchema
      )
    }

    var hasUntranslatable = obj.keys.contains { untranslatableObjectKeywords.contains($0) }
    var atLeastOneOf: [[String]] = []
    if let anyOf = obj["anyOf"]?.arrayValue {
      if let group = extractRequiredGroup(from: anyOf) {
        atLeastOneOf.append(group)
      } else {
        hasUntranslatable = true
      }
    }

    let requiredSet = Set(obj["required"]?.arrayValue?.compactMap(\.stringValue) ?? [])
    let propsObj = obj["properties"]?.objectValue ?? [:]
    let parameters = propsObj.map { paramName, paramSchema -> ParameterDefinition in
      let translated = translateType(
        paramSchema,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: []
      )
      return ParameterDefinition(
        name: paramName,
        type: translated.strippingParameterMetadata(),
        required: requiredSet.contains(paramName),
        description: translated.description,
        deprecated: translated.isDeprecated,
        deprecatedReason: translated.deprecatedReason
      )
    }

    let additional = translateAdditionalProperties(
      object: obj,
      localDefs: localDefs,
      knownTypeNames: knownTypeNames,
      visitedRefs: []
    )
    let resolvedDescription = description ?? obj["description"]?.stringValue

    return FunctionDefinition(
      name: name,
      description: resolvedDescription,
      returnType: returnDefinition,
      allowedCallers: allowedCallers,
      requiresUserActivation: requiresUserActivation,
      parameters: parameters,
      atLeastOneOf: atLeastOneOf,
      additionalParameters: additional,
      deprecated: obj["deprecated"]?.boolValue ?? false,
      rawJSONSchema: hasUntranslatable ? argsSchema : nil
    )
  }

  private static func translateType(
    _ schema: JSONValue,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>,
    visitedRefs: Set<String>
  ) -> TypeDefinition {
    guard let obj = schema.objectValue else {
      return .rawJSONSchema(schema)
    }

    let rawDesc = obj["description"]?.stringValue
    let deprecated = obj["deprecated"]?.boolValue ?? false

    // Legacy "REF:<uri>|<optional description>" smuggling convention.
    if let rawDesc, rawDesc.hasPrefix("REF:") {
      let parts = rawDesc.dropFirst(4).split(separator: "|", maxSplits: 1)
      let refURI = parts.first.map(String.init) ?? ""
      let customDesc = parts.count > 1 && !parts[1].isEmpty ? String(parts[1]) : nil
      if let mapped = translateRef(
        refURI,
        defaultValue: obj["default"],
        description: customDesc,
        deprecated: deprecated,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: visitedRefs
      ) {
        return mapped
      }
    }

    if let ref = obj["$ref"]?.stringValue {
      if let mapped = translateRef(
        ref,
        defaultValue: obj["default"],
        description: rawDesc,
        deprecated: deprecated,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: visitedRefs
      ) {
        return mapped
      }
      return .rawJSONSchema(schema)
    }

    // DateTimeInput.min / max pattern: allOf: [DynamicString, { if: {type: string}, then: {oneOf:
    // [{format: ...}]}}]
    if let allOf = obj["allOf"]?.arrayValue {
      if let dynamicFormatted = translateDynamicFormattedAllOf(
        allOf,
        defaultValue: obj["default"],
        description: rawDesc,
        deprecated: deprecated
      ) {
        return dynamicFormatted
      }
      return .rawJSONSchema(schema)
    }

    if obj.keys.contains(where: { untranslatableValueKeywords.contains($0) }) {
      return .rawJSONSchema(schema)
    }

    if let constVal = obj["const"] {
      return .const(value: constVal, description: rawDesc, deprecated: deprecated)
    }

    if let enumValues = obj["enum"]?.arrayValue, !enumValues.isEmpty {
      let valueType = inferEnumValueType(enumValues, declaredType: obj["type"]?.stringValue)
      return .enum(
        values: enumValues,
        valueType: valueType,
        dynamic: false,
        defaultValue: obj["default"],
        description: rawDesc,
        deprecated: deprecated
      )
    }

    if let oneOf = obj["oneOf"]?.arrayValue {
      return translateUnionBranches(
        oneOf,
        exclusive: true,
        defaultValue: obj["default"],
        description: rawDesc,
        deprecated: deprecated,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: visitedRefs,
        original: schema
      )
    }

    if let anyOf = obj["anyOf"]?.arrayValue {
      // Check if this is an object schema carrying an `atLeastOneOf` constraint rather than a
      // value union.
      if obj["type"]?.stringValue != "object" && obj["properties"] == nil {
        return translateUnionBranches(
          anyOf,
          exclusive: false,
          defaultValue: obj["default"],
          description: rawDesc,
          deprecated: deprecated,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames,
          visitedRefs: visitedRefs,
          original: schema
        )
      }
    }

    // Multi-type array, e.g. `"type": ["number", "string"]` (FormatCurrency / Pluralize).
    if let typeArray = obj["type"]?.arrayValue {
      let typeNames = typeArray.compactMap(\.stringValue)
      let nonNullTypes = typeNames.filter { $0 != "null" }
      if nonNullTypes.count >= 2 && nonNullTypes.count == typeNames.count {
        let variants = nonNullTypes.compactMap { simplePrimitiveType(named: $0) }
        if variants.count == nonNullTypes.count {
          return .union(
            variants: variants,
            exclusive: false,
            dynamic: false,
            defaultValue: obj["default"],
            description: rawDesc,
            deprecated: deprecated
          )
        }
      }
      return .rawJSONSchema(schema)
    }

    let typeName = obj["type"]?.stringValue
    if typeName == "string" {
      let formats = obj["format"]?.stringValue.map { [$0] }
      return .string(
        dynamic: false,
        formats: formats,
        pattern: obj["pattern"]?.stringValue,
        minLength: obj["minLength"]?.intValue,
        maxLength: obj["maxLength"]?.intValue,
        defaultValue: obj["default"]?.stringValue,
        description: rawDesc,
        deprecated: deprecated
      )
    }
    if typeName == "number" {
      return .number(
        dynamic: false,
        min: obj["minimum"]?.doubleValue,
        max: obj["maximum"]?.doubleValue,
        defaultValue: obj["default"]?.doubleValue,
        description: rawDesc,
        deprecated: deprecated
      )
    }
    if typeName == "integer" {
      return .integer(
        dynamic: false,
        min: obj["minimum"]?.intValue,
        max: obj["maximum"]?.intValue,
        defaultValue: obj["default"]?.intValue,
        description: rawDesc,
        deprecated: deprecated
      )
    }
    if typeName == "boolean" {
      return .boolean(
        dynamic: false,
        defaultValue: obj["default"]?.boolValue,
        description: rawDesc,
        deprecated: deprecated
      )
    }
    if typeName == "array" || obj["items"] != nil {
      let items = obj["items"].map {
        translateType(
          $0,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames,
          visitedRefs: visitedRefs
        )
      }
      return .array(
        dynamic: false,
        items: items,
        minItems: obj["minItems"]?.intValue,
        maxItems: obj["maxItems"]?.intValue,
        uniqueItems: obj["uniqueItems"]?.boolValue ?? false,
        defaultValue: obj["default"]?.arrayValue,
        description: rawDesc,
        deprecated: deprecated
      )
    }
    if typeName == "object" || obj["properties"] != nil {
      var atLeastOneOf: [[String]] = []
      if let anyOf = obj["anyOf"]?.arrayValue {
        guard let group = extractRequiredGroup(from: anyOf) else {
          return .rawJSONSchema(schema)
        }
        atLeastOneOf.append(group)
      }
      let requiredSet = Set(obj["required"]?.arrayValue?.compactMap(\.stringValue) ?? [])
      let props = (obj["properties"]?.objectValue ?? [:]).map { k, v -> ParameterDefinition in
        let translated = translateType(
          v,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames,
          visitedRefs: visitedRefs
        )
        return ParameterDefinition(
          name: k,
          type: translated.strippingParameterMetadata(),
          required: requiredSet.contains(k),
          description: translated.description,
          deprecated: translated.isDeprecated,
          deprecatedReason: translated.deprecatedReason
        )
      }
      let additional = translateAdditionalProperties(
        object: obj,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: visitedRefs
      )
      return .object(
        dynamic: false,
        properties: props,
        additionalProperties: additional,
        atLeastOneOf: atLeastOneOf,
        defaultValue: obj["default"]?.dictionaryValue,
        description: rawDesc,
        deprecated: deprecated
      )
    }

    // Unconstrained schema `{}` (only metadata keys like description/default): e.g. required.value.
    if obj.keys.allSatisfy({ metadataOnlyKeys.contains($0) }) {
      return .any(
        dynamic: true,
        nullable: true,
        defaultValue: obj["default"],
        description: rawDesc,
        deprecated: deprecated
      )
    }

    return .rawJSONSchema(schema)
  }

  private static func translateRef(
    _ ref: String,
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>,
    visitedRefs: Set<String>
  ) -> TypeDefinition? {
    let suffix = ref.split(separator: "/").last.map(String.init) ?? ""
    switch suffix {
    case "DynamicString":
      return .string(
        dynamic: true,
        defaultValue: defaultValue?.stringValue,
        description: description,
        deprecated: deprecated
      )
    case "DynamicNumber":
      return .number(
        dynamic: true,
        defaultValue: defaultValue?.doubleValue,
        description: description,
        deprecated: deprecated
      )
    case "DynamicBoolean":
      return .boolean(
        dynamic: true,
        defaultValue: defaultValue?.boolValue,
        description: description,
        deprecated: deprecated
      )
    case "DynamicStringList":
      return .array(
        dynamic: true,
        items: .string(),
        defaultValue: defaultValue?.arrayValue,
        description: description,
        deprecated: deprecated
      )
    case "DynamicValue":
      return .any(
        dynamic: true,
        nullable: false,
        defaultValue: defaultValue,
        description: description,
        deprecated: deprecated
      )
    case "DataBinding":
      return .dataBinding(description: description, deprecated: deprecated)
    case "FunctionCall":
      return .functionCall(description: description, deprecated: deprecated)
    case "Child", "ComponentId":
      return .child(description: description, deprecated: deprecated)
    case "ChildList":
      return .childList(description: description, deprecated: deprecated)
    case "Action":
      return .action(description: description, deprecated: deprecated)
    case "CheckRule":
      return .checkRule(description: description, deprecated: deprecated)
    case "AccessibilityAttributes":
      return .accessibility(description: description, deprecated: deprecated)
    default:
      if ref.hasPrefix("#/$defs/") {
        if knownTypeNames.contains(suffix) {
          return .ref(
            suffix,
            defaultValue: defaultValue,
            description: description,
            deprecated: deprecated
          )
        }
        if !visitedRefs.contains(ref), let target = localDefs[suffix] {
          var nextVisited = visitedRefs
          nextVisited.insert(ref)
          return translateType(
            target,
            localDefs: localDefs,
            knownTypeNames: knownTypeNames,
            visitedRefs: nextVisited
          )
        }
      }
      return nil
    }
  }

  private static func translateDynamicFormattedAllOf(
    _ branches: [JSONValue],
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool
  ) -> TypeDefinition? {
    guard branches.count == 2 else { return nil }
    var hasDynamicString = false
    var extractedFormats: [String]?
    for branch in branches {
      if refSuffix(of: branch) == "DynamicString" {
        hasDynamicString = true
      } else if branch["if"]?["type"]?.stringValue == "string",
        let thenSchema = branch["then"]
      {
        if let single = thenSchema["format"]?.stringValue {
          extractedFormats = [single]
        } else if let oneOf = thenSchema["oneOf"]?.arrayValue {
          let formats = oneOf.compactMap { $0["format"]?.stringValue }
          if formats.count == oneOf.count && !formats.isEmpty {
            extractedFormats = formats
          }
        }
      }
    }
    guard hasDynamicString, let extractedFormats else { return nil }
    return .string(
      dynamic: true,
      formats: extractedFormats,
      defaultValue: defaultValue?.stringValue,
      description: description,
      deprecated: deprecated
    )
  }

  private static func translateUnionBranches(
    _ branches: [JSONValue],
    exclusive: Bool,
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>,
    visitedRefs: Set<String>,
    original: JSONValue
  ) -> TypeDefinition {
    // Recognize canonical dynamic wrapper: `[<literal>, DataBinding, FunctionCall]`
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

    if hasDataBinding && hasFunctionCall && literalBranches.count == 1 {
      let inner = translateType(
        literalBranches[0],
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: visitedRefs
      )
      if !inner.containsRawJSONSchema {
        return attachMetadata(
          to: inner.withDynamic(true),
          defaultValue: defaultValue,
          description: description,
          deprecated: deprecated
        )
      }
    }

    guard branches.count >= 2 else {
      if let only = branches.first {
        return translateType(
          only,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames,
          visitedRefs: visitedRefs
        )
      }
      return .rawJSONSchema(original)
    }

    let variants = branches.map {
      translateType(
        $0,
        localDefs: localDefs,
        knownTypeNames: knownTypeNames,
        visitedRefs: visitedRefs
      )
    }
    return .union(
      variants: variants,
      exclusive: exclusive,
      dynamic: false,
      defaultValue: defaultValue,
      description: description,
      deprecated: deprecated
    )
  }

  private static func attachMetadata(
    to type: TypeDefinition,
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool
  ) -> TypeDefinition {
    let effectiveDesc = description ?? type.description
    let effectiveDeprecated = deprecated || type.isDeprecated
    switch type {
    case .string(let dyn, let formats, let pattern, let minL, let maxL, let def, _, _, let reason):
      return .string(
        dynamic: dyn,
        formats: formats,
        pattern: pattern,
        minLength: minL,
        maxLength: maxL,
        defaultValue: defaultValue?.stringValue ?? def,
        description: effectiveDesc,
        deprecated: effectiveDeprecated,
        deprecatedReason: reason
      )
    case .number(let dyn, let min, let max, let def, _, _, let reason):
      return .number(
        dynamic: dyn,
        min: min,
        max: max,
        defaultValue: defaultValue?.doubleValue ?? def,
        description: effectiveDesc,
        deprecated: effectiveDeprecated,
        deprecatedReason: reason
      )
    case .integer(let dyn, let min, let max, let def, _, _, let reason):
      return .integer(
        dynamic: dyn,
        min: min,
        max: max,
        defaultValue: defaultValue?.intValue ?? def,
        description: effectiveDesc,
        deprecated: effectiveDeprecated,
        deprecatedReason: reason
      )
    case .boolean(let dyn, let def, _, _, let reason):
      return .boolean(
        dynamic: dyn,
        defaultValue: defaultValue?.boolValue ?? def,
        description: effectiveDesc,
        deprecated: effectiveDeprecated,
        deprecatedReason: reason
      )
    case .enum(let values, let valueType, let dyn, let def, _, _, let reason):
      return .enum(
        values: values,
        valueType: valueType,
        dynamic: dyn,
        defaultValue: defaultValue ?? def,
        description: effectiveDesc,
        deprecated: effectiveDeprecated,
        deprecatedReason: reason
      )
    case .array(let dyn, let items, let minI, let maxI, let unique, let def, _, _, let reason):
      return .array(
        dynamic: dyn,
        items: items,
        minItems: minI,
        maxItems: maxI,
        uniqueItems: unique,
        defaultValue: defaultValue?.arrayValue ?? def,
        description: effectiveDesc,
        deprecated: effectiveDeprecated,
        deprecatedReason: reason
      )
    case .object(let dyn, let props, let add, let groups, let def, _, _, let reason):
      return .object(
        dynamic: dyn,
        properties: props,
        additionalProperties: add,
        atLeastOneOf: groups,
        defaultValue: defaultValue?.dictionaryValue ?? def,
        description: effectiveDesc,
        deprecated: effectiveDeprecated,
        deprecatedReason: reason
      )
    default:
      return type
    }
  }

  private static func translateAdditionalProperties(
    object: OrderedDictionary<String, JSONValue>,
    localDefs: OrderedDictionary<String, JSONValue>,
    knownTypeNames: Set<String>,
    visitedRefs: Set<String>
  ) -> AdditionalProperties {
    if let additional = object["additionalProperties"] {
      if let flag = additional.boolValue {
        return flag ? .allowed : .disallowed
      }
      return .typed(
        translateType(
          additional,
          localDefs: localDefs,
          knownTypeNames: knownTypeNames,
          visitedRefs: visitedRefs
        )
      )
    }
    if object["unevaluatedProperties"]?.boolValue == false {
      return .disallowed
    }
    return .allowed
  }

  // MARK: - Private Model -> JSON Schema Emission

  private static func parameterToJSONSchema(
    _ param: ParameterDefinition,
    version: A2UIProtocolVersion,
    localTypes: [String: TypeDefinition],
    useAbsoluteCommonURIs: Bool,
    inlineLocalTypes: Bool
  ) -> JSONValue {
    let raw = typeToJSONSchema(
      param.type,
      version: version,
      localTypes: localTypes,
      useAbsoluteCommonURIs: useAbsoluteCommonURIs,
      inlineLocalTypes: inlineLocalTypes
    )
    guard var obj = raw.objectValue else { return raw }
    if let desc = param.effectiveDescription, obj["description"] == nil {
      obj["description"] = .string(desc)
    }
    if param.isEffectivelyDeprecated {
      obj["deprecated"] = .boolean(true)
    }
    return .object(obj)
  }

  private static func typeToJSONSchema(
    _ type: TypeDefinition,
    version: A2UIProtocolVersion,
    localTypes: [String: TypeDefinition],
    useAbsoluteCommonURIs: Bool,
    inlineLocalTypes: Bool,
    visitedRefs: Set<String> = []
  ) -> JSONValue {
    switch type {
    case .string(
      let dynamic, let formats, let pattern, let minLength, let maxLength,
      let defaultValue, let description, let deprecated, _):
      return emitStringJSONSchema(
        dynamic: dynamic,
        formats: formats,
        pattern: pattern,
        minLength: minLength,
        maxLength: maxLength,
        defaultValue: defaultValue,
        description: description,
        deprecated: deprecated,
        version: version,
        absolute: useAbsoluteCommonURIs
      )

    case .number(
      let dynamic, let min, let max, let defaultValue, let description, let deprecated,
      _):
      if dynamic && min == nil && max == nil {
        return makeRefObject(
          commonRef("DynamicNumber", version: version, absolute: useAbsoluteCommonURIs),
          defaultValue: defaultValue.map(encodeNumber),
          description: description,
          deprecated: deprecated
        )
      }
      var literal: OrderedDictionary<String, JSONValue> = ["type": .string("number")]
      if let min { literal["minimum"] = encodeNumber(min) }
      if let max { literal["maximum"] = encodeNumber(max) }
      return wrapDynamicIfNeeded(
        literal: .object(literal),
        dynamic: dynamic,
        expectedV09ReturnType: "number",
        defaultValue: defaultValue.map(encodeNumber),
        description: description,
        deprecated: deprecated,
        version: version,
        absolute: useAbsoluteCommonURIs
      )

    case .integer(
      let dynamic, let min, let max, let defaultValue, let description, let deprecated,
      _):
      var literal: OrderedDictionary<String, JSONValue> = ["type": .string("integer")]
      if let min { literal["minimum"] = .integer(min) }
      if let max { literal["maximum"] = .integer(max) }
      return wrapDynamicIfNeeded(
        literal: .object(literal),
        dynamic: dynamic,
        expectedV09ReturnType: "number",
        defaultValue: defaultValue.map { .integer($0) },
        description: description,
        deprecated: deprecated,
        version: version,
        absolute: useAbsoluteCommonURIs
      )

    case .boolean(let dynamic, let defaultValue, let description, let deprecated, _):
      if dynamic {
        return makeRefObject(
          commonRef("DynamicBoolean", version: version, absolute: useAbsoluteCommonURIs),
          defaultValue: defaultValue.map { .boolean($0) },
          description: description,
          deprecated: deprecated
        )
      }
      var obj: OrderedDictionary<String, JSONValue> = ["type": .string("boolean")]
      if let defaultValue { obj["default"] = .boolean(defaultValue) }
      appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
      return .object(obj)

    case .enum(
      let values, let valueType, let dynamic, let defaultValue, let description,
      let deprecated, _):
      let literal: OrderedDictionary<String, JSONValue> = [
        "type": .string(valueType.rawValue),
        "enum": .array(values),
      ]
      return wrapDynamicIfNeeded(
        literal: .object(literal),
        dynamic: dynamic,
        expectedV09ReturnType: valueType.rawValue,
        defaultValue: defaultValue,
        description: description,
        deprecated: deprecated,
        version: version,
        absolute: useAbsoluteCommonURIs
      )

    case .const(let value, let description, let deprecated, _):
      var obj: OrderedDictionary<String, JSONValue> = ["const": value]
      appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
      return .object(obj)

    case .any(let dynamic, let nullable, let defaultValue, let description, let deprecated, _):
      if dynamic && !nullable {
        return makeRefObject(
          commonRef("DynamicValue", version: version, absolute: useAbsoluteCommonURIs),
          defaultValue: defaultValue,
          description: description,
          deprecated: deprecated
        )
      }
      var obj: OrderedDictionary<String, JSONValue> = [:]
      if let defaultValue { obj["default"] = defaultValue }
      appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
      return .object(obj)

    case .object(
      let dynamic, let properties, let additional, let atLeastOneOf, let defaultValue,
      let description, let deprecated, _):
      var literal: OrderedDictionary<String, JSONValue> = ["type": .string("object")]
      if !properties.isEmpty {
        var propsObj: OrderedDictionary<String, JSONValue> = [:]
        var req: [JSONValue] = []
        for prop in properties {
          propsObj[prop.name] = parameterToJSONSchema(
            prop,
            version: version,
            localTypes: localTypes,
            useAbsoluteCommonURIs: useAbsoluteCommonURIs,
            inlineLocalTypes: inlineLocalTypes
          )
          if prop.required { req.append(.string(prop.name)) }
        }
        literal["properties"] = .object(propsObj)
        if !req.isEmpty { literal["required"] = .array(req) }
      }
      if !atLeastOneOf.isEmpty {
        literal["anyOf"] = encodeAtLeastOneOfJSONSchema(atLeastOneOf)
      }
      switch additional {
      case .disallowed:
        literal["additionalProperties"] = .boolean(false)
      case .allowed:
        literal["additionalProperties"] = .boolean(true)
      case .typed(let extra):
        literal["additionalProperties"] = typeToJSONSchema(
          extra,
          version: version,
          localTypes: localTypes,
          useAbsoluteCommonURIs: useAbsoluteCommonURIs,
          inlineLocalTypes: inlineLocalTypes,
          visitedRefs: visitedRefs
        )
      }
      let encodedDefault: JSONValue? = defaultValue.map { dict in
        var ordered: OrderedDictionary<String, JSONValue> = [:]
        for key in dict.keys.sorted() { ordered[key] = dict[key] }
        return .object(ordered)
      }
      return wrapDynamicIfNeeded(
        literal: .object(literal),
        dynamic: dynamic,
        expectedV09ReturnType: "object",
        defaultValue: encodedDefault,
        description: description,
        deprecated: deprecated,
        version: version,
        absolute: useAbsoluteCommonURIs
      )

    case .array(
      let dynamic, let items, let minItems, let maxItems, let uniqueItems,
      let defaultValue, let description, let deprecated, _):
      if dynamic, case .string(false, nil, nil, nil, nil, nil, _, _, _) = items,
        minItems == nil, maxItems == nil, !uniqueItems
      {
        return makeRefObject(
          commonRef("DynamicStringList", version: version, absolute: useAbsoluteCommonURIs),
          defaultValue: defaultValue.map { .array($0) },
          description: description,
          deprecated: deprecated
        )
      }
      var literal: OrderedDictionary<String, JSONValue> = ["type": .string("array")]
      if let items {
        literal["items"] = typeToJSONSchema(
          items,
          version: version,
          localTypes: localTypes,
          useAbsoluteCommonURIs: useAbsoluteCommonURIs,
          inlineLocalTypes: inlineLocalTypes,
          visitedRefs: visitedRefs
        )
      }
      if let minItems { literal["minItems"] = .integer(minItems) }
      if let maxItems { literal["maxItems"] = .integer(maxItems) }
      if uniqueItems { literal["uniqueItems"] = .boolean(true) }
      return wrapDynamicIfNeeded(
        literal: .object(literal),
        dynamic: dynamic,
        expectedV09ReturnType: "array",
        defaultValue: defaultValue.map { .array($0) },
        description: description,
        deprecated: deprecated,
        version: version,
        absolute: useAbsoluteCommonURIs
      )

    case .union(
      let variants, let exclusive, let dynamic, let defaultValue, let description,
      let deprecated, _):
      var branches = variants.map {
        typeToJSONSchema(
          $0,
          version: version,
          localTypes: localTypes,
          useAbsoluteCommonURIs: useAbsoluteCommonURIs,
          inlineLocalTypes: inlineLocalTypes,
          visitedRefs: visitedRefs
        )
      }
      if dynamic {
        branches.append(
          .object([
            "$ref": .string(
              commonRef("DataBinding", version: version, absolute: useAbsoluteCommonURIs))
          ])
        )
        branches.append(
          .object([
            "$ref": .string(
              commonRef("FunctionCall", version: version, absolute: useAbsoluteCommonURIs))
          ])
        )
      }
      var obj: OrderedDictionary<String, JSONValue> = [
        exclusive ? "oneOf" : "anyOf": .array(branches)
      ]
      if let defaultValue { obj["default"] = defaultValue }
      appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
      return .object(obj)

    case .dataBinding(let description, let deprecated, _):
      return makeRefObject(
        commonRef("DataBinding", version: version, absolute: useAbsoluteCommonURIs),
        defaultValue: nil,
        description: description,
        deprecated: deprecated
      )

    case .functionCall(let description, let deprecated, _):
      return makeRefObject(
        commonRef("FunctionCall", version: version, absolute: useAbsoluteCommonURIs),
        defaultValue: nil,
        description: description,
        deprecated: deprecated
      )

    case .ref(let refName, let defaultValue, let description, let deprecated, _):
      if inlineLocalTypes, !visitedRefs.contains(refName), let target = localTypes[refName] {
        var nextVisited = visitedRefs
        nextVisited.insert(refName)
        let inlined = typeToJSONSchema(
          target,
          version: version,
          localTypes: localTypes,
          useAbsoluteCommonURIs: useAbsoluteCommonURIs,
          inlineLocalTypes: true,
          visitedRefs: nextVisited
        )
        guard var obj = inlined.objectValue else { return inlined }
        if let defaultValue { obj["default"] = defaultValue }
        if let description { obj["description"] = .string(description) }
        if deprecated { obj["deprecated"] = .boolean(true) }
        return .object(obj)
      }
      return makeRefObject(
        "#/$defs/\(refName)",
        defaultValue: defaultValue,
        description: description,
        deprecated: deprecated
      )

    case .child(let description, let deprecated, _):
      let defName = version.isAtLeastV10 ? "Child" : "ComponentId"
      return makeRefObject(
        commonRef(defName, version: version, absolute: useAbsoluteCommonURIs),
        defaultValue: nil,
        description: description,
        deprecated: deprecated
      )

    case .childList(let description, let deprecated, _):
      return makeRefObject(
        commonRef("ChildList", version: version, absolute: useAbsoluteCommonURIs),
        defaultValue: nil,
        description: description,
        deprecated: deprecated
      )

    case .action(let description, let deprecated, _):
      return makeRefObject(
        commonRef("Action", version: version, absolute: useAbsoluteCommonURIs),
        defaultValue: nil,
        description: description,
        deprecated: deprecated
      )

    case .checkRule(let description, let deprecated, _):
      return makeRefObject(
        commonRef("CheckRule", version: version, absolute: useAbsoluteCommonURIs),
        defaultValue: nil,
        description: description,
        deprecated: deprecated
      )

    case .accessibility(let description, let deprecated, _):
      return makeRefObject(
        commonRef("AccessibilityAttributes", version: version, absolute: useAbsoluteCommonURIs),
        defaultValue: nil,
        description: description,
        deprecated: deprecated
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
    description: String?,
    deprecated: Bool,
    version: A2UIProtocolVersion,
    absolute: Bool
  ) -> JSONValue {
    let hasConstraints =
      (formats != nil && !(formats?.isEmpty ?? true))
      || pattern != nil
      || minLength != nil
      || maxLength != nil
    if dynamic && !hasConstraints {
      return makeRefObject(
        commonRef("DynamicString", version: version, absolute: absolute),
        defaultValue: defaultValue.map { .string($0) },
        description: description,
        deprecated: deprecated
      )
    }
    if dynamic, let formats, formats.count > 1, pattern == nil, minLength == nil, maxLength == nil {
      let formatBranches: [JSONValue] = formats.map { .object(["format": .string($0)]) }
      var obj: OrderedDictionary<String, JSONValue> = [
        "allOf": .array([
          .object([
            "$ref": .string(commonRef("DynamicString", version: version, absolute: absolute))
          ]),
          .object([
            "if": .object(["type": .string("string")]),
            "then": .object(["oneOf": .array(formatBranches)]),
          ]),
        ])
      ]
      if let defaultValue { obj["default"] = .string(defaultValue) }
      appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
      return .object(obj)
    }
    var literal: OrderedDictionary<String, JSONValue> = ["type": .string("string")]
    if let formats, formats.count == 1 {
      literal["format"] = .string(formats[0])
    } else if let formats, formats.count > 1 {
      literal["oneOf"] = .array(formats.map { .object(["format": .string($0)]) })
    }
    if let pattern { literal["pattern"] = .string(pattern) }
    if let minLength { literal["minLength"] = .integer(minLength) }
    if let maxLength { literal["maxLength"] = .integer(maxLength) }
    return wrapDynamicIfNeeded(
      literal: .object(literal),
      dynamic: dynamic,
      expectedV09ReturnType: "string",
      defaultValue: defaultValue.map { .string($0) },
      description: description,
      deprecated: deprecated,
      version: version,
      absolute: absolute
    )
  }

  private static func wrapDynamicIfNeeded(
    literal: JSONValue,
    dynamic: Bool,
    expectedV09ReturnType: String,
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool,
    version: A2UIProtocolVersion,
    absolute: Bool
  ) -> JSONValue {
    guard dynamic else {
      guard var obj = literal.objectValue else { return literal }
      if let defaultValue { obj["default"] = defaultValue }
      appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
      return .object(obj)
    }
    let callBranch: JSONValue
    if version.isAtLeastV10 {
      callBranch = .object([
        "$ref": .string(commonRef("FunctionCall", version: version, absolute: absolute))
      ])
    } else {
      callBranch = .object([
        "allOf": .array([
          .object(["$ref": .string(commonRef("FunctionCall", version: version, absolute: absolute))]
          ),
          .object([
            "properties": .object(["returnType": .object(["const": .string(expectedV09ReturnType)])]
            )
          ]),
        ])
      ])
    }
    var obj: OrderedDictionary<String, JSONValue> = [
      "oneOf": .array([
        literal,
        .object(["$ref": .string(commonRef("DataBinding", version: version, absolute: absolute))]),
        callBranch,
      ])
    ]
    if let defaultValue { obj["default"] = defaultValue }
    appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
    return .object(obj)
  }

  private static func makeRefObject(
    _ ref: String,
    defaultValue: JSONValue?,
    description: String?,
    deprecated: Bool
  ) -> JSONValue {
    var obj: OrderedDictionary<String, JSONValue> = ["$ref": .string(ref)]
    if let defaultValue { obj["default"] = defaultValue }
    appendSchemaMetadata(&obj, description: description, deprecated: deprecated)
    return .object(obj)
  }

  private static func appendSchemaMetadata(
    _ obj: inout OrderedDictionary<String, JSONValue>,
    description: String?,
    deprecated: Bool
  ) {
    if let description { obj["description"] = .string(description) }
    if deprecated { obj["deprecated"] = .boolean(true) }
  }

  private static func commonRef(
    _ defName: String,
    version: A2UIProtocolVersion,
    absolute: Bool
  ) -> String {
    if absolute {
      return version.isAtLeastV10
        ? A2UICommonSchema.v10URI(for: defName)
        : A2UICommonSchema.uri(for: defName)
    }
    return "common_types.json#/$defs/\(defName)"
  }

  private static func makeCatalogUnion(
    names: [String],
    section: String,
    discriminator: String? = nil
  ) -> JSONValue {
    guard !names.isEmpty else { return .object(["not": .object([:])]) }
    let refs: [JSONValue] = names.map { name in
      let token =
        name
        .replacingOccurrences(of: "~", with: "~0")
        .replacingOccurrences(of: "/", with: "~1")
      return .object(["$ref": .string("#/\(section)/\(token)")])
    }
    var union: OrderedDictionary<String, JSONValue> = ["oneOf": .array(refs)]
    if let discriminator {
      union["discriminator"] = .object(["propertyName": .string(discriminator)])
    }
    return .object(union)
  }

  private static func encodeAtLeastOneOfJSONSchema(_ groups: [[String]]) -> JSONValue {
    if groups.count == 1 {
      return .array(groups[0].map { .object(["required": .array([.string($0)])]) })
    }
    return .array(
      groups.map { group in
        .object([
          "anyOf": .array(group.map { .object(["required": .array([.string($0)])]) })
        ])
      }
    )
  }

  // MARK: - Small Utilities

  private static func inferProtocolVersion(
    from root: OrderedDictionary<String, JSONValue>
  ) -> String {
    if root["instructions"] != nil { return "1.0" }
    if let functions = root["functions"]?.objectValue,
      functions.values.contains(where: { $0["properties"]?["@call"] != nil })
    {
      return "1.0"
    }
    return "v0.9"
  }

  private static func isAtLeastV10(_ version: String) -> Bool {
    if let parsed = A2UIProtocolVersion(lenientRawValue: version) {
      return parsed.isAtLeastV10
    }
    let clean = version.hasPrefix("v") ? String(version.dropFirst()) : version
    return clean.compare("1.0", options: .numeric) != .orderedAscending
  }

  private static func validateV10Identifiers(
    _ root: OrderedDictionary<String, JSONValue>
  ) throws {
    if let components = root["components"]?.objectValue {
      for (name, def) in components {
        guard UnicodeIdentifierValidator.isValidIdentifier(name) else {
          throw A2UICatalogError("Invalid UAX #31 component identifier: '\(name)'.")
        }
        if let rawMeta = def["metadata"] {
          _ = try validateOptionalMetadata(rawMeta, pathPrefix: "components.\(name).metadata")
        }
        if let props = def["properties"]?.objectValue {
          for propName in props.keys where !UnicodeIdentifierValidator.isValidIdentifier(propName) {
            throw A2UICatalogError(
              "Invalid UAX #31 property identifier '\(propName)' in component '\(name)'."
            )
          }
        }
      }
    }
    if let functions = root["functions"]?.objectValue {
      for (name, def) in functions {
        guard !name.hasPrefix("@"), UnicodeIdentifierValidator.isValidIdentifier(name) else {
          throw A2UICatalogError("Invalid UAX #31 function identifier: '\(name)'.")
        }
        let paramDict =
          def["parameters"]?.objectValue
          ?? def["properties"]?["args"]?["properties"]?.objectValue
        if let paramDict {
          for argName in paramDict.keys where !UnicodeIdentifierValidator.isValidIdentifier(argName)
          {
            throw A2UICatalogError(
              "Invalid UAX #31 argument identifier '\(argName)' in function '\(name)'."
            )
          }
        }
      }
    }
  }

  private static func checkV10ExternalRefs(_ node: JSONValue, pointer: String = "") throws {
    if let obj = node.objectValue {
      if let ref = obj["$ref"]?.stringValue, !isSupportedV10Ref(ref) {
        throw A2UICatalogError(
          """
          Unsupported external $ref '\(ref)' at \(pointer)/$ref: a v1.0 catalog may only \
          reference its own components and functions (#/...) or common_types.json.
          """
        )
      }
      for (key, value) in obj {
        let escaped =
          key
          .replacingOccurrences(of: "~", with: "~0")
          .replacingOccurrences(of: "/", with: "~1")
        try checkV10ExternalRefs(value, pointer: "\(pointer)/\(escaped)")
      }
    } else if let arr = node.arrayValue {
      for (index, item) in arr.enumerated() {
        try checkV10ExternalRefs(item, pointer: "\(pointer)/\(index)")
      }
    }
  }

  private static func isSupportedV10Ref(_ ref: String) -> Bool {
    let document =
      ref.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(
        String.init
      ) ?? ""
    if document.isEmpty || document == "catalog.json" {
      return true
    }
    return document.split(separator: "/", omittingEmptySubsequences: false).last
      == "common_types.json"
  }

  private static func extractUnionAllowedNames(
    in unionDef: JSONValue?,
    prefix: String
  ) -> Set<String>? {
    guard let unionDef else { return nil }
    if unionDef["not"]?.objectValue?.isEmpty == true {
      return []
    }
    guard let oneOf = unionDef["oneOf"]?.arrayValue else { return nil }
    let names = oneOf.compactMap { item -> String? in
      guard let ref = item["$ref"]?.stringValue, ref.hasPrefix(prefix) else { return nil }
      return String(ref.dropFirst(prefix.count))
    }
    return names.isEmpty ? nil : Set(names)
  }

  private static func validateOptionalMetadata(
    _ raw: JSONValue?,
    pathPrefix: String
  ) throws -> [String: JSONValue]? {
    guard let raw else { return nil }
    do {
      return try MetadataValidator.validate(raw, pathPrefix: pathPrefix)
    } catch let error as A2UIValidationError {
      throw A2UICatalogError(error.message, details: error.details)
    }
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

  private static func parseFunctionReturnShorthand(_ raw: String) -> FunctionReturnDefinition {
    switch raw {
    case "string": return .string
    case "number": return .number
    case "integer": return .integer
    case "boolean": return .boolean
    case "array": return .array
    case "object": return .object
    case "validationResult": return .validationResult
    case "void": return .void
    default: return .any
    }
  }

  private static func extractRequiredGroup(from anyOf: [JSONValue]) -> [String]? {
    guard !anyOf.isEmpty else { return nil }
    var names: [String] = []
    for branch in anyOf {
      guard let obj = branch.objectValue,
        obj.count == 1,
        let req = obj["required"]?.arrayValue,
        req.count == 1,
        let name = req[0].stringValue
      else {
        return nil
      }
      if !names.contains(name) {
        names.append(name)
      }
    }
    return names.isEmpty ? nil : names
  }

  private static func isCheckRuleListSchema(_ schema: JSONValue) -> Bool {
    guard let items = schema["items"] else { return false }
    return refSuffix(of: items) == "CheckRule"
  }

  private static func refSuffix(of schema: JSONValue) -> String? {
    guard let ref = schema["$ref"]?.stringValue else { return nil }
    return ref.split(separator: "/").last.map(String.init)
  }

  private static func isDataBindingBranch(_ branch: JSONValue) -> Bool {
    refSuffix(of: branch) == "DataBinding"
  }

  private static func isFunctionCallBranch(_ branch: JSONValue) -> Bool {
    if refSuffix(of: branch) == "FunctionCall" {
      return true
    }
    if let allOf = branch["allOf"]?.arrayValue,
      allOf.contains(where: { refSuffix(of: $0) == "FunctionCall" })
    {
      return true
    }
    return false
  }

  private static func inferEnumValueType(
    _ values: [JSONValue],
    declaredType: String?
  ) -> EnumValueType {
    if let declaredType, let parsed = EnumValueType(rawValue: declaredType) {
      return parsed
    }
    if let first = values.first {
      if first.stringValue != nil { return .string }
      if first.boolValue != nil { return .boolean }
      if first.doubleValue != nil { return .number }
    }
    return .string
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

  private static func encodeNumber(_ value: Double) -> JSONValue {
    if let exact = Int(exactly: value) {
      return .integer(exact)
    }
    return .number(value)
  }

  private static func resolveLocalPointer(_ ref: String, in root: JSONValue) -> JSONValue? {
    guard ref == "#" || ref.hasPrefix("#/") else { return nil }
    var current = root
    let tokens = ref.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
    for rawToken in tokens.dropFirst() {
      let token =
        rawToken
        .replacingOccurrences(of: "~1", with: "/")
        .replacingOccurrences(of: "~0", with: "~")
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
