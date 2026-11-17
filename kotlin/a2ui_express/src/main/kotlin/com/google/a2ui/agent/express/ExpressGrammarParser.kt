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

package com.google.a2ui.agent.express

import com.google.a2ui.core.Uax31Identifier

/**
 * Hand-written zero-dependency lexer, recursive-descent parser, source normalizer, and sentinel tag
 * stripper implementing `specification/inference_formats/express/Express.g4`.
 *
 * This lexer and recursive-descent parser are hand-written rather than ANTLR-generated to keep the
 * runtime dependency-free; any grammar changes to `Express.g4` must be mirrored here.
 */
internal object ExpressGrammarParser {

  private enum class TokenKind {
    IDENTIFIER,
    SYSTEM_IDENTIFIER,
    CHECK,
    PATH,
    NUMBER,
    BOOLEAN,
    NULL,
    UNDERSCORE,
    STRING,
    LPAREN,
    RPAREN,
    LBRACKET,
    RBRACKET,
    LBRACE,
    RBRACE,
    COMMA,
    COLON,
    EQUALS,
    EOF,
  }

  private data class Token(val kind: TokenKind, val text: String, val line: Int, val column: Int)

  private class SyntaxFailure(val line: Int, val column: Int, override val message: String) :
    RuntimeException("Syntax error at line $line:$column: $message")

  // Pre-parse source normalization and sentinel stripping regexes.
  private val OPEN_SENTINEL_RE = Regex("<a2ui(?:\\s[^>]*)?>", RegexOption.IGNORE_CASE)
  private val CLOSE_SENTINEL_RE = Regex("</a2ui\\s*>", RegexOption.IGNORE_CASE)
  private val SENTINEL_TOKEN_RE =
    Regex(
      """[rR]"{3}[\s\S]*?(?:"{3}|\z)|[rR]"[^\r\n"]*(?:"|\z)|"{3}(?:\\[\s\S]|[^\\])*?(?:"{3}|\z)|"(?:\\[\s\S]|[^\\"\r\n])*(?:"|\z)|(?:#|//|--)[^\r\n]*|/\*[\s\S]*?(?:\*/|\z)"""
    )
  private val SQL_COMMENT_OR_TOKEN_RE =
    Regex(
      """([rR]"{3}[\s\S]*?"{3}|[rR]"[^\r\n"]*"|"{3}(?:\\[\s\S]|[^\\])*?"{3}|"(?:\\[\s\S]|[^\\])*?"|(?:#|//)[^\r\n]*|/\*[\s\S]*?\*/)|--([^\r\n]*)"""
    )
  private val DECLARED_LHS_RE = Regex("""(?m)^[ \t]*([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*=(?!=)""")
  private val SPLIT_LHS_RE =
    Regex(
      """(?m)^([ \t]*[a-zA-Z_][a-zA-Z0-9_]*)[ \t]*(\r?\n)[ \t]*([a-zA-Z0-9_]+)(?=[ \t]*=(?!=))"""
    )
  private val SPLIT_DATA_PATH_RE =
    Regex("""(\$[a-zA-Z0-9_/]*/)[ \t]*(\r?\n)[ \t]*([a-zA-Z0-9_/]+)""")
  private val IDENT_ONLY_RE = Regex("""^[a-zA-Z_][a-zA-Z0-9_]*$""")
  private val ASSIGN_EQUALS_RE = Regex("""^[ \t]*=(?!=)""")
  private val SPLIT_ARG_IDENT_RE =
    Regex(
      """([(\[,:=][ \t]*\r?\n?[ \t]*|[(\[,:=][ \t]*)([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*(\r?\n)[ \t]*([a-zA-Z0-9_]+)(?=[ \t]*[,)\]}]|\s*\r?\n)"""
    )
  private val NUMBER_RE = Regex("""^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?""")

