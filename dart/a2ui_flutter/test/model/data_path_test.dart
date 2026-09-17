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

import 'package:a2ui_flutter/src/model/data_path.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DataPath', () {
    group('constructors and parsing', () {
      test('parses absolute paths', () {
        final path = DataPath('/a/b');
        expect(path.isAbsolute, isTrue);
        expect(path.segments, ['a', 'b']);
      });

      test('parses relative paths', () {
        final path = DataPath('a/b');
        expect(path.isAbsolute, isFalse);
        expect(path.segments, ['a', 'b']);
      });

      test('parses root path', () {
        final path = DataPath('/');
        expect(path.isAbsolute, isTrue);
        expect(path.segments, isEmpty);
      });

      test('parses empty path', () {
        final path = DataPath('');
        expect(path.isAbsolute, isFalse);
        expect(path.segments, isEmpty);
      });

      test('singleton root path', () {
        expect(DataPath.root.isAbsolute, isTrue);
        expect(DataPath.root.segments, isEmpty);
      });

      test('handles multiple separators and trailing separators', () {
        final path = DataPath('/a//b/');
        expect(path.isAbsolute, isTrue);
        expect(path.segments, ['a', 'b']);
      });
    });

    group('properties', () {
      test('basename returns the last segment', () {
        expect(DataPath('/a/b').basename, 'b');
        expect(DataPath('a/b/c').basename, 'c');
      });

      test('basename returns empty string for root and empty paths', () {
        expect(DataPath.root.basename, '');
        expect(DataPath('').basename, '');
      });

      test('dirname returns the parent path', () {
        expect(DataPath('/a/b/c').dirname, DataPath('/a/b'));
        expect(DataPath('a/b').dirname, DataPath('a'));
      });

      test('dirname returns itself for root and empty paths', () {
        expect(DataPath.root.dirname, DataPath.root);
        expect(DataPath('').dirname, DataPath(''));
      });
    });

    group('join', () {
      test('combines absolute and relative paths', () {
        final path1 = DataPath('/a');
        final path2 = DataPath('b/c');
        expect(path1.join(path2), DataPath('/a/b/c'));
      });

      test('combines relative and relative paths', () {
        final path1 = DataPath('a');
        final path2 = DataPath('b/c');
        expect(path1.join(path2), DataPath('a/b/c'));
      });

      test('join throws ArgumentError when both paths are absolute', () {
        final path1 = DataPath('/a');
        final path2 = DataPath('/b/c');
        expect(() => path1.join(path2), throwsArgumentError);
      });

      test(
        'join with absolute path as second argument returns it when first is '
        'relative',
        () {
          final path1 = DataPath('a');
          final path2 = DataPath('/b/c');
          expect(path1.join(path2), DataPath('/b/c'));
        },
      );

      test('joining with empty path returns original', () {
        final path1 = DataPath('/a/b');
        expect(path1.join(DataPath('')), DataPath('/a/b'));
      });
    });

    group('startsWith', () {
      test('returns true for exact matches', () {
        expect(DataPath('/a/b').startsWith(DataPath('/a/b')), isTrue);
        expect(DataPath('a/b').startsWith(DataPath('a/b')), isTrue);
      });

      test('returns true for prefixes', () {
        final path = DataPath('/a/b/c');
        expect(path.startsWith(DataPath('/a/b')), isTrue);
        expect(path.startsWith(DataPath('/a')), isTrue);
        expect(path.startsWith(DataPath.root), isTrue);
      });

      test('returns false for non-prefixes', () {
        final path = DataPath('/a/b/c');
        expect(path.startsWith(DataPath('/a/c')), isFalse);
        expect(path.startsWith(DataPath('/b')), isFalse);
      });

      test(
        'returns false when relative path tries to start with absolute path',
        () {
          expect(DataPath('a/b').startsWith(DataPath('/a')), isFalse);
        },
      );

      test('returns true when absolute path starts with a relative path with '
          'matching segments', () {
        expect(DataPath('/a/b').startsWith(DataPath('a')), isTrue);
      });

      test('returns false when other is longer', () {
        expect(DataPath('/a').startsWith(DataPath('/a/b')), isFalse);
      });
    });

    group('formatting and equality', () {
      test('toString formats absolute paths', () {
        expect(DataPath('/a/b').toString(), '/a/b');
        expect(DataPath.root.toString(), '/');
      });

      test('toString formats relative paths', () {
        expect(DataPath('a/b').toString(), 'a/b');
        expect(DataPath('').toString(), '');
      });

      test('equality works correctly', () {
        final path1 = DataPath('/a/b');
        final path2 = DataPath('/a/b');
        final path3 = DataPath('a/b');
        final path4 = DataPath('/a/c');

        expect(path1, path2);
        expect(path1, isNot(path3));
        expect(path1, isNot(path4));
      });

      test('hashCode is consistent', () {
        expect(DataPath('/a/b').hashCode, DataPath('/a/b').hashCode);
        expect(DataPath('/a/b').hashCode, isNot(DataPath('a/b').hashCode));
      });
    });
  });
}
