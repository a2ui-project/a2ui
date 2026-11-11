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
import OrderedJSON

/// The protocol mixins of a v1.0 component object, split from the component's own properties.
///
/// v1.0 names the component mixins `@catalogId`, `@metadata`, `@accessibility`, and `@checks`.
/// While agents move to the prefixed names, a v1.0 component may still carry a mixin under its
/// legacy bare name (`catalogId`, `metadata`, `accessibility`, `checks`), unless the component's
/// schema declares a property of its own with that name: then the bare key is that property, and
/// only the prefixed key is the mixin. A component that names a mixin both ways without declaring
/// the bare name is ambiguous, and is rejected. Bare `checks` is a mixin only on a checkable
/// component; elsewhere it stays a property, for the component schema to accept or reject.
///
/// Before v1.0 a component has no mixins beyond `id` and `component`, so this type is not used:
/// bare `catalogId` and `metadata` are ordinary properties there.
///
/// TODO(#4082): remove the legacy bare v1.0 mixin fallback. It exists only until v1.0 schemas,
/// catalogs, and agent emitters all use the `@`-prefixed names.
struct ComponentEnvelope {
  /// A component mixin, by its legacy bare name.
  enum Mixin: String, CaseIterable {
    case catalogID = "catalogId"
    case metadata
    case accessibility
    case checks

    /// The legacy bare key of the mixin, such as `metadata`.
    var bareKey: String { rawValue }

    /// The v1.0 key of the mixin, such as `@metadata`.
    var prefixedKey: String { "@" + rawValue }
  }

  /// The `@`-prefixed mixin keys that a v1.0 component object may carry at its root.
  static let prefixedKeys: Set<String> = Set(Mixin.allCases.map(\.prefixedKey))

  /// The value of each mixin the component carries.
  private var values: [Mixin: JSONValue] = [:]

  /// The key under which the component carries each mixin: prefixed, or legacy bare.
  private var keys: [Mixin: String] = [:]

  /// The component's own properties: every key but `id`, `component`, and the mixin keys.
  private(set) var properties: [String: JSONValue]

  /// Splits a v1.0 component object.
  ///
  /// - Parameters:
  ///   - component: The component object, including `id` and `component`.
  ///   - schema: The schema of the component's type, or nil when the type is unknown.
  ///   - componentID: The component's id, for error messages.
  /// - Throws: `A2UIValidationError` when the component carries a mixin under both its prefixed
  ///   and its bare key, and its schema doesn't declare a property with the bare name.
  init(component: [String: JSONValue], schema: JSONValue?, componentID: String) throws {
    var properties = component
    properties.removeValue(forKey: "id")
    properties.removeValue(forKey: "component")
    for mixin in Mixin.allCases {
      let prefixed = component[mixin.prefixedKey]
      let bare = component[mixin.bareKey]
      if prefixed == nil && bare == nil {
        continue
      }
      properties.removeValue(forKey: mixin.prefixedKey)
      let declaresBare = bare != nil ? Self.declaresOwnProperty(mixin, in: schema) : false
      if let prefixed {
        if bare != nil, !declaresBare {
          throw Self.conflictError(mixin, componentID: componentID)
        }
        values[mixin] = prefixed
        keys[mixin] = mixin.prefixedKey
      } else if let bare, !declaresBare,
        mixin != .checks || Self.isCheckable(schema)
      {
        properties.removeValue(forKey: mixin.bareKey)
        values[mixin] = bare
        keys[mixin] = mixin.bareKey
      }
    }
    self.properties = properties
  }

  /// The value of a mixin the component carries, or nil.
  subscript(mixin: Mixin) -> JSONValue? {
    values[mixin]
  }

  /// The key under which the component carries a mixin, or nil when it doesn't carry it.
  func key(of mixin: Mixin) -> String? {
    keys[mixin]
  }

  /// Returns the key and value of the catalog a v1.0 component names, or nil when it names none.
  ///
  /// The component's catalog decides its schema, and so whether its bare `catalogId` is a
  /// property of its own; the default catalog's schema stands in for it here. `@catalogId` always
  /// names the catalog.
  ///
  /// - Parameters:
  ///   - component: The component object.
  ///   - defaultCatalogSchema: The schema of the component's type in the surface default catalog.
  static func catalogIDEntry(
    in component: [String: JSONValue],
    defaultCatalogSchema: JSONValue?
  ) -> (key: String, value: JSONValue)? {
    let mixin = Mixin.catalogID
    if let prefixed = component[mixin.prefixedKey] {
      return (mixin.prefixedKey, prefixed)
    }
    if let bare = component[mixin.bareKey],
      !declaresOwnProperty(mixin, in: defaultCatalogSchema)
    {
      return (mixin.bareKey, bare)
    }
    return nil
  }

