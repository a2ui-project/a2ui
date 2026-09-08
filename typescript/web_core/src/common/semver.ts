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
  major: number;
  /** Minor version number indicating backwards-compatible features. */
  minor: number;
  /** Patch version number indicating backwards-compatible bug fixes. */
  patch: number;
  /** Dot-separated pre-release identifiers. */
  prerelease: string[];
  /** Dot-separated build metadata identifiers. */
  build: string[];
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
 * @returns The normalized version string, or empty string if input is falsy.
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
 * @returns A SemVer object if valid, or null if the string cannot be parsed.
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
 * @returns A SemVer object if valid, or null otherwise.
 */
function toSemVer(v: string | SemVer | undefined | null): SemVer | null {
  if (!v) {
    return null;
  }
  if (typeof v === 'object') {
    const obj = v as Partial<SemVer>;
    return {
      major: typeof obj.major === 'number' ? obj.major : 0,
      minor: typeof obj.minor === 'number' ? obj.minor : 0,
      patch: typeof obj.patch === 'number' ? obj.patch : 0,
      prerelease: Array.isArray(obj.prerelease) ? obj.prerelease : [],
      build: Array.isArray(obj.build) ? obj.build : [],
    };
  }
  return parseSemVer(v);
}

/**
 * Compares two dot-separated pre-release identifiers per SemVer 2.0.0 Rule 11.4.
 *
 * @param idA First pre-release identifier.
 * @param idB Second pre-release identifier.
 * @returns Negative number if idA < idB, 0 if equal, positive number if idA > idB.
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
 * @returns Negative number if preA < preB, 0 if equal, positive number if preA > preB.
 */
function comparePrereleaseLists(preA: string[], preB: string[]): number {
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
 * @returns Negative number if a < b, 0 if a == b, positive number if a > b.
 */
export function compareSemVer(
  a: string | SemVer | undefined | null,
  b: string | SemVer | undefined | null,
): number {
  const vA = toSemVer(a);
  const vB = toSemVer(b);
  if (!vA && !vB) {
    return 0;
  }
  if (!vA) {
    return -1;
  }
  if (!vB) {
    return 1;
  }

  if (vA.major !== vB.major) {
    return vA.major - vB.major;
  }
  if (vA.minor !== vB.minor) {
    return vA.minor - vB.minor;
  }
  if (vA.patch !== vB.patch) {
    return vA.patch - vB.patch;
  }

  return comparePrereleaseLists(vA.prerelease, vB.prerelease);
}

/**
 * Checks if a given version string is at least the target minimum version.
 *
 * @param version The version string to check (e.g. 'v1.0', 'v1.1', 'v2.0').
 * @param minVersion The minimum version requirement (e.g. 'v1.0', '1.0.0').
 * @returns Whether version is at least minVersion.
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

/**
 * Evaluates whether a catalog protocol version is compatible with an incoming message version.
 *
 * For versions >= 1.0, forward compatibility is allowed (catalog <= message).
 * For versions < 1.0, versions must match identically.
 *
 * @param catalogVersion The catalog's declared protocol version.
 * @param messageVersion The incoming message's declared protocol version.
 * @returns Whether the catalog version is compatible with the message version.
 */
export function isCatalogVersionCompatible(
  catalogVersion: string | SemVer | undefined | null,
  messageVersion: string | SemVer | undefined | null,
): boolean {
  if (!catalogVersion || !messageVersion) {
    return false;
  }
  const catSemVer = toSemVer(catalogVersion);
  const msgSemVer = toSemVer(messageVersion);
  if (catSemVer && msgSemVer) {
    if (isAtLeastVersion(catSemVer, '1.0')) {
      return compareSemVer(catSemVer, msgSemVer) <= 0;
    }
    return compareSemVer(catSemVer, msgSemVer) === 0;
  }
  const normCat = String(catalogVersion).replace(/^v/i, '');
  const normMsg = String(messageVersion).replace(/^v/i, '');
  return normCat === normMsg;
}
