# CLAUDE.md

Guidance for AI assistants working in this repository. Personality and global working style come
from the user's own configuration; this file is the project-specific direction.

## Project overview

This is a maintained fork of [hexparrot/mineos-node](https://github.com/hexparrot/mineos-node), the
MineOS Minecraft server manager: a Node.js web UI and process manager for running many Minecraft
servers on one Linux host. Upstream has been dormant since late 2024 and its Docker image since
2022, so it cannot run current Minecraft (26.x needs Java 25). This fork keeps it running on modern
Java, Node and Ubuntu, and ships a container image people can actually install.

- **License:** GPL-3.0, inherited. Every upstream author keeps their credit and history. Code taken
  from another author's pull request lands with that author's commits, not squashed under ours.
- **Users:** Docker, TrueNAS and Unraid installs, plus bare-metal Linux. The image is the primary
  delivery.
- **Compatibility promise:** an existing MineOS install must keep working when it switches to this
  image. Its on-disk layout (`/var/games/minecraft/{servers,profiles,backup,archive,import}`), each
  server's `server.config` and `cron.config`, custom `profiles.d` files, and the container's
  environment variables (`USER_NAME`, `USER_PASSWORD`, `USER_UID`, `GROUP_NAME`, `GROUP_GID`,
  `SERVER_PORT`, `USE_HTTPS`) are a contract. Changing any of them needs a migration path and an
  entry in the upgrade notes.

## ⚠️ THE PRIME DIRECTIVE: WE ALWAYS DO IT RIGHT. WE DON'T DO STOP-GAPS. ⚠️

**This rule outranks convenience, speed, and scope. It governs every other rule in this file.**

- **Do it right. Don't be lazy.** Every fix is the real fix, designed properly and phased properly.
  There is no "quick fix now, real fix later." Never propose a stop-gap, a band-aid, a workaround
  dressed up as a fix, or a degrade-instead-of-fix path as the plan. If the proper fix is large,
  **phase the proper fix**: every phase must be a piece of the final design, not something to rip
  out later.
- **This is a public project.** Judge correctness against **every user's** worlds, configs,
  platforms and hardware, never only the developer's. "It works on my server" is not an argument.
  Other people run this, and their worlds are irreplaceable.
- **Verify, don't assume.** Check claims against the code, against vendor documentation (Mojang
  version manifests, NeoForge/Fabric/Paper APIs, JDK release notes) or against live behavior, and
  reproduce a bug before calling it fixed. If you haven't verified something, say so plainly.
- **When a real tradeoff exists,** lay the options out honestly, say what each one actually fixes,
  and recommend the proper one even when it's more work. Never quietly pick the easy option.

## Critical rules

- **Never risk a real world.** Test against copies: a ZFS snapshot clone, a copied server directory,
  or a throwaway volume. Never point a development build at live server data. A world opened by a
  newer Minecraft is upgraded in place and cannot be opened by the older version again.
- **Stop servers cleanly.** Any path that ends a server (container stop, restart, update, delete)
  must save and stop it (`save-all`, `stop`) before the process goes away. Killing a JVM mid-write
  corrupts region files.
- **Feedback before implementation.** For a question or a design choice, give the analysis, the
  trade-offs and a recommendation first, then wait for a clear go-ahead before coding.
- **Review before handoff.** Run the relevant review lenses (security, correctness, efficiency)
  on the diff before calling work done, and re-review fixes made after the review.
- **Commit messages:** terse and factual, saying what changed and why. **No AI attribution
  trailers** (no `Co-Authored-By` for assistants, no "Generated with" footers).
- **No personal data** in anything committed: no real player names, world names, hostnames, IPs,
  usernames or passwords from anyone's install. Use placeholders in examples and tests. Credits to
  upstream authors are the exception.
- **Never delete user files or history.** Say what should be deleted and let the maintainer do it.
- **Keep internal planning language out of committed text.** Comments and commit messages must
  stand on their own for a reader who has none of our working context.
- **Prose style:** no em dashes; short, plain sentences.

## Layout