  /** Parses an A2UI Express DSL source block into AST statements. */
  fun parseStatements(
    dslText: String,
    isFinal: Boolean,
    stripSentinels: Boolean = true,
  ): List<ExpressStatement> {
    val stripped = if (stripSentinels) stripSentinelTags(dslText) else dslText
    val normalized = normalizeExpressSource(stripped)
    val (tokens, lexError) = lex(normalized)
    if (isFinal && lexError != null) {
      throw ExpressParseError("Failed to parse expression: ${lexError.message}", rawBlock = dslText)
    }
    val parser =
      RecursiveDescentParser(tokens, firstLexErrorLine = lexError?.line, rawBlock = dslText)
    return parser.parseProgram(isFinal = isFinal)
  }

  /** Strips outer `<a2ui>` and `</a2ui>` tags outside string literals and comments. */
  fun stripSentinelTags(source: String): String {
    val segments = ArrayList<Pair<Boolean, String>>()
    var pos = 0
    for (m in SENTINEL_TOKEN_RE.findAll(source)) {
      if (m.range.first > pos) {
        segments.add(false to source.substring(pos, m.range.first))
      }
      val tok = m.value
      val isQuotedOrBlockComment =
        tok.startsWith('"') || tok.startsWith('r') || tok.startsWith('R') || tok.startsWith("/*")
      if (!isQuotedOrBlockComment) {
        val closeM = CLOSE_SENTINEL_RE.find(tok)
        if (closeM != null) {
          if (closeM.range.first > 0) {
            segments.add(true to tok.substring(0, closeM.range.first))
          }
          segments.add(false to tok.substring(closeM.range.first))
          pos = m.range.last + 1
          continue
        }
      }
      segments.add(true to tok)
      pos = m.range.last + 1
    }
    if (pos < source.length) {
      segments.add(false to source.substring(pos))
    }

    val hasOpen = segments.any { (isTok, seg) -> !isTok && OPEN_SENTINEL_RE.containsMatchIn(seg) }
    val out = StringBuilder()
    var inside = !hasOpen
    for ((isTok, seg) in segments) {
      if (isTok) {
        if (inside) out.append(seg)
        continue
      }
      var cursor = 0
      while (cursor < seg.length) {
        if (!inside) {
          val openM = OPEN_SENTINEL_RE.find(seg, cursor) ?: break
          inside = true
          cursor = openM.range.last + 1
          continue
        }
        val closeM = CLOSE_SENTINEL_RE.find(seg, cursor)
        val openM = OPEN_SENTINEL_RE.find(seg, cursor)
        if (openM != null && (closeM == null || openM.range.first < closeM.range.first)) {
          out.append(seg, cursor, openM.range.first)
          cursor = openM.range.last + 1
          continue
        }
        if (closeM != null) {
          out.append(seg, cursor, closeM.range.first)
          inside = false
          cursor = closeM.range.last + 1
          if (!hasOpen) return out.toString()
          continue
        }
        out.append(seg, cursor, seg.length)
        break
      }
    }
    return out.toString()
  }

