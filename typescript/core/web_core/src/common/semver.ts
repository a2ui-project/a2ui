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

/**
 * Structured representation of a semantic version according to Semantic Versioning 2.0.0 (https://semver.org/).
 */
export interface SemVer {
  /** Major version number indicating breaking API changes. */
  readonly major: number;
  /** Minor version number indicating backwards-compatible features. */
  readonly minor: number;
  /** Patch version number indicating backwards-compatible bug fixes. */
  readonly patch: number;
  /** Dot-separated pre-release identifiers. */
  readonly prerelease: readonly string[];
  /** Dot-separated build metadata identifiers. */
  readonly build: readonly string[];
}

/**
 * Official SemVer 2.0.0 regular expression from https://semver.org/,
 * extended with optional leading 'v'/'V' and optional patch component for protocol compatibility.
 *
 * Capturing groups:
 * 1: major (0|[1-9]\d*)
 * 2: minor (0|[1-9]\d*)
 * 3: patch (optional 0|[1-9]\d*)
 * 4: prerelease (optional dot-separated identifiers)
 * 5: buildmetadata (optional dot-separated identifiers)
 */
const SEMVER_REGEX =
  /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Normalizes a version string by stripping any leading 'v'/'V' and replacing underscores with dots in the core release segment.
 *
 * Preserves pre-release ('-') and build metadata ('+') suffixes intact.
 *
 * Examples:
 *   'v1_0' -> '1.0'
 *   'V1_0' -> '1.0'
 *   'v0_9_1' -> '0.9.1'
 *   '1_0_0-dev_release' -> '1.0.0-dev_release'
 *
 * @param version The raw version string to normalize.
 * @return The normalized version string, or empty string if input is falsy.
 */
export function normalizeVersionString(version: string | undefined | null): string {
  if (!version || typeof version !== 'string') {
    return '';
  }
  const text = version.trim().replace(/^[vV]/, '');
  const dashIdx = text.indexOf('-');
  const plusIdx = text.indexOf('+');
  let splitIdx = text.length;
  if (dashIdx !== -1 && plusIdx !== -1) {
    splitIdx = Math.min(dashIdx, plusIdx);
  } else if (dashIdx !== -1) {
    splitIdx = dashIdx;
  } else if (plusIdx !== -1) {
    splitIdx = plusIdx;
  }
  const core = text.slice(0, splitIdx).replace(/_/g, '.');
  return `${core}${text.slice(splitIdx)}`;
}

/**
 * Parses a semantic version string according to SemVer 2.0.0.
 *
 * @param versionStr The version string to parse.
 * @return A SemVer object if valid, or null if the string cannot be parsed.
 */
export function parseSemVer(versionStr: string | undefined | null): SemVer | null {
  if (!versionStr || typeof versionStr !== 'string') {
    return null;
  }
  const match = versionStr.trim().match(SEMVER_REGEX);
  if (!match) {
    return null;
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: match[3] !== undefined ? parseInt(match[3], 10) : 0,
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  };
}

/**
 * Converts a string or partial SemVer object into a normalized SemVer representation.
 *
 * @param v The version string or object to convert.
 * @return A SemVer object if valid, or null otherwise.
 */
export function toSemVer(v: string | SemVer | undefined | null): SemVer | null {
  if (!v) {
    return null;
  }
  if (typeof v === 'object') {
    const obj = v as Partial<SemVer>;
    if (
      typeof obj.major !== 'number' ||
      !Number.isInteger(obj.major) ||
      obj.major < 0 ||
      (typeof obj.minor === 'number' && (!Number.isInteger(obj.minor) || obj.minor < 0)) ||
      (typeof obj.patch === 'number' && (!Number.isInteger(obj.patch) || obj.patch < 0))
    ) {
      return null;
    }
    return {
      major: obj.major,
      minor: typeof obj.minor === 'number' ? obj.minor : 0,
      patch: typeof obj.patch === 'number' ? obj.patch : 0,
      prerelease: Array.isArray(obj.prerelease) ? obj.prerelease : [],
      build: Array.isArray(obj.build) ? obj.build : [],
    };
  }
  return parseSemVer(normalizeVersionString(v));
}

/**
 * Formats a semantic version into a canonical string representation.
 *
 * For standard versions with zero patch and no pre-release or build metadata,
 * returns `${major}.${minor}` (e.g. '0.8', '0.9', '1.0').
 * For versions with non-zero patch, pre-release identifiers, or build metadata,
 * returns the full SemVer string (e.g. '0.9.1', '1.0.0-beta.1').
 *
 * @param version The version string or SemVer object to canonicalize.
 * @return The canonical version string, or null if the input cannot be parsed.
 */
