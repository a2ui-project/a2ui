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

package com.google.a2ui.conformance

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.google.a2ui.basic_catalog.BasicCatalog
import com.google.a2ui.exceptions.A2uiCatalogException
import com.google.a2ui.exceptions.A2uiIntegrityException
import com.google.a2ui.exceptions.A2uiParseException
import com.google.a2ui.exceptions.A2uiRecursionException
import com.google.a2ui.exceptions.A2uiValidationException
import com.google.a2ui.inference_formats.experimental.express.DEFAULT_EXPRESS_PROGRESSIVE_KEYS
import com.google.a2ui.inference_formats.experimental.express.ExpressCompiler
import com.google.a2ui.inference_formats.experimental.express.ExpressDecompiler
import com.google.a2ui.inference_formats.experimental.express.ExpressFormat
import com.google.a2ui.inference_formats.experimental.express.ExpressParseError
import com.google.a2ui.inference_formats.experimental.express.ExpressParser
import com.google.a2ui.inference_formats.experimental.express.ExpressPromptGenerator
import com.google.a2ui.inference_formats.experimental.express.ExpressRendererState
import com.google.a2ui.inference_formats.experimental.express.ExpressStreamPart
import com.google.a2ui.inference_formats.experimental.express.ExpressValidationError
import com.google.a2ui.inference_formats.experimental.express.prune
import com.google.a2ui.parser.errors.A2uiCompilationError
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.SchemaResourceLoader
import java.io.File
import kotlin.math.abs
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

/**
 * JUnit 5 conformance harness executing the Express agent conformance suites:
 * - `agent/express/compiler.yaml`
 * - `agent/express/decompiler.yaml`
 * - `agent/express/prompt_generator.yaml`
 * - `agent/express/response_parser.yaml`
 * - `agent/express/response_streaming.yaml`
 * - `agent/express/scaling.yaml`
 * - `agent/multi_catalog_formats.yaml` (Express cases)
 *
 * Plus decompile -> recompile round-trip verification across `catalogs/basic/v1/examples/`.
 */
class ExpressConformanceTest {

  @TestFactory
  fun compilerSuite(): List<DynamicTest> =
    buildSuiteDynamicTests("agent/express/compiler.yaml", expectedExpressCount = 135)

  @TestFactory
  fun decompilerSuite(): List<DynamicTest> =
    buildSuiteDynamicTests("agent/express/decompiler.yaml", expectedExpressCount = 49)

  @TestFactory
  fun promptGeneratorSuite(): List<DynamicTest> =
    buildSuiteDynamicTests("agent/express/prompt_generator.yaml", expectedExpressCount = 23)

  @TestFactory
  fun responseParserSuite(): List<DynamicTest> =
    buildSuiteDynamicTests("agent/express/response_parser.yaml", expectedExpressCount = 38)

  @TestFactory
  fun responseStreamingSuite(): List<DynamicTest> =
    buildSuiteDynamicTests("agent/express/response_streaming.yaml", expectedExpressCount = 41)

  @TestFactory
  fun scalingSuite(): List<DynamicTest> =
    buildSuiteDynamicTests("agent/express/scaling.yaml", expectedExpressCount = 1)

  @TestFactory
  fun multiCatalogExpressSuite(): List<DynamicTest> =
    buildSuiteDynamicTests(
      "agent/multi_catalog_formats.yaml",
      expectedExpressCount = 20,
      filterExpressOnly = true,
    )

