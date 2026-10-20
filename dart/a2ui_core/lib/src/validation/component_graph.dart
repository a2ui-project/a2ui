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
import '../primitives/protocol_version.dart';
import 'component_refs.dart';
import 'validation_config.dart';

/// The id every surface's component tree is rooted at unless a
/// `ValidationConfig.rootId` or `SurfaceModel.rootId` says otherwise.
const String _rootComponentId = 'root';

/// The deepest component chain a surface may declare.
@internal
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

/// Checks every parent-child edge among [components] and [existing] against
/// [rules].
///
/// [components] are the components the current message carries and
/// [existing] the ones the surface already holds that the message does not
/// replace. The component with id [rootId] has the surface as its implicit
/// parent, which `allowedParents` names `Surface`. An edge whose child is in
/// neither list is skipped: its type is unknown, and a later payload is
/// checked when it arrives.
///
/// An error for an edge whose parent is in [components] carries a JSON
/// Pointer into the message, such as `/components/0/children/1` for the
/// offending reference or `/components/0` for a root the surface may not
/// hold. When the parent is in [existing], nothing in the message holds the
/// reference, so the error carries no path.
///
/// Throws [A2uiValidationError] with code `UNALLOWED_PARENT` or
/// `UNALLOWED_CHILD`, carrying [surfaceId].
void checkCompositionConstraints(
  List<Map<String, Object?>> components,
  Map<String, ComponentRefFields> refFields,
  Map<String, CompositionRule> rules, {
  Iterable<Map<String, Object?>> existing = const [],
  String rootId = _rootComponentId,
  String? surfaceId,
}) {
  if (rules.isEmpty) return;
  final types = <String, String>{
    for (final component in components.followedBy(existing))
      if ((component['id'], component['component'])
          case (final String id, final String type))
        id: type,
  };
  final checker = _CompositionChecker(
    refFields,
    rules,
    (String id) => types[id],
    rootId: rootId,
    surfaceId: surfaceId,
  );
  for (var index = 0; index < components.length; index++) {
    checker.checkComponent(components[index], '/components/$index');
  }
  for (final component in existing) {
    checker.checkComponent(component, null);
  }
}

/// Checks the parent-child edges a batch of [components] can change against
/// [rules], on a surface whose other edges passed
/// [checkCompositionConstraints] under the same [rules] and have not changed
/// since.
///
/// Those are the surface's edge into the root when the batch holds it, the
/// edges from each component of the batch, and the edges into each
/// component of the batch from the components outside it. [heldType] gives
/// the type of a component the surface holds, or null for one it does not,
/// and [heldParents] the components the surface holds that reference an id.
/// The rest of the surface is not read, so the check costs what the batch
/// changes rather than the size of the surface.
///
/// An error for the root or for an edge from the batch is the one
/// [checkCompositionConstraints] reports first for the same surface. An edge
/// into the batch from a component outside it is checked last, so a caller
/// that needs the error the whole-surface check reports first runs that
/// check when this one throws for such an edge.
///
/// Throws [A2uiValidationError] as [checkCompositionConstraints] does.
void checkBatchCompositionConstraints(
  List<Map<String, Object?>> components,
  Map<String, ComponentRefFields> refFields,
  Map<String, CompositionRule> rules, {
  required String? Function(String id) heldType,
  required Iterable<String> Function(String id) heldParents,
  String rootId = _rootComponentId,
  String? surfaceId,
}) {
  if (rules.isEmpty) return;
  // A component of the batch replaces the one the surface holds with its id.
  final batchTypes = <String, String?>{
    for (final component in components)
      if (component['id'] case final String id)
        id: switch (component['component']) {
          final String type => type,
          _ => null,
        },
  };
  String? typeOf(String id) =>
      batchTypes.containsKey(id) ? batchTypes[id] : heldType(id);
  final checker = _CompositionChecker(
    refFields,
    rules,
    typeOf,
    rootId: rootId,
    surfaceId: surfaceId,
  );
  for (var index = 0; index < components.length; index++) {
    checker.checkComponent(components[index], '/components/$index');
  }
  for (final MapEntry(key: String id, value: String? type)
      in batchTypes.entries) {
    if (type == null) continue;
    for (final String parent in heldParents(id)) {
      if (batchTypes.containsKey(parent)) continue;
      final String? parentType = heldType(parent);
      if (parentType == null) continue;
      checker.checkEdge(parent, parentType, id, type, null);
    }
  }
}

/// The checks [checkCompositionConstraints] and
/// [checkBatchCompositionConstraints] run on each component and edge.
class _CompositionChecker {
  _CompositionChecker(
    this.refFields,
    this.rules,
    this.typeOf, {
    required this.rootId,
    required this.surfaceId,
  });

