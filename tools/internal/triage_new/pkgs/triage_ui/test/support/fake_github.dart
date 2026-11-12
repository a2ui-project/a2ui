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

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:triage_ui/src/github/github_client.dart';
import 'package:triage_ui/src/github/triage_service.dart';
import 'package:triage_ui/src/model/triage_item.dart';

/// The item with [number] in [a2uiRepository].
ItemRef a2ui(int number) => (repository: a2uiRepository, number: number);

/// The item with [number] in [genuiRepository].
ItemRef genui(int number) => (repository: genuiRepository, number: number);

/// The time the fake items are created at, and later times.
DateTime day(int n) => DateTime.utc(2026, 11, n);

/// A suggestion comment, as the triage bot posts it, with [component] in its
/// `<a2ui>` block.
String suggestionComment(String component) =>
    '''
**From triage bot:**

Triage suggestion:

<details>
<summary>For humans</summary>

Text for people.

</details>

<details>
<summary>For software</summary>

```
<a2ui>
$component
</a2ui>
```

</details>
''';

Map<String, Object?> commentNode(
  String body, {
  required DateTime at,
  DateTime? editedAt,
  String login = 'octocat',
  String association = 'MEMBER',
  String type = 'User',
}) => {
  'author': {'login': login, '__typename': type},
  'authorAssociation': association,
  'body': body,
  'createdAt': at.toIso8601String(),
  'lastEditedAt': editedAt?.toIso8601String(),
  'url': 'https://github.com/a2ui-project/a2ui/issues/1#issuecomment-1',
};

Map<String, Object?> labeledEvent(String label, DateTime at) => {
  '__typename': 'LabeledEvent',
  'createdAt': at.toIso8601String(),
  'label': {'name': label},
};

/// A GraphQL node of an issue, or of a pull request if [pr], in
/// [repository].
Map<String, Object?> itemNode(
  int number, {
  String repository = a2uiRepository,
  bool pr = false,
  String? title,
  String body = '',
  DateTime? createdAt,
  DateTime? updatedAt,
  DateTime? lastEditedAt,
  String state = 'OPEN',
  List<String> labels = const [needsTriageLabel],
  List<String> assignees = const [],
  List<Map<String, Object?>> comments = const [],
  List<Map<String, Object?>> timeline = const [],
  List<Map<String, Object?>> reviews = const [],
  List<int> linked = const [],
  String? milestone,
}) {
  final kind = pr ? 'pull' : 'issues';
  Map<String, Object?> nodes(List<Object?> list) => {'nodes': list};
  return {
    '__typename': pr ? 'PullRequest' : 'Issue',
    'id': _id(repository, number, pr: pr),
    'number': number,
    'title': title ?? 'Item $number',
    'body': body,
    'url': 'https://github.com/$repository/$kind/$number',
    'createdAt': (createdAt ?? day(1)).toIso8601String(),
    'updatedAt': (updatedAt ?? createdAt ?? day(1)).toIso8601String(),
    'lastEditedAt': lastEditedAt?.toIso8601String(),
    'state': state,
    'author': {'login': 'author$number'},
    'labels': nodes([
      for (final l in labels) {'name': l},
    ]),
    'assignees': nodes([
      for (final a in assignees) {'login': a},
    ]),
    'milestone': milestone == null ? null : {'title': milestone},
    'comments': nodes(comments),
    'timelineItems': nodes(timeline),
    if (pr) 'reviews': nodes(reviews),
    pr ? 'closingIssuesReferences' : 'closedByPullRequestsReferences': nodes([
      for (final n in linked) {'number': n},
    ]),
  };
}

/// The GraphQL node id of an item, such as `I_12` for an issue in
/// [a2uiRepository], or `genui_PR_7` for a pull request in
/// [genuiRepository].
String _id(String repository, int number, {required bool pr}) =>
    '${repository == a2uiRepository ? '' : 'genui_'}${pr ? 'PR' : 'I'}_$number';

/// GitHub, as far as the triage UI uses it, with items held in memory.
///
/// Records each change as a line in [calls], such as
/// `POST issues/12/labels ["P1"]` for an item in [a2uiRepository], and
/// `POST flutter/genui/issues/7/labels ["P1"]` for an item in
/// [genuiRepository].
class FakeGitHub {
  FakeGitHub(
    List<Map<String, Object?>> items, {
    List<Map<String, Object?>> genuiItems = const [],
  }) : items = {for (final i in items) i['number']! as int: i},
       genuiItems = {for (final i in genuiItems) i['number']! as int: i};