  /** Normalizes `--` SQL comments and line-broken identifiers/paths outside strings/comments. */
  private fun normalizeExpressSource(source: String): String {
    val segments = ArrayList<Pair<Boolean, String>>()
    var pos = 0
    for (m in SQL_COMMENT_OR_TOKEN_RE.findAll(source)) {
      if (m.range.first > pos) {
        segments.add(false to source.substring(pos, m.range.first))
      }
      val g1 = m.groups[1]?.value
      if (g1 != null) {
        segments.add(true to g1)
      } else {
        segments.add(true to "//${m.groups[2]?.value.orEmpty()}")
      }
      pos = m.range.last + 1
    }
    if (pos < source.length) {
      segments.add(false to source.substring(pos))
    }

    var depth = 0
    val segDepths = ArrayList<IntArray>(segments.size)
    for ((isTok, seg) in segments) {
      if (isTok) {
        segDepths.add(IntArray(0))
        continue
      }
      val depths = IntArray(seg.length)
      for (i in seg.indices) {
        depths[i] = depth
        when (seg[i]) {
          '(',
          '[',
          '{' -> depth++
          ')',
          ']',
          '}' -> if (depth > 0) depth--
        }
      }
      segDepths.add(depths)
    }

    val splitP2Starts = HashSet<Pair<Int, Int>>()
    for ((segIdx, pair) in segments.withIndex()) {
      val (isTok, seg) = pair
      if (!isTok) {
        val depths = segDepths[segIdx]
        for (sm in SPLIT_LHS_RE.findAll(seg)) {
          val g1 = sm.groups[1]!!
          val g3 = sm.groups[3]!!
          if (depths[g1.range.first] == 0) {
            splitP2Starts.add(segIdx to g3.range.first)
          }
        }
      }
    }

    val directDeclared = HashSet<String>()
    for ((segIdx, pair) in segments.withIndex()) {
      val (isTok, seg) = pair
      if (!isTok) {
        val depths = segDepths[segIdx]
        for (dm in DECLARED_LHS_RE.findAll(seg)) {
          val g1 = dm.groups[1]!!
          if (depths[g1.range.first] == 0 && (segIdx to g1.range.first) !in splitP2Starts) {
            directDeclared.add(g1.value)
          }
        }
      }
    }

    val declared = HashSet(directDeclared)
    for ((segIdx, pair) in segments.withIndex()) {
      val (isTok, seg) = pair
      if (!isTok) {
        val depths = segDepths[segIdx]
        for (sm in SPLIT_LHS_RE.findAll(seg)) {
          val g1 = sm.groups[1]!!
          val g3 = sm.groups[3]!!
          if (depths[g1.range.first] == 0) {
            val p1 = g1.value.trim()
            val p2 = g3.value
            if (p1 !in directDeclared && p2 !in directDeclared) {
              declared.add(p1 + p2)
            }
          }
        }
      }
    }

    val out = StringBuilder(source.length)
    for ((isTok, rawSeg) in segments) {
      if (isTok) {
        out.append(rawSeg)
        continue
      }
      var seg =
        SPLIT_DATA_PATH_RE.replace(rawSeg) { m ->
          val p1 = m.groupValues[1]
          val nl = m.groupValues[2]
          val p2 = m.groupValues[3]
          val rest = rawSeg.substring(m.range.last + 1)
          if (IDENT_ONLY_RE.matches(p2) && ASSIGN_EQUALS_RE.containsMatchIn(rest)) {
            m.value
          } else {
            "$p1$p2$nl"
          }
        }
      seg =
        SPLIT_LHS_RE.replace(seg) { m ->
          val p1Raw = m.groupValues[1]
          val nl = m.groupValues[2]
          val p2 = m.groupValues[3]
          val p1 = p1Raw.trim()
          if (p1 !in directDeclared && p2 !in directDeclared) {
            "$p1Raw$p2$nl"
          } else {
            m.value
          }
        }
      seg =
        SPLIT_ARG_IDENT_RE.replace(seg) { m ->
          val prefix = m.groupValues[1]
          val p1 = m.groupValues[2]
          val nl = m.groupValues[3]
          val p2 = m.groupValues[4]
          val joined = p1 + p2
          if (joined in declared && p1 !in declared && p2 !in declared) {
            "$prefix$joined$nl"
          } else {
            m.value
          }
        }
      out.append(seg)
    }
    return out.toString()
  }

