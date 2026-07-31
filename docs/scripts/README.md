# Documentation Transformation Scripts

This directory contains utility scripts to prepare our documentation for the **MkDocs** build process.

## Purpose

To ensure a great reading experience both on GitHub and the hosted site, the project uses **GitHub-flavored Markdown** as the primary source of truth. This script transforms GitHub's native syntax into **MkDocs-compatible syntax** (specifically for the `pymdown-extensions`) during the build pipeline.

## Supported Conversions (Uni-directional)

The script performs a uni-directional transformation: **GitHub Markdown → MkDocs Syntax**.

### Alert/Admonition Conversion

The script handles the following conversions:

- GitHub uses a blockquote-based syntax for alerts.
- MkDocs requires the `!!!` or `???` syntax to render colored callout boxes.

## Running the Conversion

The conversion is run as part of the build pipeline. No additional steps are required. If you need to run the conversion manually, you can run the `convert_docs.py` script in the repository root.

```bash
python docs/scripts/convert_docs.py
```

### Example

- **Source (GitHub-flavored Markdown):**

    ```markdown
    > ⚠️ **Attention**
    >
    > This is an alert.
    ```

- **Target (MkDocs Syntax):**

    ```markdown
    !!! warning "Attention"
    This is an alert.
    ```
