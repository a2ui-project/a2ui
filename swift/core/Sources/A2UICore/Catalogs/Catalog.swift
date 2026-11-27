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

import JSONSchema
import OrderedJSON

/// A protocol representing a catalog containing component definitions, functions, and optional
/// surface properties / theme schema.
///
/// `CatalogProtocol` exists primarily to support Swift existentials (e.g., `any CatalogProtocol`)
/// in heterogeneous collections. Because ``Catalog`` is generic over its component type
/// (`Catalog<Component>`), Swift does not allow heterogeneous arrays like `[Catalog<Component>]`
/// when elements have different generic types (such as mixing ``Catalog<ComponentImplementation>``
/// with type-erased ``Catalog<AnyComponentAPI>``).
///
/// By conforming ``Catalog`` to `CatalogProtocol`, framework APIs like `MessageProcessor` and
/// `SurfaceViewModel` can accept `[any CatalogProtocol]` and erase them to ``AnyCatalog`` without
/// requiring generic type parameters or forcing callers into complex type-erasure acrobatics.
public protocol CatalogProtocol: Sendable {
  /// Unique catalog identifier (conventionally a URI string).
  var id: String { get }

  /// Optional protocol version this catalog conforms to (e.g. "1.0" or "v0.9.1").
  var protocolVersion: String? { get }

  /// Optional human-readable catalog title.
  var title: String? { get }

  /// Optional human-readable catalog description.
  var description: String? { get }

  /// Optional theme schema for this catalog.
  var themeSchema: Schema? { get }

  /// Optional canonical surface properties definition (maps to v0.9 `theme`).
  var surfaceProperties: SurfacePropertiesDefinition? { get }

  /// Optional catalog-local reusable leaf data types.
  var types: [String: TypeDefinition] { get }

  /// Optional catalog-level static metadata and extensions.
  var metadata: [String: JSONValue]? { get }

  /// Optional Markdown design guidelines for this catalog, which agents add to the prompt alongside
  /// its components and functions.
  var instructions: String? { get }

  /// Map of function name → ``FunctionImplementation``.
  var functions: [String: any FunctionImplementation] { get }

  /// Erases this catalog's components to ``AnyComponentAPI``.
  func eraseToAnyCatalog() -> AnyCatalog
}

/// A collection of component definitions, function implementations, reusable local types, and
/// optional surface properties.
///
/// Mirrors `Catalog<T>` in the core blueprint and `web_core`.
public struct Catalog<Component: ComponentAPI>: CatalogProtocol, Sendable {
  /// Unique catalog identifier (conventionally a URI string).
  public var id: String

  /// Optional protocol version this catalog conforms to.
  public var protocolVersion: String?

  /// Optional human-readable catalog title.
  public var title: String?

  /// Optional human-readable catalog description.
  public var description: String?

  /// Map of component name → component implementation conforming to ``ComponentAPI``.
  public var components: [String: Component]

  /// Map of function name → ``FunctionImplementation``.
  public var functions: [String: any FunctionImplementation]

  /// Catalog-local reusable leaf data type definitions.
  public var types: [String: TypeDefinition]

  /// Optional catalog-level static metadata and extensions.
  public var metadata: [String: JSONValue]?

  /// Optional Markdown design guidelines for this catalog, which agents add to the prompt alongside
  /// its components and functions.
  public var instructions: String?

  private var storedThemeSchema: Schema?
  private var storedSurfaceProperties: SurfacePropertiesDefinition?
  private var orderedComponentNames: [String]
  private var orderedFunctionNames: [String]

  /// Optional theme schema for this catalog.
  public var themeSchema: Schema? {
    get {
      if let storedThemeSchema {
        return storedThemeSchema
      }
      return CatalogJSONSchemaCodec.compileSurfacePropertiesSchemaOrNil(
        storedSurfaceProperties,
        protocolVersion: a2uiProtocolVersion ?? .v091,
        localTypes: types
      )
    }
    set {
      storedThemeSchema = newValue
      storedSurfaceProperties = newValue.map {
        CatalogJSONSchemaCodec.surfacePropertiesDefinition(from: $0.jsonValue)
      }
    }
  }

  /// Optional canonical surface properties definition (maps to v0.9 `theme`).
  public var surfaceProperties: SurfacePropertiesDefinition? {
    get {
      storedSurfaceProperties
    }
    set {
      storedSurfaceProperties = newValue
      storedThemeSchema = nil
    }
  }

