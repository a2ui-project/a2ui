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

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.google.a2ui.agent.InferenceFormat
import com.google.a2ui.agent.catalogtransformers.CatalogTransformer
import com.google.a2ui.agent.catalogtransformers.ComponentPruningTransformer
import com.google.a2ui.agent.catalogtransformers.FunctionPruningTransformer
import com.google.a2ui.agent.parser.A2uiCompilationError
import com.google.a2ui.agent.parser.A2uiCompilationException
import com.google.a2ui.agent.parser.A2uiPart
import com.google.a2ui.agent.parser.AfterRejectedBlock
import com.google.a2ui.agent.parser.ErrorPart
import com.google.a2ui.agent.parser.Parser
import com.google.a2ui.agent.parser.RawA2uiPart
import com.google.a2ui.agent.parser.RawResponsePart
import com.google.a2ui.agent.parser.StreamPart
import com.google.a2ui.agent.parser.TextPart
import com.google.a2ui.agent.parser.partialResults
import com.google.a2ui.agent.utils.validatePayload
import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.catalog.CatalogApi
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.common.jsonValuesEqual
import com.google.a2ui.core.exceptions.A2uiCatalogError
import com.google.a2ui.core.exceptions.A2uiError
import com.google.a2ui.core.exceptions.A2uiIntegrityError
import com.google.a2ui.core.exceptions.A2uiParseError
import com.google.a2ui.core.exceptions.A2uiRecursionError
import com.google.a2ui.core.exceptions.A2uiValidationError
import com.google.a2ui.core.schema.AgentToRendererMessage
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNotSame
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

/**
 * Language-agnostic A2UI v1.0 Express conformance test runner executing all 7 Express conformance
 * YAML suites and emitting executed-case manifest JSONL when `A2UI_CONFORMANCE_MANIFEST_DIR` is
 * set.
 */
class ExpressConformanceTest {

  companion object {
    private const val HARNESS_NAME = "kotlin-express"
    private const val CONFORMANCE_SURFACE_ID = "default_surface"
    private const val DEFAULT_CATALOG_REL = "test_data/catalogs/simplified_catalog_v1_0.json"
    private val SUPPORTED_PROTOCOL_VERSIONS = setOf("1.0")

    private val CASE_METADATA_KEYS =
      setOf("name", "description", "features", "protocolVersion", "catalog", "catalogs")
    private val EXPECT_ERROR_KEYS = setOf("category", "message", "details")
    private val EXPECT_ERROR_DETAIL_KEYS = setOf("path", "code", "message")
    private val COMPILE_CASE_KEYS =
      CASE_METADATA_KEYS +
        setOf("action", "args", "input", "expect", "expect_error", "expect_present")
    private val DECOMPILE_CASE_KEYS =
      CASE_METADATA_KEYS +
        setOf(
          "action",
          "args",
          "messages",
          "expect_contains",
          "expect_absent",
          "expect_error",
          "expect_recompiled",
          "expect_round_trip",
        )
    private val UNWRAP_CASE_KEYS = CASE_METADATA_KEYS + setOf("action", "args", "input", "expect")
    private val HAS_FORMAT_CONTENT_CASE_KEYS =
      CASE_METADATA_KEYS + setOf("action", "args", "input", "expect")
    private val WRAP_CASE_KEYS =
      CASE_METADATA_KEYS +
        setOf("action", "args", "parts", "expect_output", "expect_contains", "expect_round_trip")
    private val PARSE_RESPONSE_CASE_KEYS =
      CASE_METADATA_KEYS + setOf("action", "args", "input", "expect", "expect_error")
    private val PARSE_CHUNK_CASE_KEYS =
      CASE_METADATA_KEYS +
        setOf(
          "action",
          "args",
          "steps",
          "expect_close",
          "expect_error",
          "expect_matches_single_shot",
        )
    private val PARSE_CHUNK_STEP_KEYS =
      setOf("input", "expect", "expect_error", "expect_in_block", "expect_partial_results")
    private val GENERATE_PROMPT_SNIPPET_CASE_KEYS =
      CASE_METADATA_KEYS +
        setOf(
          "action",
          "args",
          "expect_file",
          "expect_callable_functions",
          "expect_contains",
          "expect_absent",
          "expect_deterministic",
          "expect_error",
        )
    private val CREATE_FORMAT_CASE_KEYS =
      CASE_METADATA_KEYS + setOf("action", "args", "expect", "expect_error")
    private val CREATE_FORMAT_EXPECT_KEYS =
      setOf(
        "parsers_are_distinct",
        "parser_state_isolated",
        "prompt_snippet_contains",
        "prompt_snippet_absent",
      )
    private val SCALING_CASE_KEYS =
      CASE_METADATA_KEYS + setOf("action", "args", "operation", "payload", "sizes", "max_ratio")
    private val BASE_ARGS_KEYS = setOf("format", "catalog", "catalogs")
    private val ARGS_KEYS_BY_ACTION =
      mapOf(
        "compile" to BASE_ARGS_KEYS,
        "decompile" to BASE_ARGS_KEYS,
        "unwrap" to BASE_ARGS_KEYS,
        "wrap" to BASE_ARGS_KEYS,
        "has_format_content" to BASE_ARGS_KEYS + setOf("complete"),
        "parse_response" to BASE_ARGS_KEYS + setOf("wrapped"),
        "parse_chunk" to
          BASE_ARGS_KEYS + setOf("wrapped", "after_rejected_block", "progressive_keys"),
        "generate_prompt_snippet" to BASE_ARGS_KEYS + setOf("examples", "allowed_messages"),
        "create_format" to
          BASE_ARGS_KEYS +
            setOf("examples", "allowed_messages", "progressive_keys", "probe_chunks"),
        "measure_growth" to BASE_ARGS_KEYS,
      )

    private val yamlMapper = ObjectMapper(YAMLFactory())
    private val conformanceRoot: File by lazy { findConformanceRoot() }
    private val manifestFile: File? by lazy {
      val dir = System.getenv("A2UI_CONFORMANCE_MANIFEST_DIR")?.takeIf { it.isNotBlank() }
      if (dir != null) {
        val folder = File(dir)
        folder.mkdirs()
        File(folder, "$HARNESS_NAME.jsonl")
      } else {
        null
      }
    }

    @JvmStatic
    @BeforeAll
    fun initManifest() {
      manifestFile?.writeText("", Charsets.UTF_8)
    }

    private fun findConformanceRoot(): File {
      var cur: File? = File(System.getProperty("user.dir"))
      while (cur != null) {
        if (File(cur, "conformance/conformance_schema.json").isFile) {
          return File(cur, "conformance")
        }
        cur = cur.parentFile
      }
      error("Could not locate repository 'conformance/conformance_schema.json'.")
    }

    @Synchronized
    private fun recordManifest(
      suite: String,
      caseName: String,
      status: String,
      reason: String? = null,
    ) {
      val target = manifestFile ?: return
      val map = LinkedHashMap<String, JsonElement>()
      map["harness"] = JsonPrimitive(HARNESS_NAME)
      map["suite"] = JsonPrimitive(suite)
      map["case"] = JsonPrimitive(caseName)
      map["status"] = JsonPrimitive(status)
      if (reason != null) {
        map["reason"] = JsonPrimitive(reason)
      }
      target.appendText("${JsonObject(map)}\n", Charsets.UTF_8)
    }
  }

