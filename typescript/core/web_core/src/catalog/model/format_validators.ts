/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const RFC3339_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
const RFC3339_DATE_TIME_RE =
  /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2}))$/;
const RFC3986_URI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Returns true when `value` is a non-null, non-array object. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns a human-readable type label for validation diagnostics. */
export function describeValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isNaN(value)) return 'nan';
  return typeof value;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Strict RFC 3339 `full-date` check (`YYYY-MM-DD`, real calendar days including leap years). */
export function isValidRfc3339Date(value: string): boolean {
  const match = RFC3339_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month];
  return day >= 1 && day <= maxDay;
}

/** Strict RFC 3339 `full-time` check (`HH:MM:SS(.frac)?(Z|±HH:MM)`). */
export function isValidRfc3339Time(value: string): boolean {
  const match = RFC3339_TIME_RE.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 60) return false;
  if (match[4] !== undefined) {
    const offsetHour = Number(match[5]);
    const offsetMinute = Number(match[6]);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}

/** Strict RFC 3339 `date-time` check without JS `Date.parse` calendar rollover. */
export function isValidRfc3339DateTime(value: string): boolean {
  const match = RFC3339_DATE_TIME_RE.exec(value);
  if (!match) return false;
  return isValidRfc3339Date(match[1]) && isValidRfc3339Time(match[2]);
}

/** Strict RFC 3986 scheme-prefixed URI check with no leading, trailing, or internal whitespace. */
export function isValidUri(value: string): boolean {
  return RFC3986_URI_RE.test(value);
}

/** Lightweight email format check. */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

/** Validates A2UI SemVer strings (`MAJOR.MINOR` or `MAJOR.MINOR.PATCH` with optional pre-release/build). */
export function isValidSemVer(value: string): boolean {
  return SEMVER_RE.test(value);
}
