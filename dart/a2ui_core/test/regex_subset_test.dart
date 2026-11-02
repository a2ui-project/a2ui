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
  group('A2UI portable regex subset — grammar & parser', () {
    test('parses valid portable subset constructs', () {
      const validPatterns = <String>[
        '',
        'abc',
        '^abc\$',
        r'\bword\B',
        'a|b|c',
        '(abc)',
        '(?:abc)',
        '(?=abc)abc',
        '(?!abc)def',
        'a*b+c?d{2}e{2,}f{2,5}',
        'a*?b+?c??d{2,5}?',
        '[a-zA-Z0-9_-]',
        '[^0-9]',
        r'[\d\w\s\D\W\S]',
        r'\t\n\r\f\v',
        r'\^\$\\\.\*\+\?\(\)\[\]\{\}\|\/\-',
        r'\x41\u0042\u{43}\u{1F600}',
        '[-a]',
        '[a-]',
        r'[\-a]',
        '.',
      ];
      for (final pattern in validPatterns) {
        final RegexAnalysisResult res = analyzeRegex(pattern);
        expect(res.ok, isTrue, reason: 'Expected valid: $pattern');
        expect(res.ast, isNotNull);
      }
    });

    test('rejects unsupported syntax with UNSUPPORTED_SYNTAX', () {
      const invalidPatterns = <String>[
        r'(a)\1',
        r'\1',
        r'(?<name>a)',
        r'(?<=a)b',
        r'(?<!a)b',
        r'(?i)abc',
        r'(?i:abc)',
        r'(?>abc)',
        r'a*+',
        r'a++',
        r'a?+',
        r'a{2,3}+',
        r'\p{L}',
        r'\P{N}',
        r'\k<name>',
        r'\A',
        r'\Z',
        r'\z',
        r'\a',
        r'\e',
        r'\cA',
        r'\0',
        r'[[:alpha:]]',
        r'[a&&b]',
        r'[a[b]]',
        r'[]',
        r'[^]',
        r'[z-a]',
        r'[\d-z]',
        r'[a-\d]',
        r'a{257}',
        r'a{1,257}',
        r'a{5,3}',
        r'a{}',
        r'a{,3}',
        r'{2}',
        r'*',
        r'+',
        r'?',
        r'^*',
        r'(?=a)+',
        r'(abc',
        r'abc)',
        r'[abc',
        r'abc]',
        r'abc}',
        '\\',
        r'\x4',
        r'\xGG',
        r'\u004',
        r'\uD800',
        r'\u{D800}',
        r'\u{110000}',
        r'\u{}',
      ];
      for (final pattern in invalidPatterns) {
        final RegexAnalysisResult res = analyzeRegex(pattern);
        expect(res.ok, isFalse, reason: 'Expected rejected: $pattern');
        expect(res.reason, RegexRejection.unsupportedSyntax);
        expect(
          () => compileGuarded(pattern),
          throwsA(
            isA<A2uiExpressionError>().having(
              (e) => e.message,
              'message',
              contains('UNSUPPORTED_SYNTAX'),
            ),
          ),
        );
      }
    });
  });

  group('A2UI portable regex subset — static safety guard (Rules 1-4)', () {
    test('Rule 1: enforces 256 code-point limit (counting astral as 1)', () {
      expect(analyzeRegex('a' * 256).ok, isTrue);
      final RegexAnalysisResult tooLong = analyzeRegex('a' * 257);
      expect(tooLong.ok, isFalse);
      expect(tooLong.reason, RegexRejection.patternTooLong);

      final String emoji256 = '😀' * 256;
      expect(countCodePoints(emoji256), 256);
      expect(analyzeRegex(emoji256).ok, isTrue);

      final String emoji257 = '😀' * 257;
      final RegexAnalysisResult tooLongEmoji = analyzeRegex(emoji257);
      expect(tooLongEmoji.ok, isFalse);
      expect(tooLongEmoji.reason, RegexRejection.patternTooLong);
    });

    test('Rule 2: rejects nested quantifiers with NESTED_QUANTIFIER', () {
      const evilNested = <String>[
        '(a+)+',
        '(a*)*',
        '(a+)*',
        '(a*){2,5}',
        '(?:a+){2}',
        '([a-z]*)*',
        '(a|b+)+',
        '((?:a+))+',
        r'(\d+){2,}',
      ];
      for (final pattern in evilNested) {
        final RegexAnalysisResult res = analyzeRegex(pattern);
        expect(res.ok, isFalse, reason: 'Expected rejected: $pattern');
        expect(res.reason, RegexRejection.nestedQuantifier);
      }

      const safeQuantifiers = <String>[
        '(?:ab+)?c',
        '(a+){0,1}',
        r'(\d{1,3}){1,4}',
        '(a{1,2})+',
      ];
      for (final pattern in safeQuantifiers) {
        expect(analyzeRegex(pattern).ok, isTrue, reason: pattern);
      }
    });

    test(
      'Rule 3: rejects overlapping alternation inside repetition with '
      'OVERLAPPING_ALTERNATION',
      () {
        const evilAlt = <String>[
          '(a|ab)+',
          '(a|ab)*c',
          r'(\d|[0-5])+',
          r'(\w|\d)+',
          '([a-m]|[g-z])*',
        ];
        for (final pattern in evilAlt) {
          final RegexAnalysisResult res = analyzeRegex(pattern);
          expect(res.ok, isFalse, reason: 'Expected rejected: $pattern');
          expect(res.reason, RegexRejection.overlappingAlternation);
        }

        const safeAlt = <String>[
          '(a|b)*c',
          '(cat|dog)+',
          '(a|ab)',
          '(a|ab)?',
          r'(\d|[a-f])+',
        ];
        for (final pattern in safeAlt) {
          expect(analyzeRegex(pattern).ok, isTrue, reason: pattern);
        }
      },
    );

    test(
      'Rule 4: rejects adjacent unbounded quantifiers with overlapping sets '
      'with ADJACENT_OVERLAP',
      () {
        const evilAdj = <String>[
          r'\d+\d+',
          '.*.*',
          r'\d+\s*\d+',
          r'\w+\d+',
          'a+a+',
          '.*a*.*',
          r'\s*.*',
          r'(\d+)(\d+)',
          r'\d+\b\d+',
        ];
        for (final pattern in evilAdj) {
          final RegexAnalysisResult res = analyzeRegex(pattern);
          expect(res.ok, isFalse, reason: 'Expected rejected: $pattern');
          expect(res.reason, RegexRejection.adjacentOverlap);
        }

        const safeAdj = <String>[
          r'^\d+-\d+$',
          r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
          r'\d+[a-z]+\d+',
          r'\d{1,3}\d+',
        ];
        for (final pattern in safeAdj) {
          expect(analyzeRegex(pattern).ok, isTrue, reason: pattern);
        }
      },
    );
  });

  group('compileGuarded — Unicode semantics and LRU cache', () {
    test('compiles with Unicode mode so astral code points match as one', () {
      final RegExp re = compileGuarded('^.\$');
      expect(re.isUnicode, isTrue);
      expect(re.hasMatch('😀'), isTrue);
      expect(re.hasMatch('a\n'), isFalse);
    });

    test('returns cached RegExp on repeated compilation', () {
      final RegExp r1 = compileGuarded(r'^\d{3}-\d{2}-\d{4}$');
      final RegExp r2 = compileGuarded(r'^\d{3}-\d{2}-\d{4}$');
      expect(identical(r1, r2), isTrue);
    });
  });
}
