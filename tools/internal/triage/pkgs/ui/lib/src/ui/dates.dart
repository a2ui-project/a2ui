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

/// How dates and times read in the triage UI.
library;

/// How long ago [time] was, as an age: "less than a day", "1 day" or
/// "32 days".
String age(DateTime time, {DateTime? now}) {
  final int days = (now ?? DateTime.now()).difference(time).inDays;
  return switch (days) {
    <= 0 => 'less than a day',
    1 => '1 day',
    _ => '$days days',
  };
}

/// The time of day of [time], as "14:03:07".
String clockTime(DateTime time) => [
  time.hour,
  time.minute,
  time.second,
].map((int n) => n.toString().padLeft(2, '0')).join(':');
