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

import A2UIJSON
import Foundation
import JSONSchema
import OrderedCollections
import OrderedJSON

/// Direct validator and argument normalizer operating on canonical ``ComponentDefinition``,
/// ``FunctionDefinition``, ``SurfacePropertiesDefinition``, and ``TypeDefinition`` values.
///
/// Avoids runtime JSON Schema AST rewriting and `Schema(...)` recompilation for dynamic function
/// arguments, nullable local function arguments, and unknown-property filtering.
enum ModelPayloadValidator {
  private struct Context {
    let types: [String: TypeDefinition]
    let isV10: Bool
    let allowUnknownProperties: Bool
    let allowDynamicExpressions: Bool
    let allowNullValues: Bool
    let pathSeparator: String
    let messagePrefix: String
  }

  private static let v09ValidReturnTypes: Set<String> = [
    "string", "number", "boolean", "array", "object", "any", "void",
  ]

  // MARK: - Component Validation

  static func validateComponentProperties(
    _ properties: [String: JSONValue],
    definition: ComponentDefinition,
    types: [String: TypeDefinition],
    protocolVersion: A2UIProtocolVersion,
    allowUnknownElements: Bool
  ) -> [A2UIErrorDetail] {
    let context = Context(
      types: types,
      isV10: protocolVersion.isAtLeastV10,
      allowUnknownProperties: allowUnknownElements || definition.allowsAdditionalProperties,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: "/",
      messagePrefix: "Validation failed for component '\(definition.name)'"
    )
    var errors: [A2UIErrorDetail] = []

    for param in definition.parameters where param.required {
      if properties[param.name] == nil {
        errors.append(
          A2UIErrorDetail(
            path: param.name,
            code: "missing_field",
            message: "\(context.messagePrefix) at '\(param.name)': "
              + "Missing required property '\(param.name)'."
          )
        )
      }
    }

    for group in definition.atLeastOneOf {
      if !group.contains(where: { properties[$0] != nil }) {
        let joined = group.joined(separator: ", ")
        errors.append(
          A2UIErrorDetail(
            path: "/\(definition.name)",
            code: "missing_field",
            message: "\(context.messagePrefix): At least one of [\(joined)] is required."
          )
        )
      }
    }

    if !context.allowUnknownProperties {
      let declaredNames = Set(definition.parameters.map(\.name))
      for key in properties.keys.sorted() where !declaredNames.contains(key) {
        errors.append(
          A2UIErrorDetail(
            path: key,
            code: "invalid_value",
            message: "\(context.messagePrefix) at '\(key)': Unknown property '\(key)'."
          )
        )
      }
    }

    for param in definition.parameters {
      guard let value = properties[param.name] else { continue }
      validateType(
        value,
        against: param.type,
        path: param.name,
        context: context,
        visitedRefs: [],
        into: &errors
      )
    }

    return errors
  }

  /// Validates a component's `@checks` / `checks` mixin value against `[CheckRule]`.
  static func validateChecks(
    _ value: JSONValue,
    componentType: String,
    key: String,
    protocolVersion: A2UIProtocolVersion,
    allowUnknownElements: Bool
  ) -> [A2UIErrorDetail] {
    let context = Context(
      types: [:],
      isV10: protocolVersion.isAtLeastV10,
      allowUnknownProperties: allowUnknownElements,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: "/",
      messagePrefix: "Validation failed for component '\(componentType)'"
    )
    var errors: [A2UIErrorDetail] = []
    validateType(
      value,
      against: .array(items: .checkRule()),
      path: key,
      context: context,
      visitedRefs: [],
      into: &errors
    )
    return errors
  }

  /// Validates a component's `@accessibility` / `accessibility` mixin value against
  /// `AccessibilityAttributes`.
  static func validateAccessibility(
    _ value: JSONValue,
    key: String,
    protocolVersion: A2UIProtocolVersion,
    allowUnknownElements: Bool
  ) -> [A2UIErrorDetail] {
    let context = Context(
      types: [:],
      isV10: protocolVersion.isAtLeastV10,
      allowUnknownProperties: allowUnknownElements,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: "/",
      messagePrefix: "Field '\(key)' must match AccessibilityAttributes"
    )
    var errors: [A2UIErrorDetail] = []
    validateType(
      value,
      against: .accessibility(),
      path: key,
      context: context,
      visitedRefs: [],
      into: &errors
    )
    return errors
  }

  // MARK: - Function Argument Validation

