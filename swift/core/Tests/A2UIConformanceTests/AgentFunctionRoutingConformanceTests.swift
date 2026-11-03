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
import A2UIJSON
import BasicCatalog
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON
import Testing
import Yams

/// Collects the processor's outbound messages and the errors its surfaces report.
private final class RoutingRecorder: ActionHandling, @unchecked Sendable {
  var agentCalls: [CallAgentFunctionMessage] = []
  var actions: [RendererAction] = []
  var errors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    errors.append(error)
  }
}

/// Runs the shared `conformance/core/agent_function_routing.yaml` suite: the v1.0 fallback
/// routing of function calls to the agent with `callAgentFunction`.
///
/// Each evaluation is a `Probe` component under the root of surface `main`, resolved by the
/// surface's node resolver: a `binding` is its `value`, a `check` the condition of its only check
/// rule, an `action` the `functionCall` of its `onClick`, which the harness runs, and an `event`
/// the `event` of its `onClick`, which the harness runs and the processor dispatches.
@MainActor
struct AgentFunctionRoutingConformanceTests {
  private static let suite = "core/agent_function_routing.yaml"

  /// Cases this core's behavior does not fit, by name, with the reason.
  private static let knownDivergences: [String: String] = [
    "test_agent_routing_cancelled_call_is_sent_again_when_its_value_is_rewritten":
      "The data model does not notify subscribers when a path is set to an equal value, so the"
      + " binding does not re-evaluate; the rule is covered by"
      + " test_agent_routing_cancelled_call_is_sent_again_on_unrelated_change."
  ]

  @Test func agentFunctionRoutingConformance() async throws {
    // Composed rather than loaded, so that mappings keep the order the suite writes them in:
    // an event action's context entries resolve in that order.
    let yaml = try String(
      contentsOf: ConformanceTestHelper.conformanceDirectory.appendingPathComponent(Self.suite),
      encoding: .utf8
    )
    let cases = try Yams.compose(yaml: yaml).map(Self.orderedJSONValue)?.arrayValue ?? []
    #expect(!cases.isEmpty, "\(Self.suite) should hold test cases")

    for testCase in cases {
      let name = testCase["name"]?.stringValue ?? "<unnamed>"
      guard testCase["action"]?.stringValue == "route_agent_function" else {
        Issue.record("\(name): unexpected action in \(Self.suite)")
        continue
      }
      if let reason = Self.knownDivergences[name] {
        print("Skipping \(name): \(reason)")
        ConformanceManifest.record(suite: Self.suite, name: name, status: .skipped, reason: reason)
        continue
      }
      do {
        try await run(testCase, name: name)
        ConformanceManifest.record(suite: Self.suite, name: name, status: .passed)
      } catch {
        ConformanceManifest.record(
          suite: Self.suite, name: name, status: .failed, reason: "\(error)")
        throw error
      }
    }
  }

  // MARK: - Case execution

