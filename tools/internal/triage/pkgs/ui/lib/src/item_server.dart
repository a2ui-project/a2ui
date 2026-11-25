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
import 'dart:typed_data';

import 'model/github_item.dart';

/// Receives the items that `tools/internal/triage/triage_ui.sh` sends to the
/// running app.
///
/// Listens on 127.0.0.1 and accepts `POST /open` with the URL of an item in
/// the `item` form field. See
/// `blueprints/features/triage_bot/analysis.blueprint.md`.
///
/// It refuses requests from web pages, which browsers mark with `Origin` or
/// `Sec-Fetch-Site`, so that no page can switch the item the triager is
/// about to apply.
final class ItemServer {
  ItemServer._(this._server);

  /// The port that `triage_ui.sh` sends items to.
  static const int defaultPort = 47123;

  /// The longest body it reads, far more than an item's URL needs.
  static const int maxBodyBytes = 4096;

  /// Starts listening, and calls [onItem] for each item received.
  ///
  /// Throws a [SocketException] if the port is in use, for example by another
  /// copy of the app.
  static Future<ItemServer> start({
    required void Function(GitHubItem item) onItem,
    int port = defaultPort,
  }) async {
    final HttpServer server = await HttpServer.bind(
      InternetAddress.loopbackIPv4,
      port,
    );
    server.listen((HttpRequest request) => unawaited(_handle(request, onItem)));
    return ItemServer._(server);
  }

  final HttpServer _server;

  /// The port the server listens on.
  int get port => _server.port;

  Future<void> close() => _server.close(force: true);
}

Future<void> _handle(
  HttpRequest request,
  void Function(GitHubItem item) onItem,
) async {
  final HttpResponse response = request.response;
  try {
    if (request.headers.value('origin') != null ||
        request.headers.value('sec-fetch-site') != null) {
      response.statusCode = HttpStatus.forbidden;
    } else if (request.uri.path != '/open') {
      response.statusCode = HttpStatus.notFound;
    } else if (request.method != 'POST') {
      response.statusCode = HttpStatus.methodNotAllowed;
    } else if (await _readBody(request) case final String body) {
      final GitHubItem? item = _parseItem(body);
      if (item == null) {
        response.statusCode = HttpStatus.badRequest;
        response.write(
          'Expected item=<URL of an issue or a pull request in '
          'a2ui-project/a2ui or flutter/genui>.',
        );
      } else {
        onItem(item);
      }
    } else {
      response.statusCode = HttpStatus.requestEntityTooLarge;
    }
  } on FormatException {
    response.statusCode = HttpStatus.badRequest;
  } on IOException {
    // The client went away; there is nobody to answer.
  } finally {
    try {
      await response.close();
    } on IOException {
      // The client went away.
    }
  }
}

/// The body of [request] as UTF-8, or null if it is longer than
/// [ItemServer.maxBodyBytes]. Throws a [FormatException] for invalid UTF-8.
Future<String?> _readBody(HttpRequest request) async {
  if (request.contentLength > ItemServer.maxBodyBytes) return null;
  final bytes = BytesBuilder(copy: false);
  await for (final List<int> chunk in request) {
    bytes.add(chunk);
    if (bytes.length > ItemServer.maxBodyBytes) return null;
  }
  return utf8.decode(bytes.takeBytes());
}

GitHubItem? _parseItem(String body) {
  final String? url;
  try {
    url = Uri.splitQueryString(body)['item'];
    // Dart reports malformed percent-encoding only with an ArgumentError.
    // ignore: avoid_catching_errors
  } on ArgumentError {
    return null;
  }
  return url == null ? null : GitHubItem.tryParse(url);
}
