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

import com.google.a2ui.exceptions.A2uiException
import com.google.a2ui.exceptions.A2uiParseException
import com.google.a2ui.parser.ResponsePart
import com.google.a2ui.parser.errors.A2uiCompilationError
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiConstants
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Default property keys whose unclosed string literals stream progressively before closing `"`. */
val DEFAULT_EXPRESS_PROGRESSIVE_KEYS: Set<String> = setOf("text")

/** Exception wrapper carrying partial stream parts when an uncompiled stream error occurs. */
class ExpressStreamInterruptedException(
  val causeException: A2uiException,
  val streamPartialParts: List<ExpressStreamPart>,
) : A2uiException(causeException.message ?: "Stream failed", causeException)

/**
 * Incremental streaming reader for A2UI Express DSL responses (`<a2ui>...</a2ui>`).
 *
 * Supports split sentinel tags, outer markdown fences, top-down and pre-root held component
 * emission, forward component ID superseding, progressive string healing (`progressiveKeys`),
 * `partialResults` on error, and `afterRejectedBlock = "continue"` recovery.
 */
class ExpressResponseStream(
  val catalogs: List<A2uiCatalog>,
  val surfaceId: String = "default_surface",
  version: String? = null,
  val wrapped: Boolean = true,
  state: ExpressRendererState? = null,
  val afterRejectedBlock: String = "end",
  val progressiveKeys: Set<String> = DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
) {
  val state: ExpressRendererState = state ?: ExpressRendererState(catalogs)
  val version: String = resolveExpressVersion(catalogs, version)
  private val continues: Boolean = afterRejectedBlock == "continue"
  private val compiler = ExpressCompiler(catalogs, this.version)

  private var closed = false
  private var held = ""
  private val textRun = StreamTextRun()
  private var afterBlock = false
  private var wrappedInInlineBackticks = false
  private var inBlock: Boolean = !wrapped
  private var rejected = false
  private var block = StringBuilder()
  private var scanPos = 0
  private var lastCompiledPrefix = ""
  private var touched = LinkedHashSet<String>()
  private var initialSurfaces: Set<String> = this.state.surfaceIds
  private var session = newSession()

  /** Partial parts emitted in the failing call (`feed` or `close`) when an exception is thrown. */
  var lastFailurePartialParts: List<ExpressStreamPart> = emptyList()
    private set

  val isInBlock: Boolean
    get() = !closed && inBlock

  private fun newSession(): ExpressScopeSession =
    ExpressScopeSession(compiler, surfaceId = surfaceId, version = version)

  private fun resetBlock() {
    block.setLength(0)
    scanPos = 0
    rejected = false
    lastCompiledPrefix = ""
    touched = LinkedHashSet()
    initialSurfaces = state.surfaceIds
    session = newSession()
  }

  fun feed(chunk: String): List<ExpressStreamPart> {
    check(!closed) { "The response stream is closed." }
    val parts = mutableListOf<ExpressStreamPart>()
    try {
      readChunk(chunk, parts)
    } catch (t: Throwable) {
      failStream()
      throw attachPartials(t, parts.filter { it !is ExpressStreamPart.Error })
    }
    return parts
  }

  fun close(): List<ExpressStreamPart> {
    if (closed) return emptyList()
    closed = true
    val parts = mutableListOf<ExpressStreamPart>()
    try {
      if (!wrapped) {
        if (!rejected) {
          readBlockStep(parts) { finishBlock(parts, block.length) }
        }
        return parts
      }
      if (inBlock) {
        if (!rejected) {
          readBlockStep(parts) {
            throw A2uiParseException(
              "The response ended inside an ${A2uiConstants.A2UI_INFERENCE_OPEN_TAG} block, before its ${A2uiConstants.A2UI_INFERENCE_CLOSE_TAG} tag."
            )
          }
        }
        state.markChecked(touched)
        return parts
      }
    } catch (t: Throwable) {
      failStream()
      throw attachPartials(t, parts.filter { it !is ExpressStreamPart.Error })
    }

    if (held.isNotEmpty()) {
      var rest = held
      held = ""
      if (afterBlock) {
        val fenceRegex =
          if (wrappedInInlineBackticks) OUTER_LEADING_FENCE_INLINE_REGEX
          else OUTER_LEADING_FENCE_REGEX
        rest = rest.replace(fenceRegex, "")
        wrappedInInlineBackticks = false
      }
      textRun.emit(parts, rest.replace(TRAILING_FENCE_CLOSE_REGEX, ""))
    }
    return parts
  }

  private fun failStream() {
    closed = true
    state.markChecked(touched)
  }

  private fun attachPartials(t: Throwable, partial: List<ExpressStreamPart>): Throwable {
    lastFailurePartialParts = partial
    if (t is A2uiCompilationError) {
      t.partialResults = toLegacyResponseParts(partial)
    }
    return t
  }

  private fun readBlockStep(parts: MutableList<ExpressStreamPart>, step: () -> Unit) {
    try {
      step()
    } catch (e: A2uiException) {
      if (!continues) throw e
      parts.add(ExpressStreamPart.Error(e))
      state.markChecked(touched)
      rejected = true
    }
  }

  private fun readChunk(chunk: String, parts: MutableList<ExpressStreamPart>) {
    if (!wrapped) {
      block.append(chunk)
      if (!rejected) {
        readBlockStep(parts) { emitReady(parts, block.length) }
      }
      return
    }

    var input = held + chunk
    held = ""
    while (input.isNotEmpty()) {
      if (inBlock) {
        input = consumeBlockText(parts, input)
        continue
      }
      if (afterBlock) {
        val prefixRegex =
          if (wrappedInInlineBackticks) OUTER_LEADING_FENCE_INLINE_PREFIX_REGEX
          else OUTER_LEADING_FENCE_PREFIX_REGEX
        val fenceRegex =
          if (wrappedInInlineBackticks) OUTER_LEADING_FENCE_INLINE_REGEX
          else OUTER_LEADING_FENCE_REGEX
        if (prefixRegex.matches(input)) {
          held = input
          return
        }
        afterBlock = false
        wrappedInInlineBackticks = false
        input = input.replace(fenceRegex, "")
        continue
      }
      input = consumeOutsideText(parts, input)
    }
  }

  private fun consumeBlockText(parts: MutableList<ExpressStreamPart>, input: String): String {
    block.append(input)
    val content = block.toString()
    val scan = scanExpressBlockFrom(content, scanPos)
    scanPos = scan.resumePos
    if (scan.closeStart == null) {
      if (!rejected) {
        readBlockStep(parts) { emitReady(parts, scan.readableEnd) }
      }
      return ""
    }
    val closeEnd = matchCloseTagEnd(content, scan.closeStart)!!
    val remaining = content.substring(closeEnd)
    if (!rejected) {
      readBlockStep(parts) { finishBlock(parts, scan.closeStart) }
    }
    inBlock = false
    afterBlock = true
    resetBlock()
    return remaining
  }

  private fun consumeOutsideText(parts: MutableList<ExpressStreamPart>, input: String): String {
    val openMatch = OPEN_TAG_SEARCH_REGEX.find(input)
    if (openMatch != null) {
      val beforeTag = input.substring(0, openMatch.range.first)
      wrappedInInlineBackticks = OUTER_INLINE_OPEN_BACKTICK_REGEX.containsMatchIn(beforeTag)
      textRun.emit(parts, beforeTag.replace(OUTER_TRAILING_FENCE_REGEX, ""))
      textRun.reset()
      inBlock = true
      resetBlock()
      return input.substring(openMatch.range.last + 1)
    }

    val tagStart = possibleOpenTagStart(input)
    val hold = possibleFenceStart(input.substring(0, tagStart))
    textRun.emit(parts, input.substring(0, hold))
    held = input.substring(hold)
    return ""
  }

  private fun emitReady(parts: MutableList<ExpressStreamPart>, end: Int) {
    val payload = cleanExpressPayload(block.toString(), end) ?: return
    if (payload.isBlank()) return

    val (completePrefix, trailingFragment) =
      if (
        lastCompiledPrefix.isNotEmpty() &&
          payload.startsWith(lastCompiledPrefix) &&
          (lastCompiledPrefix.endsWith('\n') || lastCompiledPrefix.endsWith(';'))
      ) {
        val (tailPfx, tailFrag) =
          splitCompleteStatements(payload.substring(lastCompiledPrefix.length), isFinal = false)
        (lastCompiledPrefix + tailPfx) to tailFrag
      } else {
        splitCompleteStatements(payload, isFinal = false)
      }

    val readyMessages = mutableListOf<JsonObject>()
    if (completePrefix.isNotBlank() && completePrefix != lastCompiledPrefix) {
      val savedSession = session.snapshot()
      val savedTouched = LinkedHashSet(touched)
      try {
        state.transaction {
          val prefixMsgs = compileSessionStep(completePrefix, isFinal = false, cachePrefix = true)
          if (prefixMsgs.isNotEmpty()) {
            applyToState(prefixMsgs)
            readyMessages.addAll(prefixMsgs)
          }
        }
        lastCompiledPrefix = completePrefix
      } catch (t: Throwable) {
        session.restore(savedSession)
        touched = savedTouched
        throw t
      }
    }

    val healed = healProgressiveFragment(trailingFragment, compiler.helpers, progressiveKeys)
    if (healed != null) {
      val combined = if (completePrefix.isNotBlank()) "$completePrefix\n$healed" else healed
      readyMessages.addAll(tryCompileAndApplyHealed(combined))
    }

    if (readyMessages.isNotEmpty()) {
      parts.add(ExpressStreamPart.A2ui(mergeSameSurfaceUpdates(readyMessages)))
    }
  }

  private fun tryCompileAndApplyHealed(combined: String): List<JsonObject> {
    val savedSession = session.snapshot()
    val savedTouched = LinkedHashSet(touched)
    return try {
      state.transaction {
        val msgs = compileSessionStep(combined, isFinal = false, cachePrefix = false)
        if (msgs.isNotEmpty()) {
          applyToState(msgs)
        }
        msgs
      }
    } catch (_: A2uiException) {
      session.restore(savedSession)
      touched = savedTouched
      emptyList()
    }
  }

  private fun finishBlock(parts: MutableList<ExpressStreamPart>, end: Int) {
    val payload = cleanExpressPayload(block.toString(), end) ?: ""
    var models: List<JsonObject> = emptyList()
    state.transaction {
      if (!session.hasEmitted && initialSurfaces.isEmpty()) {
        models = compiler.compileMessages(payload, surfaceId = surfaceId, isFinal = true)
        applyToState(models)
      } else {
        models = compileSessionStep(payload, isFinal = true, cachePrefix = true)
        if (models.isNotEmpty()) {
          applyToState(models)
        }
      }
      state.checkTopology(touched)
    }
    if (models.isNotEmpty()) {
      parts.add(ExpressStreamPart.A2ui(models))
    }
  }

  private fun compileSessionStep(
    source: String,
    isFinal: Boolean,
    cachePrefix: Boolean,
  ): List<JsonObject> =
    session.compileStep(
      dslText = source,
      isFinal = isFinal,
      existingSurfaces = initialSurfaces,
      cachePrefix = cachePrefix,
    )

  private fun applyToState(messages: List<JsonObject>) {
    for ((sid, cid) in session.supersededComponents) {
      state.dropProvisionalComponent(sid, cid)
    }
    session.supersededComponents.clear()
    val newlyTouched = state.apply(messages)
    touched.addAll(newlyTouched)
  }
}

