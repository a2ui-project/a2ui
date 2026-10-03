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
import 'dart:io';

import 'package:a2ui_flutter/a2ui_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test_infra/message_builders.dart';

class _FakeHttpClient extends Fake implements HttpClient {
  @override
  bool autoUncompress = true;

  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    throw const SocketException('Failed to connect');
  }
}

void main() {
  testWidgets('Image widget handles network error gracefully', (
    WidgetTester tester,
  ) async {
    debugNetworkImageHttpClientProvider = _FakeHttpClient.new;
    try {
      await HttpOverrides.runZoned(() async {
        final surfaceController = SurfaceController(
          catalogs: [
            Catalog([BasicCatalogItems.image], catalogId: 'test_catalog'),
          ],
        );
        const surfaceId = 'testSurface';
        final List<JsonMap> components = [
          component(
            id: 'root',
            type: 'Image',
            properties: {'url': 'https://example.com/nonexistent.png'},
          ),
        ];
        surfaceController.handleMessage(
          updateComponents(surfaceId: surfaceId, components: components),
        );
        surfaceController.handleMessage(
          createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
        );

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Surface(
                surfaceContext: surfaceController.contextFor(surfaceId),
              ),
            ),
          ),
        );

        // Pump to allow image loading to fail
        await tester.pump();
        await tester.pump();

        // We expect the check that the image failed and is showing the broken
        // image icon.
        expect(find.byType(Image), findsOneWidget);
        expect(find.byIcon(Icons.broken_image), findsOneWidget);
      });
    } finally {
      debugNetworkImageHttpClientProvider = null;
    }
  });

  testWidgets('Image widget loads successfully from network', (
    WidgetTester tester,
  ) async {
    debugNetworkImageHttpClientProvider = _FakeSuccessHttpClient.new;
    try {
      await HttpOverrides.runZoned(() async {
        final surfaceController = SurfaceController(
          catalogs: [
            Catalog([BasicCatalogItems.image], catalogId: 'test_catalog'),
          ],
        );
        const surfaceId = 'testSurface';
        final List<JsonMap> components = [
          component(
            id: 'root',
            type: 'Image',
            properties: {'url': 'https://example.com/image.png'},
          ),
        ];
        surfaceController.handleMessage(
          updateComponents(surfaceId: surfaceId, components: components),
        );
        surfaceController.handleMessage(
          createSurface(surfaceId: surfaceId, catalogId: 'test_catalog'),
        );

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Surface(
                surfaceContext: surfaceController.contextFor(surfaceId),
              ),
            ),
          ),
        );

        // Verify Image widget is present
        expect(find.byType(Image), findsOneWidget);
        // We can't easily verify the pixels without comprehensive mocking of
        // HttpClientResponse but we can verify no error icon.
        expect(find.byIcon(Icons.broken_image), findsNothing);
      });
    } finally {
      debugNetworkImageHttpClientProvider = null;
    }
  });
}

class _FakeSuccessHttpClient extends Fake implements HttpClient {
  @override
  bool autoUncompress = true;

  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    return _FakeHttpClientRequest();
  }
}

class _FakeHttpClientRequest extends Fake implements HttpClientRequest {
  @override
  Future<HttpClientResponse> close() async {
    return _FakeHttpClientResponse();
  }
}

class _FakeHttpClientResponse extends Fake implements HttpClientResponse {
  @override
  int get statusCode => 200;

  @override
  int get contentLength => kTransparentImage.length;

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return Stream<List<int>>.fromIterable([kTransparentImage]).listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }
}

final List<int> kTransparentImage = <int>[
  0x89,
  0x50,
  0x4E,
  0x47,
  0x0D,
  0x0A,
  0x1A,
  0x0A,
  0x00,
  0x00,
  0x00,
  0x0D,
  0x49,
  0x48,
  0x44,
  0x52,
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
  0x1F,
  0x15,
  0xC4,
  0x89,
  0x00,
  0x00,
  0x00,
  0x0A,
  0x49,
  0x44,
  0x41,
  0x54,
  0x78,
  0x9C,
  0x63,
  0x00,
  0x01,
  0x00,
  0x00,
  0x05,
  0x00,
  0x01,
  0x0D,
  0x0A,
  0x2D,
  0xB4,
  0x00,
  0x00,
  0x00,
  0x00,
  0x49,
  0x45,
  0x4E,
  0x44,
  0xAE,
  0x42,
  0x60,
  0x82,
];