  private func run(_ testCase: JSONValue, name: String) async throws {
    let rawVersion = testCase["protocolVersion"]?.stringValue ?? "1.0"
    let version = try #require(A2UIProtocolVersion(lenientRawValue: rawVersion))
    let surfaceSpec = testCase["surface"] ?? .object([:])

    let recorder = RoutingRecorder()
    let processor = MessageProcessor(
      catalogs: try catalogs(of: testCase, version: version),
      actionHandler: recorder
    )
    if surfaceSpec["outboundListener"]?.boolValue != false {
      processor.outboundListener = { message in
        MainActor.assumeIsolated {
          // Errors are reported to the agent too; the harness reads them from the handler.
          switch message {
          case .callAgentFunction(let call): recorder.agentCalls.append(call)
          case .action(let action): recorder.actions.append(action)
          case .error: break
          case .rendererFunctionResponse:
            Issue.record("\(name): unexpected outbound message \(message)")
          }
        }
      }
    }

    var createSurface: OrderedDictionary<String, JSONValue> = ["surfaceId": "main"]
    if let catalogID = surfaceSpec["catalogId"] {
      createSurface["catalogId"] = catalogID
    }
    try process(
      processor, ["version": .string(version.rawValue), "createSurface": .object(createSurface)])
    let surface = try #require(processor.surfaceGroupModel["main"], "\(name): no surface")
    if let dataModel = testCase["dataModel"] {
      surface.dataModel.set("/", value: dataModel)
    }

    // Without a default catalog, the probes name the first catalog so that their type resolves;
    // the calls inside them still name no catalog of their own.
    let probeCatalogID: JSONValue? =
      surfaceSpec["catalogId"] == nil
      ? testCase["catalogs"]?.arrayValue?.first?["catalogId"] : nil

    var probes: [JSONValue] = []
    /// The probe of each binding and check evaluation, in order, and whether it is a check.
    var evaluations: [(id: String, isCheck: Bool)] = []
    var outboundSeen = 0
    var errorsSeen = 0
    var actionsSeen = 0

    for (index, step) in (testCase["steps"]?.arrayValue ?? []).enumerated() {
      let label = "\(name) step \(index)"
      if let call = step["evaluate"] {
        let kind = step["as"]?.stringValue ?? "binding"
        let id = "probe\(probes.count)"
        var probe: OrderedDictionary<String, JSONValue> = ["id": .string(id), "component": "Probe"]
        if let probeCatalogID { probe["catalogId"] = probeCatalogID }
        switch kind {
        case "binding": probe["value"] = call
        case "check": probe["checks"] = [["condition": call, "message": "Check failed"]]
        case "action": probe["onClick"] = ["functionCall": call]
        case "event": probe["onClick"] = ["event": call]
        default:
          Issue.record("\(label): unknown evaluation kind \(kind)")
          return
        }
        probes.append(.object(probe))
        var root: OrderedDictionary<String, JSONValue> = [
          "id": "root", "component": "Probe",
          "children": .array(probes.compactMap { $0["id"] }),
        ]
        if let probeCatalogID { root["catalogId"] = probeCatalogID }
        // Added to the surface directly, as a resolved `updateComponents` would add them, so that
        // the calls are evaluated rather than rejected by the processor's payload validation.
        surface.componentsModel.applyBatch(
          adding: [Self.componentModel(root), Self.componentModel(probe)]
        )
        if kind == "action" || kind == "event" {
          let action = try #require(
            surface.findNode(id: id)?.properties["onClick"] as? ResolvedAction,
            "\(label): the action did not resolve"
          )
          action()
        } else {
          evaluations.append((id: id, isCheck: kind == "check"))
        }
      } else if let respond = step["respond"]?.objectValue {
        let callIndex = respond["call"]?.intValue ?? 0
        guard callIndex < recorder.agentCalls.count else {
          Issue.record("\(label): no callAgentFunction at index \(callIndex)")
          return
        }
        var response: OrderedDictionary<String, JSONValue> = [
          "functionCallId": .string(recorder.agentCalls[callIndex].functionCallID)
        ]
        for (key, value) in respond where key != "call" {
          response[key] = value
        }
        try process(processor, ["version": "1.0", "agentFunctionResponse": .object(response)])
      } else if let update = step["updateData"] {
        try process(
          processor,
          [
            "version": .string(version.rawValue),
            "updateDataModel": [
              "surfaceId": "main",
              "path": update["path"] ?? .null,
              "value": update["value"] ?? .null,
            ],
          ]
        )
      } else if step["cancelSurfaceCalls"]?.boolValue == true {
        // The processor's public cancellation cancels every surface's calls; a case has only
        // surface `main`, so it is the same as cancelling that surface's calls.
        processor.cancelPendingCalls()
      } else if step["deleteSurface"]?.boolValue == true {
        try process(
          processor,
          ["version": .string(version.rawValue), "deleteSurface": ["surfaceId": "main"]]
        )
      } else {
        let steps = "'evaluate', 'respond', 'updateData', 'cancelSurfaceCalls' or 'deleteSurface'"
        Issue.record("\(label): a step needs \(steps)")
        return
      }

      let expectedOutbound = step["expectOutbound"]?.arrayValue ?? []
      let expectedErrors = step["expectErrors"]?.arrayValue ?? []
      let expectedValues = step["expectValues"]?.arrayValue
      let expectedActions = step["expectActions"]?.arrayValue ?? []
      func currentValues() -> [String] {
        evaluations.map { evaluation in
          let node = surface.findNode(id: evaluation.id)
          if evaluation.isCheck {
            let checks = node?.properties["checks"] as? [ResolvedCheck]
            return Self.canonical(checks?.first.map { .boolean($0.isValid) } ?? .null)
          }
          return Self.canonical(
            (node?.properties["value"] as? DataBinding<JSONValue>)?.value ?? .null)
        }
      }
      // Routing runs in tasks, so wait for what the step expects, then a little longer for
      // anything it does not.
      await waitUntil {
        recorder.agentCalls.count >= outboundSeen + expectedOutbound.count
          && reportedErrors(recorder).count >= errorsSeen + expectedErrors.count
          && recorder.actions.count >= actionsSeen + expectedActions.count
          && (expectedValues.map { currentValues() == $0.map(Self.canonical) } ?? true)
      }
      await settle()

      let sent = Array(recorder.agentCalls[outboundSeen...])
      outboundSeen = recorder.agentCalls.count
      for call in sent {
        #expect(call.surfaceID == "main", "\(label): surfaceId")
      }
      let anyOrder = step["outboundInAnyOrder"]?.boolValue == true
      let sentPayloads = sent.map { Self.canonical(Self.json(of: $0.callFunction)) }
      let expectedPayloads = expectedOutbound.map(Self.canonical)
      #expect(
        (anyOrder ? sentPayloads.sorted() : sentPayloads)
          == (anyOrder ? expectedPayloads.sorted() : expectedPayloads),
        "\(label): outbound callFunction payloads \(sent.map(\.callFunction))"
      )

