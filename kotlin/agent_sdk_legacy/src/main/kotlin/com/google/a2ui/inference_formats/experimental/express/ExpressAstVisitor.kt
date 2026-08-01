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

package com.google.a2ui.inference_formats.experimental.express

import com.google.a2ui.inference_formats.experimental.express.generated.ExpressBaseVisitor
import com.google.a2ui.inference_formats.experimental.express.generated.ExpressParser
import org.antlr.v4.runtime.BaseErrorListener
import org.antlr.v4.runtime.Lexer
import org.antlr.v4.runtime.RecognitionException
import org.antlr.v4.runtime.Recognizer

private val UNESCAPE_REGEX = Regex("""\\([\s\S])""")

internal fun unescapeString(valStr: String): String {
  return UNESCAPE_REGEX.replace(valStr) { match ->
    val char = match.groupValues[1]
    when (char) {
      "n" -> "\n"
      "r" -> "\r"
      "t" -> "\t"
      "\\" -> "\\"
      "\"" -> "\""
      else -> match.value
    }
  }
}

/** Traverses the ANTLR parse tree to construct the expected AST nodes for Express DSL. */
class ExpressAstVisitor(val firstErrorLine: Int? = null) : ExpressBaseVisitor<Any?>() {

  override fun visitProgram(ctx: ExpressParser.ProgramContext): List<Any?> {
    val statements = mutableListOf<Any?>()
    for (stmtCtx in ctx.statement()) {
      if (firstErrorLine != null && stmtCtx.start.line >= firstErrorLine) {
        break
      }
      try {
        val stmt = visit(stmtCtx)
        if (stmt != null) {
          statements.add(stmt)
        }
      } catch (_: Exception) {}
    }
    return statements
  }

  override fun visitStatement(ctx: ExpressParser.StatementContext): Any? {
    if (ctx.assignment() != null) {
      return visit(ctx.assignment())
    }
    if (ctx.expression() != null) {
      return listOf("EXPR", visit(ctx.expression()))
    }
    return null
  }

  override fun visitAssignment(ctx: ExpressParser.AssignmentContext): Any {
    val target = ctx.identifier()?.text ?: ctx.path().text
    val value = visit(ctx.expression())
    return listOf("ASSIGN", target, value)
  }

  override fun visitExpression(ctx: ExpressParser.ExpressionContext): Any? {
    return visit(ctx.getChild(0))
  }

  override fun visitArray(ctx: ExpressParser.ArrayContext): List<Any?> {
    return ctx.expression().map { visit(it) }
  }

  override fun visitMap(ctx: ExpressParser.MapContext): Map<String, Any?> {
    val res = mutableMapOf<String, Any?>()
    for (entry in ctx.map_entry()) {
      val pair = visit(entry) as? Pair<*, *>
      if (pair != null) {
        res[pair.first.toString()] = pair.second
      }
    }
    return res
  }

  override fun visitMap_entry(ctx: ExpressParser.Map_entryContext): Pair<String, Any?> {
    val k = ctx.identifier()?.text ?: visit(ctx.string()).toString()
    val v = visit(ctx.expression())
    return Pair(k, v)
  }

  override fun visitPath(ctx: ExpressParser.PathContext): Map<String, String> {
    val text = ctx.PATH().text
    return mapOf("path" to text.substring(1))
  }

  override fun visitCheck(ctx: ExpressParser.CheckContext): Map<String, Any?> {
    val name = ctx.CHECK().text.substring(1)
    val args = ctx.expression().map { visit(it) }
    return mapOf("check" to name, "args" to args)
  }

  override fun visitArg(ctx: ExpressParser.ArgContext): Map<String, Any?> {
    if (ctx.named_arg() != null) {
      val pair = visit(ctx.named_arg()) as Pair<*, *>
      return mapOf("type" to "kw", "key" to pair.first, "value" to pair.second)
    }
    return mapOf("type" to "pos", "value" to visit(ctx.expression()))
  }

  override fun visitNamed_arg(ctx: ExpressParser.Named_argContext): Pair<String, Any?> {
    val k = ctx.identifier().text
    val v = visit(ctx.expression())
    return Pair(k, v)
  }

  override fun visitCall(ctx: ExpressParser.CallContext): Map<String, Any?> {
    val name = ctx.identifier().text
    val args = mutableListOf<Any?>()
    val kwargs = mutableMapOf<String, Any?>()

    for (argCtx in ctx.arg()) {
      val res = visit(argCtx)
      if (res is Map<*, *>) {
        if (res["type"] == "kw") {
          val key = res["key"] as? String
          if (key != null) {
            kwargs[key] = res["value"]
          }
        } else if (res["type"] == "pos") {
          args.add(res["value"])
        } else {
          args.add(res)
        }
      } else {
        args.add(res)
      }
    }

    val node = mutableMapOf<String, Any?>("call" to name, "args" to args)
    if (kwargs.isNotEmpty()) {
      node["kwargs"] = kwargs
    }
    return node
  }

  override fun visitVariable(ctx: ExpressParser.VariableContext): Map<String, Any?> {
    return if (ctx.identifier() != null) {
      mapOf("variable" to ctx.identifier().text)
    } else {
      mapOf("skipped" to true)
    }
  }

  override fun visitLiteral(ctx: ExpressParser.LiteralContext): Any? {
    if (ctx.string() != null) {
      return visit(ctx.string())
    }
    if (ctx.NUMBER() != null) {
      val valStr = ctx.NUMBER().text
      return if ("." in valStr) valStr.toDouble() else valStr.toLong()
    }
    if (ctx.BOOLEAN() != null) {
      return ctx.BOOLEAN().text == "true"
    }
    return null
  }

  override fun visitIdentifier(ctx: ExpressParser.IdentifierContext): String {
    return ctx.IDENTIFIER().text
  }

  override fun visitString(ctx: ExpressParser.StringContext): String {
    val child = ctx.getChild(0)
    val symbol = (child as? org.antlr.v4.runtime.tree.TerminalNode)?.symbol ?: return ""
    val tokenType = symbol.type
    val valStr = symbol.text

    return when (tokenType) {
      ExpressParser.RAW_TRIPLE_STRING -> valStr.substring(4, valStr.length - 3)
      ExpressParser.RAW_STRING -> valStr.substring(2, valStr.length - 1)
      ExpressParser.TRIPLE_STRING -> unescapeString(valStr.substring(3, valStr.length - 3))
      ExpressParser.STANDARD_STRING -> unescapeString(valStr.substring(1, valStr.length - 1))
      else -> valStr
    }
  }
}

/** Error listener collecting syntax errors from ANTLR parsing. */
class ExpressErrorListener : BaseErrorListener() {
  val errors = mutableListOf<SyntaxErrorInfo>()

  data class SyntaxErrorInfo(
    val line: Int,
    val charPositionInLine: Int,
    val msg: String,
    val isLexer: Boolean,
  )

  override fun syntaxError(
    recognizer: Recognizer<*, *>?,
    offendingSymbol: Any?,
    line: Int,
    charPositionInLine: Int,
    msg: String?,
    e: RecognitionException?,
  ) {
    val isLexer = recognizer is Lexer
    errors.add(
      SyntaxErrorInfo(
        line = line,
        charPositionInLine = charPositionInLine,
        msg = msg ?: "Syntax error",
        isLexer = isLexer,
      )
    )
  }
}