private class StreamTextRun {
  private var started = false
  private var heldSpace = ""

  fun emit(parts: MutableList<ExpressStreamPart>, text: String) {
    val trimmedStart = if (started) text else text.trimStart()
    val body = trimmedStart.trimEnd()
    if (body.isEmpty()) {
      if (started) heldSpace += text
      return
    }
    val start = if (started) 0 else text.indexOf(body)
    parts.add(ExpressStreamPart.Text(heldSpace + body))
    heldSpace = text.substring(start + body.length)
    started = true
  }

  fun reset() {
    started = false
    heldSpace = ""
  }
}

private data class BlockScanResult(val closeStart: Int?, val readableEnd: Int, val resumePos: Int)

private val OPEN_TAG_SEARCH_REGEX = Regex("""<a2ui(?:\s[^>]*)?>""", RegexOption.IGNORE_CASE)
private val OPEN_TAG_START_REGEX = Regex("""<a2ui\s[^>]*$""", RegexOption.IGNORE_CASE)
private val CLOSE_TAG_MATCH_REGEX = Regex("""</a2ui\s*>""", RegexOption.IGNORE_CASE)
private val CLOSE_TAG_START_REGEX = Regex("""</a2ui\s*$""", RegexOption.IGNORE_CASE)
private val LEADING_FENCE_BLOCK_REGEX = Regex("""^\s*(?:```[a-zA-Z0-9_-]*[ \t]*\r?\n|`+\s*)""")
private val TRAILING_FENCE_BLOCK_REGEX = Regex("""(?:\r?\n?[ \t]*```[a-zA-Z0-9_-]*|`+)\s*$""")
private val OUTER_TRAILING_FENCE_REGEX =
  Regex("""(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|(?:^|(?<=\s))`{1,2})$""")