  /// Creates a catalog from arrays of components and functions.
  ///
  /// - Parameters:
  ///   - id: Unique catalog identifier.
  ///   - protocolVersion: Optional protocol version this catalog conforms to.
  ///   - components: Array of component definitions conforming to ``ComponentAPI``.
  ///   - functions: Array of function implementations (defaults to empty).
  ///   - themeSchema: Optional legacy theme `JSONSchema.Schema` (defaults to nil).
  ///   - instructions: Optional Markdown design guidelines for agents (defaults to nil).
  ///   - surfaceProperties: Optional canonical surface properties definition (defaults to nil).
  ///   - title: Optional human-readable catalog title (defaults to nil).
  ///   - description: Optional human-readable catalog description (defaults to nil).
  ///   - types: Catalog-local reusable leaf data types (defaults to empty).
  ///   - metadata: Optional catalog-level static metadata (defaults to nil).
  public init(
    id: String,
    protocolVersion: String? = nil,
    components: [Component],
    functions: [any FunctionImplementation] = [],
    themeSchema: Schema? = nil,
    instructions: String? = nil,
    surfaceProperties: SurfacePropertiesDefinition? = nil,
    title: String? = nil,
    description: String? = nil,
    types: [String: TypeDefinition] = [:],
    metadata: [String: JSONValue]? = nil
  ) {
    self.id = id
    self.protocolVersion = protocolVersion
    self.title = title
    self.description = description
    self.instructions = instructions
    self.types = types
    self.metadata = metadata

    var seenComponentNames: Set<String> = []
    var componentOrder: [String] = []
    var componentMap: [String: Component] = [:]
    for component in components {
      if seenComponentNames.insert(component.name).inserted {
        componentOrder.append(component.name)
      }
      componentMap[component.name] = component
    }
    self.components = componentMap
    self.orderedComponentNames = componentOrder

    var seenFunctionNames: Set<String> = []
    var functionOrder: [String] = []
    var functionMap: [String: any FunctionImplementation] = [:]
    for function in functions {
      if seenFunctionNames.insert(function.api.name).inserted {
        functionOrder.append(function.api.name)
      }
      functionMap[function.api.name] = function
    }
    self.storedThemeSchema = themeSchema
    self.storedSurfaceProperties =
      surfaceProperties
      ?? themeSchema.map {
        CatalogJSONSchemaCodec.surfacePropertiesDefinition(from: $0.jsonValue)
      }
    self.functions = functionMap
    self.orderedFunctionNames = functionOrder
    if self.isAtLeastV10 && self.functions["@index"] == nil {
      functionMap["@index"] = IndexFunction()
      self.functions = functionMap
    }
  }

  /// Creates a catalog with an `A2UIProtocolVersion` enum.
  public init(
    id: String,
    protocolVersion: A2UIProtocolVersion,
    components: [Component],
    functions: [any FunctionImplementation] = [],
    themeSchema: Schema? = nil,
    instructions: String? = nil,
    surfaceProperties: SurfacePropertiesDefinition? = nil,
    title: String? = nil,
    description: String? = nil,
    types: [String: TypeDefinition] = [:],
    metadata: [String: JSONValue]? = nil
  ) {
    self.init(
      id: id,
      protocolVersion: protocolVersion.rawValue,
      components: components,
      functions: functions,
      themeSchema: themeSchema,
      instructions: instructions,
      surfaceProperties: surfaceProperties,
      title: title,
      description: description,
      types: types,
      metadata: metadata
    )
  }

  /// Canonical JSON-Schema-independent ``CatalogModel`` representation of this catalog.
  public var model: CatalogModel {
    let orderedComponents = orderedComponentList.map(\.definition)
    let orderedFunctions =
      orderedFunctionList
      .filter { !$0.api.name.hasPrefix("@") }
      .map(\.api.definition)
    return CatalogModel(
      formatVersion: CatalogDocumentCodec.supportedFormatVersion,
      catalogID: id,
      protocolVersion: protocolVersion ?? "1.0",
      title: title,
      description: description,
      instructions: instructions,
      metadata: metadata,
      types: types,
      surfaceProperties: surfaceProperties,
      components: orderedComponents,
      functions: orderedFunctions
    )
  }

  /// Serializes this catalog to the decoupled A2UI Catalog Document format
  /// (`formatVersion: "1.0"`).
  ///
  /// - Returns: A Catalog Document `JSONValue`.
  /// - Throws: ``A2UICatalogError`` if this catalog violates Catalog Document invariants or
  ///   contains untranslatable raw JSON Schema fragments.
  public func toDocument() throws -> JSONValue {
    try CatalogDocumentCodec.encode(model)
  }

