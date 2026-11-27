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

import A2UICore
import OrderedJSON
import Testing

private struct CanonicalRangeCheckFunction: FunctionImplementation {
  let api = FunctionAPI(
    definition: FunctionDefinition(
      name: "inRange",
      description: "Validates that a numeric value satisfies at least one bound.",
      returnType: .validationResult,
      allowedCallers: .rendererOrAgent,
      parameters: [
        .number("value", dynamic: true, required: true, description: "Number to check."),
        .number("min", description: "Minimum bound."),
        .number("max", description: "Maximum bound."),
      ],
      atLeastOneOf: [["min", "max"]]
    )
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    guard let value = arguments["value"]?.doubleValue else {
      return .object(["valid": .boolean(false)])
    }
    if let minVal = arguments["min"]?.doubleValue, value < minVal {
      return .object(["valid": .boolean(false)])
    }
    if let maxVal = arguments["max"]?.doubleValue, value > maxVal {
      return .object(["valid": .boolean(false)])
    }
    return .object(["valid": .boolean(true)])
  }
}

private struct CanonicalNegateFunction: FunctionImplementation {
  let api = FunctionAPI(
    definition: FunctionDefinition(
      name: "negate",
      description: "Negates a boolean or validation result.",
      returnType: .boolean,
      parameters: [
        .boolean("value", dynamic: true, required: true)
      ]
    )
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    let flag = arguments["value"]?.boolValue ?? false
    return .boolean(!flag)
  }
}

private struct CanonicalEchoFunction: FunctionImplementation {
  let api = FunctionAPI(
    definition: FunctionDefinition(
      name: "echo",
      description: "Returns a greeting with optional suffix.",
      returnType: .string,
      allowedCallers: .rendererOrAgent,
      parameters: [
        .string("text", required: true),
        .string("suffix", defaultValue: "!"),
      ]
    )
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    let text = arguments["text"]?.stringValue ?? ""
    let suffix = arguments["suffix"]?.stringValue ?? "!"
    return .string(text + suffix)
  }
}

private final class CapturingActionHandler: ActionHandling, @unchecked Sendable {
  var actions: [ResolvedAction] = []
  var errors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {
    actions.append(action)
  }

  func handle(error: RendererError, from surfaceID: String) {
    errors.append(error)
  }
}

@MainActor
private final class LocalTestFunctionHandler: FunctionHandler {
  let catalog: AnyCatalog
  var reportedErrors: [any Error] = []
  var lastAgentCall: AgentFunctionCall?

  init(catalog: AnyCatalog) {
    self.catalog = catalog
  }

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    catalog.functions[name]
  }

  func handleFunctionError(_ error: any Error, functionName: String) {
    reportedErrors.append(error)
  }

  func catalogTypes(forCatalogID catalogID: String?) -> [String: TypeDefinition] {
    catalog.types
  }

  func agentFunctionCatalogID(forCallCatalogID catalogID: String?) -> String? {
    catalogID ?? catalog.id
  }

  func agentFunctionValue(for call: AgentFunctionCall) -> JSONValue? {
    lastAgentCall = call
    return .string("agent-ok")
  }
}

/// Tests pure canonical `CatalogModel` authoring, Catalog Document encoding/decoding,
/// auto-detection, negative validation invariants, and end-to-end runtime execution without
/// importing `JSONSchema`.
struct CatalogModelTests {