private val OUTER_TRAILING_FENCE_PREFIX_REGEX =
  Regex("""(?:```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|`+)$""")
private val OUTER_INLINE_OPEN_BACKTICK_REGEX = Regex("""(?:^|(?<=\s))`{1,2}$""")
private val OUTER_LEADING_FENCE_REGEX = Regex("""^\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|$)""")
private val OUTER_LEADING_FENCE_PREFIX_REGEX =
  Regex("""^\s*(?:`{0,2}|```[a-zA-Z0-9_-]*[ \t]*\r?)$""")
private val OUTER_LEADING_FENCE_INLINE_REGEX =
  Regex("""^(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|$)|`+)""")
private val OUTER_LEADING_FENCE_INLINE_PREFIX_REGEX =
  Regex("""^(?:`+|\s*`{0,2}|\s*```[a-zA-Z0-9_-]*[ \t]*\r?)$""")
private val TRAILING_FENCE_CLOSE_REGEX = Regex("""\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?$""")
private val IDENT_AT_REGEX = Regex("""[\p{L}_][\p{L}\p{N}_]*""")
private val DATA_ASSIGN_REGEX = Regex("""^\s*\$([a-zA-Z0-9_/]*)\s*=(?!=)""")

private fun matchCloseTagEnd(text: String, at: Int): Int? =
  CLOSE_TAG_MATCH_REGEX.matchAt(text, at)?.let { it.range.last + 1 }

