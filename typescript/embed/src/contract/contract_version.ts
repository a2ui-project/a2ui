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

/** The version of the contract between an `@a2ui/embed` server and its app, as `major.minor`. */
export const CONTRACT_VERSION = '1.0';

/** The outcome of {@link checkContractVersion}. */
export type ContractVersionCheck = {ok: true} | {ok: false; reason: string};

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Checks whether a peer speaking contract `version` is compatible with this {@link CONTRACT_VERSION}.
 *
 * Minor versions only add optional fields, so any minor version of the same major is accepted.
 * A different major version, or a string that is not `major.minor`, is rejected.
 */
export function checkContractVersion(version: string): ContractVersionCheck {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    return {ok: false, reason: `Malformed contract version "${version}"; expected "major.minor".`};
  }
  const [supportedMajor] = CONTRACT_VERSION.split('.').map(Number);
  const major = Number(match[1]);
  if (major > supportedMajor) {
    return {
      ok: false,
      reason: `Contract version ${version} is newer than the supported version ${CONTRACT_VERSION}; update @a2ui/embed.`,
    };
  }
  if (major < supportedMajor) {
    return {
      ok: false,
      reason: `Contract version ${version} is older than the supported version ${CONTRACT_VERSION}.`,
    };
  }
  return {ok: true};
}
