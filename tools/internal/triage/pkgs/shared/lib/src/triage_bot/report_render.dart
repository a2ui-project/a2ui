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

/// The triage report as plain text, as a Google Chat message and as HTML.
/// See `blueprints/features/triage_bot/report.blueprint.md`.
library;

import '../shared/labels.dart';
import 'report.dart';

/// The triage bot skill, which the last line of the report links to.
const String skillUrl =
    'https://github.com/a2ui-project/a2ui/blob/main/.agents/skills/'
    'a2ui-triage-bot/SKILL.md';

/// The heading of the items assigned for triage to nobody.
const String nobody = 'Nobody';

/// The heading of the section with the items assigned for triage.
const String _assignedHeading = 'Assigned for triage:';

/// A group of items under a heading.
typedef ReportSection<T> = ({String heading, List<T> items});

/// Counts [n] of [noun], as in "1 item" or "2 items".
String count(int n, String noun) => '$n $noun${n == 1 ? '' : 's'}';

/// Counts items by kind, as in "2 issues and 1 PR", from whether each is a
/// PR in [isPullRequest].
String _kinds(Iterable<bool> isPullRequest) {
  final int prs = isPullRequest.where((isPr) => isPr).length;
  final int issues = isPullRequest.length - prs;
  return [
    if (issues != 0) count(issues, 'issue'),
    if (prs != 0) count(prs, 'PR'),
  ].join(' and ');
}

/// Formats [date] as YYYY-MM-DD in the local time zone.
String _formatDate(DateTime date) {
  final DateTime local = date.toLocal();
  return [
    local.year,
    local.month,
    local.day,
  ].map((part) => '$part'.padLeft(2, '0')).join('-');
}

/// The order of the ASCII characters when compared regardless of case, as
/// the Unicode collation for English orders them. Letters appear in lower
/// case.
const String _collationOrder =
    '_-,;:!?.\'"()[]{}@*/\\&#%`^+<=>|~\$0123456789abcdefghijklmnopqrstuvwxyz';

/// Compares two logins regardless of case, in the order of the Unicode
/// collation for English. Characters outside ASCII come after the others,
/// by code unit.
int _compareLogins(String a, String b) {
  int weight(int codeUnit) {
    final int index = _collationOrder.indexOf(
      String.fromCharCode(codeUnit).toLowerCase(),
    );
    return codeUnit < 128 && index >= 0 ? index : 128 + codeUnit;
  }

  for (var i = 0; i < a.length && i < b.length; i++) {
    final int order = weight(a.codeUnitAt(i)) - weight(b.codeUnitAt(i));
    if (order != 0) return order;
  }
  return a.length - b.length;
}

/// Sorts [values] by [compare], keeping the order of equal values.
List<T> _stableSorted<T>(Iterable<T> values, int Function(T a, T b) compare) {
  final List<(int, T)> indexed = values.indexed.toList()
    ..sort((a, b) {
      final int order = compare(a.$2, b.$2);
      return order != 0 ? order : a.$1 - b.$1;
    });
  return [for (final (int _, T value) in indexed) value];
}

/// Groups the items assigned for triage by assignee, in the order of the
/// logins, with the items assigned to nobody last.
///
/// Each heading names the assignee as `@login`. An item with several
/// assignees is in the group of each. The items in a group are sorted by
/// number.
List<ReportSection<AssignedItem>> byAssignee(List<AssignedItem> items) {
  final groups = <String, List<AssignedItem>>{};
  final List<AssignedItem> sorted = _stableSorted(
    items,
    (a, b) => a.number - b.number,
  );
  for (final item in sorted) {
    for (final String login
        in item.assignees.isEmpty ? [nobody] : item.assignees) {
      (groups[login] ??= []).add(item);
    }
  }
  final List<String> logins = [
    ..._stableSorted(
      groups.keys.where((login) => login != nobody),
      _compareLogins,
    ),
    if (groups.containsKey(nobody)) nobody,
  ];
  return [
    for (final login in logins)
      (
        heading:
            '${login == nobody ? login : '@$login'}: '
            '${_kinds(groups[login]!.map((item) => item.isPullRequest))}',
        items: groups[login]!,
      ),
  ];
}

/// The parts of the report that the text and the HTML share.
typedef _Sections = ({
  String title,
  List<String> summary,
  List<ReportSection<AssignedItem>> assigned,
  List<ReportSection<ItemActions>> groups,
});

