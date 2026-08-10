# A2UI Composer Integration Manual

## Background

The A2UI Composer has no knowledge or integration with any particular catalog or
renderer stack. In order to see the A2UI JSON rendered, it relies on a “Renderer
Application.” The A2UI Composer hosts the Renderer Application in an iframe and
communicates with it via **postMessage**. The iframe hosting the renderer
application has `sandbox='allow-scripts allow-same-origin allow-forms'`, which
should not be a problem for simply rendering the A2UI JSON.

The Renderer Application is responsible for accepting A2UI JSON and using its
renderers to display the result.

## The Bridge

To simplify the work of integrating with the A2UI Composer, a **bridge** has
been created. This is a small amount of Javascript code that the Renderer
Application incorporates, and coordinates all the communication between the A2UI
Composer and the Renderer Application.

To further simplify the integration, different framework-specific wrappers are
provided.

## Examples

Check out the sample renderer apps:

- [Angular](https://github.com/a2ui-project/composer/tree/main/samples/ng-basic-catalog)
- [Lit](https://github.com/a2ui-project/composer/tree/main/samples/lit-basic-catalog)
- [React](https://github.com/a2ui-project/composer/tree/main/samples/react-basic-catalog)

They all serve the same version of the Basic catalog.

When running the hosted [A2UI Composer](https://a2ui-project.github.io/composer/),
you can see each of these renderer applications in action by going to the
Settings page and clicking the Renderer dropdown.

### Using Angular

As an example, we'll walk through creating a Renderer application based on
Angular.

### Add dependencies

First, add the core integration package to your project dependencies list:

```
yarn add a2ui-bridge @a2ui/web_core @a2ui/angular
```

Of course, if you’re using a different package manager, follow the appropriate
steps.

#### Create the wrapper component

Create a new component that looks like this:

```ts
import {Component, inject} from '@angular/core';
import {SurfaceComponent} from '@a2ui/angular/v0_9';
import {A2uiSandboxConnection} from 'a2ui-bridge/angular';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SurfaceComponent],
  template: `
    <main class="sandbox-shell">
      @if (sandbox.surfaceId()) {
        <a2ui-v09-surface [surfaceId]="sandbox.surfaceId()" />
      } @else {
        <p style="padding: 24px; color: #666; font-family: sans-serif; text-align: center;">
          Waiting for RENDER_A2UI payloads...
        </p>
      }
    </main>
  `,
})
export class AppComponent {
  protected sandbox = inject(A2uiSandboxConnection);
}
```

Note that contents of the `@else` can be modified as you see fit, but the rest
of the template should remain as-is.

#### Bootstrap your renderer application

Configure the standard Angular bootstrapping entrypoint file (`src/main.ts`),
passing your catalog classes dynamically to the sandbox provider mapping:

```ts
import {bootstrapApplication} from '@angular/platform-browser';
import {AppComponent} from './app/app.component';
import {provideA2uiSandbox} from 'a2ui-bridge/angular';
import {BasicCatalog} from '@a2ui/angular/v0_9';

bootstrapApplication(AppComponent, {
  providers: [
    provideA2uiSandbox([BasicCatalog]), // Injects and exposes dynamic catalogs
  ],
}).catch((err) => console.error('A2UI Sandbox Bootstrap Failed:', err));
```

Make sure to replace `BasicCatalog` with your catalog.

> NOTE on change detection compatibility: The `provideA2uiSandbox` helper is
> 100% compatible with both standard Zone-based change detection (using `zone.js`)
> and Zoneless change detection (`provideZonelessChangeDetection()`)
> out-of-the-box.
