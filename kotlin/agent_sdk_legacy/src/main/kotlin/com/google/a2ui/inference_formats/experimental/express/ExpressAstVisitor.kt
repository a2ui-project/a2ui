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

package com.google.a2ui.inference_formats.experimental.express

import com.google.a2ui.inference_formats.experimental.express.generated.ExpressBaseVisitor
import com.google.a2ui.inference_formats.experimental.express.generated.ExpressLexer
import com.google.a2ui.inference_formats.experimental.express.generated.ExpressParser as AntlrExpressParser
import org.antlr.v4.runtime.BaseErrorListener
import org.antlr.v4.runtime.CharStreams
import org.antlr.v4.runtime.CommonTokenStream
import org.antlr.v4.runtime.RecognitionException
import org.antlr.v4.runtime.Recognizer

/** Top-level statement in an Express block. */
internal sealed interface ExpressStmt {
  val line: Int
  val column: Int

  data class Assign(
    val target: String,
    val value: ExpressNode,
    override val line: Int,
    override val column: Int,
  ) : ExpressStmt

  data class Expr(val value: ExpressNode, override val line: Int, override val column: Int) :
    ExpressStmt
}

/** Typed AST node for Express values, preventing collision with map literal keys. */
internal sealed interface ExpressNode {
  data class Str(val value: String) : ExpressNode

  data class Num(val longValue: Long?, val doubleValue: Double) : ExpressNode

  data class Bool(val value: Boolean) : ExpressNode

  data object Null : ExpressNode

  data class Path(val path: String) : ExpressNode

  data class Check(
    val name: String,
    val args: List<ExpressNode>,
    val kwargs: Map<String, ExpressNode>,
    val line: Int,
    val column: Int,
  ) : ExpressNode

  data class VarRef(val name: String, val line: Int, val column: Int) : ExpressNode

  data object Skipped : ExpressNode

  data class Call(
    val name: String,
    val args: List<ExpressNode>,
    val kwargs: Map<String, ExpressNode>,
    val line: Int,
    val column: Int,
  ) : ExpressNode

  data class Arr(val items: List<ExpressNode>) : ExpressNode

  data class MapLit(val entries: Map<String, ExpressNode>) : ExpressNode
}

internal data class ExpressSyntaxErrorDetail(
  val line: Int,
  val column: Int,
  val message: String,
  val isLexer: Boolean,
)

internal data class ParsedExpressProgram(
  val statements: List<ExpressStmt>,
  val errors: List<ExpressSyntaxErrorDetail>,
)

/** Parses normalized Express DSL text using the generated ANTLR4 lexer and parser. */
internal fun parseExpressSource(dslText: String): ParsedExpressProgram {
  val normalized = normalizeExpressSource(dslText)
  val errors = mutableListOf<ExpressSyntaxErrorDetail>()

  val lexer = ExpressLexer(CharStreams.fromString(normalized))
  lexer.removeErrorListeners()
  lexer.addErrorListener(
    object : BaseErrorListener() {
      override fun syntaxError(
        recognizer: Recognizer<*, *>?,
        offendingSymbol: Any?,
        line: Int,
        charPositionInLine: Int,
        msg: String?,
        e: RecognitionException?,
      ) {
        errors.add(ExpressSyntaxErrorDetail(line, charPositionInLine, msg ?: "Lexer error", true))
      }
    }
  )

  val tokens = CommonTokenStream(lexer)
  val parser = AntlrExpressParser(tokens)
  parser.removeErrorListeners()
  parser.addErrorListener(
    object : BaseErrorListener() {
      override fun syntaxError(
        recognizer: Recognizer<*, *>?,
        offendingSymbol: Any?,
        line: Int,
        charPositionInLine: Int,
        msg: String?,
        e: RecognitionException?,
      ) {
        errors.add(ExpressSyntaxErrorDetail(line, charPositionInLine, msg ?: "Syntax error", false))
      }
    }
  )

  val tree = parser.program()
  if (errors.isNotEmpty()) {
    return ParsedExpressProgram(emptyList(), errors)
  }
  val visitor = ExpressAstVisitor()
  val statements = visitor.visitProgramStatements(tree)
  return ParsedExpressProgram(statements, emptyList())
}

