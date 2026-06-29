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

package com.google.a2ui.samples.rizzcharts;

import com.google.adk.tools.BaseTool;
import com.google.adk.tools.ToolContext;
import io.reactivex.rxjava3.core.Single;
import java.util.List;
import java.util.Map;

public class RizzchartsTools {

  public static class GetStoreSalesTool extends BaseTool {
    public GetStoreSalesTool() {
      super(
          "get_store_sales", "Gets individual store sales. Args: region: the region to filter by.");
    }

    @Override
    public java.util.Optional<com.google.genai.types.FunctionDeclaration> declaration() {
      return java.util.Optional.of(
          com.google.genai.types.FunctionDeclaration.builder()
              .name(name())
              .description(description())
              .parameters(
                  com.google.genai.types.Schema.builder()
                      .type(
                          new com.google.genai.types.Type(com.google.genai.types.Type.Known.OBJECT))
                      .properties(
                          java.util.Map.of(
                              "region",
                              com.google.genai.types.Schema.builder()
                                  .type(
                                      new com.google.genai.types.Type(
                                          com.google.genai.types.Type.Known.STRING))
                                  .description("the region to filter by")
                                  .build()))
                      .build())
              .build());
    }

    @Override
    public Single<Map<String, Object>> runAsync(Map<String, Object> args, ToolContext toolContext) {
      return Single.fromCallable(
          () -> {
            return Map.of(
                "center", Map.of("lat", 34.0, "lng", -118.2437),
                "zoom", 10,
                "locations",
                    List.of(
                        Map.of(
                            "lat", 34.0195,
                            "lng", -118.4912,
                            "name", "Santa Monica Branch",
                            "description", "High traffic coastal location.",
                            "outlier_reason", "Yes, 15% sales over baseline",
                            "background", "#4285F4",
                            "borderColor", "#FFFFFF",
                            "glyphColor", "#FFFFFF"),
                        Map.of("lat", 34.0488, "lng", -118.2518, "name", "Downtown Flagship"),
                        Map.of(
                            "lat", 34.1016, "lng", -118.3287, "name", "Hollywood Boulevard Store"),
                        Map.of("lat", 34.1478, "lng", -118.1445, "name", "Pasadena Location"),
                        Map.of("lat", 33.7701, "lng", -118.1937, "name", "Long Beach Outlet"),
                        Map.of(
                            "lat", 34.0736, "lng", -118.4004, "name", "Beverly Hills Boutique")));
          });
    }
  }

  public static class GetSalesDataTool extends BaseTool {
    public GetSalesDataTool() {
      super(
          "get_sales_data",
          "Gets the sales data. Args: time_period: the time period to filter by.");
    }

    @Override
    public java.util.Optional<com.google.genai.types.FunctionDeclaration> declaration() {
      return java.util.Optional.of(
          com.google.genai.types.FunctionDeclaration.builder()
              .name(name())
              .description(description())
              .parameters(
                  com.google.genai.types.Schema.builder()
                      .type(
                          new com.google.genai.types.Type(com.google.genai.types.Type.Known.OBJECT))
                      .properties(
                          java.util.Map.of(
                              "time_period",
                              com.google.genai.types.Schema.builder()
                                  .type(
                                      new com.google.genai.types.Type(
                                          com.google.genai.types.Type.Known.STRING))
                                  .description("the time period to filter by")
                                  .build()))
                      .build())
              .build());
    }

    @Override
    public Single<Map<String, Object>> runAsync(Map<String, Object> args, ToolContext toolContext) {
      return Single.fromCallable(
          () -> {
            return Map.of(
                "sales_data",
                List.of(
                    Map.of(
                        "label",
                        "Apparel",
                        "value",
                        41,
                        "drillDown",
                        List.of(
                            Map.of("label", "Tops", "value", 31),
                            Map.of("label", "Bottoms", "value", 38),
                            Map.of("label", "Outerwear", "value", 20),
                            Map.of("label", "Footwear", "value", 11))),
                    Map.of(
                        "label",
                        "Home Goods",
                        "value",
                        15,
                        "drillDown",
                        List.of(
                            Map.of("label", "Pillow", "value", 8),
                            Map.of("label", "Coffee Maker", "value", 16),
                            Map.of("label", "Area Rug", "value", 3),
                            Map.of("label", "Bath Towels", "value", 14))),
                    Map.of(
                        "label",
                        "Electronics",
                        "value",
                        28,
                        "drillDown",
                        List.of(
                            Map.of("label", "Phones", "value", 25),
                            Map.of("label", "Laptops", "value", 27),
                            Map.of("label", "TVs", "value", 21),
                            Map.of("label", "Other", "value", 27))),
                    Map.of("label", "Health & Beauty", "value", 10),
                    Map.of("label", "Other", "value", 6)));
          });
    }
  }
}
