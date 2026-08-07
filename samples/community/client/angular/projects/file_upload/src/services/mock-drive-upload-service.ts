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

import {Injectable, signal} from '@angular/core';
import {TelemetryLoggerService} from './telemetry-logger-service';

@Injectable({
  providedIn: 'root',
})
// NOTE: This is a mock implementation of a file upload service designed for demonstration purposes.
// In a real-world scenario, you would replace this with an integration to a real storage
// provider (e.g., Google Drive, AWS S3, or Azure Blob Storage).
export class MockDriveUploadService {
  private readonly uploadEndpoint = '/api/upload';
  readonly uploadedFiles = signal<
    {
      fileId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    }[]
  >([]);

  addUploadedFile(info: {fileId: string; fileName: string; fileSize: number; mimeType: string}) {
    this.uploadedFiles.update(files => [...files, info]);
  }

  removeUploadedFile(pointerUri: string) {
    this.uploadedFiles.update(files => files.filter(f => f.fileId !== pointerUri));
  }

  constructor(private telemetry: TelemetryLoggerService) {}

  async uploadFileToDrive(file: File, onProgress?: (percent: number) => void): Promise<string> {
    this.telemetry.log({
      card: 'ioc',
      title: `Uploading ${file.name} to Mock Drive`,
      detail: {
        fileName: file.name,
        fileSize: `${(file.size / 1024).toFixed(2)} KB`,
        mimeType: file.type || 'application/octet-stream',
        endpoint: this.uploadEndpoint,
      },
    });

    if (onProgress) {
      onProgress(30);
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append(
      'metadata',
      JSON.stringify({
        name: file.name,
        parents: ['demo-public-folder'],
      }),
    );

    try {
      const response = await fetch(this.uploadEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }

      if (onProgress) {
        onProgress(100);
      }

      const result = (await response.json()) as {id: string; name: string; size: string};
      const pointerUri = `mockdrive://${result.id}`;

      this.telemetry.log({
        card: 'ioc',
        title: 'IoC Upload Successful',
        detail: {
          driveFileId: result.id,
          pointerUri: pointerUri,
          storage: 'Local Mock Drive (/tmp/mock_drive_storage)',
        },
      });

      return pointerUri;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.telemetry.log({
        card: 'ioc',
        title: 'IoC Upload Error',
        detail: {error: errorMsg},
      });
      throw err;
    }
  }
}
