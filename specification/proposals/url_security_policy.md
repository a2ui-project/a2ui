# Proposal: URL security policy

_Status: Draft_

_Tracking issue: [#4045](https://github.com/a2ui-project/a2ui/issues/4045)_

## Problem

A renderer loads, opens, or embeds URLs that an agent supplies. `Image`, `Video`, and `AudioPlayer` fetch their URL as soon as they render, `openUrl` opens a page after a click, and custom components can do either. Today each SDK checks only the URL scheme, and each path does it separately. An agent that has been prompt-injected can therefore put data from the data model into a URL on any host, and the renderer sends it there.

This proposal defines one URL security policy that every core SDK applies the same way. The conformance suite [`conformance/core/url_security_policy.yaml`](../../conformance/core/url_security_policy.yaml) is the executable form of the rules below.

## URL contexts

Each URL is checked in one of three contexts, which describe how the renderer uses it:

1. `media`: loaded automatically, without a user action. Examples are `Image.url`, `Video.url`, `Video.posterUrl`, and `AudioPlayer.url`.
2. `navigation`: opened after a user action. `openUrl` checks its URL in this context.
3. `iframe`: embedded in the surface.

## Marking URL properties in a catalog

A catalog marks a component property that holds a URL with the `x-a2ui-url-context` keyword, next to the property's type:

```json
"imageUrl": {
  "$ref": "common_types.json#/$defs/DynamicString",
  "x-a2ui-url-context": "media"
}
```

The allowed values are `media`, `navigation`, `iframe`, and `none`. `none` marks a property whose name looks like a URL but whose value isn't one (for example a `urlLabel` text), so tooling that looks for unmarked URL properties can skip it.

The keyword is part of how catalogs are written, not part of the messages an agent sends:

1. The catalog author sets it once per URL property. Each SDK provides schema helpers so authors don't write the keyword by hand.
2. Agents never send it, and their payloads don't change.
3. JSON Schema validators ignore keywords that start with `x-`, so an SDK that doesn't know the keyword still accepts the catalog. It just doesn't apply the policy to that property.

The keyword can mark a property at any depth, such as `imageUrl` inside the items of an array property. The published basic catalogs don't carry the keyword yet. Until they do, each SDK treats the basic catalog's `Image.url`, `Video.url`, `Video.posterUrl`, and `AudioPlayer.url` as `media` through a built-in list.

## The baseline

Every policy runs a built-in baseline first. A host policy can narrow or rewrite what the baseline allows, but never widen it.

The baseline blocks a URL that:

1. Is empty.
2. Contains an ASCII control character (U+0000 to U+001F, U+007F) or a space anywhere. URL parsers drop or trim these, which lets `java\tscript:` or a leading space hide a scheme. A URL that contains them is blocked rather than cleaned up.
3. Contains a backslash anywhere. Browsers read `\` as `/`, so `/\evil.example` reaches another host.
4. Uses `http:` or `https:` without `//` followed by a non-empty host, such as `https:evil.example` or `https:///evil.example`.
5. Starts with `//` (a protocol-relative URL, which reaches another host).

Scheme names compare without regard to case. A URL without a scheme (a scheme is letters, digits, `+`, `-`, or `.`, starting with a letter and followed by `:`) is relative. What passes depends on the context:

| Context      | Allowed                                                                                                                                                               |
| :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media`      | `http(s)` URLs with a host; `data:` URLs whose media type is `image/*`, `audio/*`, or `video/*`, except `data:image/svg+xml` unless the policy opts in; relative URLs |
| `navigation` | `http(s)` URLs with a host; `mailto:`; `tel:`; relative URLs                                                                                                          |
| `iframe`     | `http(s)` URLs with a host                                                                                                                                            |

Everything else is blocked, including `javascript:`, `vbscript:`, `file:`, `blob:`, and `data:` URLs outside `media`. SVG `data:` URLs are blocked by default because SVG can carry script and links.

An allowed URL is returned exactly as written. The policy doesn't trim, normalize, or re-serialize it.

## Policies

Each core SDK provides two ready-made policies.

The permissive policy is the default. It allows every URL the baseline allows. Its one option, `allowSvgDataUrls`, lets SVG `data:` URLs through as `media`.

The allowlist policy adds a host list per context, and accepts `allowSvgDataUrls` too:

1. A context without a list keeps the baseline only.
2. Once a context has a list, an `http(s)` URL passes only if its host matches an entry. An empty list matches nothing.
3. An entry is a hostname, a `host:port` pair, or a wildcard such as `*.example.com`.
   1. A hostname entry matches that host on any port.
   2. A `host:port` entry matches only that host and port, even when the port is the scheme's default: `example.com:443` matches `https://example.com/` but not `http://example.com/`.
   3. `*.example.com` matches subdomains at any depth (`a.example.com`, `a.b.example.com`) but not `example.com` itself, and not hosts such as `evil-example.com` or `example.com.evil.com`.
   4. Hosts compare without regard to case.
4. Once a context has a list, relative URLs are blocked in that context unless the host opts in for it.
5. `data:`, `mailto:`, and `tel:` URLs have no host, so host lists don't apply to them. They still pass only in the contexts the baseline allows.
6. An optional rewrite per context changes an allowed URL, for example to send media through a proxy. The rewrite runs after the host check, and the baseline then checks the rewritten URL again, so a rewrite can't produce a URL the baseline blocks.

The order for every URL is: baseline, then the policy (host check, then rewrite), then the baseline again on a rewritten URL.

## How SDKs apply the policy

1. The host app sets one policy on the message processor. Every surface the processor creates uses it, and leaving it unset means the permissive policy.
2. When the resolver resolves a property marked with `x-a2ui-url-context`, it passes the final value through the policy before the component sees it. Values built from data bindings or `formatString` are checked after they resolve, and checked again whenever they change.
3. A blocked URL resolves to no value. Components show their empty state without making a request. The policy never substitutes a placeholder such as `about:blank`.
4. A URL is checked once. A value the resolver already checked isn't checked again by component code, so a rewritten URL that points at a proxy doesn't need the proxy's host on the list.
5. `openUrl` checks its URL in the `navigation` context first. A blocked URL fails with the error code `URL_BLOCKED` and never reaches the host's open-URL handler. The handler only sees allowed URLs and is for presentation, such as a confirmation dialog, not for security decisions. The existing rule that `openUrl` needs a user action still applies.
6. Components and functions that build a URL themselves, such as a Markdown renderer or a chart that loads data, call the policy through the context object they already receive.

## Out of scope

1. Data sent back to the agent the app already talks to (actions, data model sync, agent function calls).
2. URLs a component fetches without going through a property or the policy, such as a third-party SDK that loads its own resources. A platform Content Security Policy is the backstop for those.