  /// Serializes this catalog to a backward-compatible JSON Schema catalog document.
  ///
  /// - Parameters:
  ///   - protocolVersion: Target protocol version (defaults to this catalog's version or `.v10`).
  ///   - componentEnvelopeRef: Optional pre-v1.0 component envelope `$ref`.
  /// - Returns: A JSON Schema catalog `JSONValue`.
  public func toJSON(
    protocolVersion: A2UIProtocolVersion? = nil,
    componentEnvelopeRef: String? = nil
  ) -> JSONValue {
    let targetVersion = protocolVersion ?? a2uiProtocolVersion ?? (isAtLeastV10 ? .v10 : .v091)
    return CatalogJSONSchemaCodec.toJSONSchema(
      model,
      protocolVersion: targetVersion,
      componentEnvelopeRef: componentEnvelopeRef
    )
  }

  /// Validates that all functions in this catalog satisfy caller and user activation constraints.
  ///
  /// - Throws: ``A2UICatalogError`` if any function sets `requiresUserActivation` to `true` while
  ///   `allowedCallers` is not `.rendererOnly`.
  public func validateFunctionCallerConstraints() throws {
    for function in functions.values {
      try function.api.validateCallerConstraints()
    }
  }

  /// Erases this catalog's components to ``AnyComponentAPI``, preserving canonical definitions
  /// without compiling JSON Schemas.
  public func eraseToAnyCatalog() -> Catalog<AnyComponentAPI> {
    let erasedComponents: [AnyComponentAPI] = orderedComponentList.map { component in
      if let already = component as? AnyComponentAPI {
        return already
      }
      let def = component.definition
      if def.isCanonical {
        return AnyComponentAPI(definition: def)
      }
      return AnyComponentAPI(
        name: component.name,
        schema: component.schema,
        allowedParents: component.allowedParents,
        allowedChildren: component.allowedChildren,
        metadata: component.metadata
      )
    }
    return Catalog<AnyComponentAPI>(
      id: id,
      protocolVersion: protocolVersion,
      components: erasedComponents,
      functions: orderedFunctionList,
      themeSchema: storedThemeSchema,
      instructions: instructions,
      surfaceProperties: storedSurfaceProperties,
      title: title,
      description: description,
      types: types,
      metadata: metadata
    )
  }

  /// Creates a catalog with a new ID from entries of this one, plus new entries.
  ///
  /// Use it to keep part of a catalog, such as the basic catalog, under an ID of your own:
  ///
  /// ```swift
  /// let chatCatalog = try basicCatalog.derive(
  ///   id: "https://example.com/catalogs/chat.json",
  ///   components: ["Text", "Image", "Row", "Column", "Button", .add(MyCarousel())],
  ///   functions: ["openUrl"]
  /// )
  /// ```
  ///
  /// The derived catalog keeps this catalog's protocol version, reusable types, and surface
  /// properties / theme schema. It does not keep this catalog's ``instructions``, which describe
  /// this catalog: instructions often name its ID and its components in their examples, so they
  /// would teach a model to write messages for the wrong catalog. `instructions` are the derived
  /// catalog's own.
  ///
  /// - Parameters:
  ///   - id: The derived catalog's ID.
  ///   - components: The components of the derived catalog. A name keeps this catalog's component
  ///     of that name, and a new entry is added. If `nil`, the derived catalog keeps every
  ///     component of this one.
  ///   - functions: The functions of the derived catalog, as for `components`. If `nil`, the
  ///     derived catalog keeps every function of this one.
  ///   - instructions: The derived catalog's Markdown design guidelines for agents. If `nil`, the
  ///     derived catalog has none.
  /// - Throws: ``A2UICatalogError`` if a name is not an entry of this catalog.
  public func derive(
    id: String,
    components: [DerivedCatalogEntry<Component>]? = nil,
    functions: [DerivedCatalogEntry<any FunctionImplementation>]? = nil,
    instructions: String? = nil
  ) throws -> Catalog<Component> {
    let derivedComponents = try components.map { entries in
      try entries.map { entry -> Component in
        switch entry {
        case .keep(let name):
          guard let component = self.components[name] else {
            throw A2UICatalogError("Catalog \"\(self.id)\" has no component \"\(name)\".")
          }
          return component
        case .add(let component):
          return component
        }
      }
    }
    let derivedFunctions = try functions.map { entries in
      try entries.map { entry -> any FunctionImplementation in
        switch entry {
        case .keep(let name):
          guard let function = self.functions[name] else {
            throw A2UICatalogError("Catalog \"\(self.id)\" has no function \"\(name)\".")
          }
          return function
        case .add(let function):
          return function
        }
      }
    }
    return Catalog(
      id: id,
      protocolVersion: protocolVersion,
      components: derivedComponents ?? orderedComponentList,
      functions: derivedFunctions ?? orderedFunctionList,
      themeSchema: storedThemeSchema,
      instructions: instructions,
      surfaceProperties: storedSurfaceProperties,
      types: types
    )
  }

