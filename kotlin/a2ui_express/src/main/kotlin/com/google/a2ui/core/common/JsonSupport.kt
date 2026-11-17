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

package com.google.a2ui.core.common

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

private const val COMMON_TYPES_RESOURCE = "/com/google/a2ui/assets/1.0/common_types.json"

private val cachedCommonTypes: JsonObject by lazy {
  val stream =
    ProtocolVersion::class.java.getResourceAsStream(COMMON_TYPES_RESOURCE)
      ?: throw IllegalStateException("Bundled A2UI resource not found: $COMMON_TYPES_RESOURCE")
  val content = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
  Json.parseToJsonElement(content).jsonObject
}

internal fun v1CommonTypes(): JsonObject = cachedCommonTypes

/** Structural JSON equality with mathematical numeric comparison (`100 == 100.0`). */
internal fun jsonValuesEqual(a: JsonElement?, b: JsonElement?): Boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a is JsonNull || b is JsonNull) return a is JsonNull && b is JsonNull
  if (a is JsonPrimitive && b is JsonPrimitive) {
    if (a.isString != b.isString) return false
    if (a.isString) return a.content == b.content
    val aBool = a.booleanOrNull
    val bBool = b.booleanOrNull
    if (aBool != null || bBool != null) return aBool == bBool
    val aLong = a.longOrNull
    val bLong = b.longOrNull
    if (aLong != null && bLong != null) return aLong == bLong
    val aDouble = a.doubleOrNull
    val bDouble = b.doubleOrNull
    if (aDouble != null && bDouble != null) {
      return if (aDouble == 0.0 && bDouble == 0.0) true else aDouble == bDouble
    }
    return a.content == b.content
  }
  if (a is JsonObject && b is JsonObject) {
    if (a.size != b.size) return false
    for ((k, v) in a) {
      if (!b.containsKey(k) || !jsonValuesEqual(v, b[k])) return false
    }
    return true
  }
  if (a is JsonArray && b is JsonArray) {
    if (a.size != b.size) return false
    for (i in a.indices) {
      if (!jsonValuesEqual(a[i], b[i])) return false
    }
    return true
  }
  return false
}

/** Strict JSON equality that preserves integer vs float distinction for incremental caches. */
internal fun jsonValuesStrictEqual(a: JsonElement?, b: JsonElement?): Boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a is JsonPrimitive && b is JsonPrimitive && !a.isString && !b.isString) {
    val aIsFloat = a.content.any { it == '.' || it == 'e' || it == 'E' }
    val bIsFloat = b.content.any { it == '.' || it == 'e' || it == 'E' }
    if (aIsFloat != bIsFloat) return false
  }
  return jsonValuesEqual(a, b)
}

/** Validates RFC 6901 JSON Pointer syntax (or relative data binding path without leading `/`). */
internal fun isValidJsonPointerOrRelativePath(path: String, requireLeadingSlash: Boolean): Boolean {
  if (path.isEmpty()) return !requireLeadingSlash
  if (requireLeadingSlash && !path.startsWith('/')) return false
  var i = 0
  while (i < path.length) {
    if (path[i] == '~') {
      if (i + 1 >= path.length) return false
      val next = path[i + 1]
      if (next != '0' && next != '1') return false
      i += 2
    } else {
      i++
    }
  }
  return true
}

/** Unescapes a single RFC 6901 JSON Pointer reference token (`~1` -> `/`, `~0` -> `~`). */
internal fun unescapeJsonPointerSegment(segment: String): String =
  segment.replace("~1", "/").replace("~0", "~")
