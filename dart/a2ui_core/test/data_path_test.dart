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
import 'package:test/test.dart';

void main() {
  group('DataPath', () {
    test('root constant is empty and formats as /', () {
      expect(DataPath.root.isEmpty, isTrue);
      expect(DataPath.root.segments, isEmpty);
      expect(DataPath.root.toString(), '/');
    });

    test('appends segments', () {
      final DataPath path = DataPath.parse('/foo').append('bar');
      expect(path.segments, ['foo', 'bar']);
      expect(path.toString(), '/foo/bar');
      expect(
          DataPath.parse('/foo').append('/bar/baz').toString(), '/foo/bar/baz');
      expect(
        DataPath.parse('/foo').append(DataPath.parse('/bar/baz')).toString(),
        '/foo/bar/baz',
      );
      final DataPath relativeAppended = DataPath.parse('foo').append('/bar');
      expect(relativeAppended.isAbsolute, isFalse);
      expect(relativeAppended.toString(), 'foo/bar');
    });

    test('appends numeric segments', () {
      final DataPath path = DataPath.parse('/foo').append(0);
      expect(path.segments, ['foo', '0']);
      expect(path.toString(), '/foo/0');
    });

    test('parent path', () {
      final path = DataPath.parse('/foo/bar');
      expect(path.parent?.toString(), '/foo');
      expect(path.parent?.parent?.toString(), '/');
      expect(path.parent?.parent?.parent, isNull);
    });

    test('equality', () {
      expect(DataPath.parse('/a/b'), equals(DataPath.parse('/a/b')));
      expect(DataPath.parse('/a/b'), isNot(equals(DataPath.parse('/a/c'))));
    });

    test('hashCode distinguishes segments from slashes in keys', () {
      // Per RFC 6901 section 3, '~1' escapes a literal '/' within a key name.
      // DataPath(['a', 'b']) represents JSON Pointer "/a/b" (two keys).
      // DataPath(['a/b']) represents JSON Pointer "/a~1b" (one key: "a/b").
      // These are semantically different pointers and must have different
      // hash codes for correctness in hash-based collections.
      final twoSegments = DataPath(['a', 'b']);
      final oneSegment = DataPath(['a/b']);

      expect(twoSegments, isNot(equals(oneSegment)));
      expect(twoSegments.hashCode, isNot(equals(oneSegment.hashCode)));
    });

    test('preserves relative vs absolute paths in parse and toString', () {
      final relative = DataPath.parse('relative/seg');
      expect(relative.isAbsolute, isFalse);
      expect(relative.segments, ['relative', 'seg']);
      expect(relative.toString(), 'relative/seg');

      final absolute = DataPath.parse('/relative/seg');
      expect(absolute.isAbsolute, isTrue);
      expect(absolute.segments, ['relative', 'seg']);
      expect(absolute.toString(), '/relative/seg');
      expect(relative, isNot(equals(absolute)));
      expect(relative.hashCode, isNot(equals(absolute.hashCode)));

      final emptyPath = DataPath.parse('');
      expect(emptyPath.isAbsolute, isTrue);
      expect(emptyPath.isEmpty, isTrue);
      expect(emptyPath.toString(), '/');

      final constructedRelative = DataPath(['a', 'b'], isAbsolute: false);
      expect(constructedRelative.isAbsolute, isFalse);
      expect(constructedRelative.toString(), 'a/b');
      expect(constructedRelative.parent?.isAbsolute, isFalse);
      expect(constructedRelative.parent?.toString(), 'a');
      expect(constructedRelative.parent?.parent?.isAbsolute, isFalse);
      expect(constructedRelative.parent?.parent?.toString(), '');
      expect(constructedRelative.parent?.parent?.parent, isNull);
    });

    test(
        'rejects forbidden prototype-pollution segments in parse, '
        'constructor, and append', () {
      for (final forbidden in const ['__proto__', 'constructor', 'prototype']) {
        expect(
          () => DataPath.parse('/$forbidden'),
          throwsA(isA<A2uiDataError>()),
        );
        expect(
          () => DataPath.parse('a/$forbidden/b'),
          throwsA(isA<A2uiDataError>()),
        );
        expect(
          () => DataPath([forbidden]),
          throwsA(isA<A2uiDataError>()),
        );
        final base = DataPath.parse('/safe');
        expect(
          () => base.append(forbidden),
          throwsA(isA<A2uiDataError>()),
        );
        expect(
          () => base.append('/$forbidden'),
          throwsA(isA<A2uiDataError>()),
        );
        expect(
          () => base.append(_CustomSegment(forbidden)),
          throwsA(isA<A2uiDataError>()),
        );
      }
    });

    test('rejects malformed tilde escapes in parse and append', () {
      expect(
        () => DataPath.parse('/a~2b'),
        throwsA(isA<A2uiDataError>()),
      );
      expect(
        () => DataPath.parse('/a~'),
        throwsA(isA<A2uiDataError>()),
      );
      expect(
        () => DataPath.parse('a~9/b'),
        throwsA(isA<A2uiDataError>()),
      );
      expect(
        () => DataPath.parse('/a~~0b'),
        throwsA(isA<A2uiDataError>()),
      );
      expect(
        () => DataPath.parse('/safe').append('bad~2'),
        throwsA(isA<A2uiDataError>()),
      );
    });
  });
}

class _CustomSegment {
  final String value;
  const _CustomSegment(this.value);

  @override
  String toString() => value;
}
