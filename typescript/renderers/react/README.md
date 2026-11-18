# @a2ui/react

React renderer for A2UI (Agent-to-User Interface) - enables AI agents to
generate rich, interactive user interfaces through declarative JSON.

## Features

- **Multi-version**: Renders A2UI v0.9, v0.9.1 and v1.0 surfaces from the same package, with improved modularity and type safety.
- **Deep Reactivity**: Powered by the A2UI Generic Binder for automatic, fine-grained updates.
- **Strongly Typed**: Inferred property types from Zod schemas ensure compile-time safety.
- **Extensible**: Easily define custom component catalogs and logic functions.
- **Multi-Surface**: Built-in support for managing independent UI surfaces.

## Installation

```bash
yarn add @a2ui/react @a2ui/web_core
```

## Protocol Versioning

Import the renderer from the package root (`@a2ui/react`) and the
`MessageProcessor` from `@a2ui/web_core`. The processor accepts messages for
every supported protocol version (v0.8, v0.9, v0.9.1 and v1.0).

Only version-specific pieces, such as the basic catalog and its schemas, are
imported from a versioned path:

```typescript
import {A2uiSurface} from '@a2ui/react';
import {MessageProcessor} from '@a2ui/web_core';

// Basic catalog for v1.0:
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
// ...or for v0.9 and v0.9.1:
// import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
```

The `@a2ui/react/v0_9` entry point still works but only re-exports the package
root. `@a2ui/react/v0_8` is the legacy v0.8 renderer.

## Quick Start

The React renderer works alongside the `MessageProcessor` from `@a2ui/web_core`. The processor interprets JSON messages from an AI agent and manages the resulting UI state. The core concepts are:

- **Processor** — receives and interprets the agent's messages.
- **Surface** — an independent rendering area, uniquely identified by a string ID, that the agent creates and populates with components.
- **Catalog** — the set of components (e.g. `Text`, `Column`, `Button`) available for a surface to use.

The example below creates a processor with the `basicCatalog` from `@a2ui/web_core/catalogs/basic/v1`, feeds it a sequence of hardcoded messages, and renders the resulting surface.

```tsx
import {useState, useEffect} from 'react';
import {MessageProcessor} from '@a2ui/web_core';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {A2uiSurface} from '@a2ui/react';

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
    version: '1.0' as const,
    createSurface: {surfaceId: 'main-chat', catalogId: basicCatalog.id},
  },
  {
    version: '1.0' as const,
    updateComponents: {
      surfaceId: 'main-chat',
      components: [
        {id: 'root', component: 'Column', children: ['greeting', 'description']},
        {id: 'greeting', component: 'Text', text: {'@path': '/title'}},
        {id: 'description', component: 'Text', text: {'@path': '/body'}},
      ],
    },
  },
  {
    version: '1.0' as const,
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

- [`createSurface`](../../../specification/v1_0/docs/a2ui_protocol.md#createsurface) initializes the rendering surface.
- [`updateComponents`](../../../specification/v1_0/docs/a2ui_protocol.md#updatecomponents) defines the UI tree. Here, a `Column` containing two `Text` components.
- [`updateDataModel`](../../../specification/v1_0/docs/a2ui_protocol.md#updatedatamodel) provides the data that the components reference via [`@path` bindings](../../../specification/v1_0/docs/a2ui_protocol.md#path-resolution--scope) (e.g. `{ '@path': '/title' }` resolves to the `title` field in the data model).

## Defining Custom Components

A2UI separates a component's API (Schema) from its implementation.

### 1. Define the Component API

Use Zod to define the properties. Using `CommonSchemas` from `@a2ui/web_core/v1_0` (or `@a2ui/web_core/v0_9` for v0.9 catalogs) enables automatic binding for A2UI primitives.

```typescript
import {z} from 'zod';
import {CommonSchemas} from '@a2ui/web_core/v1_0';