/**
 * Normalizes LLM-produced quirks outside string and block-comment literals:
 * - Converts SQL-style `--` single-line comments into `//` comments.
 * - Rejoins identifiers or `$/path/` tokens broken across a newline when the rejoined identifier
 *   resolves to a variable declared in the block (preserving line numbers).
 */
internal fun normalizeExpressSource(source: String): String {
  if (source.isEmpty()) return source

  // Pass 1: mask strings and comments while converting `--` comments outside strings to `//`
  val chars = source.toCharArray()
  val outsideMask = BooleanArray(chars.size)
  var i = 0
  val n = chars.size
  while (i < n) {
    // Raw triple-quoted string r"""..."""
    if (
      chars[i] == 'r' &&
        i + 3 < n &&
        chars[i + 1] == '"' &&
        chars[i + 2] == '"' &&
        chars[i + 3] == '"'
    ) {
      i += 4
      while (i < n) {
        if (i + 2 < n && chars[i] == '"' && chars[i + 1] == '"' && chars[i + 2] == '"') {
          i += 3
          break
        }
        i++
      }
      continue
    }
    // Triple-quoted string """..."""
    if (i + 2 < n && chars[i] == '"' && chars[i + 1] == '"' && chars[i + 2] == '"') {
      i += 3
      while (i < n) {
        if (chars[i] == '\\' && i + 1 < n) {
          i += 2
          continue
        }
        if (i + 2 < n && chars[i] == '"' && chars[i + 1] == '"' && chars[i + 2] == '"') {
          i += 3
          break
        }
        i++
      }
      continue
    }
    // Raw single-line string r"..."
    if (chars[i] == 'r' && i + 1 < n && chars[i + 1] == '"') {
      i += 2
      while (i < n && chars[i] != '"') {
        i++
      }
      if (i < n) i++
      continue
    }
    // Standard string "..."
    if (chars[i] == '"') {
      i++
      while (i < n) {
        if (chars[i] == '\\' && i + 1 < n) {
          i += 2
          continue
        }
        if (chars[i] == '"') {
          i++
          break
        }
        i++
      }
      continue
    }
    // Block comment /* ... */
    if (i + 1 < n && chars[i] == '/' && chars[i + 1] == '*') {
      i += 2
      while (i < n) {
        if (i + 1 < n && chars[i] == '*' && chars[i + 1] == '/') {
          i += 2
          break
        }
        i++
      }
      continue
    }
    // Single-line comments #, //, and SQL --
    if (
      chars[i] == '#' ||
        (i + 1 < n && chars[i] == '/' && chars[i + 1] == '/') ||
        (i + 1 < n && chars[i] == '-' && chars[i + 1] == '-')
    ) {
      if (i + 1 < n && chars[i] == '-' && chars[i + 1] == '-') {
        chars[i] = '/'
        chars[i + 1] = '/'
      }
      while (i < n && chars[i] != '\n') {
        i++
      }
      continue
    }
    outsideMask[i] = true
    i++
  }

  val step1 = String(chars)
  if (!step1.contains('\n')) return step1

  // Collect declared LHS identifiers in the block so line-broken references can be rejoined safely.
  val declaredVars = collectDeclaredVariables(step1, outsideMask)
  return rejoinLineBrokenTokens(step1, outsideMask, declaredVars)
}

private val ASSIGN_LHS_REGEX = Regex("""(?:^|[;\n])\s*([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)""")
private val SPLIT_ASSIGN_LHS_REGEX =
  Regex("""(?:^|[;\n])[ \t]*([\p{L}_][\p{L}\p{N}_]*)\r?\n[ \t]*([\p{L}\p{N}_]+)[ \t]*=(?!=)""")