  private fun lex(input: String): Pair<List<Token>, SyntaxFailure?> {
    val tokens = ArrayList<Token>()
    var i = 0
    var line = 1
    var col = 0
    val n = input.length

    fun advanceChar(): Char {
      val ch = input[i++]
      if (ch == '\n') {
        line++
        col = 0
      } else {
        col++
      }
      return ch
    }

    fun advanceBy(count: Int) {
      repeat(count) { advanceChar() }
    }

    while (i < n) {
      val startLine = line
      val startCol = col
      val ch = input[i]

      // Whitespace and semicolons
      if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' || ch == ';') {
        advanceChar()
        continue
      }

      // Line comments (# or //)
      if (ch == '#' || (ch == '/' && i + 1 < n && input[i + 1] == '/')) {
        while (i < n && input[i] != '\n' && input[i] != '\r') {
          advanceChar()
        }
        continue
      }

      // Block comments /* ... */
      if (ch == '/' && i + 1 < n && input[i + 1] == '*') {
        advanceBy(2)
        var closed = false
        while (i < n) {
          if (input[i] == '*' && i + 1 < n && input[i + 1] == '/') {
            advanceBy(2)
            closed = true
            break
          }
          advanceChar()
        }
        if (!closed) {
          tokens.add(Token(TokenKind.EOF, "", line, col))
          return tokens to SyntaxFailure(startLine, startCol, "Unterminated block comment.")
        }
        continue
      }

      // Raw strings: r"""...""" or r"..."
      if ((ch == 'r' || ch == 'R') && i + 1 < n && input[i + 1] == '"') {
        if (i + 3 < n && input.startsWith("\"\"\"", i + 1)) {
          val contentStart = i + 4
          val closeIdx = input.indexOf("\"\"\"", contentStart)
          if (closeIdx < 0) {
            tokens.add(Token(TokenKind.EOF, "", line, col))
            return tokens to SyntaxFailure(startLine, startCol, "Unterminated raw triple string.")
          }
          val rawVal = input.substring(contentStart, closeIdx)
          advanceBy((closeIdx + 3) - i)
          tokens.add(Token(TokenKind.STRING, rawVal, startLine, startCol))
          continue
        } else {
          val contentStart = i + 2
          var cur = contentStart
          while (cur < n && input[cur] != '"' && input[cur] != '\r' && input[cur] != '\n') {
            cur++
          }
          if (cur >= n || input[cur] != '"') {
            tokens.add(Token(TokenKind.EOF, "", line, col))
            return tokens to SyntaxFailure(startLine, startCol, "Unterminated raw string.")
          }
          val rawVal = input.substring(contentStart, cur)
          advanceBy((cur + 1) - i)
          tokens.add(Token(TokenKind.STRING, rawVal, startLine, startCol))
          continue
        }
      }

      // Triple or standard strings: """...""" or "..."
      if (ch == '"') {
        if (i + 2 < n && input[i + 1] == '"' && input[i + 2] == '"') {
          val contentStart = i + 3
          var cur = contentStart
          var closedAt = -1
          while (cur < n) {
            if (input[cur] == '\\' && cur + 1 < n) {
              cur += 2
              continue
            }
            if (
              cur + 2 < n && input[cur] == '"' && input[cur + 1] == '"' && input[cur + 2] == '"'
            ) {
              closedAt = cur
              break
            }
            cur++
          }
          if (closedAt < 0) {
            tokens.add(Token(TokenKind.EOF, "", line, col))
            return tokens to SyntaxFailure(startLine, startCol, "Unterminated triple string.")
          }
          val inner = unescapeString(input.substring(contentStart, closedAt))
          advanceBy((closedAt + 3) - i)
          tokens.add(Token(TokenKind.STRING, inner, startLine, startCol))
          continue
        } else {
          val contentStart = i + 1
          var cur = contentStart
          var closedAt = -1
          while (cur < n) {
            if (input[cur] == '\\' && cur + 1 < n) {
              cur += 2
              continue
            }
            if (input[cur] == '"') {
              closedAt = cur
              break
            }
            cur++
          }
          if (closedAt < 0) {
            tokens.add(Token(TokenKind.EOF, "", line, col))
            return tokens to SyntaxFailure(startLine, startCol, "Unterminated string literal.")
          }
          val rawInner = input.substring(contentStart, closedAt).trim('\r', '\n')
          val inner = unescapeString(rawInner)
          advanceBy((closedAt + 1) - i)
          tokens.add(Token(TokenKind.STRING, inner, startLine, startCol))
          continue
        }
      }

      // Single-character punctuation
      val punctKind =
        when (ch) {
          '(' -> TokenKind.LPAREN
          ')' -> TokenKind.RPAREN
          '[' -> TokenKind.LBRACKET
          ']' -> TokenKind.RBRACKET
          '{' -> TokenKind.LBRACE
          '}' -> TokenKind.RBRACE
          ',' -> TokenKind.COMMA
          ':' -> TokenKind.COLON
          '=' -> TokenKind.EQUALS
          else -> null
        }
      if (punctKind != null) {
        advanceChar()
        tokens.add(Token(punctKind, ch.toString(), startLine, startCol))
        continue
      }

      // Data path: '$' [a-zA-Z0-9_/]*
      if (ch == '$') {
        var cur = i + 1
        while (cur < n) {
          val c = input[cur]
          if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '_' || c == '/') {
            cur++
          } else {
            break
          }
        }
        val text = input.substring(i, cur)
        advanceBy(cur - i)
        tokens.add(Token(TokenKind.PATH, text, startLine, startCol))
        continue
      }

