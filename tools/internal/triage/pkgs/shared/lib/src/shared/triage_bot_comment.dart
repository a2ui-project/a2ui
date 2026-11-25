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

/// The start of every triage bot comment, followed by the kind of comment,
/// as in `**From triage bot, analysis:**`, or by a colon in earlier
/// comments, as in `**From triage bot:**`. See `blueprints/core.blueprint.md`.
final RegExp _triageBotPrefix = RegExp(r'^\*\*From triage bot[,:]');

/// The author associations of team members. See
/// `blueprints/core.blueprint.md`.
const Set<String> teamAssociations = {'OWNER', 'MEMBER', 'COLLABORATOR'};

/// Whether an author with [association] on the repository is a team member.
bool isTeamMember(String? association) =>
    teamAssociations.contains(association);

/// Whether [body] starts the way a triage bot comment does.
///
/// A comment is a triage bot comment only if a team member or a bot posted
/// it as well. See [isTriageBotComment].
bool hasTriageBotPrefix(String body) =>
    _triageBotPrefix.hasMatch(body.trimLeft());

/// Whether a comment with [body] is a triage bot comment: it starts with the
/// triage bot prefix, and a team member, whose author association is
/// [association], or a bot, if [byBot], posted it.
///
/// Only team members and bots count, so that nobody outside the team can
/// hide their comment from triage by starting it with the prefix.
bool isTriageBotComment({
  required String body,
  required String? association,
  required bool byBot,
}) => hasTriageBotPrefix(body) && (byBot || isTeamMember(association));
