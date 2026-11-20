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

package com.google.a2ui.core

import com.google.a2ui.core.catalog.Catalog
import com.google.a2ui.core.common.ProtocolVersion
import com.google.a2ui.core.common.Uax31Identifier
import com.google.a2ui.core.common.isCatalogVersionCompatible
import com.google.a2ui.core.common.reactiveBatch
import com.google.a2ui.core.exceptions.A2uiDataError
import com.google.a2ui.core.exceptions.A2uiIntegrityError
import com.google.a2ui.core.exceptions.A2uiValidationError
import com.google.a2ui.core.processing.MessageProcessor
import com.google.a2ui.core.processing.MessageProcessorOptions
import com.google.a2ui.core.schema.AgentToRendererMessagePayload
import com.google.a2ui.core.schema.CreateSurfaceMessage
import com.google.a2ui.core.validation.STRICT_VALIDATION
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

class CoreSkeletonSmokeTest {

  private fun loadBasicV1CatalogJson(): JsonObject {
    var cursor: Path? = Path.of("").toAbsolutePath()
    while (cursor != null) {
      val candidate = cursor.resolve("catalogs/basic/v1/catalog.json")
      if (Files.isRegularFile(candidate)) {
        return Json.parseToJsonElement(Files.readString(candidate)).jsonObject
      }
      cursor = cursor.parent
    }
    error("Could not locate catalogs/basic/v1/catalog.json from working directory")
  }

  @Test
  fun loadsPublishedBasicV1CatalogAndFailsClosedOnUnversionedCatalog() {
    val catalog = Catalog.fromJson(loadBasicV1CatalogJson())
    assertEquals(ProtocolVersion.V1_0, catalog.protocolVersion)
    assertEquals(18, catalog.components.size)
    assertEquals(14, catalog.functions.size)
    assertTrue("Button" in catalog.components)
    assertTrue("formatString" in catalog.functions)

    // Blueprint §3.A fail-closed rule: absent catalog version is pre-1.0 and rejected for v1.0.
    assertFalse(isCatalogVersionCompatible(catalogVersion = null, expectedVersion = "1.0"))
    assertTrue(isCatalogVersionCompatible(catalogVersion = null, expectedVersion = "v0.9"))
    assertTrue(isCatalogVersionCompatible(catalogVersion = "1.0.0", expectedVersion = "1.0"))
  }

  @Test
  fun enforcesUax31IdentifiersAcrossAstralCodePointsAndBoundaryExclusions() {
    assertTrue(Uax31Identifier.isValid("UserProfile_1"))
    // Mathematical bold capital A (U+1D400, surrogate pair in UTF-16) is XID_Start.
    assertTrue(Uax31Identifier.isValid("\uD835\uDC00_field"))
    assertFalse(Uax31Identifier.isValid("1st_item"))
    assertFalse(Uax31Identifier.isValid("kebab-case"))
    // U+200B ZERO WIDTH SPACE is IdentifierIgnorable in JDK Character, must be rejected in UAX #31.
    assertFalse(Uax31Identifier.isValid("foo\u200Bbar"))
    // U+037A GREEK YPOGEGRAMMENI is ID_Start but excluded from XID_Start under NFKC closure.
    assertFalse(Uax31Identifier.isValid("\u037A"))

    // Other_ID_Start code points that remain valid XID_Start: U+2118 (WEIERSTRASS ELLIPTIC
    // FUNCTION) and U+212E (ESTIMATED SYMBOL).
    assertTrue(Uax31Identifier.isXidStart(0x2118))
    assertTrue(Uax31Identifier.isXidStart(0x212E))
    assertTrue(Uax31Identifier.isValid("\u2118\u212E"))

    // U+2E2F VERTICAL TILDE (Lm) is Pattern_Syntax and excluded from both XID_Start & XID_Continue.
    assertFalse(Uax31Identifier.isXidStart(0x2E2F))
    assertFalse(Uax31Identifier.isXidContinue(0x2E2F))
    assertFalse(Uax31Identifier.isValid("a\u2E2F"))

    // Other_ID_Continue code points valid in continuation position: U+00B7, U+200C, U+200D.
    assertFalse(Uax31Identifier.isXidStart(0x00B7))
    assertTrue(Uax31Identifier.isXidContinue(0x00B7))
    assertTrue(Uax31Identifier.isXidContinue(0x200C))
    assertTrue(Uax31Identifier.isXidContinue(0x200D))
    assertTrue(Uax31Identifier.isValid("a\u00B7\u200C\u200D"))

    // NFKC-unstable Arabic ligatures & presentation forms excluded from XID_Continue:
    // U+FC5E..U+FC63, U+FDFA..U+FDFB, and even code points U+FE70..U+FE7E.
    for (cp in 0xFC5E..0xFC63) {
      assertFalse(
        Uax31Identifier.isXidContinue(cp),
        "Expected U+${cp.toString(16)} not XID_Continue",
      )
    }
    assertFalse(Uax31Identifier.isXidContinue(0xFDFA))
    assertFalse(Uax31Identifier.isXidContinue(0xFDFB))
    for (cp in 0xFE70..0xFE7E step 2) {
      assertFalse(
        Uax31Identifier.isXidContinue(cp),
        "Expected U+${cp.toString(16)} not XID_Continue",
      )
    }
  }

