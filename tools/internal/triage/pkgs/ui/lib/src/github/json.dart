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

/// Reads values from the JSON that GitHub returns.
library;

Map<String, Object?> asMap(Object? value) => value! as Map<String, Object?>;

List<Object?> asList(Object? value) => value! as List<Object?>;

/// The non-null nodes of a GraphQL connection.
List<Map<String, Object?>> nodesOf(Object? connection) => [
  for (final Object? node in asList(asMap(connection)['nodes']))
    if (node != null) asMap(node),
];

DateTime? dateOf(Object? value) =>
    value == null ? null : DateTime.parse(value as String);

/// The login of an `author` or a user, or null for a deleted account.
String? loginOf(Object? user) =>
    user == null ? null : asMap(user)['login'] as String?;
