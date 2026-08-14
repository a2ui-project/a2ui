// Copyright 2025 The Flutter Authors.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import 'package:a2ui_core/src/primitives/data_path.dart';
import 'package:test/test.dart';

void main() {
  group('DataPath', () {
    test('parses root path', () {
      final path = DataPath.parse('/');
      expect(path.segments, isEmpty);
      expect(path.toString(), '/');
    });

    test('parses simple path', () {
      final path = DataPath.parse('/foo/bar');
      expect(path.segments, ['foo', 'bar']);
      expect(path.toString(), '/foo/bar');
    });

    test('parses escaped segments', () {
      final path = DataPath.parse('/foo~1bar/baz~0qux');
      expect(path.segments, ['foo/bar', 'baz~qux']);
      expect(path.toString(), '/foo~1bar/baz~0qux');
    });

    test('appends segments', () {
      final DataPath path = DataPath.parse('/foo').append('bar');
      expect(path.segments, ['foo', 'bar']);
      expect(path.toString(), '/foo/bar');
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
  });
}
