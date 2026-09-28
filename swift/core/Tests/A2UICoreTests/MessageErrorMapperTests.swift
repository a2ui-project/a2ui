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

  @Test func mapValidationFailedError() {
    let error = ValidationFailedError(
      surfaceID: "s1",
      path: "/theme/primaryColor",
      message: "Type mismatch"
    )
    let result = mapper.map(error, surfaceID: "s1")
    if case .validationFailed(let valError) = result {
      #expect(valError.surfaceID == "s1")
      #expect(valError.path == "/theme/primaryColor")
      #expect(valError.message == "Type mismatch")
    } else {
      Issue.record("Expected .validationFailed")
    }
  }

  @Test func mapA2UIValidationError() {
    let error = A2UIValidationError(
      "Schema validation failed",
      details: [
        A2UIErrorDetail(
          path: "/theme/primaryColor",
          code: "type_mismatch",
          message: "Expected string, got number"
        )
      ]
    )
    let result = mapper.map(error, surfaceID: "s1")
    if case .validationFailed(let valError) = result {
      #expect(valError.surfaceID == "s1")
      #expect(valError.path == "/theme/primaryColor")
      #expect(valError.message == "Expected string, got number")
    } else {
      Issue.record("Expected .validationFailed")
    }
  }

  @Test func mapA2UIIntegrityError() {
    let error = A2UIIntegrityError(
      "Surface s1 already exists.",
      details: [
        A2UIErrorDetail(
          path: "createSurface.surfaceId",
          code: "SURFACE_EXISTS",
          message: "Surface s1 already exists."
        )
      ]
    )
    let result = mapper.map(error, surfaceID: "s1")
    if case .generic(let generic) = result {
      #expect(generic.code == "SURFACE_EXISTS")
      #expect(generic.surfaceID == "s1")
      #expect(generic.message == "Surface s1 already exists.")
    } else {
      Issue.record("Expected .generic")
    }
  }

  @Test func mapA2UIRecursionError() {
    let error = A2UIRecursionError("Function depth limit exceeded")
    let result = mapper.map(error, surfaceID: "s1")
    if case .generic(let generic) = result {
      #expect(generic.code == "RECURSION_LIMIT_EXCEEDED")
      #expect(generic.surfaceID == "s1")
      #expect(generic.message == "Function depth limit exceeded")
    } else {
      Issue.record("Expected .generic")
    }
  }

  @Test func mapA2UICatalogError() {
    let error = A2UICatalogError("Catalog not found: unknown")
    let result = mapper.map(error, surfaceID: "s1")
    if case .generic(let generic) = result {
      #expect(generic.code == "CATALOG_NOT_FOUND")
      #expect(generic.surfaceID == "s1")
      #expect(generic.message == "Catalog not found: unknown")
    } else {
      Issue.record("Expected .generic")
    }
  }

  @Test func parseExtractsSurfaceIDOnFailure() {
    let parser = MessageParser()
    let invalidPayloadWithSurface = """
      {
        "createSurface": {
          "surfaceId": "s1"
        }
      }
      """
    do {
      _ = try parser.parse(jsonString: invalidPayloadWithSurface)
      Issue.record("Expected parse to throw MessageParseError")
    } catch let parseError as MessageParseError {
      #expect(parseError.surfaceID == "s1")
    } catch {
      Issue.record("Expected MessageParseError, got \(error)")
    }
  }

  @Test func parseReturnsNilSurfaceIDForInvalidJSON() {
    let parser = MessageParser()
    do {
      _ = try parser.parse(jsonString: "not valid json")
      Issue.record("Expected parse to throw MessageParseError")
    } catch let parseError as MessageParseError {
      #expect(parseError.surfaceID == nil)
    } catch {
      Issue.record("Expected MessageParseError, got \(error)")
    }
  }
}