  private var orderedComponentList: [Component] {
    var result: [Component] = []
    var seen: Set<String> = []
    for name in orderedComponentNames {
      if let component = components[name], seen.insert(name).inserted {
        result.append(component)
      }
    }
    for name in components.keys.sorted() where seen.insert(name).inserted {
      if let component = components[name] {
        result.append(component)
      }
    }
    return result
  }

  private var orderedFunctionList: [any FunctionImplementation] {
    var result: [any FunctionImplementation] = []
    var seen: Set<String> = []
    for name in orderedFunctionNames {
      if let function = functions[name], seen.insert(name).inserted {
        result.append(function)
      }
    }
    for name in functions.keys.sorted() where seen.insert(name).inserted {
      if let function = functions[name] {
        result.append(function)
      }
    }
    return result
  }
}

extension Catalog where Component == AnyComponentAPI {
  /// Creates an ``AnyCatalog`` directly from a canonical ``CatalogModel``.
  ///
  /// Any declared function whose name matches an implementation in `functions` uses that local
  /// implementation; all other declared functions are registered as ``SchemaOnlyFunction``s.
  public init(
    model: CatalogModel,
    functions: [any FunctionImplementation] = []
  ) {
    let implByName = Dictionary(
      functions.map { ($0.api.name, $0) },
      uniquingKeysWith: { _, last in last }
    )
    var resolvedFunctions: [any FunctionImplementation] = []
    var seenNames: Set<String> = []
    for fnDef in model.functions {
      seenNames.insert(fnDef.name)
      if let localImpl = implByName[fnDef.name] {
        resolvedFunctions.append(localImpl)
      } else {
        resolvedFunctions.append(SchemaOnlyFunction(api: FunctionAPI(definition: fnDef)))
      }
    }
    for extra in functions where !seenNames.contains(extra.api.name) {
      resolvedFunctions.append(extra)
    }

    self.init(
      id: model.catalogID,
      protocolVersion: model.protocolVersion,
      components: model.components.map { AnyComponentAPI(definition: $0) },
      functions: resolvedFunctions,
      themeSchema: nil,
      instructions: model.instructions,
      surfaceProperties: model.surfaceProperties,
      title: model.title,
      description: model.description,
      types: model.types,
      metadata: model.metadata
    )
  }

  /// Parses an A2UI Catalog Document (`formatVersion: "1.0"`) into an ``AnyCatalog``.
  ///
  /// - Parameters:
  ///   - document: Raw Catalog Document `JSONValue`.
  ///   - functions: Optional local function implementations bound by name.
  /// - Returns: A canonical ``AnyCatalog``.
  /// - Throws: ``A2UICatalogError`` when the document is invalid or has an unsupported
  ///   `formatVersion`.
  public static func fromDocument(
    _ document: JSONValue,
    functions: [any FunctionImplementation] = []
  ) throws -> AnyCatalog {
    let model = try CatalogDocumentCodec.decode(document)
    return AnyCatalog(model: model, functions: functions)
  }

  /// Parses either a decoupled A2UI Catalog Document (`formatVersion: "1.0"`) or a legacy v0.9 /
  /// v0.9.1 / v1.0 JSON Schema catalog into an ``AnyCatalog``.
  ///
  /// Format auto-detection checks ``CatalogDocumentCodec/isCatalogDocument(_:)``: any object
  /// declaring a string `formatVersion` is routed to ``fromDocument(_:functions:)`` (rejecting
  /// unsupported format versions with ``A2UICatalogError``); all other objects are parsed via
  /// ``CatalogJSONSchemaCodec/fromJSONSchema(_:catalogID:protocolVersion:)``.
  public static func fromJSON(
    _ json: JSONValue,
    catalogID: String? = nil,
    protocolVersion: String? = nil,
    functions: [any FunctionImplementation] = []
  ) throws -> AnyCatalog {
    if CatalogDocumentCodec.isCatalogDocument(json) {
      var model = try CatalogDocumentCodec.decode(json)
      if let catalogID {
        guard !catalogID.isEmpty else {
          throw A2UICatalogError("Catalog 'catalogId' override must be a non-empty string.")
        }
        model.catalogID = catalogID
      }
      if let protocolVersion {
        let normalized = CatalogDocumentCodec.normalizeProtocolVersion(protocolVersion)
        guard CatalogDocumentCodec.isValidSemVer(normalized) else {
          throw A2UICatalogError(
            "Catalog 'protocolVersion' override must be a valid SemVer string, got "
              + "'\(protocolVersion)'."
          )
        }
        model.protocolVersion = normalized
      }
      return AnyCatalog(model: model, functions: functions)
    }
    let model = try CatalogJSONSchemaCodec.fromJSONSchema(
      json,
      catalogID: catalogID,
      protocolVersion: protocolVersion
    )
    return AnyCatalog(model: model, functions: functions)
  }
}