  /// Returns whether a component schema declares a property of its own named like a mixin.
  ///
  /// A property is the component's own unless its schema has the mixin's shape: an
  /// `AccessibilityAttributes` reference for `accessibility`, a `CheckRule` list for `checks`,
  /// and a `ComponentCommonMetadata` reference for `metadata`. A `catalogId` of type `string`, or
  /// a `metadata` object holding only `extensions`, is the mixin only when the same `properties`
  /// block also declares `id`, as an inlined `ComponentCommon` does; elsewhere it is the
  /// component's own. A shared `ComponentCommon` or `Checkable` definition in another document
  /// declares no property of the component's own.
  static func declaresOwnProperty(_ mixin: Mixin, in schema: JSONValue?) -> Bool {
    guard let schema,
      let block = declaringProperties(mixin.bareKey, in: schema, root: schema, visited: []),
      let declared = block.objectValue?[mixin.bareKey]
    else {
      return false
    }
    let inlinesComponentCommon = block.objectValue?["id"] != nil
    switch mixin {
    case .catalogID:
      return !(inlinesComponentCommon && declared["type"]?.stringValue == "string")
    case .metadata:
      if referencedDefinition(of: declared) == "ComponentCommonMetadata" {
        return false
      }
      let keys = declared["properties"]?.objectValue?.keys.map { $0 } ?? []
      let hasMixinShape = declared["type"]?.stringValue == "object" && keys == ["extensions"]
      return !(inlinesComponentCommon && hasMixinShape)
    case .accessibility:
      return referencedDefinition(of: declared) != "AccessibilityAttributes"
    case .checks:
      return !isCheckRuleList(declared)
    }
  }

  /// Returns whether a component schema accepts checks: it mixes in `Checkable`, or declares a
  /// `CheckRule` list as `checks` or `@checks`.
  ///
  /// A component that mixes in `Checkable` stays checkable when it also declares a `checks`
  /// property of its own. An unknown schema (nil) is not checkable, so an unknown component keeps
  /// a bare `checks` among its properties.
  static func isCheckable(_ schema: JSONValue?) -> Bool {
    guard let schema else { return false }
    if let declared = declaredPropertySchema("@checks", in: schema, root: schema, visited: []),
      isCheckRuleList(declared)
    {
      return true
    }
    if let declared = declaredPropertySchema("checks", in: schema, root: schema, visited: []),
      isCheckRuleList(declared)
    {
      return true
    }
    return mixesIn("Checkable", schema: schema, root: schema, visited: [])
  }

  /// The error raised for a component that carries a mixin under both of its keys.
  static func conflictError(_ mixin: Mixin, componentID: String) -> A2UIValidationError {
    let msg =
      "Component '\(componentID)' cannot specify both '\(mixin.prefixedKey)' and legacy "
      + "'\(mixin.bareKey)'."
    return A2UIValidationError(
      msg,
      details: [A2UIErrorDetail(path: mixin.prefixedKey, code: "invalid_value", message: msg)]
    )
  }

  // MARK: - Schema Inspection

  /// Finds the schema of a property that a schema declares under `properties`, directly, through
  /// a local `$ref`, or through `allOf`, `anyOf`, or `oneOf`.
  private static func declaredPropertySchema(
    _ key: String,
    in schema: JSONValue,
    root: JSONValue,
    visited: Set<String>
  ) -> JSONValue? {
    declaringProperties(key, in: schema, root: root, visited: visited)?.objectValue?[key]
  }

  /// Finds the `properties` object that declares a property, directly, through a local `$ref`,
  /// or through `allOf`, `anyOf`, or `oneOf`.
  private static func declaringProperties(
    _ key: String,
    in schema: JSONValue,
    root: JSONValue,
    visited: Set<String>
  ) -> JSONValue? {
    if let properties = schema["properties"], properties.objectValue?[key] != nil {
      return properties
    }
    var visited = visited
    if let ref = schema["$ref"]?.stringValue, ref.hasPrefix("#"), visited.insert(ref).inserted,
      let target = resolveLocalRef(ref, in: root),
      let properties = declaringProperties(key, in: target, root: root, visited: visited)
    {
      return properties
    }
    for combiner in ["allOf", "anyOf", "oneOf"] {
      for subSchema in schema[combiner]?.arrayValue ?? [] {
        if let properties = declaringProperties(key, in: subSchema, root: root, visited: visited) {
          return properties
        }
      }
    }
    return nil
  }