  @TestFactory
  fun specificationExamplesRoundTripSuite(): List<DynamicTest> {
    val examplesDir = File(repoRoot, "catalogs/basic/v1/examples")
    val files =
      examplesDir.listFiles { f -> f.isFile && f.name.endsWith(".json") }?.sortedBy { it.name }
        ?: emptyList()
    assertEquals(43, files.size, "Expected 43 golden example files in catalogs/basic/v1/examples")

    val basicCatalog = run {
      val config = BasicCatalog.getConfig(A2uiVersion.VERSION_1_0)
      val manager = A2uiSchemaManager(version = A2uiVersion.VERSION_1_0, catalogs = listOf(config))
      manager.getSelectedCatalog()
    }
    val decompiler = ExpressDecompiler(basicCatalog)
    val compiler = ExpressCompiler(basicCatalog)

    return files.map { file ->
      DynamicTest.dynamicTest("example_roundtrip:${file.name}") {
        val rootObj = Json.parseToJsonElement(file.readText()) as JsonObject
        val rawMessages =
          (rootObj["messages"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: listOf(rootObj)
        val componentsById = LinkedHashMap<String, JsonObject>()
        var surfaceId = "main"
        for (msg in rawMessages) {
          (msg["createSurface"] as? JsonObject)?.let { cs ->
            surfaceId = cs["surfaceId"]?.jsonPrimitive?.contentOrNull ?: surfaceId
            (cs["components"] as? JsonArray)?.forEach { c ->
              val co = c as? JsonObject ?: return@forEach
              co["id"]?.jsonPrimitive?.contentOrNull?.let { componentsById[it] = co }
            }
          }
          (msg["updateComponents"] as? JsonObject)?.let { uc ->
            (uc["components"] as? JsonArray)?.forEach { c ->
              val co = c as? JsonObject ?: return@forEach
              co["id"]?.jsonPrimitive?.contentOrNull?.let { componentsById[it] = co }
            }
          }
        }

        val reachable = filterReachableFromRoot(componentsById)
        assertTrue(reachable.isNotEmpty(), "Expected reachable components in ${file.name}")

        val createMsg =
          JsonObject(
            mapOf(
              "version" to JsonPrimitive("1.0"),
              "createSurface" to
                JsonObject(
                  mapOf(
                    "surfaceId" to JsonPrimitive(surfaceId),
                    "catalogId" to JsonPrimitive(basicCatalog.catalogId),
                    "components" to JsonArray(reachable.values.toList()),
                  )
                ),
            )
          )

        val dsl = decompiler.decompile(listOf(createMsg))
        assertTrue(dsl.isNotBlank(), "Decompiled DSL for ${file.name} must not be blank")
        val recompiled = compiler.compileChecked(dsl, surfaceId = surfaceId)
        assertJsonListEquals(
          listOf(createMsg),
          recompiled,
          ignoreComponentOrder = true,
          context = "Round-trip mismatch in ${file.name}\nDSL:\n$dsl",
        )
      }
    }
  }

  private fun buildSuiteDynamicTests(
    suiteRelPath: String,
    expectedExpressCount: Int,
    filterExpressOnly: Boolean = false,
  ): List<DynamicTest> {
    val suiteFile = File(conformanceDir, suiteRelPath)
    assertTrue(suiteFile.exists(), "Missing conformance suite file: ${suiteFile.absolutePath}")

    @Suppress("UNCHECKED_CAST")
    val rawCases = yamlMapper.readValue(suiteFile, List::class.java) as List<Map<String, Any?>>
    assertTrue(rawCases.isNotEmpty(), "Suite $suiteRelPath contained 0 cases")

    val expressCases = mutableListOf<Map<String, Any?>>()
    for (tc in rawCases) {
      val caseName = tc["name"] as? String ?: fail("Missing 'name' in $suiteRelPath case: $tc")
      @Suppress("UNCHECKED_CAST") val args = (tc["args"] as? Map<String, Any?>) ?: emptyMap()
      val fmt = args["format"] as? String
      if (filterExpressOnly && fmt != "express") {
        recordManifest(
          suite = suiteRelPath,
          caseName = caseName,
          status = "skipped",
          reason = "Case targets '$fmt'; ExpressConformanceTest executes Express cases only.",
        )
        continue
      }
      assertEquals("express", fmt, "Expected format=express in $suiteRelPath :: $caseName")
      expressCases.add(tc)
    }

    assertEquals(
      expectedExpressCount,
      expressCases.size,
      "Unexpected Express case count in $suiteRelPath",
    )

    return expressCases.map { tc ->
      val caseName = tc["name"] as String
      DynamicTest.dynamicTest("$suiteRelPath :: $caseName") {
        if (caseName in SKIP_TEST_NAMES) {
          val reason = SKIP_TEST_NAMES.getValue(caseName)
          recordManifest(suiteRelPath, caseName, "skipped", reason)
          Assumptions.assumeFalse(true, "[SKIPPED] $caseName: $reason")
        }
        try {
          executeConformanceCase(suiteRelPath, tc)
          recordManifest(suiteRelPath, caseName, "passed", null)
        } catch (t: Throwable) {
          recordManifest(suiteRelPath, caseName, "failed", null)
          throw t
        }
      }
    }
  }

  private fun executeConformanceCase(suiteRelPath: String, tc: Map<String, Any?>) {
    val caseName = tc["name"] as String
    val action = tc["action"] as? String ?: fail("Missing 'action' in $caseName")
    val ignoreCompOrder = suiteRelPath.endsWith("multi_catalog_formats.yaml")

    when (action) {
      "compile" -> runCompileCase(caseName, tc, ignoreCompOrder)
      "decompile" -> runDecompileCase(caseName, tc)
      "generate_prompt_snippet" -> runPromptSnippetCase(caseName, tc)
      "unwrap" -> runUnwrapCase(caseName, tc)
      "wrap" -> runWrapCase(caseName, tc)
      "has_format_content" -> runHasFormatContentCase(caseName, tc)
      "parse_response" -> runParseResponseCase(caseName, tc, ignoreCompOrder)
      "parse_chunk" -> runParseChunkCase(caseName, tc)
      "create_format" -> runCreateFormatCase(caseName, tc)
      "measure_growth" -> runMeasureGrowthCase(caseName, tc)
      else -> fail("Unsupported conformance action '$action' in $suiteRelPath :: $caseName")
    }
  }

  private fun runCompileCase(caseName: String, tc: Map<String, Any?>, ignoreCompOrder: Boolean) {
    assertKnownKeys(caseName, tc, COMPILE_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, FORMAT_CATALOG_ARGS_KEYS)
    val input = tc["input"] as String
    val expectError = getOptionalMap(tc, "expect_error")

    if (expectError != null) {
      assertRaisesExpected(caseName, expectError) {
        val catalogs = resolveCatalogsFromArgs(args)
        val compiler = ExpressCompiler(catalogs)
        compiler.compileChecked(input)
      }
      return
    }

    val catalogs = resolveCatalogsFromArgs(args)
    val compiler = ExpressCompiler(catalogs)
    val actual = compiler.compileChecked(input)

    @Suppress("UNCHECKED_CAST") val expectPresent = tc["expect_present"] as? List<String>
    var actualForComparison = actual
    if (expectPresent != null) {
      for (pointer in expectPresent) {
        val resolved = resolveJsonPointerInMessages(actual, pointer)
        assertTrue(
          resolved != null &&
            resolved !is JsonNull &&
            (resolved !is JsonPrimitive || !resolved.isString || resolved.content.isNotEmpty()),
          "Expected non-empty value at JSON Pointer '$pointer' in $caseName, got $resolved in $actual",
        )
        actualForComparison = removeJsonPointerInMessages(actualForComparison, pointer)
      }
    }

    if (tc.containsKey("expect")) {
      val expected = toJsonObjectList(tc["expect"]!!)
      assertJsonListEquals(
        expected,
        actualForComparison,
        ignoreCompOrder,
        "compile mismatch in $caseName",
      )
    }
  }

  private fun runDecompileCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(caseName, tc, DECOMPILE_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, FORMAT_CATALOG_ARGS_KEYS)
    val messages = toJsonObjectList(tc["messages"]!!)
    val expectError = getOptionalMap(tc, "expect_error")

    if (expectError != null) {
      assertRaisesExpected(caseName, expectError) {
        val catalogs = resolveCatalogsFromArgs(args)
        ExpressDecompiler(catalogs).decompile(messages)
      }
      return
    }

    val catalogs = resolveCatalogsFromArgs(args)
    val decompiler = ExpressDecompiler(catalogs)
    val dsl = decompiler.decompile(messages)

    @Suppress("UNCHECKED_CAST")
    (tc["expect_contains"] as? List<String>)?.forEach { needle ->
      assertTrue(
        dsl.contains(needle),
        "Expected decompiled output in $caseName to contain:\n$needle\nActual DSL:\n$dsl",
      )
    }
    @Suppress("UNCHECKED_CAST")
    (tc["expect_absent"] as? List<String>)?.forEach { forbidden ->
      assertFalse(
        dsl.contains(forbidden),
        "Expected decompiled output in $caseName NOT to contain:\n$forbidden\nActual DSL:\n$dsl",
      )
    }
    if (tc["expect_output"] is String) {
      assertEquals(
        tc["expect_output"] as String,
        dsl,
        "Exact decompile output mismatch in $caseName",
      )
    }

    val compiler = ExpressCompiler(catalogs)
    if (tc["expect_round_trip"] == true) {
      val recompiled = compiler.compileChecked(dsl)
      assertJsonListEquals(
        messages,
        recompiled,
        ignoreComponentOrder = true,
        context = "Decompile round-trip mismatch in $caseName\nDSL:\n$dsl",
      )
    }
    if (tc.containsKey("expect_recompiled")) {
      val expectedRecompiled = toJsonObjectList(tc["expect_recompiled"]!!)
      val recompiled = compiler.compileChecked(dsl)
      assertJsonListEquals(
        expectedRecompiled,
        recompiled,
        ignoreComponentOrder = true,
        context = "expect_recompiled mismatch in $caseName\nDSL:\n$dsl",
      )
    }
  }

  private fun runPromptSnippetCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(caseName, tc, PROMPT_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, PROMPT_ARGS_KEYS)
    val expectError = getOptionalMap(tc, "expect_error")

    @Suppress("UNCHECKED_CAST") val allowedMessages = args["allowed_messages"] as? List<String>
    val exampleTurns = loadExampleTurns(args["examples"])

    if (expectError != null) {
      assertRaisesExpected(caseName, expectError) {
        val catalogs = resolveCatalogsFromArgs(args)
        ExpressPromptGenerator(
            catalogs = catalogs,
            exampleTurns = exampleTurns,
            allowedMessages = allowedMessages,
          )
          .generateSnippet()
      }
      return
    }

    val catalogs = resolveCatalogsFromArgs(args)
    val generator =
      ExpressPromptGenerator(
        catalogs = catalogs,
        exampleTurns = exampleTurns,
        allowedMessages = allowedMessages,
      )
    val snippet = generator.generateSnippet()

    @Suppress("UNCHECKED_CAST")
    (tc["expect_contains"] as? List<String>)?.forEach { needle ->
      assertTrue(
        snippet.contains(needle),
        "Expected prompt snippet in $caseName to contain:\n$needle\nActual snippet:\n$snippet",
      )
    }
    @Suppress("UNCHECKED_CAST")
    (tc["expect_absent"] as? List<String>)?.forEach { forbidden ->
      assertFalse(
        snippet.contains(forbidden),
        "Expected prompt snippet in $caseName NOT to contain:\n$forbidden\nActual snippet:\n$snippet",
      )
    }
    @Suppress("UNCHECKED_CAST")
    val expectCallable = tc["expect_callable_functions"] as? List<String>
    if (expectCallable != null) {
      assertEquals(
        expectCallable,
        generator.agentCallableFunctions,
        "agentCallableFunctions mismatch in $caseName",
      )
    }
    if (tc["expect_deterministic"] == true) {
      val second =
        ExpressPromptGenerator(
            catalogs = catalogs,
            exampleTurns = exampleTurns,
            allowedMessages = allowedMessages,
          )
          .generateSnippet()
      assertEquals(snippet, second, "Prompt snippet was non-deterministic in $caseName")
    }
  }

