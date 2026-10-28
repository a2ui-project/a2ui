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

import 'response_part.dart';

/// Emits the text of a streamed response that lies between its blocks.
///
/// The text between two blocks is one run. A run is emitted as it arrives,
/// less the whitespace at its edges: leading whitespace is dropped at the
/// start of a run, and trailing whitespace is held until more text of the run
/// follows, so a run ends where its last non-blank character does, as the text
/// parts of a whole response do.
class TextRun {
  bool _started = false;
  String _heldSpace = '';

  /// Emits [text] as the next piece of the run.
  ///
  /// Nothing is emitted for a piece that is blank; its whitespace is held for
  /// the next piece.
  void emit(List<ResponsePart> parts, String text) {
    final String body = (_started ? text : text.trimLeft()).trimRight();
    if (body.isEmpty) {
      if (_started) _heldSpace += text;
      return;
    }
    final int start = _started ? 0 : text.indexOf(body);
    parts.add(TextPart('$_heldSpace$body'));
    _heldSpace = text.substring(start + body.length);
    _started = true;
  }

  /// Ends the run, as a block does; whitespace held at its end is dropped.
  void reset() {
    _started = false;
    _heldSpace = '';
  }
}
