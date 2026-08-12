import Testing
import A2UICore
import OrderedJSON

@Suite
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
    var handler: MockFunctionHandler? = MockFunctionHandler()
    let context = DataContext(dataModel: dataModel, path: "/foo", functionHandler: handler!)
    
    handler = nil
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
        "b": ["path": "suffix"]
      ]
    ]
    
    let result = context.resolveDynamicValue(functionBinding)
    
    #expect(mockHandler.lastRequestedName == "concat")
    #expect(result.stringValue == "Hello, World!")
  }
  
  @Test func resolveDynamicValueRecursesIntoArraysAndDictionaries() {
    let mockHandler = MockFunctionHandler()
    let dataModel = DataModel()
    dataModel.set("/item", value: "apple")
    let context = DataContext(dataModel: dataModel, path: "/", functionHandler: mockHandler)
    
    let complexBinding: JSONValue = [
      "list": [
        "static",
        ["path": "item"]
      ]
    ]
    
    let result = context.resolveDynamicValue(complexBinding)
    let list = result["list"]?.arrayValue
    #expect(list?.count == 2)
    #expect(list?[0].stringValue == "static")
    #expect(list?[1].stringValue == "apple")
  }
}

private final class MockFunctionHandler: FunctionHandler, @unchecked Sendable {
  var functionToReturn: (any FunctionImplementation)? = nil
  var lastRequestedName: String? = nil
  var lastRequestedCatalogID: String? = nil

  func function(named name: String, catalogID: String?) -> (any FunctionImplementation)? {
    lastRequestedName = name
    lastRequestedCatalogID = catalogID
    return functionToReturn
  }
}