extension CatalogProtocol {
  /// No title, for a conforming type that does not declare its own.
  public var title: String? { nil }

  /// No description, for a conforming type that does not declare its own.
  public var description: String? { nil }

  /// Synthesizes canonical surface properties from ``themeSchema`` when present.
  public var surfaceProperties: SurfacePropertiesDefinition? {
    themeSchema.map { CatalogJSONSchemaCodec.surfacePropertiesDefinition(from: $0.jsonValue) }
  }

  /// Empty local types map, for a conforming type that does not declare its own.
  public var types: [String: TypeDefinition] { [:] }

  /// No metadata, for a conforming type that does not declare its own.
  public var metadata: [String: JSONValue]? { nil }

  /// No instructions, for a conforming type that does not declare its own.
  public var instructions: String? { nil }

  /// The protocol version of this catalog as an `A2UIProtocolVersion` enum, if recognized.
  public var a2uiProtocolVersion: A2UIProtocolVersion? {
    guard let protocolVersion else { return nil }
    return A2UIProtocolVersion(lenientRawValue: protocolVersion)
  }

  /// Whether this catalog conforms to A2UI Protocol v1.0 or later.
  public var isAtLeastV10: Bool {
    if let a2uiProtocolVersion {
      return a2uiProtocolVersion >= .v10
    }
    guard let protocolVersion else { return false }
    let cleanVersion =
      protocolVersion.hasPrefix("v") ? String(protocolVersion.dropFirst()) : protocolVersion
    return cleanVersion.compare("1.0", options: .numeric) != .orderedAscending
  }
}

extension Dictionary where Key == String, Value: CatalogProtocol {
  /// Filters catalogs to those compatible with `protocolVersion`.
  public func filterCompatible(with protocolVersion: A2UIProtocolVersion?) -> [String: Value] {
    guard let protocolVersion else { return self }
    return filter { _, catalog in
      guard let catalogVersion = catalog.a2uiProtocolVersion else { return true }
      return catalogVersion.isAtLeastV10 == protocolVersion.isAtLeastV10
    }
  }

  /// Resolves the default catalog ID when not explicitly provided.
  public func resolveDefaultCatalogID(
    explicitDefaultID: String?,
    protocolVersion: A2UIProtocolVersion?
  ) -> String? {
    if let explicitDefaultID {
      return explicitDefaultID
    }
    let allCatalogsAtLeastV10 = !isEmpty && values.allSatisfy(\.isAtLeastV10)
    let isAtLeastV10 = protocolVersion?.isAtLeastV10 ?? allCatalogsAtLeastV10
    if !isAtLeastV10, count == 1 {
      return keys.first
    }
    return nil
  }

  /// Resolves the effective protocol version based on catalogs and default catalog ID.
  public func resolveExplicitProtocolVersion(
    requestedVersion: A2UIProtocolVersion?,
    defaultCatalogID: String?
  ) -> A2UIProtocolVersion? {
    if let requestedVersion {
      return requestedVersion
    }
    if let defaultCatalogID,
      let defaultCatalog = self[defaultCatalogID],
      let catalogVersion = defaultCatalog.a2uiProtocolVersion
    {
      return catalogVersion
    }
    if !isEmpty && values.allSatisfy(\.isAtLeastV10) {
      return .v10
    }
    if count == 1, let onlyCatalogVersion = values.first?.a2uiProtocolVersion {
      return onlyCatalogVersion
    }
    return nil
  }
}

/// A catalog whose components are erased to ``AnyComponentAPI``.
///
/// Its functions keep their implementations, so this is not the schema-only `CatalogApi` of the
/// core blueprint. Swift's ``Catalog`` is not generic over its function type, and nothing here
/// builds a catalog without implementations, so the Swift SDK has no `CatalogApi`.
public typealias AnyCatalog = Catalog<AnyComponentAPI>
