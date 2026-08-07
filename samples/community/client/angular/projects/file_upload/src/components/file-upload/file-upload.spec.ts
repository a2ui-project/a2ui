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

import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {signal} from '@angular/core';
import {A2uiRendererService} from '@a2ui/angular/v0_9';
import {SurfaceModel, SurfaceGroupModel} from '@a2ui/web_core/v0_9';
import {
  FileUploadComponent,
  FILE_UPLOAD_CONFIG,
  DEFAULT_MAX_FILE_SIZE,
  FileUploadConfig,
} from './file-upload';

describe('FileUploadComponent', () => {
  let component: FileUploadComponent;
  let fixture: ComponentFixture<FileUploadComponent>;
  let mockRendererService: jasmine.SpyObj<A2uiRendererService>;
  let mockSurfaceGroup: jasmine.SpyObj<SurfaceGroupModel<any>>;
  let mockSurface: jasmine.SpyObj<SurfaceModel<any>>;
  let mockConfig: FileUploadConfig;

  beforeEach(async () => {
    mockSurface = jasmine.createSpyObj<SurfaceModel<any>>('SurfaceModel', ['dispatchAction'], {
      dataModel: jasmine.createSpyObj('DataModel', ['set']) as any,
    });

    mockSurfaceGroup = jasmine.createSpyObj<SurfaceGroupModel<any>>('SurfaceGroupModel', [
      'getSurface',
    ]);
    mockSurfaceGroup.getSurface.and.returnValue(mockSurface);

    mockRendererService = jasmine.createSpyObj<A2uiRendererService>('A2uiRendererService', [], {
      surfaceGroup: mockSurfaceGroup,
    });

    mockConfig = {
      maxInlineSize: 500_000,
    };

    await TestBed.configureTestingModule({
      imports: [FileUploadComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: FILE_UPLOAD_CONFIG, useValue: mockConfig},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FileUploadComponent);
    component = fixture.componentInstance;

    // Set required inputs from CatalogComponent
    fixture.componentRef.setInput('props', {});
    fixture.componentRef.setInput('surfaceId', 'test-surface');
    fixture.componentRef.setInput('componentId', 'test-component');

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have default values when no props are provided', () => {
    expect(component.multiple()).toBeFalse();
    expect(component.label()).toBe('Drag and drop files or click to upload');
    expect(component.accept()).toBe('*/*');
    expect(component.maxSize()).toBe(DEFAULT_MAX_FILE_SIZE);
  });

  it('should read values from props', () => {
    fixture.componentRef.setInput('props', {
      multiple: signal(true),
      label: signal('Upload here'),
      accept: signal('image/*'),
      maxSize: signal(1024),
    });
    fixture.detectChanges();

    expect(component.multiple()).toBeTrue();
    expect(component.label()).toBe('Upload here');
    expect(component.accept()).toBe('image/*');
    expect(component.maxSize()).toBe(1024);
  });

  it('should show error if file exceeds max size', fakeAsync(() => {
    fixture.componentRef.setInput('props', {
      maxSize: signal(100),
    });
    fixture.detectChanges();

    const file = new File([''], 'test.txt');
    Object.defineProperty(file, 'size', {value: 1024});

    component.onFileSelected({
      target: {files: [file]},
    } as any);

    tick();

    expect(component.uploadState()).toBe('error');
    expect(component.errorMessage()).toContain('exceeds limit');
  }));

  it('should process file and call dispatchAction on success (inline)', fakeAsync(() => {
    const file = new File(['hello'], 'test.txt', {type: 'text/plain'});
    Object.defineProperty(file, 'size', {value: 5});

    // Mock FileReader
    const mockFileReader = {
      readAsDataURL: jasmine.createSpy('readAsDataURL').and.callFake(function (this: any) {
        this.result = 'data:text/plain;base64,aGVsbG8=';
        this.onload();
      }),
    };
    spyOn(window as any, 'FileReader').and.returnValue(mockFileReader);

    component.onFileSelected({
      target: {files: [file]},
    } as any);

    tick();

    expect(component.uploadState()).toBe('success');
    expect(component.progress()).toBe(100);
    expect(component.uploadedFiles().length).toBe(1);
    expect(component.uploadedFiles()[0].fileId).toBe('data:text/plain;base64,aGVsbG8=');

    expect(mockSurface.dataModel.set).toHaveBeenCalledWith('/uploaded_files', undefined);
    expect(mockSurface.dispatchAction).toHaveBeenCalled();
  }));

  it('should enforce single file if multiple is false', fakeAsync(() => {
    const file1 = new File(['a'], 'a.txt');
    const file2 = new File(['b'], 'b.txt');

    // Mock FileReader
    const mockFileReader = {
      readAsDataURL: jasmine.createSpy('readAsDataURL').and.callFake(function (this: any) {
        this.result = 'data:text/plain;base64,YXNkZg==';
        this.onload();
      }),
    };
    spyOn(window as any, 'FileReader').and.returnValue(mockFileReader);

    component.onFileSelected({
      target: {files: [file1, file2]},
    } as any);

    tick();

    expect(component.uploadedFiles().length).toBe(1);
    expect(component.uploadedFiles()[0].metadata.fileName).toBe('a.txt');
  }));

  it('should remove file and call onRemoveFile if provided', () => {
    mockConfig.onRemoveFile = jasmine.createSpy('onRemoveFile');

    component.uploadedFiles.set([
      {fileId: 'test-uri', metadata: {fileName: 'test.txt', fileSize: 10, mimeType: 'text/plain'}},
    ]);
    component.uploadState.set('success');

    component.removeFile(0);

    expect(component.uploadedFiles().length).toBe(0);
    expect(mockConfig.onRemoveFile).toHaveBeenCalledWith('test-uri');
    expect(component.uploadState()).toBe('idle');
    expect(mockSurface.dispatchAction).toHaveBeenCalled();
  });

  it('should process files on drop', fakeAsync(() => {
    const file = new File(['drop'], 'drop.txt', {type: 'text/plain'});
    Object.defineProperty(file, 'size', {value: 4});

    const mockFileReader = {
      readAsDataURL: jasmine.createSpy('readAsDataURL').and.callFake(function (this: any) {
        this.result = 'data:text/plain;base64,ZHJvcA==';
        this.onload();
      }),
    };
    spyOn(window as any, 'FileReader').and.returnValue(mockFileReader);

    const mockEvent = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
      dataTransfer: {
        files: [file],
      },
    };

    component.onDrop(mockEvent as any);
    tick();

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
    expect(component.uploadedFiles().length).toBe(1);
    expect(component.uploadedFiles()[0].metadata.fileName).toBe('drop.txt');
  }));

  it('should use onUploadFile callback (IoC) if provided in config', fakeAsync(() => {
    // Provide the IoC callback
    mockConfig.onUploadFile = jasmine
      .createSpy('onUploadFile')
      .and.callFake(async (file: File, progressCallback: (percent: number) => void) => {
        progressCallback(50);
        progressCallback(100);
        return 'mock-remote-uri://' + file.name;
      });

    const file = new File(['mock content'], 'remote.txt', {type: 'text/plain'});
    Object.defineProperty(file, 'size', {value: 1024});

    component.onFileSelected({
      target: {files: [file]},
    } as any);

    tick();

    expect(mockConfig.onUploadFile).toHaveBeenCalled();
    expect(component.uploadState()).toBe('success');
    expect(component.progress()).toBe(100);
    expect(component.uploadedFiles().length).toBe(1);
    expect(component.uploadedFiles()[0].fileId).toBe('mock-remote-uri://remote.txt');

    expect(mockSurface.dispatchAction).toHaveBeenCalled();
  }));

  it('should throw error if file exceeds inline limit and onUploadFile is not provided', fakeAsync(() => {
    // Config does not have onUploadFile and file exceeds maxInlineSize
    mockConfig.onUploadFile = undefined;
    mockConfig.maxInlineSize = 10;

    const file = new File(['very large file content'], 'large.txt', {type: 'text/plain'});
    Object.defineProperty(file, 'size', {value: 1024}); // > 10

    component.onFileSelected({
      target: {files: [file]},
    } as any);

    tick();

    expect(component.uploadState()).toBe('error');
    expect(component.errorMessage()).toContain('exceeds inline upload limit');
  }));
});
