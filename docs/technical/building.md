# Building and releasing

## From source

**Prerequisites:** Node.js LTS.

```bash
git clone https://github.com/deforay/intelis-interfacing.git
cd intelis-interfacing
npm install

npm start              # development, Angular dev server plus Electron
npm run electron:build # production build into release/
```

## The gate

```bash
npm run verify
```

which is `check:safety` → `lint` → `test` → `build:prod`. The same gate runs for
pull requests and pushes to `master`, and a release is only built from a commit
that passed it.

`npm test` is more than the unit tests:

| Step | What it protects |
|------|------------------|
| `test:unit` | Wire-level parsing and persistence, including replays of real analyzer captures |
| `test:migrations` | The migration chain applies cleanly to an empty database |
| `test:settings-crypto` | Encrypted exports are actually encrypted, and tampering is detected |
| `test:packaged-paths` | Modules the main process imports from outside `app/` are packaged |
| `test:safety-guard` | The renderer safety check still fires on the shapes it exists to catch |
| `test:upgrade-identity` | An installed machine keeps its data and is upgraded, not duplicated |

For faster feedback while writing, install the pre-commit hook once per clone:

```bash
npm run install-hooks
```

CI is the enforcement; the hook is only sooner.

## Releasing

```bash
npm run bump 4.3.0     # version in both package.json files and both lockfiles
git commit -am "Release 4.3.0"
git push origin master
git tag v4.3.0 && git push origin v4.3.0
```

Pushing a `v*` tag is what cuts the release. The workflow re-runs the full gate,
refuses to continue if the tag and `package.json` disagree, then builds and
publishes installers for Windows, macOS and Linux.

`npm run bump` exists because the version lives in four files, and a partial
bump ships installers labelled differently from the release they land on.

## The identifiers that must not move

Three things look like part of the product name and are not. Each is invisible
until an upgrade reaches a laboratory that has been running the tool for a year.

| Identifier | Why it is pinned |
|------------|------------------|
| `DATA_DIRECTORY_NAME` in `app/main.ts` | Electron derives `userData` from the application name. Rename it and every existing installation opens with no instruments, no results and no history. |
| `nsis.guid` | Windows finds the installed copy to upgrade through a UUIDv5 of `appId`. The `appId` changed at the rename, so the GUID is pinned to what Windows already recorded. Without it, a laboratory gets two copies, and only one of them listening to the analyzer. |
| The `deb` `Replaces`/`Conflicts`/`Provides` | dpkg identifies a package by name, so the renamed package is a different package. Without these the machine ends up with two applications and two menu entries. |

`scripts/test-upgrade-identity.mjs` fails the build if any of them moves.
