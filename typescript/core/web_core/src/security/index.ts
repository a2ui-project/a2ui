/*
 * Copyright 2026 Google LLC
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
 * URL security policy: the contract hosts implement or configure, the
 * built-in policies, and the schema helpers that mark catalog properties as
 * URLs.
 */

export {
  PermissiveUrlSecurityPolicy,
  type UrlCheckInfo,
  type UrlContext,
  type UrlContextAnnotation,
  type UrlPropertyMap,
  type UrlSecurityPolicy,
  type UrlSecurityPolicyOptions,
} from './url_security_policy.js';
export {
  AllowlistUrlSecurityPolicy,
  type AllowlistUrlSecurityPolicyOptions,
  type UrlRewriteHook,
} from './allowlist_url_security_policy.js';
export {URL_CONTEXT_KEYWORD, iframeUrl, mediaUrl, navigationUrl} from './url_schema.js';