  private func makeCanonicalCatalog() -> AnyCatalog {
    let stack = ComponentDefinition(
      name: "Stack",
      description: "Vertical container component.",
      parameters: [
        .childList("children", required: true, description: "Child component IDs or template."),
        .enum("align", values: ["start", "center", "end"], defaultValue: "start"),
        .ref("weight", to: "Weight"),
      ],
      allowedChildren: ["Label", "Input", "Panel", "ActionButton"]
    )
    let panel = ComponentDefinition(
      name: "Panel",
      description: "Single-child card container.",
      parameters: [
        .child("child", required: true),
        .ref("weight", to: "Weight"),
      ],
      allowedParents: ["Surface", "Stack"]
    )
    let label = ComponentDefinition(
      name: "Label",
      description: "Displays dynamic text.",
      parameters: [
        .string("text", dynamic: true, required: true, minLength: 1),
        .number("opacity", dynamic: true, min: 0, max: 1),
        .integer("maxLines", min: 1, max: 10),
        .boolean("highlighted", dynamic: true, defaultValue: false),
        .array("tags", items: .string(), dynamic: true),
        .const("kind", value: "label"),
        .any("payload", dynamic: true, nullable: true),
        .object(
          "meta",
          properties: [.string("author", required: true)],
          additionalProperties: .typed(.string())
        ),
        .union(
          "icon",
          variants: [
            .enum(values: ["star", "check"]),
            .object(properties: [.string("svgPath", dynamic: true, required: true)]),
            .dataBinding(),
          ]
        ),
        .string("scheduledAt", dynamic: true, formats: ["date", "time", "date-time"]),
        .string("link", format: "uri"),
        .dataBinding("rawBinding"),
        .functionCall("rawCall"),
        .accessibility("customA11y"),
        .checkRule("singleRule"),
      ],
      metadata: ["extensions": .object(["acme_tier": .string("core")])]
    )
    let input = ComponentDefinition(
      name: "Input",
      description: "Checkable numeric input.",
      isCheckable: true,
      parameters: [
        .string("label", dynamic: true, required: true),
        .number("value", dynamic: true, required: true),
      ]
    )
    let actionButton = ComponentDefinition(
      name: "ActionButton",
      description: "Interactive button.",
      isCheckable: true,
      parameters: [
        .child("child", required: true),
        .action("action", required: true),
      ]
    )
    let remoteSearch = SchemaOnlyFunction(
      api: FunctionAPI(
        definition: FunctionDefinition(
          name: "remoteSearch",
          description: "Agent-side search function.",
          returnType: .data(.array(items: .string())),
          allowedCallers: .rendererOnly,
          parameters: [
            .string("query", required: true),
            .integer("limit", min: 1, max: 50, defaultValue: 10),
          ]
        )
      )
    )

    return AnyCatalog(
      id: "https://example.com/catalogs/canonical-v1",
      protocolVersion: .v10,
      components: [stack, panel, label, input, actionButton].map {
        AnyComponentAPI(definition: $0)
      },
      functions: [
        CanonicalRangeCheckFunction(),
        CanonicalNegateFunction(),
        CanonicalEchoFunction(),
        remoteSearch,
      ],
      instructions: "Prefer Stack and Label for structured layouts.",
      surfaceProperties: SurfacePropertiesDefinition(
        description: "Surface styling options.",
        properties: [
          .string("primaryColor", pattern: "^#[0-9a-fA-F]{6}$"),
          .string("iconUrl", format: "uri"),
        ],
        additionalProperties: false
      ),
      title: "Canonical Example Catalog",
      description: "Authored purely with Swift value types.",
      types: [
        "Weight": .number(min: 0, description: "Relative flex weight.")
      ],
      metadata: ["extensions": .object(["acme_owner": .string("design-systems")])]
    )
  }

  // MARK: - Authoring & Catalog Document Round-Trip

