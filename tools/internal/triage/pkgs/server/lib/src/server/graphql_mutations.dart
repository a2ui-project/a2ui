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

/// The fields that the mutations in [document], a GraphQL document, select
/// at their top level, such as `closeIssue`. Empty if [document] has only
/// queries.
///
/// Returns null when the fields cannot be told for sure: [document] does
/// not tokenize, has a subscription, or spreads a fragment at the top level
/// of a mutation.
Set<String>? mutationFields(String document) {
  final List<String>? tokens = _tokenize(document);
  if (tokens == null) return null;
  final fields = <String>{};
  var depth = 0;
  for (var i = 0; i < tokens.length; i++) {
    final String token = tokens[i];
    if (depth == 0 && token == 'subscription') return null;
    if (depth == 0 && token == 'mutation') {
      // Skip the name, the variables and the directives.
      var parens = 0;
      while (i < tokens.length && !(parens == 0 && tokens[i] == '{')) {
        if (tokens[i] == '(') parens++;
        if (tokens[i] == ')') parens--;
        i++;
      }
      if (i == tokens.length) return null;
      depth = 1;
      for (i++; i < tokens.length && depth > 0; i++) {
        final String t = tokens[i];
        switch (t) {
          case '{':
            depth++;
          case '}':
            depth--;
          case '(':
            parens++;
          case ')':
            parens--;
        }
        if (depth != 1 || parens != 0) continue;
        if (t == '...') return null;
        final bool isAlias = i + 1 < tokens.length && tokens[i + 1] == ':';
        final isDirective = tokens[i - 1] == '@';
        if (_name.hasMatch(t) && !isAlias && !isDirective) fields.add(t);
      }
      i--;
      continue;
    }
    if (token == '{') depth++;
    if (token == '}') depth--;
  }
  return fields;
}

final RegExp _name = RegExp(r'^[_A-Za-z][_0-9A-Za-z]*$');

/// GraphQL's tokens, and the whitespace, commas and comments between them,
/// which start with one of `\s`, `,`, `#` or the byte order mark.
final RegExp _token = RegExp(
  r'"""[\s\S]*?(?<!\\)"""'
  r'|"(?:\\.|[^"\\\n\r])*"'
  r'|#[^\n\r]*'
  r'|[\s,﻿]+'
  r'|\.\.\.'
  r'|[_A-Za-z][_0-9A-Za-z]*'
  r'|-?\d[\d.eE+\-]*'
  r'|[!$&()\[\]{}:=@|]',
);

List<String>? _tokenize(String document) {
  final tokens = <String>[];
  var position = 0;
  while (position < document.length) {
    final Match? match = _token.matchAsPrefix(document, position);
    if (match == null || match.end == position) return null;
    final String token = match[0]!;
    if (!RegExp(r'^[\s,#﻿]').hasMatch(token)) tokens.add(token);
    position = match.end;
  }
  return tokens;
}