private fun isTagPrefix(text: String, idx: Int, tag: String): Boolean =
  text.length - idx < tag.length && tag.startsWith(text.substring(idx).lowercase())

private fun possibleOpenTagStart(text: String): Int {
  var idx = text.indexOf('<')
  while (idx >= 0) {
    if (
      isTagPrefix(text, idx, A2uiConstants.A2UI_INFERENCE_OPEN_TAG) ||
        OPEN_TAG_START_REGEX.containsMatchIn(text.substring(idx))
    ) {
      return idx
    }
    idx = text.indexOf('<', idx + 1)
  }
  return text.length
}

private fun possibleFenceStart(text: String): Int =
  OUTER_TRAILING_FENCE_PREFIX_REGEX.find(text)?.range?.first ?: text.length

private fun scanExpressBlockFrom(content: String, startPos: Int): BlockScanResult {
  var i = startPos
  val n = content.length
  while (i < n) {
    val (nextI, completed) = skipBlockLiteralOrComment(content, i, n)
    if (nextI > i) {
      if (!completed) {
        return BlockScanResult(closeStart = null, readableEnd = n, resumePos = i)
      }
      i = nextI
      continue
    }
    if (content[i] == '<') {
      val hit = checkCloseTagAt(content, i)
      if (hit != null) {
        return BlockScanResult(closeStart = hit.first, readableEnd = hit.second, resumePos = i)
      }
    }
    i++
  }
  val lastChar = if (n > 0) content[n - 1] else '\u0000'
  val resumePos =
    if (lastChar == 'r' || lastChar == 'R' || lastChar == '/' || lastChar == '-') n - 1 else n
  return BlockScanResult(closeStart = null, readableEnd = n, resumePos = resumePos)
}