      let reported = Array(reportedErrors(recorder)[errorsSeen...])
      errorsSeen = reportedErrors(recorder).count
      #expect(
        reported.count == expectedErrors.count,
        "\(label): reported errors \(reported.map { "\($0.code): \($0.message)" })"
      )
      for (actual, expected) in zip(reported, expectedErrors) {
        #expect(actual.code == expected["code"]?.stringValue, "\(label): error code")
        if let message = expected["message"]?.stringValue {
          #expect(
            actual.message.contains(message), "\(label): '\(actual.message)' lacks '\(message)'")
        }
      }

      let dispatched = Array(recorder.actions[actionsSeen...])
      actionsSeen = recorder.actions.count
      #expect(
        dispatched.map { Self.canonical(Self.json(of: $0)) } == expectedActions.map(Self.canonical),
        "\(label): dispatched actions \(dispatched.map { Self.json(of: $0) })"
      )

      if let expectedValues {
        #expect(currentValues() == expectedValues.map(Self.canonical), "\(label): values")
      }
    }
  }

  // MARK: - Catalogs

  /// Builds the catalogs of a case: `localFunctions` take this SDK's basic catalog
  /// implementations, `agentFunctions` are declared schema-only, and every catalog has the
  /// `Probe` component the harness binds evaluations to.
  private func catalogs(of testCase: JSONValue, version: A2UIProtocolVersion) throws -> [AnyCatalog]
  {
    let basicFunctions = BasicCatalog.makeCatalog(version: version).functions
    let probe = AnyComponentAPI(name: "Probe", schema: try Self.probeSchema(version: version))
    return try (testCase["catalogs"]?.arrayValue ?? []).map { spec in
      var functions: [any FunctionImplementation] = []
      for name in spec["localFunctions"]?.arrayValue ?? [] {
        let functionName = name.stringValue ?? ""
        functions.append(
          try #require(basicFunctions[functionName], "basic catalog has no \(functionName)")
        )
      }
      for (name, declaration) in spec["agentFunctions"]?.objectValue ?? [:] {
        functions.append(
          SchemaOnlyFunction(
            api: FunctionAPI(
              name: name,
              returnType: declaration["returnType"]?.stringValue
                .flatMap(FunctionReturnType.init(rawValue:)) ?? .any,
              schema: try Schema(
                rawSchema: declaration["args"] ?? .object([:]),
                context: Context(dialect: .draft2020_12)
              ),
              allowedCallers: declaration["allowedCallers"]?.stringValue
                .flatMap(AllowedCallers.init(rawValue:)) ?? .rendererOnly,
              requiresUserActivation: declaration["requiresUserActivation"]?.boolValue ?? false
            )
          )
        )
      }
      return Catalog(
        id: spec["catalogId"]?.stringValue ?? "",
        protocolVersion: version,
        components: [probe],
        functions: functions
      ).eraseToAnyCatalog()
    }
  }

  private static func probeSchema(version: A2UIProtocolVersion) throws -> Schema {
    func uri(_ name: String) -> String {
      version >= .v10 ? A2UICommonSchema.v10URI(for: name) : A2UICommonSchema.uri(for: name)
    }
    return try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "value": { "$ref": "\(uri("DynamicValue"))" },
            "checks": { "type": "array", "items": { "$ref": "\(uri("CheckRule"))" } },
            "onClick": { "$ref": "\(uri("Action"))" },
            "children": { "$ref": "\(uri("ChildList"))" }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
  }

  // MARK: - Helpers

  /// Converts a composed YAML node to a `JSONValue`, keeping the order of mapping keys.
  private static func orderedJSONValue(_ node: Yams.Node) -> JSONValue {
    switch node {
    case .mapping(let mapping):
      var object: OrderedDictionary<String, JSONValue> = [:]
      for (key, value) in mapping {
        object[key.string ?? ""] = orderedJSONValue(value)
      }
      return .object(object)
    case .sequence(let sequence):
      return .array(sequence.map(orderedJSONValue))
    default:
      return ConformanceTestHelper.toJSONValue(Constructor.default.any(from: node))
    }
  }

  private func process(
    _ processor: MessageProcessor, _ message: OrderedDictionary<String, JSONValue>
  )
    throws
  {
    let data = try JSONEncoder().encode(JSONValue.object(message))
    let json = try #require(String(data: data, encoding: .utf8))
    processor.process(message: try MessageParser().parse(jsonString: json))
  }

  private func reportedErrors(_ recorder: RoutingRecorder) -> [(code: String, message: String)] {
    recorder.errors.map {
      switch $0 {
      case .generic(let error): (error.code, error.message)
      case .validationFailed(let error): (error.code.rawValue, error.message)
      }
    }
  }

  /// Waits for asynchronous work, until `condition` holds or about two seconds pass.
  private func waitUntil(_ condition: () -> Bool) async {
    for _ in 0..<400 where !condition() {
      try? await Task.sleep(nanoseconds: 5_000_000)
    }
  }

  /// Lets pending tasks run, for checks that something did not happen.
  private func settle() async {
    for _ in 0..<6 {
      try? await Task.sleep(nanoseconds: 5_000_000)
    }
  }

  private static func componentModel(_ json: OrderedDictionary<String, JSONValue>) -> ComponentModel
  {
    var properties: [String: JSONValue] = [:]
    for (key, value) in json where !["id", "component", "catalogId"].contains(key) {
      properties[key] = value
    }
    return ComponentModel(
      id: json["id"]?.stringValue ?? "",
      type: json["component"]?.stringValue ?? "",
      catalogID: json["catalogId"]?.stringValue,
      properties: properties
    )
  }

  private static func json(of payload: CallFunctionPayload) -> JSONValue {
    var object: OrderedDictionary<String, JSONValue> = ["@call": .string(payload.call)]
    if let catalogID = payload.catalogID { object["catalogId"] = .string(catalogID) }
    if let args = payload.args {
      object["args"] = .object(OrderedDictionary(uniqueKeysWithValues: args.map { ($0, $1) }))
    }
    return .object(object)
  }

  /// The fields of a dispatched action that a case compares.
  private static func json(of action: RendererAction) -> JSONValue {
    var object: OrderedDictionary<String, JSONValue> = [
      "name": .string(action.name),
      "context": .object(OrderedDictionary(uniqueKeysWithValues: action.context.map { ($0, $1) })),
    ]
    if let userMessage = action.userMessage { object["userMessage"] = .string(userMessage) }
    return .object(object)
  }

  /// A canonical text for a JSON value: keys sorted, and integral numbers written as integers.
  private static func canonical(_ value: JSONValue) -> String {
    switch value {
    case .null: return "null"
    case .boolean(let flag): return flag ? "true" : "false"
    case .integer(let integer): return String(integer)
    case .number(let number):
      return number.rounded() == number && abs(number) < 1e15 ? String(Int(number)) : String(number)
    case .string(let text): return "\"\(text)\""
    case .array(let items): return "[" + items.map(canonical).joined(separator: ",") + "]"
    case .object(let object):
      return "{"
        + object.keys.sorted().compactMap { key in
          object[key].map { "\"\(key)\":\(canonical($0))" }
        }.joined(separator: ",")
        + "}"
    }
  }
}
