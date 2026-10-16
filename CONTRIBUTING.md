# Contributing

Changes to `registry.json` go through a pull request. Review each one: a listed plugin runs with full app access.

## Add or update a plugin by hand

1. Build the plugin's zip in the photoscout repo: `npm run plugin:build -- <plugin folder>`. It writes `dist/<id>-<version>.zip` in the plugin folder.
2. Attach that zip to a GitHub Release of the plugin's repo, tagged with the version (for example `v1.2.0`). The release must be public.
3. Get the checksum: `sha256sum dist/<id>-<version>.zip`, or `Get-FileHash -Algorithm SHA256 <zip>` on Windows.
4. Add the entry:

   ```sh
   node scripts/add-entry.mjs --id <id> --name "<name>" --category <map|feed|events|ai|tools> \
     --version <1.2.0> --zip <https url of the release asset> --sha256 <64 hex> \
     [--description "<one sentence>"] [--author "<name>"] [--homepage <url>] \
     [--minCore ">=0.9.0"] [--size <bytes>] [--dry-run]
   ```

   It adds the plugin or the version, sets `latest` to the highest stable version, and validates the file. A failed check writes nothing. `--dry-run` prints the result without writing it.
5. Run `node scripts/validate.mjs`, then open the PR.

Checklist for the PR:

- `id`, `name` and `category` match the plugin's `plugin.json`.
- The sha256 is the real checksum of the zip at that URL. Download the asset and hash it to check.
- The version is new. Never publish a different zip under a version that is already listed. `add-entry` refuses a changed checksum for an existing version unless `--force` is given, and installs that already have the old zip would then disagree with the registry.
- The zip URL is https and the release is public.

## Automated: publish from the plugin repo

`.github/workflows/publish-plugin.yml` is a reusable workflow. It builds the zip with photoscout's `plugin:build`, computes the sha256, attaches the zip to the release, and can open a PR here with the new version. Put this in the plugin repo, as `.github/workflows/release.yml`:

```yaml
name: release
on:
  release:
    types: [published]
permissions:
  contents: write
jobs:
  publish:
    uses: kapsikkum/photoscout-plugins/.github/workflows/publish-plugin.yml@main
    with:
      plugin-dir: .
      photoscout-ref: master          # pin a tag once one exists
      release-tag: ${{ github.event.release.tag_name }}
      open-registry-pr: true
    secrets:
      REGISTRY_TOKEN: ${{ secrets.REGISTRY_TOKEN }}
```

Inputs:

| Input | Default | Meaning |
|---|---|---|
| `plugin-dir` | `.` | folder that holds `plugin.json` |
| `photoscout-repo` | `kapsikkum/photoscout` | repo with `scripts/plugin.mjs` |
| `photoscout-ref` | `master` | branch, tag or SHA of photoscout to build with. Pin a tag. |
| `release-tag` | `v<version>` | release to attach the zip to |
| `registry-repo` | `kapsikkum/photoscout-plugins` | registry the PR targets |
| `open-registry-pr` | `false` | open the registry PR. Needs `REGISTRY_TOKEN`. |
| `min-core` | empty | `minCore` written into the entry |

Secrets:

| Secret | Needed when | What it is |
|---|---|---|
| `REGISTRY_TOKEN` | `open-registry-pr: true` | A token you create. Nothing in GitHub creates it, and the name is only a convention. Use a fine-grained PAT with Contents and Pull requests read and write on this registry repo. Store it as a secret in the plugin repo. |
| `PHOTOSCOUT_READ_TOKEN` | photoscout is private | A token with Contents read on photoscout. Not needed for a public repo. |

Notes:

- The caller must grant `contents: write`, as in the snippet above.
- A called workflow must be accessible to the caller. This repo has to be public, or allow access from the caller's repos under Settings, Actions.
- Release assets are not overwritten. To re-release, bump the version.
- The workflow never pushes to `main`. It opens a branch and a PR, and `validate.yml` checks that PR.

## Validation (CI)

`validate.yml` runs `node scripts/validate.mjs` on every PR and on pushes to `main`. Errors fail the check. Warnings do not, but read them: `latest` is not the highest stable version, or a checksum is a placeholder.