  @Test func pureModelAuthoringAndDocumentRoundTrip() throws {
    let catalog = makeCanonicalCatalog()
    #expect(catalog.components["Label"]?.definition.isCanonical == true)
    #expect(catalog.functions["inRange"]?.api.definition.isCanonical == true)

    let document = try catalog.toDocument()
    #expect(CatalogDocumentCodec.isCatalogDocument(document))
    #expect(document["formatVersion"] == .string("1.0"))
    #expect(document["catalogId"] == .string("https://example.com/catalogs/canonical-v1"))
    #expect(document["protocolVersion"] == .string("1.0"))
    #expect(document["instructions"] == .string("Prefer Stack and Label for structured layouts."))

    // Preserves component declaration order.
    let encodedNames = document["components"]?.arrayValue?.compactMap { $0["name"]?.stringValue }
    #expect(encodedNames == ["Stack", "Panel", "Label", "Input", "ActionButton"])

    let decoded = try Catalog.fromDocument(document)
    #expect(decoded.id == catalog.id)
    #expect(decoded.title == catalog.title)
    #expect(decoded.description == catalog.description)
    #expect(decoded.instructions == catalog.instructions)
    #expect(decoded.types == catalog.types)
    #expect(decoded.surfaceProperties == catalog.surfaceProperties)
    #expect(decoded.model == catalog.model)

    // Auto-detection via Catalog.fromJSON routes Catalog Documents to fromDocument.
    let autoLoaded = try Catalog.fromJSON(document)
    #expect(autoLoaded.model == catalog.model)

    // Legacy JSON Schema auto-detection via Catalog.fromJSON.
    let legacyJSON = catalog.toJSON(protocolVersion: .v10)
    #expect(!CatalogDocumentCodec.isCatalogDocument(legacyJSON))
    let fromLegacy = try Catalog.fromJSON(legacyJSON)
    #expect(Set(fromLegacy.components.keys) == Set(catalog.components.keys))
    #expect(
      Set(fromLegacy.functions.keys.filter { !$0.hasPrefix("@") })
        == Set(catalog.functions.keys.filter { !$0.hasPrefix("@") })
    )
  }

  // MARK: - Negative Catalog Document Validation

  @Test func rejectsUnsupportedFormatVersionInFromDocumentAndFromJSON() {
    let doc: JSONValue = [
      "formatVersion": "2.0",
      "catalogId": "https://example.com/future",
    ]
    #expect(CatalogDocumentCodec.isCatalogDocument(doc))
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromDocument(doc)
    }
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromJSON(doc)
    }
  }

  @Test func rejectsReservedSurfaceComponentName() {
    let doc: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-surface",
      "components": [["name": "Surface"]],
    ]
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromDocument(doc)
    }
  }

  @Test func rejectsAtPrefixedFunctionName() {
    let doc: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-fn",
      "functions": [["name": "@custom", "returnType": "boolean"]],
    ]
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromDocument(doc)
    }
  }

  @Test func rejectsRequiresUserActivationWithNonRendererOnlyCallers() {
    for callers in ["agentOnly", "rendererOrAgent"] {
      let doc: JSONValue = [
        "formatVersion": "1.0",
        "catalogId": "https://example.com/bad-callers",
        "functions": [
          [
            "name": "openLink",
            "returnType": "void",
            "allowedCallers": .string(callers),
            "requiresUserActivation": true,
          ]
        ],
      ]
      #expect(throws: A2UICatalogError.self) {
        _ = try Catalog.fromDocument(doc)
      }
    }
  }

  @Test func rejectsInvalidUAX31IdentifiersAndUnknownRootKeys() {
    let invalidCompDoc: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-id",
      "components": [["name": "bad-name"]],
    ]
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromDocument(invalidCompDoc)
    }

    let unknownRootKeyDoc: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/extra",
      "unexpectedField": true,
    ]
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromDocument(unknownRootKeyDoc)
    }
  }

  @Test func rejectsDuplicateNamesUnresolvedRefsCyclicRefsAndComponentTypesInDataScope() {
    let duplicateComp: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/dup",
      "components": [["name": "Card"], ["name": "Card"]],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(duplicateComp) }

    let unresolvedRef: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/ref",
      "components": [
        [
          "name": "Card",
          "parameters": [["name": "weight", "type": "ref", "ref": "MissingType"]],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(unresolvedRef) }

    let cyclicRef: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/cycle",
      "types": [
        "A": ["type": "ref", "ref": "B"],
        "B": ["type": "ref", "ref": "A"],
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(cyclicRef) }

    let componentTypeInFunction: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/fn-child",
      "functions": [
        [
          "name": "badFn",
          "returnType": "boolean",
          "parameters": [["name": "target", "type": "child"]],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(componentTypeInFunction) }

    let envelopeParamInComponent: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/env-param",
      "components": [
        [
          "name": "Card",
          "parameters": [["name": "id", "type": "string"]],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromDocument(envelopeParamInComponent)
    }

    let badAtLeastOneOf: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-group",
      "functions": [
        [
          "name": "bounded",
          "returnType": "boolean",
          "parameters": [["name": "min", "type": "number"]],
          "atLeastOneOf": [["min", "missingMax"]],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(badAtLeastOneOf) }
  }

  // MARK: - Canonical PayloadValidator, GraphTopologyValidator & ComponentEnvelope

  @Test func canonicalPayloadValidationEnforcesConstraintsFormatsAndMixins() throws {
    let catalog = makeCanonicalCatalog()
    let validator = PayloadValidator(catalog: catalog, config: .strict)

    // Valid component with dynamic bindings, ISO-8601 date/time, URI, union, @accessibility.
    try validator.validateComponent([
      "id": "lbl1",
      "component": "Label",
      "text": ["@path": "/greeting"],
      "opacity": 0.75,
      "maxLines": 3,
      "scheduledAt": "2026-04-01",
      "link": "https://a2ui.org/docs",
      "icon": ["svgPath": "M0 0 L10 10"],
      "@accessibility": ["label": "Greeting", "live": "polite", "hidden": false],
    ])
    try validator.validateComponent([
      "id": "lbl2",
      "component": "Label",
      "text": "Hello",
      "scheduledAt": "14:30:00",
    ])
    try validator.validateComponent([
      "id": "lbl3",
      "component": "Label",
      "text": "Hello",
      "scheduledAt": "2026-04-01T14:30:00.000Z",
    ])

    // Rejects invalid ISO-8601 date/time format.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "lblBadDate",
        "component": "Label",
        "text": "Hello",
        "scheduledAt": "not-a-date",
      ])
    }

    // Rejects invalid URI format.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "lblBadUri",
        "component": "Label",
        "text": "Hello",
        "link": "no-scheme-here",
      ])
    }

    // Rejects @checks on non-checkable component, accepts @checks on checkable Input.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "lblChecks",
        "component": "Label",
        "text": "Hello",
        "@checks": [
          [
            "condition": ["@call": "inRange", "args": ["value": 5, "min": 1]],
            "message": "Out of range",
          ]
        ],
      ])
    }
    try validator.validateComponent([
      "id": "inp1",
      "component": "Input",
      "label": "Age",
      "value": ["@path": "/age"],
      "@checks": [
        [
          "condition": ["@call": "inRange", "args": ["value": ["@path": "/age"], "min": 18]],
          "message": "Must be 18+",
        ]
      ],
    ])

    // Enforces atLeastOneOf on function calls (including dynamic args without Schema
    // recompilation).
    #expect(throws: A2UIValidationError.self) {
      try validator.validateFunction(name: "inRange", args: ["value": 5])
    }
    try validator.validateFunction(name: "inRange", args: ["value": 5, "min": 1])

    // Enforces canonical surfaceProperties theme validation (regex pattern + URI + closed object).
    try validator.validateTheme([
      "primaryColor": "#1A2B3C",
      "iconUrl": "https://example.com/icon.png",
    ])
    #expect(throws: A2UIValidationError.self) {
      try validator.validateTheme(["primaryColor": "not-a-hex"])
    }
    #expect(throws: A2UIValidationError.self) {
      try validator.validateTheme(["unknownThemeKey": "nope"])
    }
  }

  @Test func canonicalGraphTopologyExtractionAndCompositionConstraints() throws {
    let catalog = makeCanonicalCatalog()
    let stackComp: [String: JSONValue] = [
      "id": "root",
      "component": "Stack",
      "children": ["panel1", "label1"],
    ]
    let panelComp: [String: JSONValue] = [
      "id": "panel1",
      "component": "Panel",
      "child": "label1",
    ]
    let labelComp: [String: JSONValue] = [
      "id": "label1",
      "component": "Label",
      "text": "Hi",
    ]

    let stackDef = try #require(catalog.components["Stack"]?.definition)
    let refs = GraphTopologyValidator.extractReferences(
      from: stackComp,
      definition: stackDef,
      types: catalog.types
    )
    #expect(refs.map(\.referenceID) == ["panel1", "label1"])

    try GraphTopologyValidator.validate(
      components: [stackComp, panelComp, labelComp],
      rootID: "root",
      config: .strict,
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id
    )

    // Dangling child detected via canonical ComponentDefinition traversal.
    #expect(throws: A2UIIntegrityError.self) {
      try GraphTopologyValidator.validate(
        components: [
          ["id": "root", "component": "Panel", "child": "missingChild"]
        ],
        rootID: "root",
        config: .strict,
        catalogs: [catalog.id: catalog],
        defaultCatalogID: catalog.id
      )
    }

    // Disallowed parent detected (Panel allows only Surface and Stack, not Panel).
    #expect(throws: A2UIValidationError.self) {
      try GraphTopologyValidator.validate(
        components: [
          ["id": "root", "component": "Panel", "child": "innerPanel"],
          ["id": "innerPanel", "component": "Panel", "child": "leaf"],
          ["id": "leaf", "component": "Label", "text": "Leaf"],
        ],
        rootID: "root",
        config: .strict,
        catalogs: [catalog.id: catalog],
        defaultCatalogID: catalog.id
      )
    }
  }

  // MARK: - End-to-End MessageProcessor, NodeResolver, DataContext, RPCHandler & Capabilities

  @Test @MainActor func endToEndRuntimeOnDocumentLoadedCatalog() throws {
    let authored = makeCanonicalCatalog()
    let document = try authored.toDocument()
    let loaded = try Catalog.fromDocument(
      document,
      functions: [
        CanonicalRangeCheckFunction(),
        CanonicalNegateFunction(),
        CanonicalEchoFunction(),
      ]
    )

    let handler = CapturingActionHandler()
    let processor = MessageProcessor(
      catalog: loaded,
      actionHandler: handler,
      validationConfig: .strict
    )

    let payload: JSONValue = [
      [
        "version": "1.0",
        "createSurface": [
          "surfaceId": "s1",
          "catalogId": .string(loaded.id),
        ],
      ],
      [
        "version": "1.0",
        "updateDataModel": [
          "surfaceId": "s1",
          "path": "/",
          "value": [
            "title": "Welcome",
            "score": 42,
            "tags": ["swift", "a2ui"],
            "a11yLabel": "Score Input",
          ],
        ],
      ],
      [
        "version": "1.0",
        "updateComponents": [
          "surfaceId": "s1",
          "components": [
            [
              "id": "root",
              "component": "Stack",
              "children": ["hdr", "scoreInput"],
            ],
            [
              "id": "hdr",
              "component": "Label",
              "text": ["@path": "/title"],
              "tags": ["@path": "/tags"],
              "maxLines": 2,
            ],
            [
              "id": "scoreInput",
              "component": "Input",
              "label": "Score",
              "value": ["@path": "/score"],
              "@accessibility": [
                "label": ["@path": "/a11yLabel"],
                "hidden": false,
              ],
              "@checks": [
                [
                  "condition": [
                    "@call": "inRange",
                    "args": ["value": ["@path": "/score"], "min": 10, "max": 100],
                  ],
                  "message": "Score must be between 10 and 100.",
                ]
              ],
            ],
          ],
        ],
      ],
    ]

    try processor.processMessages(payload)
    #expect(handler.errors.isEmpty)

    let surface = try #require(processor.surfaceGroupModel["s1"])
    let rootNode = try #require(surface.rootNode)
    #expect(rootNode.type == "Stack")
    let children = rootNode.children(for: "children")
    #expect(children.count == 2)

    let header = children[0]
    let textBinding: DataBinding<String> = try #require(header.dataBinding(for: "text"))
    #expect(textBinding.value == "Welcome")
    let tagsBinding: DataBinding<[String]> = try #require(header.dataBinding(for: "tags"))
    #expect(tagsBinding.value == ["swift", "a2ui"])
    #expect(header.int(for: "maxLines") == 2)

    let inputNode = children[1]
    let valueBinding: DataBinding<Double> = try #require(inputNode.dataBinding(for: "value"))
    #expect(valueBinding.value == 42)
    let a11y = try #require(inputNode.explicitAccessibilityAttributes)
    #expect(a11y.label == "Score Input")
    #expect(a11y.hidden == false)

    // Inline capabilities generation routes cleanly through CatalogJSONSchemaCodec.
    let caps = try processor.getRendererCapabilities(
      options: .init(protocolVersion: .v10, includeInlineCatalogs: true)
    )
    let inlineCatalog = try #require(caps["1.0"]?["inlineCatalogs"]?.arrayValue?.first)
    #expect(inlineCatalog["catalogId"] == .string(loaded.id))
    #expect(inlineCatalog["$defs"]?["Weight"]?["type"] == .string("number"))
    let inputAllOf = try #require(inlineCatalog["components"]?["Input"]?["allOf"]?.arrayValue)
    #expect(inputAllOf.count == 2)
    #expect(inputAllOf[0]["$ref"] == .string("common_types.json#/$defs/Checkable"))
    #expect(
      inputAllOf[1]["properties"]?["label"]?["$ref"]
        == .string("common_types.json#/$defs/DynamicString"))
    #expect(
      inlineCatalog["components"]?["Label"]?["properties"]?["text"]?["oneOf"]?.arrayValue?.first?[
        "minLength"
      ] == .integer(1))
    #expect(inlineCatalog["functions"]?["inRange"]?["returnType"] == .string("validationResult"))
  }

  @Test @MainActor func canonicalDataContextCoercionNullsDefaultsAndRPCHandler() async throws {
    let catalog = makeCanonicalCatalog()
    let dataModel = DataModel(initial: .object(["age": .integer(25)]))
    let fnHandler = LocalTestFunctionHandler(catalog: catalog)
    let context = DataContext(
      dataModel: dataModel,
      path: "/",
      functionHandler: fnHandler,
      protocolVersion: .v10
    )

    // ValidationResult returned by `inRange` is coerced to boolean for `negate`.
    let coercedResult = context.resolveDynamicValue([
      "@call": "negate",
      "args": [
        "value": [
          "@call": "inRange",
          "args": ["value": ["@path": "/age"], "min": 18],
        ]
      ],
    ])
    #expect(coercedResult == .boolean(false))
    #expect(fnHandler.reportedErrors.isEmpty)

    // Unbound path resolves to null; canonical local validator accepts null without Schema
    // recompilation and lets `inRange` return valid=false.
    let unboundResult = context.resolveDynamicValue([
      "@call": "inRange",
      "args": ["value": ["@path": "/missing"], "min": 1],
    ])
    #expect(unboundResult["valid"] == .boolean(false))
    #expect(fnHandler.reportedErrors.isEmpty)

    // Agent-routed SchemaOnlyFunction applies canonical default `limit: 10`.
    let agentResult = context.resolveDynamicValue([
      "@call": "remoteSearch",
      "args": ["query": "swift"],
    ])
    #expect(agentResult == .string("agent-ok"))
    let sentCall = try #require(fnHandler.lastAgentCall)
    #expect(sentCall.name == "remoteSearch")
    #expect(sentCall.args["limit"] == .integer(10))

    // RPCHandler validates canonical function arguments directly.
    let rpcHandler = RPCHandler()
    let rpcCall = CallRendererFunctionMessage(
      surfaceID: "s1",
      functionCallID: "call-1",
      callFunction: CallFunctionPayload(
        call: "echo",
        catalogID: catalog.id,
        args: ["text": .string("hello")]
      ),
      version: .v10
    )
    let response = await rpcHandler.handleIncomingCall(
      rpcCall,
      catalogs: [catalog.id: catalog],
      defaultCatalogID: catalog.id,
      dataContext: context
    )
    #expect(response.value == .string("hello!"))
    #expect(response.error == nil)
  }

  // MARK: - Recursive Types, Composition, and Format Edge Cases

  @Test func structuralCyclicRefsValidateAtArbitraryDepthAndRoundTrip() throws {
    let catalog = AnyCatalog(
      model: CatalogModel(
        catalogID: "https://example.com/catalogs/recursive",
        protocolVersion: "1.0",
        types: [
          "TreeNode": .object(
            properties: [
              .string("label", required: true),
              .ref("child", to: "TreeNode"),
              .ref("sibling", to: "TreeNode"),
            ],
            additionalProperties: .disallowed
          ),
          "NestedList": .array(
            items: .union(variants: [.string(), .ref("NestedList")])
          ),
          "Expr": .union(
            variants: [.ref("Expr"), .string()],
            exclusive: true
          ),
        ],
        components: [
          ComponentDefinition(
            name: "Tree",
            parameters: [
              .ref("root", to: "TreeNode", required: true),
              .ref("matrix", to: "NestedList"),
              .ref("expr", to: "Expr"),
            ]
          )
        ]
      )
    )

    // Catalog Document round-trip preserves structural recursion.
    let doc = try catalog.toDocument()
    let fromDoc = try Catalog.fromDocument(doc)
    #expect(fromDoc.model == catalog.model)

    // JSON Schema round-trip preserves self-recursive `$defs`.
    let jsonSchema = catalog.toJSON(protocolVersion: .v10)
    let fromSchema = try Catalog.fromJSON(jsonSchema)
    #expect(fromSchema.types["TreeNode"] == catalog.types["TreeNode"])
    #expect(fromSchema.types["NestedList"] == catalog.types["NestedList"])
    #expect(fromSchema.types["Expr"] == catalog.types["Expr"])

    // Standalone Schema compilation attaches `$defs` instead of falling back to emptyObjectSchema.
    let compiled = try CatalogJSONSchemaCodec.compileComponentSchema(
      try #require(catalog.components["Tree"]?.definition),
      protocolVersion: .v10,
      localTypes: catalog.types
    )
    #expect(compiled.jsonValue["$defs"]?["TreeNode"] != nil)

    // PayloadValidator validates nested recursive levels and never false-matches cyclic union refs.
    let validator = PayloadValidator(catalog: fromDoc, config: .strict)
    try validator.validateComponent([
      "id": "t1",
      "component": "Tree",
      "root": [
        "label": "root",
        "child": ["label": "level1", "child": ["label": "level2"]],
        "sibling": ["label": "sib"],
      ],
      "matrix": ["a", ["b", ["c"]]],
      "expr": "hello",
    ])

    // Depth >= 2 invalid child value MUST be rejected (visitedRefs reset on sub-value descent).
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "t2",
        "component": "Tree",
        "root": ["label": "root", "child": 12345],
      ])
    }
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "t3",
        "component": "Tree",
        "root": ["label": "root"],
        "matrix": ["ok", [123]],
      ])
    }
    // Exclusive union `[Ref(Expr), String]` MUST reject non-string `12345` (fail-closed ref cycle).
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "t4",
        "component": "Tree",
        "root": ["label": "root"],
        "expr": 12345,
      ])
    }

    // GraphTopologyValidator extracts nested child references across recursive objects/arrays.
    let childTreeDef = ComponentDefinition(
      name: "GroupTree",
      parameters: [
        .object(
          "node",
          properties: [
            .child("target"),
            .array("items", items: .object(properties: [.child("itemTarget")])),
          ]
        )
      ]
    )
    let refs = GraphTopologyValidator.extractReferences(
      from: [
        "node": [
          "target": "c1",
          "items": [["itemTarget": "c2"], ["itemTarget": "c3"]],
        ]
      ],
      definition: childTreeDef
    )
    #expect(refs.map(\.referenceID) == ["c1", "c2", "c3"])
  }

  @Test func multipleAtLeastOneOfGroupsUseConjunctiveAllOfAndValidateBothGroups() throws {
    let comp = ComponentDefinition(
      name: "Filter",
      parameters: [.string("a"), .string("b"), .string("c"), .string("d")],
      atLeastOneOf: [["a", "b"], ["c", "d"]]
    )
    let catalog = AnyCatalog(
      model: CatalogModel(
        catalogID: "https://example.com/catalogs/multi-group",
        protocolVersion: "1.0",
        components: [comp]
      )
    )
    let json = catalog.toJSON(protocolVersion: .v10)
    let allOf = try #require(json["components"]?["Filter"]?["allOf"]?.arrayValue)
    #expect(allOf.count == 2)

    let reparsed = try Catalog.fromJSON(json)
    #expect(reparsed.components["Filter"]?.definition.atLeastOneOf == [["a", "b"], ["c", "d"]])

    let validator = PayloadValidator(catalog: reparsed, config: .strict)
    try validator.validateComponent(["id": "f1", "component": "Filter", "a": "1", "c": "2"])
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(["id": "f2", "component": "Filter", "a": "1"])
    }
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent(["id": "f3", "component": "Filter", "c": "2"])
    }
  }

  @Test func openComponentStillEnforcesClosedNestedObjectsAndBuiltins() throws {
    let rawV09Catalog: JSONValue = [
      "catalogId": "https://example.com/catalogs/v09-open",
      "components": [
        "OpenWidget": [
          "type": "object",
          "properties": [
            "component": ["const": "OpenWidget"],
            "nested": [
              "type": "object",
              "properties": ["allowed": ["type": "string"]],
              "additionalProperties": false,
            ],
            "action": [
              "$ref": "https://a2ui.org/specification/v0_9/common_types.json#/$defs/Action"
            ],
          ],
          "required": ["component"],
          "additionalProperties": true,
        ]
      ],
    ]
    let catalog = try Catalog.fromJSON(rawV09Catalog, protocolVersion: "v0.9")
    let validator = PayloadValidator(
      catalog: catalog, config: ValidationConfig(protocolVersion: .v09))

    // Extra key at component root is permitted by component `additionalProperties: true`.
    try validator.validateComponent([
      "id": "w1",
      "component": "OpenWidget",
      "extraRootKey": "ok",
      "nested": ["allowed": "yes"],
    ])
    // Extra key inside closed nested object MUST still be rejected.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "w2",
        "component": "OpenWidget",
        "nested": ["allowed": "yes", "forbidden": true],
      ])
    }
    // Extra key inside Action MUST still be rejected.
    #expect(throws: A2UIValidationError.self) {
      try validator.validateComponent([
        "id": "w3",
        "component": "OpenWidget",
        "action": ["event": ["name": "tap", "bogus": 1]],
      ])
    }
  }

  @Test func nonDynamicMultiFormatStringAndDynamicUnionRoundTripLosslessly() throws {
    let catalog = AnyCatalog(
      model: CatalogModel(
        catalogID: "https://example.com/catalogs/formats-and-unions",
        protocolVersion: "1.0",
        components: [
          ComponentDefinition(
            name: "Schedule",
            parameters: [
              .string("literalDate", dynamic: false, formats: ["date", "date-time"]),
              .union("value", variants: [.string(), .number()], exclusive: true, dynamic: true),
              .any("strictAny", dynamic: false, nullable: false),
            ]
          )
        ],
        functions: [
          FunctionDefinition(
            name: "getPayload",
            returnType: FunctionReturnDefinition(
              kind: .data(.object(additionalProperties: .allowed)),
              description: "Returns arbitrary JSON object."
            )
          )
        ]
      )
    )
    let json = catalog.toJSON(protocolVersion: .v10)
    let fromJSON = try Catalog.fromJSON(json)
    #expect(fromJSON.components["Schedule"]?.definition.isCanonical == true)
    #expect(
      fromJSON.components["Schedule"]?.definition == catalog.components["Schedule"]?.definition)

    let doc = try fromJSON.toDocument()
    let fromDoc = try Catalog.fromDocument(doc)
    #expect(
      fromDoc.components["Schedule"]?.definition == catalog.components["Schedule"]?.definition)

    // FunctionReturnDefinition.object uses `.allowed` and preserves `.data` description.
    let fnDoc = try catalog.toDocument()
    let encodedRet = fnDoc["functions"]?.arrayValue?.first?["returnType"]
    #expect(encodedRet?["type"] == .string("object"))
    #expect(encodedRet?["additionalProperties"] == .boolean(true))
    #expect(encodedRet?["description"] == .string("Returns arbitrary JSON object."))
  }

  @Test func documentCodecValidatesSemanticConstraintsOnBothDecodeAndEncode() throws {
    // Enum default not in values (decode).
    let badEnumDefault: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-enum",
      "components": [
        [
          "name": "Box",
          "parameters": [
            ["name": "size", "type": "enum", "values": ["sm", "lg"], "default": "xl"]
          ],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(badEnumDefault) }

    // Inverted bounds (min > max, minLength > maxLength, minItems > maxItems).
    let invertedBounds: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-bounds",
      "components": [
        [
          "name": "Box",
          "parameters": [["name": "count", "type": "integer", "min": 10, "max": 5]],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(invertedBounds) }

    // Invalid regex pattern.
    let badRegex: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-regex",
      "components": [
        [
          "name": "Box",
          "parameters": [["name": "code", "type": "string", "pattern": "[unclosed"]],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(badRegex) }

    // Non-nullable `any` with explicit `default: null`.
    let badNullDefault: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/bad-null",
      "components": [
        [
          "name": "Box",
          "parameters": [["name": "data", "type": "any", "nullable": false, "default": .null]],
        ]
      ],
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(badNullDefault) }

    // Explicit `null` on optional non-nullable key (`title`).
    let nullTitle: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/null-title",
      "title": .null,
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromDocument(nullTitle) }

    // Deep validation runs on `encode(_:)` for in-memory models too.
    let badInMemoryModel = CatalogModel(
      catalogID: "https://example.com/bad-encode",
      components: [
        ComponentDefinition(
          name: "Box",
          parameters: [.number("ratio", min: .nan)]
        )
      ]
    )
    #expect(throws: A2UICatalogError.self) { _ = try CatalogDocumentCodec.encode(badInMemoryModel) }

    // Catalog.fromJSON validates explicit catalogID / protocolVersion overrides.
    let validDoc: JSONValue = [
      "formatVersion": "1.0",
      "catalogId": "https://example.com/valid",
      "protocolVersion": "1.0",
    ]
    #expect(throws: A2UICatalogError.self) { _ = try Catalog.fromJSON(validDoc, catalogID: "") }
    #expect(throws: A2UICatalogError.self) {
      _ = try Catalog.fromJSON(validDoc, protocolVersion: "not-semver")
    }

    // Mutating FunctionAPI.returnType stays synced in `definition`.
    var fnAPI = FunctionAPI(definition: FunctionDefinition(name: "fn", returnType: .string))
    fnAPI.returnType = .boolean
    #expect(fnAPI.definition.returnType == .boolean)
  }

  @Test func strictFormatValidationUnicodeCodePointsWholeDoublesAndV09DynamicValue() throws {
    let catalog = AnyCatalog(
      model: CatalogModel(
        catalogID: "https://example.com/catalogs/strict-formats",
        protocolVersion: "1.0",
        components: [
          ComponentDefinition(
            name: "Form",
            parameters: [
              .string("date", format: "date"),
              .string("time", format: "time"),
              .string("dateTime", format: "date-time"),
              .string("email", format: "email"),
              .string("emoji", minLength: 1, maxLength: 2),
              .integer("count", min: 0),
              .number("ratio", min: 0, max: 1),
              .any("dynVal", dynamic: true, nullable: false),
            ]
          )
        ]
      )
    )
    let v10Validator = PayloadValidator(catalog: catalog, config: .strict)

    // Valid leap years, naive time, UTC leap second, emoji scalar count, whole-number double.
    try v10Validator.validateComponent([
      "id": "f1",
      "component": "Form",
      "date": "2024-02-29",
      "time": "14:30:00",
      "dateTime": "2024-02-29T23:59:60Z",
      "email": "user.name+tag@sub.example.com",
      "emoji": "😀",
      "count": .number(1.0),
      "ratio": .number(0.5),
      "dynVal": ["plain": "ok"],
    ])
    try v10Validator.validateComponent(["id": "f2", "component": "Form", "date": "2000-02-29"])

    // Invalid calendar dates (`2024-02-31`, `2023-02-29`, `1900-02-29`).
    for badDate in ["2024-02-31", "2023-02-29", "1900-02-29"] {
      #expect(throws: A2UIValidationError.self) {
        try v10Validator.validateComponent([
          "id": "d", "component": "Form", "date": .string(badDate),
        ])
      }
    }
    // Invalid times (`99:99:99`, non-23:59 leap second `12:34:60`).
    for badTime in ["99:99:99", "12:34:60"] {
      #expect(throws: A2UIValidationError.self) {
        try v10Validator.validateComponent([
          "id": "t", "component": "Form", "time": .string(badTime),
        ])
      }
    }
    // Timezone-less & space-separated `date-time` rejected.
    for badDT in ["2024-01-01T14:30:00", "2024-01-01 14:30:00Z"] {
      #expect(throws: A2UIValidationError.self) {
        try v10Validator.validateComponent([
          "id": "dt", "component": "Form", "dateTime": .string(badDT),
        ])
      }
    }
    // Malformed emails rejected.
    for badEmail in ["a@.", "a@.b", "a@b.", "a@b..c", "no-at-sign"] {
      #expect(throws: A2UIValidationError.self) {
        try v10Validator.validateComponent([
          "id": "e", "component": "Form", "email": .string(badEmail),
        ])
      }
    }
    // Multi-scalar family emoji `"👨‍👩‍👧‍👦"` has 7 Unicode scalars (> maxLength 2).
    #expect(throws: A2UIValidationError.self) {
      try v10Validator.validateComponent(["id": "em", "component": "Form", "emoji": "👨‍👩‍👧‍👦"])
    }
    // Non-finite `NaN` rejected on NumberType.
    #expect(throws: A2UIValidationError.self) {
      try v10Validator.validateComponent(["id": "n", "component": "Form", "ratio": .number(.nan)])
    }
    // v0.9 DynamicValue forbids plain objects.
    let v09Validator = PayloadValidator(
      catalog: catalog,
      config: ValidationConfig(allowUnknownElements: false, protocolVersion: .v09)
    )
    #expect(throws: A2UIValidationError.self) {
      try v09Validator.validateComponent([
        "id": "v9", "component": "Form", "dynVal": ["plain": "forbidden-in-v09"],
      ])
    }
  }
}
