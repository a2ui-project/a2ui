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
    #expect(catalog.components["Label"]?.hasCanonicalDefinition == true)
    #expect(catalog.functions["inRange"]?.api.hasCanonicalDefinition == true)

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
    #expect(
      inlineCatalog["components"]?["Input"]?["properties"]?["label"]?["$ref"]
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
}