  @TestFactory
  fun compilerConformance(): List<DynamicTest> =
    buildSuiteTests("agent/express/compiler.yaml") { caseMap -> runCompileCase(caseMap) }

  @TestFactory
  fun decompilerConformance(): List<DynamicTest> =
    buildSuiteTests("agent/express/decompiler.yaml") { caseMap -> runDecompileCase(caseMap) }

  @TestFactory
  fun promptGeneratorConformance(): List<DynamicTest> =
    buildSuiteTests("agent/express/prompt_generator.yaml") { caseMap -> runFormatCase(caseMap) }

  @TestFactory
  fun responseParserConformance(): List<DynamicTest> =
    buildSuiteTests("agent/express/response_parser.yaml") { caseMap ->
      runResponseParserCase(caseMap)
    }

  @TestFactory
  fun responseStreamingConformance(): List<DynamicTest> =
    buildSuiteTests("agent/express/response_streaming.yaml") { caseMap ->
      runStreamingCase(caseMap)
    }

  @TestFactory
  fun scalingConformance(): List<DynamicTest> =
    buildSuiteTests("agent/express/scaling.yaml") { caseMap -> runScalingCase(caseMap) }

  @TestFactory
  fun multiCatalogFormatsConformance(): List<DynamicTest> =
    buildSuiteTests("agent/multi_catalog_formats.yaml") { caseMap ->
      runFormatCase(caseMap, sortComponents = true)
    }

  // --- Suite runner & gating ---

