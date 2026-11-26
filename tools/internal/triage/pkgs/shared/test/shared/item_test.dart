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

import 'package:shared/shared.dart';
import 'package:test/test.dart';

void main() {
  group('isBot', () {
    test('detects bots by account type and login suffix', () {
      expect(isBot(const User(type: 'Bot', login: 'whatever')), isTrue);
      expect(
        isBot(const User(type: 'User', login: 'github-actions[bot]')),
        isTrue,
      );
    });

    test('treats real users and deleted accounts as human', () {
      expect(isBot(const User(type: 'User', login: 'alice')), isFalse);
      expect(isBot(null), isFalse);
    });
  });
}