  static func validateFunctionArguments(
    _ args: [String: JSONValue],
    definition: FunctionDefinition,
    types: [String: TypeDefinition],
    protocolVersion: A2UIProtocolVersion,
    allowDynamicExpressions: Bool,
    allowNullValues: Bool
  ) -> [A2UIErrorDetail] {
    let basePath = "functions.\(definition.name)"
    let context = Context(
      types: types,
      isV10: protocolVersion.isAtLeastV10,
      allowUnknownProperties: false,
      allowDynamicExpressions: allowDynamicExpressions,
      allowNullValues: allowNullValues,
      pathSeparator: ".",
      messagePrefix: "Validation failed for function '\(definition.name)'"
    )
    var errors: [A2UIErrorDetail] = []

    for param in definition.parameters where param.required {
      if args[param.name] == nil {
        errors.append(
          A2UIErrorDetail(
            path: "\(basePath).\(param.name)",
            code: "missing_field",
            message: "Missing required argument '\(param.name)'."
          )
        )
      }
    }

    for group in definition.atLeastOneOf {
      if !group.contains(where: { args[$0] != nil }) {
        let joined = group.joined(separator: ", ")
        errors.append(
          A2UIErrorDetail(
            path: basePath,
            code: "invalid_value",
            message: "At least one of [\(joined)] is required."
          )
        )
      }
    }

    let declaredNames = Set(definition.parameters.map(\.name))
    for key in args.keys.sorted() where !declaredNames.contains(key) {
      let argPath = "\(basePath).\(key)"
      switch definition.additionalParameters {
      case .disallowed:
        errors.append(
          A2UIErrorDetail(
            path: argPath,
            code: "invalid_value",
            message: "\(key): Additional argument '\(key)' is not allowed."
          )
        )
      case .allowed:
        break
      case .typed(let extraType):
        if let value = args[key] {
          validateType(
            value,
            against: extraType,
            path: argPath,
            context: context,
            visitedRefs: [],
            into: &errors
          )
        }
      }
    }

    for param in definition.parameters {
      guard let value = args[param.name] else { continue }
      validateType(
        value,
        against: param.type,
        path: "\(basePath).\(param.name)",
        context: context,
        visitedRefs: [],
        into: &errors
      )
    }

    return errors
  }

  // MARK: - Surface Properties / Theme Validation

  static func validateSurfaceProperties(
    _ theme: OrderedDictionary<String, JSONValue>,
    definition: SurfacePropertiesDefinition,
    types: [String: TypeDefinition],
    protocolVersion: A2UIProtocolVersion
  ) -> [A2UIErrorDetail] {
    let context = Context(
      types: types,
      isV10: protocolVersion.isAtLeastV10,
      allowUnknownProperties: false,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: ".",
      messagePrefix: "Surface theme validation failed"
    )
    var errors: [A2UIErrorDetail] = []

    for prop in definition.properties where prop.required {
      if theme[prop.name] == nil {
        errors.append(
          A2UIErrorDetail(
            path: "theme.\(prop.name)",
            code: "missing_field",
            message: "\(prop.name): Missing required property '\(prop.name)'."
          )
        )
      }
    }

    let declaredNames = Set(definition.properties.map(\.name))
    for key in theme.keys where !declaredNames.contains(key) {
      let propPath = "theme.\(key)"
      switch definition.additionalProperties {
      case .disallowed:
        errors.append(
          A2UIErrorDetail(
            path: propPath,
            code: "invalid_value",
            message: "\(key): Additional property '\(key)' is not allowed."
          )
        )
      case .allowed:
        break
      case .typed(let extraType):
        if let value = theme[key] {
          validateType(
            value,
            against: extraType,
            path: propPath,
            context: context,
            visitedRefs: [],
            into: &errors
          )
        }
      }
    }

    for prop in definition.properties {
      guard let value = theme[prop.name] else { continue }
      validateType(
        value,
        against: prop.type,
        path: "theme.\(prop.name)",
        context: context,
        visitedRefs: [],
        into: &errors
      )
    }

    return errors
  }

  // MARK: - Canonical Argument Normalization (Coercion & Defaults)

  /// Coerces `ValidationResult` objects into booleans for parameters typed as boolean /
  /// `DynamicBoolean`, recursively across arrays and objects.
  static func coerceValidationResults(
    in arguments: [String: JSONValue],
    definition: FunctionDefinition,
    types: [String: TypeDefinition]
  ) -> [String: JSONValue] {
    var result = arguments
    for param in definition.parameters {
      if let value = result[param.name] {
        result[param.name] = coerceValue(value, type: param.type, types: types, visitedRefs: [])
      }
    }
    if case .typed(let extraType) = definition.additionalParameters {
      let declared = Set(definition.parameters.map(\.name))
      for (key, value) in result where !declared.contains(key) {
        result[key] = coerceValue(value, type: extraType, types: types, visitedRefs: [])
      }
    }
    return result
  }