      // Check identifier ('?' + UAX31) or System function ('@' + UAX31)
      if (ch == '?' || ch == '@') {
        if (i + 1 >= n) {
          tokens.add(Token(TokenKind.EOF, "", line, col))
          return tokens to SyntaxFailure(startLine, startCol, "Unexpected '$ch' at end of input.")
        }
        val firstCp = input.codePointAt(i + 1)
        if (firstCp != '_'.code && !Uax31Identifier.isXidStart(firstCp)) {
          tokens.add(Token(TokenKind.EOF, "", line, col))
          return tokens to SyntaxFailure(startLine, startCol, "Invalid identifier after '$ch'.")
        }
        var cur = i + 1 + Character.charCount(firstCp)
        while (cur < n) {
          val cp = input.codePointAt(cur)
          if (Uax31Identifier.isXidContinue(cp)) {
            cur += Character.charCount(cp)
          } else {
            break
          }
        }
        val text = input.substring(i, cur)
        advanceBy(cur - i)
        val kind = if (ch == '?') TokenKind.CHECK else TokenKind.SYSTEM_IDENTIFIER
        tokens.add(Token(kind, text, startLine, startCol))
        continue
      }

      // Numeric literal
      if (ch in '0'..'9' || ch == '+' || ch == '-' || ch == '.') {
        val m = NUMBER_RE.find(input.substring(i))
        if (m != null) {
          val numText = m.value
          advanceBy(numText.length)
          tokens.add(Token(TokenKind.NUMBER, numText, startLine, startCol))
          continue
        }
      }

      // UAX #31 identifier / boolean / null / underscore
      val firstCp = input.codePointAt(i)
      if (firstCp == '_'.code || Uax31Identifier.isXidStart(firstCp)) {
        var cur = i + Character.charCount(firstCp)
        while (cur < n) {
          val cp = input.codePointAt(cur)
          if (Uax31Identifier.isXidContinue(cp)) {
            cur += Character.charCount(cp)
          } else {
            break
          }
        }
        val word = input.substring(i, cur)
        advanceBy(cur - i)
        val kind =
          when (word) {
            "true",
            "false" -> TokenKind.BOOLEAN
            "null" -> TokenKind.NULL
            "_" -> TokenKind.UNDERSCORE
            else -> TokenKind.IDENTIFIER
          }
        tokens.add(Token(kind, word, startLine, startCol))
        continue
      }

