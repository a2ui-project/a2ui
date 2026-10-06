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
  group('ValidationResult.validityOf', () {
    test('reads a ValidationResult', () {
      expect(
        ValidationResult.validityOf(const ValidationResult(valid: true)),
        isTrue,
      );
      expect(
        ValidationResult.validityOf(
          const ValidationResult(valid: false, message: 'no'),
        ),
        isFalse,
      );
    });

    test('reads a map carrying a valid key', () {
      expect(ValidationResult.validityOf({'valid': true}), isTrue);
      expect(ValidationResult.validityOf({'valid': false}), isFalse);
      expect(
        ValidationResult.validityOf({'valid': false, 'message': 'no'}),
        isFalse,
      );
    });

    test('a non-boolean valid value reads as invalid', () {
      expect(ValidationResult.validityOf({'valid': 'yes'}), isFalse);
      expect(ValidationResult.validityOf({'valid': 1}), isFalse);
      expect(ValidationResult.validityOf({'valid': null}), isFalse);
    });

    test('returns null for anything that is not a validation result', () {
      for (final value in <Object?>[
        null,
        true,
        false,
        0,
        1,
        '',
        'x',
        <Object?>[],
        <String, Object?>{},
        <String, Object?>{'other': 1},
        <String, Object?>{'message': 'no valid key'},
      ]) {
        expect(
          ValidationResult.validityOf(value),
          isNull,
          reason: 'validityOf($value)',
        );
      }
    });

    test('agrees with fromEvaluation wherever it is non-null', () {
      for (final value in <Object?>[
        const ValidationResult(valid: true),
        const ValidationResult(valid: false),
        <String, Object?>{'valid': true},
        <String, Object?>{'valid': false},
        <String, Object?>{'valid': 'yes'},
      ]) {
        expect(
          ValidationResult.fromEvaluation(value).valid,
          ValidationResult.validityOf(value),
          reason: 'fromEvaluation($value)',
        );
      }
    });
  });
}