private fun checkCloseTagAt(content: String, i: Int): Pair<Int?, Int>? {
  if (matchCloseTagEnd(content, i) != null) return i to i
  if (
    isTagPrefix(content, i, A2uiConstants.A2UI_INFERENCE_CLOSE_TAG) ||
      CLOSE_TAG_START_REGEX.containsMatchIn(content.substring(i))
  ) {
    return null to i
  }
  return null
}

private fun skipBlockLiteralOrComment(content: String, i: Int, n: Int): Pair<Int, Boolean> {
  if (
    (content[i] == 'r' || content[i] == 'R') &&
      i + 1 < n &&
      content[i + 1] == '"' &&
      (i == 0 || !(content[i - 1].isLetterOrDigit() || content[i - 1] == '_'))
  ) {
    val end = scanDoubleQuoted(content, i + 1, n, raw = true)
    if (end != null) {
      if (end == n && end - (i + 1) == 2) return n to false
      return end to true
    }
    return n to false
  }
  if (content[i] == '"') {
    val end = scanDoubleQuoted(content, i, n, raw = false)
    if (end != null) {
      if (end == n && end - i == 2) return n to false
      return end to true
    }
    return n to false
  }
  if (content.startsWith("/*", i)) {
    val endComment = content.indexOf("*/", i + 2)
    return if (endComment < 0) (n to false) else ((endComment + 2) to true)
  }
  if (content[i] == '#' || content.startsWith("//", i) || content.startsWith("--", i)) {
    var j = if (content[i] == '#') i + 1 else i + 2
    while (j < n && content[j] != '\n' && content[j] != '\r') {
      if (content[j] == '<' && checkCloseTagAt(content, j) != null) {
        return j to true
      }
      j++
    }
    return if (j < n) ((j + 1) to true) else (n to false)
  }
  return i to true
}

private fun scanDoubleQuoted(source: String, quoteStart: Int, n: Int, raw: Boolean): Int? {
  val triple = source.startsWith("\"\"\"", quoteStart)
  val delim = if (triple) "\"\"\"" else "\""
  var i = quoteStart + delim.length
  while (i < n) {
    if (!raw && source[i] == '\\') {
      if (i + 1 >= n) return null
      i += 2
      continue
    }
    if (source.startsWith(delim, i)) {
      return i + delim.length
    }
    i++
  }
  return null
}

private fun cleanExpressPayload(block: String, end: Int): String? {
  val text = block.substring(0, end)
  val stripped = text.trimStart()
  if (stripped.length in 1..3 && "```".startsWith(stripped)) return null
  if (stripped.startsWith("```") && !stripped.contains('\n')) return null
  return text.replace(LEADING_FENCE_BLOCK_REGEX, "").replace(TRAILING_FENCE_BLOCK_REGEX, "")
}