  /// The items in [a2uiRepository], by number.
  final Map<int, Map<String, Object?>> items;

  /// The items in [genuiRepository], by number.
  final Map<int, Map<String, Object?>> genuiItems;

  final List<String> calls = [];

  Map<int, Map<String, Object?>> _itemsOf(String repository) =>
      repository == genuiRepository ? genuiItems : items;

  /// Logins that GitHub silently does not assign.
  final Set<String> unassignable = {};

  /// Request lines, such as `POST issues/12/labels`, that fail with 500.
  final Set<String> failing = {};

  /// While set, the REST requests wait for it to complete, to keep an apply
  /// going.
  Completer<void>? hold;

  // Sorted by name, as GitHub returns them, so the priorities are not first.
  List<String> labels = [
    'area: docs',
    'P0',
    'P1',
    'P2',
    'P3',
    'type: bug',
    needsTriageLabel,
    needsTeamInputLabel,
  ];

  /// The labels of [genuiRepository].
  List<String> genuiLabels = [
    'P0',
    'P1',
    'P2',
    'P3',
    needsTriageLabel,
    needsTeamInputLabel,
  ];

  /// The colors of some of the [labels]; the others have none.
  Map<String, String> labelColors = {'P1': 'b60205', 'type: bug': 'fbca04'};

  List<String> assignableUsers = ['hubot', 'octocat'];

  /// The open milestones: their numbers by title.
  Map<String, int> milestones = {'November launch': 10, 'December launch': 11};

  var _clock = 100;

  TriageService service() => TriageService(
    GitHubClient(token: 'token', httpClient: MockClient(_handle)),
  );

  Future<http.Response> _handle(http.Request request) async {
    final String path = request.url.path.substring(1);
    final Object? body = request.body.isEmpty ? null : jsonDecode(request.body);
    if (path == 'graphql') {
      final json = body! as Map<String, Object?>;
      return _graphql(
        json['query']! as String,
        json['variables']! as Map<String, Object?>,
      );
    }

    await hold?.future;
    final String repository = path.startsWith('repos/$genuiRepository/')
        ? genuiRepository
        : a2uiRepository;
    final Map<int, Map<String, Object?>> items = _itemsOf(repository);
    final String issuePath = path.replaceFirst('repos/$repository/', '');
    final line = repository == a2uiRepository
        ? '${request.method} $issuePath'
        : '${request.method} $repository/$issuePath';
    calls.add(body == null ? line : '$line ${jsonEncode(body)}');
    if (failing.contains(line)) {
      return _json({'message': 'Server error'}, status: 500);
    }

    final json = (body ?? <String, Object?>{}) as Map<String, Object?>;
    // Setting or removing the milestone.
    if (RegExp(r'^issues/(\d+)$').firstMatch(issuePath) case final m?
        when request.method == 'PATCH') {
      final Map<String, Object?> item = items[int.parse(m.group(1)!)]!;
      _touch(item);
      final Object? number = json['milestone'];
      item['milestone'] = number == null
          ? null
          : {
              'title': milestones.entries
                  .firstWhere((e) => e.value == number)
                  .key,
            };
      return _json({}, status: 200);
    }

    final RegExpMatch match = RegExp(
      r'^issues/(\d+)/(\w+)(?:/(.*))?$',
    ).firstMatch(issuePath)!;
    final Map<String, Object?> item = items[int.parse(match.group(1)!)]!;
    _touch(item);
    switch ((request.method, match.group(2))) {
      case ('POST', 'comments'):
        final comments = item['comments']! as Map<String, Object?>;
        comments['nodes'] = [
          ...comments['nodes']! as List<Object?>,
          commentNode(json['body']! as String, at: DateTime.now()),
        ];
        return _json({'id': 1}, status: 201);
      case ('POST', 'labels'):
        _edit(item, 'labels', 'name', add: _strings(json['labels']));
        return _json([], status: 200);
      case ('DELETE', 'labels'):
        final String label = Uri.decodeComponent(match.group(3)!);
        if (!_names(item, 'labels', 'name').contains(label)) {
          return _json({'message': 'Label does not exist'}, status: 404);
        }
        _edit(item, 'labels', 'name', remove: [label]);
        return _json([], status: 200);
      case ('POST', 'assignees'):
        _edit(
          item,
          'assignees',
          'login',
          add: [
            for (final String login in _strings(json['assignees']))
              if (!unassignable.contains(login)) login,
          ],
        );
        return _json({
          'assignees': [
            for (final login in _names(item, 'assignees', 'login'))
              {'login': login},
          ],
        }, status: 201);
      case ('DELETE', 'assignees'):
        _edit(item, 'assignees', 'login', remove: _strings(json['assignees']));
        return _json({}, status: 200);
    }
    return _json({'message': 'Not Found'}, status: 404);
  }

