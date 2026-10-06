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

import 'dart:async';

import '../model/ui_models.dart';
import 'surface_context.dart';

/// An interface for a host that manages UI surfaces.
///
/// This host provides updates when surfaces are added, removed, or changed.
/// It also acts as a factory for [SurfaceContext]s, which provide access to the
/// state of minimal, individual surfaces.
abstract interface class SurfaceHost {
  /// A stream of updates for the surfaces managed by this host.
  ///
  /// Implementations may choose to filter redundant updates. Consumers should
  /// rely on [contextFor] to get the context for a specific surface.
  Stream<SurfaceUpdate> get surfaceUpdates;

  /// Returns a [SurfaceContext] for the surface with the given [surfaceId].
  SurfaceContext contextFor(String surfaceId);
}
