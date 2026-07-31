/*
 * Copyright 2026 Google LLC
 */

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {Image} from './image';
import {MessageProcessor} from '../data/processor';
import {Theme} from '../rendering/theming';
import {Catalog} from '../rendering/catalog';
import {By} from '@angular/platform-browser';

describe('Image Component', () => {
  let component: Image;
  let fixture: ComponentFixture<Image>;
  let mockTheme: Theme;

  beforeEach(async () => {
    mockTheme = new Theme();
    mockTheme.components = {
      Image: {
        all: {'image-all-class': true},
        Avatar: {'image-avatar-class': true},
      },
    } as any;

    await TestBed.configureTestingModule({
      imports: [Image],
      providers: [
        {provide: MessageProcessor, useValue: {resolvePrimitive: (p: any) => p?.value || p}},
        {provide: Theme, useValue: mockTheme},
        {provide: Catalog, useValue: {}},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Image);
    component = fixture.componentInstance;

    // Set required inputs
    fixture.componentRef.setInput('surfaceId', 'surf-1');
    fixture.componentRef.setInput('component', {id: 'img-1', type: 'Image', weight: 1});
    fixture.componentRef.setInput('weight', 1);
    fixture.componentRef.setInput('usageHint', null);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render <img> if url is provided', () => {
    fixture.componentRef.setInput('url', {literalString: 'http://example.com/a.png'});
    fixture.detectChanges();

    const imgEl = fixture.debugElement.query(By.css('img'));
    expect(imgEl).toBeTruthy();
    expect(imgEl.nativeElement.src).toBe('http://example.com/a.png');
    expect(imgEl.nativeElement.alt).toBe('');

    const sectionEl = fixture.debugElement.query(By.css('section'));
    expect(sectionEl.nativeElement.className).toContain('image-all-class');
  });

  it('should render <img> with altText if provided', () => {
    fixture.componentRef.setInput('url', {literalString: 'http://example.com/a.png'});
    fixture.componentRef.setInput('altText', {literalString: 'A beautiful sunset'});
    fixture.detectChanges();

    const imgEl = fixture.debugElement.query(By.css('img'));
    expect(imgEl).toBeTruthy();
    expect(imgEl.nativeElement.alt).toBe('A beautiful sunset');
  });

  it('should NOT render <img> if url is null', () => {
    fixture.componentRef.setInput('usageHint', null);
    fixture.detectChanges();

    const imgEl = fixture.debugElement.query(By.css('img'));
    expect(imgEl).toBeFalsy();
  });

  it('should apply usageHint class if provided', () => {
    fixture.componentRef.setInput('url', {literalString: 'http://example.com/a.png'});
    fixture.componentRef.setInput('usageHint', 'Avatar');
    fixture.detectChanges();

    const sectionEl = fixture.debugElement.query(By.css('section'));
    expect(sectionEl.nativeElement.className).toContain('image-avatar-class');
  });
});
