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

private final class ConformanceMockFunctionHandler: FunctionHandler, @unchecked Sendable {
  func function(named: String, catalogID: String?) -> (any FunctionImplementation)? {
    nil
  }
}

struct BasicCatalogConformanceTests {
  private let functionHandler = ConformanceMockFunctionHandler()

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

  @Test func logicalOperators() throws {
    let dataModel = DataModel()
    let context = DataContext(dataModel: dataModel, path: "", functionHandler: functionHandler)

    let andFunction = AndFunction()
    let andTrue = try andFunction.evaluate(
      arguments: ["values": .array([.boolean(true), .boolean(true)])],
      context: context
    )
    #expect(andTrue == .boolean(true))

    let andFalse = try andFunction.evaluate(
      arguments: ["values": .array([.boolean(true), .boolean(false)])],
      context: context
    )
    #expect(andFalse == .boolean(false))

    let orFunction = OrFunction()
    let orTrue = try orFunction.evaluate(
      arguments: ["values": .array([.boolean(false), .boolean(true)])],
      context: context
    )
    #expect(orTrue == .boolean(true))

    let orFalse = try orFunction.evaluate(
      arguments: ["values": .array([.boolean(false), .boolean(false)])],
      context: context
    )
    #expect(orFalse == .boolean(false))

    let notFunction = NotFunction()
    let notTrue = try notFunction.evaluate(
      arguments: ["value": .boolean(false)],
      context: context
    )
    #expect(notTrue == .boolean(true))

    let notFalse = try notFunction.evaluate(
      arguments: ["value": .boolean(true)],
      context: context
    )
    #expect(notFalse == .boolean(false))
  }

  @Test func validationOperators() throws {
    let dataModel = DataModel()
    let context = DataContext(dataModel: dataModel, path: "", functionHandler: functionHandler)

    let emailFunction = EmailFunction()
    let validEmail = try emailFunction.evaluate(
      arguments: ["value": .string("user@example.com")],
      context: context
    )
    #expect(validEmail == .boolean(true))

    let invalidEmail = try emailFunction.evaluate(
      arguments: ["value": .string("invalid-email")],
      context: context
    )
    #expect(invalidEmail == .boolean(false))

    let regexFunction = RegexFunction()
    let matchRegex = try regexFunction.evaluate(
      arguments: ["pattern": .string("^[0-9]+$"), "value": .string("12345")],
      context: context
    )
    #expect(matchRegex == .boolean(true))

    let mismatchRegex = try regexFunction.evaluate(
      arguments: ["pattern": .string("^[0-9]+$"), "value": .string("abc")],
      context: context
    )
    #expect(mismatchRegex == .boolean(false))

    let lengthFunction = LengthFunction()
    let stringLengthValid = try lengthFunction.evaluate(
      arguments: ["value": .string("hello"), "min": .integer(3), "max": .integer(10)],
      context: context
    )
    #expect(stringLengthValid == .boolean(true))

    let stringLengthTooShort = try lengthFunction.evaluate(
      arguments: ["value": .string("hi"), "min": .integer(3)],
      context: context
    )
    #expect(stringLengthTooShort == .boolean(false))

    let requiredFunction = RequiredFunction()
    let requiredValid = try requiredFunction.evaluate(
      arguments: ["value": .string("not empty")],
      context: context
    )
    #expect(requiredValid == .boolean(true))

    let requiredEmpty = try requiredFunction.evaluate(
      arguments: ["value": .string("")],
      context: context
    )
    #expect(requiredEmpty == .boolean(false))

    let numericFunction = NumericFunction()
    let isNumeric = try numericFunction.evaluate(
      arguments: ["value": .string("42.5")],
      context: context
    )
    #expect(isNumeric == .boolean(true))

    let notNumeric = try numericFunction.evaluate(
      arguments: ["value": .string("not-a-number")],
      context: context
    )
    #expect(notNumeric == .boolean(false))
  }

  @Test func formatters() throws {
    let dataModel = DataModel()
    let context = DataContext(dataModel: dataModel, path: "", functionHandler: functionHandler)

    let formatNumberFunction = FormatNumberFunction()
    let formattedNumber = try formatNumberFunction.evaluate(
      arguments: ["value": .number(1234.56), "decimalPlaces": .integer(2)],
      context: context
    )
    let numberString = try #require(formattedNumber.stringValue)
    #expect(!numberString.isEmpty)

    let formatCurrencyFunction = FormatCurrencyFunction()
    let formattedCurrency = try formatCurrencyFunction.evaluate(
      arguments: ["value": .number(99.99), "currency": .string("USD")],
      context: context
    )
    let currencyString = try #require(formattedCurrency.stringValue)
    #expect(currencyString.contains("99.99"))

    let formatDateFunction = FormatDateFunction()
    let formattedDate = try formatDateFunction.evaluate(
      arguments: ["value": .string("2026-08-26T12:00:00Z"), "format": .string("yyyy-MM-dd")],
      context: context
    )
    #expect(formattedDate.stringValue == "2026-08-26")
  }
}