  /// Returns whether a schema references a shared definition, directly, through a local `$ref`,
  /// or through `allOf`, `anyOf`, or `oneOf`.
  private static func mixesIn(
    _ definition: String,
    schema: JSONValue,
    root: JSONValue,
    visited: Set<String>
  ) -> Bool {
    var visited = visited
    if let ref = schema["$ref"]?.stringValue {
      if referencedDefinition(of: schema) == definition {
        return true
      }
      if ref.hasPrefix("#"), visited.insert(ref).inserted,
        let target = resolveLocalRef(ref, in: root),
        mixesIn(definition, schema: target, root: root, visited: visited)
      {
        return true
      }
    }
    for combiner in ["allOf", "anyOf", "oneOf"] {
      for subSchema in schema[combiner]?.arrayValue ?? []
      where mixesIn(definition, schema: subSchema, root: root, visited: visited) {
        return true
      }
    }
    return false
  }

  /// Returns whether a property schema is a list of `CheckRule`.
  private static func isCheckRuleList(_ schema: JSONValue) -> Bool {
    guard let items = schema["items"] else { return false }
    return referencedDefinition(of: items) == "CheckRule"
  }

  /// Returns the name of the definition that a schema's `$ref` or `REF:` description points to,
  /// such as `AccessibilityAttributes` for `common_types.json#/$defs/AccessibilityAttributes`.
  static func schemaRefName(_ schema: JSONValue) -> String? {
    if let refName = referencedDefinition(of: schema) {
      return refName
    }
    if let desc = schema["description"]?.stringValue, desc.hasPrefix("REF:") {
      let ref = String(desc.dropFirst(4)).split(separator: "|").first.map(String.init) ?? ""
      return ref.split(separator: "/").last.map(String.init)
    }
    return nil
  }