export const MyProfileApi = {
  name: 'Profile',
  schema: z.object({
    username: CommonSchemas.DynamicString, // Can be literal "Alice" or {'@path': "/user/name"}
    bio: CommonSchemas.DynamicString,
    avatarUrl: CommonSchemas.DynamicString,
    onEdit: CommonSchemas.Action, // Resolves to a clickable () => void
    isEditable: CommonSchemas.DynamicBoolean,
    // Add 'checks' if you want validation support
    checks: CommonSchemas.Checkable.shape.checks,
  }),
};
```

The API can also restrict where the component appears, with `allowedParents` and `allowedChildren` lists of component names. The message processor then rejects a payload that places the component under another parent with `UNALLOWED_PARENT`, or gives it a child of another type with `UNALLOWED_CHILD`. A root component's parent is `Surface`. Only properties declared with `CommonSchemas.ComponentId` or `CommonSchemas.ChildList` hold children, so an id in a plain `z.string()` property is not checked against `allowedChildren`.

### 2. Create the React Implementation

The `createComponentImplementation` factory uses a **Generic Binder** to resolve all dynamic values before your component renders.

```tsx
import {createComponentImplementation} from '@a2ui/react';

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

### 3. Accessibility

A React component renders inside its own host element, `<a2ui-react-<name>>`. The host maps the component's `accessibility` attributes to ARIA without help from the component. It sets `aria-live` from `live`, and `aria-hidden` and `inert` from `hidden`, on itself. By default it also puts `label` and `description` on itself as `aria-label` and `aria-description`, with `role="group"` unless the host already has a `role`.

If the label belongs on an element inside the component, such as its input, pass `accessibilityRef` to that element. The host then puts `aria-label` and `aria-description` there instead:

```tsx
export const Volume = createComponentImplementation(VolumeApi, ({props, accessibilityRef}) => (
  <input
    ref={accessibilityRef}
    type="range"
    value={props.value ?? 0}
    onChange={e => props.setValue(Number(e.target.value))}
  />
));
```

The `accessibilityRef` element also gets the validation state: `aria-invalid="true"` while a check fails. To make screen readers read the error messages with the element, pass `validationErrorsRef` to the element that shows them. While there are errors, the `accessibilityRef` element gets `aria-describedby` pointing at it, and the element gets an `id` if it has none:

```tsx
export const Email = createComponentImplementation(
  EmailApi,
  ({props, accessibilityRef, validationErrorsRef}) => (
    <div>
      <input
        ref={accessibilityRef}
        value={props.value ?? ''}
        onChange={e => props.setValue(e.target.value)}
      />
      {props.validationErrors?.length ? (
        <div ref={validationErrorsRef}>{props.validationErrors.join(' ')}</div>
      ) : null}
    </div>
  ),
);
```

`createBinderlessComponentImplementation` passes both refs too.

## Generic Binder Features

The Generic Binder is a framework-agnostic engine that transforms raw JSON payload configurations into a cohesive reactive stream of strongly-typed props.

- **Automatic Resolution**: Properties typed as `DynamicString`, `DynamicNumber`, and `DynamicBoolean` are automatically resolved to their current values (strings, numbers, booleans).
- **Two-Way Binding**: If a schema uses a dynamic type (like `DynamicString`), the binder automatically injects a setter. For a property `username`, it adds `props.setUsername(val: string)`, which updates the underlying data model.
- **Action Context**: `Action` properties are resolved into ready-to-call functions. When called, they automatically resolve their deep context bindings (e.g., gathering form data from the model) before notifying the server.
- **Nested Values**: Lists and objects are resolved item by item, so an action, a binding or a child list inside a list item resolves as it does at the top level, and its props are typed so.
- **Reactive Validation**: If your schema includes `checks`, the binder reactively evaluates the rules and injects `props.isValid` and `props.validationErrors` based on the results of the logic functions.

## Binderless Components