private class ScanCursor {
  var depth = 0
  var hasToken = false
  var sawEquals = false
  var hasRhs = false
  var rhsClosed = false
  var lastComplete = 0

  fun resetStatement(pos: Int) {
    hasToken = false
    sawEquals = false
    hasRhs = false
    rhsClosed = false
    lastComplete = pos
  }
}

internal fun splitCompleteStatements(source: String, isFinal: Boolean): Pair<String, String> {
  if (isFinal) return source to ""
  val cur = ScanCursor()
  var i = 0
  val n = source.length
  while (i < n) {
    val (nextI, closedString) = stepStringOrComment(source, i, n)
    if (nextI > i) {
      if (closedString && cur.depth == 0 && cur.sawEquals) {
        cur.hasRhs = true
        cur.rhsClosed = true
        cur.lastComplete = nextI
      }
      i = nextI
      continue
    }
    val ch = source[i]
    when {
      ch == '(' || ch == '[' || ch == '{' -> {
        cur.depth++
        cur.hasToken = true
        if (cur.sawEquals) {
          cur.hasRhs = true
          cur.rhsClosed = false
        }
      }
      ch == ')' || ch == ']' || ch == '}' -> {
        if (cur.depth > 0) {
          cur.depth--
          if (cur.depth == 0 && (cur.sawEquals || cur.hasToken)) {
            cur.hasRhs = true
            cur.rhsClosed = true
            cur.lastComplete = i + 1
          }
        }
      }
      cur.depth == 0 && (ch == '\n' || ch == ';') -> {
        if (cur.rhsClosed || (cur.sawEquals && cur.hasRhs)) {
          cur.resetStatement(i + 1)
        } else if (!cur.hasToken) {
          cur.lastComplete = i + 1
        }
      }
      !ch.isWhitespace() -> {
        if (cur.depth == 0 && ch == '=' && (i + 1 >= n || source[i + 1] != '=')) {
          cur.sawEquals = true
          cur.hasToken = true
        } else {
          cur.hasToken = true
          if (cur.depth == 0 && cur.sawEquals) {
            cur.hasRhs = true
          }
        }
      }
    }
    i++
  }
  return source.substring(0, cur.lastComplete) to source.substring(cur.lastComplete)
}

private fun stepStringOrComment(source: String, i: Int, n: Int): Pair<Int, Boolean> {
  if ((source[i] == 'r' || source[i] == 'R') && i + 1 < n && source[i + 1] == '"') {
    val end = scanDoubleQuoted(source, i + 1, n, raw = true)
    if (end != null) {
      if (end == n && end - (i + 1) == 2) return n to false
      return end to true
    }
    return n to false
  }
  if (source[i] == '"') {
    val end = scanDoubleQuoted(source, i, n, raw = false)
    if (end != null) {
      if (end == n && end - i == 2) return n to false
      return end to true
    }
    return n to false
  }
  if (source.startsWith("/*", i)) {
    val close = source.indexOf("*/", i + 2)
    return if (close >= 0) ((close + 2) to false) else (n to false)
  }
  if (source[i] == '#' || source.startsWith("//", i) || source.startsWith("--", i)) {
    val nl = source.indexOf('\n', i)
    return if (nl >= 0) (nl to false) else (n to false)
  }
  return i to false
}

private class OpenCallFrame(
  val name: String,
  var argIndex: Int = 0,
  var kwargName: String? = null,
  var lastIdent: String? = null,
)

private data class UnclosedStringState(
  val strStart: Int,
  val delim: String,
  val isRaw: Boolean,
  val brackets: List<Char>,
  val calls: List<OpenCallFrame>,
)

