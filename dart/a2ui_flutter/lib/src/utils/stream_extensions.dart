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

import 'dart:async';
import 'package:stream_transform/stream_transform.dart';

/// Extensions for [Iterable] of [Stream]s.
extension CombineLatestAll<T> on Iterable<Stream<T>> {
  /// Combines all streams in this iterable into a single stream that emits a
  /// list of the latest values from each stream.
  ///
  /// The resulting stream will not emit until every stream in the iterable has
  /// emitted at least one value.
  Stream<List<T>> combineLatestAll() {
    if (isEmpty) return Stream.value([]);

    return first.combineLatestAll(skip(1));
  }
}

/// Extensions for [Stream].
extension SwitchMapExtension<T> on Stream<T> {
  /// Maps each event to a new stream, and switches to emitting events from
  /// the most recent inner stream.
  Stream<R> switchMap<R>(Stream<R> Function(T) convert) {
    late StreamController<R> controller;
    StreamSubscription<T>? outerSubscription;
    StreamSubscription<R>? innerSubscription;

    void cancelInner() {
      innerSubscription?.cancel();
      innerSubscription = null;
    }

    controller = StreamController<R>(
      sync: true,
      onListen: () {
        outerSubscription = listen(
          (event) {
            cancelInner();
            final Stream<R> innerStream = convert(event);
            innerSubscription = innerStream.listen(
              (innerEvent) => controller.add(innerEvent),
              onError: (Object error, StackTrace? stackTrace) =>
                  controller.addError(error, stackTrace),
              onDone: () {
                innerSubscription = null;
                if (outerSubscription == null) {
                  controller.close();
                }
              },
            );
          },
          onError: (Object error, StackTrace? stackTrace) =>
              controller.addError(error, stackTrace),
          onDone: () {
            outerSubscription = null;
            if (innerSubscription == null) {
              controller.close();
            }
          },
        );
      },
      onPause: () {
        outerSubscription?.pause();
        innerSubscription?.pause();
      },
      onResume: () {
        outerSubscription?.resume();
        innerSubscription?.resume();
      },
      onCancel: () {
        cancelInner();
        outerSubscription?.cancel();
        outerSubscription = null;
      },
    );

    return controller.stream;
  }
}