  final Map<String, ComponentRefFields> refFields;
  final Map<String, CompositionRule> rules;

  /// The type of a component on the surface the check reads, or null when
  /// the surface does not hold it.
  final String? Function(String id) typeOf;
  final String rootId;
  final String? surfaceId;

  static String _list(List<String> names) =>
      '[${names.map((name) => "'$name'").join(', ')}]';

  /// Checks [component] as the root when it is one, and each edge from it.
  ///
  /// [pointer] locates [component] in the message, or is null when the
  /// component was already stored.
  void checkComponent(Map<String, Object?> component, String? pointer) {
    final Object? id = component['id'];
    final Object? type = component['component'];
    if (id is! String || type is! String) return;

    final List<String>? rootParents = rules[type]?.allowedParents;
    if (id == rootId &&
        rootParents != null &&
        !rootParents.contains(_surfaceParent)) {
      throw A2uiValidationError(
        "Component '$id' ($type) cannot be placed under parent "
        "'$_surfaceParent' ($_surfaceParent). Allowed parents: "
        '${_list(rootParents)}.',
        code: 'UNALLOWED_PARENT',
        path: pointer,
        surfaceId: surfaceId,
      );
    }

    for (final ComponentReference reference in _referencesOf(
      component,
      refFields,
    )) {
      final String? childType = typeOf(reference.id);
      if (childType == null) continue;
      checkEdge(
        id,
        type,
        reference.id,
        childType,
        pointer == null ? null : '$pointer${referencePointer(reference.field)}',
      );
    }
  }

  /// Checks the edge from [parentId] to [childId], whose reference is at
  /// [path] in the message, or nowhere in it when [path] is null.
  void checkEdge(
    String parentId,
    String parentType,
    String childId,
    String childType,
    String? path,
  ) {
    final List<String>? allowedChildren = rules[parentType]?.allowedChildren;
    if (allowedChildren != null && !allowedChildren.contains(childType)) {
      throw A2uiValidationError(
        "Container '$parentId' ($parentType) cannot contain child '$childId' "
        '($childType). Allowed children: ${_list(allowedChildren)}.',
        code: 'UNALLOWED_CHILD',
        path: path,
        surfaceId: surfaceId,
      );
    }
    final List<String>? allowedParents = rules[childType]?.allowedParents;
    if (allowedParents != null && !allowedParents.contains(parentType)) {
      throw A2uiValidationError(
        "Component '$childId' ($childType) cannot be placed under "
        "parent '$parentId' ($parentType). Allowed parents: "
        '${_list(allowedParents)}.',
        code: 'UNALLOWED_PARENT',
        path: path,
        surfaceId: surfaceId,
      );
    }
  }
}

/// Matches a JSON Pointer as A2UI writes data-model paths, allowing the
/// leading slash to be omitted.
final RegExp _pathPattern = RegExp(
  r'^(?:(?:\/(?:[^~\/]|~[01])*)*|(?:[^~\/]|~[01])+(?:\/(?:[^~\/]|~[01])*)*)$',
);

