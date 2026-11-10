# How to Restrict URLs with a URL Security Policy

> Limit which hosts A2UI components and functions may load, open, or embed, mark URL properties on custom components, and check URLs that custom code builds.

Canonical URL: https://a2ui.org/guides/url-security/

A URL security policy decides which URLs the components and functions on a [surface](/concepts/glossary/#surface) may load, open, or embed, so an agent can't make your app contact a host you didn't approve.

A renderer acts on URLs that an agent supplies: `Image`, `Video`, and `AudioPlayer` fetch their URL as soon as they render, and `openUrl` opens a page after a click. An agent that has been prompt-injected can put data from the [data model](/concepts/glossary/#data-model) into such a URL (for example `https://attacker.example/?d=<secret>`), and the renderer sends it to that host. Without a policy, every SDK checks only the URL scheme. With one, you list the hosts each kind of URL may point to, and the renderer drops everything else before a request is made.

> **Note**
  The policy is available in the TypeScript core SDK, `@a2ui/web_core`. Python, Dart, and Swift
  support is in progress; see [SDK availability](#sdk-availability). Code on this page uses
  `@a2ui/web_core`.

## Step 1: Set a policy on the message processor

Pass a policy as the `urlSecurityPolicy` option of the [`MessageProcessor`](/concepts/glossary/#messageprocessor). The processor gives it to every surface it creates, and there is one policy per processor. `AllowlistUrlSecurityPolicy` takes a list of allowed hosts for each URL context:

#### Lit

```ts
import type {LitComponentApi} from '@a2ui/lit';
import {AllowlistUrlSecurityPolicy} from '@a2ui/web_core';
import {type ActionPayload, MessageProcessor, basicCatalog} from '@a2ui/web_core/v1_0';

export class AgentSession {
  readonly processor = new MessageProcessor<LitComponentApi>(
    [basicCatalog],
    (action: ActionPayload) => void this.sendToAgent({version: '1.0', action}),
    {
      urlSecurityPolicy: new AllowlistUrlSecurityPolicy({
        media: ['cdn.example.com', '*.googleusercontent.com'],
        navigation: ['*.example.com'],
        iframe: ['apps.example.com'],
      }),
    },
  );
}
```

#### React

```ts
import type {ReactCatalogComponent} from '@a2ui/react';
import {AllowlistUrlSecurityPolicy} from '@a2ui/web_core';
import {type ActionPayload, MessageProcessor, basicCatalog} from '@a2ui/web_core/v1_0';

export class AgentSession {
  readonly processor = new MessageProcessor<ReactCatalogComponent>(
    [basicCatalog],
    (action: ActionPayload) => void this.sendToAgent({version: '1.0', action}),
    {
      urlSecurityPolicy: new AllowlistUrlSecurityPolicy({
        media: ['cdn.example.com', '*.googleusercontent.com'],
        navigation: ['*.example.com'],
        iframe: ['apps.example.com'],
      }),
    },
  );
}
```

#### Angular

```ts
import {ApplicationConfig} from '@angular/core';
import {BasicCatalog, provideA2UI} from '@a2ui/angular';
import {AllowlistUrlSecurityPolicy} from '@a2ui/web_core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideA2UI({
      catalogs: [new BasicCatalog()],
      processorOptions: {
        urlSecurityPolicy: new AllowlistUrlSecurityPolicy({
          media: ['cdn.example.com', '*.googleusercontent.com'],
          navigation: ['*.example.com'],
          iframe: ['apps.example.com'],
        }),
      },
    }),
  ],
};
```

That one option covers the [basic catalog](/concepts/glossary/#basic-catalog): `Image.url`, `Video.url`, `Video.posterUrl`, `AudioPlayer.url`, and the theme's `iconUrl` are checked as `media`, and `openUrl` checks its URL as `navigation`. A blocked URL resolves to no value, so a media component shows its empty state without making a request, and the policy never substitutes a placeholder such as `about:blank`.

Leaving `urlSecurityPolicy` unset means `PermissiveUrlSecurityPolicy`, which applies only the [baseline](#url-contexts-and-the-baseline) checks every policy runs.

## Step 2: Mark URL properties on custom components

A custom component whose property holds a URL gets the same protection when its schema marks that property. Use the schema helper for the property's context instead of `DynamicStringSchema`:

- `mediaUrl()` for a URL the component loads without a user action, such as an image or video source.
- `navigationUrl()` for a URL opened after a user action, such as a link target.
- `iframeUrl()` for a URL the component embeds in a frame.

Each helper takes an optional description and accepts the same values as `DynamicStringSchema`, including data bindings and function calls:

```ts
// product-card.api.ts
import {z} from 'zod';
import {type ComponentApi, mediaUrl, navigationUrl} from '@a2ui/web_core';
import {DynamicStringSchema} from '@a2ui/web_core/v1_0';

export const ProductCardApi = {
  name: 'ProductCard',
  schema: z.object({
    title: DynamicStringSchema,
    imageUrl: mediaUrl('Product photo.'),
    productPageUrl: navigationUrl('Opened when the card is tapped.'),
  }),
} satisfies ComponentApi;
```

The resolver passes every value it resolves for a marked property through the policy before the component sees it, including values from data bindings, `formatString`, and nested properties such as `items[].imageUrl`. It checks again whenever the bound data changes. The component receives the allowed (or rewritten) URL, or `undefined` when the URL is blocked, and the resolved prop is typed `string | undefined`. Render nothing, or a fallback, when the value is `undefined`. The component needs no security code of its own.

### Mark URL properties in catalog JSON

When you write a standalone `catalog.json` (see [How to Define a Catalog](/guides/defining-a-catalog/)), mark a URL property with the `x-a2ui-url-context` keyword next to its type. The schema helpers write this keyword when `Catalog.toJson()` serializes a catalog, and `Catalog.fromJson()` reads it back:

```json
"ProductCard": {
  "type": "object",
  "properties": {
    "component": {"const": "ProductCard"},
    "title": {"$ref": "common_types.json#/$defs/DynamicString"},
    "imageUrl": {
      "$ref": "common_types.json#/$defs/DynamicString",
      "x-a2ui-url-context": "media"
    },
    "productPageUrl": {
      "$ref": "common_types.json#/$defs/DynamicString",
      "x-a2ui-url-context": "navigation"
    }
  }
}
```

The allowed values are `media`, `navigation`, `iframe`, and `none`. Use `none` on a property whose name looks like a URL but whose value isn't one, such as a `urlLabel` text, so tools that look for unmarked URL properties skip it.

The keyword belongs to the catalog, not to the messages an agent sends. Agents never send it, and their payloads don't change. JSON Schema validators ignore keywords that start with `x-`, so an SDK that doesn't support the policy still accepts the catalog; it just doesn't check that property.

## Step 3: Check URLs that custom code builds

Some URLs don't come from a marked property: a URL a component assembles at render time, or one a custom function opens or fetches. Pass those through `sanitizeUrl(url, context, info?)` before using them. It returns the URL to use, or `undefined` when the policy blocks it.

A function implementation calls it on the `DataContext` it receives. This covers calls from component bindings, actions, and the agent's `callRendererFunction`:

```ts
import {z} from 'zod';
import {DynamicStringSchema, createFunctionImplementation} from '@a2ui/web_core/v1_0';

const shareProductFn = createFunctionImplementation(
  {
    name: 'shareProduct',
    returnType: 'void',
    allowedCallers: 'rendererOnly',
    requiresUserActivation: true,
    schema: z.object({title: DynamicStringSchema, url: DynamicStringSchema}),
  },
  ({title, url}, context) => {
    const allowed = context.sanitizeUrl(String(url), 'navigation', {functionName: 'shareProduct'});
    if (allowed === undefined) return;
    void navigator.share?.({title: String(title), url: allowed});
  },
);
```

Component code calls the same method on its `ComponentContext`, which fills in the surface, catalog, component type, and component ID for you. `SurfaceModel` has the method too, for code that holds the surface instead of a context (for example through `useA2uiSurface()` in React):

```ts
const src = context.sanitizeUrl(`${baseUrl}/tile.png`, 'media', {propertyName: 'baseUrl'});
```

> **Note**
  Values of marked properties arrive already checked. Don't pass them through `sanitizeUrl` again:
  if the policy rewrote the URL to a proxy, a second check would require the proxy's own host to be
  on the list.

## Step 4: Watch for blocked URLs

When the policy blocks a URL, the surface emits a `URL_BLOCKED` warning on `SurfaceModel.onWarning`. Log it to find hosts you forgot to allow, or to spot an agent that is trying to reach hosts it shouldn't:

```ts
processor.onSurfaceCreated(surface => {
  surface.onWarning.subscribe(warning => {
    if (warning.code === 'URL_BLOCKED') {
      console.warn(warning.message, warning.redactedUrl, warning.context);
    }
  });
});
```

The warning never contains the full URL, because its path or query may hold the data being exfiltrated. `redactedUrl` keeps only the scheme and host (`https://attacker.example`), the media type of a `data:` URL, or the scheme alone. The warning also carries the URL `context` and whatever is known about the source, such as `componentId`, `propertyName`, or `functionName`. A surface reports the same blocked URL from the same source only once.

A blocked `openUrl` call also fails: it throws an `A2uiUrlBlockedError`, and the surface emits an error with the code `URL_BLOCKED` on `SurfaceModel.onError`.

## Additional steps

### URL contexts and the baseline

The policy checks each URL in one of three contexts, which describe how the renderer uses it:

- `media`: loaded automatically, without a user action.
- `navigation`: opened after a user action.
- `iframe`: embedded in the surface.

Every policy runs a built-in baseline before the host's rules, and runs it again on any URL the policy rewrites. A policy can narrow or rewrite what the baseline allows, but never widen it. What the baseline allows depends on the context:

| Context      | Allowed by the baseline                                                                                                                         |
| :----------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `media`      | `http(s)` URLs with a host; relative URLs; `data:` URLs with an `image/*`, `audio/*`, or `video/*` type, except `data:image/svg+xml` by default |
| `navigation` | `http(s)` URLs with a host; relative URLs; `mailto:`; `tel:`                                                                                    |
| `iframe`     | `http(s)` URLs with a host                                                                                                                      |

The baseline blocks everything else, including `javascript:`, `file:`, `blob:`, and `data:` URLs outside `media`. It also blocks URLs that hide their real target: any URL with a space, control character, or backslash anywhere in it, protocol-relative URLs (`//evil.example`), and `http(s)` URLs without `//` and a host (`https:evil.example`). An allowed URL is returned exactly as written, without trimming or normalization.

SVG `data:` URLs are blocked by default because SVG can carry script and links. Set `allowSvgDataUrls: true` on either built-in policy to allow them as `media`.

### Allowlist host rules

`AllowlistUrlSecurityPolicy` applies these rules to each context:

- A context you leave out keeps the baseline checks only. An empty list (`media: []`) blocks every `http(s)` URL in that context.
- An entry is a host (`cdn.example.com`), a host with a port (`localhost:8080`), or a subdomain wildcard (`*.example.com`). Hosts compare without regard to case.
- An entry without a port matches the host on any port. An entry with a port matches only that port.
- `*.example.com` matches `a.example.com` and `a.b.example.com`, but not `example.com` itself. List both if you need both.
- An entry that isn't a host or a `*.` wildcard (such as `https://cdn.example.com` or `cdn.example.com/images`) makes the constructor throw a `TypeError`.
- Once a context has a list, relative URLs are blocked in it. List the context in `allowRelative` to keep allowing them, for example images served by your own app.
- `data:`, `mailto:`, and `tel:` URLs have no host, so the lists don't apply to them. The baseline still limits them to their contexts.

```ts
new AllowlistUrlSecurityPolicy({
  media: ['cdn.example.com', 'localhost:8080'],
  navigation: ['example.com', '*.example.com'],
  allowRelative: ['media', 'navigation'],
  allowSvgDataUrls: true,
});
```

### Send media through a proxy

The `rewrite` option takes a hook per context that changes a URL after the host check passes, for example to route media through your own proxy. The hook receives the URL, its context, and the source details, and returns the URL to use, or `undefined` to block it. The baseline checks the rewritten URL again, but the host lists don't, so the proxy's host doesn't need to be listed:

```ts
new AllowlistUrlSecurityPolicy({
  media: ['cdn.example.com', '*.googleusercontent.com'],
  rewrite: {
    media: url => `https://proxy.example.com/?u=${encodeURIComponent(url)}`,
  },
});
```

### Write your own policy

For rules the allowlist can't express, implement the `UrlSecurityPolicy` interface. `sanitizeUrl(url, context, info?)` returns the URL to use (possibly rewritten) or `undefined` to block it. `info` is a `UrlCheckInfo` with whatever is known about the source: `surfaceId`, `catalogId`, `componentType`, `componentId`, `propertyName`, and `functionName`.

```ts
import type {UrlCheckInfo, UrlContext, UrlSecurityPolicy} from '@a2ui/web_core';

class HttpsOnlyPolicy implements UrlSecurityPolicy {
  sanitizeUrl(url: string, context: UrlContext, info?: UrlCheckInfo): string | undefined {
    // No frames, and only absolute https URLs everywhere else.
    if (context === 'iframe' || !url.startsWith('https://')) return undefined;
    // Map tiles may come only from the tile server.
    if (info?.componentType === 'MapTile') {
      return new URL(url).hostname === 'tiles.example.com' ? url : undefined;
    }
    return url;
  }
}
```

The URLs your policy sees have already passed the baseline, and the baseline checks a rewritten result again. A policy that throws blocks the URL. Add the optional `allowSvgDataUrls` and `urlProperties` fields to support those options.

### Present allowed links with openUrlHandler

By default, `openUrl` opens an allowed URL in a new browser tab. Set the `openUrlHandler` processor option to present it another way, such as a confirmation dialog or an in-app browser:

```ts
new MessageProcessor([basicCatalog], onAction, {
  urlSecurityPolicy: policy,
  openUrlHandler: async (url, info) => {
    if (await confirmLeavingApp(url)) window.open(url, '_blank', 'noopener,noreferrer');
  },
});
```

The handler receives only URLs the policy allowed, with relative URLs already resolved against the page location, so it isn't the place for security decisions. `openUrl` still requires a user action, whatever the policy allows. `confirmLeavingApp` stands for your app's own dialog.

### Mark URL properties of catalogs you can't edit

If you render a third-party catalog whose URL properties aren't marked, list them in the policy's `urlProperties` option instead, keyed by catalog ID, then component, then property. Both built-in policies accept it, and an entry wins over the catalog's own `x-a2ui-url-context`, so you can also use `none` to unmark a property:

```ts
new AllowlistUrlSecurityPolicy({
  media: ['tiles.maps.example.com'],
  urlProperties: {
    'https://maps.example.com/catalog.json': {
      MapTile: {tileUrl: 'media'},
    },
  },
});
```

### Check payloads on the agent

The renderer applies its own policy whatever the agent sends, but an agent can run the same check before a payload leaves it, to log, drop, or retry a response from a model that was prompted into putting data into a URL. `checkPayloadUrls(catalogs, payload, options?)` from `@a2ui/agent` finds URL properties the same way the renderer does (catalog marks, the basic catalog's built-in list, and the policy's `urlProperties`) and checks each value with the policy you pass, usually the one your renderer uses. `@a2ui/agent` re-exports the policy classes:

```ts
import {AllowlistUrlSecurityPolicy, checkPayloadUrls} from '@a2ui/agent';

const policy = new AllowlistUrlSecurityPolicy({media: ['cdn.example.com']});
const {messages, blocked} = checkPayloadUrls(catalogs, payload, {policy, onBlocked: 'strip'});
for (const url of blocked) console.warn(`Blocked ${url.redactedUrl} in ${url.propertyName}`);
```

`catalogs` are the catalogs the agent uses, and `payload` is one message or a list of messages. Each entry in `blocked` names the message, surface, component, property (such as `items[].imageUrl` or `theme.iconUrl`), context, and redacted URL. With `onBlocked: 'strip'`, `messages` holds copies with each blocked value replaced by an empty string, which the renderer treats as unset. The default, `'report'`, returns the messages unchanged.

The check covers literal values and data bindings to values the same payload sets. It can't resolve function calls such as `formatString`, relative bindings inside list templates, or values set by earlier payloads; the renderer still checks those.

### Find unmarked URL properties

A URL property without a mark isn't checked at all, so A2UI tools warn about properties whose name looks like a URL (`url`, `uri`, `href`, `src`, or a name ending in `Url`, `Uri`, `_url`, or `_uri`), whose schema may hold a string, and that have no `x-a2ui-url-context`:

- `Catalog.fromJson()` in `@a2ui/web_core` logs a `console.warn` once per catalog.
- `tools/build_catalog/assemble_catalog.py` logs a warning for each property while it assembles a catalog.

Mark each reported property with its context, or with `"x-a2ui-url-context": "none"` if it doesn't hold a URL. The basic catalog's built-in URL properties count as marked.

### What the policy can't cover

The policy sees only URLs that pass through a marked property or a `sanitizeUrl` call. It can't intercept a custom component that fetches a URL on its own: a hand-written `fetch`, an embedded web view, or a third-party SDK (such as a map library loading tiles) that loads its own resources. Follow one rule in every custom component and function: any URL it loads, opens, or embeds comes from a marked property or goes through `sanitizeUrl`.

On the web, set a Content Security Policy on the host page as a second layer. It limits what the page can load even when component code bypasses the policy.

The policy doesn't apply to data sent back to the agent your app already talks to, such as actions, data model synchronization, and agent function calls.

### SDK availability

| SDK        | Core SDK policy                                                         | Agent payload check                                                   |
| :--------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| TypeScript | Available (`@a2ui/web_core`)                                            | Available (`@a2ui/agent`)                                             |
| Python     | In progress ([#4119](https://github.com/a2ui-project/a2ui/pull/4119))   | In progress ([#4122](https://github.com/a2ui-project/a2ui/pull/4122)) |
| Dart       | In progress ([#4114](https://github.com/a2ui-project/a2ui/pull/4114))   | Not available                                                         |
| Swift      | In progress ([#4045](https://github.com/a2ui-project/a2ui/issues/4045)) | Not available                                                         |
| Kotlin     | Not available                                                           | Not available                                                         |

Each core SDK that adds the policy follows the same rules and passes the same conformance suite, with names adapted to the language.
