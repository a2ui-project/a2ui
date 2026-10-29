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
/// Obtained from `Parser.openStream` or `Parser.openContinuingStream`. A
/// stream holds the text buffers of one response and the [RendererState] its
/// messages are applied to. Each message it emits, whether [feed] and [close]
/// return it or a thrown error carries it in
/// [A2uiErrorPartialResults.partialResults], has been applied to the state,
/// in the order emitted, and no other message has, so the state mirrors what
/// a renderer that received the emitted parts holds.
///
/// What happens once a block is rejected depends on how the stream was
/// opened. A [ResponseStream], from `openStream`, ends: [feed] or [close]
/// throws. A [ContinuingResponseStream], from `openContinuingStream`, returns
/// an [ErrorPart] in place of the block instead, drops what the block had not
/// emitted yet, and goes on with the text and blocks after it.
///
/// [P] is the type of the parts the stream returns.
abstract class ResponseReader<P extends StreamPart> {
  const ResponseReader();

  /// The state the stream's messages are applied to.
  RendererState get state;

  /// Whether the response read so far ends inside a block: after an opening
  /// tag, and before its closing tag.
  ///
  /// An unwrapped response is one block, so its stream is inside it until it
  /// ends. Text held back because it could start a tag is not inside a
  /// block. False once the stream has ended. A caller that joins the chunks
  /// of a paused and resumed response reads it to tell whether it may add
  /// text between them, such as a space, which inside a block could break
  /// the block.
  bool get isInBlock;

  /// Reads the next [chunk] and returns the parts that became ready.
  ///
  /// If it throws, the stream has ended, and a thrown [A2uiError]'s
  /// [A2uiErrorPartialResults.partialResults] holds the parts the chunk made
  /// ready before the failure. They have been applied to the state like the
  /// parts of any earlier chunk, so the caller shows them too.
  ///
  /// Throws [A2uiParseError] if a block cannot be read and
  /// [A2uiValidationError] if a message is rejected, for a stream that ends
  /// at a rejected block, and [StateError] if the stream has ended.
  List<P> feed(String chunk);

  /// Ends the response and returns the parts still held back.
  ///
  /// Call it after the last chunk: text that could still have started a tag
  /// is held until then, and an unwrapped response is checked as a whole
  /// only then. Closing a stream that has ended returns nothing. A thrown
  /// error carries the parts made ready before the failure, as for [feed].
  ///
  /// Throws [A2uiParseError] if a block is still open, and
  /// [A2uiValidationError] if the messages the response left behind are
  /// rejected, for a stream that ends at a rejected block. A stream that
  /// reads past rejected blocks returns an [ErrorPart] for them instead.
  List<P> close();
}

/// A stream that ends at the first rejected block, and so returns only
/// [ResponsePart]s.
typedef ResponseStream = ResponseReader<ResponsePart>;

/// A stream that reads past a rejected block, returning an [ErrorPart] in its
/// place.
typedef ContinuingResponseStream = ResponseReader<StreamPart>;

final Expando<List<ResponsePart>> _partialResults = Expando('partialResults');

/// The parts a response stream made ready before it threw an error.
extension A2uiErrorPartialResults on A2uiError {
  /// The parts the failing [ResponseReader.feed] or [ResponseReader.close]
  /// made ready before it threw this error, or an empty list for an error a
  /// stream did not throw.
  List<ResponsePart> get partialResults =>
      _partialResults[this] ?? const <ResponsePart>[];
}

/// Records [parts] as the [A2uiErrorPartialResults.partialResults] of
/// [error], if it is an [A2uiError].
void attachPartialResults(Object error, List<ResponsePart> parts) {
  if (error is A2uiError) _partialResults[error] = List.unmodifiable(parts);
}
