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

import {
  configureChatCanvasFeatures,
  usingA2aService,
  usingA2uiRenderers,
  usingDefaultSanitizerMarkdownRenderer,
} from '@a2a_chat_canvas/config';
import {
  ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {provideClientHydration, withEventReplay} from '@angular/platform-browser';
import {provideMarkdownRenderer} from '@a2ui/angular/v0_9';
import {DEMO_CATALOG} from '../a2ui-catalog/catalog';
import {A2aServiceImpl} from '../services/a2a-service-impl';
import {FILE_UPLOAD_CONFIG} from '../components/file-upload/file-upload';
import {MockDriveUploadService} from '../services/mock-drive-upload-service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideClientHydration(withEventReplay()),
    provideMarkdownRenderer(),
    configureChatCanvasFeatures(
      usingA2aService(A2aServiceImpl),
      usingA2uiRenderers(
        null, // 1st param: customCatalogV08 (null = do not use v0.8 catalog)
        DEMO_CATALOG, // 2nd param: customCatalogV09 (authoritative v0.9 catalog)
      ),
      usingDefaultSanitizerMarkdownRenderer(),
    ),
    // Configures the FileUpload component to integrate with Mock Drive out-of-band resolution.
    // Uploads the file to the mock drive service and returns an abstract pointer URI (e.g. mockdrive://...)
    // to the A2UI agent, rather than sending raw file bytes over the web socket.
    {
      provide: FILE_UPLOAD_CONFIG,
      useFactory: () => {
        const driveService = inject(MockDriveUploadService);
        return {
          onUploadFile: async (file: File, onProgress: (percent: number) => void) => {
            const pointerUri = await driveService.uploadFileToDrive(file, onProgress);
            driveService.addUploadedFile({
              fileId: pointerUri,
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type || 'text/plain',
            });
            return pointerUri;
          },
          onRemoveFile: (pointerUri: string) => {
            driveService.removeUploadedFile(pointerUri);
          },
        };
      },
    },
  ],
};
