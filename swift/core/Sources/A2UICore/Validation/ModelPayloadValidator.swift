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

/// Direct in-memory payload validator operating on canonical ``ComponentDefinition``,
/// ``FunctionDefinition``, ``SurfacePropertiesDefinition``, and ``TypeDefinition`` values.
///
/// Replaces runtime JSON Schema AST walking and dynamic `Schema` recompilation while keeping a
/// targeted `JSONSchema.Schema` escape hatch solely for legacy `.rawJSONSchema` fragments.
internal enum ModelPayloadValidator {
  private struct ValidationContext {
    let types: [String: TypeDefinition]
    let protocolVersion: A2UIProtocolVersion
    /// `ValidationConfig.allowUnknownElements` — NEVER polluted by component-level
    /// `allowsAdditionalProperties`.
    let allowUnknownElements: Bool
    let allowDynamicExpressions: Bool
    let allowNullValues: Bool
    let pathSeparator: String

    var isV10: Bool { protocolVersion.isAtLeastV10 }

    func childPath(_ base: String, key: String) -> String {
      base.isEmpty ? key : "\(base)\(pathSeparator)\(key)"
    }
  }

  // MARK: - Declarative Protocol Built-In TypeDefinitions

  private static let childListType: TypeDefinition = .union(
    variants: [
      .array(items: .child()),
      .object(
        properties: [
          .child("componentId", required: true),
          .string("path", required: true),
        ],
        additionalProperties: .disallowed
      ),
    ],
    exclusive: true
  )

  private static let v10ActionType: TypeDefinition = .union(
    variants: [
      .object(
        properties: [
          .object(
            "event",
            properties: [
              .string("name", required: true),
              .string("userMessage", dynamic: true),
              .object(
                "context", additionalProperties: .typed(.any(dynamic: true, nullable: false))),
            ],
            additionalProperties: .disallowed,
            required: true
          )
        ],
        additionalProperties: .disallowed
      ),
      .object(
        properties: [.functionCall("functionCall", required: true)],
        additionalProperties: .disallowed
      ),
    ],
    exclusive: true
  )

  private static let v09ActionType: TypeDefinition = .union(
    variants: [
      .object(
        properties: [
          .object(
            "event",
            properties: [
              .string("name", required: true),
              .object(
                "context", additionalProperties: .typed(.any(dynamic: true, nullable: false))),
            ],
            additionalProperties: .disallowed,
            required: true
          )
        ],
        additionalProperties: .disallowed
      ),
      .object(
        properties: [.functionCall("functionCall", required: true)],
        additionalProperties: .disallowed
      ),
    ],
    exclusive: true
  )

  private static let v10CheckRuleType: TypeDefinition = .object(
    properties: [
      .union(
        "condition",
        variants: [.dataBinding(), .functionCall()],
        exclusive: true,
        required: true
      ),
      .string("message"),
    ],
    additionalProperties: .disallowed
  )

  private static let v09CheckRuleType: TypeDefinition = .object(
    properties: [
      .boolean("condition", dynamic: true, required: true),
      .string("message", required: true),
    ],
    additionalProperties: .disallowed
  )

  private static let v10AccessibilityType: TypeDefinition = .object(
    properties: [
      .string("label", dynamic: true),
      .string("description", dynamic: true),
      .enum("live", values: [.string("off"), .string("polite"), .string("assertive")]),
      .boolean("hidden", dynamic: true),
    ],
    additionalProperties: .disallowed
  )

  private static let v09AccessibilityType: TypeDefinition = .object(
    properties: [
      .string("label", dynamic: true),
      .string("description", dynamic: true),
    ],
    additionalProperties: .allowed
  )

  // MARK: - Component Validation

  /// Validates a component's own properties (excluding protocol envelope/mixin keys) against its
  /// canonical ``ComponentDefinition``.
  internal static func validateComponentProperties(
    _ properties: [String: JSONValue],
    definition: ComponentDefinition,
    types: [String: TypeDefinition],
    protocolVersion: A2UIProtocolVersion,
    allowUnknownElements: Bool
  ) -> [A2UIErrorDetail] {
    let context = ValidationContext(
      types: types,
      protocolVersion: protocolVersion,
      allowUnknownElements: allowUnknownElements,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: "."
    )
    var errors: [A2UIErrorDetail] = []
    let ordered = OrderedDictionary(
      uniqueKeysWithValues: properties.keys.sorted().compactMap { k in
        properties[k].map { (k, $0) }
      }
    )
    validateObjectMembers(
      ordered,
      properties: definition.parameters,
      additionalProperties: definition.allowsAdditionalProperties ? .allowed : .disallowed,
      atLeastOneOf: definition.atLeastOneOf,
      allowUnknownHere: allowUnknownElements,
      subjectPrefix: "Validation failed for component '\(definition.name)': ",
      path: "",
      context: context,
      into: &errors
    )
    return errors
  }

