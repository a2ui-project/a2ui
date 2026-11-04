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

import '../parser/response_part.dart';
import '../parser/response_stream.dart';
import '../utils/renderer_state.dart';
import 'processor.dart';

/// A part of a [StreamedAnswer]: its text, a surface it created, or a block
/// it rejected.
///
/// [T] is the component type of the renderer's processor.
sealed class AnswerPart<T extends ComponentApi> {
  const AnswerPart();
}

/// Text the model wrote between two surfaces, or before or after them.
final class AnswerTextPart<T extends ComponentApi> extends AnswerPart<T> {
  final String text;

  const AnswerTextPart(this.text);
}

/// A surface the answer created, where the model wrote it.
final class AnswerSurfacePart<T extends ComponentApi> extends AnswerPart<T> {
  final SurfaceModel<T> surface;

  const AnswerSurfacePart(this.surface);
}

/// A block the answer rejected, where the model wrote it.
final class AnswerErrorPart<T extends ComponentApi> extends AnswerPart<T> {
  /// Why the block was rejected.
  final A2uiError error;

  const AnswerErrorPart(this.error);
}

/// One model answer, read as it streams, for an app that is both the agent
/// and the renderer.
///
/// The answer opens a stream on the request processor whose state is
/// [RendererState.of] the [renderer], so each message is checked and applied
/// to the processor the app renders from, and the stream reads past a
/// rejected block. The answer keeps its [parts] in the order the model wrote
/// them: the text, one part per surface it creates, and an [AnswerErrorPart]
/// where a block was rejected, followed by the text and surfaces after it. A
/// surface the answer deletes leaves the parts.
///
/// Text the stream returns in pieces is joined into one part until a block
/// comes between.
class StreamedAnswer<T extends ComponentApi> {
  /// Opens the answer to the prompt of [processor], applying its surfaces to
  /// [renderer].
  ///
  /// [renderer] takes its messages from the answer only.
  ///
  /// Throws [A2uiCatalogError] if the renderer's catalogs are not the
  /// processor's active catalogs, in the same order, and [UnsupportedError]
  /// if the processor's format cannot be read chunk by chunk.
  StreamedAnswer(A2uiRequestProcessor processor, {required this.renderer})
    : _stream = processor.openContinuingStream(
        state: RendererState.of(renderer),
      );

  /// The processor the answer's surfaces are applied to.
  final MessageProcessor<T> renderer;

  final ContinuingResponseStream _stream;

  List<AnswerPart<T>> _parts = List.unmodifiable(<AnswerPart<T>>[]);

  /// Whether the last part the stream returned was text, so more text joins
  /// it.
  bool _inText = false;

  /// The parts of the answer so far, in the order the model wrote them.
  ///
  /// The list cannot be modified, and is replaced when the parts change.
  List<AnswerPart<T>> get parts => _parts;

  /// Whether the answer so far ends inside a block. See
  /// [ResponseReader.isInBlock].
  bool get isInBlock => _stream.isInBlock;

  /// Reads the next [chunk] of the answer.
  ///
  /// Throws [StateError] if the answer has been closed, and what the stream
  /// throws for a reason other than a rejected block.
  void feed(String chunk) => _show(_stream.feed(chunk));

  /// Ends the answer, adding the text held back as a possible tag and a
  /// block still open.
  void close() => _show(_stream.close());

  void _show(List<StreamPart> streamParts) {
    if (streamParts.isEmpty) return;
    final List<AnswerPart<T>> parts = [..._parts];
    var changed = false;
    for (final part in streamParts) {
      switch (part) {
        case TextPart(:final String text):
          if (parts.lastOrNull case AnswerTextPart<T>(
            text: final String before,
          ) when _inText) {
            parts.last = AnswerTextPart<T>(before + text);
          } else {
            parts.add(AnswerTextPart<T>(text));
          }
          _inText = true;
          changed = true;
        case ErrorPart(:final A2uiError error):
          _inText = false;
          parts.add(AnswerErrorPart<T>(error));
          changed = true;
        case A2uiPart(:final List<AgentToRendererMessage> a2ui):
          _inText = false;
          for (final message in a2ui) {
            switch (message) {
              case CreateSurfaceMessage(:final String surfaceId):
                if (renderer.model.getSurface(surfaceId) case final surface?) {
                  parts.add(AnswerSurfacePart<T>(surface));
                  changed = true;
                }
              case DeleteSurfaceMessage(:final String surfaceId):
                final int count = parts.length;
                parts.removeWhere(
                  (AnswerPart<T> p) =>
                      p is AnswerSurfacePart<T> && p.surface.id == surfaceId,
                );
                if (parts.length != count) changed = true;
              default:
            }
          }
      }
    }
    if (changed) _parts = List.unmodifiable(parts);
  }
}
