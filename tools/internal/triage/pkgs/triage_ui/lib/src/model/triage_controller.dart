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

import 'package:flutter/foundation.dart';
import 'package:triage/triage.dart';

import '../github/github_client.dart';
import '../github/triage_service.dart';
import '../github_item.dart';
import 'applier.dart';
import 'suggestion_draft.dart';
import 'triage_item.dart';
import 'triage_session.dart';

/// The state of the triage UI: the items, the selected one, the triager's
/// drafts and what the triager applied.
class TriageController extends ChangeNotifier {
  /// [connect] finds the triager's GitHub token and returns the service that
  /// uses it.
  TriageController({required Future<TriageService> Function() connect})
    : _connect = connect;

  final Future<TriageService> Function() _connect;
  TriageService? _service;

  final TriageSession session = TriageSession();

  List<TriageItem> _queue = const [];

  /// Items opened by URL that are not in the queue.
  List<TriageItem> _opened = const [];

  RepositoryInfo _repositoryInfo = const RepositoryInfo();
  RepositoryInfo get repositoryInfo => _repositoryInfo;

  bool _loading = false;

  /// Whether the items are being loaded.
  bool get loading => _loading;

  String? _error;

  /// The last error, until [dismissError].
  String? get error => _error;

  /// Whether the controller reached GitHub and loaded the items once.
  bool get isConnected => _service != null;

  int? _selected;
  GitHubItem? _pendingOpen;

  final Set<int> _changedOnGitHub = {};
  final Map<int, SuggestionDraft> _drafts = {};
  final Map<int, ApplyResult> _results = {};
  final Set<int> _applying = {};

  /// The issues in the queue, oldest first.
  List<TriageItem> get issues => _sorted(_queue.where((i) => !i.isPullRequest));

  /// The pull requests in the queue, oldest first.
  List<TriageItem> get pullRequests =>
      _sorted(_queue.where((i) => i.isPullRequest));

  /// The items opened by URL that are not in the queue.
  List<TriageItem> get opened => _opened;

  /// All items, in the order the list shows them.
  List<TriageItem> get orderedItems => [...issues, ...pullRequests, ..._opened];

  /// How many items in the queue the triager did not apply a suggestion to.
  int get remaining => _queue.where((i) => !session.isApplied(i.number)).length;

  TriageItem? get selected => _selected == null ? null : item(_selected!);

  /// The loaded item with [number], or null.
  TriageItem? item(int number) {
    for (final TriageItem i in [..._queue, ..._opened]) {
      if (i.number == number) return i;
    }
    return null;
  }

  /// The items in the queue that [item] is linked to and that need triage.
  List<TriageItem> relatedInQueue(TriageItem item) => [
    for (final TriageItem i in _queue)
      if (item.linkedItems.contains(i.number) && i.needsTriage) i,
  ];

  /// Whether a refresh found that [number] changed on GitHub, which reset
  /// its draft.
  bool changedOnGitHub(int number) => _changedOnGitHub.contains(number);

  bool isApplying(int number) => _applying.contains(number);

  ApplyResult? lastResult(int number) => _results[number];

  /// The draft for [item], which starts as [initial].
  SuggestionDraft draftFor(TriageItem item, TriageSuggestion initial) =>
      _drafts.putIfAbsent(item.number, () => SuggestionDraft(initial));

  /// The session report.
  String report() => session.report(stillNeedTriage: remaining);

  void dismissError() {
    _error = null;
    notifyListeners();
  }

  /// Connects to GitHub and loads the items.
  Future<void> start() => _load(() async {
    final TriageService service = await _connect();
    final (RepositoryInfo info, List<TriageItem> queue) = await (
      service.fetchRepositoryInfo(),
      service.fetchQueue(),
    ).wait;
    _service = service;
    _repositoryInfo = info;
    _queue = queue;
    _selected ??= orderedItems.firstOrNull?.number;
  }, then: _openPending);