internal fun healProgressiveFragment(
  fragment: String,
  helpers: Map<String, CatalogSchemaHelper>,
  progressiveKeys: Set<String>,
): String? {
  if (progressiveKeys.isEmpty() || fragment.isBlank()) return null
  val state = scanFragmentForUnclosedString(fragment) ?: return null
  val content = fragment.substring(state.strStart)
  val lower = content.trimStart().lowercase()
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:")) {
    return null
  }
  if (!isProgressiveSlot(fragment, state.calls, helpers, progressiveKeys)) return null

  var healed = fragment
  if (!state.isRaw && hasOddTrailingBackslashes(healed)) {
    healed = healed.substring(0, healed.length - 1)
  }
  if (state.delim == "\"\"\"" && healed.substring(state.strStart).endsWith('"')) {
    if (state.isRaw) return null
    healed = healed.substring(0, healed.length - 1) + "\\\""
  }
  val closingBrackets =
    state.brackets
      .asReversed()
      .map { b ->
        when (b) {
          '[' -> ']'
          '{' -> '}'
          else -> ')'
        }
      }
      .joinToString("")
  return "$healed${state.delim}$closingBrackets"
}

private fun scanFragmentForUnclosedString(fragment: String): UnclosedStringState? {
  var i = 0
  val n = fragment.length
  val brackets = mutableListOf<Char>()
  val calls = mutableListOf<OpenCallFrame>()
  var lastIdent: String? = null

  while (i < n) {
    val isRaw =
      (fragment[i] == 'r' || fragment[i] == 'R') &&
        i + 1 < n &&
        fragment[i + 1] == '"' &&
        (i == 0 || !(fragment[i - 1].isLetterOrDigit() || fragment[i - 1] == '_'))
    if (isRaw || fragment[i] == '"') {
      val quotePos = if (isRaw) i + 1 else i
      val delim = if (fragment.startsWith("\"\"\"", quotePos)) "\"\"\"" else "\""
      val end = scanDoubleQuoted(fragment, quotePos, n, isRaw)
      if (end == null) {
        return UnclosedStringState(
          strStart = quotePos + delim.length,
          delim = delim,
          isRaw = isRaw,
          brackets = brackets.toList(),
          calls = calls.toList(),
        )
      }
      i = end
      continue
    }

    if (fragment.startsWith("/*", i)) {
      val close = fragment.indexOf("*/", i + 2)
      if (close < 0) return null
      i = close + 2
      continue
    }
    if (fragment[i] == '#' || fragment.startsWith("//", i) || fragment.startsWith("--", i)) {
      val nl = fragment.indexOf('\n', i)
      if (nl < 0) return null
      i = nl + 1
      continue
    }

    val identMatch = IDENT_AT_REGEX.matchAt(fragment, i)
    if (identMatch != null) {
      lastIdent = identMatch.value
      if (calls.isNotEmpty() && brackets.lastOrNull() == '(') {
        calls.last().lastIdent = lastIdent
      }
      i = identMatch.range.last + 1
      continue
    }

    val ch = fragment[i]
    val inCallParens = calls.isNotEmpty() && brackets.lastOrNull() == '('
    when {
      ch == '(' -> {
        brackets.add('(')
        calls.add(OpenCallFrame(name = lastIdent ?: ""))
        lastIdent = null
      }
      ch == '[' || ch == '{' -> {
        brackets.add(ch)
        lastIdent = null
      }
      ch == ')' || ch == ']' || ch == '}' -> {
        if (
          brackets.isNotEmpty() &&
            brackets.removeAt(brackets.lastIndex) == '(' &&
            calls.isNotEmpty()
        ) {
          calls.removeAt(calls.lastIndex)
        }
        lastIdent = null
      }
      ch == ',' && inCallParens -> {
        val top = calls.last()
        top.argIndex++
        top.kwargName = null
        top.lastIdent = null
      }
      ch == '=' && inCallParens && calls.last().lastIdent != null -> {
        val top = calls.last()
        top.kwargName = top.lastIdent
      }
      !ch.isWhitespace() -> {
        lastIdent = null
      }
    }
    i++
  }
  return null
}

