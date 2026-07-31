/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @externs
 * @fileoverview Google Closure Compiler externs for Zod 4 internal properties and methods.
 * Declaring these properties prevents Closure Compiler from renaming them when compiling in ADVANCED mode.
 *
 * IMPORTANT: The properties protected here (e.g., `_ctx`, `j`, `bag`) are INTERNAL
 * implementation details of Zod 4. While this minimal set works for current versions,
 * upgrading Zod (even minor or patch versions) might change these internal names or introduce
 * new ones, potentially causing silent runtime failures in minified production builds.
 * If tests fail after a Zod update, verify if new internal properties need to be added here.
 */

/** @record @struct */
function ZodExterns() {}
/** @type {?} */ ZodExterns.prototype._zod;
/** @type {?} */ ZodExterns.prototype._def;
/** @type {?} */ ZodExterns.prototype.issues;
/** @type {?} */ ZodExterns.prototype.j;
/** @type {?} */ ZodExterns.prototype._ctx;
/** @type {?} */ ZodExterns.prototype.bag;
/** @type {?} */ ZodExterns.prototype.run;
