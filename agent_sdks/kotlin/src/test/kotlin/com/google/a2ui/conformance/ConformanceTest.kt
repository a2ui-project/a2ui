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
import com.google.a2ui.parser.PayloadFixer
import com.google.a2ui.parser.StreamingParser
import com.google.a2ui.parser.hasA2uiParts
import com.google.a2ui.parser.parseResponseToParts
import com.google.a2ui.schema.A2uiCatalog
import com.google.a2ui.schema.A2uiCatalogProvider
import com.google.a2ui.schema.A2uiSchemaManager
import com.google.a2ui.schema.A2uiValidator
import com.google.a2ui.schema.A2uiVersion
import com.google.a2ui.schema.CatalogConfig
import com.google.a2ui.schema.SchemaModifiers
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory

class ConformanceTest {

  private val yamlMapper = ObjectMapper(YAMLFactory())
  private val jsonMapper = ObjectMapper()

  private fun loadJsonFile(file: File): JsonObject {
    val jsonStr = file.readText()
    return Json.parseToJsonElement(jsonStr) as JsonObject
  }

  private fun parseConformanceYaml(file: File, conformanceDir: File): List<ConformanceTestCase> {
    val rawList = yamlMapper.readValue(file, Any::class.java) as List<*>

    val baseSchemaMappings = mutableMapOf<String, String>()
    val repoRoot = ConformanceTestHelper.repoRoot
    val jsonDirs =
      listOf(
        conformanceDir to listOf(URL_PREFIX_V09, URL_PREFIX_V08),
        File(conformanceDir, "test_data") to listOf(URL_PREFIX_V09, URL_PREFIX_V08),
        File(repoRoot, "specification/v0_9/json") to listOf(URL_PREFIX_V09),
        File(repoRoot, "specification/v0_8/json") to listOf(URL_PREFIX_V08),
      )

    jsonDirs.forEach { (dir, prefixes) ->
      dir
        .listFiles { _, name -> name.endsWith(".json") }
        ?.forEach { f ->
          prefixes.forEach { prefix ->
            baseSchemaMappings["$prefix${f.name}"] = f.toURI().toString()
          }
          baseSchemaMappings[f.name] = f.toURI().toString()
        }
    }

    return rawList.map { caseObj ->
      val case = caseObj as Map<*, *>
      val name = case[ConformanceTestHelper.KEY_NAME] as String

      val catalogMap = case[ConformanceTestHelper.KEY_CATALOG] as Map<*, *>
      val (catalog, schemaMappings) = buildCatalog(catalogMap, conformanceDir, baseSchemaMappings)

      val stepsList =
        case[ConformanceTestHelper.KEY_STEPS] as? List<*>
          ?: case[ConformanceTestHelper.KEY_VALIDATE] as? List<*>
          ?: if (case.containsKey(ConformanceTestHelper.KEY_PAYLOAD)) listOf(case) else null

      if (stepsList == null) {
        throw IllegalArgumentException("No steps or payload found in test case: $name")
      }

      val validate =
        stepsList.map { stepObj ->
          val step = stepObj as Map<*, *>
          val payloadObj = step[ConformanceTestHelper.KEY_PAYLOAD]
          val jsonStr = jsonMapper.writeValueAsString(payloadObj)
          val payload = Json.parseToJsonElement(jsonStr)

          ValidateStep(
            payload = payload,
            expectError =
              step[ConformanceTestHelper.KEY_EXPECT_ERROR] as? String
                ?: case[ConformanceTestHelper.KEY_EXPECT_ERROR] as? String,
          )
        }

      ConformanceTestCase(name, catalog, validate, schemaMappings)
    }
  }