/// Rejects a batch of components that names the same id twice, or names one
/// of [earlier], the ids of the earlier batches of the same message.
///
/// Throws [A2uiIntegrityError] for the first id that repeats.
void checkDuplicateComponentIds(
  Iterable<Map<String, Object?>> components, {
  Set<String> earlier = const {},
}) {
  final ids = <String>{};
  for (final component in components) {
    final Object? id = component['id'];
    if (id is! String) continue;
    if (earlier.contains(id) || !ids.add(id)) {
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
/// Throws [A2uiIntegrityError] for a self-reference or a cycle, and
/// [A2uiRecursionError] for a chain deeper than [maxDepth], which defaults to
/// [maxComponentDepth].
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
        throw A2uiIntegrityError(
          "Self-reference detected: Component '$id' references itself in "
          "field '${reference.field}'",
          componentIds: [id],
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
        throw A2uiIntegrityError(
          "Circular reference detected involving component '$next'",
          componentIds: [...onStack, next],
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
/// Throws [A2uiIntegrityError] for a missing root, a dangling reference, a
/// self-reference, a cycle, or an unreachable component, and
/// [A2uiRecursionError] for an over-deep chain.
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
bool _isDataBinding(
  Map<Object?, Object?> value, {
  required bool usesDirectives,
}) =>
    usesDirectives
        ? value['@path'] is String
        : value['path'] is String && !value.containsKey('componentId');

/// Whether [value] is a function-call object in the v1.0 (`@call`) or legacy
/// (`call`) shape. See [_isDataBinding].
bool _isFunctionCall(
  Map<Object?, Object?> value, {
  required bool usesDirectives,
}) =>
    usesDirectives ? value['@call'] is String : value['call'] is String;

/// Checks data-model paths and nesting depth anywhere inside a message body.
///
/// [grownFrom], if given, is an earlier form of [data] that passed this
/// check, such as a message that a stream has since extended. A list or map
/// in [data] that is identical to the one at the same place in [grownFrom]
/// is not checked again, so checking a message that grew costs what it
/// gained. Neither may have been changed since [grownFrom] was checked.
///
/// Throws [A2uiValidationError] for a malformed path and [A2uiRecursionError]
/// when nesting or chained function calls run past their caps.
void checkPathsAndRecursion(
  Object? data, {
  A2uiProtocolVersion? version,
  Object? grownFrom,
}) {
  final bool usesDirectives = version != null
      ? version.isAtLeast(A2uiProtocolVersion.v1_0)
      : _inferUsesDirectives(data);

  // [before] is what [grownFrom] holds at the place of [node], or null.
  void traverse(
    Object? node,
    Object? before,
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
      if (identical(node, before)) return;
      final List<Object?>? items = before is List ? before : null;
      for (var i = 0; i < node.length; i++) {
        traverse(
          node[i],
          items != null && i < items.length ? items[i] : null,
          depth + 1,
          callDepth,
          inDataValue: inDataValue,
        );
      }
      return;
    }

    if (node is! Map || identical(node, before)) return;
    final Map<Object?, Object?>? entries = before is Map ? before : null;

    if (inDataValue) {
      for (final MapEntry<Object?, Object?> entry in node.entries) {
        traverse(
          entry.value,
          entries?[entry.key],
          depth + 1,
          callDepth,
          inDataValue: true,
        );
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
        );
      }
      final Object? udmBefore = entries?['updateDataModel'];
      for (final MapEntry<Object?, Object?> entry in udm.entries) {
        traverse(
          entry.value,
          udmBefore is Map ? udmBefore[entry.key] : null,
          depth + 2,
          callDepth,
          inDataValue: entry.key == 'value',
        );
      }
      return;
    }

    final Object? path = _isDataBinding(object, usesDirectives: usesDirectives)
        ? object[usesDirectives ? '@path' : 'path']
        : (object['path'] is String && object['componentId'] is String
            ? object['path']
            : null);
    if (path is String && !_pathPattern.hasMatch(path)) {
      throw A2uiValidationError(
        "Invalid path syntax: '$path'",
      );
    }

    if (_isFunctionCall(object, usesDirectives: usesDirectives)) {
      if (callDepth >= maxFunctionCallDepth) {
        throw A2uiRecursionError(
          'Recursion limit exceeded: functionCall depth > '
          '$maxFunctionCallDepth',
        );
      }
      for (final MapEntry<Object?, Object?> entry in object.entries) {
        traverse(
          entry.value,
          entries != null &&
                  (entry.key != 'args' ||
                      _isFunctionCall(entries, usesDirectives: usesDirectives))
              ? entries[entry.key]
              : null,
          depth + 1,
          entry.key == 'args' ? callDepth + 1 : callDepth,
          inDataValue: false,
        );
      }
      return;
    }

    for (final MapEntry<Object?, Object?> entry in object.entries) {
      traverse(
        entry.value,
        entries?[entry.key],
        depth + 1,
        callDepth,
        inDataValue: false,
      );
    }
  }

  if (data is UpdateDataModelMessage) {
    final String? udmPath = data.path;
    if (udmPath != null && !_pathPattern.hasMatch(udmPath)) {
      throw A2uiValidationError(
        "Invalid path syntax: '$udmPath'",
      );
    }
    traverse(
      data.value,
      grownFrom is UpdateDataModelMessage ? grownFrom.value : null,
      2,
      0,
      inDataValue: true,
    );
    return;
  }

  if (data is AgentToRendererMessage) {
    traverse(
      data.toJson(),
      grownFrom is AgentToRendererMessage ? grownFrom.toJson() : grownFrom,
      0,
      0,
      inDataValue: false,
    );
    return;
  }

  traverse(data, grownFrom, 0, 0, inDataValue: false);
}

bool _inferUsesDirectives(Object? data) {
  final Object? rawVersion = switch (data) {
    AgentToRendererMessage(:final version) => version,
    Map() => data['version'],
    _ => null,
  };
  if (rawVersion is! String) return false;
  return A2uiProtocolVersion.tryParseSemVer(rawVersion)
          ?.isAtLeast(A2uiProtocolVersion.v1_0) ??
      false;
}

Iterable<ComponentReference> _referencesOf(
  Map<String, Object?> component,
  Map<String, ComponentRefFields> refFields,
) {
  final Object? type = component['component'];
  if (type is! String) return const <ComponentReference>[];
  return componentReferences(component, refFields[type]);
}
