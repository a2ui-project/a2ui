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

import 'dart:collection';

import 'package:meta/meta.dart';

import '../validation/component_graph.dart';
import '../validation/component_refs.dart';

/// What a check found about a surface's component graph, which had no
/// self-reference and no cycle: the references each component holds, and an
/// upper bound on the longest chain of references below each.
///
/// The bound is what lets a batch be checked without walking the whole
/// graph again. A cycle the batch makes passes through one of its
/// components, and only the chains through its components grow, so only
/// those components and the ones above them are revisited.
@internal
class ComponentGraphBound {
  ComponentGraphBound._();

  /// The bound of a graph [checkComponentGraph] passed, holding each id of
  /// [graph] with its type and the map its references are read from through
  /// [refFields].
  factory ComponentGraphBound.of(
    Map<String, (String, Map<String, Object?>)> graph,
    Map<String, ComponentRefFields> refFields,
  ) {
    final bound = ComponentGraphBound._();
    for (final MapEntry(key: String id, value: (String type, source))
        in graph.entries) {
      bound._setChildren(id, type, source, refFields);
    }
    // Children before parents, which ends since the graph has no cycle. A
    // component waits on the stack until its children have their heights.
    for (final String start in graph.keys) {
      if (bound._heights.containsKey(start)) continue;
      final stack = <({String id, int childIndex, int height})>[
        (id: start, childIndex: 0, height: 0),
      ];
      while (stack.isNotEmpty) {
        final ({String id, int childIndex, int height}) frame = stack.last;
        final List<String> children =
            bound._children[frame.id] ?? const <String>[];
        int childIndex = frame.childIndex;
        int height = frame.height;
        var ready = true;
        while (childIndex < children.length) {
          final String child = children[childIndex];
          childIndex++;
          if (!graph.containsKey(child)) continue;
          final int? below = bound._heights[child];
          if (below == null) {
            stack[stack.length - 1] = (
              id: frame.id,
              childIndex: childIndex - 1,
              height: height,
            );
            stack.add((id: child, childIndex: 0, height: 0));
            ready = false;
            break;
          }
          if (below >= height) height = below + 1;
        }
        if (!ready) continue;
        bound._heights[frame.id] = height;
        if (height > bound._maxHeight) bound._maxHeight = height;
        stack.removeLast();
      }
    }
    return bound;
  }

  /// The ids each component references, held or not, in order.
  final Map<String, List<String>> _children = {};

  /// The components that reference each id, held or not.
  final Map<String, Set<String>> _parents = {};

  /// For each component, at least the number of references in the longest
  /// chain below it.
  final Map<String, int> _heights = {};

  /// At least the largest of [_heights].
  int _maxHeight = 0;

  /// The reference fields each type's references were read through.
  final Map<String, ComponentRefFields?> _fields = {};

  /// The components that reference [id], held or not, in the graph this
  /// bound describes.
  Iterable<String> parentsOf(String id) => _parents[id] ?? const <String>{};

  void _setChildren(
    String id,
    String type,
    Map<String, Object?> source,
    Map<String, ComponentRefFields> refFields,
  ) {
    for (final String child in _children[id] ?? const <String>[]) {
      _parents[child]?.remove(id);
    }
    final children = <String>[];
    for (final ComponentReference reference
        in componentReferences(source, refFields[type])) {
      final String child = reference.id;
      children.add(child);
      (_parents[child] ??= <String>{}).add(id);
    }
    _children[id] = children;
    _fields[type] = refFields[type];
  }

  /// Whether the graph with [batch] applied has no self-reference, no cycle
  /// and no chain of more than [limit] references, which holds if this
  /// bound shows it, updating the bound to that graph.
  ///
  /// [batch] holds each id with its type and the map its references are
  /// read from through [refFields], and [held] tells whether the graph
  /// holds an id before the batch. False means the bound cannot show it,
  /// not that the graph fails, and leaves the bound unusable.
  bool admits(
    Map<String, (String, Map<String, Object?>)> batch,
    Map<String, ComponentRefFields> refFields,
    int limit,
    bool Function(String id) held,
  ) {
    if (_maxHeight > limit) return false;
    for (final MapEntry(key: String type, value: ComponentRefFields? fields)
        in _fields.entries) {
      if (!identical(refFields[type], fields)) return false;
    }
    bool holds(String id) => batch.containsKey(id) || held(id);

    for (final MapEntry(key: String id, value: (String type, source))
        in batch.entries) {
      _setChildren(id, type, source, refFields);
      if ((_children[id] ?? const <String>[]).contains(id)) return false;
    }
    // Raises the bound of each component above one whose bound rose, until
    // none rises. A cycle would raise its bounds past any limit.
    final rising = ListQueue<String>();
    for (final String id in batch.keys) {
      var height = 0;
      for (final String child in _children[id] ?? const <String>[]) {
        final int below = _heights[child] ?? 0;
        if (holds(child) && below >= height) height = below + 1;
      }
      _heights[id] = height;
      rising.add(id);
    }
    while (rising.isNotEmpty) {
      final String id = rising.removeFirst();
      final int height = _heights[id] ?? 0;
      if (height > limit) return false;
      if (height > _maxHeight) _maxHeight = height;
      for (final String parent in _parents[id] ?? const <String>{}) {
        if ((_heights[parent] ?? 0) <= height) {
          _heights[parent] = height + 1;
          rising.add(parent);
        }
      }
    }
    return true;
  }
}
