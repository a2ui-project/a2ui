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

import 'package:a2ui_agent/a2ui_agent.dart';
import 'package:a2ui_core/a2ui_core.dart';
import 'package:a2ui_flutter/basic_catalog.dart';
import 'package:a2ui_flutter_example/reply_reader.dart';
import 'package:flutter_test/flutter_test.dart';

import 'replies.dart';

/// What a [ReplyReader] passes on for a reply streamed as [chunks], in
/// order: `text <text>`, `<message type> <surface id>` and
/// `<error code> <surface id>`.
List<String> _read(List<String> chunks) {
  final log = <String>[];
  final reader = ReplyReader(
    const DirectJsonFormatFactory(
      progressiveKeys: {'text'},
    ).createFormat([basicCatalog()]),
    onText: (text) => log.add('text $text'),
    onMessage: (message) {
      final Map<String, dynamic> json = message.toJson();
      final String type = json.keys.firstWhere((key) => key != 'version');
      log.add('$type ${(json[type] as Map)['surfaceId']}');
    },
    onError: (error, surfaceId) =>
        log.add('${(error as A2uiError).code} $surfaceId'),
  );
  chunks.forEach(reader.add);
  reader.close();
  return log;
}

void main() {
  final String rejected = block([
    createSurface('a'),
    rootComponent('a', 'Card A', component: 'Bogus'),
  ]);
  final String accepted = block([
    createSurface('b'),
    rootComponent('b', 'Card B'),
  ]);
  const readOn = [
    'text Two cards.',
    'createSurface a',
    'VALIDATION_FAILED a',
    'createSurface b',
    'updateComponents b',
    'text Done.',
  ];

  test('reads an empty chunk as nothing', () {
    expect(_read(['', 'Hi.', '']), ['text Hi.']);
  });

  test('reads on after a block it rejects as the block closes', () {
    expect(_read(['Two cards.$rejected$accepted Done.']), readOn);
  });

  test('reads on after a rejected block whose close tag is split', () {
    final reply = 'Two cards.$rejected$accepted Done.';
    final int split = reply.indexOf('</a2ui-json>') + '</a2ui'.length;
    expect(_read([reply.substring(0, split), reply.substring(split)]), readOn);
  });

  test('names no surface for a block that is not JSON', () {
    expect(_read(['<a2ui-json>[{"version": </a2ui-json>Next.']), [
      'PARSE_ERROR ',
      'text Next.',
    ]);
  });

  test('reads on to the block end after a number out of range', () {
    expect(
      _read([
        'Here. <a2ui-json>[${jsonEncode(createSurface('t'))}',
        ', {"version": "v0.9", "updateComponents": {"surfaceId": "t", '
            '"components": [{"id": "root", "component": "Slider", '
            '"value": 1e400, "min": 0, "max": 10',
        '}]}}]</a2ui-json> After.',
      ]),
      ['text Here.', 'createSurface t', 'PARSE_ERROR t', 'text After.'],
    );
  });

  group('an updateDataModel', () {
    const start =
        '<a2ui-json>[{"version": "v0.9", "updateDataModel": {"surfaceId": "s"';
    const chunks = [
      start,
      ', "path": "/a"',
      ', "value": {"b": 1',
      '}}}]</a2ui-json>',
    ];

    test('is passed on once its object closes', () {
      expect(_read(chunks), ['updateDataModel s']);
    });

    test('is dropped, and the reply reported, when the reply ends inside '
        'its block', () {
      expect(_read(chunks.take(3).toList()), ['PARSE_ERROR ']);
    });
  });
}
