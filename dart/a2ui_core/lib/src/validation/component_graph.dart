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

import 'package:meta/meta.dart';

import '../core/catalog.dart';
import '../core/messages.dart';
import '../primitives/errors.dart';
import 'component_refs.dart';
import 'validation_config.dart';

/// The id every surface's component tree is rooted at unless a
/// `ValidationConfig.rootId` or `SurfaceModel.rootId` says otherwise.
const String _rootComponentId = 'root';

/// The deepest component chain a surface may declare.
@visibleForTesting
const int maxComponentDepth = 50;

/// The deepest chain of nested function calls a component property may hold.
@visibleForTesting
const int maxFunctionCallDepth = 5;

/// The most arguments a single function call may pass.
///
/// Checked when a payload is validated and again when a call is evaluated,
/// matching the other SDKs' `MAX_FUNCTION_CALL_ARGS`.
const int maxFunctionCallArgs = 1000;

/// The parent type that stands for the surface itself in `allowedParents`.
const String _surfaceParent = 'Surface';

/// One component type's composition constraints, from its catalog entry.
///
/// A null list allows any type.
typedef CompositionRule = ({
  List<String>? allowedParents,
  List<String>? allowedChildren,
});

/// The composition constraints [catalog] declares, keyed by component type.
///
/// Types declaring neither `allowedParents` nor `allowedChildren` are left
/// out.
Map<String, CompositionRule> extractCompositionRules(Catalog catalog) => {
      for (final MapEntry<String, ComponentApi> entry
          in catalog.components.entries)
        if (entry.value.allowedParents != null ||
            entry.value.allowedChildren != null)
          entry.key: (
            allowedParents: entry.value.allowedParents,
            allowedChildren: entry.value.allowedChildren,
          ),
    };

/// Converts a [ComponentReference.field], such as `children[2]` or
/// `groups[0].children[0]`, into a JSON Pointer relative to the component,
/// such as `/children/2`.
String referencePointer(String field) => [
      for (final String segment in field
          .replaceAllMapped(RegExp(r'\[(\d+)\]'), (m) => '.${m[1]}')
          .split('.'))
        if (segment.isNotEmpty)
          '/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}',
    ].join();

/// Checks every parent-child edge in [components] against [rules].
///
/// The component with id `root` has the surface as its implicit parent, which
/// `allowedParents` names `Surface`. An edge whose child is not in
/// [components] is skipped: its type is unknown, and a later payload is
/// checked when it arrives.
///
/// Error paths are JSON Pointers into [components], such as
/// `/components/0/children/1` for the offending reference or
/// `/components/0` for a root the surface may not hold.
///
/// Throws [A2uiValidationError] with code `UNALLOWED_PARENT` or
/// `UNALLOWED_CHILD`, carrying [surfaceId].
void checkCompositionConstraints(
  List<Map<String, Object?>> components,
  Map<String, ComponentRefFields> refFields,
  Map<String, CompositionRule> rules, {
  String? surfaceId,
}) {
  if (rules.isEmpty) return;
  final types = <String, String>{
    for (final component in components)
      if ((component['id'], component['component'])
          case (final String id, final String type))
        id: type,
  };
  String list(List<String> names) =>
      '[${names.map((name) => "'$name'").join(', ')}]';

  for (var index = 0; index < components.length; index++) {
    final Map<String, Object?> component = components[index];
    final Object? id = component['id'];
    final Object? type = component['component'];
    if (id is! String || type is! String) continue;

    final List<String>? rootParents = rules[type]?.allowedParents;
    if (id == _rootComponentId &&
        rootParents != null &&
        !rootParents.contains(_surfaceParent)) {
      throw A2uiValidationError(
        "Component '$id' ($type) cannot be placed under parent "
        "'$_surfaceParent' ($_surfaceParent). Allowed parents: "
        '${list(rootParents)}.',
        code: 'UNALLOWED_PARENT',
        path: '/components/$index',
        surfaceId: surfaceId,
      );
    }

    final List<String>? allowedChildren = rules[type]?.allowedChildren;
    for (final ComponentReference reference in _referencesOf(
      component,
      refFields,
    )) {
      final String? childType = types[reference.id];
      if (childType == null) continue;
      final path = '/components/$index${referencePointer(reference.field)}';
      if (allowedChildren != null && !allowedChildren.contains(childType)) {
        throw A2uiValidationError(
          "Container '$id' ($type) cannot contain child '${reference.id}' "
          '($childType). Allowed children: ${list(allowedChildren)}.',
          code: 'UNALLOWED_CHILD',
          path: path,
          surfaceId: surfaceId,
        );
      }
      final List<String>? allowedParents = rules[childType]?.allowedParents;
      if (allowedParents != null && !allowedParents.contains(type)) {
        throw A2uiValidationError(
          "Component '${reference.id}' ($childType) cannot be placed under "
          "parent '$id' ($type). Allowed parents: ${list(allowedParents)}.",
          code: 'UNALLOWED_PARENT',
          path: path,
          surfaceId: surfaceId,
        );
      }
    }
  }
}