  private static func coerceValue(
    _ value: JSONValue,
    type: TypeDefinition,
    types: [String: TypeDefinition],
    visitedRefs: Set<String>
  ) -> JSONValue {
    if isDynamicBooleanType(type, types: types, visitedRefs: visitedRefs) {
      return .boolean(value.coercedDynamicBoolean)
    }
    switch type {
    case .array(_, let items, _, _, _, _, _, _, _):
      guard let items, let arr = value.arrayValue else { return value }
      return .array(
        arr.map { coerceValue($0, type: items, types: types, visitedRefs: visitedRefs) })
    case .object(_, let properties, let additional, _, _, _, _, _):
      guard case .object(var members) = value else { return value }
      let declared = Set(properties.map(\.name))
      for prop in properties {
        if let memberVal = members[prop.name] {
          members[prop.name] = coerceValue(
            memberVal,
            type: prop.type,
            types: types,
            visitedRefs: visitedRefs
          )
        }
      }
      if case .typed(let extraType) = additional {
        for (key, memberVal) in members where !declared.contains(key) {
          members[key] = coerceValue(
            memberVal,
            type: extraType,
            types: types,
            visitedRefs: visitedRefs
          )
        }
      }
      return .object(members)
    case .ref(let refName, _, _, _, _):
      guard !visitedRefs.contains(refName), let target = types[refName] else { return value }
      var next = visitedRefs
      next.insert(refName)
      return coerceValue(value, type: target, types: types, visitedRefs: next)
    default:
      return value
    }
  }

  private static func isDynamicBooleanType(
    _ type: TypeDefinition,
    types: [String: TypeDefinition],
    visitedRefs: Set<String>
  ) -> Bool {
    switch type {
    case .boolean:
      return true
    case .union(let variants, _, _, _, _, _, _):
      let hasBool = variants.contains {
        isDynamicBooleanType($0, types: types, visitedRefs: visitedRefs)
      }
      let onlyBoolOrDynamic = variants.allSatisfy { variant in
        if isDynamicBooleanType(variant, types: types, visitedRefs: visitedRefs) {
          return true
        }
        switch variant {
        case .dataBinding, .functionCall:
          return true
        default:
          return false
        }
      }
      return hasBool && onlyBoolOrDynamic
    case .ref(let refName, _, _, _, _):
      guard !visitedRefs.contains(refName), let target = types[refName] else { return false }
      var next = visitedRefs
      next.insert(refName)
      return isDynamicBooleanType(target, types: types, visitedRefs: next)
    default:
      return false
    }
  }

  /// Applies declared parameter default values recursively to function arguments (for agent-routed
  /// function calls).
  static func applyingArgumentDefaults(
    of definition: FunctionDefinition,
    types: [String: TypeDefinition],
    to arguments: [String: JSONValue]
  ) -> [String: JSONValue] {
    applyingParameterDefaults(definition.parameters, types: types, to: arguments, visitedRefs: [])
  }

  private static func applyingParameterDefaults(
    _ parameters: [ParameterDefinition],
    types: [String: TypeDefinition],
    to values: [String: JSONValue],
    visitedRefs: Set<String>
  ) -> [String: JSONValue] {
    var result = values
    for param in parameters {
      if let existing = result[param.name] {
        result[param.name] = applyingTypeDefaults(
          param.type,
          types: types,
          to: existing,
          visitedRefs: visitedRefs
        )
      } else if let defaultValue = resolvedDefault(
        for: param.type,
        types: types,
        visitedRefs: visitedRefs
      ) {
        result[param.name] = defaultValue
      }
    }
    return result
  }

  private static func applyingTypeDefaults(
    _ type: TypeDefinition,
    types: [String: TypeDefinition],
    to value: JSONValue,
    visitedRefs: Set<String>
  ) -> JSONValue {
    switch type {
    case .object(_, let properties, _, _, _, _, _, _):
      guard case .object(var members) = value, !properties.isEmpty else { return value }
      let dict = Dictionary(uniqueKeysWithValues: members.map { ($0.key, $0.value) })
      let completed = applyingParameterDefaults(
        properties,
        types: types,
        to: dict,
        visitedRefs: visitedRefs
      )
      for (key, member) in completed {
        members[key] = member
      }
      return .object(members)
    case .ref(let refName, _, _, _, _):
      guard !visitedRefs.contains(refName), let target = types[refName] else { return value }
      var next = visitedRefs
      next.insert(refName)
      return applyingTypeDefaults(target, types: types, to: value, visitedRefs: next)
    default:
      return value
    }
  }

  private static func resolvedDefault(
    for type: TypeDefinition,
    types: [String: TypeDefinition],
    visitedRefs: Set<String>
  ) -> JSONValue? {
    if let direct = type.defaultJSONValue {
      return direct
    }
    if case .ref(let refName, _, _, _, _) = type,
      !visitedRefs.contains(refName),
      let target = types[refName]
    {
      var next = visitedRefs
      next.insert(refName)
      return resolvedDefault(for: target, types: types, visitedRefs: next)
    }
    return nil
  }

