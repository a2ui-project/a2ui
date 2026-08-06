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

import {CatalogComponent, A2uiRendererService} from '@a2ui/angular/v0_9';
import {ChangeDetectionStrategy, Component, computed, inject, signal, InjectionToken} from '@angular/core';


export interface FileUploadConfig {
  onUploadFile?: (file: File, onProgress: (percent: number) => void) => Promise<string>;
  onRemoveFile?: (pointerUri: string) => void;
  maxInlineSize?: number;
}

export const FILE_UPLOAD_CONFIG = new InjectionToken<FileUploadConfig>('FILE_UPLOAD_CONFIG');

export const DEFAULT_MAX_INLINE_SIZE = 500_000;
export const DEFAULT_MAX_FILE_SIZE = 10_485_760;

export interface FileUploadProps {
  label?: string;
  accept?: string;
  maxSize?: number;
  multiple?: boolean;
}

@Component({
  selector: 'a2ui-file-upload',
  standalone: true,
  templateUrl: './file-upload.ng.html',
  styleUrl: './file-upload.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileUploadComponent extends CatalogComponent<any> {
  private readonly config = inject(FILE_UPLOAD_CONFIG, {optional: true}) || {
    maxInlineSize: DEFAULT_MAX_INLINE_SIZE,
  };
  private readonly rendererService = inject(A2uiRendererService);
  readonly multiple = computed<boolean>(() => this.props()['multiple']?.value() ?? false);

  readonly label = computed<string>(
    () =>
      this.props()['label']?.value() ?? 'Drag and drop files or click to upload',
  );
  readonly accept = computed<string>(() => this.props()['accept']?.value() ?? '*/*');
  readonly maxSize = computed<number>(() => this.props()['maxSize']?.value() ?? DEFAULT_MAX_FILE_SIZE);

  readonly uploadState = signal<'idle' | 'uploading' | 'success' | 'error'>('idle');
  readonly progress = signal<number>(0);
  readonly errorMessage = signal<string>('');
  readonly uploadedFiles = signal<{fileId: string, metadata: {fileName: string, fileSize: number, mimeType: string}}[]>([]);

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    await this.processFiles(Array.from(input.files));
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  async onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) {
      return;
    }
    await this.processFiles(Array.from(event.dataTransfer.files));
  }

  private async processFiles(files: File[]) {
    // Enforce single file if multiple is not allowed
    if (!this.multiple() && files.length > 1) {
      files = [files[0]];
    }

    for (const file of files) {
      if (file.size > this.maxSize()) {
        this.uploadState.set('error');
        this.errorMessage.set(`File size (${(file.size / 1024).toFixed(1)} KB) exceeds limit`);
        return;
      }
    }

    this.uploadState.set('uploading');
    this.progress.set(15);

    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    if (surface) {
      surface.dataModel.set('/uploaded_file/fileId', undefined);
    }

    try {
      const uploadedFilesContext = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let pointerUri: string;

        if (this.config.onUploadFile) {
          pointerUri = await this.config.onUploadFile(file, percent => {
            this.progress.set(Math.round(((i * 100) + percent) / files.length));
          });
        } else if (file.size <= (this.config.maxInlineSize || DEFAULT_MAX_INLINE_SIZE)) {
          pointerUri = await this.encodeAsDataUri(file);
          this.progress.set(Math.round(((i + 1) * 100) / files.length));
        } else {
          throw new Error(
            `File size (${file.size} bytes) exceeds inline upload limit. ` +
            'A host onUploadFile callback must be configured for large file uploads.'
          );
        }

        uploadedFilesContext.push({
          fileId: pointerUri,
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'text/plain',
          }
        });
      }

      this.uploadedFiles.set(uploadedFilesContext);
      this.uploadState.set('success');
      this.progress.set(100);

      if (surface) {
        surface.dispatchAction({
          event: {
            name: 'upload_complete',
            context: {
              files: uploadedFilesContext,
              surfaceId: this.surfaceId()
            }
          }
        }, this.componentId());
      }
    } catch (err) {
      this.uploadState.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  private encodeAsDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to encode file as data URI'));
      reader.readAsDataURL(file);
    });
  }

  removeFile(index: number) {
    const files = [...this.uploadedFiles()];
    const removed = files.splice(index, 1)[0];
    this.uploadedFiles.set(files);
    
    if (this.config.onRemoveFile) {
      this.config.onRemoveFile(removed.fileId);
    }
    
    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    if (surface) {
      surface.dispatchAction({
        event: {
          name: 'upload_complete',
          context: {
            files: files,
            surfaceId: this.surfaceId()
          }
        }
      }, this.componentId());
    }
    
    if (files.length === 0) {
      this.uploadState.set('idle');
    }
  }
}
