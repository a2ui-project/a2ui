# How to contribute to A2UI

We'd love to accept your patches and contributions to this project.

## Before you begin

### Sign our Contributor License Agreement

Contributions to this project must be accompanied by a
[Contributor License Agreement](https://cla.developers.google.com/about) (CLA).
You (or your employer) retain the copyright to your contribution; this simply
gives us permission to use and redistribute your contributions as part of the
project.

If you or your current employer have already signed the Google CLA (even if it
was for a different project), you probably don't need to do it again.

Visit <https://cla.developers.google.com/> to see your current agreements or to
sign a new one.

### Review our community guidelines

This project follows
[Google's Open Source Community Guidelines](https://opensource.google/conduct/).

## Contribution process

### Issues

File new issues here: https://github.com/a2ui-project/a2ui/issues

The issue triage process is described in the Google-internal document: go/a2ui-triage.

TODO(polina-c): port process description here.

### Code reviews

All submissions, including submissions by project members, require review. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://help.github.com/articles/about-pull-requests/) for more
information on using pull requests.

### Contributor Guide

You may follow these steps to contribute:

1. **Fork the official repository.** This will create a copy of the official repository in your own account.
2. **Sync the branches.** This will ensure that your copy of the repository is up-to-date with the latest changes from the official repository.
3. **Work on your forked repository's feature branch.** This is where you will make your changes to the code.
4. **Commit your updates on your forked repository's feature branch.** This will save your changes to your copy of the repository.
5. **Submit a pull request to the official repository's main branch.** This will request that your changes be merged into the official repository.
6. **Resolve any linting and formatting errors.** Run `./scripts/fix_format.sh` to fix formatting issues.

Here are some additional things to keep in mind during the process:

- **Test your changes.** Before you submit a pull request, make sure that your changes work as expected.
- **Be patient.** It may take some time for your pull request to be reviewed and merged.

## Coding Style

To keep our codebase consistent and maintainable, we follow specific coding standards and use automated formatters.

### Formatters

- **JavaScript / TypeScript / JSON / Markdown / CSS**: [Prettier](https://prettier.io/)
- **Python**: [Pyink](https://github.com/google/pyink) (Google style Black)
- **Dart**: `dart format`
- **Swift**: `swift-format`

You can use the provided script to format the entire repo or check formatting:

```bash
./scripts/fix_format.sh
./scripts/fix_format.sh --check
```

### IDE Recommendations (VS Code)

We recommend using [VS Code](https://code.visualstudio.com/) for development. To help enforce formatting, please install the following extensions:

- **Prettier - Code formatter** (`esbenp.prettier-vscode`)
- **Black Formatter** (`ms-python.black-formatter`) - configured to use `pyink` in workspace settings.
- **Dart** (`Dart-Code.dart-code`)

Workspace settings are provided in `.vscode/settings.json` to use these formatters by default on save.

Please refer to the following guidelines for detailed information on styles:

- **Python**: [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html).
- **TypeScript**: [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html).
- **Swift**: [Google Swift Style Guide](https://google.github.io/swift/)
- **License Headers**: required copyright notices.

We expect all contributors to adhere to these styles.

## Internal information

For Google-internal information see go/a2ui-internal.
