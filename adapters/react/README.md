# @a2ui/react

React renderer for A2UI (Agent-to-User Interface) - enables AI agents to
generate rich, interactive user interfaces through declarative JSON.

## Features

- **v0.9 Native**: Built specifically for the A2UI v0.9 protocol with improved modularity and type safety.
- **Deep Reactivity**: Powered by the A2UI Generic Binder for automatic, fine-grained updates.
- **Strongly Typed**: Inferred property types from Zod schemas ensure compile-time safety.
- **Extensible**: Easily define custom component catalogs and logic functions.
- **Multi-Surface**: Built-in support for managing independent UI surfaces.

## Installation

```bash
npm install @a2ui/react @a2ui/web_core
```

## Protocol Versioning

A2UI supports multiple protocol versions to ensure backward compatibility. For new projects, it is recommended to use the **v0.9** protocol.

To use the v0.9 implementation, import from the versioned path:

```typescript
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';
```

## Quick Start

The React renderer works alongside the `MessageProcessor` from `@a2ui/web_core`. The processor interprets JSON messages from an AI agent and manages the resulting UI state. The core concepts are:

- **Processor** — receives and interprets the agent's messages.
- **Surface** — an independent rendering area, uniquely identified by a string ID, that the agent creates and populates with components.
- **Catalog** — the set of components (e.g. `Text`, `Column`, `Button`) available for a surface to use.

The example below creates a processor with the built-in `basicCatalog`, feeds it a sequence of hardcoded messages, and renders the resulting surface.

```tsx
import {useState, useEffect} from 'react';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {A2uiSurface, basicCatalog} from '@a2ui/react/v0_9';

export default function App() {
  // 1. Create the processor and feed it messages.
  const [processor] = useState(() => {
    const p = new MessageProcessor([basicCatalog]);
    p.processMessages(sampleAgentMessages);
    return p;
  });

  // 2. Set up listeners to keep the UI up to date as messages arrive.
  const [surfaces, setSurfaces] = useState(() => Array.from(processor.model.surfacesMap.values()));
  useEffect(() => {
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));

    const createdSub = processor.onSurfaceCreated(sync);
    const deletedSub = processor.onSurfaceDeleted(sync);

    return () => {
      createdSub.unsubscribe();
      deletedSub.unsubscribe();
    };
  }, [processor]);

  // 3. Render every surface the agent has created.
  return (
    <div className="a2ui-container">
      {surfaces.length === 0 && <div>Waiting for agent...</div>}
      {surfaces.map(surface => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  );
}

// In a real app, these messages would come from an agent via WebSocket, SSE, etc.
// Here we hardcode them to show the message format.
const sampleAgentMessages = [
  {
    version: 'v0.9' as const,
    createSurface: {surfaceId: 'main-chat', catalogId: basicCatalog.id},
  },
  {
    version: 'v0.9' as const,
    updateComponents: {
      surfaceId: 'main-chat',
      components: [
        {id: 'root', component: 'Column', children: ['greeting', 'description']},
        {id: 'greeting', component: 'Text', text: {path: '/title'}},
        {id: 'description', component: 'Text', text: {path: '/body'}},
      ],
    },
  },
  {
    version: 'v0.9' as const,
    updateDataModel: {
      surfaceId: 'main-chat',
      path: '/',
      value: {
        title: 'Hello from A2UI!',
        body: 'Replace these messages with real agent responses to build interactive UIs.',
      },
    },
  },
];
```

Running this example should display "Hello from A2UI!". The example demonstrates three message types:

