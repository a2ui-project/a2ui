/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** Plain-language formatting of dates, money and lists for the card and the summaries. */

/** `Fri Dec 4, 2:00 PM`, or `Fri Dec 4` when `withTime` is false. */
export function formatWhen(date: string | Date, timeZone: string, withTime = true): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withTime ? {hour: 'numeric', minute: '2-digit'} : {}),
  }).formatToParts(new Date(date));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const day = `${value('weekday')} ${value('month')} ${value('day')}`;
  return withTime ? `${day}, ${value('hour')}:${value('minute')} ${value('dayPeriod')}` : day;
}

/** `2:00 PM`. */
export function formatTime(date: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {timeZone, hour: 'numeric', minute: '2-digit'}).format(
    new Date(date),
  );
}

/** `Dec 1` for a `YYYY-MM-DD` day. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric'}).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** `October` for a `YYYY-MM` period. */
export function formatMonth(period: string): string {
  return new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'long'}).format(
    new Date(`${period}-01T00:00:00Z`),
  );
}

/** `$84.20`. */
export function formatMoney(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(amount);
}

/** `3 hours ago`, `yesterday` or `4 days ago`. */
export function ago(date: string, now: Date): string {
  const hours = Math.max(0, (now.getTime() - Date.parse(date)) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)} ${Math.floor(hours) === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** `1 reply`, `2 replies`. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Cuts `text` to `max` characters on a word boundary, with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
