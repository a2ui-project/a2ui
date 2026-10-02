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

import 'catalog.dart';
import 'component_model.dart';
import 'data_context.dart';
import 'messages.dart';
import 'surface_model.dart';

/// Context provided to components during rendering.
///
/// Superseded by the node-based resolution (`ComponentNode` /
/// `NodeResolver`): a rendering context is a transient view-tree construct
/// and must not live inside the long-lived `SurfaceModel` state.
class ComponentContext {
  final SurfaceModel surface;
  final ComponentModel componentModel;
  final DataContext dataContext;

  /// By default, expression errors are dispatched immediately on the surface.
  /// Supply [onError] to control their reporting policy instead.
  ComponentContext(
    this.surface,
    this.componentModel, {
    String? basePath,
    ExpressionErrorReporter? onError,
  }) : dataContext = DataContext(
          surface.dataModel,
          surface.catalog.invoke,
          basePath ?? '/',
          onError: onError ??
              (error) {
                surface.dispatchError(
                  A2uiClientError(
                    code: 'EXPRESSION_ERROR',
                    surfaceId: surface.id,
                    message: error.message,
                    details: error.details,
                  ),
                );
              },
          protocolVersion: surface.protocolVersion,
        );

  /// Dispatches an action from the component.
  Future<void> dispatchAction(Map<String, dynamic> action) {
    return surface.dispatchAction(action, componentModel.id);
  }

  /// Returns a context for rendering a child component.
  ComponentContext childContext(String childId, {String? basePath}) {
    final ComponentModel? childModel = surface.componentsModel.get(childId);
    if (childModel == null) {
      throw ArgumentError('Child component not found: $childId');
    }
    return ComponentContext(
      surface,
      childModel,
      basePath: basePath ?? dataContext.path,
      onError: dataContext.errorReporter,
    );
  }
}
