import {Injectable, signal} from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class FileUploadSettingsService {
  readonly enableMultiFile = signal(false);
}