  http.Response _graphql(String query, Map<String, Object?> variables) {
    final String repository = variables['owner'] == null
        ? a2uiRepository
        : '${variables['owner']}/${variables['name']}';
    if (query.contains('search(')) {
      final searchQuery = variables['query']! as String;
      final String label = RegExp(
        r'label:"([^"]+)"',
      ).firstMatch(searchQuery)!.group(1)!;
      final bool genui = searchQuery.contains('repo:$genuiRepository ');
      return _json({
        'data': {
          'search': {
            'pageInfo': {'hasNextPage': false, 'endCursor': null},
            'nodes': [
              for (final item in (genui ? genuiItems : items).values)
                if (item['state'] == 'OPEN' &&
                    _names(item, 'labels', 'name').contains(label) &&
                    (!searchQuery.contains('is:pr') ||
                        item['__typename'] == 'PullRequest'))
                  item,
            ],
          },
        },
      });
    }
    if (query.contains('issueOrPullRequest')) {
      return _json({
        'data': {
          'repository': {
            'issueOrPullRequest': _itemsOf(repository)[variables['number']],
          },
        },
      });
    }
    if (query.contains('assignableUsers')) {
      return _json({
        'data': {
          'repository': {
            'labels': {
              'nodes': [
                for (final l
                    in repository == genuiRepository ? genuiLabels : labels)
                  {'name': l, 'color': labelColors[l]},
              ],
            },
            'assignableUsers': {
              'nodes': [
                for (final u in assignableUsers) {'login': u},
              ],
            },
            'milestones': {
              'nodes': [
                for (final MapEntry(key: title, value: number)
                    in milestones.entries)
                  {'number': number, 'title': title},
              ],
            },
          },
        },
      });
    }
    if (query.contains('issue(number')) {
      return _json({
        'data': {
          'repository': {
            'issue': {
              'id': _id(repository, variables['number']! as int, pr: false),
            },
          },
        },
      });
    }
    if (query.contains('closeIssue') || query.contains('closePullRequest')) {
      calls.add('close ${jsonEncode(variables)}');
      final id = variables['id']! as String;
      final Map<String, Object?> item = [
        ...items.values,
        ...genuiItems.values,
      ].firstWhere((i) => i['id'] == id);
      _touch(item);
      item['state'] = 'CLOSED';
      return _json({'data': <String, Object?>{}});
    }
    throw StateError('Unexpected query: $query');
  }

  /// Marks [item] as changed on GitHub.
  void _touch(Map<String, Object?> item) {
    item['updatedAt'] = DateTime.utc(
      2026,
      12,
      1,
      0,
      _clock++,
    ).toIso8601String();
  }

  /// Changes the item with [number] in [repository] as if someone did on
  /// GitHub.
  void change(
    int number,
    void Function(Map<String, Object?> item) edit, {
    String repository = a2uiRepository,
  }) {
    final Map<String, Object?> item = _itemsOf(repository)[number]!;
    edit(item);
    _touch(item);
  }

  static List<String> _strings(Object? list) => [
    for (final Object? s in list! as List<Object?>) s! as String,
  ];

  static List<String> _names(
    Map<String, Object?> item,
    String connection,
    String field,
  ) => [
    for (final Object? node
        in (item[connection]! as Map<String, Object?>)['nodes']!
            as List<Object?>)
      (node! as Map<String, Object?>)[field]! as String,
  ];

  static void _edit(
    Map<String, Object?> item,
    String connection,
    String field, {
    List<String> add = const [],
    List<String> remove = const [],
  }) {
    final List<String> names = _names(item, connection, field)
      ..removeWhere(remove.contains);
    for (final name in add) {
      if (!names.contains(name)) names.add(name);
    }
    item[connection] = {
      'nodes': [
        for (final name in names) {field: name},
      ],
    };
  }

  static http.Response _json(Object? json, {int status = 200}) => http.Response(
    jsonEncode(json),
    status,
    headers: {'content-type': 'application/json'},
  );
}
