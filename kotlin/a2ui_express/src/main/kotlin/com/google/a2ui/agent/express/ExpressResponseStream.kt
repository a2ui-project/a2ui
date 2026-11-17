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

import com.google.a2ui.agent.A2uiCompilationException
import com.google.a2ui.agent.A2uiPart
import com.google.a2ui.agent.AfterRejectedBlock
import com.google.a2ui.agent.ErrorPart
import com.google.a2ui.agent.RendererState
import com.google.a2ui.agent.ResponsePart
import com.google.a2ui.agent.ResponseStream
import com.google.a2ui.agent.StreamPart
import com.google.a2ui.agent.TextPart
import com.google.a2ui.agent.partialResults
import com.google.a2ui.core.A2uiError
import com.google.a2ui.core.A2uiParseError
import com.google.a2ui.core.AgentToRendererMessage
import com.google.a2ui.core.CreateSurfaceMessage
import com.google.a2ui.core.UpdateComponentsMessage
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Default set of component/data keys healed progressively while streaming open string literals. */
val DEFAULT_EXPRESS_PROGRESSIVE_KEYS: Set<String> = setOf("text")

/**
 * Incremental chunk-by-chunk A2UI Express response stream supporting progressive string healing,
 * pre-`root` gating, provisional forward ID overrides, and `afterRejectedBlock` recovery.
 */
