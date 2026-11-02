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

import 'types.dart';

/// One component that accepts an action or user input but declares no
/// text-bearing label property (or, when `strict` is true, no required one).
final class LabelLintFinding {
  const LabelLintFinding({required this.component, required this.reason});

  /// The name of the component in the catalog.
  final String component;

  /// Why the component is considered interactive: `'action'` or `'input'`.
  final String reason;

  @override
  bool operator ==(Object other) =>
      other is LabelLintFinding &&
      other.component == component &&
      other.reason == reason;

  @override
  int get hashCode => Object.hash(component, reason);

  @override
  String toString() =>
      'LabelLintFinding(component: $component, reason: $reason)';
}

/// Checks every interactive component of [catalog] for a declared text-bearing
/// label property.
///
/// A component is considered interactive when any declared property has type
/// [ActionType] (reason `'action'`) or when [AnalysedComponentApi.isCheckable]
/// is true (reason `'input'`).
///
/// By default, an interactive component passes when any declared property other
/// than `'value'` is a string [PrimitiveType], a [DynamicType] over a string,
/// a [ComponentRefType], or a [ListType] of [ObjectModelType] whose model
/// declares such a property. When [strict] is `true`, that text-bearing
/// property (and any nested item label property) must also be required.
///
/// Returns findings sorted deterministically by component name.
List<LabelLintFinding> lintAccessibilityLabels(
  AnalysedCatalog catalog, {
  bool strict = false,
}) {
  final findings = <LabelLintFinding>[];

  for (final AnalysedComponentApi component in catalog.components.values) {
    final String? reason = _interactivityReason(component);
    if (reason == null) continue;

    final bool hasLabel = component.properties.values.any((
      PropertyDescriptor prop,
    ) {
      if (prop.name == 'value') return false;
      if (strict &&
          !prop.isRequired &&
          !component.requiredProperties.contains(prop.name)) {
        return false;
      }
      return _isTextBearingType(prop.type, catalog, strict: strict);
    });

    if (!hasLabel) {
      findings.add(LabelLintFinding(component: component.name, reason: reason));
    }
  }

  findings.sort((a, b) => a.component.compareTo(b.component));
  return findings;
}

String? _interactivityReason(AnalysedComponentApi component) {
  if (component.properties.values.any((p) => p.type is ActionType)) {
    return 'action';
  }
  if (component.isCheckable) {
    return 'input';
  }
  return null;
}

bool _isTextBearingType(
  TypeDescriptor type,
  AnalysedCatalog catalog, {
  required bool strict,
  Set<String>? visitedModels,
}) {
  return switch (type) {
    PrimitiveType(primitive: PrimitiveKind.string) => true,
    DynamicType(inner: PrimitiveType(primitive: PrimitiveKind.string)) => true,
    ComponentRefType() => true,
    ListType(elementType: ObjectModelType(:final name)) =>
      _modelHasTextBearingProperty(
        name,
        catalog,
        strict: strict,
        visitedModels: visitedModels,
      ),
    _ => false,
  };
}

bool _modelHasTextBearingProperty(
  String modelName,
  AnalysedCatalog catalog, {
  required bool strict,
  Set<String>? visitedModels,
}) {
  if (visitedModels != null && visitedModels.contains(modelName)) {
    return false;
  }
  final AnalysedObjectModel? model = catalog.objectModels[modelName];
  if (model == null) return false;

  final nextVisited = <String>{...?visitedModels, modelName};
  return model.properties.values.any(
    (PropertyDescriptor prop) =>
        prop.name != 'value' &&
        (!strict || prop.isRequired) &&
        _isTextBearingType(
          prop.type,
          catalog,
          strict: strict,
          visitedModels: nextVisited,
        ),
  );
}