For advanced use cases where you need direct access to the `ComponentContext` or want to manage reactivity manually (e.g., for performance-critical animations), use `createBinderlessComponentImplementation`.

```tsx
import {createBinderlessComponentImplementation} from '@a2ui/react';

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
import {Catalog, createFunctionImplementation} from '@a2ui/web_core';
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
  '1.0', // Protocol version the catalog targets
  [MyProfile, RawInspector], // List of ReactComponentImplementation
  [myCheckFunc], // List of FunctionImplementation
);
```

## Basic Catalog Components

`@a2ui/web_core/catalogs/basic/v1` (v1.0) and `@a2ui/web_core/v0_9/basic_catalog` (v0.9 and v0.9.1) each provide a `basicCatalog` with the same standard components. They are W3C Custom Elements, and the React renderer renders them as elements:

- **Layout**: `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`
- **Content**: `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`
- **Input**: `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`

### Markdown in `Text`

`Text` renders its Markdown with a renderer the app provides. Give `MarkdownContext` a function that returns HTML, such as the one from `@a2ui/markdown-it`, or give `MarkdownComponentContext` a React component:

```tsx
import {A2uiSurface, MarkdownComponentContext} from '@a2ui/react';

const ChatMarkdown = ({markdown}: {markdown: string}) => <Markdown text={markdown} />;

<MarkdownComponentContext.Provider value={ChatMarkdown}>
  <A2uiSurface surface={surface} />
</MarkdownComponentContext.Provider>;
```

The component renders inside each `Text`, as part of the app's React tree, so it reads the app's context. When both are given, the component is used. `Text` reads one Markdown renderer for the whole page, so give the component to every `A2uiSurface` on the page or to none.

## Styling and CSS Modules

The basic catalog components are self-contained and styled using CSS variables exposed from `@a2ui/web_core`.

You can use CSS Modules for styling your custom components. Most modern React environments (like Vite, Next.js, and Create React App) support them out of the box. A custom build setup must be configured to handle `.module.css` files, for example with `css-loader` and modules enabled in Webpack.

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

A2UI v0.8 is deprecated and maintained only for backward compatibility. It is available from the `@a2ui/react/v0_8` entry point. New projects should use the package root (`@a2ui/react`), which supports v1.0, v0.9.1, and v0.9 with type-safe binders and logic functions.

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

### Key Differences (v0.8 vs v0.9 and later)

| Feature         | v0.8 (Deprecated)                       | v0.9 and later                                                   |
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

In v0.9 and later, this is handled by the **Generic Binder** before the component even renders, resulting in cleaner, framework-native view code.

## Security

> [!IMPORTANT]
> The sample code provided is for demonstration purposes and illustrates the mechanics of A2UI. When building production applications, it is critical to treat any agent operating outside of your direct control as a potentially untrusted entity.

All operational data received from an external agent—including its messages and UI definitions—should be handled as untrusted input. Malicious agents could attempt to spoof legitimate interfaces to deceive users (phishing), inject malicious scripts via property values (XSS), or generate excessive layout complexity to degrade client performance (DoS). If your application supports optional embedded content (such as iframes or web views), additional care must be taken to prevent exposure to malicious external sites.

**Developer Responsibility**: Failure to properly validate data and strictly sandbox rendered content can introduce severe vulnerabilities. Developers are responsible for implementing appropriate security measures—such as input sanitization, Content Security Policies (CSP), and secure credential handling—to protect their systems and users.

## Development

### Setup

```bash
# In the A2UI monorepo root
yarn install
```

### Build

```bash
yarn build    # Build the package
yarn demo     # Launch the interactive React explorer
```

### Type Check

```bash
yarn typecheck
```

### Lint

```bash
yarn lint
```

## Testing

### Unit Tests

Uses [Vitest](https://vitest.dev/) +
[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/).

```bash
yarn test          # Run typecheck, unit tests, and integration tests
yarn test:unit     # Run unit tests once
yarn test:watch    # Watch mode
```