| Path | What it is |
|---|---|
| `webui.js` | Express + socket.io web server, login, HTTPS setup |
| `server.js` | Server registry, profile downloads, socket.io API the web UI calls |
| `mineos.js` | One Minecraft server: config files, start/stop through `screen`, backups (rdiff-backup), archives |
| `java.js` | Chooses the Java runtime a server starts with, from its Minecraft version |
| `mc_version.js` | Pure Minecraft version parsing (Java needed per version, versions in loader, jar and profile names), shared by `java.js` and the profiles |
| `security.js` | Same-origin checks for the HTTP API and socket.io handshakes; the list of API commands |
| `mineos_shutdown.js` | Saves and stops every running server when the container or service stops |
| `profiles.js`, `profiles.d/` | Downloadable server-jar profiles (Mojang, Paper, Forge, NeoForge, ...). `postdownload` hooks run installers |
| `auth.js` | Login against system accounts (`/etc/shadow`) |
| `html/` | AngularJS 1.x front end |
| `entrypoint.sh`, `Dockerfile` | Container: creates the login user from env vars, then runs supervisor |
| `Dockerfile.dev` | Two-stage variant for local development; keep its packages in step with `Dockerfile` |
| `.github/workflows/docker.yml` | CI: tests, then the multi-arch image build, publish and signing |
| `UPGRADING.md` | User-facing upgrade notes, newest first |
| `test/` | Unit tests |

## Non-obvious behavior (these cost real time)

- **Java selection** lives in `java.js`. A set `[java] java_binary` always wins, and a value that
  is not an executable (a jar name, a typo) fails the start with a clear error instead of letting
  `screen` start and die silently. Left empty, the runtime is picked from the server's Minecraft
  version: the `java_version` in the jar's `version.json`, else the version in the jar name, the
  `libraries/` or `.fabric/` tree a loader installed, or the profile id. Legacy servers (below
  1.17) never move to a modern runtime. If no version can be found, the `java` on PATH is used.
- **Servers run inside `screen`.** The start command is `screen -dmSL mc-<name> <java> ...` in the
  server directory, as the server directory's owner. A startup failure leaves no `logs/latest.log`,
  so screen's log (`screenlog.0`) is the only record of why. Inside a container `/proc/<pid>/environ`
  of another user is unreadable, so the Java process is found as the child of the screen process
  (by parent pid), not by its environment.
- **Start and stop state is the server's, not the browser's.** `server.js` tracks a running
  start, stop or restart per server and sends it in every heartbeat (`state`: starting, stopping,
  up, down; `ready` once the server has finished loading). The web UI disables buttons from that,
  so every open browser agrees, and a `server_event` tells it when a start finished or failed.
- **Two server-name rules.** `valid_server_name` (letters, digits, `_`, `.`) is what new servers
  must meet and what the create paths enforce. `listable_server_name` (not hidden, no control
  characters) decides which existing directories are servers, so ones made by hand or another tool
  still show up and are saved at shutdown.
- **rdiff-backup lists increments oldest-first** from 2.1.1 on. `mineos.number_increments` sorts
  them by time and numbers them newest-first (`0B`, `1B`, ...), which is what restore expects.
- **The container image must build from this repository's source,** never by cloning upstream at
  build time. A Dockerfile that clones upstream silently ships upstream's code instead of ours.
- **NeoForge servers start through ServerStarterJar.** The NeoForge installer lays down `run.sh`
  and `libraries/`; MineOS launches `server.jar` (NeoForged's ServerStarterJar), which reads those
  and starts the server. MineOS's plain `java -jar <jar> nogui` model works only because of it.
- **Native npm modules** (`posix`, `userid`, `diskusage`) compile at install time. Login depends on
  `posix`. npm warns that install scripts are not covered by `allowScripts`; if a future npm stops
  running them by default, login breaks. Check this on every Node or npm upgrade.
- **Container stop saves the worlds.** `entrypoint.sh` keeps supervisor as a child, traps the stop
  signal, and runs `mineos_shutdown.js`, which sends `stop` to every running server and waits up to
  `MINEOS_SHUTDOWN_TIMEOUT` seconds (default 120). Docker's own stop timeout defaults to 10 seconds,
  so deployments must set a longer one (`stop_grace_period` in compose).
- **uid/gid 1000 already exist** in the Ubuntu base image (`ubuntu`). Containers that set
  `USER_UID`/`GROUP_GID` to match NAS ownership avoid a duplicate-id collision.

## Build and test

```
npm ci && npm test                       # unit tests (needs rdiff-backup installed)
docker build -t mineos-node:dev .        # local image
```

GitHub Actions runs the unit tests on every push; nothing is built unless they pass. It then
builds linux/amd64 and linux/arm64 on native runners and publishes one multi-arch image to GHCR,
tagged with the branch name and `sha-<short>` on every push, and with the version on a `v*` tag.
Published images carry provenance and an SBOM and are signed with cosign (the verify command is in
the workflow). Actions and the base image are pinned; Dependabot proposes updates.

Test an image against copies of real server directories before tagging a release, covering at
least vanilla on each Java tier, a Fabric server, and a NeoForge server.

In a clone of this fork, `gh` may default to the upstream repository; pass `-R <owner>/mineos-node`
when checking runs or issues.