/// Matches a JSON Pointer as A2UI writes data-model paths, allowing the
/// leading slash to be omitted.
final RegExp _pathPattern = RegExp(
  r'^(?:(?:\/(?:[^~\/]|~[01])*)*|(?:[^~\/]|~[01])+(?:\/(?:[^~\/]|~[01])*)*)$',
);

/// Rejects a batch of components that names the same id twice.
///
/// Throws [A2uiIntegrityError] for the first id that repeats.
void checkDuplicateComponentIds(Iterable<Map<String, Object?>> components) {
  final ids = <String>{};
  for (final component in components) {
    final Object? id = component['id'];
    if (id is! String) continue;
    if (!ids.add(id)) {
      throw A2uiIntegrityError(
        'Duplicate component ID: $id',
        componentIds: [id],
      );
    }
  }
}

/// Walks a surface's component graph for self-references, cycles and
/// over-deep chains, and returns the ids reachable from [rootId].
///
/// [ids] is every component on the surface and [referencesOf] the child
/// references each one holds. A reference to an id outside [ids] is skipped,
/// since dangling references are a separate check.
///
/// When [allowMissingRoot] is true every component is a starting point, and
/// the result holds every id. Otherwise the walk starts at [rootId], and the
/// components it does not reach are then walked on their own, so a cycle among
/// unreachable components is still found.
///
/// Throws [A2uiRecursionError] for a self-reference, a cycle, or a chain
/// deeper than [maxDepth], which defaults to [maxComponentDepth].
Set<String> detectComponentCycles(
  Set<String> ids,
  Iterable<ComponentReference> Function(String id) referencesOf, {
  required String rootId,
  bool allowMissingRoot = false,
  int? maxDepth,
}) {
  final int limit = maxDepth ?? maxComponentDepth;
  for (final id in ids) {
    for (final ComponentReference reference in referencesOf(id)) {
      if (reference.id == id) {
        throw A2uiRecursionError(
          "Self-reference detected: Component '$id' references itself in "
          "field '${reference.field}'",
          cycle: [id],
        );
      }
    }
  }

  final visited = <String>{};
  final onStack = <String>{};

  void visit(String id, int depth) {
    if (depth > limit) {
      throw A2uiRecursionError(
        'Global recursion limit exceeded: logical depth > $limit',
        cycle: onStack.toList(),
      );
    }
    visited.add(id);
    onStack.add(id);
    for (final ComponentReference reference in referencesOf(id)) {
      final String next = reference.id;
      if (!ids.contains(next)) continue;
      if (onStack.contains(next)) {
        throw A2uiRecursionError(
          "Circular reference detected involving component '$next'",
          cycle: [...onStack, next],
        );
      }
      if (!visited.contains(next)) visit(next, depth + 1);
    }
    onStack.remove(id);
  }

  final List<String> sorted = ids.toList()..sort();
  if (allowMissingRoot) {
    for (final id in sorted) {
      if (!visited.contains(id)) visit(id, 0);
    }
    return visited;
  }

  if (ids.contains(rootId)) visit(rootId, 0);
  final reachable = Set<String>.of(visited);
  for (final id in sorted) {
    if (!visited.contains(id)) visit(id, 0);
  }
  return reachable;
}

/// Checks a surface's component graph against [config].
///
/// In order: the root, unless [ValidationConfig.allowMissingRoot]; references
/// that resolve, unless [ValidationConfig.allowDanglingReferences];
/// self-references, cycles and depth, always; and components reachable from
/// the root, unless [ValidationConfig.allowOrphanComponents] or
/// [ValidationConfig.allowMissingRoot]. The root is [ValidationConfig.rootId],
/// or [defaultRootId] when that is null. An empty surface passes.
///
/// Throws [A2uiIntegrityError] for a missing root, a dangling reference or an
/// unreachable component, and [A2uiRecursionError] for a self-reference, a
/// cycle or an over-deep chain.
void checkComponentGraph(
  Set<String> ids,
  Iterable<ComponentReference> Function(String id) referencesOf,
  ValidationConfig config, {
  String defaultRootId = 'root',
}) {
  if (ids.isEmpty) return;
  final String rootId = config.rootId ?? defaultRootId;

  if (!config.allowMissingRoot && !ids.contains(rootId)) {
    throw A2uiIntegrityError(
      "Missing root component: No component has id='$rootId'",
    );
  }

  if (!config.allowDanglingReferences) {
    for (final String id in ids.toList()..sort()) {
      for (final ComponentReference reference in referencesOf(id)) {
        if (!ids.contains(reference.id)) {
          throw A2uiIntegrityError(
            "Component '$id' references non-existent component "
            "'${reference.id}' in field '${reference.field}'",
            componentIds: [id, reference.id],
          );
        }
      }
    }
  }

  final Set<String> reachable = detectComponentCycles(
    ids,
    referencesOf,
    rootId: rootId,
    allowMissingRoot: config.allowMissingRoot,
    maxDepth: config.maxDepth,
  );

  if (!config.allowOrphanComponents && !config.allowMissingRoot) {
    final List<String> orphans = ids.difference(reachable).toList()..sort();
    if (orphans.isNotEmpty) {
      throw A2uiIntegrityError(
        "Component '${orphans.first}' is not reachable from '$rootId'",
        componentIds: orphans,
      );
    }
  }
}

