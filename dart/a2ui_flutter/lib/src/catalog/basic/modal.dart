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

import 'package:a2ui_core/a2ui_core.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:json_schema_builder/json_schema_builder.dart';

import '../../binding/node_props_accessors.dart';
import '../../surface/surface_scope.dart';
import '../component_implementation.dart';

class _SimultaneousTapRecognizer extends TapGestureRecognizer {
  @override
  void rejectGesture(int pointer) {
    acceptGesture(pointer);
  }
}

/// The basic catalog `Modal` component implementation.
final flutterModalImplementation = FlutterComponentImplementation(
  name: 'Modal',
  schema: Schema.object(
    properties: {
      'trigger': CommonSchemas.componentId,
      'content': CommonSchemas.componentId,
    },
    required: ['trigger', 'content'],
  ),
  builder: (context, node, buildChild) {
    final ComponentNode<FlutterComponentImplementation>? trigger = node
        .childNode('trigger');
    final ComponentNode<FlutterComponentImplementation>? content = node
        .childNode('content');

    if (trigger == null) return const SizedBox.shrink();

    final A2uiSurfaceScope? scope = A2uiSurfaceScope.maybeOf(context);

    void openDialog() {
      if (content != null) {
        showDialog<void>(
          context: context,
          builder: (dialogContext) {
            Widget dialogContent = buildChild(content);
            if (scope != null) {
              dialogContent = A2uiSurfaceScope(
                surface: scope.surface,
                resolver: scope.resolver,
                child: dialogContent,
              );
            }
            return Dialog(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: dialogContent,
              ),
            );
          },
        );
      }
    }

    return RawGestureDetector(
      behavior: HitTestBehavior.translucent,
      gestures: {
        _SimultaneousTapRecognizer:
            GestureRecognizerFactoryWithHandlers<_SimultaneousTapRecognizer>(
              _SimultaneousTapRecognizer.new,
              (instance) {
                instance.onTap = openDialog;
              },
            ),
      },
      child: buildChild(trigger),
    );
  },
);
