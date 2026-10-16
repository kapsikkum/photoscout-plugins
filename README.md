# photoscout-plugins

The plugin registry for [PhotoScout](https://github.com/kapsikkum/photoscout). A registry is one JSON file, `registry.json`. It lists the plugins a PhotoScout server may install, and for each version it gives the download URL of the plugin's `.zip` and the zip's sha256.

## Where the app reads it

PhotoScout ships with this default registry:

`https://raw.githubusercontent.com/kapsikkum/photoscout-plugins/main/registry.json`

The constant is `DEFAULT_PLUGIN_REGISTRY` in `server/src/plugins/remote.ts` of the photoscout repo. The `PLUGIN_REGISTRY_URL` environment variable overrides it. Admins can add their own registries, which must be https. The server fetches the file on request and validates it. It installs a version only when an admin confirms. Nothing installs on its own.

## registry.json

Top level:

| Field | Required | Rule |
|---|---|---|
| `version` | yes | the number `1` |
| `plugins` | yes | the plugin entries, at most 1000 |

Plugin entry:

| Field | Required | Rule |
|---|---|---|
| `id` | yes | the plugin id: `^[a-z0-9]+(\.[a-z0-9-]+)+$`, at most 100 characters. Unique in the file. |
| `name` | yes | display name, up to 200 characters |
| `description` | no | one sentence, up to 2000 characters |
| `author` | no | up to 200 characters |
| `homepage` | no | URL of the plugin's page, up to 2048 characters |
| `category` | yes | `map`, `feed`, `events`, `ai` or `tools`. Must match the `category` in the plugin's `plugin.json`. |
| `latest` | yes | one of the `versions`. An install with no version named gets this one. |
| `versions` | yes | the releases, 1 to 200 |

Release (each item of `versions`):

| Field | Required | Rule |
|---|---|---|
| `version` | yes | plain semver, `1.2.3` or `1.2.3-beta.1`. No leading `v`, no `+build`. Unique within the plugin. |
| `zip` | yes | https URL of the `.zip`, no credentials, up to 2048 characters |
| `sha256` | yes | the zip's sha256, 64 hex characters |
| `minCore` | no | semver range of the PhotoScout core version the plugin needs, such as `>=0.9.0` |
| `size` | no | zip size in bytes |

The whole file must be 1 MiB or smaller. Fields starting with `$` (`$comment`, `$schema`) are notes. The server ignores them. The schema rejects other unknown fields, so a typo such as `lastest` fails validation instead of being skipped.

Example:

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "media.24thframe.radio-garden",
      "name": "Radio Garden",
      "description": "Radio stations from radio.garden, placed on the map and playable from the Radio panel.",
      "author": "PhotoScout",
      "homepage": "https://radio.garden",
      "category": "map",
      "latest": "1.0.0",
      "versions": [
        {
          "version": "1.0.0",
          "zip": "https://github.com/kapsikkum/photoscout-plugin-media.24thframe.radio-garden/releases/download/v1.0.0/media.24thframe.radio-garden-1.0.0.zip",
          "sha256": "<the zip's real sha256, 64 hex characters>"
        }
      ]
    }
  ]
}
```

### Placeholder entry

The `media.24thframe.radio-garden` entry is a placeholder. The zip URL points at a release that does not exist yet, and the sha256 is 64 zeros. Validation warns while a checksum looks like this. Replace both with the real release asset and its checksum before the entry is relied on. Until then, the app lists the plugin and an install fails, so remove the entry if the registry is live before that release exists.

## Rules

The server checks these on every fetch, in `parseRegistry` (`server/src/plugins/remote.ts`): the `version` is `1`; ids and versions are valid and unique; `latest` is one of the versions; each zip is https without credentials; each sha256 is 64 hex characters; `minCore` is a semver range; `size` is a non-negative integer.

`scripts/validate.mjs` checks the same rules, plus three more. The `category` must be one of the five listed above, which the schema enforces. `latest` is expected to be the highest stable version, and a warning is printed when it is not. A checksum that is one character repeated is a placeholder, and a warning is printed.

## How a plugin gets listed

1. **By hand.** Build the zip, attach it to a release of the plugin's repo, and run `node scripts/add-entry.mjs ...` (see CONTRIBUTING.md). Open a PR here.
2. **Automated.** The plugin repo calls `.github/workflows/publish-plugin.yml` when it publishes a release. The workflow builds the zip with photoscout's `plugin:build`, attaches it to the release, and can open a PR here that adds the version.

## Trust model

The registry is the trust root. A plugin runs inside the server process with full access to the app, so whoever can change `registry.json` can make every instance install code that person picked. Treat a change here like a code change. Review each PR, and protect `main` so it needs a reviewed PR. Do not push plugin entries straight to `main`.

The checksum does not vouch for a plugin's behaviour. It guards transit. The server hashes the zip it downloads and refuses a mismatch. It also checks that the zip's own `plugin.json` names the same id and version as the entry, so one entry cannot overwrite another plugin. The checksum proves that the bytes are the ones this file lists. Whether those bytes are a good plugin is a review decision.

## Validation

```sh
node scripts/validate.mjs            # checks registry.json; exits 1 on errors
node scripts/add-entry.mjs ...       # inserts or updates a version; flags in CONTRIBUTING.md
```

Node 18 or later. No npm dependencies. `validate.yml` runs the validator on every push to `main` and on every pull request.

## Layout

```
registry.json              the registry the app reads
registry.schema.json       JSON Schema for it (draft 2020-12)
scripts/validate.mjs       checks registry.json
scripts/add-entry.mjs      inserts or updates one version, then re-validates
scripts/registry-lib.mjs   shared checks
.github/workflows/validate.yml         runs the validator in CI
.github/workflows/publish-plugin.yml   reusable build, checksum and release workflow
CONTRIBUTING.md            how to add or update a plugin
```