/// Whether [value] is a data-binding object in the v1.0 (`@path`) or legacy
/// (`path` without a `componentId` sibling) shape.
///
/// Mirrors `DataContext.isDataBinding`, which needs a context; this check
/// runs on a raw message before any surface or context exists.
bool _isDataBinding(Map<Object?, Object?> value, {required bool v1}) => v1
    ? value['@path'] is String
    : value['path'] is String && !value.containsKey('componentId');

/// Whether [value] is a function-call object in the v1.0 (`@call`) or legacy
/// (`call`) shape. See [_isDataBinding].
bool _isFunctionCall(Map<Object?, Object?> value, {required bool v1}) =>
    v1 ? value['@call'] is String : value['call'] is String;

/// Checks data-model paths and nesting depth anywhere inside a message body.
///
/// Throws [A2uiValidationError] for a malformed path and [A2uiRecursionError]
/// when nesting or chained function calls run past their caps.
void checkPathsAndRecursion(Object? data, {bool? v1}) {
  final bool isV1 = v1 ?? _inferV1(data);

  void traverse(
    Object? node,
    int depth,
    int callDepth, {
    required bool inDataValue,
  }) {
    if (depth > maxComponentDepth) {
      throw A2uiRecursionError(
        'Global recursion limit exceeded: Depth > $maxComponentDepth',
      );
    }

    if (node is List) {
      for (final Object? item in node) {
        traverse(item, depth + 1, callDepth, inDataValue: inDataValue);
      }
      return;
    }

    if (node is! Map) return;

    if (inDataValue) {
      for (final Object? value in node.values) {
        traverse(value, depth + 1, callDepth, inDataValue: true);
      }
      return;
    }

    final Map<Object?, Object?> object = node;

    final Object? udm = object['updateDataModel'];
    if (udm is Map && (object.length == 1 || object.containsKey('version'))) {
      final Object? udmPath = udm['path'];
      if (udmPath is String && !_pathPattern.hasMatch(udmPath)) {
        throw A2uiValidationError(
          "Invalid path syntax: '$udmPath'",
          details: udm,
        );
      }
      for (final MapEntry<Object?, Object?> entry in udm.entries) {
        traverse(
          entry.value,
          depth + 2,
          callDepth,
          inDataValue: entry.key == 'value',
        );
      }
      return;
    }

    final Object? path = _isDataBinding(object, v1: isV1)
        ? object[isV1 ? '@path' : 'path']
        : (object['path'] is String && object['componentId'] is String
            ? object['path']
            : null);
    if (path is String && !_pathPattern.hasMatch(path)) {
      throw A2uiValidationError(
        "Invalid path syntax: '$path'",
        details: object,
      );
    }

    if (_isFunctionCall(object, v1: isV1)) {
      if (callDepth >= maxFunctionCallDepth) {
        throw A2uiRecursionError(
          'Recursion limit exceeded: functionCall depth > '
          '$maxFunctionCallDepth',
        );
      }
      for (final MapEntry<Object?, Object?> entry in object.entries) {
        traverse(
          entry.value,
          depth + 1,
          entry.key == 'args' ? callDepth + 1 : callDepth,
          inDataValue: false,
        );
      }
      return;
    }

    for (final Object? value in object.values) {
      traverse(value, depth + 1, callDepth, inDataValue: false);
    }
  }

  if (data is UpdateDataModelMessage) {
    final String? udmPath = data.path;
    if (udmPath != null && !_pathPattern.hasMatch(udmPath)) {
      throw A2uiValidationError(
        "Invalid path syntax: '$udmPath'",
        details: data.toJson()['updateDataModel'],
      );
    }
    traverse(data.value, 2, 0, inDataValue: true);
    return;
  }

  if (data is AgentToRendererMessage) {
    traverse(data.toJson(), 0, 0, inDataValue: false);
    return;
  }

  traverse(data, 0, 0, inDataValue: false);
}

bool _inferV1(Object? data) {
  final Object? rawVersion = switch (data) {
    AgentToRendererMessage(:final version) => version,
    Map() => data['version'],
    _ => null,
  };
  if (rawVersion is! String) return false;
  final String core =
      rawVersion.startsWith('v') ? rawVersion.substring(1) : rawVersion;
  return (int.tryParse(core.split('.').first) ?? 0) >= 1;
}

Iterable<ComponentReference> _referencesOf(
  Map<String, Object?> component,
  Map<String, ComponentRefFields> refFields,
) {
  final Object? type = component['component'];
  if (type is! String) return const <ComponentReference>[];
  return componentReferences(component, refFields[type]);
}