  /// Validates a component's `@accessibility` / `accessibility` mixin value.
  internal static func validateAccessibility(
    _ value: JSONValue,
    key: String,
    protocolVersion: A2UIProtocolVersion,
    allowUnknownElements: Bool
  ) -> [A2UIErrorDetail] {
    let context = ValidationContext(
      types: [:],
      protocolVersion: protocolVersion,
      allowUnknownElements: allowUnknownElements,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: "/"
    )
    var errors: [A2UIErrorDetail] = []
    validateType(
      value,
      type: protocolVersion.isAtLeastV10 ? v10AccessibilityType : v09AccessibilityType,
      path: key,
      context: context,
      visitedRefs: [],
      into: &errors
    )
    return errors
  }

  /// Validates a component's `@checks` / `checks` mixin array against `CheckRule`.
  internal static func validateChecks(
    _ value: JSONValue,
    componentType: String,
    key: String,
    protocolVersion: A2UIProtocolVersion,
    allowUnknownElements: Bool
  ) -> [A2UIErrorDetail] {
    let context = ValidationContext(
      types: [:],
      protocolVersion: protocolVersion,
      allowUnknownElements: allowUnknownElements,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: "."
    )
    var errors: [A2UIErrorDetail] = []
    guard case .array(let items) = value else {
      return [
        A2UIErrorDetail(
          path: key,
          code: "type_mismatch",
          message: "Validation failed for component '\(componentType)': '\(key)' must be an array"
        )
      ]
    }
    let ruleType = protocolVersion.isAtLeastV10 ? v10CheckRuleType : v09CheckRuleType
    for (index, item) in items.enumerated() {
      validateType(
        item,
        type: ruleType,
        path: "\(key)[\(index)]",
        context: context,
        visitedRefs: [],
        into: &errors
      )
    }
    return errors
  }

  // MARK: - Function Argument Validation

  /// Validates a function's argument dictionary against its canonical ``FunctionDefinition``.
  internal static func validateFunctionArguments(
    _ arguments: [String: JSONValue],
    definition: FunctionDefinition,
    types: [String: TypeDefinition],
    protocolVersion: A2UIProtocolVersion,
    allowDynamicExpressions: Bool,
    allowNullValues: Bool
  ) -> [A2UIErrorDetail] {
    let basePath = "functions.\(definition.name)"
    let ordered = OrderedDictionary(
      uniqueKeysWithValues: arguments.keys.sorted().compactMap { k in
        arguments[k].map { (k, $0) }
      }
    )
    if let rawRoot = definition.rawJSONSchema {
      return validateRawSchema(
        .object(ordered),
        rawSchema: rawRoot,
        path: basePath,
        allowDynamicExpressions: allowDynamicExpressions,
        allowNullValues: allowNullValues,
        isV10: protocolVersion.isAtLeastV10
      )
    }
    let context = ValidationContext(
      types: types,
      protocolVersion: protocolVersion,
      allowUnknownElements: false,
      allowDynamicExpressions: allowDynamicExpressions,
      allowNullValues: allowNullValues,
      pathSeparator: "."
    )
    var errors: [A2UIErrorDetail] = []
    validateObjectMembers(
      ordered,
      properties: definition.parameters,
      additionalProperties: definition.additionalParameters,
      atLeastOneOf: definition.atLeastOneOf,
      allowUnknownHere: false,
      subjectPrefix: "Validation failed for function '\(definition.name)': ",
      path: basePath,
      context: context,
      into: &errors
    )
    return errors
  }

  // MARK: - Surface Properties / Theme Validation

  /// Validates a surface theme object against a canonical ``SurfacePropertiesDefinition``.
  internal static func validateSurfaceProperties(
    _ theme: OrderedDictionary<String, JSONValue>,
    definition: SurfacePropertiesDefinition,
    types: [String: TypeDefinition],
    protocolVersion: A2UIProtocolVersion
  ) -> [A2UIErrorDetail] {
    if let rawRoot = definition.rawJSONSchema {
      return validateRawSchema(
        .object(theme),
        rawSchema: rawRoot,
        path: "theme",
        allowDynamicExpressions: false,
        allowNullValues: false,
        isV10: protocolVersion.isAtLeastV10
      )
    }
    let context = ValidationContext(
      types: types,
      protocolVersion: protocolVersion,
      allowUnknownElements: false,
      allowDynamicExpressions: false,
      allowNullValues: false,
      pathSeparator: "."
    )
    var errors: [A2UIErrorDetail] = []
    validateObjectMembers(
      theme,
      properties: definition.properties,
      additionalProperties: definition.additionalProperties,
      atLeastOneOf: [],
      allowUnknownHere: false,
      subjectPrefix: "",
      path: "theme",
      context: context,
      into: &errors
    )
    return errors
  }

