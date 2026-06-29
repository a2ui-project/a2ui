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

A2UI supports multiple protocol versions. For new projects, it is recommended to
use the **v0.9** protocol.

To use the v0.9 implementation, import from the versioned path:

```typescript
import {A2uiSurface, basicCatalog} from '@a2ui/lit/v0_9';
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
import {A2uiLitElement, A2uiController} from '@a2ui/lit/v0_9';
import {customElement} from 'lit/decorators.js';
import {html, nothing} from 'lit';
import {MyProfileApi} from './my-profile-api';

@customElement('my-profile')
export class MyProfileElement extends A2uiLitElement<typeof MyProfileApi> {
  protected createController() {
    return new A2uiController(this, MyProfileApi);
  }

  render() {
    const props = this.controller.props;
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

export const myCatalog = new Catalog('https://example.com/catalogs/my-catalog.json', [MyProfile]);
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
You can find the full specification of the basic catalog in the [GitHub repository](https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/catalogs/basic/catalog.json).

- **Layout**: `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`
- **Content**: `Text`, `Image`, `Icon`, `Video`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`

You can find the source code for these components in the [GitHub repository](https://github.com/a2ui-project/a2ui/tree/main/renderers/lit/src/v0_9/catalogs/basic/components).

## Migration from v0.8

If you are migrating an existing application from v0.8 to v0.9, you can reference the migration of the shell sample in [Pull Request #1105](https://github.com/a2ui-project/a2ui/pull/1105) (commit `a5ad0c328628df6fd8f53aef86f5b3db452ba3a8`).

Key changes in that migration included:

- **Header Update in `client.ts`**: You must update the `X-A2A-Extensions` header to request the v0.9 protocol: `https://a2ui.org/a2a-extension/a2ui/v0.9`.
- **Removal of Manual Action Handling in `app.ts`**: In v0.8, applications had to listen for custom action events (like `@a2uiaction`) and manually resolve context paths to build action messages. In v0.9, the `MessageProcessor` and the Generic Binder handle this automatically. You can remove complex event listeners from your templates.
- **CSS-based Basic Catalog Theming**: The Basic Catalog widgets can now be styled
  by overriding CSS variables, like `--a2ui-primary-color`.

**We strongly discourage starting new projects with v0.8.**

## Security

> [!IMPORTANT]
> The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

**Developer Responsibility**: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.
