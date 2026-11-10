# @a2ui/lit

Lit renderer for [A2UI](https://a2ui.org/) (Agent-to-User Interface) - enables
AI agents to generate rich, interactive user interfaces through declarative JSON.

A basic catalog implementation is included to help you get started right away.

Additional custom components can be defined with type-safe properties inferred
from [Zod](https://zod.dev) schemas, and can be added to your own custom catalogs
for total control over the generated code.

## Installation

```bash
yarn add @a2ui/lit @a2ui/web_core
```

## Protocol Versioning

`@a2ui/lit` supports protocol versions **v1.0**, **v0.9.1**, and **v0.9** (legacy v0.8 is no longer supported).

Surface rendering primitives (`A2uiSurface`, `A2uiLitElement`, `A2uiController`, `Context`, and `renderA2uiNode`) are exported from `@a2ui/lit`. For v0.9 and v0.9.1 applications, import `basicCatalog` from `@a2ui/lit/v0_9`:

```typescript
import {A2uiSurface} from '@a2ui/lit';
import {basicCatalog} from '@a2ui/lit/v0_9';
```

## Quick Start

The Lit renderer works alongside the `MessageProcessor` from `@a2ui/web_core`.

```typescript
import {LitElement, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/lit/v0_9';

@customElement('my-app')
export class MyApp extends LitElement {
  private processor = new MessageProcessor([basicCatalog]);

  @state()
  private surface: any;

  connectedCallback() {
    super.connectedCallback();

    // Listen for surface creation
    this.processor.onSurfaceCreated(s => {
      if (s.id === 'main-chat') {
        this.surface = s;
      }
    });

    // The message objects should come from your agent
    this.processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'main-chat',
          catalogId: basicCatalog.id,
        },
      },
    ]);
  }

  render() {
    return html`
      <div class="a2ui-container">
        ${this.surface
          ? html`<a2ui-surface .surface=${this.surface}></a2ui-surface>`
          : html`<div>Initializing Agent UI...</div>`}
      </div>
    `;
  }
}
```

## Defining Custom Components

A2UI v0.9 separates a component's API (Schema) from its implementation.

### 1. Define the Component API

Use Zod to define the properties.

```typescript
import {z} from 'zod';
import {CommonSchemas} from '@a2ui/web_core/v0_9';

export const MyProfileApi = {
  name: 'Profile',
  schema: z.object({
    username: CommonSchemas.DynamicString,
    bio: CommonSchemas.DynamicString,
    onEdit: CommonSchemas.Action,
  }),
};
```

### 2. Create the Lit Implementation

Extend `A2uiLitElement` and implement `createController` and `render`.

```typescript
import {A2uiLitElement} from '@a2ui/lit/v0_9';
import {customElement} from 'lit/decorators.js';
import {html, nothing} from 'lit';
import {MyProfileApi} from './my-profile-api';

@customElement('my-profile')
export class MyProfileElement extends A2uiLitElement<typeof MyProfileApi> {
  protected readonly api = MyProfileApi;

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    return html`
      <div class="profile-widget">
        <h2>${props.username}</h2>
        <p>${props.bio}</p>
        <button @click=${props.onEdit}>Edit</button>
      </div>
    `;
  }
}

// Export the catalog entry
export const MyProfile = {
  ...MyProfileApi,
  tagName: 'my-profile',
};
```

### 3. Define the Catalog

Group your custom components into a `Catalog` from `@a2ui/web_core/v0_9`.

```typescript
import {Catalog} from '@a2ui/web_core/v0_9';
import {MyProfile} from './my-profile';

export const myCatalog = new Catalog('https://example.com/catalogs/my-catalog.json', 'v0.9', [
  MyProfile,
]);
```

### 4. Use the Custom Catalog

Pass your custom catalog to the `MessageProcessor` alongside the basic catalog
in your app setup (as seen in the Quick Start).

```typescript
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {myCatalog} from './my-catalog';

// Initialize the MessageProcessor with both catalogs
const processor = new MessageProcessor([basicCatalog, myCatalog]);
```

## Basic Catalog Components

The `@a2ui/lit/v0_9` package includes a `basicCatalog` with standard components.
You can find the full specification of the basic catalog in the [GitHub repository](../../../specification/v0_9/catalogs/basic/catalog.json).

- **Layout**: `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`
- **Content**: `Text`, `Image`, `Icon`, `Video`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`

The standard basic catalog components are implemented as framework-agnostic universal Custom Elements in `@a2ui/web_core` ([source code on GitHub](../../core/web_core/src/v0_9/basic_catalog/components)) and re-exported from `@a2ui/lit/v0_9` for backwards compatibility.

## Migrating from v0.8 (Removed)

The legacy v0.8 adapter (`@a2ui/lit/0.8`, `@a2ui/lit/v0_8`, `@a2ui/lit/ui`, and the `v0_8` root namespace) has been removed. To migrate an existing v0.8 Lit application to v0.9 or v1.0, see the [v0.8 to v0.9 Evolution Guide](../../../specification/v0_9/docs/evolution_guide.md), the [v0.9.1 to v1.0 Evolution Guide](../../../specification/v1_0/docs/evolution_guide.md), and the shell sample migration in [Pull Request #1105](https://github.com/a2ui-project/a2ui/pull/1105):

- **Extension Header**: Request the target protocol version in `X-A2A-Extensions` (for example, `https://a2ui.org/a2a-extension/a2ui/v0.9` or `https://a2ui.org/a2a-extension/a2ui/v1.0`).
- **Action Handling via `MessageProcessor`**: Replace manual `@a2uiaction` DOM event listeners with the action handler callback on `MessageProcessor` from `@a2ui/web_core`.
- **CSS Custom Property Theming**: Replace v0.8 JS theme class maps with `--a2ui-*` CSS custom properties (such as `--a2ui-color-primary`).

## Security

> [!IMPORTANT]
> The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

**Developer Responsibility**: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.