  // MARK: - DataContext Coercion & Defaults Helpers

  /// Coerces `ValidationResult` objects into booleans wherever a function parameter expects a
  /// boolean (including nested arrays and objects).
  internal static func coerceValidationResults(
    in arguments: [String: JSONValue],
    definition: FunctionDefinition,
    types: [String: TypeDefinition]
  ) -> [String: JSONValue] {
    guard !arguments.isEmpty else { return arguments }
    var result = arguments
    let paramByName = Dictionary(
      definition.parameters.map { ($0.name, $0.type) },
      uniquingKeysWith: { _, last in last }
    )
    for (key, value) in arguments {
      if let paramType = paramByName[key] {
        result[key] = coerceValue(value, for: paramType, types: types, visitedRefs: [])
      } else if let extraType = definition.additionalParameters.typedSchema {
        result[key] = coerceValue(value, for: extraType, types: types, visitedRefs: [])
      }
    }
    return result
  }

  private static func coerceValue(
    _ value: JSONValue,
    for type: TypeDefinition,
    types: [String: TypeDefinition],
    visitedRefs: Set<String>
  ) -> JSONValue {
    if isBooleanExpectingType(type, types: types, visitedRefs: visitedRefs) {
      return .boolean(value.coercedDynamicBoolean)
    }
    switch type.kind {
    case .array(_, let items, _, _, _, _):
      guard let items, case .array(let elements) = value else { return value }
      return .array(elements.map { coerceValue($0, for: items, types: types, visitedRefs: []) })
    case .object(_, let props, let additional, _, _):
      guard case .object(var dict) = value else { return value }
      let propMap = Dictionary(
        props.map { ($0.name, $0.type) },
        uniquingKeysWith: { _, last in last }
      )
      for (k, v) in dict {
        if let propType = propMap[k] {
          dict[k] = coerceValue(v, for: propType, types: types, visitedRefs: [])
        } else if let extraType = additional.typedSchema {
          dict[k] = coerceValue(v, for: extraType, types: types, visitedRefs: [])
        }
      }
      return .object(dict)
    case .ref(let refName, _):
      guard !visitedRefs.contains(refName), let target = types[refName] else { return value }
      var next = visitedRefs
      next.insert(refName)
      return coerceValue(value, for: target, types: types, visitedRefs: next)
    default:
      return value
    }
  }

  private static func isBooleanExpectingType(
    _ type: TypeDefinition,
    types: [String: TypeDefinition],
    visitedRefs: Set<String>
  ) -> Bool {
    switch type.kind {
    case .boolean:
      return true
    case .union(let variants, _, _, _):
      let hasBool = variants.contains {
        isBooleanExpectingType($0, types: types, visitedRefs: visitedRefs)
      }
      let onlyBoolOrExpr = variants.allSatisfy { variant in
        if isBooleanExpectingType(variant, types: types, visitedRefs: visitedRefs) { return true }
        switch variant.kind {
        case .dataBinding, .functionCall: return true
        default: return false
        }
      }
      return hasBool && onlyBoolOrExpr
    case .ref(let refName, _):
      guard !visitedRefs.contains(refName), let target = types[refName] else { return false }
      var next = visitedRefs
      next.insert(refName)
      return isBooleanExpectingType(target, types: types, visitedRefs: next)
    case .rawJSONSchema(let raw):
      return raw["type"]?.stringValue == "boolean"
        || raw["$ref"]?.stringValue?.hasSuffix("/$defs/DynamicBoolean") == true
    default:
      return false
    }
  }

  /// Applies default values declared on a ``FunctionDefinition``'s parameters (and nested objects).
  internal static func applyingArgumentDefaults(
    of definition: FunctionDefinition,
    types: [String: TypeDefinition],
    to arguments: [String: JSONValue]
  ) -> [String: JSONValue] {
    var result = arguments
    for param in definition.parameters {
      if let existing = result[param.name] {
        result[param.name] = applyingTypeDefaults(
          of: param.type,
          types: types,
          to: existing,
          visitedRefs: []
        )
      } else if let defaultValue = resolvedDefaultValue(
        of: param.type,
        types: types,
        visitedRefs: []
      ) {
        result[param.name] = defaultValue
      }
    }
    return result
  }

