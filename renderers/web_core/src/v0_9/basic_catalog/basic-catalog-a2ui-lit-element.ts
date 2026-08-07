private adoptStyles() {
    if (typeof document === 'undefined') return;
    const root = this.getRootNode() as Document | ShadowRoot;

    const constructor = this.constructor as typeof BasicCatalogA2uiLitElement & {
      _processedSheet?: CSSStyleSheet;
      _processedCss?: string;
    };
    const styles = constructor.styles;
    if (!styles) return;

    const tagName = this.tagName.toLowerCase();

    if (!constructor._processedSheet && constructor._processedCss === undefined) {
      const styleList = Array.isArray(styles) ? styles : [styles];
      const rawCss = styleList
        .map(s =>
          s && typeof s === 'object' && 'cssText' in s
            ? String((s as any).cssText)
            : String(s),
        )
        .join('\n');

      // In Light DOM, replace :host selectors with the specific tagName
      // to avoid leaking styles to parent ShadowRoot hosts (such as explorer shells).
      const processedCss = rawCss
        .replace(/:where\(:host\)/g, `:where(${tagName})`)
        .replace(/:host\(([^)]+)\)/g, `${tagName}$1`)
        .replace(/:host/g, tagName);

      constructor._processedCss = processedCss;

      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(processedCss);
        constructor._processedSheet = sheet;
      } catch {
        // Fallback for environments lacking CSSStyleSheet support
      }
    }

    if (constructor._processedSheet && root && 'adoptedStyleSheets' in root) {
      if (!root.adoptedStyleSheets.includes(constructor._processedSheet)) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, constructor._processedSheet];
      }
    } else if (constructor._processedCss) {
      const target = root && root !== document ? (root as unknown as HTMLElement) : document.head;
      if (target && !target.querySelector(`style[data-a2ui-tag="${tagName}"]`)) {
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-a2ui-tag', tagName);
        styleEl.textContent = constructor._processedCss;
        target.appendChild(styleEl);
      }
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    const root = this.getRootNode() as ShadowRoot | Document;
    injectBasicCatalogStyles(root);
    this.injectComponentStyles(root);
  }

  /**
   * Automatically adapts and injects static styles for Light DOM custom elements.
   */
  private injectComponentStyles(root?: ShadowRoot | Document) {
    const ctor = this.constructor as typeof BasicCatalogA2uiLitElement & HasCustomStyles;
    if (!ctor.styles) return;

    if (typeof document === 'undefined') return;

    if (!ctor._cachedSheet) {
      const styles = ctor.styles;
      const rawCss = Array.isArray(styles)
        ? styles
            .map(s =>
              typeof s === 'object' && s !== null && 'cssText' in s
                ? String((s as {cssText: string}).cssText)
                : String(s),
            )
            .join('\n')
        : typeof styles === 'object' && styles !== null && 'cssText' in styles
          ? String((styles as {cssText: string}).cssText)
          : String(styles);

      const tagName = this.tagName.toLowerCase();
      const convertedCss = rawCss
        .replace(/:where\(:host\)/g, `:where(${tagName})`)
        .replace(/:host\(([^)]+)\)/g, `${tagName}$1`)
        .replace(/:host/g, tagName);

      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(convertedCss);
        ctor._cachedSheet = sheet;
      } catch {
        // Fallback for environments lacking adoptedStyleSheets support
      }
    }

    if (ctor._cachedSheet) {
      if (!document.adoptedStyleSheets.includes(ctor._cachedSheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, ctor._cachedSheet];
      }
      if (root && 'adoptedStyleSheets' in root && root !== document) {
        if (!root.adoptedStyleSheets.includes(ctor._cachedSheet)) {
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, ctor._cachedSheet];
        }
      }
    }
  }

  override willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);

    const props = this.controller?.props;
    if (props && 'weight' in props && typeof props.weight === 'number') {
      this.style.flex = String(props.weight);
    } else {
      this.style.removeProperty('flex');
    }

    const primaryColor = this.context?.theme?.primaryColor;
    if (primaryColor) {
      this.style.setProperty('--a2ui-color-primary', primaryColor);
      this.style.setProperty(
        '--a2ui-color-primary-light',
        computeColorVariant('light', {colorVar: '--a2ui-color-primary'}),
      );
      this.style.setProperty(
        '--a2ui-color-primary-dark',
        computeColorVariant('dark', {colorVar: '--a2ui-color-primary'}),
      );
      this.style.setProperty(
        '--a2ui-color-primary-hover',
        computeColorVariant('hover', {
          darkVar: '--a2ui-color-primary-dark',
          lightVar: '--a2ui-color-primary-light',
        }),
      );
    } else {
      this.style.removeProperty('--a2ui-color-primary');
      this.style.removeProperty('--a2ui-color-primary-light');
      this.style.removeProperty('--a2ui-color-primary-dark');
      this.style.removeProperty('--a2ui-color-primary-hover');
    }
  }
}