private fun collectDeclaredVariables(text: String, outsideMask: BooleanArray): Set<String> {
  val result = HashSet<String>()
  for (m in ASSIGN_LHS_REGEX.findAll(text)) {
    val group = m.groups[1] ?: continue
    if (group.range.first < outsideMask.size && outsideMask[group.range.first]) {
      result.add(group.value)
    }
  }
  for (m in SPLIT_ASSIGN_LHS_REGEX.findAll(text)) {
    val g1 = m.groups[1] ?: continue
    val g2 = m.groups[2] ?: continue
    if (
      g1.range.first < outsideMask.size &&
        outsideMask[g1.range.first] &&
        g2.range.first < outsideMask.size &&
        outsideMask[g2.range.first]
    ) {
      result.add(g1.value + g2.value)
    }
  }
  return result
}

private fun isIdentContChar(ch: Char): Boolean = ch.isLetterOrDigit() || ch == '_'

private fun isPathContChar(ch: Char): Boolean =
  (ch in 'a'..'z') || (ch in 'A'..'Z') || (ch in '0'..'9') || ch == '_' || ch == '/'

private fun rejoinLineBrokenTokens(
  text: String,
  outsideMask: BooleanArray,
  declaredVars: Set<String>,
): String {
  val sb = StringBuilder(text.length)
  var i = 0
  val n = text.length
  while (i < n) {
    if (!outsideMask[i]) {
      sb.append(text[i])
      i++
      continue
    }

    // Check for `$path/` broken across a newline: `$/foo/\n  bar` (unless next line is `ident =
    // ...`)
    if (text[i] == '$') {
      val pathStart = sb.length
      sb.append('$')
      i++
      while (true) {
        while (i < n && outsideMask[i] && isPathContChar(text[i])) {
          sb.append(text[i])
          i++
        }
        // Only rejoin across newline when the path so far ends with '/' or '$'
        val lastChar = sb[sb.length - 1]
        if (lastChar == '/' || lastChar == '$') {
          var j = i
          var newlines = 0
          if (j < n && outsideMask[j] && text[j] == '\r') j++
          if (j < n && outsideMask[j] && text[j] == '\n') {
            j++
            newlines = 1
            while (j < n && outsideMask[j] && (text[j] == ' ' || text[j] == '\t')) {
              j++
            }
            if (
              j < n &&
                outsideMask[j] &&
                isPathContChar(text[j]) &&
                !startsAssignmentOnLine(text, outsideMask, j)
            ) {
              // Append the continuation segment first, then emit the newline after the complete
              // token!
              var k = j
              while (k < n && outsideMask[k] && isPathContChar(text[k])) {
                sb.append(text[k])
                k++
              }
              // Keep following continuations if still ending with '/', else emit preserved newlines
              // after token
              var totalNewlines = newlines
              while (sb[sb.length - 1] == '/') {
                var j2 = k
                if (j2 < n && outsideMask[j2] && text[j2] == '\r') j2++
                if (j2 < n && outsideMask[j2] && text[j2] == '\n') {
                  j2++
                  while (j2 < n && outsideMask[j2] && (text[j2] == ' ' || text[j2] == '\t')) j2++
                  if (
                    j2 < n &&
                      outsideMask[j2] &&
                      isPathContChar(text[j2]) &&
                      !startsAssignmentOnLine(text, outsideMask, j2)
                  ) {
                    totalNewlines++
                    k = j2
                    while (k < n && outsideMask[k] && isPathContChar(text[k])) {
                      sb.append(text[k])
                      k++
                    }
                    continue
                  }
                }
                break
              }
              repeat(totalNewlines) { sb.append('\n') }
              i = k
              break
            }
          }
        }
        break
      }
      if (sb.length > pathStart) continue
    }

    // Check for identifier broken across a newline (`sub\n  title` -> `subtitle\n`) when rejoined
    // name is declared
    if (text[i].isLetter() || text[i] == '_') {
      val firstStart = i
      var end1 = i
      while (end1 < n && outsideMask[end1] && isIdentContChar(text[end1])) {
        end1++
      }
      val part1 = text.substring(firstStart, end1)
      var j = end1
      if (j < n && outsideMask[j] && text[j] == '\r') j++
      if (j < n && outsideMask[j] && text[j] == '\n') {
        j++
        while (j < n && outsideMask[j] && (text[j] == ' ' || text[j] == '\t')) {
          j++
        }
        if (j < n && outsideMask[j] && isIdentContChar(text[j])) {
          var end2 = j
          while (end2 < n && outsideMask[end2] && isIdentContChar(text[end2])) {
            end2++
          }
          val part2 = text.substring(j, end2)
          val joined = part1 + part2
          val isSplitLhs =
            startsAssignmentOnLine(text, outsideMask, j) &&
              isLineStartBefore(text, outsideMask, firstStart)
          if (
            (isSplitLhs && !(part1 in declaredVars && part2 in declaredVars)) ||
              (!startsAssignmentOnLine(text, outsideMask, j) &&
                joined in declaredVars &&
                !(part1 in declaredVars && part2 in declaredVars))
          ) {
            sb.append(joined).append('\n')
            i = end2
            continue
          }
        }
      }
      sb.append(part1)
      i = end1
      continue
    }

    sb.append(text[i])
    i++
  }
  return sb.toString()
}

