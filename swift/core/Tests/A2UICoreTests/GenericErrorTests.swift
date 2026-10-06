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
import Foundation
import Testing

struct GenericErrorTests {

  private func encodedObject(_ error: GenericError) throws -> [String: Any] {
    let data = try JSONEncoder().encode(error)
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  @Test func encodesExpressionWhenPresent() throws {
    let error = GenericError(
      code: "EXPRESSION_ERROR", surfaceID: "s1", message: "boom", expression: "fn")
    let object = try encodedObject(error)
    #expect(object["code"] as? String == "EXPRESSION_ERROR")
    #expect(object["surfaceId"] as? String == "s1")
    #expect(object["message"] as? String == "boom")
    #expect(object["expression"] as? String == "fn")
  }

  @Test func omitsExpressionWhenAbsent() throws {
    let error = GenericError(code: "TEST_ERROR", surfaceID: "s1", message: "m")
    let object = try encodedObject(error)
    #expect(object["expression"] == nil)
    #expect(Set(object.keys) == ["code", "surfaceId", "message"])
  }

  @Test func roundTripsThroughClientServerError() throws {
    let original = ClientServerError.generic(
      GenericError(code: "EXPRESSION_ERROR", surfaceID: "s1", message: "boom", expression: "fn"))
    let data = try JSONEncoder().encode(original)
    #expect(try JSONDecoder().decode(ClientServerError.self, from: data) == original)

    let withoutExpression = Data(#"{"code":"X","surfaceId":"s1","message":"m"}"#.utf8)
    let decoded = try JSONDecoder().decode(ClientServerError.self, from: withoutExpression)
    #expect(decoded == .generic(GenericError(code: "X", surfaceID: "s1", message: "m")))
  }
}
