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

package com.google.a2ui.samples.rizzcharts

import com.google.adk.tools.BaseTool
import com.google.adk.tools.ToolContext
import com.google.genai.types.FunctionDeclaration
import com.google.genai.types.Schema
import com.google.genai.types.Type
import io.reactivex.rxjava3.core.Single
import java.util.Optional

class RizzchartsTools {

  class GetStoreSalesTool :
    BaseTool(
      "get_store_sales",
      "Gets individual store sales. Args: region: the region to filter by.",
    ) {

    override fun declaration(): Optional<FunctionDeclaration> {
      return Optional.of(
        FunctionDeclaration.builder()
          .name(name())
          .description(description())
          .parameters(
            Schema.builder()
              .type(Type(Type.Known.OBJECT))
              .properties(
                mapOf(
                  "region" to
                    Schema.builder()
                      .type(Type(Type.Known.STRING))
                      .description("the region to filter by")
                      .build()
                )
              )
              .build()
          )
          .build()
      )
    }

    override fun runAsync(
      args: Map<String, Any>,
      toolContext: ToolContext,
    ): Single<Map<String, Any>> {
      return Single.fromCallable {
        mapOf(
          "center" to mapOf("lat" to 34.0, "lng" to -118.2437),
          "zoom" to 10,
          "locations" to
            listOf(
              mapOf(
                "lat" to 34.0195,
                "lng" to -118.4912,
                "name" to "Santa Monica Branch",
                "description" to "High traffic coastal location.",
                "outlier_reason" to "Yes, 15% sales over baseline",
                "background" to "#4285F4",
                "borderColor" to "#FFFFFF",
                "glyphColor" to "#FFFFFF",
              ),
              mapOf("lat" to 34.0488, "lng" to -118.2518, "name" to "Downtown Flagship"),
              mapOf("lat" to 34.1016, "lng" to -118.3287, "name" to "Hollywood Boulevard Store"),
              mapOf("lat" to 34.1478, "lng" to -118.1445, "name" to "Pasadena Location"),
              mapOf("lat" to 33.7701, "lng" to -118.1937, "name" to "Long Beach Outlet"),
              mapOf("lat" to 34.0736, "lng" to -118.4004, "name" to "Beverly Hills Boutique"),
            ),
        )
      }
    }
  }

  class GetSalesDataTool :
    BaseTool(
      "get_sales_data",
      "Gets the sales data. Args: time_period: the time period to filter by.",
    ) {

    override fun declaration(): Optional<FunctionDeclaration> {
      return Optional.of(
        FunctionDeclaration.builder()
          .name(name())
          .description(description())
          .parameters(
            Schema.builder()
              .type(Type(Type.Known.OBJECT))
              .properties(
                mapOf(
                  "time_period" to
                    Schema.builder()
                      .type(Type(Type.Known.STRING))
                      .description("the time period to filter by")
                      .build()
                )
              )
              .build()
          )
          .build()
      )
    }

    override fun runAsync(
      args: Map<String, Any>,
      toolContext: ToolContext,
    ): Single<Map<String, Any>> {
      return Single.fromCallable {
        mapOf(
          "sales_data" to
            listOf(
              mapOf(
                "label" to "Apparel",
                "value" to 41,
                "drillDown" to
                  listOf(
                    mapOf("label" to "Tops", "value" to 31),
                    mapOf("label" to "Bottoms", "value" to 38),
                    mapOf("label" to "Outerwear", "value" to 20),
                    mapOf("label" to "Footwear", "value" to 11),
                  ),
              ),
              mapOf(
                "label" to "Home Goods",
                "value" to 15,
                "drillDown" to
                  listOf(
                    mapOf("label" to "Pillow", "value" to 8),
                    mapOf("label" to "Coffee Maker", "value" to 16),
                    mapOf("label" to "Area Rug", "value" to 3),
                    mapOf("label" to "Bath Towels", "value" to 14),
                  ),
              ),
              mapOf(
                "label" to "Electronics",
                "value" to 28,
                "drillDown" to
                  listOf(
                    mapOf("label" to "Phones", "value" to 25),
                    mapOf("label" to "Laptops", "value" to 27),
                    mapOf("label" to "TVs", "value" to 21),
                    mapOf("label" to "Other", "value" to 27),
                  ),
              ),
              mapOf("label" to "Health & Beauty", "value" to 10),
              mapOf("label" to "Other", "value" to 6),
            )
        )
      }
    }
  }
}
