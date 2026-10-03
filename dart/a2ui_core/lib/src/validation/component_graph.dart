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

import '../primitives/errors.dart';
import 'component_refs.dart';
import 'validation_config.dart';

/// The deepest component chain a surface may declare.
@visibleForTesting
const int maxComponentDepth = 50;

/// The deepest chain of nested function calls a component property may hold.
@visibleForTesting
const int maxFunctionCallDepth = 5;

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