  @Suppress("UNCHECKED_CAST")
  private fun buildSuiteTests(
    suiteRelPath: String,
    runner: (Map<String, Any?>) -> Unit,
  ): List<DynamicTest> {
    val yamlFile = File(conformanceRoot, suiteRelPath)
    assertTrue(yamlFile.isFile, "Missing conformance suite: ${yamlFile.absolutePath}")
    val rawList =
      yamlMapper.readValue(yamlFile, List::class.java) as? List<Map<String, Any?>>
        ?: fail("Expected top-level YAML list in $suiteRelPath")
    assertTrue(rawList.isNotEmpty(), "Conformance suite $suiteRelPath must not be empty.")

    return rawList.map { testCase ->
      val caseName = testCase["name"]?.toString() ?: "<unnamed>"
      DynamicTest.dynamicTest("$suiteRelPath :: $caseName") {
        val skipReason = checkGateSkipReason(testCase)
        if (skipReason != null) {
          recordManifest(suiteRelPath, caseName, "skipped", skipReason)
          Assumptions.assumeTrue(false, skipReason)
        }
        try {
          runner(testCase)
          recordManifest(suiteRelPath, caseName, "passed")
        } catch (t: Throwable) {
          recordManifest(suiteRelPath, caseName, "failed")
          throw t
        }
      }
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun checkGateSkipReason(testCase: Map<String, Any?>): String? {
    val args = (testCase["args"] as? Map<String, Any?>).orEmpty()
    val effectiveFormat = (args["format"] ?: "express").toString()
    if (effectiveFormat != "express") {
      return "Format '$effectiveFormat' is outside standalone Express scope."
    }

    val version = detectCaseProtocolVersion(testCase)
    if (version !in SUPPORTED_PROTOCOL_VERSIONS) {
      return "Unsupported pre-1.0 protocol version '$version' (standalone Kotlin Express targets v1.0 only)."
    }
    return null
  }

  @Suppress("UNCHECKED_CAST")
  private fun detectCaseProtocolVersion(testCase: Map<String, Any?>): String {
    testCase["protocolVersion"]?.toString()?.let {
      return canonicalVersion(it)
    }
    val args = (testCase["args"] as? Map<String, Any?>).orEmpty()
    val catRefs = ArrayList<Any?>()
    if ("catalogs" in args) {
      (args["catalogs"] as? List<*>)?.let { catRefs.addAll(it) }
    } else if ("catalog" in args) {
      catRefs.add(args["catalog"])
    } else if ("catalog" in testCase) {
      catRefs.add(testCase["catalog"])
    } else if ("catalogs" in testCase) {
      (testCase["catalogs"] as? List<*>)?.let { catRefs.addAll(it) }
    }
    for (ref in catRefs) {
      val v = extractCatalogRefVersion(ref)
      if (v != null && v != "1.0") return v
    }
    return catRefs.firstNotNullOfOrNull { extractCatalogRefVersion(it) } ?: "1.0"
  }

  private fun extractCatalogRefVersion(ref: Any?): String? {
    var actual = ref
    if (actual is Map<*, *> && "catalog" in actual) {
      actual = actual["catalog"]
    }
    return when (actual) {
      is Map<*, *> -> actual["protocolVersion"]?.toString()?.let { canonicalVersion(it) } ?: "1.0"
      is String -> {
        val obj = loadConformanceJsonObject(actual)
        (obj["protocolVersion"] as? JsonPrimitive)?.contentOrNull?.let { canonicalVersion(it) }
          ?: "1.0"
      }
      else -> null
    }
  }

  private fun canonicalVersion(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed == "v1.0" || trimmed == "1.0" || trimmed == "1.0.0") return "1.0"
    if (trimmed.startsWith("0.")) return "v$trimmed"
    return trimmed
  }

  // --- Case executors ---

  @Suppress("UNCHECKED_CAST")
  private fun runCompileCase(testCase: Map<String, Any?>, sortComponents: Boolean = false) {
    assertEquals("compile", testCase["action"])
    assertKnownKeys(testCase, COMPILE_CASE_KEYS, "compile case")
    val args = testCase["args"] as Map<String, Any?>
    assertActionArgs("compile", args)
    val parser = makeParser(args)
    val payload = testCase["input"] as String

    if ("expect_error" in testCase) {
      assertRaisesExpected(testCase["expect_error"]!!) { compileChecked(parser, payload) }
      return
    }

    val rawCompiled = compileChecked(parser, payload)
    val compiledJson = rawCompiled.map { it.toJsonObject() }.toMutableList()

    (testCase["expect_present"] as? List<String>)?.forEach { pointer ->
      val resolved = resolvePointer(compiledJson, pointer)
      assertNotNull(resolved, "Expected non-null value at pointer '$pointer'")
      if (resolved is JsonPrimitive && resolved.isString) {
        assertTrue(resolved.content.isNotEmpty(), "Expected non-empty string at '$pointer'")
      }
      deletePointer(compiledJson, pointer)
    }

    val expectedJson = (testCase["expect"] as List<*>).map { anyToJsonElement(it).jsonObject }
    if (sortComponents) {
      assertJsonListEquals(
        sortComponentsById(expectedJson),
        sortComponentsById(compiledJson),
        "compile messages (sorted components)",
      )
    } else {
      assertJsonListEquals(expectedJson, compiledJson, "compile messages")
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun runDecompileCase(testCase: Map<String, Any?>, sortComponents: Boolean = false) {
    assertEquals("decompile", testCase["action"])
    assertKnownKeys(testCase, DECOMPILE_CASE_KEYS, "decompile case")
    val args = testCase["args"] as Map<String, Any?>
    assertActionArgs("decompile", args)
    val parser = makeParser(args)
    val origMessagesJson = (testCase["messages"] as List<*>).map { anyToJsonElement(it).jsonObject }

    if ("expect_error" in testCase) {
      assertRaisesExpected(testCase["expect_error"]!!) {
        val models = origMessagesJson.map { AgentToRendererMessage.fromJsonObject(it) }
        parser.decompile(models)
      }
      return
    }

    val models = origMessagesJson.map { AgentToRendererMessage.fromJsonObject(it) }
    val notation = parser.decompile(models)

    (testCase["expect_contains"] as? List<String>)?.forEach { frag ->
      assertTrue(frag in notation, "Expected '$frag' in decompiled output:\n$notation")
    }
    (testCase["expect_absent"] as? List<String>)?.forEach { frag ->
      assertFalse(
        frag in notation,
        "Expected '$frag' to be absent from decompiled output:\n$notation",
      )
    }

    if (testCase["expect_round_trip"] == true) {
      val recompiled = compileChecked(makeParser(args), notation).map { it.toJsonObject() }
      if (sortComponents) {
        assertJsonListEquals(
          sortComponentsById(origMessagesJson),
          sortComponentsById(recompiled),
          "round-trip messages",
        )
      } else {
        assertJsonListEquals(origMessagesJson, recompiled, "round-trip messages")
      }
    }

    if ("expect_recompiled" in testCase) {
      val expectedRecompiled =
        (testCase["expect_recompiled"] as List<*>).map { anyToJsonElement(it).jsonObject }
      val actualRecompiled = compileChecked(makeParser(args), notation).map { it.toJsonObject() }
      if (sortComponents) {
        assertJsonListEquals(
          sortComponentsById(expectedRecompiled),
          sortComponentsById(actualRecompiled),
          "expect_recompiled messages",
        )
      } else {
        assertJsonListEquals(expectedRecompiled, actualRecompiled, "expect_recompiled messages")
      }
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun runResponseParserCase(testCase: Map<String, Any?>) {
    val args = testCase["args"] as Map<String, Any?>
    val action = testCase["action"] as String
    if (action !in setOf("unwrap", "has_format_content", "wrap", "parse_response")) {
      fail("Unknown response_parser action: $action")
    }
    assertActionArgs(action, args)
    val parser = makeParser(args)
    when (action) {
      "unwrap" -> {
        assertKnownKeys(testCase, UNWRAP_CASE_KEYS, "unwrap case")
        val input = testCase["input"] as String
        val expected =
          (testCase["expect"] as List<*>).map {
            withoutTrueFinalFlag(anyToJsonElement(it).jsonObject)
          }
        val actual = parser.unwrap(input).map { rawPartToJson(it) }
        assertJsonListEquals(expected, actual, "unwrap parts")

        val hasAny = expected.any { "a2ui_raw" in it }
        val hasComplete =
          (testCase["expect"] as List<*>)
            .map { it as Map<String, Any?> }
            .any { "a2ui_raw" in it && (it["is_final"] as? Boolean ?: true) }
        assertEquals(hasAny, parser.hasFormatContent(input))
        assertEquals(hasComplete, parser.hasFormatContent(input, complete = true))
      }
      "has_format_content" -> {
        assertKnownKeys(testCase, HAS_FORMAT_CONTENT_CASE_KEYS, "has_format_content case")
        val complete = args["complete"] as? Boolean ?: false
        assertEquals(
          testCase["expect"] as Boolean,
          parser.hasFormatContent(testCase["input"] as String, complete = complete),
        )
      }
      "wrap" -> {
        assertKnownKeys(testCase, WRAP_CASE_KEYS, "wrap case")
        val partsList = testCase["parts"] as List<Map<String, Any?>>
        val output = parser.wrap(toRawParts(partsList))
        if ("expect_output" in testCase) {
          assertEquals(testCase["expect_output"] as String, output)
        }
        (testCase["expect_contains"] as? List<String>)?.forEach { frag ->
          assertTrue(frag in output, "Expected '$frag' in wrapped output:\n$output")
        }
        if (testCase["expect_round_trip"] == true) {
          val expected = partsList.map { withoutTrueFinalFlag(anyToJsonElement(it).jsonObject) }
          val actual = parser.unwrap(output).map { rawPartToJson(it) }
          assertJsonListEquals(expected, actual, "wrap round-trip parts")
        }
      }
      "parse_response" -> {
        assertKnownKeys(testCase, PARSE_RESPONSE_CASE_KEYS, "parse_response case")
        val wrapped = args["wrapped"] as? Boolean ?: true
        val input = testCase["input"] as String
        if ("expect_error" in testCase) {
          assertRaisesExpected(testCase["expect_error"]!!) {
            parser.parseResponse(input, wrapped = wrapped)
          }
          return
        }
        val actual = parser.parseResponse(input, wrapped = wrapped).map { streamPartToJson(it) }
        val expected = (testCase["expect"] as List<*>).map { anyToJsonElement(it).jsonObject }
        assertJsonListEquals(expected, actual, "parse_response parts")
      }
      else -> fail("Unknown response_parser action: $action")
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun runStreamingCase(testCase: Map<String, Any?>) {
    assertEquals("parse_chunk", testCase["action"])
    assertKnownKeys(testCase, PARSE_CHUNK_CASE_KEYS, "parse_chunk case")
    val args = testCase["args"] as Map<String, Any?>
    assertActionArgs("parse_chunk", args)
    val wrapped = args["wrapped"] as? Boolean ?: true
    val afterRejected = AfterRejectedBlock.fromString(args["after_rejected_block"] as? String)
    val stream = makeParser(args).openStream(wrapped = wrapped, afterRejectedBlock = afterRejected)

    val chunks = ArrayList<String>()
    val yielded = ArrayList<JsonObject>()

    for (step in testCase["steps"] as List<Map<String, Any?>>) {
      assertKnownKeys(step, PARSE_CHUNK_STEP_KEYS, "parse_chunk step")
      val chunk = step["input"] as String
      chunks.add(chunk)
      if ("expect_error" in step) {
        val caught = assertRaisesExpected(step["expect_error"]!!) { stream.feed(chunk) }
        if ("expect_partial_results" in step) {
          val expectedPartial =
            (step["expect_partial_results"] as List<*>).map { anyToJsonElement(it).jsonObject }
          val actualPartial =
            (caught as? A2uiError)?.partialResults.orEmpty().map { streamPartToJson(it) }
          assertJsonListEquals(expectedPartial, actualPartial, "step partial_results")
        }
        if ("expect_in_block" in step) {
          assertEquals(step["expect_in_block"] as Boolean, stream.isInBlock)
        }
        return
      }

      val parts = stream.feed(chunk)
      val stepJson = parts.map { streamPartToJson(it) }
      val expectedStep = (step["expect"] as List<*>).map { anyToJsonElement(it).jsonObject }
      assertJsonListEquals(expectedStep, stepJson, "parse_chunk step parts")
      if ("expect_in_block" in step) {
        assertEquals(step["expect_in_block"] as Boolean, stream.isInBlock)
      }
      yielded.addAll(stepJson)
    }

    if ("expect_error" in testCase) {
      assertRaisesExpected(testCase["expect_error"]!!) { stream.close() }
      return
    }

    val closedJson = stream.close().map { streamPartToJson(it) }
    if ("expect_close" in testCase) {
      val expectedClose =
        (testCase["expect_close"] as List<*>).map { anyToJsonElement(it).jsonObject }
      assertJsonListEquals(expectedClose, closedJson, "parse_chunk close parts")
    }
    yielded.addAll(closedJson)

    if (testCase["expect_matches_single_shot"] == true) {
      val singleShot =
        makeParser(args).parseResponse(chunks.joinToString(""), wrapped = wrapped).map {
          streamPartToJson(it)
        }
      assertJsonListEquals(
        mergeTextParts(singleShot),
        mergeTextParts(yielded),
        "single-shot vs streaming merged output",
      )
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun runFormatCase(testCase: Map<String, Any?>, sortComponents: Boolean = false) {
    when (val action = testCase["action"] as String) {
      "compile" -> runCompileCase(testCase, sortComponents = sortComponents)
      "decompile" -> runDecompileCase(testCase, sortComponents = sortComponents)
      "parse_response" -> runResponseParserCase(testCase)
      "generate_prompt_snippet" -> {
        assertKnownKeys(testCase, GENERATE_PROMPT_SNIPPET_CASE_KEYS, "generate_prompt_snippet case")
        val args = testCase["args"] as Map<String, Any?>
        assertActionArgs("generate_prompt_snippet", args)
        if ("expect_error" in testCase) {
          assertRaisesExpected(testCase["expect_error"]!!) {
            makeFormat(args).promptGenerator.generate()
          }
          return
        }
        val fmt = makeFormat(args)
        val snippet = fmt.promptGenerator.generate()
        if ("expect_file" in testCase) {
          val expectedText =
            File(conformanceRoot, testCase["expect_file"] as String).readText(Charsets.UTF_8)
          assertEquals(expectedText, snippet)
        }
        (testCase["expect_contains"] as? List<String>)?.forEach { frag ->
          assertTrue(frag in snippet, "Expected '$frag' in prompt snippet:\n$snippet")
        }
        (testCase["expect_absent"] as? List<String>)?.forEach { frag ->
          assertFalse(frag in snippet, "Expected '$frag' absent from prompt snippet:\n$snippet")
        }
        if ("expect_callable_functions" in testCase) {
          val expectedCallable = testCase["expect_callable_functions"] as List<String>
          assertEquals(
            expectedCallable,
            CatalogSchemaHelper.agentCallableFunctionNames(catalogsFor(args)),
          )
          for (fnName in expectedCallable) {
            assertTrue(fnName in snippet, "Expected callable function '$fnName' in snippet")
          }
        }
        if (testCase["expect_deterministic"] == true) {
          assertEquals(snippet, makeFormat(args).promptGenerator.generate())
        }
      }
      "create_format" -> {
        assertKnownKeys(testCase, CREATE_FORMAT_CASE_KEYS, "create_format case")
        val args = testCase["args"] as Map<String, Any?>
        assertActionArgs("create_format", args)
        if ("expect_error" in testCase) {
          assertRaisesExpected(testCase["expect_error"]!!) { makeFormat(args) }
          return
        }
        val fmt = makeFormat(args)
        val expect = (testCase["expect"] as? Map<String, Any?>).orEmpty()
        assertKnownKeys(expect, CREATE_FORMAT_EXPECT_KEYS, "create_format expect")

        if (expect["parsers_are_distinct"] == true) {
          assertNotSame(fmt.createParser(), fmt.createParser())
        }
        if (expect["parser_state_isolated"] == true) {
          val chunks = args["probe_chunks"] as List<String>
          fun readWith(parser: Parser): List<List<JsonObject>> {
            val s = parser.openStream()
            return chunks.map { ch -> s.feed(ch).map { streamPartToJson(it) } }
          }
          val first = readWith(fmt.createParser())
          assertTrue(first.any { it.isNotEmpty() })
          val second = readWith(fmt.createParser())
          assertEquals(first.size, second.size)
          for (i in first.indices) {
            assertJsonListEquals(first[i], second[i], "parser_state_isolated chunk $i")
          }
        }
        val snippet = fmt.promptGenerator.generate()
        (expect["prompt_snippet_contains"] as? List<String>)?.forEach { frag ->
          assertTrue(frag in snippet, "Expected '$frag' in snippet:\n$snippet")
        }
        (expect["prompt_snippet_absent"] as? List<String>)?.forEach { frag ->
          assertFalse(frag in snippet, "Expected '$frag' absent from snippet:\n$snippet")
        }
      }
      else -> fail("Unsupported format action: $action")
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun runScalingCase(testCase: Map<String, Any?>) {
    assertEquals("measure_growth", testCase["action"])
    assertKnownKeys(testCase, SCALING_CASE_KEYS, "scaling case")
    val args = testCase["args"] as Map<String, Any?>
    assertActionArgs("measure_growth", args)
    val fmt = makeFormat(args)
    assertEquals("compile", testCase["operation"])

    val sizes = (testCase["sizes"] as List<Number>).map { it.toInt() }
    assertEquals(2, sizes.size)
    val maxRatio = (testCase["max_ratio"] as Number).toDouble()
    val payloadSpec = testCase["payload"] as List<Any?>

    val smallPayload = renderScalingPayload(payloadSpec, sizes[0])
    val largePayload = renderScalingPayload(payloadSpec, sizes[1])

    // Warm up JIT before measuring
    repeat(3) {
      fmt.createParser().parseResponse(smallPayload, wrapped = false)
      fmt.createParser().parseResponse(largePayload, wrapped = false)
    }

    val smallSamples = ArrayList<Long>(5)
    val largeSamples = ArrayList<Long>(5)
    repeat(5) { round ->
      if (round % 2 == 0) {
        smallSamples.add(
          timeNano { fmt.createParser().parseResponse(smallPayload, wrapped = false) }
        )
        largeSamples.add(
          timeNano { fmt.createParser().parseResponse(largePayload, wrapped = false) }
        )
      } else {
        largeSamples.add(
          timeNano { fmt.createParser().parseResponse(largePayload, wrapped = false) }
        )
        smallSamples.add(
          timeNano { fmt.createParser().parseResponse(smallPayload, wrapped = false) }
        )
      }
    }
    smallSamples.sort()
    largeSamples.sort()
    val medianSmall = smallSamples[smallSamples.size / 2].coerceAtLeast(1L)
    val medianLarge = largeSamples[largeSamples.size / 2]
    val ratio = medianLarge.toDouble() / medianSmall.toDouble()
    assertTrue(
      ratio <= maxRatio,
      "Scaling ratio ${"%.2f".format(ratio)} exceeded max_ratio $maxRatio (small=${medianSmall}ns, large=${medianLarge}ns).",
    )
  }

  private inline fun timeNano(block: () -> Unit): Long {
    val start = System.nanoTime()
    block()
    return System.nanoTime() - start
  }

  @Suppress("UNCHECKED_CAST")
  private fun renderScalingPayload(spec: List<Any?>, count: Int): String {
    val sb = StringBuilder()
    for (entry in spec) {
      when (entry) {
        is String -> sb.append(entry)
        is Map<*, *> -> {
          val tpl = entry["repeat"] as String
          val sep = (entry["separator"] as? String).orEmpty()
          for (i in 0 until count) {
            if (i > 0) sb.append(sep)
            sb.append(tpl.replace("{i}", i.toString()))
          }
        }
        else -> error("Unexpected payload spec entry: $entry")
      }
    }
    return sb.toString()
  }

  // --- Helpers ---

  private fun compileChecked(parser: Parser, content: String): List<AgentToRendererMessage> {
    val messages =
      try {
        parser.compile(content)
      } catch (e: A2uiError) {
        throw e
      } catch (e: Exception) {
        throw A2uiCompilationException(
          message = "Failed to compile A2UI block: ${e.message}",
          rawBlock = content,
          cause = e,
        )
      }
    validatePayload(parser.catalogs, messages)
    return messages
  }

  @Suppress("UNCHECKED_CAST")
  private fun makeParser(args: Map<String, Any?>): Parser = makeFormat(args).createParser()

  @Suppress("UNCHECKED_CAST")
  private fun makeFormat(args: Map<String, Any?>): InferenceFormat {
    val catalogs =
      when {
        "catalogs" in args -> (args["catalogs"] as List<*>).map { setupCatalogFromDoc(it) }
        "catalog" in args -> listOf(setupCatalogFromDoc(args["catalog"]))
        else -> listOf(setupCatalogFromDoc(DEFAULT_CATALOG_REL))
      }
    if (catalogs.isEmpty()) {
      throw A2uiCatalogError("At least one active catalog is required.")
    }
    val examples =
      (args["examples"] as? List<String>)?.map { relPath ->
        val el = loadConformanceJsonElement(relPath)
        val rawList =
          when (el) {
            is JsonArray -> el.map { it.jsonObject }
            is JsonObject -> listOf(el)
            else -> emptyList()
          }
        rawList.map { AgentToRendererMessage.fromJsonObject(it) }
      }
    val allowedMessages = (args["allowed_messages"] as? List<*>)?.map { it.toString() }
    val progressiveKeys =
      (args["progressive_keys"] as? List<*>)?.mapTo(LinkedHashSet()) { it.toString() }
    val fmtName = (args["format"] ?: "express").toString()
    if (fmtName != "express") {
      throw IllegalArgumentException("Unsupported format: $fmtName")
    }
    return ExpressFormat(
      catalogs = catalogs,
      examples = examples,
      allowedMessages = allowedMessages,
      surfaceId = CONFORMANCE_SURFACE_ID,
      progressiveKeys = progressiveKeys ?: DEFAULT_EXPRESS_PROGRESSIVE_KEYS,
    )
  }

  @Suppress("UNCHECKED_CAST")
  private fun catalogsFor(args: Map<String, Any?>): List<CatalogApi> =
    if ("catalogs" in args) {
      (args["catalogs"] as List<*>).map { setupCatalogFromDoc(it) }
    } else {
      listOf(setupCatalogFromDoc(args["catalog"] ?: DEFAULT_CATALOG_REL))
    }

  @Suppress("UNCHECKED_CAST")
  private fun setupCatalogFromDoc(ref: Any?): CatalogApi {
    var actual = ref
    val transformers = ArrayList<CatalogTransformer>()
    if (actual is Map<*, *> && "catalog" in actual) {
      val rawTrs = (actual["transformers"] as? List<Map<String, Any?>>).orEmpty()
      for (spec in rawTrs) {
        when {
          "component_pruning" in spec -> {
            val allow =
              (spec["component_pruning"] as List<*>).mapTo(LinkedHashSet()) { it.toString() }
            transformers.add(ComponentPruningTransformer(allow))
          }
          "function_pruning" in spec -> {
            val allow =
              (spec["function_pruning"] as List<*>).mapTo(LinkedHashSet()) { it.toString() }
            transformers.add(FunctionPruningTransformer(allow))
          }
          else -> error("Unknown transformer spec: $spec")
        }
      }
      actual = actual["catalog"]
    }

    val baseCatalog =
      when (actual) {
        is Map<*, *> -> {
          val rawObj = anyToJsonElement(actual).jsonObject
          val fallbackId =
            (rawObj["\$id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: "inline"
          Catalog.fromJson(
            document = rawObj,
            expectedVersion = if ("protocolVersion" !in rawObj) ProtocolVersion.V1_0 else null,
            expectedCatalogId = if ("catalogId" !in rawObj) fallbackId else null,
          )
        }
        is String -> {
          val rawObj = loadConformanceJsonObject(actual)
          val fallbackId =
            (rawObj["\$id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
              ?: File(actual).nameWithoutExtension
          Catalog.fromJson(
            document = rawObj,
            expectedVersion = if ("protocolVersion" !in rawObj) ProtocolVersion.V1_0 else null,
            expectedCatalogId = if ("catalogId" !in rawObj) fallbackId else null,
          )
        }
        else -> error("Unsupported catalog ref: $actual")
      }

    return transformers.fold(baseCatalog) { acc, tr -> tr.transform(acc) }
  }

  private fun loadConformanceJsonElement(relPath: String): JsonElement {
    val file = File(conformanceRoot, relPath)
    return Json.parseToJsonElement(file.readText(Charsets.UTF_8))
  }

  private fun loadConformanceJsonObject(relPath: String): JsonObject =
    loadConformanceJsonElement(relPath).jsonObject

  @Suppress("UNCHECKED_CAST")
  private fun assertRaisesExpected(expectError: Any, block: () -> Unit): Throwable {
    val map =
      expectError as? Map<String, Any?> ?: fail("expect_error must be a mapping, got: $expectError")
    assertKnownKeys(map, EXPECT_ERROR_KEYS, "expect_error")

    val caught =
      try {
        block()
        null
      } catch (t: Throwable) {
        t
      } ?: fail("Expected error $expectError, but block succeeded without throwing.")

    val category = map["category"] as? String
    val expectedMatch =
      when (category) {
        "ParseError" -> caught is A2uiParseError
        "ValidationError" -> caught is A2uiValidationError
        "CatalogError" -> caught is A2uiCatalogError
        "IntegrityError" -> caught is A2uiIntegrityError
        "RecursionError" -> caught is A2uiRecursionError
        "CompilationError" -> caught is A2uiCompilationError
        null -> caught is A2uiError
        else -> false
      }
    assertTrue(
      expectedMatch,
      "Expected error category '$category', got ${caught::class.simpleName}: ${caught.message}",
    )
    val msgPattern = (map["message"] as? String).orEmpty()
    if (msgPattern.isNotEmpty()) {
      val re = Regex(msgPattern)
      assertTrue(
        re.containsMatchIn(caught.message.orEmpty()),
        "Expected error message matching '$msgPattern', got: '${caught.message}'",
      )
    }
    val expectedDetails = map["details"] as? List<Map<String, Any?>>
    if (expectedDetails != null) {
      val actualDetails = (caught as? A2uiError)?.details.orEmpty()
      for (exp in expectedDetails) {
        assertKnownKeys(exp, EXPECT_ERROR_DETAIL_KEYS, "expect_error.details[]")
        val expPath = exp["path"]?.toString()
        val expCode = exp["code"]?.toString()
        val found = actualDetails.any { it.path == expPath && it.code == expCode }
        assertTrue(found, "Expected error detail(path=$expPath, code=$expCode) in $actualDetails")
      }
    }
    return caught
  }

  private fun categoryOf(error: A2uiError): String =
    when (error) {
      is A2uiIntegrityError -> "IntegrityError"
      is A2uiRecursionError -> "RecursionError"
      is A2uiParseError -> "ParseError"
      is A2uiValidationError -> "ValidationError"
      is A2uiCatalogError -> "CatalogError"
      else ->
        if (error is A2uiCompilationError) {
          "CompilationError"
        } else {
          fail("Uncategorized A2uiError: ${error::class.qualifiedName}")
        }
    }

  private fun streamPartToJson(part: StreamPart): JsonObject =
    when (part) {
      is TextPart -> JsonObject(mapOf("text" to JsonPrimitive(part.text)))
      is A2uiPart -> JsonObject(mapOf("a2ui" to JsonArray(part.a2ui.map { it.toJsonObject() })))
      is ErrorPart ->
        JsonObject(
          mapOf("error" to JsonObject(mapOf("category" to JsonPrimitive(categoryOf(part.error)))))
        )
    }

  private fun rawPartToJson(part: RawResponsePart): JsonObject =
    when (val inner = part.part) {
      is TextPart -> JsonObject(mapOf("text" to JsonPrimitive(inner.text)))
      is RawA2uiPart ->
        JsonObject(
          buildMap {
            put("a2ui_raw", JsonPrimitive(inner.a2uiRaw))
            if (!part.isFinal) put("is_final", JsonPrimitive(false))
          }
        )
    }

  private fun withoutTrueFinalFlag(obj: JsonObject): JsonObject =
    JsonObject(
      obj.filterNot { (k, v) ->
        k == "is_final" && v is JsonPrimitive && !v.isString && v.content == "true"
      }
    )

  private fun toRawParts(dicts: List<Map<String, Any?>>): List<RawResponsePart> =
    dicts.map { d ->
      val isFinal = d["is_final"] as? Boolean ?: true
      when {
        "text" in d -> RawResponsePart(TextPart(d["text"] as String), isFinal = isFinal)
        "a2ui_raw" in d -> RawResponsePart(RawA2uiPart(d["a2ui_raw"] as String), isFinal = isFinal)
        else -> error("Invalid raw part dict: $d")
      }
    }

  private fun mergeTextParts(parts: List<JsonObject>): List<JsonObject> {
    val merged = ArrayList<JsonObject>()
    for (p in parts) {
      val prev = merged.lastOrNull()
      val prevText = (prev?.get("text") as? JsonPrimitive)?.takeIf { it.isString }?.content
      val curText = (p["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (prevText != null && curText != null) {
        merged[merged.lastIndex] = JsonObject(mapOf("text" to JsonPrimitive(prevText + curText)))
      } else {
        merged.add(p)
      }
    }
    return merged
  }

  private fun sortComponentsById(messages: List<JsonObject>): List<JsonObject> =
    messages.map { msg ->
      val updated = LinkedHashMap<String, JsonElement>(msg)
      for (key in listOf("createSurface", "updateComponents")) {
        val body = msg[key] as? JsonObject ?: continue
        val comps = body["components"] as? JsonArray ?: continue
        val sorted =
          comps.map { it.jsonObject }.sortedBy { (it["id"] as? JsonPrimitive)?.content.orEmpty() }
        val newBody = LinkedHashMap<String, JsonElement>(body)
        newBody["components"] = JsonArray(sorted)
        updated[key] = JsonObject(newBody)
      }
      JsonObject(updated)
    }

  private fun resolvePointer(payload: List<JsonObject>, pointer: String): JsonElement? {
    var cur: JsonElement = JsonArray(payload)
    for (tok in pointer.trim('/').split('/')) {
      cur =
        when (cur) {
          is JsonArray -> cur.getOrNull(tok.toInt()) ?: return null
          is JsonObject -> cur[tok] ?: return null
          else -> return null
        }
    }
    return cur
  }

  private fun deletePointer(payload: MutableList<JsonObject>, pointer: String) {
    val tokens = pointer.trim('/').split('/')
    val msgIdx = tokens[0].toInt()
    fun removeAtTokens(el: JsonElement, idx: Int): JsonElement {
      val key = tokens[idx]
      if (idx == tokens.lastIndex) {
        return when (el) {
          is JsonObject -> JsonObject(el.filterKeys { it != key })
          is JsonArray -> {
            val rmIdx = key.toInt()
            JsonArray(el.filterIndexed { i, _ -> i != rmIdx })
          }
          else -> el
        }
      }
      return when (el) {
        is JsonObject -> {
          val nextMap = LinkedHashMap<String, JsonElement>(el)
          el[key]?.let { nextMap[key] = removeAtTokens(it, idx + 1) }
          JsonObject(nextMap)
        }
        is JsonArray -> {
          val iKey = key.toInt()
          JsonArray(
            el.mapIndexed { i, item -> if (i == iKey) removeAtTokens(item, idx + 1) else item }
          )
        }
        else -> el
      }
    }
    payload[msgIdx] = removeAtTokens(payload[msgIdx], 1).jsonObject
  }

  private fun assertActionArgs(action: String, args: Map<String, Any?>) {
    val allowed =
      ARGS_KEYS_BY_ACTION[action] ?: fail("Missing ARGS_KEYS_BY_ACTION entry for action '$action'")
    assertKnownKeys(args, allowed, "$action args")
  }

  private fun assertKnownKeys(map: Map<String, Any?>, allowed: Set<String>, label: String) {
    val unknown = map.keys - allowed
    assertTrue(unknown.isEmpty(), "Unknown key(s) $unknown in $label (allowed: $allowed)")
  }

  private fun assertJsonListEquals(
    expected: List<JsonObject>,
    actual: List<JsonObject>,
    context: String,
  ) {
    val expArr = JsonArray(expected)
    val actArr = JsonArray(actual)
    if (!jsonValuesEqual(expArr, actArr)) {
      fail("JSON mismatch in $context:\nExpected: $expArr\nActual:   $actArr")
    }
  }

  private fun anyToJsonElement(value: Any?): JsonElement =
    when (value) {
      null -> JsonNull
      is JsonElement -> value
      is Boolean -> JsonPrimitive(value)
      is Int -> JsonPrimitive(value)
      is Long -> JsonPrimitive(value)
      is Double -> JsonPrimitive(value)
      is Float -> JsonPrimitive(value)
      is Number -> JsonPrimitive(value.toDouble())
      is String -> JsonPrimitive(value)
      is Map<*, *> ->
        JsonObject(value.entries.associate { (k, v) -> k.toString() to anyToJsonElement(v) })
      is Iterable<*> -> JsonArray(value.map { anyToJsonElement(it) })
      else -> JsonPrimitive(value.toString())
    }
}