private fun startsAssignmentOnLine(text: String, outsideMask: BooleanArray, pos: Int): Boolean {
  var k = pos
  val n = text.length
  if (k >= n || !outsideMask[k] || !isIdentContChar(text[k])) return false
  while (k < n && outsideMask[k] && isIdentContChar(text[k])) {
    k++
  }
  while (k < n && outsideMask[k] && (text[k] == ' ' || text[k] == '\t')) {
    k++
  }
  return k < n && outsideMask[k] && text[k] == '=' && (k + 1 >= n || text[k + 1] != '=')
}

private fun isLineStartBefore(text: String, outsideMask: BooleanArray, pos: Int): Boolean {
  var k = pos - 1
  while (k >= 0 && outsideMask[k] && (text[k] == ' ' || text[k] == '\t')) {
    k--
  }
  return k < 0 || text[k] == '\n' || text[k] == ';'
}

/** Transforms the ANTLR4 parse tree into typed [ExpressStmt] and [ExpressNode] structures. */
internal class ExpressAstVisitor : ExpressBaseVisitor<Any?>() {

  fun visitProgramStatements(ctx: AntlrExpressParser.ProgramContext): List<ExpressStmt> =
    ctx.statement().map { visitStatementNode(it) }

  private fun visitStatementNode(ctx: AntlrExpressParser.StatementContext): ExpressStmt {
    val start = ctx.getStart()
    val line = start.line
    val col = start.charPositionInLine
    val assign = ctx.assignment()
    if (assign != null) {
      val target = assign.identifier()?.text ?: assign.path().text
      val value = visitExpressionNode(assign.expression())
      return ExpressStmt.Assign(target = target, value = value, line = line, column = col)
    }
    return ExpressStmt.Expr(
      value = visitExpressionNode(ctx.expression()),
      line = line,
      column = col,
    )
  }

  private fun visitExpressionNode(ctx: AntlrExpressParser.ExpressionContext): ExpressNode {
    ctx.call()?.let {
      return visitCallNode(it)
    }
    ctx.array()?.let {
      return visitArrayNode(it)
    }
    ctx.map()?.let {
      return visitMapNode(it)
    }
    ctx.literal()?.let {
      return visitLiteralNode(it)
    }
    ctx.path()?.let {
      return ExpressNode.Path(it.PATH().text.substring(1))
    }
    ctx.check()?.let {
      return visitCheckNode(it)
    }
    ctx.variable()?.let { varCtx ->
      val ident = varCtx.identifier()
      return if (ident != null) {
        val tok = ident.getStart()
        ExpressNode.VarRef(ident.text, tok.line, tok.charPositionInLine)
      } else {
        ExpressNode.Skipped
      }
    }
    return ExpressNode.Skipped
  }

