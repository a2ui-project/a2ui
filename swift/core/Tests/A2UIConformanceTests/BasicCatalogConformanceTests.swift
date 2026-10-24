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
import BasicCatalog
import Foundation
import OrderedJSON
import Testing

@MainActor
private final class ConformanceMockFunctionHandler: FunctionHandler {
  private let functionsMap: [String: any FunctionImplementation]

  init(
    functionsMap: [String: any FunctionImplementation] = Dictionary(
      uniqueKeysWithValues: BasicFunctions.allFunctions.map { ($0.api.name, $0) }
    )
  ) {
    self.functionsMap = functionsMap
  }

  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    functionsMap[named]
  }
}

/// Evaluates function calls through a surface's catalog resolution and records the errors that
/// the surface would report, so a case can tell which error a call raised.
@MainActor
private final class SurfaceFunctionErrorRecorder: FunctionHandler {
  private let surface: SurfaceViewModel
  private(set) var errors: [any Error] = []

  init(surface: SurfaceViewModel) {
    self.surface = surface
  }

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    surface.function(named: name, catalogID: catalogID)
  }

  func validateFunctionCatalog(id catalogID: String?, functionName: String) throws {
    try surface.validateFunctionCatalog(id: catalogID, functionName: functionName)
  }

  func handleFunctionError(_ error: any Error, functionName: String) {
    errors.append(error)
  }
}

@MainActor
struct BasicCatalogConformanceTests {
  /// `validate` cases whose output depends on the host locale until #3144 is fixed.
  private static let hostLocaleDependent: Set<String> = [
    "test_function_format_currency_locale_and_symbol",
    "test_function_pluralize_categories",
  ]

  /// Surface cases that fail because of a known gap in the Swift SDK, with the reason.
  private static let knownSurfaceGaps: [String: Comment] = [
    "test_evaluate_function_v09_ignores_call_catalog_id":
      "Before v1.0, a call's catalogId is looked up instead of ignored (#3550)"
  ]

  private let functionHandler = ConformanceMockFunctionHandler()
  /// Handlers holding each protocol version's Basic Catalog functions. Stored here because
  /// `DataContext` keeps its function handler weakly.
  private let versionedFunctionHandlers = Dictionary(
    uniqueKeysWithValues: A2UIProtocolVersion.allCases.map {
      (
        $0,
        ConformanceMockFunctionHandler(
          functionsMap: BasicCatalog.makeCatalog(version: $0).functions)
      )
    }
  )

  @Test func formatStringAndExpressionParser() throws {
    let dataModel = DataModel(
      initial: .object([
        "user": .object([
          "firstName": .string("Alice"),
          "age": .integer(30),
        ])
      ])
    )

    let parsed = try ExpressionParser().parse("Hello ${/user/firstName}, age is ${/user/age}!")
    #expect(parsed.count == 5)

    let formatStringFunction = FormatStringFunction()
    let context = DataContext(dataModel: dataModel, path: "", functionHandler: functionHandler)

    let result = try formatStringFunction.evaluate(
      arguments: [
        "value": .string("Welcome ${/user/firstName}, you are ${/user/age} years old.")
      ],
      context: context
    )

    #expect(result == .string("Welcome Alice, you are 30 years old."))
  }