- [`createSurface`](../../specification/v0_9/docs/a2ui_protocol.md#createsurface) initializes the rendering surface.
- [`updateComponents`](../../specification/v0_9/docs/a2ui_protocol.md#updatecomponents) defines the UI tree. Here, a `Column` containing two `Text` components.
- [`updateDataModel`](../../specification/v0_9/docs/a2ui_protocol.md#updatedatamodel) provides the data that the components reference via [`path` bindings](../../specification/v0_9/docs/a2ui_protocol.md#path-resolution--scope) (e.g. `{ path: '/title' }` resolves to the `title` field in the data model).

## Defining Custom Components

A2UI v0.9 strictly separates a component's API (Schema) from its implementation.

### 1. Define the Component API

Use Zod to define the properties. Using `CommonSchemas` from `web_core` enables automatic binding for A2UI primitives.

```typescript
import {z} from 'zod';
import {CommonSchemas} from '@a2ui/web_core/v0_9';

export const MyProfileApi = {
  name: 'Profile',
  schema: z.object({
    username: CommonSchemas.DynamicString, // Can be literal "Alice" or {path: "/user/name"}
    bio: CommonSchemas.DynamicString,
    avatarUrl: CommonSchemas.DynamicString,
    onEdit: CommonSchemas.Action, // Resolves to a clickable () => void
    isEditable: CommonSchemas.DynamicBoolean,
    // Add 'checks' if you want validation support (standard in v0.9 interactive components)
    checks: CommonSchemas.Checkable.shape.checks,
  }),
};
```

### 2. Create the React Implementation

The `createComponentImplementation` factory uses a **Generic Binder** to resolve all dynamic values before your component renders.

```tsx
import {createComponentImplementation} from '@a2ui/react/v0_9';

export const MyProfile = createComponentImplementation(MyProfileApi, ({props, buildChild}) => {
  // 'props' is strictly inferred from the Zod schema:
  // props.username is 'string' (resolved from DynamicString)
  // props.onEdit is '() => void' (resolved from Action)

  return (
    <div className="profile-widget">
      <img src={props.avatarUrl ?? ''} alt={props.username} />
      <h2>{props.username}</h2>
      <p>{props.bio}</p>

      {props.isEditable && (
        <button onClick={props.onEdit} disabled={props.isValid === false}>
          Edit Profile
        </button>
      )}

      {/* Render validation errors if any check fails */}
      {props.validationErrors?.map((err, i) => (
        <div key={i} className="error-hint" style={{color: 'red'}}>
          {err}
        </div>
      ))}
    </div>
  );
});
```

## Generic Binder Features

The Generic Binder is a framework-agnostic engine that transforms raw JSON payload configurations into a cohesive reactive stream of strongly-typed props.

- **Automatic Resolution**: Properties typed as `DynamicString`, `DynamicNumber`, and `DynamicBoolean` are automatically resolved to their current values (strings, numbers, booleans).
- **Two-Way Binding**: If a schema uses a dynamic type (like `DynamicString`), the binder automatically injects a setter. For a property `username`, it adds `props.setUsername(val: string)`, which updates the underlying data model.
- **Action Context**: `Action` properties are resolved into ready-to-call functions. When called, they automatically resolve their deep context bindings (e.g., gathering form data from the model) before notifying the server.
- **Reactive Validation**: If your schema includes `checks`, the binder reactively evaluates the rules and injects `props.isValid` and `props.validationErrors` based on the results of the logic functions.

## Binderless Components

For advanced use cases where you need direct access to the `ComponentContext` or want to manage reactivity manually (e.g., for performance-critical animations), use `createBinderlessComponentImplementation`.

```tsx
import {createBinderlessComponentImplementation} from '@a2ui/react/v0_9';

export const RawInspector = createBinderlessComponentImplementation(InspectorApi, ({context}) => {
  // Access the raw, unresolved component model and the data model directly
  const rawData = context.componentModel.properties;
  const componentId = context.componentModel.id;

  return (
    <details>
      <summary>Raw Component State (ID: {componentId})</summary>
      <pre>{JSON.stringify(rawData, null, 2)}</pre>
    </details>
  );
});
```

## Defining Catalogs and Functions

Group your components and logic functions into a `Catalog` to be used by the `MessageProcessor`.

```typescript
import {Catalog, createFunctionImplementation} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

// 1. Implement a custom logic function
const myCheckFunc = createFunctionImplementation(
  {
    name: 'is_admin',
    returnType: 'boolean',
    schema: z.object({role: z.string()}),
  },
  args => args.role === 'admin',
);

// 2. Compose the catalog
export const myCatalog = new Catalog(
  'https://example.com/catalogs/v1.json',
  [MyProfile, RawInspector], // List of ReactComponentImplementation
  [myCheckFunc], // List of FunctionImplementation
);
```

## Basic Catalog Components

The `@a2ui/react/v0_9` package includes a `basicCatalog` with standard components:

- **Layout**: `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`
- **Content**: `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`

## Styling and CSS Modules

The basic catalog components are designed to be self-contained and styled using CSS variables exposed from `@a2ui/web_core`.

Some components in this package (like `Text`) use **CSS Modules** for style encapsulation. Most modern React environments (like Vite, Next.js, and Create React App) support CSS Modules out of the box. If you are using a custom build setup, you must ensure it is configured to handle `.module.css` files (e.g., using `css-loader` with modules enabled in Webpack).

You can also use CSS Modules for styling your custom components or extending the basic catalog:

```css
/* MyComponent.module.css */
.myComponent {
  display: flex;
  gap: var(--a2ui-spacing-m, 8px);
}

/* Use :global to target nested elements (like those generated by Markdown) */
.myComponent :global(p) {
  color: var(--a2ui-color-on-background);
}
```

```tsx
import styles from './MyComponent.module.css';

export const MyComponent = createComponentImplementation(MyComponentApi, ({props}) => {
  return <div className={styles.myComponent}>{/* ... */}</div>;
});
```

---

## Legacy Support (v0.8)

A2UI v0.8 is maintained for backward compatibility. While it remains the default export for the `@a2ui/react` package, it is recommended to transition to v0.9 for new features like type-safe binders and logic functions.

### Import and Usage

To use the v0.8 renderer, you use the `A2UIProvider` and `A2UIRenderer` components:

```tsx
import {A2UIProvider, A2UIRenderer, injectStyles} from '@a2ui/react/v0_8';

// Inject v0.8 styles
injectStyles();

function LegacyApp() {
  const handleAction = msg => console.log('Action:', msg);

  return (
    <A2UIProvider onAction={handleAction}>
      {/* Renders the surface using v0.8 logic */}
      <A2UIRenderer surfaceId="main" />
    </A2UIProvider>
  );
}
```

### Key Differences (v0.8 vs v0.9)

| Feature         | v0.8 (Legacy)                           | v0.9 (Current)                                                   |
| :-------------- | :-------------------------------------- | :--------------------------------------------------------------- |
| **Protocol**    | Uses `BeginRendering`, `SurfaceUpdate`. | Uses `createSurface`, `updateComponents`, `updateDataModel`.     |
| **Data Flow**   | Unidirectional surface updates.         | Bidirectional synchronization (`sendDataModel`).                 |
| **Type Safety** | Props accessed via `node.properties`.   | Strongly typed `props` inferred from Zod schemas.                |
| **Logic**       | Limited client-side logic.              | Extensible `Function` system (e.g., `formatString`, `required`). |
| **Reactivity**  | Hooks-based (`useA2UIComponent`).       | Automatic via the **Generic Binder** middleware.                 |
| **Binding**     | Manual resolution in component body.    | Declarative two-way binding with injected setters.               |

In v0.8, components are responsible for resolving their own dynamic values using hooks:

```tsx
// v0.8 Manual Resolution
function TextField({node, surfaceId}) {
  const {resolveString, setValue} = useA2UIComponent(node, surfaceId);
  const label = resolveString(node.properties.label);
  // ...
}
```

In v0.9, this is handled by the **Generic Binder** before the component even renders, resulting in cleaner, framework-native view code.

## Security

> [!IMPORTANT]
> The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its messages and UI definitions—should be handled as untrusted input. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

**Developer Responsibility**: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), and secure credential handling—to protect their systems and users.