  private fun visitCallNode(ctx: AntlrExpressParser.CallContext): ExpressNode.Call {
    val tok = ctx.getStart()
    val fnName = ctx.function_name().text
    val args = mutableListOf<ExpressNode>()
    val kwargs = LinkedHashMap<String, ExpressNode>()
    var seenKeyword = false

    for (argCtx in ctx.arg()) {
      val named = argCtx.named_arg()
      if (named != null) {
        seenKeyword = true
        val key = named.identifier().text
        val kwTok = named.getStart()
        if (kwargs.containsKey(key)) {
          throw ExpressValidationError(
            "Duplicate keyword argument '$key' in call to '$fnName'.",
            line = kwTok.line,
            column = kwTok.charPositionInLine,
          )
        }
        kwargs[key] = visitExpressionNode(named.expression())
      } else {
        if (seenKeyword) {
          val posTok = argCtx.getStart()
          throw ExpressParseError(
            "Positional argument cannot follow keyword argument in call to '$fnName'.",
            line = posTok.line,
            column = posTok.charPositionInLine,
          )
        }
        args.add(visitExpressionNode(argCtx.expression()))
      }
    }
    return ExpressNode.Call(
      name = fnName,
      args = args,
      kwargs = kwargs,
      line = tok.line,
      column = tok.charPositionInLine,
    )
  }

  private fun visitCheckNode(ctx: AntlrExpressParser.CheckContext): ExpressNode.Check {
    val tok = ctx.getStart()
    val checkName = ctx.CHECK().text.substring(1)
    val args = ctx.expression().map { visitExpressionNode(it) }
    return ExpressNode.Check(
      name = checkName,
      args = args,
      kwargs = emptyMap(),
      line = tok.line,
      column = tok.charPositionInLine,
    )
  }

  private fun visitArrayNode(ctx: AntlrExpressParser.ArrayContext): ExpressNode.Arr =
    ExpressNode.Arr(ctx.expression().map { visitExpressionNode(it) })

  private fun visitMapNode(ctx: AntlrExpressParser.MapContext): ExpressNode.MapLit {
    val entries = LinkedHashMap<String, ExpressNode>()
    for (entry in ctx.map_entry()) {
      val tok = entry.getStart()
      val key =
        entry.identifier()?.text
          ?: parseStringToken(entry.string(), tok.line, tok.charPositionInLine)
      if (entries.containsKey(key)) {
        throw ExpressValidationError(
          "Duplicate key '$key' in map literal.",
          line = tok.line,
          column = tok.charPositionInLine,
        )
      }
      entries[key] = visitExpressionNode(entry.expression())
    }
    return ExpressNode.MapLit(entries)
  }

  private fun visitLiteralNode(ctx: AntlrExpressParser.LiteralContext): ExpressNode {
    ctx.string()?.let {
      val tok = it.getStart()
      return ExpressNode.Str(parseStringToken(it, tok.line, tok.charPositionInLine))
    }
    ctx.NUMBER()?.let { numNode ->
      val tok = numNode.symbol
      return parseNumberToken(numNode.text, tok.line, tok.charPositionInLine)
    }
    ctx.BOOLEAN()?.let {
      return ExpressNode.Bool(it.text == "true")
    }
    return ExpressNode.Null
  }