export function toCanonicalVersion(version: string | SemVer | undefined | null): string | null {
  if (!version) {
    return null;
  }
  const parsed = toSemVer(version);
  if (!parsed) {
    return null;
  }
  if (parsed.patch === 0 && parsed.prerelease.length === 0 && parsed.build.length === 0) {
    return `${parsed.major}.${parsed.minor}`;
  }
  const pre = parsed.prerelease.length > 0 ? `-${parsed.prerelease.join('.')}` : '';
  const bld = parsed.build.length > 0 ? `+${parsed.build.join('.')}` : '';
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${pre}${bld}`;
}

/**
 * Compares two dot-separated pre-release identifiers per SemVer 2.0.0 Rule 11.4.
 *
 * @param idA First pre-release identifier.
 * @param idB Second pre-release identifier.
 * @return Negative number if idA < idB, 0 if equal, positive number if idA > idB.
 */
function comparePrereleaseId(idA: string, idB: string): number {
  const isNumA = /^\d+$/.test(idA);
  const isNumB = /^\d+$/.test(idB);
  if (isNumA && isNumB) {
    if (idA.length !== idB.length) {
      return idA.length - idB.length;
    }
    if (idA < idB) {
      return -1;
    }
    if (idA > idB) {
      return 1;
    }
    return 0;
  }
  if (isNumA) {
    return -1; // Numeric identifiers have lower precedence than non-numeric
  }
  if (isNumB) {
    return 1;
  }
  if (idA < idB) {
    return -1;
  }
  if (idA > idB) {
    return 1;
  }
  return 0;
}

/**
 * Compares pre-release identifier lists per SemVer 2.0.0 Rules 11.3 and 11.4.
 *
 * @param preA First list of pre-release identifiers.
 * @param preB Second list of pre-release identifiers.
 * @return Negative number if preA < preB, 0 if equal, positive number if preA > preB.
 */
function comparePrereleaseLists(preA: readonly string[], preB: readonly string[]): number {
  if (preA.length === 0 && preB.length === 0) {
    return 0;
  }
  if (preA.length === 0) {
    return 1; // Normal version has higher precedence than pre-release version
  }
  if (preB.length === 0) {
    return -1;
  }

  const minLen = Math.min(preA.length, preB.length);
  for (let i = 0; i < minLen; i++) {
    const diff = comparePrereleaseId(preA[i], preB[i]);
    if (diff !== 0) {
      return diff;
    }
  }

  return preA.length - preB.length;
}

/**
 * Compares two semantic version strings or SemVer objects according to SemVer 2.0.0 precedence rules (Section 11).
 *
 * 1. Precedence is determined by comparing major, minor, and patch numerically.
 * 2. When major, minor, and patch are equal, a pre-release version has lower precedence than a normal version (e.g. 1.0.0-alpha < 1.0.0).
 * 3. Precedence for two pre-release versions is determined by comparing dot-separated identifiers from left to right.
 * 4. Build metadata does NOT figure into precedence.
 *
 * @param a First version string or SemVer object.
 * @param b Second version string or SemVer object.
 * @return Negative number if a < b, 0 if a == b, positive number if a > b.
 */
export function compareSemVer(
  a: string | SemVer | undefined | null,
  b: string | SemVer | undefined | null,
): number {
  const versionA = toSemVer(a);
  const versionB = toSemVer(b);
  if (!versionA && !versionB) {
    return 0;
  }
  if (!versionA) {
    return -1;
  }
  if (!versionB) {
    return 1;
  }

  if (versionA.major !== versionB.major) {
    return versionA.major - versionB.major;
  }
  if (versionA.minor !== versionB.minor) {
    return versionA.minor - versionB.minor;
  }
  if (versionA.patch !== versionB.patch) {
    return versionA.patch - versionB.patch;
  }

  return comparePrereleaseLists(versionA.prerelease, versionB.prerelease);
}

/**
 * Checks if a given version string is at least the target minimum version.
 *
 * @param version The version string to check (e.g. 'v1.0', 'v1.1', 'v2.0').
 * @param minVersion The minimum version requirement (e.g. 'v1.0', '1.0.0').
 * @return Whether version is at least minVersion.
 */
export function isAtLeastVersion(
  version: string | SemVer | undefined | null,
  minVersion: string | SemVer,
): boolean {
  if (!version) {
    return false;
  }
  const parsed = toSemVer(version);
  const minParsed = toSemVer(minVersion);
  if (!parsed || !minParsed) {
    return false;
  }
  return compareSemVer(parsed, minParsed) >= 0;
}
