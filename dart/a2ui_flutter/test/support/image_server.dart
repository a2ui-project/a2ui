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
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A 200x100 PNG.
final List<int> widePng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAAAzElEQVR42u3SMQ0AAAgEsZeG'
  'NKQhDRMMDE2q4HKpHjgXCTAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgL'
  'Y2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWx'
  'wFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNh'
  'LIyFsVTAWBgLY4GxMBbGAmNhLIwFxuK3BWi4NtwwvEDyAAAAAElFTkSuQmCC',
);

/// A 100x200 PNG.
final List<int> tallPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAADICAIAAACRXtOWAAABJElEQVR42u3QAQ0AAAgDoEcz'
  'mtGMZoUHYCMBmT1KUSBLlixZsmQpkCVLlixZshTIkiVLlixZCmTJkiVLliwFsmTJkiVLlgJZ'
  'smTJkiVLgSxZsmTJkqVAlixZsmTJUiBLlixZsmQpkCVLlixZshTIkiVLlixZCmTJkiVLliwF'
  'smTJkiVLlgJZsmTJkiVLgSxZsmTJkqVAlixZsmTJUiBLlixZsmQpkCVLlixZshTIkiVLlixZ'
  'CmTJkiVLliwFsmTJkiVLlgJZsmTJkiVLgSxZsmTJkqVAlixZsmTJUiBLlixZsmQpkCVLlixZ'
  'shTIkiVLlixZCmTJkiVLliwFsmTJkiVLlgJZsmTJkiVLgSxZsmTJkqVAlixZsmTJUiBLlixZ'
  'smQp6D0ghzbc8MyoZQAAAABJRU5ErkJggg==',
);

/// Serves [images] by URL, [fallback] for any other URL, and 404 when there
/// is no fallback.
class ImageServer extends Fake implements HttpClient {
  ImageServer(this.images, {this.fallback});

  final Map<String, List<int>> images;

  final List<int>? fallback;

  /// Every URL requested, in order.
  final List<String> requested = [];

  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    requested.add('$url');
    return _Request(images['$url'] ?? fallback);
  }
}

class _Request extends Fake implements HttpClientRequest {
  _Request(this._body);

  final List<int>? _body;

  @override
  Future<HttpClientResponse> close() async => _Response(_body);
}

class _Response extends Fake implements HttpClientResponse {
  _Response(this._body);

  final List<int>? _body;

  @override
  int get statusCode => _body == null ? HttpStatus.notFound : HttpStatus.ok;

  @override
  int get contentLength => _body?.length ?? 0;

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => Stream<List<int>>.fromIterable([?_body]).listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );

  @override
  Future<E> drain<E>([E? futureValue]) async => futureValue as E;
}

/// Runs [body] with network images served by [server] and an empty image
/// cache.
Future<void> withImageServer(
  ImageServer server,
  Future<void> Function() body,
) async {
  imageCache
    ..clear()
    ..clearLiveImages();
  debugNetworkImageHttpClientProvider = () => server;
  try {
    await body();
  } finally {
    debugNetworkImageHttpClientProvider = null;
  }
}

/// Waits for every [Image] on screen to load or fail, then pumps a frame.
Future<void> settleImages(WidgetTester tester) async {
  await tester.runAsync(() async {
    for (final Element element in find.byType(Image).evaluate()) {
      await precacheImage(
        (element.widget as Image).image,
        element,
        onError: (error, stackTrace) {},
      );
    }
  });
  await tester.pump();
}
