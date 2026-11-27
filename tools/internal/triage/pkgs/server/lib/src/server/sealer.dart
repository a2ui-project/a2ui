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

import 'package:cryptography/cryptography.dart';

/// Encrypts small JSON values into strings that only this server can read,
/// for the cookies.
///
/// Uses AES-256-GCM, so a changed value fails to open. Each value has a
/// purpose, such as `session`, so that a value sealed for one purpose does not
/// open for another, and an expiry time.
final class Sealer {
  Sealer(List<int> key, {DateTime Function()? now})
    : _key = SecretKey(key),
      _now = now ?? DateTime.now;

  static const int _nonceLength = 12;
  static const int _macLength = 16;

  final SecretKey _key;
  final DateTime Function() _now;
  final AesGcm _algorithm = AesGcm.with256bits();

  /// Encrypts [value] for [purpose], to open until [maxAge] from now.
  Future<String> seal(
    String purpose,
    Map<String, Object?> value, {
    required Duration maxAge,
  }) async {
    final int expires = _now().add(maxAge).millisecondsSinceEpoch;
    final SecretBox box = await _algorithm.encrypt(
      utf8.encode(jsonEncode({'v': value, 'exp': expires})),
      secretKey: _key,
      aad: utf8.encode(purpose),
    );
    return base64Url.encode(box.concatenation()).replaceAll('=', '');
  }

  /// Decrypts a value that [seal] encrypted for [purpose], or returns null if
  /// it was sealed for another purpose or with another key, was changed, or
  /// expired.
  Future<Map<String, Object?>?> open(String purpose, String sealed) async {
    final List<int> bytes;
    try {
      bytes = base64Url.decode(base64Url.normalize(sealed));
    } on FormatException {
      return null;
    }
    if (bytes.length < _nonceLength + _macLength) return null;

    final List<int> clear;
    try {
      clear = await _algorithm.decrypt(
        SecretBox.fromConcatenation(
          bytes,
          nonceLength: _nonceLength,
          macLength: _macLength,
        ),
        secretKey: _key,
        aad: utf8.encode(purpose),
      );
      // The cryptography package reports a wrong key or a changed value only
      // with an Error.
      // ignore: avoid_catching_errors
    } on SecretBoxAuthenticationError {
      return null;
    }

    return switch (jsonDecode(utf8.decode(clear))) {
      {'v': final Map<String, Object?> value, 'exp': final int expires}
          when _now().millisecondsSinceEpoch < expires =>
        value,
      _ => null,
    };
  }
}