  private static func resolvedDefaultValue(
    of type: TypeDefinition,
    types: [String: TypeDefinition],
    visitedRefs: Set<String>
  ) -> JSONValue? {
    if let direct = type.defaultJSONValue { return direct }
    if case .ref(let refName, _) = type.kind, !visitedRefs.contains(refName),
      let target = types[refName]
    {
      var next = visitedRefs
      next.insert(refName)
      return resolvedDefaultValue(of: target, types: types, visitedRefs: next)
    }
    return nil
  }

  private static func applyingTypeDefaults(
    of type: TypeDefinition,
    types: [String: TypeDefinition],
    to value: JSONValue,
    visitedRefs: Set<String>
  ) -> JSONValue {
    switch type.kind {
    case .object(_, let props, _, _, _):
      guard case .object(var dict) = value, !props.isEmpty else { return value }
      for param in props {
        if let existing = dict[param.name] {
          dict[param.name] = applyingTypeDefaults(
            of: param.type,
            types: types,
            to: existing,
            visitedRefs: []
          )
        } else if let defaultValue = resolvedDefaultValue(
          of: param.type,
          types: types,
          visitedRefs: []
        ) {
          dict[param.name] = defaultValue
        }
      }
      return .object(dict)
    case .ref(let refName, _):
      guard !visitedRefs.contains(refName), let target = types[refName] else { return value }
      var next = visitedRefs
      next.insert(refName)
      return applyingTypeDefaults(of: target, types: types, to: value, visitedRefs: next)
    default:
      return value
    }
  }

  // MARK: - Unified Object & Type Validation

  private static func validateObjectMembers(
    _ dict: OrderedDictionary<String, JSONValue>,
    properties: [ParameterDefinition],
    additionalProperties: AdditionalProperties,
    atLeastOneOf: [[String]],
    allowUnknownHere: Bool,
    subjectPrefix: String,
    path: String,
    context: ValidationContext,
    into errors: inout [A2UIErrorDetail]
  ) {
    let propMap = Dictionary(
      properties.map { ($0.name, $0) },
      uniquingKeysWith: { _, last in last }
    )

    for param in properties where param.required && dict[param.name] == nil {
      let fieldPath = context.childPath(path, key: param.name)
      errors.append(
        A2UIErrorDetail(
          path: fieldPath,
          code: "missing_field",
          message: "\(subjectPrefix)missing required property '\(param.name)'"
        )
      )
    }

    for group in atLeastOneOf where !group.contains(where: { dict[$0] != nil }) {
      let names = group.joined(separator: ", ")
      errors.append(
        A2UIErrorDetail(
          path: path,
          code: "missing_field",
          message: "\(subjectPrefix)at least one of [\(names)] must be provided"
        )
      )
    }

    for (key, value) in dict {
      let fieldPath = context.childPath(path, key: key)
      if let param = propMap[key] {
        // Descending into a strict JSON sub-value resets `visitedRefs`.
        validateType(
          value,
          type: param.type,
          path: fieldPath,
          context: context,
          visitedRefs: [],
          into: &errors
        )
      } else {
        switch additionalProperties {
        case .allowed:
          break
        case .disallowed:
          if !allowUnknownHere {
            errors.append(
              A2UIErrorDetail(
                path: fieldPath,
                code: "invalid_value",
                message: "\(subjectPrefix)unexpected property '\(key)'"
              )
            )
          }
        case .typed(let extraType):
          validateType(
            value,
            type: extraType,
            path: fieldPath,
            context: context,
            visitedRefs: [],
            into: &errors
          )
        }
      }
    }
  }

