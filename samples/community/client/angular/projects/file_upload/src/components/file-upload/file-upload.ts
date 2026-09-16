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

import {CatalogComponent, A2uiRendererService} from '@a2ui/angular/v0_9';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  InjectionToken,
} from '@angular/core';

export interface FileUploadConfig {
  onUploadFile?: (file: File, onProgress: (percent: number) => void) => Promise<string>;
  onRemoveFile?: (pointerUri: string) => void;
  maxInlineSize?: number;
}

export const FILE_UPLOAD_CONFIG = new InjectionToken<FileUploadConfig>('FILE_UPLOAD_CONFIG');

export const DEFAULT_MAX_INLINE_SIZE = 500_000;
export const DEFAULT_MAX_FILE_SIZE = 10_485_760;
export const INLINE_URI_PREFIX = 'inline://';

export enum UploadState {
  IDLE = 'idle',
  UPLOADING = 'uploading',
  SUCCESS = 'success',
  ERROR = 'error',
}

export interface UploadedFile {
  fileId: string;
  inlineData?: string;
  metadata: {
    fileName: string;
    fileSize: number;
    mimeType: string;
  };
}

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
  // Optional by design: If no host callback is configured, the component falls back to inline base64 encoding (see fileupload_component_design.md).
  private readonly config = inject(FILE_UPLOAD_CONFIG, {optional: true}) || {
    maxInlineSize: DEFAULT_MAX_INLINE_SIZE,
  };
  private readonly rendererService = inject(A2uiRendererService);
  readonly multiple = computed<boolean>(() => this.props()['multiple']?.value() ?? false);

  readonly label = computed<string>(
    () => this.props()['label']?.value() ?? 'Drag and drop files or click to upload',
  );
  readonly accept = computed<string>(() => this.props()['accept']?.value() ?? '*/*');
  readonly maxSize = computed<number>(
    () => this.props()['maxSize']?.value() ?? DEFAULT_MAX_FILE_SIZE,
  );

  readonly uploadState = signal<UploadState>(UploadState.IDLE);
  readonly progress = signal<number>(0);
  readonly errorMessage = signal<string>('');
  readonly uploadedFiles = signal<UploadedFile[]>([]);

  get isIocMode(): boolean {
    return !!this.config.onUploadFile;
  }

  isInlineFile(file: UploadedFile): boolean {
    return file.fileId.startsWith(INLINE_URI_PREFIX);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }
    await this.addFilesToUpload(Array.from(input.files));
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
    await this.addFilesToUpload(Array.from(event.dataTransfer.files));
  }

  private async addFilesToUpload(files: File[]) {
    // Enforce single file if multiple is not allowed
    if (!this.multiple() && files.length > 1) {
      files = [files[0]];
    }

    for (const file of files) {
      if (file.size > this.maxSize()) {
        this.uploadState.set(UploadState.ERROR);
        this.errorMessage.set(`File size (${(file.size / 1024).toFixed(1)} KB) exceeds limit`);
        return;
      }
    }

    this.uploadState.set(UploadState.UPLOADING);
    // Fake an initial progress of 15% for immediate UX feedback
    this.progress.set(15);

    // Look up the A2UI Surface and clear the data model to wipe out any stale file pointers
    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    if (surface) {
      surface.dataModel.set('/uploaded_files', undefined);
    }

    try {
      const uploadedFilesContext = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const context = await this.uploadSingleFile(file, i, files.length);
        uploadedFilesContext.push(context);
      }

      this.uploadedFiles.set(uploadedFilesContext);
      this.uploadState.set(UploadState.SUCCESS);
      this.progress.set(100);

      this.dispatchUploadCompleteAction(uploadedFilesContext);
    } catch (err) {
      this.uploadState.set(UploadState.ERROR);
      this.errorMessage.set(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  private async uploadSingleFile(
    file: File,
    index: number,
    totalFiles: number,
  ): Promise<UploadedFile> {
    let pointerUri: string;
    let inlineData: string | undefined = undefined;

    if (this.config.onUploadFile) {
      pointerUri = await this.config.onUploadFile(file, percent => {
        this.progress.set(Math.round((index * 100 + percent) / totalFiles));
      });
    } else if (file.size <= (this.config.maxInlineSize || DEFAULT_MAX_INLINE_SIZE)) {
      inlineData = await this.encodeAsDataUri(file);
      const uuid = crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2);
      pointerUri = `${INLINE_URI_PREFIX}${uuid}`;
      this.progress.set(Math.round(((index + 1) * 100) / totalFiles));
    } else {
      throw new Error(
        `File size (${file.size} bytes) exceeds inline upload limit. ` +
          'A host onUploadFile callback must be configured for large file uploads.',
      );
    }

    return {
      fileId: pointerUri,
      inlineData,
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'text/plain',
      },
    };
  }

  private dispatchUploadCompleteAction(files: UploadedFile[]) {
    const surface = this.rendererService.surfaceGroup.getSurface(this.surfaceId());
    if (surface) {
      surface.dispatchAction(
        {
          event: {
            name: 'upload_complete',
            context: {
              files: files,
              surfaceId: this.surfaceId(),
            },
          },
        },
        this.componentId(),
      );
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

    this.dispatchUploadCompleteAction(files);

    if (files.length === 0) {
      this.uploadState.set(UploadState.IDLE);
    }
  }
}