  private fun runUnwrapCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(caseName, tc, UNWRAP_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, FORMAT_CATALOG_ARGS_KEYS)
    val parser = buildParserForArgs(args)
    val actual = parser.unwrapParts(tc["input"] as String)
    @Suppress("UNCHECKED_CAST") val expected = tc["expect"] as List<Map<String, Any?>>
    assertRawStreamPartsMatch(caseName, expected, actual)
  }

  private fun runWrapCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(caseName, tc, WRAP_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, FORMAT_CATALOG_ARGS_KEYS)
    val parser = buildParserForArgs(args)

    @Suppress("UNCHECKED_CAST") val rawSpecs = tc["parts"] as List<Map<String, Any?>>
    val partsToWrap =
      rawSpecs.map { spec ->
        assertKnownKeys("$caseName.part", spec, setOf("text", "a2ui_raw", "is_final"))
        when {
          spec.containsKey("text") -> ExpressStreamPart.Text(spec["text"] as String)
          spec.containsKey("a2ui_raw") ->
            ExpressStreamPart.RawA2ui(
              a2uiRaw = spec["a2ui_raw"] as String,
              isFinal = (spec["is_final"] as? Boolean) ?: true,
            )
          else -> fail("Invalid wrap part spec in $caseName: $spec")
        }
      }

    val wrappedText = parser.wrapParts(partsToWrap)
    if (tc.containsKey("expect_output")) {
      assertEquals(tc["expect_output"] as String, wrappedText, "wrap output mismatch in $caseName")
    }
    @Suppress("UNCHECKED_CAST")
    (tc["expect_contains"] as? List<String>)?.forEach { needle ->
      assertTrue(
        wrappedText.contains(needle),
        "Expected wrapped text in $caseName to contain $needle",
      )
    }
    if (tc["expect_round_trip"] == true) {
      val unwrapped = parser.unwrapParts(wrappedText)
      assertEquals(partsToWrap, unwrapped, "wrap -> unwrap round-trip mismatch in $caseName")
    }
  }

  private fun runHasFormatContentCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(caseName, tc, HAS_FORMAT_CONTENT_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, setOf("format", "complete", "catalog", "catalogs"))
    val parser = buildParserForArgs(args)
    val complete = (args["complete"] as? Boolean) ?: false
    val actual = parser.hasFormatContent(tc["input"] as String, complete = complete)
    assertEquals(tc["expect"] as Boolean, actual, "hasFormatContent mismatch in $caseName")
  }

  private fun runParseResponseCase(
    caseName: String,
    tc: Map<String, Any?>,
    ignoreCompOrder: Boolean,
  ) {
    assertKnownKeys(caseName, tc, PARSE_RESPONSE_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, setOf("format", "catalog", "catalogs", "wrapped"))
    val wrapped = (args["wrapped"] as? Boolean) ?: true
    val expectError = getOptionalMap(tc, "expect_error")

    if (expectError != null) {
      val catalogs = resolveCatalogsFromArgs(args)
      val parser = ExpressParser(catalogs)
      val err =
        assertRaisesExpected(caseName, expectError) {
          parser.parseResponseParts(tc["input"] as String, wrapped = wrapped)
        }
      if (expectError.containsKey("partial_results")) {
        @Suppress("UNCHECKED_CAST")
        val expectedPartials = expectError["partial_results"] as List<Map<String, Any?>>
        assertCompiledStreamPartsMatch(
          "$caseName.partial_results",
          expectedPartials,
          parser.lastFailurePartialParts,
          ignoreCompOrder,
        )
      }
      return
    }

    val catalogs = resolveCatalogsFromArgs(args)
    val parser = ExpressParser(catalogs)
    val actual = parser.parseResponseParts(tc["input"] as String, wrapped = wrapped)
    @Suppress("UNCHECKED_CAST") val expected = tc["expect"] as List<Map<String, Any?>>
    assertCompiledStreamPartsMatch(caseName, expected, actual, ignoreCompOrder)
  }

  private fun runParseChunkCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(caseName, tc, PARSE_CHUNK_CASE_KEYS)
    val args = getMap(tc, "args")
    assertKnownKeys(
      "$caseName.args",
      args,
      setOf("format", "catalog", "catalogs", "wrapped", "after_rejected_block", "progressive_keys"),
    )
    val catalogs = resolveCatalogsFromArgs(args)
    val wrapped = (args["wrapped"] as? Boolean) ?: true
    val afterRejected = (args["after_rejected_block"] as? String) ?: "end"
    @Suppress("UNCHECKED_CAST")
    val progressiveKeys =
      (args["progressive_keys"] as? List<String>)?.toSet() ?: DEFAULT_EXPRESS_PROGRESSIVE_KEYS

    val parser = ExpressParser(catalogs, progressiveKeys = progressiveKeys)
    val state = ExpressRendererState(catalogs)
    val stream =
      parser.openStream(
        wrapped = wrapped,
        state = state,
        afterRejectedBlock = afterRejected,
        progressiveKeys = progressiveKeys,
      )

    @Suppress("UNCHECKED_CAST") val steps = tc["steps"] as List<Map<String, Any?>>
    val fullInput = StringBuilder()

    for ((stepIdx, step) in steps.withIndex()) {
      assertKnownKeys(
        "$caseName.step[$stepIdx]",
        step,
        setOf(
          "input",
          "close",
          "expect",
          "expect_in_block",
          "expect_error",
          "expect_partial_results",
        ),
      )
      val stepError = getOptionalMap(step, "expect_error")
      val isClose = step["close"] == true
      val chunk = step["input"] as? String

      if (chunk != null) fullInput.append(chunk)

      if (stepError != null) {
        assertRaisesExpected("$caseName.step[$stepIdx]", stepError) {
          if (isClose) {
            if (chunk != null) stream.feed(chunk)
            stream.close()
          } else {
            stream.feed(chunk!!)
          }
        }
        val rawExpectedPartials = step["expect_partial_results"] ?: stepError["partial_results"]
        if (rawExpectedPartials != null) {
          @Suppress("UNCHECKED_CAST")
          val expectedPartials = rawExpectedPartials as List<Map<String, Any?>>
          assertCompiledStreamPartsMatch(
            "$caseName.step[$stepIdx].partial_results",
            expectedPartials,
            stream.lastFailurePartialParts,
            ignoreCompOrder = false,
          )
        }
        if (step.containsKey("expect_in_block")) {
          assertEquals(
            step["expect_in_block"] as Boolean,
            stream.isInBlock,
            "isInBlock mismatch at $caseName.step[$stepIdx]",
          )
        }
      } else {
        val actualParts =
          if (isClose) {
            val out = mutableListOf<ExpressStreamPart>()
            if (chunk != null) out.addAll(stream.feed(chunk))
            out.addAll(stream.close())
            out
          } else {
            stream.feed(chunk!!)
          }

        if (step.containsKey("expect")) {
          @Suppress("UNCHECKED_CAST") val expectedParts = step["expect"] as List<Map<String, Any?>>
          assertCompiledStreamPartsMatch(
            "$caseName.step[$stepIdx]",
            expectedParts,
            actualParts,
            ignoreCompOrder = false,
          )
        }
        if (step.containsKey("expect_in_block")) {
          assertEquals(
            step["expect_in_block"] as Boolean,
            stream.isInBlock,
            "isInBlock mismatch at $caseName.step[$stepIdx]",
          )
        }
      }
    }

    if (steps.none { it["close"] == true || it.containsKey("expect_error") }) {
      val closeError =
        getOptionalMap(tc, "expect_close_error") ?: getOptionalMap(tc, "expect_error")
      if (closeError != null) {
        assertRaisesExpected("$caseName.close", closeError) { stream.close() }
        val rawPartials = tc["expect_partial_results"] ?: closeError["partial_results"]
        if (rawPartials != null) {
          @Suppress("UNCHECKED_CAST") val expectedPartials = rawPartials as List<Map<String, Any?>>
          assertCompiledStreamPartsMatch(
            "$caseName.close.partial_results",
            expectedPartials,
            stream.lastFailurePartialParts,
            ignoreCompOrder = false,
          )
        }
      } else {
        val tail = stream.close()
        if (tc.containsKey("expect_close")) {
          @Suppress("UNCHECKED_CAST")
          val expectedClose = tc["expect_close"] as List<Map<String, Any?>>
          assertCompiledStreamPartsMatch(
            "$caseName.close",
            expectedClose,
            tail,
            ignoreCompOrder = false,
          )
        }
      }
    }

    if (tc["expect_matches_single_shot"] == true) {
      val singleShotState = ExpressRendererState(catalogs)
      parser.parseResponseParts(fullInput.toString(), wrapped = wrapped, state = singleShotState)
      assertEquals(
        singleShotState.surfaceIds,
        state.surfaceIds,
        "Streamed surfaceIds differed from single-shot in $caseName",
      )
    }
  }

  private fun runCreateFormatCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(
      caseName,
      tc,
      setOf("name", "description", "features", "action", "args", "expect_error"),
    )
    val args = getMap(tc, "args")
    assertKnownKeys("$caseName.args", args, FORMAT_CATALOG_ARGS_KEYS)
    val expectError = getOptionalMap(tc, "expect_error")
    if (expectError != null) {
      assertRaisesExpected(caseName, expectError) {
        val catalogs = resolveCatalogsFromArgs(args)
        ExpressFormat(catalogs = catalogs)
      }
    } else {
      val catalogs = resolveCatalogsFromArgs(args)
      val fmt = ExpressFormat(catalogs = catalogs)
      assertNotNull(fmt.parser)
      assertNotNull(fmt.promptGenerator)
    }
  }

  private fun runMeasureGrowthCase(caseName: String, tc: Map<String, Any?>) {
    assertKnownKeys(
      caseName,
      tc,
      setOf(
        "name",
        "description",
        "features",
        "action",
        "args",
        "operation",
        "payload",
        "sizes",
        "max_ratio",
      ),
    )
    val args = getMap(tc, "args")
    val catalogs = resolveCatalogsFromArgs(args)
    val operation = tc["operation"] as String
    assertEquals("compile", operation, "Unsupported scaling operation '$operation' in $caseName")

    @Suppress("UNCHECKED_CAST") val payloadSpec = tc["payload"] as List<Any>
    @Suppress("UNCHECKED_CAST") val sizes = (tc["sizes"] as List<Number>).map { it.toInt() }
    assertEquals(2, sizes.size)
    val maxRatio = (tc["max_ratio"] as Number).toDouble()

    val smallInput = expandPayloadTemplate(payloadSpec, sizes[0])
    val largeInput = expandPayloadTemplate(payloadSpec, sizes[1])
    val compiler = ExpressCompiler(catalogs)

    // Warm up JVM JIT across both sizes so one-time compilation does not skew ratio
    repeat(5) {
      compiler.compileChecked(smallInput)
      compiler.compileChecked(largeInput)
    }

    val smallMedianNs = measureMedianNanos(7) { compiler.compileChecked(smallInput) }
    val largeMedianNs = measureMedianNanos(7) { compiler.compileChecked(largeInput) }
    val ratio = largeMedianNs.toDouble() / smallMedianNs.coerceAtLeast(1L).toDouble()
    assertTrue(
      ratio <= maxRatio,
      "Scaling ratio ${"%.2f".format(ratio)} exceeded max_ratio=$maxRatio in $caseName " +
        "(n=${sizes[0]} took ${smallMedianNs / 1_000_000.0}ms, 4n=${sizes[1]} took ${largeMedianNs / 1_000_000.0}ms)",
    )
  }

  private fun expandPayloadTemplate(spec: List<Any>, n: Int): String {
    val sb = StringBuilder()
    for (seg in spec) {
      when (seg) {
        is String -> sb.append(seg)
        is Map<*, *> -> {
          val tpl = seg["repeat"] as String
          val sep = (seg["separator"] as? String) ?: ""
          for (i in 0 until n) {
            if (i > 0) sb.append(sep)
            sb.append(tpl.replace("{i}", i.toString()))
          }
        }
        else -> fail("Unexpected payload template segment: $seg")
      }
    }
    return sb.toString()
  }

  private fun measureMedianNanos(runs: Int, fn: () -> Unit): Long {
    val samples = LongArray(runs)
    for (i in 0 until runs) {
      val t0 = System.nanoTime()
      fn()
      samples[i] = System.nanoTime() - t0
    }
    samples.sort()
    return samples[runs / 2]
  }

  private fun buildParserForArgs(args: Map<String, Any?>): ExpressParser {
    val catalogs =
      if (args.containsKey("catalog") || args.containsKey("catalogs")) {
        resolveCatalogsFromArgs(args)
      } else {
        val cfg = BasicCatalog.getConfig(A2uiVersion.VERSION_1_0)
        listOf(A2uiSchemaManager(A2uiVersion.VERSION_1_0, listOf(cfg)).getSelectedCatalog())
      }
    return ExpressParser(catalogs)
  }

  private fun resolveCatalogsFromArgs(args: Map<String, Any?>): List<A2uiCatalog> {
    if (args.containsKey("catalogs")) {
      @Suppress("UNCHECKED_CAST") val rawList = args["catalogs"] as List<Any>
      return rawList.map { loadCatalogSpec(it) }
    }
    if (args.containsKey("catalog")) {
      return listOf(loadCatalogSpec(args["catalog"]!!))
    }
    return emptyList()
  }

  private fun loadCatalogSpec(spec: Any): A2uiCatalog {
    if (spec is String) {
      return loadCatalogFromPath(spec)
    }
    @Suppress("UNCHECKED_CAST") val map = spec as Map<String, Any?>
    if (map.containsKey("catalog")) {
      var cat = loadCatalogSpec(map["catalog"]!!)
      @Suppress("UNCHECKED_CAST") val transformers = map["transformers"] as? List<Map<String, Any?>>
      if (transformers != null) {
        for (tr in transformers) {
          assertKnownKeys("transformer", tr, setOf("component_pruning", "function_pruning"))
          @Suppress("UNCHECKED_CAST")
          val compAllow = (tr["component_pruning"] as? List<String>)?.toSet()
          @Suppress("UNCHECKED_CAST")
          val fnAllow = (tr["function_pruning"] as? List<String>)?.toSet()
          cat = cat.prune(allowedComponents = compAllow, allowedFunctions = fnAllow)
        }
      }
      return cat
    }

    // Inline catalog schema object
    val jsonObj = anyToJsonElement(map) as JsonObject
    return buildCatalogFromJsonObject("inline", jsonObj)
  }

  private fun loadCatalogFromPath(relPath: String): A2uiCatalog {
    val file = resolveDataFile(relPath)
    val jsonObj = Json.parseToJsonElement(file.readText()) as JsonObject
    return buildCatalogFromJsonObject(file.nameWithoutExtension, jsonObj)
  }

  private fun buildCatalogFromJsonObject(name: String, schemaObj: JsonObject): A2uiCatalog {
    val rawProto =
      schemaObj["protocolVersion"]?.jsonPrimitive?.contentOrNull
        ?: schemaObj["\$id"]?.jsonPrimitive?.contentOrNull?.let { id ->
          when {
            "v0_8" in id -> "0.8"
            "v0_9_1" in id -> "0.9.1"
            "v0_9" in id -> "0.9"
            else -> "1.0"
          }
        }
        ?: "1.0"
    val stripped = rawProto.removePrefix("v")
    val version =
      when {
        stripped.startsWith("0.8") -> A2uiVersion.VERSION_0_8
        stripped == "0.9.1" -> A2uiVersion.VERSION_0_9_1
        stripped.startsWith("0.9") -> A2uiVersion.VERSION_0_9
        else -> A2uiVersion.VERSION_1_0
      }

    val s2c =
      SchemaResourceLoader.loadFromBundledResource(version.value, version.serverToClientSchemaPath)
        ?: JsonObject(emptyMap())
    val ct =
      version.commonTypesSchemaPath?.let {
        SchemaResourceLoader.loadFromBundledResource(version.value, it)
      } ?: JsonObject(emptyMap())

    return A2uiCatalog(
      version = version,
      name = name,
      serverToClientSchema = s2c,
      commonTypesSchema = ct,
      catalogSchema = schemaObj,
    )
  }

  private fun loadExampleTurns(rawExamples: Any?): List<List<JsonObject>> {
    if (rawExamples == null) return emptyList()
    @Suppress("UNCHECKED_CAST") val list = rawExamples as List<Any>
    return list.map { item ->
      when (item) {
        is String -> {
          val file = resolveDataFile(item)
          val parsed = Json.parseToJsonElement(file.readText())
          when (parsed) {
            is JsonArray -> parsed.map { it as JsonObject }
            is JsonObject -> {
              (parsed["messages"] as? JsonArray)?.map { it as JsonObject } ?: listOf(parsed)
            }
            else -> fail("Invalid example JSON in ${file.absolutePath}")
          }
        }
        else -> toJsonObjectList(item)
      }
    }
  }

  private fun resolveDataFile(relPath: String): File {
    val fromConformance = File(conformanceDir, relPath)
    if (fromConformance.exists()) return fromConformance
    val fromRepo = File(repoRoot, relPath)
    if (fromRepo.exists()) return fromRepo
    fail("Could not resolve conformance fixture path '$relPath'")
  }

  private fun assertRaisesExpected(
    context: String,
    expectError: Map<String, Any?>,
    block: () -> Unit,
  ): Throwable {
    assertKnownKeys("$context.expect_error", expectError, setOf("category", "message"))
    val category = expectError["category"] as String
    val messagePattern = expectError["message"] as? String

    val caught =
      try {
        block()
        null
      } catch (t: Throwable) {
        t
      } ?: fail("Expected $category in $context, but call succeeded without throwing.")

    val matchesCategory =
      when (category) {
        "ParseError" -> caught is A2uiParseException || caught is ExpressParseError
        "ValidationError" ->
          caught is A2uiValidationException ||
            caught is A2uiIntegrityException ||
            caught is A2uiRecursionException ||
            caught is ExpressValidationError
        "CatalogError" -> caught is A2uiCatalogException
        "CompilationError" -> caught is A2uiCompilationError
        else -> fail("Unknown error category '$category' in $context")
      }

    assertTrue(
      matchesCategory,
      "Expected error category '$category' in $context, but caught ${caught::class.qualifiedName}: ${caught.message}",
    )

    if (messagePattern != null) {
      val actualMessage = caught.message ?: ""
      assertTrue(
        Regex(messagePattern, RegexOption.IGNORE_CASE).containsMatchIn(actualMessage),
        "Expected error message in $context to match /$messagePattern/, got: $actualMessage",
      )
    }
    return caught
  }

  private fun assertRawStreamPartsMatch(
    context: String,
    expected: List<Map<String, Any?>>,
    actual: List<ExpressStreamPart>,
  ) {
    assertEquals(
      expected.size,
      actual.size,
      "Part count mismatch in $context.\nExpected: $expected\nActual: $actual",
    )
    for (i in expected.indices) {
      val exp = expected[i]
      assertKnownKeys("$context.expect[$i]", exp, setOf("text", "a2ui_raw", "is_final"))
      val act = actual[i]
      if (exp.containsKey("text")) {
        assertTrue(act is ExpressStreamPart.Text, "Expected Text part at $i in $context, got $act")
        assertEquals(exp["text"] as String, act.text, "Text mismatch at $i in $context")
      } else if (exp.containsKey("a2ui_raw")) {
        assertTrue(
          act is ExpressStreamPart.RawA2ui,
          "Expected RawA2ui part at $i in $context, got $act",
        )
        assertEquals(exp["a2ui_raw"] as String, act.a2uiRaw, "a2ui_raw mismatch at $i in $context")
        val expFinal = (exp["is_final"] as? Boolean) ?: true
        assertEquals(expFinal, act.isFinal, "is_final mismatch at $i in $context")
      } else {
        fail("Invalid raw part expectation at $i in $context: $exp")
      }
    }
  }

  private fun assertCompiledStreamPartsMatch(
    context: String,
    expected: List<Map<String, Any?>>,
    actual: List<ExpressStreamPart>,
    ignoreCompOrder: Boolean,
  ) {
    assertEquals(
      expected.size,
      actual.size,
      "Part count mismatch in $context.\nExpected: $expected\nActual: $actual",
    )
    for (i in expected.indices) {
      val exp = expected[i]
      assertKnownKeys("$context.expect[$i]", exp, setOf("text", "a2ui", "error"))
      val act = actual[i]
      when {
        exp.containsKey("text") -> {
          assertTrue(
            act is ExpressStreamPart.Text,
            "Expected Text part at $i in $context, got $act",
          )
          assertEquals(exp["text"] as String, act.text, "Text mismatch at $i in $context")
        }
        exp.containsKey("a2ui") -> {
          assertTrue(
            act is ExpressStreamPart.A2ui,
            "Expected A2ui part at $i in $context, got $act",
          )
          val expMsgs = toJsonObjectList(exp["a2ui"]!!)
          assertJsonListEquals(expMsgs, act.a2ui, ignoreCompOrder, "$context part[$i]")
        }
        exp.containsKey("error") -> {
          assertTrue(
            act is ExpressStreamPart.Error,
            "Expected Error part at $i in $context, got $act",
          )
          @Suppress("UNCHECKED_CAST") val errSpec = exp["error"] as Map<String, Any?>
          assertKnownKeys("$context.expect[$i].error", errSpec, setOf("category", "message"))
          val cat = errSpec["category"] as String
          val err = act.error
          val ok =
            when (cat) {
              "ParseError" -> err is A2uiParseException || err is ExpressParseError
              "ValidationError" ->
                err is A2uiValidationException ||
                  err is A2uiIntegrityException ||
                  err is A2uiRecursionException ||
                  err is ExpressValidationError
              "CatalogError" -> err is A2uiCatalogException
              "CompilationError" -> err is A2uiCompilationError
              else -> false
            }
          assertTrue(
            ok,
            "Expected ErrorPart category '$cat' at $i in $context, got ${err::class.qualifiedName}: ${err.message}",
          )
          val msgPat = errSpec["message"] as? String
          if (msgPat != null) {
            assertTrue(
              Regex(msgPat, RegexOption.IGNORE_CASE).containsMatchIn(err.message ?: ""),
              "Expected ErrorPart message /$msgPat/ at $i in $context, got: ${err.message}",
            )
          }
        }
        else -> fail("Invalid stream part expectation at $i in $context: $exp")
      }
    }
  }

  private fun assertJsonListEquals(
    expected: List<JsonObject>,
    actual: List<JsonObject>,
    ignoreComponentOrder: Boolean,
    context: String,
  ) {
    assertEquals(
      expected.size,
      actual.size,
      "$context: message count mismatch.\nExpected: $expected\nActual:   $actual",
    )
    for (i in expected.indices) {
      if (!jsonSemanticEquals(expected[i], actual[i], ignoreComponentOrder)) {
        fail("$context: message[$i] mismatch.\nExpected: ${expected[i]}\nActual:   ${actual[i]}")
      }
    }
  }

  private fun jsonSemanticEquals(
    a: JsonElement,
    b: JsonElement,
    ignoreComponentOrder: Boolean,
  ): Boolean {
    if (a === b) return true
    if (a is JsonNull && b is JsonNull) return true
    if (a is JsonPrimitive && b is JsonPrimitive) {
      if (a.isString != b.isString) return false
      if (a.isString) return a.content == b.content
      if (a.booleanOrNull != null || b.booleanOrNull != null) {
        return a.booleanOrNull == b.booleanOrNull
      }
      val la = a.longOrNull
      val lb = b.longOrNull
      if (la != null && lb != null) return la == lb
      val da = a.doubleOrNull
      val db = b.doubleOrNull
      if (da != null && db != null) {
        return abs(da - db) <= 1e-12 * maxOf(1.0, abs(da), abs(db))
      }
      return a.content == b.content
    }
    if (a is JsonArray && b is JsonArray) {
      if (a.size != b.size) return false
      return a.indices.all { idx -> jsonSemanticEquals(a[idx], b[idx], ignoreComponentOrder) }
    }
    if (a is JsonObject && b is JsonObject) {
      if (a.keys != b.keys) return false
      for (k in a.keys) {
        val va = a.getValue(k)
        val vb = b.getValue(k)
        if (ignoreComponentOrder && k == "components" && va is JsonArray && vb is JsonArray) {
          if (!componentArraysEqualById(va, vb)) return false
        } else if (!jsonSemanticEquals(va, vb, ignoreComponentOrder)) {
          return false
        }
      }
      return true
    }
    return false
  }

  private fun componentArraysEqualById(a: JsonArray, b: JsonArray): Boolean {
    if (a.size != b.size) return false
    val mapA = a.associateBy { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull ?: "" }
    val mapB = b.associateBy { (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull ?: "" }
    if (mapA.size != a.size || mapA.keys != mapB.keys) return false
    return mapA.all { (id, compA) ->
      jsonSemanticEquals(compA, mapB.getValue(id), ignoreComponentOrder = true)
    }
  }

  private fun resolveJsonPointerInMessages(
    messages: List<JsonObject>,
    pointer: String,
  ): JsonElement? {
    var cur: JsonElement = JsonArray(messages)
    for (rawSeg in pointer.removePrefix("/").split("/")) {
      if (rawSeg.isEmpty()) continue
      val seg = rawSeg.replace("~1", "/").replace("~0", "~")
      cur =
        when (cur) {
          is JsonArray -> {
            val idx = seg.toIntOrNull() ?: return null
            cur.getOrNull(idx) ?: return null
          }
          is JsonObject -> cur[seg] ?: return null
          else -> return null
        }
    }
    return cur
  }

  private fun removeJsonPointerInMessages(
    messages: List<JsonObject>,
    pointer: String,
  ): List<JsonObject> {
    val segs =
      pointer
        .removePrefix("/")
        .split("/")
        .filter { it.isNotEmpty() }
        .map { it.replace("~1", "/").replace("~0", "~") }
    if (segs.isEmpty()) return messages

    fun removeRec(el: JsonElement, depth: Int): JsonElement {
      val seg = segs[depth]
      val isLast = depth == segs.lastIndex
      return when (el) {
        is JsonArray -> {
          val idx = seg.toIntOrNull() ?: return el
          if (idx !in el.indices) return el
          JsonArray(
            el.mapIndexedNotNull { i, item ->
              if (i != idx) item else if (isLast) null else removeRec(item, depth + 1)
            }
          )
        }
        is JsonObject -> {
          if (!el.containsKey(seg)) return el
          val copy = LinkedHashMap<String, JsonElement>(el)
          if (isLast) {
            copy.remove(seg)
          } else {
            copy[seg] = removeRec(el.getValue(seg), depth + 1)
          }
          JsonObject(copy)
        }
        else -> el
      }
    }

    val updated = removeRec(JsonArray(messages), 0) as JsonArray
    return updated.map { it as JsonObject }
  }

  private fun filterReachableFromRoot(
    componentsById: Map<String, JsonObject>
  ): Map<String, JsonObject> {
    if (!componentsById.containsKey("root")) return componentsById
    val reached = LinkedHashSet<String>()
    val pending = ArrayDeque<String>()
    pending.add("root")

    fun collectRefs(el: JsonElement) {
      when (el) {
        is JsonPrimitive ->
          if (el.isString && componentsById.containsKey(el.content)) pending.add(el.content)
        is JsonArray -> el.forEach { collectRefs(it) }
        is JsonObject -> el.values.forEach { collectRefs(it) }
      }
    }

    while (pending.isNotEmpty()) {
      val cid = pending.removeFirst()
      if (!reached.add(cid)) continue
      val comp = componentsById[cid] ?: continue
      for ((k, v) in comp) {
        if (k != "id") collectRefs(v)
      }
    }
    return componentsById.filterKeys { it in reached }
  }

  private fun assertKnownKeys(context: String, map: Map<String, Any?>, allowed: Set<String>) {
    val unknown = map.keys - allowed
    assertTrue(
      unknown.isEmpty(),
      "Unrecognized conformance test keys in $context: $unknown (allowed: $allowed)",
    )
  }

  @Suppress("UNCHECKED_CAST")
  private fun getMap(parent: Map<String, Any?>, key: String): Map<String, Any?> =
    (parent[key] as? Map<String, Any?>) ?: emptyMap()

  @Suppress("UNCHECKED_CAST")
  private fun getOptionalMap(parent: Map<String, Any?>, key: String): Map<String, Any?>? =
    parent[key] as? Map<String, Any?>

  private fun toJsonObjectList(raw: Any): List<JsonObject> {
    val el = anyToJsonElement(raw)
    return when (el) {
      is JsonArray -> el.map { it as JsonObject }
      is JsonObject -> listOf(el)
      else -> fail("Expected JSON object or array, got $el")
    }
  }

  private fun anyToJsonElement(value: Any?): JsonElement =
    when (value) {
      null -> JsonNull
      is JsonElement -> value
      is Boolean -> JsonPrimitive(value)
      is Int -> JsonPrimitive(value)
      is Long -> JsonPrimitive(value)
      is Number -> {
        val d = value.toDouble()
        if (
          d % 1.0 == 0.0 &&
            !(d == 0.0 && 1.0 / d < 0.0) &&
            d >= -9007199254740991.0 &&
            d <= 9007199254740991.0
        ) {
          JsonPrimitive(d.toLong())
        } else {
          JsonPrimitive(d)
        }
      }
      is String -> JsonPrimitive(value)
      is List<*> -> JsonArray(value.map { anyToJsonElement(it) })
      is Map<*, *> -> {
        val m = LinkedHashMap<String, JsonElement>(value.size)
        for ((k, v) in value) {
          m[k.toString()] = anyToJsonElement(v)
        }
        JsonObject(m)
      }
      else -> JsonPrimitive(value.toString())
    }

  companion object {
    /** Supported protocol versions in `kotlin/agent_sdk_legacy` Express conformance harness. */
    val SUPPORTED_PROTOCOL_VERSIONS: Set<String> = setOf("0.9", "0.9.1", "1.0")

    /** Transition skip list (empty: all 307 Express conformance cases execute and pass). */
    val SKIP_TEST_NAMES: Map<String, String> = emptyMap()

    private const val HARNESS_ID = "kotlin-agent-legacy"
    private val yamlMapper = ObjectMapper(YAMLFactory())

    private val repoRoot: File by lazy {
      var cur: File? = File(".").canonicalFile
      while (cur != null) {
        if (File(cur, "conformance").isDirectory && File(cur, "specification").isDirectory) {
          return@lazy cur
        }
        cur = cur.parentFile
      }
      error("Could not locate repository root containing conformance/ and specification/")
    }

    private val conformanceDir: File by lazy { File(repoRoot, "conformance") }

    private val manifestLines = java.util.Collections.synchronizedList(mutableListOf<String>())

    private fun recordManifest(suite: String, caseName: String, status: String, reason: String?) {
      val map = LinkedHashMap<String, JsonElement>()
      map["harness"] = JsonPrimitive(HARNESS_ID)
      map["suite"] = JsonPrimitive(suite)
      map["case"] = JsonPrimitive(caseName)
      map["status"] = JsonPrimitive(status)
      if (!reason.isNullOrBlank()) {
        map["reason"] = JsonPrimitive(reason)
      }
      manifestLines.add(JsonObject(map).toString())
    }

    @JvmStatic
    @AfterAll
    fun flushManifest() {
      val manifestDirPath =
        System.getenv("A2UI_CONFORMANCE_MANIFEST_DIR")?.takeIf { it.isNotBlank() }
          ?: System.getProperty("a2ui.conformance.manifestDir")?.takeIf { it.isNotBlank() }
          ?: return
      val dir = File(manifestDirPath)
      dir.mkdirs()
      val outFile = File(dir, "$HARNESS_ID-express.jsonl")
      synchronized(manifestLines) {
        outFile.writeText(
          manifestLines.joinToString("\n") + if (manifestLines.isNotEmpty()) "\n" else ""
        )
      }
    }

    private val FORMAT_CATALOG_ARGS_KEYS = setOf("format", "catalog", "catalogs")
    private val PROMPT_ARGS_KEYS =
      setOf("format", "catalog", "catalogs", "examples", "allowed_messages")
    private val COMPILE_CASE_KEYS =
      setOf(
        "name",
        "description",
        "features",
        "action",
        "args",
        "input",
        "expect",
        "expect_present",
        "expect_error",
      )
    private val DECOMPILE_CASE_KEYS =
      setOf(
        "name",
        "description",
        "features",
        "action",
        "args",
        "messages",
        "expect_contains",
        "expect_absent",
        "expect_output",
        "expect_round_trip",
        "expect_recompiled",
        "expect_error",
      )
    private val PROMPT_CASE_KEYS =
      setOf(
        "name",
        "description",
        "features",
        "action",
        "args",
        "expect_contains",
        "expect_absent",
        "expect_callable_functions",
        "expect_deterministic",
        "expect_error",
      )
    private val UNWRAP_CASE_KEYS =
      setOf("name", "description", "features", "action", "args", "input", "expect")
    private val WRAP_CASE_KEYS =
      setOf(
        "name",
        "description",
        "features",
        "action",
        "args",
        "parts",
        "expect_output",
        "expect_contains",
        "expect_round_trip",
      )
    private val HAS_FORMAT_CONTENT_CASE_KEYS =
      setOf("name", "description", "features", "action", "args", "input", "expect")
    private val PARSE_RESPONSE_CASE_KEYS =
      setOf(
        "name",
        "description",
        "features",
        "action",
        "args",
        "input",
        "expect",
        "expect_error",
        "expect_partial_results",
      )
    private val PARSE_CHUNK_CASE_KEYS =
      setOf(
        "name",
        "description",
        "features",
        "action",
        "args",
        "steps",
        "expect_close",
        "expect_close_error",
        "expect_error",
        "expect_partial_results",
        "expect_matches_single_shot",
      )
  }
}
