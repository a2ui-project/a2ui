# A2UI Angular Renderer

The Angular implementation of the A2UI framework, providing seamless integration of agent-generated UI into Angular applications.

## Features

- **Reactive Rendering**: Uses Angular Signals for efficient, fine-grained UI updates.
- **Dynamic Component Resolution**: Maps A2UI component types to Angular components via extensible catalogs.
- **Surface Management**: Built-in support for multiple independent UI surfaces within a single session.
- **Action Handling**: Simple callback-based integration for handling agent-dispatched actions.

## Installation

```bash
npm install @a2ui/angular @a2ui/web_core
```

## Protocol Versioning

A2UI supports multiple protocol versions to ensure backward compatibility as the framework evolves. For new projects, it is recommended to use the **v0.9** protocol.

To use the v0.9 implementation, import from the versioned path:

```typescript
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from '@a2ui/angular/v0_9';
import {BasicCatalog} from '@a2ui/angular/v0_9';
```

## Basic Setup

Configure the renderer in your `app.config.ts` using the `A2UI_RENDER_CONFIG` injection token:

```typescript
import {ApplicationConfig} from '@angular/core';
import {A2UI_RENDERER_CONFIG, A2uiRendererService, BasicCatalog} from '@a2ui/angular/v0_9';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: A2UI_RENDERER_CONFIG,
      useValue: {
        catalogs: [new BasicCatalog()],
        actionHandler: action => {
          console.log('Action received:', action);
        },
      },
    },
    A2uiRendererService,
  ],
};
```

## Usage

### Rendering a Surface

The simplest way to render an A2UI surface is using the `SurfaceComponent`. This component handles setting up the root `ComponentHost` for you.

```typescript
import {Component} from '@angular/core';
import {SurfaceComponent} from '@a2ui/angular/v0_9';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SurfaceComponent],
  template: ` <a2ui-v09-surface surfaceId="main-surface" /> `,
})
export class AppComponent {}
```

### Dynamic Component Hosting

For more fine-grained control, use the `ComponentHostComponent` to render specific components within a surface:

```typescript
import {Component} from '@angular/core';
import {ComponentHostComponent} from '@a2ui/angular/v0_9';

@Component({
  selector: 'app-custom-layout',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <div class="user-sidebar">
      <a2ui-v09-component-host surfaceId="main-surface" componentId="sidebar-config" />
    </div>
  `,
})
export class CustomLayoutComponent {}
```

## Core Service: `A2uiRendererService`

The `A2uiRendererService` is the heart of the Angular renderer. It bridges the A2UI `MessageProcessor` to Angular's reactive system.

- **`processMessages(messages: Message[])`**: Ingest messages from the agent to update the UI surfaces.
- **`surfaceGroup()`**: Returns the `SurfaceGroupModel` containing the current state of all surfaces.

## Basic Catalog Components

The `@a2ui/angular/v0_9` package includes a `BasicCatalog` with the following standard components:

- **Layout**: `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`
- **Content**: `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`

## Security

> [!IMPORTANT]
> The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

**Developer Responsibility**: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.
