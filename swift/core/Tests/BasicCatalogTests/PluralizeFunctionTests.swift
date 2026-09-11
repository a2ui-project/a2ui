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

@testable import BasicCatalog

@MainActor
private final class MockFunctionHandler: FunctionHandler {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    return nil
  }
}

private final class MockPluralResolver: PluralResolver, @unchecked Sendable {
  func pluralCategory(for value: Double) -> PluralCategory {
    // A fake Arabic-like resolver for testing where 3-10 is 'few' and 11+ is 'many'
    let absVal = abs(value)
    if absVal == 0 { return .zero }
    if absVal == 1 { return .one }
    if absVal == 2 { return .two }
    if absVal >= 3 && absVal <= 10 { return .few }
    if absVal > 10 { return .many }
    return .other
  }
}

@MainActor
struct PluralizeFunctionTests {

  let function = PluralizeFunction()
  let context = DataContext(
    dataModel: DataModel(), path: "", functionHandler: MockFunctionHandler())

  // MARK: - Initialization

  @Test func initializesWithExpectedAPI() {
    #expect(function.api.name == "pluralize")
    #expect(function.api.returnType == .string)
  }

  // MARK: - Evaluation (Default Heuristic)

  @Test func returnsOneWhenValueIsOne() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .number(1),
        "one": .string("1 item"),
        "other": .string("many items"),
      ], context: context)
    #expect(result == .string("1 item"))
  }

  @Test func returnsOtherWhenValueIsOneButOneIsMissing() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .number(1),
        "other": .string("fallback"),
      ], context: context)
    #expect(result == .string("fallback"))
  }

  @Test func returnsZeroWhenValueIsZeroAndZeroIsProvided() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .number(0),
        "zero": .string("No items"),
        "other": .string("many items"),
      ], context: context)
    #expect(result == .string("No items"))
  }

  @Test func returnsOtherWhenValueIsZeroAndZeroIsMissing() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .number(0),
        "other": .string("0 items"),
      ], context: context)
    #expect(result == .string("0 items"))
  }

  @Test func returnsTwoWhenValueIsTwoAndTwoIsProvided() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .number(2),
        "two": .string("a pair of items"),
        "other": .string("many items"),
      ], context: context)
    #expect(result == .string("a pair of items"))
  }

  @Test func returnsOtherWhenValueIsMany() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .number(100),
        "one": .string("1 item"),
        "other": .string("100 items"),
      ], context: context)
    #expect(result == .string("100 items"))
  }

  @Test func worksWithNumericStrings() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .string("1"),
        "one": .string("1 item"),
        "other": .string("many items"),
      ], context: context)
    #expect(result == .string("1 item"))
  }

  @Test func returnsOtherWhenValueIsInvalidString() throws {
    let result = try function.evaluate(
      arguments: [
        "value": .string("invalid"),
        "other": .string("fallback"),
      ], context: context)
    #expect(result == .string("fallback"))
  }

  @Test func returnsEmptyStringWhenOtherIsMissing() throws {
    let result = try function.evaluate(
      arguments: ["value": .number(1)], context: context)
    #expect(result == .string(""))
  }

  // MARK: - Evaluation (With Custom Resolver)

  @Test func customResolverReturnsFew() throws {
    let resolver = MockPluralResolver()
    let funcWithResolver = PluralizeFunction(resolver: resolver)
    let result = try funcWithResolver.evaluate(
      arguments: [
        "value": .number(5),
        "few": .string("a few items"),
        "other": .string("many items"),
      ], context: context)
    #expect(result == .string("a few items"))
  }

  @Test func customResolverReturnsMany() throws {
    let resolver = MockPluralResolver()
    let funcWithResolver = PluralizeFunction(resolver: resolver)
    let result = try funcWithResolver.evaluate(
      arguments: [
        "value": .number(15),
        "many": .string("a lot of items"),
        "other": .string("other items"),
      ], context: context)
    #expect(result == .string("a lot of items"))
  }

  @Test func customResolverFallsBackToOtherIfCategoryMissing() throws {
    let resolver = MockPluralResolver()
    let funcWithResolver = PluralizeFunction(resolver: resolver)
    let result = try funcWithResolver.evaluate(
      arguments: [
        "value": .number(5),  // Resolver returns .few
        "many": .string("a lot of items"),
        "other": .string("fallback items"),
      ], context: context)
    #expect(result == .string("fallback items"))
  }
}
