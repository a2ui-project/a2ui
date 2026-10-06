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
import JSONSchema
import OrderedJSON
import Testing

@MainActor
struct DataContextTests {

  @Test func setUpdatesDataModelWithAbsolutePath() {
    let dataModel = DataModel()
    let mockHandler = MockFunctionHandler()
    let context = DataContext(dataModel: dataModel, path: "/foo", functionHandler: mockHandler)

    context.set("bar", value: "hello")
    #expect(dataModel.get("/foo/bar")?.stringValue == "hello")
  }

  @Test func nestedReturnsNewContextWithAppendedPath() {
    let mockHandler = MockFunctionHandler()
    let context = DataContext(dataModel: DataModel(), path: "/foo", functionHandler: mockHandler)

    let nested = context.nested(relativePath: "baz")
    #expect(nested?.path == "/foo/baz")
  }

  @Test func nestedReturnsNilIfFunctionHandlerIsDeallocated() {
    let dataModel = DataModel()
    let context: DataContext
    do {
      let handler = MockFunctionHandler()
      context = DataContext(dataModel: dataModel, path: "/foo", functionHandler: handler)
    }
    let nested = context.nested(relativePath: "baz")
    #expect(nested == nil)
  }

  @Test func resolveDynamicValueReturnsLiteral() {
    let mockHandler = MockFunctionHandler()
    let context = DataContext(dataModel: DataModel(), path: "", functionHandler: mockHandler)

    let result = context.resolveDynamicValue("static string")
    #expect(result.stringValue == "static string")
  }

  @Test func resolveDynamicValueResolvesDataPath() {
    let dataModel = DataModel()
    dataModel.set("/user/name", value: "Alice")
    let mockHandler = MockFunctionHandler()
    let context = DataContext(dataModel: dataModel, path: "/user", functionHandler: mockHandler)

    let pathBinding: JSONValue = ["path": "name"]
    let result = context.resolveDynamicValue(pathBinding)
    #expect(result.stringValue == "Alice")
  }

  @Test func resolveDynamicValueCallsFunctionWithResolvedArgs() {
    let mockHandler = MockFunctionHandler()
    mockHandler.functionToReturn = ConcatFunction()

    let dataModel = DataModel()
    dataModel.set("/user/suffix", value: " World!")

    let context = DataContext(dataModel: dataModel, path: "/user", functionHandler: mockHandler)

    let functionBinding: JSONValue = [
      "call": "concat",
      "args": [
        "a": "Hello,",
        "b": ["path": "suffix"],
      ],
    ]

    let result = context.resolveDynamicValue(functionBinding)

    #expect(mockHandler.lastRequestedName == "concat")
    #expect(result.stringValue == "Hello, World!")
  }

  @Test func resolveDynamicValuePassesThroughNonBindingContainers() {
    let mockHandler = MockFunctionHandler()
    let dataModel = DataModel()
    dataModel.set("/item", value: "apple")
    let context = DataContext(dataModel: dataModel, path: "/", functionHandler: mockHandler)

    let literalObject: JSONValue = [
      "list": [
        "static",
        ["path": "item"],
      ]
    ]
    #expect(context.resolveDynamicValue(literalObject) == literalObject)

    let literalWithCall: JSONValue = ["config": ["call": "concat"]]
    #expect(context.resolveDynamicValue(literalWithCall) == literalWithCall)
    #expect(mockHandler.lastRequestedName == nil)
  }

  @Test func v10ProtocolVersionGatingResolvesAtDirectivesAndEscaping() throws {
    let mockHandler = MockFunctionHandler()
    let dataModel = DataModel()
    dataModel.set("/item", value: "apple")
    let context = DataContext(
      dataModel: dataModel,
      path: "/",
      functionHandler: mockHandler,
      protocolVersion: "v1.0"
    )

    let atPathBinding: JSONValue = ["@path": "/item"]
    #expect(context.resolveDynamicValue(atPathBinding) == "apple")

    let plainPathObject: JSONValue = ["path": "/item"]
    #expect(context.resolveDynamicValue(plainPathObject) == plainPathObject)

    let escapedObject: JSONValue = ["@@path": "/item", "@@type": "fruit"]
    let resolved = context.resolveDynamicValue(escapedObject)
    #expect(resolved.objectValue?["@path"] == "/item")
    #expect(resolved.objectValue?["@type"] == "fruit")

    #expect(throws: A2UIValidationError.self) {
      try DataContext.validateReservedDirectives(["@invalidKey"])
    }
  }
  @Test(arguments: [nil, "v1.0"])
  func resolveDynamicValueReportsMissingFunction(protocolVersion: String?) {
    let mockHandler = MockFunctionHandler()
    let context = DataContext(
      dataModel: DataModel(),
      path: "/",
      functionHandler: mockHandler,
      protocolVersion: protocolVersion
    )
    let callKey = protocolVersion == nil ? "call" : "@call"

    let result = context.resolveDynamicValue([callKey: "missing", "catalogId": "cat"])

    #expect(result == .null)
    #expect(mockHandler.reportedErrors.count == 1)
    #expect(mockHandler.reportedErrors.first?.functionName == "missing")
    #expect(mockHandler.reportedErrors.first?.catalogID == "cat")
    #expect(mockHandler.reportedErrors.first?.error == nil)
  }

  @Test(arguments: [nil, "v1.0"])
  func resolveDynamicValueReportsThrowingFunction(protocolVersion: String?) {
    let mockHandler = MockFunctionHandler()
    mockHandler.functionToReturn = ThrowingFunction()
    let context = DataContext(
      dataModel: DataModel(),
      path: "/",
      functionHandler: mockHandler,
      protocolVersion: protocolVersion
    )
    let callKey = protocolVersion == nil ? "call" : "@call"

    let result = context.resolveDynamicValue([callKey: "throws"])

    #expect(result == .null)
    #expect(mockHandler.reportedErrors.count == 1)
    #expect(mockHandler.reportedErrors.first?.functionName == "throws")
    let error = mockHandler.reportedErrors.first?.error as? FunctionError
    #expect(error?.message == "boom")
  }

  @Test func resolveDynamicValueDoesNotReportSuccessfulCall() {
    let mockHandler = MockFunctionHandler()
    mockHandler.functionToReturn = ConcatFunction()
    let context = DataContext(dataModel: DataModel(), path: "/", functionHandler: mockHandler)

    _ = context.resolveDynamicValue(["call": "concat", "args": ["a": "x", "b": "y"]])

    #expect(mockHandler.reportedErrors.isEmpty)
  }
}

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  var functionToReturn: (any FunctionImplementation)? = nil
  var lastRequestedName: String? = nil
  var lastRequestedCatalogID: String? = nil
  var reportedErrors: [(functionName: String, catalogID: String?, error: Error?)] = []

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    lastRequestedName = name
    lastRequestedCatalogID = catalogID
    return functionToReturn
  }

  func reportExpressionError(functionName: String, catalogID: String?, error: Error?) {
    reportedErrors.append((functionName, catalogID, error))
  }
}

private struct ThrowingFunction: FunctionImplementation {
  let api = FunctionAPI(
    name: "throws",
    returnType: .any,
    schema: try! Schema(instance: "{\"type\": \"object\"}")
  )

  @MainActor
  func evaluate(arguments: [String: JSONValue], context: DataContext) throws -> JSONValue {
    throw FunctionError.executionFailed(name: "throws", message: "boom")
  }
}
