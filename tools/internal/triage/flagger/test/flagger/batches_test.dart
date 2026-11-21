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

import 'package:flagger/flagger.dart';
import 'package:test/test.dart';

void main() {
  test('inBatches runs at most batchSize tasks at a time, in order', () async {
    var running = 0;
    var mostRunning = 0;
    final List<int> results = await inBatches(
      List.generate(batchSize * 2 + 3, (i) => i),
      (int value) async {
        running += 1;
        mostRunning = running > mostRunning ? running : mostRunning;
        await Future<void>.delayed(Duration.zero);
        running -= 1;
        return value * 2;
      },
    );
    expect(results, List.generate(batchSize * 2 + 3, (i) => i * 2));
    expect(mostRunning, batchSize);
  });
}
