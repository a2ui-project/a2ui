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
  group('UAX #31 identifier validation', () {
    test('accepts standard ASCII identifiers and leading underscore', () {
      expect(isValidUax31Identifier('Button'), isTrue);
      expect(isValidUax31Identifier('my_component_1'), isTrue);
      expect(isValidUax31Identifier('_private'), isTrue);
      expect(isValidUax31Identifier('_'), isTrue);
      expect(isValidUax31Identifier('class'), isTrue);
    });

    test('accepts valid non-ASCII Unicode XID identifiers', () {
      expect(isValidUax31Identifier('Component_ℓ'), isTrue);
      expect(isValidUax31Identifier('Δelta'), isTrue);
      expect(isValidUax31Identifier('café'), isTrue);
      expect(isValidUax31Identifier('변수'), isTrue);
      expect(isValidUax31Identifier('alpha_α'), isTrue);
    });

    test('handles leading @ according to allowLeadingAt', () {
      expect(isValidUax31Identifier('@index'), isFalse);
      expect(isValidUax31Identifier('@_sys'), isFalse);
      expect(isValidUax31Identifier('@index', allowLeadingAt: true), isTrue);
      expect(isValidUax31Identifier('@_sys', allowLeadingAt: true), isTrue);
      expect(isValidUax31Identifier('@', allowLeadingAt: true), isFalse);
      expect(isValidUax31Identifier('@@x', allowLeadingAt: true), isFalse);
      expect(isValidUax31Identifier('@@index', allowLeadingAt: true), isFalse);
    });

    test('rejects empty strings, leading digits, hyphens, dashes, and spaces',
        () {
      expect(isValidUax31Identifier(''), isFalse);
      expect(isValidUax31Identifier('1abc'), isFalse);
      expect(isValidUax31Identifier('123invalid'), isFalse);
      expect(isValidUax31Identifier('a-b'), isFalse);
      expect(isValidUax31Identifier('my-component'), isFalse);
      expect(isValidUax31Identifier('a–b'), isFalse); // En dash (U+2013)
      expect(isValidUax31Identifier('Component–Name'), isFalse);
      expect(isValidUax31Identifier('prop—name'), isFalse); // Em dash (U+2014)
      expect(isValidUax31Identifier('func֊name'), isFalse); // Armenian hyphen
      expect(isValidUax31Identifier('has space'), isFalse);
      expect(isValidUax31Identifier('prop!'), isFalse);
      expect(isValidUax31Identifier('foo.bar'), isFalse);
    });

    test('assertUax31Identifier throws on invalid identifiers', () {
      expect(
        () => assertUax31Identifier('ValidName'),
        returnsNormally,
      );
      expect(
        () => assertUax31Identifier('@index', allowLeadingAt: true),
        returnsNormally,
      );
      expect(
        () => assertUax31Identifier('@index'),
        throwsA(isA<A2uiCatalogError>()),
      );
      expect(
        () => assertUax31Identifier(
          'bad-name',
          context: "component identifier: 'bad-name'",
        ),
        throwsA(
          isA<A2uiCatalogError>().having(
            (e) => e.message,
            'message',
            "Invalid UAX #31 component identifier: 'bad-name'",
          ),
        ),
      );
    });
  });
}