  /// Returns whether `schema` declares `propertyKey` directly or through combiners/`$ref`.
  static func schemaContainsPropertyKey(
    _ propertyKey: String,
    in schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> Bool {
    if schema["properties"]?.objectValue?[propertyKey] != nil {
      return true
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, visitedRefs.insert(ref).inserted,
      let resolved = resolveSchemaRef(ref, root: root),
      schemaContainsPropertyKey(
        propertyKey,
        in: resolved.schema,
        root: resolved.root,
        visitedRefs: visitedRefs
      )
    {
      return true
    }
    for combiner in ["allOf", "oneOf", "anyOf"] {
      if let branches = schema[combiner]?.arrayValue,
        branches.contains(where: {
          schemaContainsPropertyKey(propertyKey, in: $0, root: root, visitedRefs: visitedRefs)
        })
      {
        return true
      }
    }
    return false
  }

  /// Returns the name of the definition that a schema's `$ref` points to, such as
  /// `AccessibilityAttributes` for `common_types.json#/$defs/AccessibilityAttributes`.
  private static func referencedDefinition(of schema: JSONValue) -> String? {
    guard let ref = schema["$ref"]?.stringValue else { return nil }
    return ref.split(separator: "/").last.map(String.init)
  }

  /// Pure dynamic expression `$defs` names in `common_types.json` that must never carry
  /// component-property directives such as `@child`, `@action`, or `@functionCall`.
  private static let pureDynamicDefNames: Set<String> = [
    "DynamicValue",
    "DynamicString",
    "DynamicNumber",
    "DynamicBoolean",
    "DynamicStringList",
    "DataBinding",
    "FunctionCall",
  ]

  /// Finds the schema of a property declared anywhere in `schema`, including via local or remote
  /// `$ref`, `allOf`/`anyOf`/`oneOf`, or object-valued `additionalProperties`.
  static func resolvedSubschema(
    forProperty key: String,
    in schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> JSONValue? {
    if let declared = declaredSubschemaWithoutWildcard(
      forProperty: key,
      in: schema,
      root: root,
      visitedRefs: visitedRefs
    ) {
      return declared
    }
    return additionalPropertiesSubschema(in: schema, root: root, visitedRefs: visitedRefs)
  }

  private static func declaredSubschemaWithoutWildcard(
    forProperty key: String,
    in schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String>
  ) -> JSONValue? {
    if let direct = schema["properties"]?.objectValue?[key] {
      return direct
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, visitedRefs.insert(ref).inserted,
      let resolved = resolveSchemaRef(ref, root: root),
      let found = declaredSubschemaWithoutWildcard(
        forProperty: key,
        in: resolved.schema,
        root: resolved.root,
        visitedRefs: visitedRefs
      )
    {
      return found
    }
    for combiner in ["allOf", "anyOf", "oneOf"] {
      for subSchema in schema[combiner]?.arrayValue ?? [] {
        if let found = declaredSubschemaWithoutWildcard(
          forProperty: key,
          in: subSchema,
          root: root,
          visitedRefs: visitedRefs
        ) {
          return found
        }
      }
    }
    return nil
  }

  private static func additionalPropertiesSubschema(
    in schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String>
  ) -> JSONValue? {
    if let additional = schema["additionalProperties"], additional.objectValue != nil {
      return additional
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, visitedRefs.insert(ref).inserted,
      let resolved = resolveSchemaRef(ref, root: root),
      let found = additionalPropertiesSubschema(
        in: resolved.schema,
        root: resolved.root,
        visitedRefs: visitedRefs
      )
    {
      return found
    }
    for combiner in ["allOf", "anyOf", "oneOf"] {
      for subSchema in schema[combiner]?.arrayValue ?? [] {
        if let found = additionalPropertiesSubschema(
          in: subSchema,
          root: root,
          visitedRefs: visitedRefs
        ) {
          return found
        }
      }
    }
    return nil
  }

  /// Finds the `items` schema of an array schema, following `$ref` and combiners.
  static func resolvedArrayItemsSchema(
    in schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> JSONValue? {
    if let items = schema["items"] {
      return items
    }
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue, visitedRefs.insert(ref).inserted,
      let resolved = resolveSchemaRef(ref, root: root),
      let items = resolvedArrayItemsSchema(
        in: resolved.schema,
        root: resolved.root,
        visitedRefs: visitedRefs
      )
    {
      return items
    }
    for combiner in ["allOf", "anyOf", "oneOf"] {
      for subSchema in schema[combiner]?.arrayValue ?? [] {
        if let items = resolvedArrayItemsSchema(
          in: subSchema,
          root: root,
          visitedRefs: visitedRefs
        ) {
          return items
        }
      }
    }
    return nil
  }

  /// Returns whether `schema` constrains a pure dynamic expression or value (`DynamicValue`,
  /// `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, `DataBinding`,
  /// or `FunctionCall`).
  static func isPureDynamicSchema(
    _ schema: JSONValue,
    root: JSONValue,
    visitedRefs: Set<String> = []
  ) -> Bool {
    var visitedRefs = visitedRefs
    if let ref = schema["$ref"]?.stringValue {
      if let defName = referencedDefinition(of: schema), pureDynamicDefNames.contains(defName) {
        if ref.hasPrefix("#"), let target = resolveLocalRef(ref, in: root),
          target != schema,
          !isPureDynamicSchema(target, root: root, visitedRefs: visitedRefs)
        {
          return false
        }
        return true
      }
      if visitedRefs.insert(ref).inserted,
        let resolved = resolveSchemaRef(ref, root: root),
        isPureDynamicSchema(resolved.schema, root: resolved.root, visitedRefs: visitedRefs)
      {
        return true
      }
    }
    if let allOf = schema["allOf"]?.arrayValue,
      allOf.contains(where: {
        isPureDynamicSchema($0, root: root, visitedRefs: visitedRefs)
      })
    {
      return true
    }
    for combiner in ["oneOf", "anyOf"] {
      if let subSchemas = schema[combiner]?.arrayValue, !subSchemas.isEmpty {
        let hasDynamic = subSchemas.contains {
          isPureDynamicSchema($0, root: root, visitedRefs: visitedRefs)
        }
        let allDynamicOrNull = subSchemas.allSatisfy {
          $0["type"]?.stringValue == "null"
            || isPureDynamicSchema($0, root: root, visitedRefs: visitedRefs)
        }
        if hasDynamic && allDynamicOrNull {
          return true
        }
      }
    }
    return false
  }

  /// Resolves a `$ref` against `root` or the registered `A2UICommonSchema` documents.
  static func resolveSchemaRef(
    _ ref: String,
    root: JSONValue
  ) -> (schema: JSONValue, root: JSONValue)? {
    if ref.hasPrefix("#") {
      guard let target = resolveLocalRef(ref, in: root) else { return nil }
      return (target, root)
    }
    guard let hashIndex = ref.firstIndex(of: "#") else { return nil }
    let docURI = String(ref[..<hashIndex])
    let fragment = String(ref[hashIndex...])
    if let doc = A2UICommonSchema.allSchemas[docURI],
      let target = resolveLocalRef(fragment, in: doc)
    {
      return (target, doc)
    }
    if (docURI.hasSuffix("/common_types.json") || docURI == "common_types.json"),
      let target = resolveLocalRef(fragment, in: A2UICommonSchema.v10Document)
    {
      return (target, A2UICommonSchema.v10Document)
    }
    return nil
  }

  /// Resolves a local `$ref` such as `#/$defs/Common` against the schema's root document.
  static func resolveLocalRef(_ ref: String, in root: JSONValue) -> JSONValue? {
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
