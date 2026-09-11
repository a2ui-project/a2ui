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
}

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  var functionToReturn: (any FunctionImplementation)? = nil
  var lastRequestedName: String? = nil
  var lastRequestedCatalogID: String? = nil

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    lastRequestedName = name
    lastRequestedCatalogID = catalogID
    return functionToReturn
  }
}