_Sections _sections(Report report) {
  final List<ItemActions> items = report.items;
  final Period period = report.period;
  final summary = <String>[];
  if (items.isEmpty) {
    summary.add('Triaged no items.');
  } else {
    final String byKind = _kinds(items.map((item) => item.isPullRequest));
    summary.add(
      byKind.contains(' and ')
          ? 'Triaged ${count(items.length, 'item')}: $byKind.'
          : 'Triaged $byKind.',
    );
  }
  final List<ItemActions> sent = [
    for (final item in items)
      if (item.addedLabels.contains(needsTeamInputLabel)) item,
  ];
  if (sent.isNotEmpty) {
    summary.add(
      'Sent ${_kinds(sent.map((item) => item.isPullRequest))} to the team.',
    );
  }
  summary.add('Remaining: ${report.stillNeedTriage}.');
  final List<ReportSection<ItemActions>> groups = [
    for (final group in reportGroups)
      if ([
            for (final item in items)
              if (groupOf(item) == group) item,
          ]
          case final List<ItemActions> inGroup when inGroup.isNotEmpty)
        (
          heading:
              '$group: ${_kinds(inGroup.map((item) => item.isPullRequest))}',
          items: inGroup,
        ),
  ];
  return (
    title:
        'Triage report for ${report.login}, ${_formatDate(period.since)} to '
        '${_formatDate(period.until)}',
    summary: summary,
    assigned: byAssignee(report.assignedForTriage),
    groups: groups,
  );
}

/// Renders [report] as plain text, with [footer] as the last line.
String _renderLines(Report report, String footer) {
  final _Sections(
    :String title,
    :List<String> summary,
    :List<ReportSection<AssignedItem>> assigned,
    :List<ReportSection<ItemActions>> groups,
  ) = _sections(
    report,
  );
  final lines = <String>[title, '', ...summary, ''];
  if (assigned.isEmpty) {
    lines.add('$_assignedHeading none');
  } else {
    lines.add(_assignedHeading);
    for (final group in assigned) {
      lines.addAll(['', group.heading]);
      for (final AssignedItem item in group.items) {
        lines.addAll(['  - ${item.url}', '    ${item.title}']);
      }
    }
  }
  for (final group in groups) {
    lines.addAll(['', group.heading]);
    for (final ItemActions item in group.items) {
      lines.addAll(['  - ${item.url}', '    ${item.title}: ${describe(item)}']);
    }
  }
  lines.addAll(['', footer]);
  return '${lines.join('\n')}\n';
}

/// Renders [report] as plain text.
String renderText(Report report) =>
    _renderLines(report, 'Created by triage bot skill ($skillUrl)');

/// Renders [report] as the text of a Google Chat message, where `<url|text>`
/// is a link. Chat links the item URLs by itself.
String renderChat(Report report) =>
    _renderLines(report, 'Created by <$skillUrl|triage bot> skill');

String _escapeHtml(String text) => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

String _link(String url, String text) =>
    '<a href="${_escapeHtml(url)}">${_escapeHtml(text)}</a>';

/// Renders [report] as HTML, for apps that paste rich text.
String renderHtml(Report report) {
  final _Sections(
    :String title,
    :List<String> summary,
    :List<ReportSection<AssignedItem>> assigned,
    :List<ReportSection<ItemActions>> groups,
  ) = _sections(
    report,
  );
  final parts = <String>[
    '<p>${_escapeHtml(title)}</p>',
    '<p>${summary.map(_escapeHtml).join('<br>')}</p>',
  ];
  if (assigned.isEmpty) {
    parts.add('<p>${_escapeHtml('$_assignedHeading none')}</p>');
  } else {
    parts.add('<p>${_escapeHtml(_assignedHeading)}</p>');
    for (final group in assigned) {
      final Iterable<String> items = group.items.map(
        (item) =>
            '<li>${_link(item.url, item.url)}<br>'
            '${_escapeHtml(item.title)}</li>',
      );
      parts.addAll([
        '<p>${_escapeHtml(group.heading)}</p>',
        '<ul>${items.join()}</ul>',
      ]);
    }
  }
  for (final group in groups) {
    final Iterable<String> items = group.items.map(
      (item) =>
          '<li>${_link(item.url, item.url)}<br>'
          '${_escapeHtml('${item.title}: ${describe(item)}')}</li>',
    );
    parts.addAll([
      '<p>${_escapeHtml(group.heading)}</p>',
      '<ul>${items.join()}</ul>',
    ]);
  }
  parts.add('<p>Created by ${_link(skillUrl, 'triage bot')} skill</p>');
  return '<meta charset="utf-8">\n${parts.join('\n')}\n';
}

/// Renders [report] as HTML for the triage log: the report, then a
/// horizontal line that divides it from the report below it.
String renderLogHtml(Report report) => '${renderHtml(report)}<hr>\n';
