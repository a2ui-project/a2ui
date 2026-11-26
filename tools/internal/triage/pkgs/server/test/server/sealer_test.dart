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

import 'package:server/server.dart';
import 'package:test/test.dart';

void main() {
  final List<int> key = List.filled(32, 1);
  var now = DateTime(2026, 11, 21);
  final sealer = Sealer(key, now: () => now);

  setUp(() => now = DateTime(2026, 11, 21));

  test('opens what it sealed', () async {
    final String sealed = await sealer.seal('session', {
      'token': 't',
    }, maxAge: const Duration(minutes: 1));
    expect(sealed, isNot(contains('t"')));
    expect(await sealer.open('session', sealed), {'token': 't'});
  });

  test('does not open a value sealed for another purpose', () async {
    final String sealed = await sealer.seal('sign_in', {
      'state': 's',
    }, maxAge: const Duration(minutes: 1));
    expect(await sealer.open('session', sealed), isNull);
  });

  test('does not open an expired value', () async {
    final String sealed = await sealer.seal('session', {
      'token': 't',
    }, maxAge: const Duration(minutes: 1));
    now = now.add(const Duration(minutes: 2));
    expect(await sealer.open('session', sealed), isNull);
  });

  test('does not open a value sealed with another key', () async {
    final String sealed = await Sealer(
      List.filled(32, 2),
    ).seal('session', {'token': 't'}, maxAge: const Duration(minutes: 1));
    expect(await sealer.open('session', sealed), isNull);
  });

  test('does not open a malformed value', () async {
    expect(await sealer.open('session', 'not base64!'), isNull);
    expect(await sealer.open('session', 'c2hvcnQ'), isNull);
  });
}