  @Test
  fun appliesCreateSurfaceInitialDataModelPerTopLevelKeyAndValidatesTopology() {
    val basicCatalog = Catalog.fromJson(loadBasicV1CatalogJson())
    val processor =
      MessageProcessor(
        catalogs = listOf(basicCatalog),
        options = MessageProcessorOptions(validationConfig = STRICT_VALIDATION),
      )

    var rootNotifications = 0
    val createMsg =
      CreateSurfaceMessage(
        surfaceId = "profile",
        catalogId = basicCatalog.id,
        sendDataModel = true,
        dataModel =
          JsonObject(
            mapOf("firstName" to JsonPrimitive("Ada"), "lastName" to JsonPrimitive("Lovelace"))
          ),
        components =
          listOf(
            JsonObject(
              mapOf(
                "id" to JsonPrimitive("root"),
                "component" to JsonPrimitive("Column"),
                "children" to JsonArray(listOf(JsonPrimitive("greeting"))),
              )
            ),
            JsonObject(
              mapOf(
                "id" to JsonPrimitive("greeting"),
                "component" to JsonPrimitive("Text"),
                "text" to JsonObject(mapOf("@path" to JsonPrimitive("/firstName"))),
              )
            ),
          ),
      )

    processor.processMessages(AgentToRendererMessagePayload.Single(createMsg))
    val surface = assertNotNull(processor.model.getSurface("profile"))
    val sub = surface.dataModel.subscribe("/") { rootNotifications += 1 }
    reactiveBatch {
      surface.dataModel.set("/firstName", JsonPrimitive("Grace"))
      surface.dataModel.set("/lastName", JsonPrimitive("Hopper"))
    }
    assertEquals(2, rootNotifications)
    sub.unsubscribe()

    assertFailsWith<A2uiDataError> {
      surface.dataModel.set("/__proto__/polluted", JsonPrimitive(true))
    }

    // Inheritance rule (`blueprint` §3.G): A2uiIntegrityError must be caught by
    // A2uiValidationError.
    val cycleError =
      assertFailsWith<A2uiValidationError> {
        processor.processMessages(
          AgentToRendererMessagePayload.Single(
            CreateSurfaceMessage(
              surfaceId = "cyclic_surface",
              catalogId = basicCatalog.id,
              components =
                listOf(
                  JsonObject(
                    mapOf(
                      "id" to JsonPrimitive("root"),
                      "component" to JsonPrimitive("Card"),
                      "child" to JsonPrimitive("root"),
                    )
                  )
                ),
            )
          )
        )
      }
    assertIs<A2uiIntegrityError>(cycleError)
  }
}
