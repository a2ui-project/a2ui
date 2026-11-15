# @a2ui/lit

Lit renderer for [A2UI](https://a2ui.org/) (Agent-to-User Interface) - enables
AI agents to generate rich, interactive user interfaces through declarative JSON.

A basic catalog implementation is included to help you get started right away.

Additional custom components are defined with JSON Schema (or any Standard
Schema that implements Standard JSON Schema, such as the zod 4 helpers of
`@a2ui/schema-zod4`), and can be added to your own custom catalogs for total
control over the generated code.

## Installation

```bash
yarn add @a2ui/lit @a2ui/web_core @a2ui/validator-ajv
```

`@a2ui/web_core` validates messages and component properties against the
specification's JSON Schemas with a `JsonSchemaValidator` that the application
passes in, such as `createAjvValidator()` from `@a2ui/validator-ajv`. `@a2ui/lit`
has no default validator.

## Protocol Versioning

A2UI supports multiple protocol versions. For new projects, use the **v1.0**
protocol: import the renderer from the package root (`@a2ui/lit`), the
`MessageProcessor` from `@a2ui/web_core`, and the basic catalog for your
target protocol version:

```typescript
import {A2uiSurface} from '@a2ui/lit';
import {MessageProcessor} from '@a2ui/web_core';

// Basic catalog for v1.0:
import {createBasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
// ...or for v0.9 and v0.9.1:
// import {createBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
```

The `@a2ui/lit/v0_9` entry point remains available for backward compatibility. Its
`createBasicCatalog(validator)` adds the legacy 0.9.x functions (`add`, `equals`, ...)
to web_core's v0.9 basic catalog. The v0.8 `Data.createSignalA2uiMessageProcessor({validator})`
takes the validator too.

## Quick Start

The Lit renderer works alongside the `MessageProcessor` from `@a2ui/web_core`.

```typescript
import {LitElement, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {MessageProcessor} from '@a2ui/web_core';
import {createBasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {createAjvValidator} from '@a2ui/validator-ajv';
import {A2uiSurface} from '@a2ui/lit';

const validator = createAjvValidator();
const basicCatalog = createBasicCatalog(validator);

@customElement('my-app')
export class MyApp extends LitElement {
  private processor = new MessageProcessor([basicCatalog], undefined, {validator});

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
        version: '1.0',
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

A2UI separates a component's API (Schema) from its implementation.

### 1. Define the Component API

The schema is a `CatalogSchema`. The zod 4 helpers of `@a2ui/schema-zod4` write
the common types (`DynamicString`, `Action`, `ChildList`, ...) as `$ref`s into the
protocol's `common_types.json`, which is how web_core finds bindings and child
references:

```typescript
import {component, DynamicString, Action} from '@a2ui/schema-zod4';

export const MyProfileApi = {
  name: 'Profile',
  schema: component({
    username: DynamicString,
    bio: DynamicString,
    onEdit: Action,
  }),
};
```

A schema without common types can be plain JSON Schema compiled with
`fromJsonSchema(json, validator)` from `@a2ui/web_core`. Components defined in a
catalog document are loaded with `Catalog.fromJson(document, version, catalogId, {validator})`
(see the explorer's `a2ui_explorer/src/demo-components.ts`).

### 2. Create the Lit Implementation

Extend `A2uiLitElement` and implement `render`.

```typescript
import {A2uiLitElement} from '@a2ui/lit';
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
  element: MyProfileElement,
};
```

### 3. Define the Catalog

Group your custom components into a `Catalog` from `@a2ui/web_core`.

```typescript
import {Catalog} from '@a2ui/web_core';
import {MyProfile} from './my-profile';

export const myCatalog = new Catalog('https://example.com/catalogs/my-catalog.json', '1.0', [
  MyProfile,
]);
```

### 4. Use the Custom Catalog

Pass your custom catalog to the `MessageProcessor` alongside the basic catalog
in your app setup (as seen in the Quick Start).

```typescript
import {MessageProcessor} from '@a2ui/web_core';
import {createBasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {createAjvValidator} from '@a2ui/validator-ajv';
import {myCatalog} from './my-catalog';

// Initialize the MessageProcessor with both catalogs
const validator = createAjvValidator();
const processor = new MessageProcessor([createBasicCatalog(validator), myCatalog], undefined, {
  validator,
});
```

## Basic Catalog Components

`@a2ui/web_core/catalogs/basic/v1` (v1.0) and `@a2ui/web_core/v0_9/basic_catalog` (v0.9 and v0.9.1) each provide a `createBasicCatalog(validator)` factory for the catalog of standard components.
You can find the full specification of the basic catalog in the [GitHub repository](../../../catalogs/basic/v1/catalog.json).

- **Layout**: `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`
- **Content**: `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`

The standard basic catalog components are implemented as framework-agnostic universal Custom Elements in `@a2ui/web_core` ([source code on GitHub](../../core/web_core/src/universal/basic_catalog/components)).

## Migration from v0.8

If you are migrating an existing application from v0.8 to v0.9, you can reference the migration of the shell sample in [Pull Request #1105](https://github.com/a2ui-project/a2ui/pull/1105) (commit `a5ad0c328628df6fd8f53aef86f5b3db452ba3a8`).

Key changes in that migration included:

- **Header Update in `client.ts`**: You must update the `X-A2A-Extensions` header to request the v0.9 protocol: `https://a2ui.org/a2a-extension/a2ui/v0.9`.
- **Removal of Manual Action Handling in `app.ts`**: In v0.8, applications had to listen for custom action events (like `@a2uiaction`) and manually resolve context paths to build action messages. In v0.9, the `MessageProcessor` and the Generic Binder handle this automatically. You can remove complex event listeners from your templates.
- **CSS-based Basic Catalog Theming**: The Basic Catalog widgets can now be styled
  by overriding CSS variables, like `--a2ui-color-primary`.

**We strongly discourage starting new projects with v0.8.**

## Security

> [!IMPORTANT]
> The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI and the Agent-to-Agent (A2A) protocol. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its AgentCard, messages, artifacts, and task statuses—should be handled as untrusted input. For example, a malicious agent could provide crafted data in its fields (e.g., name, skills.description) that, if used without sanitization to construct prompts for a Large Language Model (LLM), could expose your application to prompt injection attacks.

Similarly, any UI definition or data stream received must be treated as untrusted. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

**Developer Responsibility**: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), strict isolation for optional embedded content, and secure credential handling—to protect their systems and users.