  private fun buildCatalog(
    catalogMap: Map<*, *>,
    conformanceDir: File,
    baseSchemaMappings: Map<String, String>,
  ): Pair<A2uiCatalog, Map<String, String>> {
    val versionStr = catalogMap["version"] as String
    val version =
      if (versionStr == VERSION_0_8_STR) A2uiVersion.VERSION_0_8 else A2uiVersion.VERSION_0_9

    val s2cSchemaObj = catalogMap["s2c_schema"]
    val s2cSchema =
      when (s2cSchemaObj) {
        is String -> loadJsonFile(File(conformanceDir, s2cSchemaObj))
        is Map<*, *> -> {
          val jsonStr = jsonMapper.writeValueAsString(s2cSchemaObj)
          Json.parseToJsonElement(jsonStr) as JsonObject
        }
        else -> JsonObject(emptyMap())
      }

    val catalogSchemaObj = catalogMap["catalog_schema"]
    val schemaMappings = HashMap(baseSchemaMappings)

    val urlPrefix = if (version == A2uiVersion.VERSION_0_8) URL_PREFIX_V08 else URL_PREFIX_V09

    val catalogSchema =
      if (catalogSchemaObj is String) {
        val file = File(conformanceDir, catalogSchemaObj)
        schemaMappings["catalog.json"] = file.toURI().toString()
        schemaMappings["${urlPrefix}catalog.json"] = file.toURI().toString()
        loadJsonFile(file)
      } else if (catalogSchemaObj is Map<*, *>) {
        val jsonStr = jsonMapper.writeValueAsString(catalogSchemaObj)

        val tempFile = java.io.File.createTempFile("custom_catalog", ".json")
        tempFile.deleteOnExit()
        tempFile.writeText(jsonStr)
        schemaMappings["$URL_PREFIX_V09$SIMPLIFIED_CATALOG_V09"] = tempFile.toURI().toString()
        schemaMappings[SIMPLIFIED_CATALOG_V09] = tempFile.toURI().toString()
        schemaMappings["catalog.json"] = tempFile.toURI().toString()
        schemaMappings["${urlPrefix}catalog.json"] = tempFile.toURI().toString()

        Json.parseToJsonElement(jsonStr) as JsonObject
      } else {
        throw IllegalArgumentException(
          "catalog_schema is required in conformance test catalog config"
        )
      }

    val commonTypesObj = catalogMap["common_types_schema"]
    val commonTypesSchema =
      when (commonTypesObj) {
        is String -> loadJsonFile(File(conformanceDir, commonTypesObj))
        is Map<*, *> -> {
          val jsonStr = jsonMapper.writeValueAsString(commonTypesObj)
          Json.parseToJsonElement(jsonStr) as JsonObject
        }
        else -> JsonObject(emptyMap())
      }

    val customCuttableKeys =
      (catalogMap["custom_cuttable_keys"] as? List<*>)?.mapNotNull { it as? String }?.toSet()

    val catalog =
      A2uiCatalog(
        version = version,
        name = TEST_CATALOG_NAME,
        serverToClientSchema = s2cSchema,
        commonTypesSchema = commonTypesSchema,
        catalogSchema = catalogSchema,
        customCuttableKeys = customCuttableKeys,
      )

    return Pair(catalog, schemaMappings)
  }

  @TestFactory
  fun testValidatorConformance(): List<DynamicTest> {
    val conformanceFile = ConformanceTestHelper.getConformanceFile(VALIDATOR_YAML_FILE)
    val conformanceDir = ConformanceTestHelper.getConformanceDir()
    val cases = parseConformanceYaml(conformanceFile, conformanceDir)

    return cases.map { case ->
      val name = case.name

      DynamicTest.dynamicTest(name) {
        val validator = A2uiValidator(case.catalog, case.schemaMappings)

        for (step in case.validate) {
          val payload = step.payload

          val expectError = step.expectError

          if (expectError != null) {
            val exception =
              assertFailsWith<IllegalArgumentException>("Expected failure for $name") {
                validator.validate(payload)
              }
            val regex = Regex(expectError)
            assertTrue(
              regex.containsMatchIn(exception.message!!) ||
                exception.message!!.contains("Validation failed") ||
                exception.message!!.contains("Invalid JSON Pointer syntax"),
              "Expected error matching '$expectError' or containing 'Validation failed', but got: ${exception.message}",
            )
          } else {
            try {
              validator.validate(payload)
            } catch (e: Exception) {
              println("Failed on valid payload for $name: ${e.message}")
              throw e
            }
          }
        }
      }
    }
  }

