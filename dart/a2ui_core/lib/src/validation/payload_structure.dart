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

import '../core/messages.dart';

/// Everything one surface declares across a payload.
///
/// A payload is validated per surface, because a component graph is a surface's
/// graph: reachability, the root and the reference set are all surface-scoped.
/// Which catalog each of those components is checked against is a separate
/// question, answered per component by `MessageProcessor`.
@internal
class SurfacePayload {
  /// Whether the payload creates the surface, making it a full render.
  bool created = false;

  /// The catalog the payload names for the surface, when it creates it.
  ///
  /// From v1.0 this is the surface-level default: a component or function call
  /// may name a `catalogId` of its own that overrides it.
  String? catalogId;

  /// Components declared for the surface, in the order they arrive.
  final List<Map<String, Object?>> components = [];

  /// How many `updateComponents` messages the payload sends the surface.
  int updates = 0;

  /// Whether the payload declares the whole surface in one message, so every
  /// component it declares should be reachable from the root.
  ///
  /// Once a payload revises the surface across several messages, a component
  /// left unreachable is the residue of a replacement rather than a defect:
  /// the `31_incremental-dashboard` example in the basic catalog swaps a
  /// loading placeholder out for the panel it was standing in for, and the
  /// placeholder is meant to be dropped.
  bool get isSingleRender => created && updates == 1;

  /// Where each id sits in [components].
  final Map<String, int> _positions = {};

  /// Merges one message's components in.
  ///
  /// A later message that repeats an id replaces that component rather than
  /// adding a second one: re-sending a component is how a surface is updated
  /// in place, which the `00_incremental` and `31_incremental-dashboard`
  /// examples in the basic catalog both do. Repeating an id *within* one
  /// message is a contradiction, and is caught before this merge.
  void merge(List<Map<String, Object?>> incoming) {
    updates++;
    for (final component in incoming) {
      final Object? id = component['id'];
      if (id is! String) {
        components.add(component);
        continue;
      }
      final int? at = _positions[id];
      if (at == null) {
        _positions[id] = components.length;
        components.add(component);
      } else {
        components[at] = component;
      }
    }
  }
}

/// Groups a payload's messages by surface, in arrival order.
@internal
Map<String, SurfacePayload> groupBySurface(List<A2uiMessage> messages) {
  final surfaces = <String, SurfacePayload>{};
  SurfacePayload payloadFor(String id) =>
      surfaces.putIfAbsent(id, SurfacePayload.new);

  for (final message in messages) {
    switch (message) {
      case CreateSurfaceMessage(:final surfaceId, :final catalogId):
        payloadFor(surfaceId)
          ..created = true
          ..catalogId = catalogId;
      case UpdateComponentsMessage(:final surfaceId, :final components):
        payloadFor(surfaceId).merge(components);
      case DeleteSurfaceMessage(:final surfaceId):
        // A surface deleted within the payload takes its components with
        // it, so what came before is not part of the graph any more.
        surfaces.remove(surfaceId);
      default:
        break;
    }
  }
  return surfaces;
}
