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

package com.google.a2ui.agent.inferenceformats.express

import kotlinx.serialization.json.JsonPrimitive

/** Internal AST representation of parsed A2UI Express statements and expressions. */
internal sealed interface ExpressStatement {
  data class Assignment(val target: String, val value: ExpressNode) : ExpressStatement

  data class Expression(val value: ExpressNode) : ExpressStatement
}

internal sealed interface ExpressNode {
  data object NullLiteral : ExpressNode

  data class BooleanLiteral(val value: Boolean) : ExpressNode

  data class StringLiteral(val value: String) : ExpressNode

  sealed interface NumberLiteral : ExpressNode {
    fun toJsonPrimitive(): JsonPrimitive

    fun asDouble(): Double

    data class IntVal(val rawDigits: String, val negative: Boolean, val longOrNull: Long?) :
      NumberLiteral {
      override fun toJsonPrimitive(): JsonPrimitive {
        if (longOrNull != null) return JsonPrimitive(longOrNull)
        val sign = if (negative && rawDigits != "0") "-" else ""
        return JsonPrimitive((sign + rawDigits).toDouble())
      }

      override fun asDouble(): Double {
        if (longOrNull != null) return longOrNull.toDouble()
        val d = rawDigits.toDouble()
        return if (negative && rawDigits != "0") -d else d
      }
    }

    data class FloatVal(val value: Double) : NumberLiteral {
      override fun toJsonPrimitive(): JsonPrimitive = JsonPrimitive(value)

      override fun asDouble(): Double = value
    }
  }

  data class PathNode(val path: String) : ExpressNode

  data class VariableNode(val name: String) : ExpressNode

  data object SkippedNode : ExpressNode

  data class ArrayNode(val items: List<ExpressNode>) : ExpressNode

  data class MapNode(val entries: Map<String, ExpressNode>) : ExpressNode

  data class CheckNode(val name: String, val args: List<ExpressNode>) : ExpressNode

  data class CallNode(
    val name: String,
    val args: List<ExpressNode>,
    val kwargs: Map<String, ExpressNode>,
    val kwargList: List<Pair<String, ExpressNode>> = kwargs.entries.map { it.key to it.value },
  ) : ExpressNode
}
