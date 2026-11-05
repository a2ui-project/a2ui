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

import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {signal} from '@angular/core';
import {A2uiRendererService} from '@a2ui/angular/v0_9';
import {DataModel, SurfaceModel, SurfaceGroupModel} from '@a2ui/web_core/v0_9';
import {
  FileUploadComponent,
  FILE_UPLOAD_CONFIG,
  DEFAULT_MAX_FILE_SIZE,
  FileUploadConfig,
  INLINE_URI_PREFIX,
  UploadState,
} from './file-upload';

/** Builds a bound property the way the renderer hands them to catalog components. */
function bound<T>(value: T, onUpdate = jasmine.createSpy('onUpdate')) {
  return {value: signal(value), raw: value, onUpdate};
}

function mockFileReader(dataUri: string) {
  const reader = {
    readAsDataURL: jasmine.createSpy('readAsDataURL').and.callFake(function (this: any) {
      this.result = dataUri;
      this.onload();
    }),
  };
  spyOn(window as any, 'FileReader').and.returnValue(reader);
  return reader;
}

function fileOfSize(name: string, size: number, type = 'text/plain'): File {
  const file = new File(['x'], name, {type});
  Object.defineProperty(file, 'size', {value: size});
  return file;
}

describe('FileUploadComponent', () => {
  let component: FileUploadComponent;
  let fixture: ComponentFixture<FileUploadComponent>;
  let mockSurface: jasmine.SpyObj<SurfaceModel<any>>;
  let mockConfig: FileUploadConfig;
  let onValueUpdate: jasmine.Spy;

  beforeEach(async () => {
    mockSurface = jasmine.createSpyObj<SurfaceModel<any>>('SurfaceModel', ['dispatchAction'], {
      dataModel: new DataModel(),
    });

    const mockSurfaceGroup = jasmine.createSpyObj<SurfaceGroupModel<any>>('SurfaceGroupModel', [
      'getSurface',
    ]);
    mockSurfaceGroup.getSurface.and.returnValue(mockSurface);

    const mockRendererService = jasmine.createSpyObj<A2uiRendererService>(
      'A2uiRendererService',
      [],
      {surfaceGroup: mockSurfaceGroup},
    );

    mockConfig = {maxInlineSize: 500_000};

    await TestBed.configureTestingModule({
      imports: [FileUploadComponent],
      providers: [
        {provide: A2uiRendererService, useValue: mockRendererService},
        {provide: FILE_UPLOAD_CONFIG, useValue: mockConfig},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FileUploadComponent);
    component = fixture.componentInstance;

    onValueUpdate = jasmine.createSpy('onUpdate');
    fixture.componentRef.setInput('props', {value: bound(undefined, onValueUpdate)});
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
      value: bound(undefined, onValueUpdate),
      multiple: bound(true),
      label: bound('Upload here'),
      accept: bound('image/*'),
      maxSize: bound(1024),
    });
    fixture.detectChanges();

    expect(component.multiple()).toBeTrue();
    expect(component.label()).toBe('Upload here');
    expect(component.accept()).toBe('image/*');
    expect(component.maxSize()).toBe(1024);
  });

  it('should show error and not touch the value if a file exceeds max size', fakeAsync(() => {
    fixture.componentRef.setInput('props', {
      value: bound(undefined, onValueUpdate),
      maxSize: bound(100),
    });
    fixture.detectChanges();

    component.onFileSelected({target: {files: [fileOfSize('test.txt', 1024)]}} as any);
    tick();

    expect(component.uploadState()).toBe('error');
    expect(component.errorMessage()).toContain('exceeds limit');
    expect(onValueUpdate).not.toHaveBeenCalled();
  }));

  it('should write an inline FileReference to the bound value when no upload handler is configured', fakeAsync(() => {
    mockFileReader('data:text/plain;base64,aGVsbG8=');

    component.onFileSelected({target: {files: [fileOfSize('test.txt', 5)]}} as any);
    tick();

    expect(component.uploadState()).toBe('success');
    expect(component.progress()).toBe(100);

    const [reference] = component.uploadedFiles();
    expect(reference.fileId.startsWith(INLINE_URI_PREFIX)).toBeTrue();
    expect(reference.inlineData).toBe('data:text/plain;base64,aGVsbG8=');
    expect(reference.fileName).toBe('test.txt');
    expect(reference.fileSize).toBe(5);
    expect(reference.mimeType).toBe('text/plain');

    // Cleared when the batch starts, then written when it completes.
    expect(onValueUpdate.calls.allArgs()).toEqual([[[]], [[reference]]]);
    // No `action` declared, so nothing is dispatched to the agent.
    expect(mockSurface.dispatchAction).not.toHaveBeenCalled();
  }));

  it('should dispatch the action when the agent declares one', fakeAsync(() => {
    const action = {event: {name: 'files_uploaded', context: {}}};
    fixture.componentRef.setInput('props', {
      value: bound(undefined, onValueUpdate),
      action: bound(action),
    });
    fixture.detectChanges();
    mockFileReader('data:text/plain;base64,aGVsbG8=');

    component.onFileSelected({target: {files: [fileOfSize('test.txt', 5)]}} as any);
    tick();

    expect(mockSurface.dispatchAction).toHaveBeenCalledTimes(1);
    const [dispatched, componentId] = mockSurface.dispatchAction.calls.mostRecent().args;
    expect((dispatched as any).event.name).toBe('files_uploaded');
    expect(componentId).toBe('test-component');
  }));

  it('should enforce single file if multiple is false', fakeAsync(() => {
    mockFileReader('data:text/plain;base64,YXNkZg==');

    component.onFileSelected({
      target: {files: [fileOfSize('a.txt', 1), fileOfSize('b.txt', 1)]},
    } as any);
    tick();

    expect(component.uploadedFiles().length).toBe(1);
    expect(component.uploadedFiles()[0].fileName).toBe('a.txt');
  }));

  it('should remove a file, call onRemoveFile and write the remaining files to the value', fakeAsync(() => {
    mockConfig.onRemoveFile = jasmine.createSpy('onRemoveFile');

    component.uploadedFiles.set([
      {fileId: 'test-uri', fileName: 'test.txt', fileSize: 10, mimeType: 'text/plain'},
    ]);
    component.uploadState.set(UploadState.SUCCESS);

    component.removeFile(0);
    tick();

    expect(component.uploadedFiles().length).toBe(0);
    expect(mockConfig.onRemoveFile).toHaveBeenCalledWith('test-uri');
    expect(component.uploadState()).toBe('idle');
    expect(onValueUpdate).toHaveBeenCalledWith([]);
  }));

  it('should process files on drop', fakeAsync(() => {
    mockFileReader('data:text/plain;base64,ZHJvcA==');

    const mockEvent = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
      dataTransfer: {files: [fileOfSize('drop.txt', 4)]},
    };

    component.onDrop(mockEvent as any);
    tick();

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
    expect(component.uploadedFiles().length).toBe(1);
    expect(component.uploadedFiles()[0].fileName).toBe('drop.txt');
  }));

  it('should use the host upload handler when configured and write its pointer to the value', fakeAsync(() => {
    mockConfig.onUploadFile = jasmine
      .createSpy('onUploadFile')
      .and.callFake(async (file: File, progressCallback: (percent: number) => void) => {
        progressCallback(50);
        progressCallback(100);
        return 'mock-remote-uri://' + file.name;
      });

    component.onFileSelected({target: {files: [fileOfSize('remote.txt', 1024)]}} as any);
    tick();

    expect(mockConfig.onUploadFile).toHaveBeenCalled();
    expect(component.uploadState()).toBe('success');
    expect(component.progress()).toBe(100);

    const [reference] = component.uploadedFiles();
    expect(reference.fileId).toBe('mock-remote-uri://remote.txt');
    expect(reference.inlineData).toBeUndefined();
    expect(onValueUpdate).toHaveBeenCalledWith([reference]);
  }));

  it('should show an error if a file exceeds the inline limit and no upload handler is configured', fakeAsync(() => {
    mockConfig.onUploadFile = undefined;
    mockConfig.maxInlineSize = 10;

    component.onFileSelected({target: {files: [fileOfSize('large.txt', 1024)]}} as any);
    tick();

    expect(component.uploadState()).toBe('error');
    expect(component.errorMessage()).toContain('exceeds inline upload limit');
  }));
});