class ExpressResponseStream<out P : StreamPart>
internal constructor(
  private val parser: ExpressParser,
  private val wrapped: Boolean = true,
  state: RendererState? = null,
  progressiveKeys: Set<String>? = null,
  afterRejectedBlock: AfterRejectedBlock = AfterRejectedBlock.END,
) : ResponseStream<P> {
  private val compiler = ExpressCompiler(parser.catalogs)
  override val state: RendererState = state ?: RendererState(parser.catalogs)
  private val continues = afterRejectedBlock == AfterRejectedBlock.CONTINUE
  private val progressiveKeys: Set<String> = progressiveKeys ?: parser.progressiveKeys

  private var closed = false
  private var held = ""
  private val textRun = TextRun()
  private var afterBlock = false
  private var wrappedInInlineBackticks = false
  private var inBlock = !wrapped
  private var rejected = false
  private var block = ""
  private var scanPos = 0
  private var lastCompiledPrefix = ""
  private var touched = LinkedHashSet<String>()
  private var initialSurfaces: Set<String> = this.state.surfaceIds.toSet()
  private var session = ExpressScopeSession(compiler, surfaceId = parser.surfaceId)

  override val isInBlock: Boolean
    get() = !closed && inBlock

  private class TextRun {
    private var started = false
    private var heldSpace = ""

    fun emit(parts: MutableList<StreamPart>, text: String) {
      val trimmedStart = if (started) text else text.trimStart()
      val body = trimmedStart.trimEnd()
      if (body.isEmpty()) {
        if (started) heldSpace += text
        return
      }
      val start = if (started) 0 else text.indexOf(body)
      parts.add(TextPart("$heldSpace$body"))
      heldSpace = text.substring(start + body.length)
      started = true
    }

    fun reset() {
      started = false
      heldSpace = ""
    }
  }

  private fun resetBlock() {
    block = ""
    scanPos = 0
    rejected = false
    lastCompiledPrefix = ""
    touched = LinkedHashSet()
    initialSurfaces = state.surfaceIds.toSet()
    session = ExpressScopeSession(compiler, surfaceId = parser.surfaceId)
  }

  @Suppress("UNCHECKED_CAST")
  override fun feed(chunk: String): List<P> {
    if (closed) {
      throw IllegalStateException("The response stream is closed.")
    }
    val parts = ArrayList<StreamPart>()
    try {
      feedInternal(chunk, parts)
    } catch (t: Throwable) {
      fail(t, parts)
      throw t
    }
    return parts as List<P>
  }

  @Suppress("UNCHECKED_CAST")
  override fun close(): List<P> {
    if (closed) return emptyList()
    closed = true
    val parts = ArrayList<StreamPart>()
    try {
      if (!wrapped) {
        if (!rejected) {
          readBlock(parts) { finishBlock(parts, block.length) }
        }
        return parts as List<P>
      }
      if (inBlock) {
        if (!rejected) {
          readBlock(parts) {
            throw A2uiParseError(
              "The response ended inside an $OPEN_TAG block, before its $CLOSE_TAG tag."
            )
          }
        }
        state.markChecked(touched)
        return parts as List<P>
      }
    } catch (t: Throwable) {
      fail(t, parts)
      throw t
    }

    if (held.isNotEmpty()) {
      var rest = held
      held = ""
      if (afterBlock) {
        val leadingRe =
          if (wrappedInInlineBackticks) OUTER_LEADING_FENCE_INLINE_RE else OUTER_LEADING_FENCE_RE
        rest = leadingRe.replaceFirst(rest, "")
        wrappedInInlineBackticks = false
      }
      textRun.emit(parts, TRAILING_FENCE_CLOSE_RE.replaceFirst(rest, ""))
    }
    return parts as List<P>
  }

  private fun fail(error: Throwable, parts: List<StreamPart>) {
    closed = true
    state.markChecked(touched)
    if (error is A2uiError) {
      error.partialResults = parts.filterIsInstance<ResponsePart>()
    }
  }

  private fun readBlock(parts: MutableList<StreamPart>, step: () -> Unit) {
    try {
      step()
    } catch (e: A2uiError) {
      if (!continues) throw e
      parts.add(ErrorPart(e))
      state.markChecked(touched)
      rejected = true
    }
  }

  private fun feedInternal(chunk: String, parts: MutableList<StreamPart>) {
    if (!wrapped) {
      block += chunk
      if (!rejected) {
        readBlock(parts) { emitReady(parts, block.length) }
      }
      return
    }

    var inputStr = held + chunk
    held = ""
    while (inputStr.isNotEmpty()) {
      if (inBlock) {
        inputStr = consumeBlockText(parts, inputStr)
        continue
      }
      if (afterBlock) {
        val prefixRe =
          if (wrappedInInlineBackticks) OUTER_LEADING_FENCE_INLINE_PREFIX_RE
          else OUTER_LEADING_FENCE_PREFIX_RE
        if (prefixRe.matches(inputStr)) {
          held = inputStr
          return
        }
        afterBlock = false
        val leadingRe =
          if (wrappedInInlineBackticks) OUTER_LEADING_FENCE_INLINE_RE else OUTER_LEADING_FENCE_RE
        wrappedInInlineBackticks = false
        inputStr = leadingRe.replaceFirst(inputStr, "")
        continue
      }
      inputStr = consumeOutsideText(parts, inputStr)
    }
  }

  private fun consumeBlockText(parts: MutableList<StreamPart>, inputStr: String): String {
    block += inputStr
    val (closeStart, readableEnd, nextScanPos) = scanExpressBlockFrom(block, scanPos)
    scanPos = nextScanPos
    if (closeStart == null) {
      if (!rejected) {
        readBlock(parts) { emitReady(parts, readableEnd) }
      }
      return ""
    }
    val closeMatch = CLOSE_TAG_RE.matchAt(block, closeStart)!!
    val remaining = block.substring(closeMatch.range.last + 1)
    if (!rejected) {
      readBlock(parts) { finishBlock(parts, closeStart) }
    }
    inBlock = false
    afterBlock = true
    resetBlock()
    return remaining
  }

  private fun consumeOutsideText(parts: MutableList<StreamPart>, inputStr: String): String {
    val openMatch = OPEN_TAG_RE.find(inputStr)
    if (openMatch != null) {
      val beforeOpen = inputStr.substring(0, openMatch.range.first)
      wrappedInInlineBackticks = OUTER_INLINE_OPEN_BACKTICK_RE.containsMatchIn(beforeOpen)
      val textBefore = OUTER_TRAILING_FENCE_RE.replaceFirst(beforeOpen, "")
      textRun.emit(parts, textBefore)
      textRun.reset()
      inBlock = true
      resetBlock()
      return inputStr.substring(openMatch.range.last + 1)
    }

    val tagStart = possibleOpenTagStart(inputStr)
    val hold = possibleFenceStart(inputStr.substring(0, tagStart))
    textRun.emit(parts, inputStr.substring(0, hold))
    held = inputStr.substring(hold)
    return ""
  }

  private fun emitReady(parts: MutableList<StreamPart>, end: Int) {
    val payload = cleanExpressPayload(block, end)
    if (payload.isNullOrBlank()) return

    val (completePrefix, trailingFragment) =
      if (
        (lastCompiledPrefix.endsWith("\n") || lastCompiledPrefix.endsWith(";")) &&
          payload.startsWith(lastCompiledPrefix)
      ) {
        val (tailComplete, tailFrag) =
          splitCompleteStatements(payload.substring(lastCompiledPrefix.length), isFinal = false)
        (lastCompiledPrefix + tailComplete) to tailFrag
      } else {
        splitCompleteStatements(payload, isFinal = false)
      }

    var prefixMessages: List<AgentToRendererMessage> = emptyList()
    if (completePrefix.isNotBlank() && completePrefix != lastCompiledPrefix) {
      val snap = session.snapshot()
      val savedTouched = LinkedHashSet(touched)
      try {
        state.transaction {
          prefixMessages = compileStep(completePrefix, isFinal = false, cachePrefix = true)
          if (prefixMessages.isNotEmpty()) {
            applyMessages(prefixMessages)
          }
        }
        lastCompiledPrefix = completePrefix
      } catch (t: Throwable) {
        session.restore(snap)
        touched = savedTouched
        throw t
      }
    }

    val healedMessages = tryCompileAndApplyHealed(completePrefix, trailingFragment)
    val readyMessages = mergeSameSurfaceUpdates(prefixMessages + healedMessages)
    if (readyMessages.isNotEmpty()) {
      parts.add(A2uiPart(readyMessages))
    }
  }

  private fun tryCompileAndApplyHealed(
    completePrefix: String,
    trailingFragment: String,
  ): List<AgentToRendererMessage> {
    val healed =
      healProgressiveFragment(trailingFragment, compiler.helpers, progressiveKeys)
        ?: return emptyList()
    val combined = if (completePrefix.isNotBlank()) "$completePrefix\n$healed" else healed
    val snap = session.snapshot()
    val savedTouched = LinkedHashSet(touched)
    return try {
      state.transaction {
        val msgs = compileStep(combined, isFinal = false, cachePrefix = false)
        if (msgs.isNotEmpty()) {
          applyMessages(msgs)
        }
        msgs
      }
    } catch (_: A2uiError) {
      session.restore(snap)
      touched = savedTouched
      emptyList()
    }
  }

  private fun finishBlock(parts: MutableList<StreamPart>, end: Int) {
    val payload = cleanExpressPayload(block, end).orEmpty()
    val models =
      state.transaction {
        val msgs =
          if (!session.hasEmitted && initialSurfaces.isEmpty()) {
            val rawModels =
              try {
                parser.compile(payload, isFinal = true)
              } catch (e: A2uiError) {
                throw e
              } catch (e: Exception) {
                throw A2uiCompilationException(
                  message = "Failed to compile A2UI block: ${e.message}",
                  rawBlock = payload,
                  cause = e,
                )
              }
            applyMessages(rawModels)
            rawModels
          } else {
            val stepMsgs = compileStep(payload, isFinal = true, cachePrefix = true)
            if (stepMsgs.isNotEmpty()) {
              applyMessages(stepMsgs)
            }
            stepMsgs
          }
        state.checkTopology(touched)
        msgs
      }
    if (models.isNotEmpty()) {
      parts.add(A2uiPart(models))
    }
  }

  private fun compileStep(
    source: String,
    isFinal: Boolean,
    cachePrefix: Boolean = true,
  ): List<AgentToRendererMessage> =
    try {
      session.compileStep(
        dslText = source,
        isFinal = isFinal,
        existingSurfaces = initialSurfaces,
        cachePrefix = cachePrefix,
      )
    } catch (e: A2uiError) {
      throw e
    } catch (e: Exception) {
      throw A2uiCompilationException(
        message = "Failed to compile A2UI block: ${e.message}",
        rawBlock = source,
        cause = e,
      )
    }

  private fun applyMessages(messages: List<AgentToRendererMessage>) {
    for ((sid, cid) in session.supersededComponents) {
      state.dropProvisionalComponent(sid, cid)
    }
    session.supersededComponents.clear()
    val newlyTouched = state.apply(messages, inProgress = true)
    touched.addAll(newlyTouched)
  }

  companion object {
    private const val OPEN_TAG = ExpressDecompiler.A2UI_OPEN_TAG
    private const val CLOSE_TAG = ExpressDecompiler.A2UI_CLOSE_TAG
    private val OPEN_TAG_RE = Regex("<a2ui(?:\\s[^>]*)?>", RegexOption.IGNORE_CASE)
    private val CLOSE_TAG_RE = Regex("</a2ui\\s*>", RegexOption.IGNORE_CASE)
    private val OPEN_TAG_START_RE = Regex("<a2ui\\s[^>]*$", RegexOption.IGNORE_CASE)
    private val CLOSE_TAG_START_RE = Regex("</a2ui\\s*$", RegexOption.IGNORE_CASE)
    private val LEADING_FENCE_RE = Regex("""^\s*(?:```[a-zA-Z0-9_-]*[ \t]*\r?\n|`+\s*)""")
    private val TRAILING_FENCE_RE = Regex("""(?:\r?\n?[ \t]*```[a-zA-Z0-9_-]*|`+)\s*$""")
    private val OUTER_TRAILING_FENCE_RE =
      Regex("""(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|(?:^|(?<=\s))`{1,2})\z""")
    private val OUTER_TRAILING_FENCE_PREFIX_RE =
      Regex("""(?:```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n[ \t]*)?|`+)\z""")
    private val OUTER_INLINE_OPEN_BACKTICK_RE = Regex("""(?:^|(?<=\s))`{1,2}\z""")
    private val OUTER_LEADING_FENCE_RE = Regex("""^\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|\z)""")
    private val OUTER_LEADING_FENCE_PREFIX_RE =
      Regex("""^\s*(?:`{0,2}|```[a-zA-Z0-9_-]*[ \t]*\r?)\z""")
    private val OUTER_LEADING_FENCE_INLINE_RE =
      Regex("""^(?:\s*```[a-zA-Z0-9_-]*[ \t]*(?:\r?\n|\z)|`+)""")
    private val OUTER_LEADING_FENCE_INLINE_PREFIX_RE =
      Regex("""^(?:`+|\s*`{0,2}|\s*```[a-zA-Z0-9_-]*[ \t]*\r?)\z""")
    private val TRAILING_FENCE_CLOSE_RE = Regex("""\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?\z""")
    private val IDENT_RE = Regex("[a-zA-Z_][a-zA-Z0-9_]*")
    private val DATA_ASSIGN_RE = Regex("""^\s*\$([a-zA-Z0-9_/]*)\s*=(?!=)""")

    private class ScanCursor(
      var depth: Int = 0,
      var hasToken: Boolean = false,
      var sawEquals: Boolean = false,
      var hasRhs: Boolean = false,
      var rhsClosed: Boolean = false,
      var lastComplete: Int = 0,
    ) {
      fun resetStatement(pos: Int) {
        hasToken = false
        sawEquals = false
        hasRhs = false
        rhsClosed = false
        lastComplete = pos
      }
    }

    private data class OpenCallFrame(
      val name: String,
      var argIndex: Int = 0,
      var kwargName: String? = null,
      var lastIdent: String? = null,
    )

    private class FragmentScanState(
      val brackets: MutableList<Char> = ArrayList(),
      val calls: MutableList<OpenCallFrame> = ArrayList(),
      var lastIdent: String? = null,
    )

    private data class UnclosedStringState(
      val strStart: Int,
      val delim: String,
      val isRaw: Boolean,
      val brackets: List<Char>,
      val calls: List<OpenCallFrame>,
    )

    private fun isTagPrefix(text: String, idx: Int, tag: String): Boolean =
      text.length - idx < tag.length && tag.startsWith(text.substring(idx).lowercase())

    private fun possibleOpenTagStart(text: String): Int {
      var idx = text.indexOf('<')
      while (idx >= 0) {
        if (isTagPrefix(text, idx, OPEN_TAG) || OPEN_TAG_START_RE.matchesAt(text, idx)) {
          return idx
        }
        idx = text.indexOf('<', idx + 1)
      }
      return text.length
    }

    private fun possibleFenceStart(text: String): Int =
      OUTER_TRAILING_FENCE_PREFIX_RE.find(text)?.range?.first ?: text.length

    private fun scanExpressBlockFrom(content: String, start: Int): Triple<Int?, Int, Int> {
      var i = start
      val n = content.length
      while (i < n) {
        val (nextI, completed) = skipBlockLiteralOrComment(content, i, n)
        if (nextI > i) {
          if (!completed) return Triple(null, n, i)
          i = nextI
          continue
        }
        if (content[i] == '<') {
          val hit = checkCloseTagAt(content, i)
          if (hit != null) {
            return Triple(hit.first, hit.second, i)
          }
        }
        i++
      }
      val resumePos = if (n > 0 && content[n - 1] in charArrayOf('r', 'R', '/', '-')) n - 1 else n
      return Triple(null, n, resumePos)
    }

    private fun skipBlockLiteralOrComment(content: String, i: Int, n: Int): Pair<Int, Boolean> {
      if (
        (content[i] == 'r' || content[i] == 'R') &&
          i + 1 < n &&
          content[i + 1] == '"' &&
          (i == 0 || !(content[i - 1].isLetterOrDigit() || content[i - 1] == '_'))
      ) {
        val end = skipStringLiteral(content, i + 1, n, raw = true)
        return if (end != null) end to true else n to false
      }
      if (content[i] == '"') {
        val end = skipStringLiteral(content, i, n, raw = false)
        return if (end != null) end to true else n to false
      }
      if (content.startsWith("/*", i)) {
        val endComment = content.indexOf("*/", i + 2)
        return if (endComment >= 0) (endComment + 2) to true else n to false
      }
      if (content[i] == '#' || content.startsWith("//", i) || content.startsWith("--", i)) {
        var j = i + (if (content[i] == '#') 1 else 2)
        while (j < n && content[j] != '\n' && content[j] != '\r') {
          if (content[j] == '<' && checkCloseTagAt(content, j) != null) {
            return j to true
          }
          j++
        }
        return if (j < n) (j + 1) to true else n to false
      }
      return i to true
    }

    private fun checkCloseTagAt(content: String, i: Int): Pair<Int?, Int>? {
      if (CLOSE_TAG_RE.matchesAt(content, i)) return i to i
      if (isTagPrefix(content, i, CLOSE_TAG) || CLOSE_TAG_START_RE.matchesAt(content, i)) {
        return null to i
      }
      return null
    }

    private fun skipStringLiteral(content: String, start: Int, n: Int, raw: Boolean): Int? {
      val triple = content.startsWith("\"\"\"", start)
      val delim = if (triple) "\"\"\"" else "\""
      var i = start + delim.length
      while (i < n) {
        if (!raw && content[i] == '\\') {
          if (i + 1 >= n) return null
          i += 2
          continue
        }
        if (content.startsWith(delim, i)) {
          val end = i + delim.length
          if (!triple && end == n && end - start == 2) return null
          return end
        }
        i++
      }
      return null
    }

    private fun cleanExpressPayload(block: String, end: Int): String? {
      val text = block.substring(0, end)
      val stripped = text.trimStart()
      if (stripped.isNotEmpty() && stripped.length <= 3 && "```".startsWith(stripped)) {
        return null
      }
      if (stripped.startsWith("```") && '\n' !in stripped) {
        return null
      }
      val withoutLeading = LEADING_FENCE_RE.replaceFirst(text, "")
      return TRAILING_FENCE_RE.replaceFirst(withoutLeading, "")
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
        i = stepCodeChar(source, i, n, cur)
      }
      return source.substring(0, cur.lastComplete) to source.substring(cur.lastComplete)
    }

    private fun stepStringOrComment(source: String, i: Int, n: Int): Pair<Int, Boolean> {
      if ((source[i] == 'r' || source[i] == 'R') && i + 1 < n && source[i + 1] == '"') {
        val end = scanDoubleQuoted(source, i + 1, n, raw = true)
        if (end == null || (end == n && end - (i + 1) == 2)) return n to false
        return end to true
      }
      if (source[i] == '"') {
        val end = scanDoubleQuoted(source, i, n, raw = false)
        if (end == null || (end == n && end - i == 2)) return n to false
        return end to true
      }
      if (source.startsWith("/*", i)) {
        val close = source.indexOf("*/", i + 2)
        return if (close >= 0) (close + 2) to false else n to false
      }
      if (source[i] == '#' || source.startsWith("//", i) || source.startsWith("--", i)) {
        val nl = source.indexOf('\n', i)
        return if (nl >= 0) nl to false else n to false
      }
      return i to false
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

    private fun stepCodeChar(source: String, i: Int, n: Int, cur: ScanCursor): Int {
      when (val ch = source[i]) {
        '(',
        '[',
        '{' -> {
          cur.depth++
          cur.hasToken = true
          if (cur.sawEquals) {
            cur.hasRhs = true
            cur.rhsClosed = false
          }
        }
        ')',
        ']',
        '}' -> {
          if (cur.depth > 0) {
            cur.depth--
            if (cur.depth == 0 && (cur.sawEquals || cur.hasToken)) {
              cur.hasRhs = true
              cur.rhsClosed = true
              cur.lastComplete = i + 1
            }
          }
        }
        '\n',
        ';' -> {
          if (cur.depth == 0) {
            if (cur.rhsClosed || (cur.sawEquals && cur.hasRhs)) {
              cur.resetStatement(i + 1)
            } else if (!cur.hasToken) {
              cur.lastComplete = i + 1
            }
          }
        }
        else -> {
          if (!ch.isWhitespace()) {
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
      }
      return i + 1
    }

    private fun healProgressiveFragment(
      fragment: String,
      helpers: Map<String, CatalogSchemaHelper>,
      progressiveKeys: Set<String>,
    ): String? {
      if (progressiveKeys.isEmpty() || fragment.isBlank()) return null
      val state = scanFragmentForUnclosedString(fragment) ?: return null
      val content = fragment.substring(state.strStart)
      val lower = content.trimStart().lowercase()
      if (
        lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("data:")
      ) {
        return null
      }
      if (!isProgressiveSlot(fragment, state.calls, helpers, progressiveKeys)) {
        return null
      }
      var healed = fragment
      if (!state.isRaw && hasOddTrailingBackslashes(healed)) {
        healed = healed.dropLast(1)
      }
      if (state.delim == "\"\"\"" && healed.substring(state.strStart).endsWith("\"")) {
        if (state.isRaw) return null
        healed = "${healed.dropLast(1)}\\\""
      }
      val closingBrackets =
        state.brackets.asReversed().joinToString("") { openCh ->
          when (openCh) {
            '(' -> ")"
            '[' -> "]"
            '{' -> "}"
            else -> ")"
          }
        }
      return "$healed${state.delim}$closingBrackets"
    }

    private fun scanFragmentForUnclosedString(fragment: String): UnclosedStringState? {
      var i = 0
      val n = fragment.length
      val st = FragmentScanState()

      while (i < n) {
        val isRaw =
          (fragment[i] == 'r' || fragment[i] == 'R') && i + 1 < n && fragment[i + 1] == '"'
        if (isRaw || fragment[i] == '"') {
          val quotePos = if (isRaw) i + 1 else i
          val delim = if (fragment.startsWith("\"\"\"", quotePos)) "\"\"\"" else "\""
          val end = scanDoubleQuoted(fragment, quotePos, n, raw = isRaw)
          if (end == null) {
            return UnclosedStringState(
              strStart = quotePos + delim.length,
              delim = delim,
              isRaw = isRaw,
              brackets = st.brackets.toList(),
              calls = st.calls.toList(),
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
        val m = IDENT_RE.matchAt(fragment, i)
        if (m != null) {
          st.lastIdent = m.value
          if (st.calls.isNotEmpty() && st.brackets.lastOrNull() == '(') {
            st.calls.last().lastIdent = st.lastIdent
          }
          i = m.range.last + 1
          continue
        }
        val ch = fragment[i]
        val inCallParens = st.calls.isNotEmpty() && st.brackets.lastOrNull() == '('
        when (ch) {
          '(' -> {
            st.brackets.add('(')
            st.calls.add(OpenCallFrame(name = st.lastIdent.orEmpty()))
            st.lastIdent = null
          }
          '[',
          '{' -> {
            st.brackets.add(ch)
            st.lastIdent = null
          }
          ')',
          ']',
          '}' -> {
            if (
              st.brackets.isNotEmpty() &&
                st.brackets.removeAt(st.brackets.lastIndex) == '(' &&
                st.calls.isNotEmpty()
            ) {
              st.calls.removeAt(st.calls.lastIndex)
            }
            st.lastIdent = null
          }
          ',' -> {
            if (inCallParens) {
              val top = st.calls.last()
              top.argIndex++
              top.kwargName = null
              top.lastIdent = null
            }
          }
          '=' -> {
            if (inCallParens && st.calls.last().lastIdent != null) {
              st.calls.last().kwargName = st.calls.last().lastIdent
            }
          }
          else -> if (!ch.isWhitespace()) st.lastIdent = null
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
        val m = DATA_ASSIGN_RE.find(fragment) ?: return false
        val leaf = m.groupValues[1].trimEnd('/').substringAfterLast('/')
        return leaf in progressiveKeys
      }
      val frame = calls.last()
      if (frame.name.isEmpty()) return false
      for (helper in helpers.values) {
        if (frame.name in helper.components) {
          if (frame.kwargName != null) {
            return frame.kwargName in progressiveKeys
          }
          val props =
            helper.getComponentProperties(frame.name).filter { it != "checks" && it != "@checks" }
          if (frame.argIndex < props.size) {
            return props[frame.argIndex] in progressiveKeys
          }
        }
      }
      return false
    }

    private fun hasOddTrailingBackslashes(text: String): Boolean {
      var count = 0
      var idx = text.lastIndex
      while (idx >= 0 && text[idx] == '\\') {
        count++
        idx--
      }
      return count % 2 == 1
    }

    private fun mergeSameSurfaceUpdates(
      messages: List<AgentToRendererMessage>
    ): List<AgentToRendererMessage> {
      val merged = ArrayList<AgentToRendererMessage>()
      for (msg in messages) {
        val prev = merged.lastOrNull()
        if (prev == null || msg !is UpdateComponentsMessage) {
          merged.add(msg)
          continue
        }
        val targetId = msg.surfaceId
        when {
          prev is UpdateComponentsMessage && prev.surfaceId == targetId -> {
            merged[merged.lastIndex] =
              prev.copy(components = mergeComponentLists(prev.components, msg.components))
          }
          prev is CreateSurfaceMessage && prev.components != null && prev.surfaceId == targetId -> {
            merged[merged.lastIndex] =
              prev.copy(components = mergeComponentLists(prev.components, msg.components))
          }
          else -> merged.add(msg)
        }
      }
      return merged
    }

    private fun mergeComponentLists(
      first: List<JsonObject>,
      second: List<JsonObject>,
    ): List<JsonObject> {
      val byId = LinkedHashMap<String, JsonObject>(first.size + second.size)
      for (c in first) byId[(c["id"] as JsonPrimitive).content] = c
      for (c in second) byId[(c["id"] as JsonPrimitive).content] = c
      return byId.values.toList()
    }
  }
}