  class MemoryCatalogProvider(private val schema: JsonObject) : A2uiCatalogProvider {
    override fun load(): JsonObject = schema
  }

  @TestFactory
  fun testCatalogConformance(): List<DynamicTest> {
    val conformanceFile = ConformanceTestHelper.getConformanceFile(CATALOG_YAML_FILE)
    val conformanceDir = ConformanceTestHelper.getConformanceDir()
    val rawList = yamlMapper.readValue(conformanceFile, Any::class.java) as List<*>

    return rawList.mapNotNull { caseObj ->
      val case = caseObj as Map<*, *>
      val name = case[ConformanceTestHelper.KEY_NAME] as String
      val action = case[ConformanceTestHelper.KEY_ACTION] as String
      val args = case[ConformanceTestHelper.KEY_ARGS] as? Map<*, *> ?: emptyMap<Any, Any>()

      DynamicTest.dynamicTest(name) {
        val catalog =
          (case[ConformanceTestHelper.KEY_CATALOG] as? Map<*, *>)?.let {
            val (cat, _) = buildCatalog(it, conformanceDir, emptyMap())
            cat
          }

        when (action) {
          "prune" -> {
            val allowedComponents = args[KEY_ALLOWED_COMPONENTS] as? List<String>
            val allowedMessages = args["allowed_messages"] as? List<String>
            val pruned = catalog!!.withPruning(allowedComponents, allowedMessages)
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            if (expect.containsKey(KEY_CATALOG_SCHEMA)) {
              val expectSchema = jsonMapper.writeValueAsString(expect[KEY_CATALOG_SCHEMA])
              assertEquals(Json.parseToJsonElement(expectSchema), pruned.catalogSchema)
            }
            if (expect.containsKey("s2c_schema")) {
              val expectSchema = jsonMapper.writeValueAsString(expect["s2c_schema"])
              assertEquals(Json.parseToJsonElement(expectSchema), pruned.serverToClientSchema)
            }
            if (expect.containsKey("common_types_schema")) {
              val expectSchema = jsonMapper.writeValueAsString(expect["common_types_schema"])
              assertEquals(Json.parseToJsonElement(expectSchema), pruned.commonTypesSchema)
            }
          }
          "load" -> {
            val path = args[KEY_PATH] as? String
            val fullPath = path?.let { File(conformanceDir, it).absolutePath }
            val validate = args[ConformanceTestHelper.KEY_VALIDATE] as? Boolean ?: false

            if (case.containsKey(ConformanceTestHelper.KEY_EXPECT_ERROR)) {
              val expectError = case[ConformanceTestHelper.KEY_EXPECT_ERROR] as String
              val exception =
                assertFailsWith<IllegalArgumentException> {
                  catalog!!.loadExamples(fullPath, validate = validate)
                }
              assertTrue(
                exception.message!!.contains(expectError) ||
                  exception.message!!.contains("Failed to validate example")
              )
            } else {
              val output = catalog!!.loadExamples(fullPath, validate = validate)
              val expectOutput = case["expect_output"] as String
              assertEquals(expectOutput.trim(), output.trim())
            }
          }
          "remove_strict_validation" -> {
            val schema = args["schema"] as Map<*, *>
            val jsonStr = jsonMapper.writeValueAsString(schema)
            val jsonElement = Json.parseToJsonElement(jsonStr) as JsonObject
            val modified = SchemaModifiers.removeStrictValidation(jsonElement)

            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            val expectSchemaStr = jsonMapper.writeValueAsString(expect["schema"])
            val expectSchema = Json.parseToJsonElement(expectSchemaStr) as JsonObject
            assertEquals(expectSchema, modified)
          }
          "render" -> {
            val output = catalog!!.renderAsLlmInstructions()
            val expectOutput = case["expect_output"] as String
            assertEquals(expectOutput.trim(), output.trim())
          }
          "verify_cuttable_keys" -> {
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>
            val expectCuttableKeys = expect["custom_cuttable_keys"] as List<String>
            assertEquals(expectCuttableKeys.toSet(), catalog!!.cuttableKeys)
          }
          else -> assert(false, { "Unknown action: $action" })
        }
      }
    }
  }

