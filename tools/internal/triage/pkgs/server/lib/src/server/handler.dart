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

import 'package:http/http.dart' as http;
import 'package:shelf/shelf.dart';
import 'package:shelf_static/shelf_static.dart';

import 'auth.dart';
import 'config.dart';
import 'cookies.dart';
import 'github_proxy.dart';
import 'sealer.dart';

/// The server's request handler: `/auth/` signs the triager in, `/github/`
/// passes GitHub API calls through, `/healthz` says the server is up, and
/// every other path is a file of the web app.
Handler createHandler(
  ServerConfig config, {
  http.Client? httpClient,
  void Function(String message)? log,
}) {
  final http.Client client = httpClient ?? http.Client();
  final cookies = Cookies(config, Sealer(config.sessionKey));
  final auth = Auth(config, cookies, client);
  final proxy = GitHubProxy(config, cookies, client);
  final Handler files = createStaticHandler(
    config.webDir,
    defaultDocument: 'index.html',
  );

  Future<Response> route(Request request) async {
    final String path = request.url.path;
    if (path == 'healthz') return Response.ok('ok');
    if (path.startsWith('auth/')) return auth.handle(request);
    if (path == 'github' || path.startsWith('github/')) {
      return proxy.handle(request);
    }
    if (request.method != 'GET' && request.method != 'HEAD') {
      return Response(405, body: 'Method not allowed.');
    }
    // The browser checks with the server before it uses a cached file, so
    // that a new deployment shows up on the next reload.
    return (await files(
      request,
    )).change(headers: {'cache-control': 'no-cache'});
  }

  return const Pipeline()
      .addMiddleware(_logRequests(log ?? (_) {}))
      .addHandler(route);
}

/// Logs the method, path and status of each request. Does not log the query,
/// which holds the OAuth code on `/auth/callback`.
Middleware _logRequests(void Function(String message) log) =>
    (Handler inner) => (Request request) async {
      final Response response = await inner(request);
      log('${request.method} /${request.url.path} ${response.statusCode}');
      return response;
    };