      tokens.add(Token(TokenKind.EOF, "", line, col))
      return tokens to
        SyntaxFailure(
          startLine,
          startCol,
          "Unexpected character '${input.substring(i, i + Character.charCount(firstCp))}'.",
        )
    }

    tokens.add(Token(TokenKind.EOF, "", line, col))
    return tokens to null
  }

  private fun unescapeString(raw: String): String {
    if ('\\' !in raw) return raw
    val sb = StringBuilder(raw.length)
    var i = 0
    while (i < raw.length) {
      val ch = raw[i]
      if (ch == '\\' && i + 1 < raw.length) {
        when (val next = raw[i + 1]) {
          'n' -> sb.append('\n')
          'r' -> sb.append('\r')
          't' -> sb.append('\t')
          '\\' -> sb.append('\\')
          '"' -> sb.append('"')
          else -> {
            sb.append('\\')
            sb.append(next)
          }
        }
        i += 2
      } else {
        sb.append(ch)
        i++
      }
    }
    return sb.toString()
  }

  private fun parseNumberToken(text: String, rawBlock: String): ExpressNode.NumberLiteral {
    val doubleVal = text.toDoubleOrNull()
    if (doubleVal == null || !doubleVal.isFinite()) {
      throw ExpressParseError("Number literal $text is out of range.", rawBlock = rawBlock)
    }
    if (text.any { it == '.' || it == 'e' || it == 'E' }) {
      return ExpressNode.NumberLiteral.FloatVal(doubleVal)
    }
    val negative = text.startsWith('-')
    val unsigned = text.trimStart('+', '-').trimStart('0').ifEmpty { "0" }
    val signedText = if (negative && unsigned != "0") "-$unsigned" else unsigned
    return ExpressNode.NumberLiteral.IntVal(
      rawDigits = unsigned,
      negative = negative,
      longOrNull = signedText.toLongOrNull(),
    )
  }

  private class RecursiveDescentParser(
    private val tokens: List<Token>,
    private val firstLexErrorLine: Int?,
    private val rawBlock: String,
  ) {
    private var pos = 0

    private fun peek(offset: Int = 0): Token = tokens.getOrElse(pos + offset) { tokens.last() }

    private fun advance(): Token {
      val tok = peek()
      if (pos < tokens.lastIndex) pos++
      return tok
    }

    private fun expect(kind: TokenKind): Token {
      val tok = peek()
      if (tok.kind != kind) {
        throw SyntaxFailure(tok.line, tok.column, "Expected $kind, got ${tok.kind} ('${tok.text}')")
      }
      return advance()
    }

    fun parseProgram(isFinal: Boolean): List<ExpressStatement> {
      val statements = ArrayList<ExpressStatement>()
      while (peek().kind != TokenKind.EOF) {
        val startTok = peek()
        if (firstLexErrorLine != null && startTok.line >= firstLexErrorLine) {
          if (isFinal) {
            throw ExpressParseError(
              "Failed to parse expression near line ${startTok.line}.",
              rawBlock = rawBlock,
            )
          }
          break
        }
        try {
          statements.add(parseStatement())
        } catch (e: ExpressParseError) {
          // Deliberately rejected literals (e.g. out-of-range numbers like 1e999) propagate always.
          throw e
        } catch (e: SyntaxFailure) {
          if (isFinal) {
            throw ExpressParseError(
              "Failed to parse expression: ${e.message}",
              rawBlock = rawBlock,
              cause = e,
            )
          }
          break
        }
      }
      return statements
    }

    private fun parseStatement(): ExpressStatement {
      val t0 = peek(0)
      val t1 = peek(1)
      if (
        (t0.kind == TokenKind.IDENTIFIER || t0.kind == TokenKind.PATH) &&
          t1.kind == TokenKind.EQUALS
      ) {
        val target = advance().text
        advance() // '='
        val expr = parseExpression()
        return ExpressStatement.Assignment(target, expr)
      }
      return ExpressStatement.Expression(parseExpression())
    }

    private fun parseExpression(): ExpressNode {
      val t0 = peek(0)
      return when (t0.kind) {
        TokenKind.LBRACKET -> parseArray()
        TokenKind.LBRACE -> parseMap()
        TokenKind.PATH -> ExpressNode.PathNode(advance().text.substring(1))
        TokenKind.CHECK -> parseCheck()
        TokenKind.SYSTEM_IDENTIFIER -> parseCall()
        TokenKind.IDENTIFIER -> {
          if (peek(1).kind == TokenKind.LPAREN) {
            parseCall()
          } else {
            ExpressNode.VariableNode(advance().text)
          }
        }
        TokenKind.UNDERSCORE -> {
          advance()
          ExpressNode.SkippedNode
        }
        TokenKind.STRING -> ExpressNode.StringLiteral(advance().text)
        TokenKind.NUMBER -> parseNumberToken(advance().text, rawBlock)
        TokenKind.BOOLEAN -> ExpressNode.BooleanLiteral(advance().text == "true")
        TokenKind.NULL -> {
          advance()
          ExpressNode.NullLiteral
        }
        else ->
          throw SyntaxFailure(
            t0.line,
            t0.column,
            "Unexpected token ${t0.kind} ('${t0.text}') where expression was expected",
          )
      }
    }

    private fun parseArray(): ExpressNode.ArrayNode {
      expect(TokenKind.LBRACKET)
      val items = ArrayList<ExpressNode>()
      if (peek().kind != TokenKind.RBRACKET) {
        items.add(parseExpression())
        while (peek().kind == TokenKind.COMMA) {
          advance()
          if (peek().kind == TokenKind.RBRACKET) break
          items.add(parseExpression())
        }
      }
      expect(TokenKind.RBRACKET)
      return ExpressNode.ArrayNode(items)
    }

    private fun parseMap(): ExpressNode.MapNode {
      expect(TokenKind.LBRACE)
      val entries = LinkedHashMap<String, ExpressNode>()
      if (peek().kind != TokenKind.RBRACE) {
        val (k0, v0) = parseMapEntry()
        entries[k0] = v0
        while (peek().kind == TokenKind.COMMA) {
          advance()
          if (peek().kind == TokenKind.RBRACE) break
          val (k, v) = parseMapEntry()
          entries[k] = v
        }
      }
      expect(TokenKind.RBRACE)
      return ExpressNode.MapNode(entries)
    }

    private fun parseMapEntry(): Pair<String, ExpressNode> {
      val keyTok = peek()
      val key =
        when (keyTok.kind) {
          TokenKind.IDENTIFIER -> advance().text
          TokenKind.STRING -> advance().text
          else ->
            throw SyntaxFailure(
              keyTok.line,
              keyTok.column,
              "Map key must be an identifier or string literal, got ${keyTok.kind} ('${keyTok.text}')",
            )
        }
      expect(TokenKind.COLON)
      val value = parseExpression()
      return key to value
    }

    private fun parseCheck(): ExpressNode.CheckNode {
      val name = expect(TokenKind.CHECK).text.substring(1)
      val args = ArrayList<ExpressNode>()
      if (peek().kind == TokenKind.LPAREN) {
        advance()
        if (peek().kind != TokenKind.RPAREN) {
          args.add(parseExpression())
          while (peek().kind == TokenKind.COMMA) {
            advance()
            if (peek().kind == TokenKind.RPAREN) break
            args.add(parseExpression())
          }
        }
        expect(TokenKind.RPAREN)
      }
      return ExpressNode.CheckNode(name, args)
    }

    private fun parseCall(): ExpressNode.CallNode {
      val fnTok = peek()
      if (fnTok.kind != TokenKind.IDENTIFIER && fnTok.kind != TokenKind.SYSTEM_IDENTIFIER) {
        throw SyntaxFailure(fnTok.line, fnTok.column, "Expected function or component name")
      }
      val fnName = advance().text
      expect(TokenKind.LPAREN)
      val args = ArrayList<ExpressNode>()
      val kwargs = LinkedHashMap<String, ExpressNode>()
      val kwargList = ArrayList<Pair<String, ExpressNode>>()
      if (peek().kind != TokenKind.RPAREN) {
        parseArg(args, kwargs, kwargList)
        while (peek().kind == TokenKind.COMMA) {
          advance()
          if (peek().kind == TokenKind.RPAREN) break
          parseArg(args, kwargs, kwargList)
        }
      }
      expect(TokenKind.RPAREN)
      return ExpressNode.CallNode(fnName, args, kwargs, kwargList)
    }

    private fun parseArg(
      args: MutableList<ExpressNode>,
      kwargs: MutableMap<String, ExpressNode>,
      kwargList: MutableList<Pair<String, ExpressNode>>,
    ) {
      if (peek(0).kind == TokenKind.IDENTIFIER && peek(1).kind == TokenKind.EQUALS) {
        val key = advance().text
        advance() // '='
        val value = parseExpression()
        kwargs[key] = value
        kwargList.add(key to value)
      } else {
        args.add(parseExpression())
      }
    }
  }
}
