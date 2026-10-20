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

import '../utils/renderer_state.dart';
import 'response_part.dart';

/// Reads one streamed LLM response, chunk by chunk.
///
/// Obtained from `Parser.openStream`. A stream holds the text buffers of one
/// response and the [RendererState] its messages are applied to. Each
/// message it emits has been applied to the state, in the order emitted, and
/// no other message has, so the state mirrors what a renderer that received
/// the emitted parts holds.
abstract class ResponseStream {
  const ResponseStream();

  /// The state the stream's messages are applied to.
  RendererState get state;

  /// Reads the next [chunk] and returns the parts that became ready.
  ///
  /// If it throws, the stream has ended: the response cannot be read further
  /// once part of it is rejected.
  ///
  /// Throws [A2uiParseError] if a block cannot be read, [A2uiValidationError]
  /// if a message is rejected, and [StateError] if the stream has ended.
  List<ResponsePart> feed(String chunk);

  /// Ends the response and returns the parts still held back.
  ///
  /// Call it after the last chunk: text that could still have started a tag
  /// is held until then, and an unwrapped response is checked as a whole
  /// only then. Closing a stream that has ended returns nothing.
  ///
  /// Throws [A2uiParseError] if a block is still open, and
  /// [A2uiValidationError] if the messages the response left behind are
  /// rejected.
  List<ResponsePart> close();
}
