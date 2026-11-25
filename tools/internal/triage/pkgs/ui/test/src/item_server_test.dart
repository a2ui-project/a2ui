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

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ui/src/item_server.dart';
import 'package:ui/src/model/github_item.dart';

void main() {
  late List<GitHubItem> received;
  late ItemServer server;
  late HttpClient client;

  setUp(() async {
    received = [];
    server = await ItemServer.start(onItem: received.add, port: 0);
    client = HttpClient();
  });

  tearDown(() async {
    client.close(force: true);
    await server.close();
  });

  Future<int> send(
    String method,
    String path,
    String body, {
    Map<String, String> headers = const {},
  }) async {
    final HttpClientRequest request = await client.open(
      method,
      '127.0.0.1',
      server.port,
      path,
    );
    request.headers.contentType = ContentType(
      'application',
      'x-www-form-urlencoded',
    );
    headers.forEach(request.headers.set);
    request.write(body);
    final HttpClientResponse response = await request.close();
    await response.drain<void>();
    return response.statusCode;
  }

  String form(String url) => 'item=${Uri.encodeQueryComponent(url)}';

  test('accepts an item', () async {
    final int status = await send(
      'POST',
      '/open',
      form('https://github.com/a2ui-project/a2ui/issues/1235'),
    );

    expect(status, HttpStatus.ok);
    expect(received.single.number, 1235);
  });

  test('rejects a URL that is not an a2ui item', () async {
    final int status = await send(
      'POST',
      '/open',
      form('https://example.com/issues/1'),
    );

    expect(status, HttpStatus.badRequest);
    expect(received, isEmpty);
  });

  test('rejects a body without an item', () async {
    expect(await send('POST', '/open', 'url=x'), HttpStatus.badRequest);
    expect(await send('POST', '/open', 'item=%zz'), HttpStatus.badRequest);
    expect(received, isEmpty);
  });

  test('rejects other paths and methods', () async {
    final String body = form('https://github.com/a2ui-project/a2ui/issues/1');

    expect(await send('POST', '/close', body), HttpStatus.notFound);
    expect(await send('GET', '/open', ''), HttpStatus.methodNotAllowed);
    expect(received, isEmpty);
  });

  test('refuses requests from web pages', () async {
    final String body = form('https://github.com/a2ui-project/a2ui/issues/1');

    expect(
      await send(
        'POST',
        '/open',
        body,
        headers: {'Origin': 'https://example.com'},
      ),
      HttpStatus.forbidden,
    );
    expect(
      await send(
        'POST',
        '/open',
        body,
        headers: {'Sec-Fetch-Site': 'cross-site'},
      ),
      HttpStatus.forbidden,
    );
    expect(received, isEmpty);
  });

  test('rejects a body that is too long or not UTF-8', () async {
    final String url = 'https://github.com/a2ui-project/a2ui/issues/1';
    expect(
      await send(
        'POST',
        '/open',
        '${form(url)}&pad=${'x' * ItemServer.maxBodyBytes}',
      ),
      HttpStatus.requestEntityTooLarge,
    );

    final HttpClientRequest request = await client.post(
      '127.0.0.1',
      server.port,
      '/open',
    );
    request.add([...utf8.encode('item='), 0xff, 0xfe]);
    final HttpClientResponse response = await request.close();
    await response.drain<void>();
    expect(response.statusCode, HttpStatus.badRequest);
    expect(received, isEmpty);

    // The server still answers.
    expect(await send('POST', '/open', form(url)), HttpStatus.ok);
  });

  test('fails to start on a port in use', () async {
    await expectLater(
      ItemServer.start(onItem: received.add, port: server.port),
      throwsA(isA<SocketException>()),
    );
  });

  test('decodes a body sent in several chunks', () async {
    final HttpClientRequest request = await client.post(
      '127.0.0.1',
      server.port,
      '/open',
    );
    for (final chunk in [
      'item=https%3A%2F%2Fgithub.com',
      '%2Fa2ui-project%2Fa2ui%2Fpull%2F7',
    ]) {
      request.add(utf8.encode(chunk));
    }
    final HttpClientResponse response = await request.close();
    await response.drain<void>();

    expect(response.statusCode, HttpStatus.ok);
    expect(received.single.isPullRequest, isTrue);
  });
}
