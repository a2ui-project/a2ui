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

import 'github_item.dart';

/// Receives the items that `tools/internal/triage_new/triage_ui.sh` sends to the
/// running app.
///
/// Listens on 127.0.0.1 and accepts `POST /open` with the URL of an item in
/// the `item` form field. See
/// `tools/internal/triage_new/blueprints/features/advisor.blueprint.md`.
final class ItemServer {
  ItemServer._(this._server);

  /// The port that `triage_ui.sh` sends items to.
  static const int defaultPort = 47123;

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
    server.listen((HttpRequest request) => _handle(request, onItem));
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
  if (request.uri.path != '/open') {
    response.statusCode = HttpStatus.notFound;
  } else if (request.method != 'POST') {
    response.statusCode = HttpStatus.methodNotAllowed;
  } else {
    final GitHubItem? item = _parseItem(await utf8.decodeStream(request));
    if (item == null) {
      response.statusCode = HttpStatus.badRequest;
      response.write(
        'Expected item=<URL of an issue or a pull request in '
        'a2ui-project/a2ui>.',
      );
    } else {
      onItem(item);
    }
  }
  await response.close();
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