  @Test func evaluateFunctionConformance() throws {
    let rawYAML = try ConformanceTestHelper.loadYAML(filename: "core/functions.yaml")
    let cases = (rawYAML as? [[String: Any]]) ?? []
    #expect(!cases.isEmpty, "core/functions.yaml should hold test cases")

    var executed = 0
    for testCase in cases {
      guard let name = testCase["name"] as? String,
        let action = testCase["action"] as? String
      else {
        Issue.record("core/functions.yaml holds a case without a name or an action")
        continue
      }

      switch action {
      case "validate":
        executed += 1
        try runValidateCase(testCase, name: name)
        continue
      case "evaluate_function":
        executed += 1
      default:
        Issue.record("\(name): unsupported action \(action)")
        continue
      }

      // A case with a `surface` block evaluates the function as a call on a surface, so the
      // call goes through catalog resolution.
      if testCase["surface"] != nil {
        if let knownGap = Self.knownSurfaceGaps[name] {
          try withKnownIssue(knownGap) {
            try runSurfaceCase(testCase, name: name)
          }
        } else {
          try runSurfaceCase(testCase, name: name)
        }
        continue
      }

      // Validators return booleans in v0.9 and ValidationResult objects in v1.0, so
      // each case runs against the functions of the protocol version it is pinned to.
      // Unpinned cases run against v0.9.
      guard let funcName = testCase["function"] as? String else {
        Issue.record("\(name): case names no function")
        continue
      }

      let catalogVersion = (testCase["catalog"] as? [String: Any])?["protocolVersion"] as? String
      let rawVersion = (testCase["protocolVersion"] as? String) ?? catalogVersion ?? "v0.9"
      guard let protocolVersion = A2UIProtocolVersion(lenientRawValue: rawVersion) else {
        Issue.record("\(name): unsupported protocol version \(rawVersion)")
        continue
      }
      let functionsMap = BasicCatalog.makeCatalog(version: protocolVersion).functions

      guard let fn = functionsMap[funcName] else {
        Issue.record("\(name): function '\(funcName)' not found for \(protocolVersion.rawValue)")
        continue
      }

      let dataModelDict: JSONValue =
        (testCase["dataModel"] ?? testCase["data_model"]).map {
          ConformanceTestHelper.toJSONValue($0)
        } ?? .object([:])
      let model = DataModel(initial: dataModelDict)
      // Functions that evaluate through the context (such as formatString) resolve
      // against the same catalog version as the function under test.
      let versionedHandler = try #require(versionedFunctionHandlers[protocolVersion])
      let context = DataContext(
        dataModel: model,
        path: "/",
        functionHandler: versionedHandler,
        protocolVersion: protocolVersion
      )

      let rawArgs = (testCase["args"] as? [String: Any]) ?? [:]
      var swiftArgs: [String: JSONValue] = [:]
      for (k, v) in rawArgs {
        swiftArgs[k] = ConformanceTestHelper.toJSONValue(v)
      }

      if let expectError = (testCase["expectError"] ?? testCase["expect_error"]) as? [String: Any] {
        do {
          _ = try fn.evaluate(arguments: swiftArgs, context: context)
          Issue.record("\(name): expected error but succeeded")
        } catch is FunctionError {
          if let expectedCategory = expectError["category"] as? String {
            #expect(
              expectedCategory == "ExpressionError" || expectedCategory == "ValidationError",
              "\(name): unexpected expectedCategory \(expectedCategory)"
            )
          }
        } catch {
          Issue.record("\(name): threw unexpected non-function error: \(error)")
        }
      } else {
        do {
          let actual = try fn.evaluate(arguments: swiftArgs, context: context)
          if let expectedRaw = testCase["expect"] {
            let expected = ConformanceTestHelper.toJSONValue(expectedRaw)
            #expect(actual == expected, "\(name): got \(actual), expected \(expected)")
          }
        } catch {
          Issue.record("\(name): threw unexpected error \(error)")
        }
      }
    }

