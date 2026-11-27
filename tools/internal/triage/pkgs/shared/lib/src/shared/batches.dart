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

/// The most calls in flight at a time. It keeps a run fast without tripping
/// GitHub's secondary rate limits, which one call per item at once can hit.
const int batchSize = 10;

/// Runs [task] on each of [values], [batchSize] at a time, and returns the
/// results in order.
Future<List<R>> inBatches<T, R>(
  List<T> values,
  Future<R> Function(T value) task,
) async {
  final results = <R>[];
  for (var i = 0; i < values.length; i += batchSize) {
    final Iterable<T> batch = values.skip(i).take(batchSize);
    results.addAll(await Future.wait(batch.map(task)));
  }
  return results;
}