  @TestFactory
  fun testSchemaManagerConformance(): List<DynamicTest> {
    val conformanceFile = ConformanceTestHelper.getConformanceFile(SCHEMA_MANAGER_YAML_FILE)
    val conformanceDir = ConformanceTestHelper.getConformanceDir()
    val rawList = yamlMapper.readValue(conformanceFile, Any::class.java) as List<*>

    return rawList.mapNotNull { caseObj ->
      val case = caseObj as Map<*, *>
      val name = case[ConformanceTestHelper.KEY_NAME] as String
      val action = case[ConformanceTestHelper.KEY_ACTION] as String
      val args = case[ConformanceTestHelper.KEY_ARGS] as? Map<*, *> ?: emptyMap<Any, Any>()

      DynamicTest.dynamicTest(name) {
        when (action) {
          "select_catalog" -> {
            val supportedCatalogs = args["supported_catalogs"] as? List<*> ?: emptyList<Any>()
            val clientCapabilities = args["client_capabilities"] as? Map<*, *>
            val acceptsInlineCatalogs = args["accepts_inline_catalogs"] as? Boolean ?: false

            val configs =
              supportedCatalogs.map { catDefObj ->
                val catDef = catDefObj as Map<*, *>
                val catalogId = catDef["catalogId"] as String
                val jsonStr = jsonMapper.writeValueAsString(catDef)
                val schema = Json.parseToJsonElement(jsonStr) as JsonObject
                CatalogConfig(name = catalogId, provider = MemoryCatalogProvider(schema))
              }

            val manager =
              A2uiSchemaManager(
                version = A2uiVersion.VERSION_0_9,
                catalogs = configs,
                acceptsInlineCatalogs = acceptsInlineCatalogs,
              )

            val capsJsonStr = jsonMapper.writeValueAsString(clientCapabilities)
            val capsJson = Json.parseToJsonElement(capsJsonStr) as JsonObject

            if (case.containsKey(ConformanceTestHelper.KEY_EXPECT_ERROR)) {
              val expectError = case[ConformanceTestHelper.KEY_EXPECT_ERROR] as String
              val exception =
                assertFailsWith<IllegalArgumentException> { manager.getSelectedCatalog(capsJson) }
              assertTrue(
                exception.message!!.contains(expectError) ||
                  exception.message!!.contains("No client-supported catalog found")
              )
            } else {
              val selected = manager.getSelectedCatalog(capsJson)
              if (case.containsKey("expect_selected")) {
                assertEquals(case["expect_selected"] as String, selected.catalogId)
              }
              if (case.containsKey("expect_catalog_schema")) {
                val expectSchemaStr = jsonMapper.writeValueAsString(case["expect_catalog_schema"])
                val expectSchema = Json.parseToJsonElement(expectSchemaStr)
                assertEquals(expectSchema, selected.catalogSchema)
              }
            }
          }
          "load_catalog" -> {
            val catalogConfigs = case["catalog_configs"] as? List<*> ?: emptyList<Any>()
            val modifiers = case["modifiers"] as? List<String> ?: emptyList()

            val schemaModifiers = mutableListOf<(JsonObject) -> JsonObject>()
            if (modifiers.contains("remove_strict_validation")) {
              schemaModifiers.add { SchemaModifiers.removeStrictValidation(it) }
            }

            val configs =
              catalogConfigs.map { cfgObj ->
                val cfg = cfgObj as Map<*, *>
                val path = cfg["path"] as String
                val fullPath = File(conformanceDir, path).absolutePath
                CatalogConfig.fromPath(name = cfg["name"] as String, catalogPath = fullPath)
              }

            val manager =
              A2uiSchemaManager(
                version = A2uiVersion.VERSION_0_8,
                catalogs = configs,
                schemaModifiers = schemaModifiers,
              )

            val selected = manager.getSelectedCatalog()
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Map<*, *>

            if (expect.containsKey("catalog_schema")) {
              val expectSchemaStr = jsonMapper.writeValueAsString(expect["catalog_schema"])
              val expectSchema = Json.parseToJsonElement(expectSchemaStr)
              assertEquals(expectSchema, selected.catalogSchema)
            }

            if (expect.containsKey("supported_catalog_ids")) {
              val expectIds = expect["supported_catalog_ids"] as List<String>
              assertEquals(expectIds, manager.supportedCatalogIds)
            }
          }
          "generate_prompt" -> {
            val versionStr = args["version"] as? String ?: "0.8"
            val version =
              if (versionStr == "0.8") A2uiVersion.VERSION_0_8 else A2uiVersion.VERSION_0_9
            val role = args["role_description"] as? String ?: ""
            val workflow = args["workflow_description"] as? String ?: ""
            val uiDesc = args["ui_description"] as? String ?: ""
            val includeSchema = args["include_schema"] as? Boolean ?: false
            val includeExamples = args["include_examples"] as? Boolean ?: false
            val validateExamples = args["validate_examples"] as? Boolean ?: false

            val clientCapabilities = args["client_ui_capabilities"] as? Map<*, *>
            val capsJsonStr = jsonMapper.writeValueAsString(clientCapabilities)
            val capsJson = Json.parseToJsonElement(capsJsonStr) as? JsonObject

            val allowedComponents = args["allowed_components"] as? List<String> ?: emptyList()

            val examplesPath = args["examples_path"] as? String
            val fullExamplesPath = examplesPath?.let { File(conformanceDir, it).absolutePath }

            val dummyCatalog =
              Json.parseToJsonElement(
                  "{\"catalogId\": \"https://a2ui.org/specification/v0_8/standard_catalog_definition.json\", \"components\": {\"Text\": {\"\$ref\": \"common_types.json#/\$defs/DynamicString\"}}}"
                )
                .jsonObject
            val dummyConfig =
              CatalogConfig(
                name = "basic",
                provider = MemoryCatalogProvider(dummyCatalog),
                examplesPath = fullExamplesPath,
              )

            val manager =
              A2uiSchemaManager(
                version = version,
                catalogs = listOf(dummyConfig),
                acceptsInlineCatalogs = args["accepts_inline_catalogs"] as? Boolean ?: false,
              )

            val output =
              manager.generateSystemPrompt(
                roleDescription = role,
                workflowDescription = workflow,
                uiDescription = uiDesc,
                clientUiCapabilities = capsJson,
                allowedComponents = allowedComponents,
                includeSchema = includeSchema,
                includeExamples = includeExamples,
                validateExamples = validateExamples,
              )

            val outputNormalized = output.replace(Regex("\\s+"), "").trim()

            if (case.containsKey(KEY_EXPECT_CONTAINS)) {
              val expectContains = case[KEY_EXPECT_CONTAINS] as List<String>
              for (expected in expectContains) {
                val expectedNormalized = expected.replace(Regex("\\s+"), "").trim()
                assertTrue(
                  outputNormalized.contains(expectedNormalized),
                  "Expected output to contain '$expectedNormalized', but got: $outputNormalized",
                )
              }
            }
          }
          else -> assert(false, { "Unknown action: $action" })
        }
      }
    }
  }