    #expect(executed == cases.count, "All cases in core/functions.yaml should be executed")
  }

  /// Runs a `validate` case, which renders basic catalog components that call a function.
  private func runValidateCase(_ rawCase: [String: Any], name: String) throws {
    let testCase = try #require(
      ConformanceTestHelper.parseTestCases(from: [rawCase]).first,
      "\(name): case could not be parsed"
    )
    guard Self.hostLocaleDependent.contains(name) else {
      try ConformanceTestHelper.runValidateCase(testCase)
      return
    }
    // Only a locale mismatch is known. Raw directive JSON (`{"@call":…}`) in the output is a
    // real evaluation failure and must still fail the test.
    try withKnownIssue("#3144: formatting uses the host locale", isIntermittent: true) {
      try ConformanceTestHelper.runValidateCase(testCase)
    } matching: { issue in
      !String(describing: issue).contains("{\"")
    }
  }

  /// Runs an `evaluate_function` case with a `surface` block: evaluates
  /// `{"@call": function, "catalogId": catalogId, "args": args}` (`call` before v1.0) through
  /// the data context of a surface built as `conformance/README.md` describes.
  private func runSurfaceCase(_ testCase: [String: Any], name: String) throws {
    let rawVersion = try #require(
      testCase["protocolVersion"] as? String,
      "\(name): surface case names no protocolVersion"
    )
    let version = try #require(
      A2UIProtocolVersion(lenientRawValue: rawVersion),
      "\(name): unsupported protocol version \(rawVersion)"
    )

    // The surface's available catalogs are those of `catalogPaths` built for its version.
    var catalogs: [String: AnyCatalog] = [:]
    for path in (testCase["catalogPaths"] as? [String]) ?? [] {
      let catalog = try Self.surfaceCatalog(path: path)
      if catalog.isAtLeastV10 == version.isAtLeastV10 {
        catalogs[catalog.id] = catalog
      }
    }
    let surfaceBlock = (testCase["surface"] as? [String: Any]) ?? [:]
    let surface = SurfaceViewModel(
      surfaceID: "conformance",
      catalogs: catalogs,
      defaultCatalogID: surfaceBlock["catalogId"] as? String,
      protocolVersion: version
    )
    let recorder = SurfaceFunctionErrorRecorder(surface: surface)
    let context = DataContext(
      dataModel: surface.dataModel,
      path: "/",
      functionHandler: recorder,
      protocolVersion: version
    )

    var call: [String: Any] = [
      version.isAtLeastV10 ? "@call" : "call": testCase["function"] ?? NSNull(),
      "args": testCase["args"] ?? [String: Any](),
    ]
    call["catalogId"] = testCase["catalogId"]
    let result = context.resolveDynamicValue(ConformanceTestHelper.toJSONValue(call))

    // The surface reports a failed call to its function handler and resolves it to null, so
    // the first error reported counts as raised.
    if let expectError = testCase["expectError"] as? [String: Any] {
      guard let error = recorder.errors.first else {
        Issue.record("\(name): expected an error but got \(result)")
        return
      }
      if expectError["category"] as? String == "CatalogError" {
        #expect(error is A2UICatalogError, "\(name): expected a catalog error, got \(error)")
      }
      if let expectedMessage = expectError["message"] as? String {
        let message = (error as? any A2UIError)?.message ?? String(describing: error)
        #expect(
          message.localizedCaseInsensitiveContains(expectedMessage),
          "\(name): message '\(message)' does not contain '\(expectedMessage)'"
        )
      }
      return
    }

    #expect(recorder.errors.isEmpty, "\(name): unexpected errors \(recorder.errors)")
    if let expectedRaw = testCase["expect"] {
      let expected = ConformanceTestHelper.toJSONValue(expectedRaw)
      #expect(result == expected, "\(name): got \(result), expected \(expected)")
    }
  }

  /// Builds the catalog that a `catalogPaths` entry stands for: this SDK's basic catalog for a
  /// published basic catalog document, so its functions run, and otherwise the functions the
  /// document declares.
  private static func surfaceCatalog(path: String) throws -> AnyCatalog {
    var document = try ConformanceTestHelper.loadRepositoryJSON(path: path).objectValue ?? [:]
    let catalogID = document["catalogId"]?.stringValue
    if let basic = BasicCatalog.allCatalogs.first(where: { $0.id == catalogID }) {
      return basic
    }
    // `buildCatalog` gives a document with a `$schema` the basic catalog functions as well.
    document["$schema"] = nil
    return ConformanceTestHelper.buildCatalog(
      catalogSchema: .object(document),
      commonTypes: try ConformanceTestHelper.commonTypesSchema(forCatalogPath: path)
    )
  }

  @Test func indexFunctionConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/index_function.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from index_function.yaml")

    for testCase in testCases {
      let errorHandler = IndexConformanceErrorHandler()
      let processor = MessageProcessor(
        catalogs: ConformanceTestHelper.basicCatalogs(for: .v10),
        actionHandler: errorHandler,
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for step in testCase.steps {
        guard let payload = step.payload else { continue }

        if let expectedError = step.expectError {
          errorHandler.capturedErrors.removeAll()
          var caughtErrorMessage: String?
          do {
            let messages = try ConformanceTestHelper.parsePayload(payload)
            processor.process(messages: messages)
          } catch {
            caughtErrorMessage = error.localizedDescription
          }

          let errorMessages =
            errorHandler.capturedErrors.map { err -> String in
              switch err {
              case .validationFailed(let v): return v.message
              case .generic(let g): return g.message
              }
            } + (caughtErrorMessage.map { [$0] } ?? [])

          #expect(
            !errorMessages.isEmpty,
            "Expected error for \(testCase.name), but processing succeeded without error"
          )
          if let expectedMessage = expectedError.message {
            #expect(
              errorMessages.contains(where: { $0.contains(expectedMessage) }),
              "Expected error containing '\(expectedMessage)' in \(testCase.name), got \(errorMessages)"
            )
          }
        } else {
          let messages = try ConformanceTestHelper.parsePayload(payload)
          processor.process(messages: messages)

          if let expectSurfaces = testCase.expect?["surfaces"]?.objectValue {
            for (surfaceID, expectedSurface) in expectSurfaces {
              guard let surface = processor.surfaceGroupModel[surfaceID] else {
                Issue.record("Expected surface '\(surfaceID)' to exist")
                continue
              }

              if let expectedComponents = expectedSurface["components"]?.objectValue {
                for (compID, compExpected) in expectedComponents {
                  let node = surface.findNode(id: compID)
                  if let expectedText = compExpected["text"]?.stringValue {
                    #expect(
                      node?.string(for: "text") == expectedText,
                      "[\(testCase.name)] Expected node \(compID).text == '\(expectedText)', got '\(node?.string(for: "text") ?? "nil")'"
                    )
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  @Test func validationResultConformance() throws {
    let rawYaml = try ConformanceTestHelper.loadYAML(filename: "core/validation_result.yaml")
    let testCases = ConformanceTestHelper.parseTestCases(from: rawYaml)

    #expect(!testCases.isEmpty, "Should load test cases from validation_result.yaml")

    for testCase in testCases {
      let processor = MessageProcessor(
        catalogs: ConformanceTestHelper.basicCatalogs(for: .v10),
        validationConfig: ValidationConfig(targetVersion: "v1.0")
      )

      for step in testCase.steps {
        guard let payload = step.payload else { continue }
        let messages = try ConformanceTestHelper.parsePayload(payload)
        processor.process(messages: messages)
      }

      if let expectSurfaces = testCase.expect?["surfaces"]?.objectValue {
        for (surfaceID, expectedSurface) in expectSurfaces {
          guard let surface = processor.surfaceGroupModel[surfaceID] else {
            Issue.record("Expected surface '\(surfaceID)' to exist")
            continue
          }

          if let expectedVR = expectedSurface["validationResult"]?.objectValue {
            for (nodeID, expectedCheck) in expectedVR {
              let node = surface.findNode(id: nodeID)
              let expectedValid = expectedCheck["valid"]?.boolValue ?? true
              #expect(
                node?.isValid == expectedValid,
                "[\(testCase.name)] Expected node \(nodeID).isValid == \(expectedValid)"
              )

              if let expectedMsg = expectedCheck["message"]?.stringValue {
                #expect(
                  node?.validationErrors.contains(expectedMsg) == true,
                  "[\(testCase.name)] Expected validation errors to contain '\(expectedMsg)'"
                )
              }
            }
          }
        }
      }
    }
  }
}

private final class IndexConformanceErrorHandler: ActionHandling, @unchecked Sendable {
  var capturedErrors: [RendererError] = []

  func handle(action: ResolvedAction, from surfaceID: String) {}

  func handle(error: RendererError, from surfaceID: String) {
    capturedErrors.append(error)
  }
}