  // MARK: - Core Recursive Type Validation

  private static func validateType(
    _ value: JSONValue,
    against type: TypeDefinition,
    path: String,
    context: Context,
    visitedRefs: Set<String>,
    into errors: inout [A2UIErrorDetail]
  ) {
    if context.allowNullValues && value == .null {
      return
    }
    if context.allowDynamicExpressions && isAnyDynamicExpression(value) {
      return
    }

    switch type {
    case .string(let dynamic, let formats, let pattern, let minLength, let maxLength, _, _, _, _):
      if dynamic && isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "string") {
        return
      }
      guard let str = value.stringValue else {
        appendError(path: path, message: "Expected a string.", context: context, into: &errors)
        return
      }
      let codePointCount = str.unicodeScalars.count
      if let minLength, codePointCount < minLength {
        appendError(
          path: path,
          message: "String length \(codePointCount) is less than minimum \(minLength).",
          context: context,
          into: &errors
        )
      }
      if let maxLength, codePointCount > maxLength {
        appendError(
          path: path,
          message: "String length \(codePointCount) exceeds maximum \(maxLength).",
          context: context,
          into: &errors
        )
      }
      if let pattern, !matchesRegex(str, pattern: pattern) {
        appendError(
          path: path,
          message: "String does not match pattern '\(pattern)'.",
          context: context,
          into: &errors
        )
      }
      if let formats, !formats.isEmpty, !formats.contains(where: { matchesFormat(str, format: $0) })
      {
        let expected = formats.joined(separator: " | ")
        appendError(
          path: path,
          message: "String '\(str)' does not match format '\(expected)'.",
          context: context,
          into: &errors
        )
      }

    case .number(let dynamic, let min, let max, _, _, _, _):
      if dynamic && isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "number") {
        return
      }
      guard let num = value.doubleValue else {
        appendError(path: path, message: "Expected a number.", context: context, into: &errors)
        return
      }
      if let min, num < min {
        appendError(
          path: path,
          message: "Value \(num) is less than minimum \(min).",
          context: context,
          into: &errors
        )
      }
      if let max, num > max {
        appendError(
          path: path,
          message: "Value \(num) exceeds maximum \(max).",
          context: context,
          into: &errors
        )
      }