private fun isProgressiveSlot(
  fragment: String,
  calls: List<OpenCallFrame>,
  helpers: Map<String, CatalogSchemaHelper>,
  progressiveKeys: Set<String>,
): Boolean {
  if (calls.isEmpty()) {
    val m = DATA_ASSIGN_REGEX.find(fragment) ?: return false
    val lastSeg = m.groupValues[1].trimEnd('/').split('/').lastOrNull() ?: return false
    return lastSeg in progressiveKeys
  }
  val frame = calls.last()
  if (frame.name.isEmpty()) return false
  for (helper in helpers.values) {
    val meta = helper.components[frame.name] ?: continue
    if (frame.kwargName != null) {
      return frame.kwargName in progressiveKeys
    }
    val props =
      if (meta.hasChecks && "checks" !in meta.customEnvelopeProperties) {
        meta.properties.filter { it != "checks" }
      } else {
        meta.properties
      }
    if (frame.argIndex < props.size) {
      return props[frame.argIndex] in progressiveKeys
    }
  }
  return false
}

private fun hasOddTrailingBackslashes(text: String): Boolean {
  var count = 0
  var idx = text.length - 1
  while (idx >= 0 && text[idx] == '\\') {
    count++
    idx--
  }
  return count % 2 == 1
}

private fun mergeSameSurfaceUpdates(messages: List<JsonObject>): List<JsonObject> {
  val merged = mutableListOf<JsonObject>()
  for (msg in messages) {
    val prev = merged.lastOrNull()
    if (prev != null) {
      val combined = tryMergeComponentUpdate(prev, msg)
      if (combined != null) {
        merged[merged.lastIndex] = combined
        continue
      }
    }
    merged.add(msg)
  }
  return merged
}

private fun tryMergeComponentUpdate(prev: JsonObject, curr: JsonObject): JsonObject? {
  val currUpd = curr["updateComponents"] as? JsonObject ?: return null
  val currComps = currUpd["components"] as? JsonArray ?: return null
  val sid = currUpd["surfaceId"] ?: return null

  for (key in listOf("updateComponents", "createSurface")) {
    val target = prev[key] as? JsonObject ?: continue
    val existingComps = target["components"] as? JsonArray ?: continue
    if (target["surfaceId"] != sid) continue

    val list = existingComps.map { it as JsonObject }.toMutableList()
    val byId = HashMap<String, Int>()
    list.forEachIndexed { idx, c -> c["id"]?.jsonPrimitive?.content?.let { byId[it] = idx } }
    for (item in currComps) {
      val comp = item as? JsonObject ?: continue
      val cid = comp["id"]?.jsonPrimitive?.content ?: continue
      val prevIdx = byId[cid]
      if (prevIdx != null) {
        list[prevIdx] = comp
      } else {
        byId[cid] = list.size
        list.add(comp)
      }
    }
    val updatedTarget = LinkedHashMap<String, JsonElement>(target)
    updatedTarget["components"] = JsonArray(list)
    val updatedPrev = LinkedHashMap<String, JsonElement>(prev)
    updatedPrev[key] = JsonObject(updatedTarget)
    return JsonObject(updatedPrev)
  }
  return null
}

internal fun toLegacyResponseParts(parts: List<ExpressStreamPart>): List<ResponsePart> {
  val out = mutableListOf<ResponsePart>()
  for (p in parts) {
    when (p) {
      is ExpressStreamPart.Text -> out.add(ResponsePart(text = p.text))
      is ExpressStreamPart.RawA2ui -> out.add(ResponsePart(a2uiRaw = p.a2uiRaw))
      is ExpressStreamPart.A2ui -> out.add(ResponsePart(a2uiJson = p.a2ui))
      is ExpressStreamPart.Error -> {}
    }
  }
  return out
}
