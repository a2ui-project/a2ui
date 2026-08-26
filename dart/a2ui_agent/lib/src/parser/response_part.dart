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
import 'package:collection/collection.dart';

/// A slice of an LLM response.
///
/// A parsed response is a list of [TextPart] and [A2uiPart]; an unwrapped but
/// not yet compiled response is a list of [RawResponsePart], whose `part` is a
/// [TextPart] or a [RawA2uiPart].
sealed class ResponsePart {
  const ResponsePart();
}

/// Conversational text extracted from an LLM response.
final class TextPart extends ResponsePart {
  /// The text content intended for user display.
  final String text;

  const TextPart(this.text);

  @override
  bool operator ==(Object other) => other is TextPart && other.text == text;

  @override
  int get hashCode => text.hashCode;

  @override
  String toString() => 'TextPart(${_ellipsize(text)})';
}

/// An uncompiled A2UI content block extracted from an LLM response.
final class RawA2uiPart extends ResponsePart {
  /// The raw uncompiled format content (raw JSON, DSL, or XML).
  final String a2uiRaw;

  const RawA2uiPart(this.a2uiRaw);

  @override
  bool operator ==(Object other) =>
      other is RawA2uiPart && other.a2uiRaw == a2uiRaw;

  @override
  int get hashCode => a2uiRaw.hashCode;

  @override
  String toString() => 'RawA2uiPart(${_ellipsize(a2uiRaw)})';
}

/// Compiled A2UI payload messages ready to deliver to a renderer.
final class A2uiPart extends ResponsePart {
  /// The validated messages to deliver to client renderers.
  final List<A2uiMessage> a2ui;

  const A2uiPart(this.a2ui);

  @override
  bool operator ==(Object other) =>
      other is A2uiPart &&
      const DeepCollectionEquality().equals(
        other.a2ui.map((m) => m.toJson()).toList(),
        a2ui.map((m) => m.toJson()).toList(),
      );

  @override
  int get hashCode =>
      const DeepCollectionEquality().hash(a2ui.map((m) => m.toJson()).toList());

  @override
  String toString() => 'A2uiPart(${a2ui.length} message(s))';
}

/// An uncompiled token from an LLM response stream.
///
/// [part] is a [TextPart] or a [RawA2uiPart]; passing any other kind of
/// [ResponsePart] throws [ArgumentError].
class RawResponsePart {
  /// The underlying content: conversational [TextPart] or uncompiled
  /// [RawA2uiPart].
  final ResponsePart part;

  /// Whether this part is complete, that is not truncated mid-stream.
  final bool isFinal;

  RawResponsePart(this.part, {this.isFinal = true}) {
    if (part is! TextPart && part is! RawA2uiPart) {
      throw ArgumentError.value(
        part,
        'part',
        'RawResponsePart holds a TextPart or a RawA2uiPart',
      );
    }
  }

  @override
  bool operator ==(Object other) =>
      other is RawResponsePart &&
      other.part == part &&
      other.isFinal == isFinal;

  @override
  int get hashCode => Object.hash(part, isFinal);

  @override
  String toString() => 'RawResponsePart($part, isFinal: $isFinal)';
}

String _ellipsize(String value) =>
    value.length <= 40 ? "'$value'" : "'${value.substring(0, 40)}...'";
