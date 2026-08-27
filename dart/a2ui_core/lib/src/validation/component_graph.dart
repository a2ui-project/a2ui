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

import '../primitives/errors.dart';
import 'component_refs.dart';

/// The id every surface's component tree is rooted at in v0.9.
const String rootComponentId = 'root';

/// The deepest component chain a surface may declare.
const int maxComponentDepth = 50;

/// The deepest chain of nested function calls a component property may hold.
const int maxFunctionCallDepth = 5;

/// Matches a JSON Pointer as A2UI writes data-model paths, allowing the
/// leading slash to be omitted.
final RegExp _pathPattern = RegExp(
  r'^(?:(?:\/(?:[^~\/]|~[01])*)*|(?:[^~\/]|~[01])+(?:\/(?:[^~\/]|~[01])*)*)$',
);

/// Checks component ids and references within one surface.
///
/// [requireRoot] and [allowDangling] distinguish a full render, which must
/// declare every component it names, from an incremental update, which may
/// reference components the client already holds.
///
/// Throws [A2uiIntegrityError] for duplicate ids, a missing root, or a
/// reference to a component that does not exist.
void checkComponentIntegrity(
  List<Map<String, Object?>> components,
  Map<String, ComponentRefFields> refFields, {
  required bool requireRoot,
  required bool allowDangling,
}) {
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

  if (allowDangling) return;

  if (requireRoot && !ids.contains(rootComponentId)) {
    throw A2uiIntegrityError(
      "Missing root component: No component has id='$rootComponentId'",
    );
  }

  for (final component in components) {
    final String owner = component['id'] as String? ?? 'Unknown';
    for (final ComponentReference reference in _referencesOf(
      component,
      refFields,
    )) {
      if (!ids.contains(reference.id)) {
        throw A2uiIntegrityError(
          "Component '$owner' references non-existent component "
          "'${reference.id}' in field '${reference.field}'",
          componentIds: [owner, reference.id],
        );
      }
    }
  }
}

/// Walks the component graph from the root, reporting the ids it reaches.
///
/// Throws [A2uiRecursionError] for a self-reference, a cycle, or a chain
/// deeper than [maxComponentDepth], and [A2uiIntegrityError] for a component
/// unreachable from the root when [allowOrphans] is false.
Set<String> analyzeComponentTopology(
  List<Map<String, Object?>> components,
  Map<String, ComponentRefFields> refFields, {
  required bool requireRoot,
  required bool allowOrphans,
}) {
  final adjacency = <String, List<String>>{};
  final ids = <String>{};

  for (final component in components) {
    final Object? id = component['id'];
    if (id is! String) continue;
    ids.add(id);
    final List<String> edges = adjacency.putIfAbsent(id, () => <String>[]);
    for (final ComponentReference reference in _referencesOf(
      component,
      refFields,
    )) {
      if (reference.id == id) {
        throw A2uiRecursionError(
          "Self-reference detected: Component '$id' references itself in "
          "field '${reference.field}'",
          cycle: [id],
        );
      }
      edges.add(reference.id);
    }
  }

  final visited = <String>{};
  final onStack = <String>{};

  void visit(String id, int depth) {
    if (depth > maxComponentDepth) {
      throw A2uiRecursionError(
        'Global recursion limit exceeded: logical depth > $maxComponentDepth',
        cycle: onStack.toList(),
      );
    }
    visited.add(id);
    onStack.add(id);
    for (final String next in adjacency[id] ?? const <String>[]) {
      if (!visited.contains(next)) {
        visit(next, depth + 1);
      } else if (onStack.contains(next)) {
        throw A2uiRecursionError(
          "Circular reference detected involving component '$next'",
          cycle: [...onStack, next],
        );
      }
    }
    onStack.remove(id);
  }

  if (!requireRoot) {
    // Without a root there is no single entry point, so every component is
    // its own starting point. Cycles still have to be found.
    for (final String id in ids.toList()..sort()) {
      if (!visited.contains(id)) visit(id, 0);
    }
    return visited;
  }

  if (ids.contains(rootComponentId)) visit(rootComponentId, 0);

  if (!allowOrphans) {
    final List<String> orphans = (ids.difference(visited).toList())..sort();
    if (orphans.isNotEmpty) {
      throw A2uiIntegrityError(
        "Component '${orphans.first}' is not reachable from "
        "'$rootComponentId'",
        componentIds: orphans,
      );
    }
  }
  return visited;
}

/// Checks data-model paths and nesting depth anywhere inside a message body.
///
/// Throws [A2uiValidationError] for a malformed path and [A2uiRecursionError]
/// when nesting or chained function calls run past their caps.
void checkPathsAndRecursion(Object? data) {
  void traverse(Object? node, int depth, int callDepth) {
    if (depth > maxComponentDepth) {
      throw A2uiRecursionError(
        'Global recursion limit exceeded: Depth > $maxComponentDepth',
      );
    }

    if (node is List) {
      for (final Object? item in node) {
        traverse(item, depth + 1, callDepth);
      }
      return;
    }

    if (node is! Map) return;
    final Map<String, Object?> object = node.cast<String, Object?>();

    final Object? path = object['path'];
    if (path is String && !_pathPattern.hasMatch(path)) {
      throw A2uiValidationError(
        "Invalid path syntax: '$path'",
        details: object,
      );
    }

    final bool isCall = object.containsKey('call');
    if (isCall) {
      if (callDepth >= maxFunctionCallDepth) {
        throw A2uiRecursionError(
          'Recursion limit exceeded: functionCall depth > '
          '$maxFunctionCallDepth',
        );
      }
      for (final MapEntry<String, Object?> entry in object.entries) {
        traverse(
          entry.value,
          depth + 1,
          entry.key == 'args' ? callDepth + 1 : callDepth,
        );
      }
      return;
    }

    for (final Object? value in object.values) {
      traverse(value, depth + 1, callDepth);
    }
  }

  traverse(data, 0, 0);
}

Iterable<ComponentReference> _referencesOf(
  Map<String, Object?> component,
  Map<String, ComponentRefFields> refFields,
) {
  final Object? type = component['component'];
  if (type is! String) return const <ComponentReference>[];
  return componentReferences(component, refFields[type]);
}