  @TestFactory
  fun testParserConformance(): List<DynamicTest> {
    val conformanceFile = ConformanceTestHelper.getConformanceFile(PARSER_YAML_FILE)
    val rawList = yamlMapper.readValue(conformanceFile, Any::class.java) as List<*>

    return rawList.mapNotNull { caseObj ->
      val case = caseObj as Map<*, *>
      val name = case[ConformanceTestHelper.KEY_NAME] as String
      val action = case[ConformanceTestHelper.KEY_ACTION] as String
      val input = case[KEY_INPUT] as String

      DynamicTest.dynamicTest(name) {
        when (action) {
          "parse_full" -> {
            if (case.containsKey(ConformanceTestHelper.KEY_EXPECT_ERROR)) {
              val expectError = case[ConformanceTestHelper.KEY_EXPECT_ERROR] as String
              val exception =
                assertFailsWith<IllegalArgumentException> { parseResponseToParts(input) }
              assertTrue(
                exception.message!!.contains(expectError) ||
                  exception.message!!.contains("not found in response") ||
                  exception.message!!.contains("A2UI JSON part is empty") ||
                  exception.message!!.contains("Failed to parse"),
                "Expected error containing '$expectError', but got: ${exception.message}",
              )
            } else {
              val parts = parseResponseToParts(input)
              val expect = case[ConformanceTestHelper.KEY_EXPECT] as List<*>
              assertEquals(expect.size, parts.size)
              for (i in expect.indices) {
                val exp = expect[i] as Map<*, *>
                val part = parts[i]
                assertEquals(exp[KEY_TEXT] as? String ?: "", part.text)
                val expA2ui = exp[KEY_A2UI]
                if (expA2ui != null) {
                  val expJsonStr = jsonMapper.writeValueAsString(expA2ui)
                  val expJson = Json.parseToJsonElement(expJsonStr) as JsonArray
                  assertEquals(
                    normalizeA2uiJson(expJson),
                    normalizeA2uiJson(JsonArray(part.a2uiJson!!)),
                  )
                } else {
                  assertNull(part.a2uiJson)
                }
              }
            }
          }
          "fix_payload" -> {
            val result = PayloadFixer.parseAndFix(input)
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as List<*>
            val expectJsonStr = jsonMapper.writeValueAsString(expect)
            val expectJson = Json.parseToJsonElement(expectJsonStr) as JsonArray
            assertEquals(expectJson, result)
          }
          "has_parts" -> {
            val result = hasA2uiParts(input)
            val expect = case[ConformanceTestHelper.KEY_EXPECT] as Boolean
            assertEquals(expect, result)
          }
          else -> assert(false, { "Unknown action: $action" })
        }
      }
    }
  }