  private static func validateType(
    _ value: JSONValue,
    type: TypeDefinition,
    path: String,
    context: ValidationContext,
    visitedRefs: Set<String>,
    into errors: inout [A2UIErrorDetail]
  ) {
    if context.allowNullValues && value == .null { return }

    switch type.kind {
    case .string(let dynamic, let formats, let pattern, let minL, let maxL, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "string")
      {
        return
      }
      guard case .string(let str) = value else {
        errors.append(typeError(path, expected: "a string"))
        return
      }
      let length = str.unicodeScalars.count
      if let minL, length < minL {
        errors.append(valueError(path, "must be at least \(minL) character(s) long"))
      }
      if let maxL, length > maxL {
        errors.append(valueError(path, "must be at most \(maxL) character(s) long"))
      }
      if let pattern, !matchesRegex(str, pattern: pattern) {
        errors.append(valueError(path, "does not match pattern '\(pattern)'"))
      }
      if let formats, !formats.isEmpty, !formats.contains(where: { matchesFormat(str, format: $0) })
      {
        errors.append(
          valueError(path, "does not match required format (\(formats.joined(separator: " | ")))")
        )
      }

    case .number(let dynamic, let minV, let maxV, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "number")
      {
        return
      }
      guard let num = value.doubleValue, num.isFinite else {
        errors.append(typeError(path, expected: "a finite number"))
        return
      }
      if let minV, num < minV {
        errors.append(valueError(path, "must be >= \(minV)"))
      }
      if let maxV, num > maxV {
        errors.append(valueError(path, "must be <= \(maxV)"))
      }

    case .integer(let dynamic, let minV, let maxV, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "number")
      {
        return
      }
      guard let intVal = value.intValue else {
        errors.append(typeError(path, expected: "an integer"))
        return
      }
      if let minV, intVal < minV {
        errors.append(valueError(path, "must be >= \(minV)"))
      }
      if let maxV, intVal > maxV {
        errors.append(valueError(path, "must be <= \(maxV)"))
      }

    case .boolean(let dynamic, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "boolean")
      {
        return
      }
      guard case .boolean = value else {
        errors.append(typeError(path, expected: "a boolean"))
        return
      }

    case .enum(let values, let valueType, let dynamic, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: valueType.rawValue)
      {
        return
      }
      guard values.contains(where: { CatalogDocumentCodec.jsonScalarEquals($0, value) }) else {
        errors.append(valueError(path, "must be one of the allowed enum values"))
        return
      }

    case .const(let expected):
      if context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: nil)
      {
        return
      }
      guard CatalogDocumentCodec.jsonScalarEquals(value, expected) else {
        errors.append(valueError(path, "must equal constant value"))
        return
      }

    case .any(let dynamic, let nullable, _):
      if value == .null {
        if !nullable { errors.append(valueError(path, "cannot be null")) }
        return
      }
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: nil)
      {
        return
      }
      if dynamic && !nullable, case .object(let dict) = value {
        if !context.isV10 {
          // v0.9 DynamicValue forbids plain objects (only DataBinding / FunctionCall allowed).
          errors.append(typeError(path, expected: "a valid v0.9 DynamicValue"))
          return
        }
        // v1.0 DynamicValue forbids single-`@` reserved keys (escaped `@@` is permitted).
        for key in dict.keys where key.hasPrefix("@") && !key.hasPrefix("@@") {
          errors.append(
            valueError(path, "plain DynamicValue object cannot contain reserved key '\(key)'"))
          return
        }
      }

    case .object(let dynamic, let properties, let additional, let atLeastOneOf, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "object")
      {
        return
      }
      guard case .object(let dict) = value else {
        errors.append(typeError(path, expected: "an object"))
        return
      }
      validateObjectMembers(
        dict,
        properties: properties,
        additionalProperties: additional,
        atLeastOneOf: atLeastOneOf,
        allowUnknownHere: context.allowUnknownElements,
        subjectPrefix: "",
        path: path,
        context: context,
        into: &errors
      )

    case .array(let dynamic, let items, let minI, let maxI, let unique, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: "array")
      {
        return
      }
      guard case .array(let array) = value else {
        errors.append(typeError(path, expected: "an array"))
        return
      }
      if let minI, array.count < minI {
        errors.append(valueError(path, "must contain at least \(minI) item(s)"))
      }
      if let maxI, array.count > maxI {
        errors.append(valueError(path, "must contain at most \(maxI) item(s)"))
      }
      if unique {
        var seen: [JSONValue] = []
        for (idx, item) in array.enumerated() {
          if seen.contains(where: { CatalogDocumentCodec.jsonScalarEquals($0, item) }) {
            errors.append(valueError("\(path)[\(idx)]", "contains duplicate array item"))
            break
          }
          seen.append(item)
        }
      }
      if let items {
        for (idx, item) in array.enumerated() {
          // Descending into a strict JSON sub-value resets `visitedRefs`.
          validateType(
            item,
            type: items,
            path: "\(path)[\(idx)]",
            context: context,
            visitedRefs: [],
            into: &errors
          )
        }
      }

