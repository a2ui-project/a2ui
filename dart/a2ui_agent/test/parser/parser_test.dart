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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:test/test.dart';

/// A parser that records what the base class asks of it.
///
/// Exercises `Parser.parseResponse`, the one behaviour the abstract class
/// supplies rather than delegating to a format implementation.
class RecordingParser extends Parser {
  final List<RawResponsePart> unwrapResult;
  final List<String> compiled = <String>[];
  final List<String> unwrapped = <String>[];

  RecordingParser(this.unwrapResult);

  @override
  String wrap(List<RawResponsePart> blocks) => blocks
      .map(
        (b) => switch (b.part) {
          TextPart(:final String text) => text,
          RawA2uiPart(:final String a2uiRaw) => '<raw>$a2uiRaw</raw>',
          _ => '',
        },
      )
      .join();

  @override
  List<RawResponsePart> unwrap(String content) {
    unwrapped.add(content);
    return unwrapResult;
  }

  @override
  List<A2uiMessage> compile(String formatContent) {
    compiled.add(formatContent);
    return [CreateSurfaceMessage(surfaceId: formatContent, catalogId: 'c')];
  }

  @override
  String decompile(List<A2uiMessage> a2uiPayload) =>
      a2uiPayload.length.toString();

  @override
  List<ResponsePart> parseChunk(String chunk, {bool wrapped = true}) =>
      throw UnimplementedError('RecordingParser.parseChunk');
}

void main() {
  group('Parser.parseResponse', () {
    test('preserves the order of text and payload blocks', () {
      final parser = RecordingParser([
        RawResponsePart(const TextPart('before')),
        RawResponsePart(const RawA2uiPart('first')),
        RawResponsePart(const TextPart('between')),
        RawResponsePart(const RawA2uiPart('second')),
        RawResponsePart(const TextPart('after')),
      ]);

      final List<ResponsePart> parts = parser.parseResponse('ignored');

      expect(parts, hasLength(5));
      expect(parts[0], const TextPart('before'));
      expect(parts[1], isA<A2uiPart>());
      expect(parts[2], const TextPart('between'));
      expect(parts[3], isA<A2uiPart>());
      expect(parts[4], const TextPart('after'));
      expect(parser.compiled, ['first', 'second']);
    });

    test('unwraps the content it is given', () {
      final parser = RecordingParser([RawResponsePart(const TextPart('t'))]);
      parser.parseResponse('raw response');
      expect(parser.unwrapped, ['raw response']);
    });

    test('compiles the whole content when it is not wrapped', () {
      final parser = RecordingParser([]);

      final List<ResponsePart> parts = parser.parseResponse(
        '[{"a": 1}]',
        wrapped: false,
      );

      expect(parts, hasLength(1));
      expect(parts.single, isA<A2uiPart>());
      expect(parser.compiled, ['[{"a": 1}]']);
      expect(parser.unwrapped, isEmpty, reason: 'unwrap must be skipped');
    });

    test('returns no parts for an empty unwrap result', () {
      expect(RecordingParser([]).parseResponse('anything'), isEmpty);
    });

    test('surfaces a compile failure to the caller', () {
      final parser = _FailingParser();

      expect(
        () => parser.parseResponse('anything'),
        throwsA(isA<A2uiCompileError>()),
      );
    });
  });

  group('Parser defaults', () {
    test('does not claim streaming support', () {
      expect(RecordingParser([]).supportsStreaming, isFalse);
    });
  });
}

class _FailingParser extends RecordingParser {
  _FailingParser() : super([RawResponsePart(const RawA2uiPart('bad'))]);

  @override
  List<A2uiMessage> compile(String formatContent) =>
      throw A2uiCompileError('boom', rawContent: formatContent);
}