  @TestFactory
  fun testStreamingParserConformance(): List<DynamicTest> {
    val conformanceFile = ConformanceTestHelper.getConformanceFile(STREAMING_PARSER_YAML_FILE)
    val conformanceDir = ConformanceTestHelper.getConformanceDir()
    val rawList = yamlMapper.readValue(conformanceFile, Any::class.java) as List<*>

    val baseSchemaMappings = mutableMapOf<String, String>()
    val repoRoot = ConformanceTestHelper.repoRoot
    val jsonDirs =
      listOf(
        conformanceDir to listOf(URL_PREFIX_V09, URL_PREFIX_V08),
        File(conformanceDir, "test_data") to listOf(URL_PREFIX_V09, URL_PREFIX_V08),
        File(repoRoot, "specification/v0_9/json") to listOf(URL_PREFIX_V09),
        File(repoRoot, "specification/v0_8/json") to listOf(URL_PREFIX_V08),
      )

    jsonDirs.forEach { (dir, prefixes) ->
      dir
        .listFiles { _, name -> name.endsWith(".json") }
        ?.forEach { f ->
          prefixes.forEach { prefix ->
            baseSchemaMappings["$prefix${f.name}"] = f.toURI().toString()
          }
          baseSchemaMappings[f.name] = f.toURI().toString()
        }
    }

    return rawList.mapNotNull { caseObj ->
      val case = caseObj as Map<*, *>
      val name = case[ConformanceTestHelper.KEY_NAME] as String
      val action = case[ConformanceTestHelper.KEY_ACTION] as? String ?: ""
      if (action != "process_chunk") return@mapNotNull null

      val catalogMap = case[ConformanceTestHelper.KEY_CATALOG] as? Map<*, *>
      val steps = case[ConformanceTestHelper.KEY_STEPS] as? List<*> ?: emptyList<Any>()

      DynamicTest.dynamicTest(name) {
        val (catalog, schemaMappings) =
          catalogMap?.let { buildCatalog(it, conformanceDir, baseSchemaMappings) }
            ?: (null to emptyMap())
        val parser = StreamingParser.create(catalog, schemaMappings)
        if (case["disable_validation"] as? Boolean == true) {
          parser.validator = null
        }

        for ((stepIdx, stepObj) in steps.withIndex()) {
          val step = stepObj as Map<*, *>
          val input = step[KEY_INPUT] as String
          val expectError = step[ConformanceTestHelper.KEY_EXPECT_ERROR] as? String

          if (expectError != null) {
            val exception =
              assertFailsWith<Exception>("Expected failure for $name at step $stepIdx") {
                parser.processChunk(input)
              }
            val regex = Regex(expectError)
            assertTrue(
              regex.containsMatchIn(exception.message ?: "") ||
                regex.containsMatchIn(exception.cause?.message ?: "") ||
                exception.javaClass.simpleName.contains("JsonDecodingException") ||
                exception.message?.contains("Failed to parse JSON") == true ||
                exception.message?.contains("messages[") == true,
              "Expected error matching '$expectError', but got: ${exception.javaClass.name}: ${exception.message} (cause: ${exception.cause?.message}) at step $stepIdx",
            )
          } else {
            val parts = parser.processChunk(input)
            val expect = step[ConformanceTestHelper.KEY_EXPECT] as? List<*> ?: emptyList<Any>()
            assertEquals(
              expect.size,
              parts.size,
              "Mismatch in response parts size for $name at step $stepIdx",
            )
            for (i in expect.indices) {
              val exp = expect[i] as Map<*, *>
              val part = parts[i]
              assertEquals(
                exp[KEY_TEXT] as? String ?: "",
                part.text,
                "Text mismatch in part $i for $name at step $stepIdx",
              )
              val expA2ui = exp[KEY_A2UI]
              if (expA2ui != null) {
                assertNotNull(
                  part.a2uiJson,
                  "Expected non-null a2uiJson in part $i for $name at step $stepIdx",
                )
                val expJsonStr = jsonMapper.writeValueAsString(expA2ui)
                val expJson = Json.parseToJsonElement(expJsonStr) as JsonArray
                assertEquals(
                  normalizeA2uiJson(expJson),
                  normalizeA2uiJson(JsonArray(part.a2uiJson!!)),
                  "A2UI JSON mismatch in part $i for $name at step $stepIdx",
                )
              } else {
                assertNull(
                  part.a2uiJson,
                  "Expected null a2uiJson in part $i for $name at step $stepIdx",
                )
              }
            }
          }
        }
      }
    }
  }

