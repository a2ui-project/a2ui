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
import JSONSchema
import OrderedJSON
import Testing

/// Only `error`-severity check failures block a component; `warning` and `info` failures are
/// reported but non-blocking (protocol v1.0, `ValidationResult.severity`).
@MainActor
struct CheckSeverityTests {

  // MARK: - ResolvedCheck

  private func failedCheck(
    _ message: String,
    severity: ValidationSeverity?,
    code: String? = nil
  ) -> ResolvedCheck {
    ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(false)), value: false),
      message: message,
      validationResult: ValidationResult(
        valid: false,
        code: code,
        message: message,
        severity: severity
      )
    )
  }

  @Test func errorSeverityFailureIsInvalid() {
    let check = failedCheck("Required", severity: .error)
    #expect(!check.passed)
    #expect(check.severity == .error)
    #expect(!check.isValid)
  }

  @Test func missingSeverityDefaultsToError() {
    let check = failedCheck("Required", severity: nil)
    #expect(check.severity == .error)
    #expect(!check.isValid)
  }

  @Test func booleanFailureWithoutResultIsAnError() {
    let check = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(false)), value: false),
      message: "Fail"
    )
    #expect(!check.passed)
    #expect(check.severity == .error)
    #expect(!check.isValid)
  }

  @Test func warningAndInfoFailuresAreNonBlocking() {
    for severity in [ValidationSeverity.warning, .info] {
      let check = failedCheck("Hint", severity: severity)
      #expect(!check.passed)
      #expect(check.severity == severity)
      #expect(check.isValid)
    }
  }

  @Test func passingCheckIsValid() {
    let check = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(true)), value: true),
      message: "Unused",
      validationResult: ValidationResult(valid: true)
    )
    #expect(check.passed)
    #expect(check.isValid)
  }

  // MARK: - Node

  @Test func nodeWithOnlyNonBlockingFailuresIsValid() {
    let node = Node(
      id: "field",
      type: "TextField",
      properties: [
        "checks": [
          failedCheck("Looks unusual", severity: .warning, code: "UNUSUAL"),
          failedCheck("Optional field", severity: .info),
        ]
      ]
    )
    #expect(node.isValid)
    #expect(node.validationErrors.isEmpty)
    #expect(
      node.validationResults == [
        ValidationResult(
          valid: false,
          code: "UNUSUAL",
          message: "Looks unusual",
          severity: .warning
        ),
        ValidationResult(valid: false, message: "Optional field", severity: .info),
      ]
    )
  }

  @Test func nodeErrorsListOnlyErrorSeverityFailures() {
    let passing = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(true)), value: true),
      message: "Unused"
    )
    let booleanFailure = ResolvedCheck(
      condition: DataBinding<Bool>(identity: .literal(.boolean(false)), value: false),
      message: "Must agree"
    )
    let node = Node(
      id: "field",
      type: "TextField",
      properties: [
        "checks": [
          passing,
          failedCheck("Looks unusual", severity: .warning),
          failedCheck("Required", severity: nil, code: "REQUIRED"),
          booleanFailure,
        ]
      ]
    )
    #expect(!node.isValid)
    #expect(node.validationErrors == ["Required", "Must agree"])
    #expect(
      node.validationResults == [
        ValidationResult(valid: false, message: "Looks unusual", severity: .warning),
        ValidationResult(valid: false, code: "REQUIRED", message: "Required", severity: .error),
        ValidationResult(valid: false, message: "Must agree", severity: .error),
      ]
    )
  }

  // MARK: - Button resolution and action dispatch

  private func makeButtonResolver(
    checkResult: JSONValue,
    handler: TestProcessorActionHandler
  ) throws -> NodeResolver {
    let buttonSchema = try Schema(
      instance: """
        {
          "type": "object",
          "properties": {
            "action": {
              "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/Action"
            },
            "checks": {
              "type": "array",
              "items": {
                "$ref": "https://a2ui.org/schemas/v1_0/common_types.json#/$defs/CheckRule"
              }
            }
          }
        }
        """,
      remoteSchemas: A2UICommonSchema.allSchemas
    )
    let catalog = Catalog(
      id: "test",
      protocolVersion: "1.0",
      components: [AnyComponentAPI(name: "Button", schema: buttonSchema)] as [AnyComponentAPI]
    )
    let componentsModel = SurfaceComponentsModel()
    componentsModel.addComponent(
      ComponentModel(
        id: "root",
        type: "Button",
        properties: [
          "action": .object(["event": .object(["name": .string("submit")])]),
          "checks": .array([
            .object([
              "condition": .object(["@path": .string("/check")]),
              "message": .string("Fallback message"),
            ])
          ]),
        ]
      )
    )
    return NodeResolver(
      surfaceID: "surf1",
      catalogs: [catalog.eraseToAnyCatalog()],
      defaultCatalogID: catalog.id,
      componentsModel: componentsModel,
      dataModel: DataModel(initial: .object(["check": checkResult])),
      actionHandler: handler
    )
  }

  @Test func buttonWithFailingWarningCheckStaysEnabledAndDispatches() throws {
    for severity in ["warning", "info"] {
      let handler = TestProcessorActionHandler()
      let resolver = try makeButtonResolver(
        checkResult: .object([
          "valid": .boolean(false),
          "message": .string("Double-check the amount"),
          "severity": .string(severity),
        ]),
        handler: handler
      )
      let node = try #require(resolver.resolveTree())
      #expect(node.isValid)
      #expect(node.validationErrors.isEmpty)
      #expect(node.validationResults.map(\.message) == ["Double-check the amount"])

      let action = try #require(node.properties["action"] as? ResolvedAction)
      action()
      #expect(handler.capturedErrors.isEmpty)
      #expect(handler.capturedActions.map(\.identity) == [.event(name: "submit", context: [:])])
    }
  }

  @Test func buttonWithFailingErrorCheckIsDisabledAndBlocksDispatch() throws {
    let handler = TestProcessorActionHandler()
    let resolver = try makeButtonResolver(
      checkResult: .object([
        "valid": .boolean(false),
        "message": .string("Amount is required"),
        "severity": .string("error"),
      ]),
      handler: handler
    )
    let node = try #require(resolver.resolveTree())
    #expect(!node.isValid)
    #expect(node.validationErrors == ["Amount is required"])

    let action = try #require(node.properties["action"] as? ResolvedAction)
    action()
    #expect(handler.capturedActions.isEmpty)
    guard case .validationFailed(let error) = handler.capturedErrors.first else {
      Issue.record("Expected a validationFailed error, got \(handler.capturedErrors)")
      return
    }
    #expect(error.message == "Amount is required")
  }
}
