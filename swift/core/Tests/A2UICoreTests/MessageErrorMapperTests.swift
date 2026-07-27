// Copyright 2026 Google LLC
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

struct MessageErrorMapperTests {

  private let mapper = MessageErrorMapper()

  @Test func mapGenericError() {
    let error = GenericError(
      code: "TEST_ERROR",
      surfaceID: "s1",
      message: "Something went wrong"
    )
    let result = mapper.map(error, surfaceID: "s1")
    if case .generic(let generic) = result {
      #expect(generic.code == "TEST_ERROR")
      #expect(generic.surfaceID == "s1")
    } else {
      Issue.record("Expected .generic")
    }
  }

  @Test func mapUnknownErrorToGeneric() {
    struct CustomError: Error {}
    let result = mapper.map(CustomError(), surfaceID: "s1")
    if case .generic(let generic) = result {
      #expect(generic.code == "PARSING_FAILED")
      #expect(generic.surfaceID == "s1")
    } else {
      Issue.record("Expected .generic")
    }
  }

  @Test func extractSurfaceIDFromValidLine() {
    let parser = MessageParser()
    let id = parser.extractSurfaceID(
      fromLine: """
        {
          "createSurface": {
            "surfaceId": "s1",
            "catalogId": "default"
          }
        }
        """)
    #expect(id == "s1")
  }

  @Test func extractSurfaceIDReturnsNilForInvalidJson() {
    let parser = MessageParser()
    let id = parser.extractSurfaceID(fromLine: "not valid json")
    #expect(id == nil)
  }
}