  private fun normalizeA2uiJson(elem: JsonElement): JsonElement {
    when (elem) {
      is JsonObject -> {
        val map = mutableMapOf<String, JsonElement>()
        for ((k, v) in elem) {
          map[k] = normalizeA2uiJson(v)
        }
        return JsonObject(map)
      }
      is JsonArray -> {
        return JsonArray(elem.map { normalizeA2uiJson(it) })
      }
      else -> return elem
    }
  }

  private companion object {
    private const val STREAMING_PARSER_YAML_FILE = "suites/streaming_parser.yaml"
    private const val SIMPLIFIED_CATALOG_V09 = "simplified_catalog_v09.json"
    private const val URL_PREFIX_V09 = "https://a2ui.org/specification/v0_9/"
    private const val URL_PREFIX_V08 = "https://a2ui.org/specification/v0_8/"
    private const val VERSION_0_8_STR = "0.8"
    private const val TEST_CATALOG_NAME = "test_catalog"
    private const val VALIDATOR_YAML_FILE = "suites/validator.yaml"
    private const val CATALOG_YAML_FILE = "suites/catalog.yaml"
    private const val SCHEMA_MANAGER_YAML_FILE = "suites/schema_manager.yaml"
    private const val PARSER_YAML_FILE = "suites/parser.yaml"

    private const val KEY_EXPECT_CONTAINS = "expect_contains"
    private const val KEY_INPUT = "input"
    private const val KEY_TEXT = "text"
    private const val KEY_A2UI = "a2ui"
    private const val KEY_PATH = "path"
    private const val KEY_ALLOWED_COMPONENTS = "allowed_components"
    private const val KEY_CATALOG_SCHEMA = "catalog_schema"
  }
}

private data class ConformanceTestCase(
  val name: String,
  val catalog: A2uiCatalog,
  val validate: List<ValidateStep>,
  val schemaMappings: Map<String, String>,
)

private data class ValidateStep(val payload: JsonElement, val expectError: String?)