  /// Loads the queue again, and the items opened by URL.
  ///
  /// Resets the drafts of the items that changed on GitHub, so that the
  /// triager sees their current state.
  Future<void> refresh() => _load(() async {
    final TriageService service = _service!;
    final List<TriageItem> queue = await service.fetchQueue();
    final Set<int> inQueue = {for (final i in queue) i.number};
    final opened = <TriageItem>[];
    for (final TriageItem i in _opened) {
      if (inQueue.contains(i.number)) continue;
      final TriageItem? fresh = await service.fetchItem(i.number);
      if (fresh != null) opened.add(fresh);
    }

    final Map<int, TriageItem> old = {
      for (final i in [..._queue, ..._opened]) i.number: i,
    };
    _changedOnGitHub.clear();
    for (final i in [...queue, ...opened]) {
      final TriageItem? before = old[i.number];
      if (before != null && before.updatedAt != i.updatedAt) {
        _changedOnGitHub.add(i.number);
        _drafts.remove(i.number)?.dispose();
        _results.remove(i.number);
      }
    }
    _queue = queue;
    _opened = opened;
  });

  /// Selects [item], loading it first if it is not loaded.
  Future<void> open(GitHubItem item) async {
    if (!isConnected) {
      // Opened when the items are loaded.
      _pendingOpen = item;
      return;
    }
    if (this.item(item.number) == null) {
      await _load(() async {
        final TriageItem? fetched = await _service!.fetchItem(item.number);
        if (fetched == null) {
          throw GitHubException('${item.url} does not exist.');
        }
        _opened = [..._opened, fetched];
      });
    }
    if (this.item(item.number) != null) select(item.number);
  }

  void select(int number) {
    _selected = number;
    notifyListeners();
  }

  /// Applies the draft for [item] to it on GitHub.
  ///
  /// On success, records the item in the session and, if it is selected,
  /// selects the next item that is not applied yet.
  Future<void> apply(TriageItem item) async {
    final int n = item.number;
    final TriageSuggestion suggestion = _drafts[n]!.toSuggestion();
    _applying.add(n);
    _results.remove(n);
    notifyListeners();

    final ApplyResult result = await applySuggestion(
      _service!,
      item,
      suggestion,
      replyPosted: session.hasReplied(n),
      onReplyPosted: () => session.recordReplied(n),
    );
    _results[n] = result;
    if (result.succeeded) {
      session.recordApplied(item, suggestion);
      if (_selected == n) _selectNextAfter(n);
    }

    // Show the item as it is now, so that a refresh does not take the
    // triager's own changes for someone else's.
    try {
      final TriageItem? fresh = await _service!.fetchItem(n);
      if (fresh != null) _replace(fresh);
    } on GitHubException {
      // The item keeps its old state until the next refresh.
    }
    _applying.remove(n);
    notifyListeners();
  }

  void _selectNextAfter(int number) {
    final List<TriageItem> items = orderedItems;
    final int index = items.indexWhere((i) => i.number == number);
    final Iterable<TriageItem> candidates = [
      ...items.skip(index + 1),
      ...items.take(index),
    ];
    for (final i in candidates) {
      if (!session.isApplied(i.number)) {
        _selected = i.number;
        return;
      }
    }
  }

  void _replace(TriageItem fresh) {
    List<TriageItem> replaced(List<TriageItem> items) => [
      for (final i in items) i.number == fresh.number ? fresh : i,
    ];
    _queue = replaced(_queue);
    _opened = replaced(_opened);
  }

  Future<void> _openPending() async {
    final GitHubItem? pending = _pendingOpen;
    _pendingOpen = null;
    if (pending != null && isConnected) await open(pending);
  }

  Future<void> _load(
    Future<void> Function() body, {
    Future<void> Function()? then,
  }) async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      await body();
    } on GitHubException catch (e) {
      _error = e.message;
    }
    _loading = false;
    notifyListeners();
    await then?.call();
  }

  static List<TriageItem> _sorted(Iterable<TriageItem> items) =>
      items.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));

  @override
  void dispose() {
    for (final SuggestionDraft draft in _drafts.values) {
      draft.dispose();
    }
    super.dispose();
  }
}