    case .union(let variants, let exclusive, let dynamic, _):
      if dynamic || context.allowDynamicExpressions,
        isDynamicValueExpression(value, isV10: context.isV10, v09ReturnType: nil)
      {
        return
      }
      var matchCount = 0
      for variant in variants {
        var candidateErrors: [A2UIErrorDetail] = []
        validateType(
          value,
          type: variant,
          path: path,
          context: context,
          visitedRefs: visitedRefs,
          into: &candidateErrors
        )
        if candidateErrors.isEmpty {
          matchCount += 1
          if !exclusive { return }
        }
      }
      if matchCount == 0 {
        errors.append(valueError(path, "does not match any allowed union variant"))
      } else if exclusive && matchCount > 1 {
        errors.append(valueError(path, "matched multiple exclusive union variants"))
      }

    case .dataBinding:
      guard isDataBinding(value, isV10: context.isV10) else {
        errors.append(typeError(path, expected: "a DataBinding object"))
        return
      }

    case .functionCall:
      guard isFunctionCall(value, isV10: context.isV10, v09ReturnType: nil) else {
        errors.append(typeError(path, expected: "a FunctionCall object"))
        return
      }

    case .ref(let refName, _):
      // Fail closed on same-value alias cycles and unresolved refs so `.union` never
      // false-matches.
      guard !visitedRefs.contains(refName) else {
        errors.append(valueError(path, "cyclic local type reference '\(refName)'"))
        return
      }
      guard let target = context.types[refName] else {
        errors.append(valueError(path, "unresolved local type reference '\(refName)'"))
        return
      }
      var nextVisited = visitedRefs
      nextVisited.insert(refName)
      validateType(
        value,
        type: target,
        path: path,
        context: context,
        visitedRefs: nextVisited,
        into: &errors
      )

    case .child:
      guard case .string = value else {
        errors.append(typeError(path, expected: "a child component ID string"))
        return
      }

    case .childList:
      validateType(
        value,
        type: childListType,
        path: path,
        context: context,
        visitedRefs: [],
        into: &errors
      )

    case .action:
      validateType(
        value,
        type: context.isV10 ? v10ActionType : v09ActionType,
        path: path,
        context: context,
        visitedRefs: [],
        into: &errors
      )

    case .checkRule:
      validateType(
        value,
        type: context.isV10 ? v10CheckRuleType : v09CheckRuleType,
        path: path,
        context: context,
        visitedRefs: [],
        into: &errors
      )

    case .accessibility:
      validateType(
        value,
        type: context.isV10 ? v10AccessibilityType : v09AccessibilityType,
        path: path,
        context: context,
        visitedRefs: [],
        into: &errors
      )

