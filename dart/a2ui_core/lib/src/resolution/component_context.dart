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

import '../core/component_model.dart';
import '../core/messages.dart';
import '../core/surface_model.dart';
import '../primitives/errors.dart';
import 'data_context.dart';

/// Context provided to components during rendering.
class ComponentContext {
  final SurfaceModel surface;
  final ComponentModel componentModel;
  final DataContext dataContext;

  /// By default, expression errors are dispatched immediately on the surface:
  /// as `EXECUTION_ERROR` naming the `functionCallId` when the cause is an
  /// [A2uiRpcError] from a call the agent answered with a failure, and as
  /// `EXPRESSION_ERROR` otherwise. Supply [onError] to control their
  /// reporting policy instead.
  ///
  /// [parentDataContext] links this component's data context to the context
  /// of the component that references it, and [index] records its position
  /// in a collection template. Without [parentDataContext], bindings to
  /// missing data are dispatched as `MISSING_DATA_BINDING` warnings on the
  /// surface unless [onMissingData] is supplied; with it, the parent's
  /// reporter applies by default.
  ComponentContext(
    this.surface,
    this.componentModel, {
    String? basePath,
    ExpressionErrorReporter? onError,
    DataContext? parentDataContext,
    int? index,
    MissingDataReporter? onMissingData,
  }) : dataContext = createSurfaceDataContext(
          surface,
          basePath: basePath,
          onError: onError,
          parentDataContext: parentDataContext,
          index: index,
          onMissingData: onMissingData,
          defaultErrorReporter: _surfaceReporter(surface),
        );

  static ExpressionErrorReporter _surfaceReporter(SurfaceModel surface) =>
      (error) => surface.dispatchError(clientErrorFor(surface, error));

  /// Builds the [A2uiRendererError] for [error] on [surface].
  ///
  /// When [error]'s cause is an [A2uiRpcError], the error code is
  /// `EXECUTION_ERROR` and `functionCallId` is set (omitting `surfaceId` when
  /// `functionCallId` is non-null to satisfy the v1.0 wire `oneOf` rule).
  static A2uiRendererError clientErrorFor(
    SurfaceModel surface,
    A2uiExpressionError error,
  ) {
    final Object? cause = error.cause;
    return cause is A2uiRpcError
        ? A2uiRendererError(
            code: RpcErrorCode.executionError.wireValue,
            surfaceId: cause.functionCallId == null ? surface.id : null,
            functionCallId: cause.functionCallId,
            message: error.message,
            details: error.details,
          )
        : A2uiRendererError(
            code: error.code,
            surfaceId: surface.id,
            message: error.message,
            details: error.details,
          );
  }

  /// Dispatches an action from the component.
  Future<void> dispatchAction(Map<String, dynamic> action) {
    return surface.dispatchAction(action, componentModel.id);
  }

  /// Returns a context for rendering a child component.
  ///
  /// Throws [A2uiStateError] if [childId] does not exist on the surface or if
  /// [basePath] is not an absolute JSON Pointer path starting with `/`.
  ComponentContext childContext(String childId, {String? basePath}) {
    if (basePath != null && !basePath.startsWith('/')) {
      throw A2uiStateError(
        "Base path for child context must be absolute (start with '/'), "
        "got '$basePath'.",
      );
    }
    final ComponentModel? childModel = surface.componentsModel.get(childId);
    if (childModel == null) {
      throw A2uiStateError('Child component not found: $childId');
    }
    return ComponentContext(
      surface,
      childModel,
      basePath: basePath ?? dataContext.path,
      parentDataContext: dataContext,
    );
  }
}