    case .integer(let dynamic, let min, let max, _, _, _, _):
      if dynamic && isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "number") {
        return
      }
      guard let intVal = value.intValue else {
        appendError(path: path, message: "Expected an integer.", context: context, into: &errors)
        return
      }
      if let min, intVal < min {
        appendError(
          path: path,
          message: "Value \(intVal) is less than minimum \(min).",
          context: context,
          into: &errors
        )
      }
      if let max, intVal > max {
        appendError(
          path: path,
          message: "Value \(intVal) exceeds maximum \(max).",
          context: context,
          into: &errors
        )
      }

    case .boolean(let dynamic, _, _, _, _):
      if dynamic
        && isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "boolean")
      {
        return
      }
      guard value.boolValue != nil else {
        appendError(path: path, message: "Expected a boolean.", context: context, into: &errors)
        return
      }

    case .enum(let values, let valueType, let dynamic, _, _, _, _):
      if dynamic
        && isDynamicValueExpression(
          value,
          isV10: context.isV10,
          v09ReturnType: valueType.rawValue
        )
      {
        return
      }
      guard values.contains(where: { jsonScalarEquals($0, value) }) else {
        appendError(
          path: path,
          message: "Value is not one of the allowed enum values.",
          context: context,
          into: &errors
        )
        return
      }

    case .const(let expected, _, _, _):
      guard jsonScalarEquals(expected, value) else {
        appendError(
          path: path,
          message: "Value does not match required constant.",
          context: context,
          into: &errors
        )
        return
      }

    case .any(let dynamic, let nullable, _, _, _, _):
      if value == .null {
        if !nullable {
          appendError(
            path: path,
            message: "Value must not be null.",
            context: context,
            into: &errors
          )
        }
        return
      }
      if dynamic && !nullable {
        if case .object(let dict) = value,
          !isDataBinding(value, isV10: context.isV10),
          !isFunctionCall(value, isV10: context.isV10, v09ReturnType: nil)
        {
          if context.isV10 {
            for key in dict.keys where key.hasPrefix("@") && !key.hasPrefix("@@") {
              appendError(
                path: joinPath(path, key, separator: context.pathSeparator),
                message: "Unescaped reserved key '\(key)' is not allowed in DynamicValue.",
                context: context,
                into: &errors
              )
            }
          }
        }
      }

    case .object(
      let dynamic, let properties, let additionalProperties, let atLeastOneOf, _, _, _,
      _):
      if dynamic && isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "object") {
        return
      }
      guard let dict = value.objectValue else {
        appendError(path: path, message: "Expected an object.", context: context, into: &errors)
        return
      }
      validateObject(
        dict,
        properties: properties,
        additionalProperties: additionalProperties,
        atLeastOneOf: atLeastOneOf,
        path: path,
        context: context,
        visitedRefs: visitedRefs,
        into: &errors
      )

    case .array(let dynamic, let items, let minItems, let maxItems, let uniqueItems, _, _, _, _):
      if dynamic && isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "array") {
        return
      }
      guard let array = value.arrayValue else {
        appendError(path: path, message: "Expected an array.", context: context, into: &errors)
        return
      }
      if let minItems, array.count < minItems {
        appendError(
          path: path,
          message: "Array count \(array.count) is less than minimum \(minItems).",
          context: context,
          into: &errors
        )
      }
      if let maxItems, array.count > maxItems {
        appendError(
          path: path,
          message: "Array count \(array.count) exceeds maximum \(maxItems).",
          context: context,
          into: &errors
        )
      }
      if uniqueItems {
        for i in array.indices {
          for j in 0..<i where MetadataValidator.jsonEquals(array[i], array[j]) {
            appendError(
              path: joinPath(path, "\(i)", separator: context.pathSeparator),
              message: "Array elements must be unique.",
              context: context,
              into: &errors
            )
            break
          }
        }
      }
      if let items {
        for (index, element) in array.enumerated() {
          validateType(
            element,
            against: items,
            path: joinPath(path, "\(index)", separator: context.pathSeparator),
            context: context,
            visitedRefs: visitedRefs,
            into: &errors
          )
        }
      }

    case .union(let variants, let exclusive, let dynamic, _, _, _, _):
      if dynamic && isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: nil) {
        return
      }
      var matchCount = 0
      for variant in variants {
        var candidateErrors: [A2UIErrorDetail] = []
        validateType(
          value,
          against: variant,
          path: path,
          context: context,
          visitedRefs: visitedRefs,
          into: &candidateErrors
        )
        if candidateErrors.isEmpty {
          matchCount += 1
        }
      }
      if exclusive {
        if matchCount != 1 {
          let detail =
            matchCount == 0
            ? "Value did not match any union variant."
            : "Value matched \(matchCount) exclusive union variants; expected exactly 1."
          appendError(path: path, message: detail, context: context, into: &errors)
        }
      } else if matchCount == 0 {
        appendError(
          path: path,
          message: "Value did not match any union variant.",
          context: context,
          into: &errors
        )
      }

    case .dataBinding:
      guard isDataBinding(value, isV10: context.isV10) else {
        let key = context.isV10 ? "@path" : "path"
        appendError(
          path: path,
          message: "Expected a DataBinding object with string '\(key)'.",
          context: context,
          into: &errors
        )
        return
      }

    case .functionCall:
      guard isFunctionCall(value, isV10: context.isV10, v09ReturnType: nil) else {
        let key = context.isV10 ? "@call" : "call"
        appendError(
          path: path,
          message: "Expected a FunctionCall object with string '\(key)'.",
          context: context,
          into: &errors
        )
        return
      }

    case .ref(let refName, _, _, _, _):
      guard !visitedRefs.contains(refName), let target = context.types[refName] else { return }
      var next = visitedRefs
      next.insert(refName)
      validateType(
        value,
        against: target,
        path: path,
        context: context,
        visitedRefs: next,
        into: &errors
      )

    case .child:
      guard value.stringValue != nil else {
        appendError(
          path: path,
          message: "Expected a child component ID string.",
          context: context,
          into: &errors
        )
        return
      }

    case .childList:
      validateChildList(value, path: path, context: context, into: &errors)

    case .action:
      validateAction(value, path: path, context: context, into: &errors)

    case .checkRule:
      validateCheckRule(value, path: path, context: context, into: &errors)

    case .accessibility:
      validateAccessibilityValue(value, path: path, context: context, into: &errors)

    case .rawJSONSchema(let raw):
      if let compiled = try? Schema(rawSchema: raw, context: A2UISchemaRegistry.makeContext()) {
        let result = compiled.validate(value)
        if !result.isValid {
          let message = result.errors?.first?.message ?? "Value failed schema validation."
          appendError(path: path, message: message, context: context, into: &errors)
        }
      }
    }
  }

  private static func validateObject(
    _ dict: OrderedDictionary<String, JSONValue>,
    properties: [ParameterDefinition],
    additionalProperties: AdditionalProperties,
    atLeastOneOf: [[String]],
    path: String,
    context: Context,
    visitedRefs: Set<String>,
    into errors: inout [A2UIErrorDetail]
  ) {
    for prop in properties where prop.required {
      if dict[prop.name] == nil {
        let propPath = joinPath(path, prop.name, separator: context.pathSeparator)
        errors.append(
          A2UIErrorDetail(
            path: propPath,
            code: "missing_field",
            message: "\(context.messagePrefix) at '\(propPath)': "
              + "Missing required property '\(prop.name)'."
          )
        )
      }
    }

    for group in atLeastOneOf {
      if !group.contains(where: { dict[$0] != nil }) {
        let joined = group.joined(separator: ", ")
        appendError(
          path: path,
          message: "At least one of [\(joined)] is required.",
          context: context,
          into: &errors
        )
      }
    }

    let declared = Set(properties.map(\.name))
    for (key, propValue) in dict where !declared.contains(key) {
      let propPath = joinPath(path, key, separator: context.pathSeparator)
      switch additionalProperties {
      case .disallowed:
        if !context.allowUnknownProperties {
          appendError(
            path: propPath,
            message: "Unknown property '\(key)'.",
            context: context,
            into: &errors
          )
        }
      case .allowed:
        break
      case .typed(let extraType):
        validateType(
          propValue,
          against: extraType,
          path: propPath,
          context: context,
          visitedRefs: visitedRefs,
          into: &errors
        )
      }
    }

    for prop in properties {
      guard let propValue = dict[prop.name] else { continue }
      validateType(
        propValue,
        against: prop.type,
        path: joinPath(path, prop.name, separator: context.pathSeparator),
        context: context,
        visitedRefs: visitedRefs,
        into: &errors
      )
    }
  }

  // MARK: - Protocol Component-Only Builtin Validators

  private static func validateChildList(
    _ value: JSONValue,
    path: String,
    context: Context,
    into errors: inout [A2UIErrorDetail]
  ) {
    switch value {
    case .array(let array):
      for (index, item) in array.enumerated() where item.stringValue == nil {
        appendError(
          path: joinPath(path, "\(index)", separator: context.pathSeparator),
          message: "ChildList array entries must be component ID strings.",
          context: context,
          into: &errors
        )
      }
    case .object(let dict):
      let templateParams = [
        ParameterDefinition.string("componentId", required: true),
        ParameterDefinition.string("path", required: true),
      ]
      validateObject(
        dict,
        properties: templateParams,
        additionalProperties: .disallowed,
        atLeastOneOf: [],
        path: path,
        context: context,
        visitedRefs: [],
        into: &errors
      )
    default:
      appendError(
        path: path,
        message: "ChildList must be an array of component IDs or a template object.",
        context: context,
        into: &errors
      )
    }
  }

  private static func validateAction(
    _ value: JSONValue,
    path: String,
    context: Context,
    into errors: inout [A2UIErrorDetail]
  ) {
    guard let dict = value.objectValue else {
      appendError(path: path, message: "Action must be an object.", context: context, into: &errors)
      return
    }
    let hasEvent = dict["event"] != nil
    let hasCall = dict["functionCall"] != nil
    guard hasEvent != hasCall else {
      appendError(
        path: path,
        message: "Action must specify exactly one of 'event' or 'functionCall'.",
        context: context,
        into: &errors
      )
      return
    }
    if hasEvent {
      var eventProps: [ParameterDefinition] = [
        .string("name", required: true),
        .object(
          "context",
          additionalProperties: .typed(.any(dynamic: true, nullable: false))
        ),
      ]
      if context.isV10 {
        eventProps.append(.string("userMessage", dynamic: true))
      }
      validateObject(
        dict,
        properties: [.object("event", properties: eventProps, required: true)],
        additionalProperties: .disallowed,
        atLeastOneOf: [],
        path: path,
        context: context,
        visitedRefs: [],
        into: &errors
      )
    } else {
      validateObject(
        dict,
        properties: [.functionCall("functionCall", required: true)],
        additionalProperties: .disallowed,
        atLeastOneOf: [],
        path: path,
        context: context,
        visitedRefs: [],
        into: &errors
      )
    }
  }

  private static func validateCheckRule(
    _ value: JSONValue,
    path: String,
    context: Context,
    into errors: inout [A2UIErrorDetail]
  ) {
    guard let dict = value.objectValue else {
      appendError(
        path: path,
        message: "CheckRule must be an object.",
        context: context,
        into: &errors
      )
      return
    }
    let conditionType: TypeDefinition =
      context.isV10
      ? .union(variants: [.dataBinding(), .functionCall()], exclusive: true)
      : .boolean(dynamic: true)
    let params = [
      ParameterDefinition(name: "condition", type: conditionType, required: true),
      ParameterDefinition.string("message", required: !context.isV10),
    ]
    validateObject(
      dict,
      properties: params,
      additionalProperties: .disallowed,
      atLeastOneOf: [],
      path: path,
      context: context,
      visitedRefs: [],
      into: &errors
    )
  }

  private static func validateAccessibilityValue(
    _ value: JSONValue,
    path: String,
    context: Context,
    into errors: inout [A2UIErrorDetail]
  ) {
    guard let dict = value.objectValue else {
      appendError(
        path: path,
        message: "AccessibilityAttributes must be an object.",
        context: context,
        into: &errors
      )
      return
    }
    var params: [ParameterDefinition] = [
      .string("label", dynamic: true),
      .string("description", dynamic: true),
    ]
    let additional: AdditionalProperties
    if context.isV10 {
      params.append(.enum("live", values: ["off", "polite", "assertive"]))
      params.append(.boolean("hidden", dynamic: true))
      additional = .disallowed
    } else {
      additional = .allowed
    }
    validateObject(
      dict,
      properties: params,
      additionalProperties: additional,
      atLeastOneOf: [],
      path: path,
      context: context,
      visitedRefs: [],
      into: &errors
    )
  }

  // MARK: - Dynamic Expression Matching

  private static func isDynamicValueExpression(
    _ value: JSONValue,
    isV10: Bool,
    v09ReturnType: String?
  ) -> Bool {
    isDataBinding(value, isV10: isV10)
      || isFunctionCall(value, isV10: isV10, v09ReturnType: v09ReturnType)
  }

  private static func isDataBinding(_ value: JSONValue, isV10: Bool) -> Bool {
    guard let dict = value.objectValue, dict.count == 1 else { return false }
    let key = isV10 ? "@path" : "path"
    return dict[key]?.stringValue != nil
  }

  private static func isFunctionCall(
    _ value: JSONValue,
    isV10: Bool,
    v09ReturnType: String?
  ) -> Bool {
    guard let dict = value.objectValue else { return false }
    if isV10 {
      guard dict["@call"]?.stringValue != nil else { return false }
      for (key, member) in dict {
        switch key {
        case "@call":
          break
        case "catalogId":
          guard member.stringValue != nil else { return false }
        case "args":
          guard member.objectValue != nil else { return false }
        default:
          return false
        }
      }
      return true
    }

    guard dict["call"]?.stringValue != nil else { return false }
    for (key, member) in dict {
      switch key {
      case "call":
        break
      case "args":
        guard member.objectValue != nil else { return false }
      case "returnType":
        guard let rt = member.stringValue, v09ValidReturnTypes.contains(rt) else { return false }
        if let expected = v09ReturnType, rt != expected {
          return false
        }
      default:
        return false
      }
    }
    return true
  }

  private static func isAnyDynamicExpression(_ value: JSONValue) -> Bool {
    guard let dict = value.objectValue else { return false }
    return dict["path"] != nil
      || dict["@path"] != nil
      || dict["call"] != nil
      || dict["@call"] != nil
      || dict["function"] != nil
  }

  // MARK: - Format & Regex Validators

  private static func matchesRegex(_ string: String, pattern: String) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
    let range = NSRange(string.startIndex..<string.endIndex, in: string)
    return regex.firstMatch(in: string, options: [], range: range) != nil
  }

  private static func matchesFormat(_ string: String, format: String) -> Bool {
    switch format {
    case "date":
      return isValidRFC3339Date(string)
    case "time":
      return isValidRFC3339Time(string)
    case "date-time":
      return isValidRFC3339DateTime(string)
    case "uri":
      return isValidRFC3986URI(string)
    case "email":
      return isValidEmail(string)
    default:
      return true
    }
  }

  /// Validates RFC 3339 `full-date` (`YYYY-MM-DD`) including calendar month and leap-year bounds.
  private static func isValidRFC3339Date(_ string: String) -> Bool {
    let bytes = Array(string.utf8)
    guard bytes.count == 10, bytes[4] == UInt8(ascii: "-"), bytes[7] == UInt8(ascii: "-") else {
      return false
    }
    guard let year = parseASCIIDigits(bytes[0..<4]),
      let month = parseASCIIDigits(bytes[5..<7]),
      let day = parseASCIIDigits(bytes[8..<10])
    else {
      return false
    }
    guard (1...12).contains(month) else { return false }
    let maxDay = daysInMonth(month, year: year)
    return (1...maxDay).contains(day)
  }

  /// Validates ISO-8601 / RFC 3339 time (`HH:MM:SS(.frac)?(Z|[+-]HH:MM)?`).
  private static func isValidRFC3339Time(_ string: String) -> Bool {
    let bytes = Array(string.utf8)
    guard bytes.count >= 8, bytes[2] == UInt8(ascii: ":"), bytes[5] == UInt8(ascii: ":") else {
      return false
    }
    guard let hour = parseASCIIDigits(bytes[0..<2]),
      let minute = parseASCIIDigits(bytes[3..<5]),
      let second = parseASCIIDigits(bytes[6..<8])
    else {
      return false
    }
    guard (0...23).contains(hour), (0...59).contains(minute), (0...60).contains(second) else {
      return false
    }

    var idx = 8
    if idx < bytes.count && bytes[idx] == UInt8(ascii: ".") {
      idx += 1
      let fracStart = idx
      while idx < bytes.count && isASCIIDigit(bytes[idx]) {
        idx += 1
      }
      guard idx > fracStart else { return false }
    }

    if idx == bytes.count {
      return true
    }
    let tzByte = bytes[idx]
    if tzByte == UInt8(ascii: "Z") || tzByte == UInt8(ascii: "z") {
      return idx + 1 == bytes.count
    }
    if tzByte == UInt8(ascii: "+") || tzByte == UInt8(ascii: "-") {
      guard idx + 6 == bytes.count, bytes[idx + 3] == UInt8(ascii: ":") else { return false }
      guard let tzHour = parseASCIIDigits(bytes[(idx + 1)..<(idx + 3)]),
        let tzMinute = parseASCIIDigits(bytes[(idx + 4)..<(idx + 6)])
      else {
        return false
      }
      return (0...23).contains(tzHour) && (0...59).contains(tzMinute)
    }
    return false
  }

  /// Validates ISO-8601 / RFC 3339 `date-time` (`<full-date>[Tt ]<time>`).
  private static func isValidRFC3339DateTime(_ string: String) -> Bool {
    let bytes = Array(string.utf8)
    guard bytes.count >= 19 else { return false }
    let sep = bytes[10]
    guard sep == UInt8(ascii: "T") || sep == UInt8(ascii: "t") || sep == UInt8(ascii: " ") else {
      return false
    }
    let datePart = String(decoding: bytes[0..<10], as: UTF8.self)
    let timePart = String(decoding: bytes[11...], as: UTF8.self)
    return isValidRFC3339Date(datePart) && isValidRFC3339Time(timePart)
  }

  /// Validates RFC 3986 scheme-prefixed URI syntax (`^[A-Za-z][A-Za-z0-9+.-]*:\S*$`).
  private static func isValidRFC3986URI(_ string: String) -> Bool {
    guard let colonIdx = string.firstIndex(of: ":"), colonIdx > string.startIndex else {
      return false
    }
    let scheme = string[..<colonIdx]
    guard let first = scheme.unicodeScalars.first,
      (first >= "A" && first <= "Z") || (first >= "a" && first <= "z")
    else {
      return false
    }
    for scalar in scheme.unicodeScalars.dropFirst() {
      let ok =
        (scalar >= "A" && scalar <= "Z")
        || (scalar >= "a" && scalar <= "z")
        || (scalar >= "0" && scalar <= "9")
        || scalar == "+" || scalar == "-" || scalar == "."
      guard ok else { return false }
    }
    let remainder = string[string.index(after: colonIdx)...]
    for scalar in remainder.unicodeScalars {
      if scalar.properties.isWhitespace || scalar.value < 0x21 {
        return false
      }
    }
    return true
  }

  private static func isValidEmail(_ string: String) -> Bool {
    let parts = string.split(separator: "@", omittingEmptySubsequences: false)
    guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return false }
    return parts[1].contains(".")
      && !string.unicodeScalars.contains(where: \.properties.isWhitespace)
  }

  private static func isASCIIDigit(_ byte: UInt8) -> Bool {
    byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9")
  }

  private static func parseASCIIDigits(_ slice: ArraySlice<UInt8>) -> Int? {
    guard !slice.isEmpty else { return nil }
    var total = 0
    for byte in slice {
      guard isASCIIDigit(byte) else { return nil }
      total = total * 10 + Int(byte - UInt8(ascii: "0"))
    }
    return total
  }

  private static func daysInMonth(_ month: Int, year: Int) -> Int {
    switch month {
    case 1, 3, 5, 7, 8, 10, 12:
      return 31
    case 4, 6, 9, 11:
      return 30
    case 2:
      let isLeap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
      return isLeap ? 29 : 28
    default:
      return 0
    }
  }

  // MARK: - Helpers

  private static func jsonScalarEquals(_ lhs: JSONValue, _ rhs: JSONValue) -> Bool {
    if let lNum = lhs.doubleValue, let rNum = rhs.doubleValue {
      return lNum == rNum
    }
    return MetadataValidator.jsonEquals(lhs, rhs)
  }

  private static func joinPath(_ base: String, _ segment: String, separator: String) -> String {
    base.isEmpty ? segment : "\(base)\(separator)\(segment)"
  }

  private static func appendError(
    path: String,
    message: String,
    context: Context,
    into errors: inout [A2UIErrorDetail]
  ) {
    let formatted =
      path.isEmpty
      ? "\(context.messagePrefix): \(message)"
      : "\(context.messagePrefix) at '\(path)': \(message)"
    errors.append(A2UIErrorDetail(path: path, code: "invalid_value", message: formatted))
  }
}