    case .rawJSONSchema(let raw):
      errors.append(
        contentsOf: validateRawSchema(
          value,
          rawSchema: raw,
          path: path,
          allowDynamicExpressions: context.allowDynamicExpressions,
          allowNullValues: context.allowNullValues,
          isV10: context.isV10
        )
      )
    }
  }

  // MARK: - Targeted Raw JSON Schema Escape Hatch

  private static func validateRawSchema(
    _ value: JSONValue,
    rawSchema: JSONValue,
    path: String,
    allowDynamicExpressions: Bool,
    allowNullValues: Bool,
    isV10: Bool
  ) -> [A2UIErrorDetail] {
    if allowDynamicExpressions && isDynamicValueExpression(value, isV10: isV10, v09ReturnType: nil)
    {
      return []
    }
    var effectiveRaw = rawSchema
    if allowNullValues && containsNull(value) {
      effectiveRaw = acceptingNull(in: effectiveRaw)
    }
    if allowDynamicExpressions, case .object(let dict) = value,
      containsDynamicExpression(in: value, isV10: isV10),
      var rawObj = effectiveRaw.objectValue,
      var props = rawObj["properties"]?.objectValue
    {
      for (key, argValue) in dict where props[key] != nil {
        if isDynamicValueExpression(argValue, isV10: isV10, v09ReturnType: nil) {
          props[key] = .object([:])
        } else if case .array(let elems) = argValue,
          elems.contains(where: { isDynamicValueExpression($0, isV10: isV10, v09ReturnType: nil) }),
          var propObj = props[key]?.objectValue, let itemSchema = propObj["items"]
        {
          propObj["prefixItems"] = .array(
            elems.map {
              isDynamicValueExpression($0, isV10: isV10, v09ReturnType: nil)
                ? .object([:])
                : itemSchema
            }
          )
          propObj["items"] = .object([:])
          props[key] = .object(propObj)
        }
      }
      rawObj["properties"] = .object(props)
      effectiveRaw = .object(rawObj)
    }
    // Fail closed if raw JSON Schema fails to compile.
    guard
      let compiled = try? Schema(
        rawSchema: effectiveRaw,
        context: A2UISchemaRegistry.makeContext()
      )
    else {
      return [valueError(path, "failed to compile raw JSON Schema fragment")]
    }
    let result = compiled.validate(value)
    guard !result.isValid else { return [] }
    return [valueError(path, result.errors?.first?.message ?? "does not match schema")]
  }

  private static func containsNull(_ value: JSONValue) -> Bool {
    switch value {
    case .null: return true
    case .array(let items): return items.contains(where: containsNull)
    case .object(let dict): return dict.values.contains(where: containsNull)
    default: return false
    }
  }

  private static func containsDynamicExpression(in value: JSONValue, isV10: Bool) -> Bool {
    if isDynamicValueExpression(value, isV10: isV10, v09ReturnType: nil) { return true }
    switch value {
    case .object(let dict):
      return dict.values.contains(where: { containsDynamicExpression(in: $0, isV10: isV10) })
    case .array(let items):
      return items.contains(where: { containsDynamicExpression(in: $0, isV10: isV10) })
    default:
      return false
    }
  }

  private static func acceptingNull(in schema: JSONValue) -> JSONValue {
    guard case .object(var members) = schema else { return schema }
    if let items = members["items"] { members["items"] = acceptingNull(in: items) }
    if case .object(var props) = members["properties"] {
      for (name, propSchema) in props { props[name] = acceptingNull(in: propSchema) }
      members["properties"] = .object(props)
    }
    if members["enum"] == nil && members["const"] == nil {
      switch members["type"] {
      case .string(let name) where name != "null":
        members["type"] = .array([.string(name), .string("null")])
        return .object(members)
      case .array(var types) where !types.contains(.string("null")):
        types.append(.string("null"))
        members["type"] = .array(types)
        return .object(members)
      case .string, .array:
        return .object(members)
      default:
        break
      }
    }
    return .object(["anyOf": .array([.object(members), .object(["type": .string("null")])])])
  }

  // MARK: - Dynamic Expression & Format Helpers

  private static func isDynamicValueExpression(
    _ value: JSONValue,
    isV10: Bool,
    v09ReturnType: String?
  ) -> Bool {
    isDataBinding(value, isV10: isV10)
      || isFunctionCall(value, isV10: isV10, v09ReturnType: v09ReturnType)
  }

  private static func isDataBinding(_ value: JSONValue, isV10: Bool) -> Bool {
    guard case .object(let dict) = value, dict.count == 1 else { return false }
    if isV10 { return dict["@path"]?.stringValue != nil }
    return dict["path"]?.stringValue != nil
  }

  private static func isFunctionCall(
    _ value: JSONValue,
    isV10: Bool,
    v09ReturnType: String?
  ) -> Bool {
    guard case .object(let dict) = value else { return false }
    if isV10 {
      guard let callName = dict["@call"]?.stringValue, !callName.isEmpty else { return false }
      let allowedKeys: Set<String> = ["@call", "args", "catalogId"]
      guard dict.keys.allSatisfy({ allowedKeys.contains($0) }) else { return false }
      if let args = dict["args"], args.objectValue == nil { return false }
      if let cat = dict["catalogId"], cat.stringValue == nil { return false }
      return true
    }
    guard let callName = dict["call"]?.stringValue, !callName.isEmpty else { return false }
    let allowedKeys: Set<String> = ["call", "args", "returnType"]
    guard dict.keys.allSatisfy({ allowedKeys.contains($0) }) else { return false }
    if let args = dict["args"], args.objectValue == nil { return false }
    if let rt = dict["returnType"] {
      guard let rtStr = rt.stringValue else { return false }
      if let expected = v09ReturnType, rtStr != expected && rtStr != "any" { return false }
    }
    return true
  }

  private static func matchesRegex(_ value: String, pattern: String) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.firstMatch(in: value, options: [], range: range) != nil
  }

  private static func matchesFormat(_ value: String, format: String) -> Bool {
    switch format {
    case "date": return isValidRFC3339Date(value)
    case "time": return isValidRFC3339Time(value, requireTimezone: false)
    case "date-time": return isValidRFC3339DateTime(value)
    case "uri": return isValidURI(value)
    case "email": return isValidEmail(value)
    default: return true
    }
  }

  private static func isValidRFC3339Date(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard bytes.count == 10, bytes[4] == 45, bytes[7] == 45 else { return false }
    guard
      let year = parseDigits(bytes, start: 0, count: 4),
      let month = parseDigits(bytes, start: 5, count: 2),
      let day = parseDigits(bytes, start: 8, count: 2),
      (1...12).contains(month)
    else { return false }
    let isLeap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
    let daysInMonth = [0, 31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return (1...daysInMonth[month]).contains(day)
  }

  private static func isValidRFC3339Time(_ value: String, requireTimezone: Bool) -> Bool {
    let bytes = Array(value.utf8)
    guard bytes.count >= 8, bytes[2] == 58, bytes[5] == 58 else { return false }
    guard
      let hour = parseDigits(bytes, start: 0, count: 2),
      let minute = parseDigits(bytes, start: 3, count: 2),
      let second = parseDigits(bytes, start: 6, count: 2),
      (0...23).contains(hour),
      (0...59).contains(minute),
      (0...60).contains(second)
    else { return false }

    var idx = 8
    if idx < bytes.count && bytes[idx] == 46 {
      idx += 1
      let fracStart = idx
      while idx < bytes.count && (48...57).contains(bytes[idx]) { idx += 1 }
      guard idx > fracStart else { return false }
    }

    var offsetMinutes: Int?
    if idx == bytes.count {
      if requireTimezone { return false }
    } else if bytes[idx] == 90 || bytes[idx] == 122 {
      guard idx + 1 == bytes.count else { return false }
      offsetMinutes = 0
    } else if bytes[idx] == 43 || bytes[idx] == 45 {
      guard idx + 6 == bytes.count, bytes[idx + 3] == 58 else { return false }
      guard
        let tzH = parseDigits(bytes, start: idx + 1, count: 2),
        let tzM = parseDigits(bytes, start: idx + 4, count: 2),
        (0...23).contains(tzH), (0...59).contains(tzM)
      else { return false }
      let sign = bytes[idx] == 43 ? 1 : -1
      offsetMinutes = sign * (tzH * 60 + tzM)
    } else {
      return false
    }

    // Leap second (60) is only valid at 23:59 UTC.
    if second == 60 {
      let utcMinutes = ((hour * 60 + minute - (offsetMinutes ?? 0)) % 1440 + 1440) % 1440
      guard utcMinutes == 23 * 60 + 59 else { return false }
    }
    return true
  }

  private static func isValidRFC3339DateTime(_ value: String) -> Bool {
    guard value.count >= 20 else { return false }
    let sepIdx = value.index(value.startIndex, offsetBy: 10)
    let sep = value[sepIdx]
    guard sep == "T" || sep == "t" else { return false }
    let datePart = String(value[..<sepIdx])
    let timePart = String(value[value.index(after: sepIdx)...])
    return isValidRFC3339Date(datePart) && isValidRFC3339Time(timePart, requireTimezone: true)
  }

  private static func isValidURI(_ value: String) -> Bool {
    guard !value.isEmpty,
      !value.contains(where: { $0.isWhitespace || $0.isNewline }),
      let colon = value.firstIndex(of: ":")
    else { return false }
    let scheme = value[..<colon]
    guard let first = scheme.first, first.isASCII && first.isLetter else { return false }
    guard
      scheme.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || "+-.".contains($0)) })
    else { return false }
    return URL(string: value) != nil
  }

  private static func isValidEmail(_ value: String) -> Bool {
    let parts = value.split(separator: "@", omittingEmptySubsequences: false)
    guard parts.count == 2 else { return false }
    let local = parts[0]
    let domain = parts[1]
    guard !local.isEmpty, !domain.isEmpty,
      !local.hasPrefix("."), !local.hasSuffix("."), !local.contains(".."),
      !local.contains(where: { $0.isWhitespace || $0.isNewline }),
      !domain.contains(where: { $0.isWhitespace || $0.isNewline })
    else { return false }
    let labels = domain.split(separator: ".", omittingEmptySubsequences: false)
    guard labels.count >= 2 else { return false }
    return labels.allSatisfy { label in
      !label.isEmpty && !label.hasPrefix("-") && !label.hasSuffix("-")
        && label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
    }
  }

  private static func parseDigits(_ bytes: [UInt8], start: Int, count: Int) -> Int? {
    var result = 0
    for i in start..<(start + count) {
      let b = bytes[i]
      guard b >= 48 && b <= 57 else { return nil }
      result = result * 10 + Int(b - 48)
    }
    return result
  }

  private static func typeError(_ path: String, expected: String) -> A2UIErrorDetail {
    A2UIErrorDetail(
      path: path,
      code: "type_mismatch",
      message: path.isEmpty ? "Expected \(expected)" : "\(path): expected \(expected)"
    )
  }

  private static func valueError(_ path: String, _ detail: String) -> A2UIErrorDetail {
    A2UIErrorDetail(
      path: path,
      code: "invalid_value",
      message: path.isEmpty ? detail : "\(path): \(detail)"
    )
  }
}
