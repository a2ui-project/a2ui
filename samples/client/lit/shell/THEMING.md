# A2UI Lit v0.9 Theming & Configuration Guide

This document describes the styling and configuration architecture for the v0.9 A2UI Lit Shell.

## Architecture

### Design Tokens and CSS Variables

This application uses A2UI's "Basic Catalog", which has some theming features.

Themes can be configured by overriding default CSS variables provided by the
Lit renderer basic catalog implementation.

Design tokens are defined in two layers:

- **Web Core**: Supplies base design tokens (color palettes, typography, spacing)
  that are used by the A2UI-provided renderers via global CSS custom properties on the root element. See the [Basic Catalog default styles](../../../../renderers/web_core/src/v0_9/basic_catalog/styles/default.ts).
- **Lit Renderer**: Each Basic Catalog component provided by the Lit renderer
  has additional design tokens to target more-specific properties (e.g., `--a2ui-button-background`). View available components and the tokens they
  expose in the [Lit Basic Catalog Components](../../../../renderers/lit/src/v0_9/catalogs/basic/components).

### Application Configuration

In this particular app:

- Application themes are defined using `CSSStyleSheet` instances. See:
  - [Restaurants theme](theme/restaurant-theme.ts)
- These stylesheets override the default component CSS variables specified above,
  and change the look and feel of the generated UI.
