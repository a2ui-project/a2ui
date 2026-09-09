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

export { A2aChatCanvas } from './lib/a2a-chat-canvas';
export { type A2aService, A2A_SERVICE } from './lib/interfaces/a2a-service';
export { CanvasService } from './lib/services/canvas-service';
export { configureChatCanvasFeatures, usingA2aService, usingMarkdownRenderer, usingDefaultSanitizerMarkdownRenderer, usingPartResolvers, usingArtifactResolvers, usingRenderers, usingA2uiRenderers, type ChatCanvasFeature, type MarkdownFeature, type A2aFeature, type ArtifactResolverFeature, type PartResolverFeature, type RendererFeature, type A2uiFeature, type ChatCanvasFeatures, ChatCanvasFeatureKind } from './lib/config';