  private fun parseNumberToken(raw: String, line: Int, col: Int): ExpressNode.Num {
    val trimmed = if (raw.startsWith("+")) raw.substring(1) else raw
    val doubleVal =
      trimmed.toDoubleOrNull()
        ?: throw ExpressParseError("Invalid number literal '$raw'.", line = line, column = col)
    if (!doubleVal.isFinite()) {
      throw ExpressParseError("Number literal '$raw' is out of range.", line = line, column = col)
    }
    // Preserve exact integer representation up to ±(2^53 - 1) when written without
    // fraction/exponent,
    // or when an integer-valued exponent/trailing-dot literal fits cleanly as an exact integer.
    val isPlainInteger = !trimmed.contains('.') && !trimmed.contains('e') && !trimmed.contains('E')
    if (isPlainInteger) {
      val longVal = trimmed.toLongOrNull()
      if (longVal != null && longVal in -MAX_SAFE_INTEGER..MAX_SAFE_INTEGER) {
        if (!(longVal == 0L && trimmed.startsWith("-"))) {
          return ExpressNode.Num(longValue = longVal, doubleValue = doubleVal)
        }
      }
    } else if (
      doubleVal % 1.0 == 0.0 &&
        !(doubleVal == 0.0 && 1.0 / doubleVal < 0.0) &&
        doubleVal >= -MAX_SAFE_INTEGER.toDouble() &&
        doubleVal <= MAX_SAFE_INTEGER.toDouble()
    ) {
      // Note: in JSON (`1e2`, `1.`), integer-valued doubles compare equal to JSON integers in
      // conformance, and emitting Long when exact matches TypeScript/JavaScript JSON.stringify!
      val hasFractionalNonZero =
        trimmed.contains('.') &&
          !trimmed.contains('e') &&
          !trimmed.contains('E') &&
          trimmed.substringAfter('.').isNotEmpty()
      if (!hasFractionalNonZero) {
        return ExpressNode.Num(longValue = doubleVal.toLong(), doubleValue = doubleVal)
      }
    }
    return ExpressNode.Num(longValue = null, doubleValue = doubleVal)
  }

  private fun parseStringToken(ctx: AntlrExpressParser.StringContext, line: Int, col: Int): String {
    ctx.RAW_TRIPLE_STRING()?.let {
      return stripTripleStringDelimiter(it.text.substring(4, it.text.length - 3))
    }
    ctx.TRIPLE_STRING()?.let {
      val inner = stripTripleStringDelimiter(it.text.substring(3, it.text.length - 3))
      return unescapeExpressString(inner, line, col)
    }
    ctx.RAW_STRING()?.let {
      val rawInner = it.text.substring(2, it.text.length - 1)
      return rawInner
    }
    val stdText = ctx.STANDARD_STRING().text
    val inner = stdText.substring(1, stdText.length - 1).replace(EDGE_NEWLINES_REGEX, "")
    return unescapeExpressString(inner, line, col)
  }

  private fun stripTripleStringDelimiter(inner: String): String {
    if (inner.startsWith("\r\n")) return inner.substring(2)
    if (inner.startsWith("\n")) return inner.substring(1)
    return inner
  }

  private fun unescapeExpressString(s: String, line: Int, col: Int): String {
    if (!s.contains('\\')) return s
    val sb = StringBuilder(s.length)
    var i = 0
    while (i < s.length) {
      val c = s[i]
      if (c != '\\') {
        sb.append(c)
        i++
        continue
      }
      if (i + 1 >= s.length) {
        throw ExpressParseError("Trailing backslash in string literal.", line = line, column = col)
      }
      when (val next = s[i + 1]) {
        '"' -> {
          sb.append('"')
          i += 2
        }
        '\\' -> {
          sb.append('\\')
          i += 2
        }
        '/' -> {
          sb.append('/')
          i += 2
        }
        'b' -> {
          sb.append('\b')
          i += 2
        }
        'f' -> {
          sb.append('\u000C')
          i += 2
        }
        'n' -> {
          sb.append('\n')
          i += 2
        }
        'r' -> {
          sb.append('\r')
          i += 2
        }
        't' -> {
          sb.append('\t')
          i += 2
        }
        'u' -> {
          if (i + 5 >= s.length) {
            throw ExpressParseError(
              "Incomplete \\uXXXX escape sequence.",
              line = line,
              column = col,
            )
          }
          val hex = s.substring(i + 2, i + 6)
          val code =
            hex.toIntOrNull(16)
              ?: throw ExpressParseError(
                "Invalid unicode escape '\\u$hex'.",
                line = line,
                column = col,
              )
          sb.append(code.toChar())
          i += 6
        }
        else -> {
          throw ExpressParseError("Invalid escape sequence '\\$next'.", line = line, column = col)
        }
      }
    }
    return sb.toString()
  }

  companion object {
    private const val MAX_SAFE_INTEGER = 9007199254740991L
    private val EDGE_NEWLINES_REGEX = Regex("^[\\r\\n]+|[\\r\\n]+$")
  }
}
