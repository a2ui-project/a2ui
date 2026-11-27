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

/// What the web app needs from the browser, so that tests can replace it.
abstract interface class Browser {
  /// The token that the triager pasted earlier, when the app runs without
  /// the server.
  String? readToken();

  /// Stores the pasted [token], or forgets it when null.
  void writeToken(String? token);

  /// Opens [url] in the page, leaving the app.
  void go(Uri url);

  /// Loads the page again.
  void reload();
}

/// A browser that keeps the token in memory, where the app cannot leave the
/// page, as in tests and outside the web.
final class MemoryBrowser implements Browser {
  MemoryBrowser({this.token});

  String? token;

  /// The URLs that [go] opened.
  final List<Uri> opened = [];

  /// How many times [reload] was called.
  int reloads = 0;

  @override
  String? readToken() => token;

  @override
  void writeToken(String? token) => this.token = token;

  @override
  void go(Uri url) => opened.add(url);

  @override
  void reload() => reloads++;
}
