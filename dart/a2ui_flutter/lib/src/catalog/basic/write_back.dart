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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/widgets.dart';

import '../../component_implementation.dart';
import '../../component_props.dart';
import '../../surface_scope.dart';

/// Writes a value to the data path the property [key] is bound to and
/// returns whether the data model accepted it, or null when the payload gave
/// [key] no path. A write the data model rejects is reported on the
/// surface's `onError` with the rejection's code, message and path.
bool Function(Object? value)? writerFor(
  BuildContext context,
  ComponentProps props,
  String key,
) {
  final WritableBinding<Object?>? binding = props.writable(key);
  if (binding == null) return null;
  final SurfaceModel<ComponentImplementation> surface = SurfaceScope.of(
    context,
  );
  return (value) {
    try {
      binding.set(value);
      return true;
    } on A2uiDataError catch (error) {
      unawaited(
        surface.dispatchError(
          A2uiClientError(
            code: error.code,
            surfaceId: surface.id,
            message: error.message,
            path: error.path,
          ),
        ),
      );
      return false;
    }
  };
}
