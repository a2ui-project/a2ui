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

/// Utilities for parsing JSON blocks from text, commonly used when extracting
/// structured data from LLM text responses.
class JsonBlockParser {
  /// Parses the first valid JSON object or array found in [text].
  ///
  /// This method looks for JSON patterns, handling:
  /// - Markdown code blocks (e.g., ```json ... ```)
  /// - Raw JSON objects/arrays directly in text
  ///
  /// Returns `null` if no valid JSON is found.
  static Object? parseFirstJsonBlock(String text) {
    final String? markdownBlock = _extractMarkdownJson(text);
    if (markdownBlock != null) {
      try {
        return jsonDecode(markdownBlock);
      } on FormatException catch (_) {}
    }

    final int firstBrace = text.indexOf('{');
    final int firstBracket = text.indexOf('[');

    var start = -1;
    if (firstBrace != -1 && firstBracket != -1) {
      start = firstBrace < firstBracket ? firstBrace : firstBracket;
    } else if (firstBrace != -1) {
      start = firstBrace;
    } else if (firstBracket != -1) {
      start = firstBracket;
    }

    if (start == -1) return null;

    final String input = text.substring(start);
    try {
      return jsonDecode(input);
    } on FormatException catch (_) {
      final String? result = _extractBalancedJson(input);
      if (result != null) {
        try {
          return jsonDecode(result);
        } on FormatException catch (_) {
          return null;
        }
      }
      return null;
    }
  }

  static String? _extractMarkdownJson(String text) {
    final regex = RegExp(r'```(?:json)?\s*([\s\S]*?)\s*```');
    final RegExpMatch? match = regex.firstMatch(text);
    return match?.group(1);
  }

  static String? _extractBalancedJson(String input) {
    if (input.isEmpty) return null;
    final String startChar = input[0];
    final String? endChar = startChar == '{'
        ? '}'
        : (startChar == '[' ? ']' : null);
    if (endChar == null) return null;

    var balance = 0;
    var inString = false;
    var isEscaped = false;

    for (var i = 0; i < input.length; i++) {
      final String char = input[i];

      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char == '\\') {
        isEscaped = true;
        continue;
      }

      if (char == '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char == startChar) {
          balance++;
        } else if (char == endChar) {
          balance--;
          if (balance == 0) {
            return input.substring(0, i + 1);
          }
        }
      }
    }
    return null;
  }

  /// Parses all valid JSON objects or arrays found in [text].
  static List<Object> parseJsonBlocks(String text) {
    final results = <Object>[];

    final markdownRegex = RegExp(r'```(?:json)?\s*([\s\S]*?)\s*```');
    final Iterable<RegExpMatch> matches = markdownRegex.allMatches(text);

    for (final match in matches) {
      final String? content = match.group(1);
      if (content != null) {
        try {
          results.add(jsonDecode(content) as Object);
        } on FormatException catch (_) {}
      }
    }
    if (results.isNotEmpty) {
      return results;
    }

    final Object? firstBlock = parseFirstJsonBlock(text);
    if (firstBlock != null) {
      results.add(firstBlock);
    }

    return results;
  }

  /// Removes all found JSON blocks from the text.
  static String stripJsonBlock(String text) {
    final markdownRegex = RegExp(r'```(?:json)?\s*([\s\S]*?)\s*```');
    String processed = text.replaceAll(markdownRegex, '');
    if (processed.length == text.length) {
      final String? jsonString = _extractBalancedJson(text);
      if (jsonString != null) {
        processed = text.replaceFirst(jsonString, '');
      }
    }

    return processed.trim();
  }
}
