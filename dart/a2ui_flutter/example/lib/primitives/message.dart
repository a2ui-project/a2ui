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

import 'package:a2ui_core/a2ui_core.dart' as core;
import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

/// Renders surfaces through the experimental node layer (`NodeSurface`)
/// instead of `Surface`. Enable with `--dart-define=nodes=true`.
const bool _useNodeLayer = bool.fromEnvironment('nodes');

class Message {
  Message({this.text, this.surfaceId, this.isUser = false})
    : assert((surfaceId == null) != (text == null));

  String? text;
  final String? surfaceId;
  final bool isUser;
}

class MessageView extends StatelessWidget {
  const MessageView(this.message, this.host, {super.key});

  final Message message;

  /// The surface host used to render generative UI surfaces. Required only
  /// when [Message.surfaceId] is non-null.
  final SurfaceHost? host;

  @override
  Widget build(BuildContext context) {
    final String? surfaceId = message.surfaceId;

    if (surfaceId == null) {
      if (message.isUser) {
        return Text(message.text ?? '');
      } else {
        return MarkdownBody(data: message.text ?? '');
      }
    }

    assert(
      host != null,
      'A SurfaceHost is required to render surface $surfaceId',
    );
    final SurfaceHost surfaceHost = host!;
    if (_useNodeLayer && surfaceHost is SurfaceController) {
      return _NodeLayerMessageSurface(
        controller: surfaceHost,
        surfaceId: surfaceId,
      );
    }
    return Surface(surfaceContext: surfaceHost.contextFor(surfaceId));
  }
}

/// Renders a surface through [NodeSurface] once its core model exists,
/// watching the definition snapshot only to learn about creation.
class _NodeLayerMessageSurface extends StatelessWidget {
  const _NodeLayerMessageSurface({
    required this.controller,
    required this.surfaceId,
  });

  final SurfaceController controller;
  final String surfaceId;

  @override
  Widget build(BuildContext context) {
    final SurfaceContext surfaceContext = controller.contextFor(surfaceId);
    return ValueListenableBuilder<SurfaceDefinition?>(
      valueListenable: surfaceContext.definition,
      builder: (context, definition, _) {
        final core.SurfaceModel<core.ComponentApi>? surface = controller
            .liveSurfaceFor(surfaceId);
        final Catalog? catalog = surfaceContext.catalog;
        if (definition == null || surface == null || catalog == null) {
          return const SizedBox.shrink();
        }
        return NodeSurface(
          surface: surface,
          catalog: catalog,
          onEvent: surfaceContext.handleUiEvent,
          reportError: surfaceContext.reportError,
        );
      },
    );
  }
}
