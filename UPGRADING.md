# Upgrading

Notes for people moving an existing MineOS install to this fork's image, newest first. Each entry
says what changed and what, if anything, you need to do.

## 2026-10: Java 25, automatic Java per server, safe container stop

**The image.** `ghcr.io/kerseyfabrications/mineos-node` replaces `hexparrot/mineos`, whose last
build (2022) carries Java 8 and 17 only. It runs on Ubuntu 26.04 and Node.js 24, and includes
Java 25, 21 and 8, so it can run Minecraft 26.x as well as 1.21.x and older worlds. Your volume
layout (`/var/games/minecraft`), your servers and their `server.config` files, and the container's
environment variables (`USER_NAME`, `USER_PASSWORD`, `USER_UID`, `GROUP_NAME`, `GROUP_GID`,
`SERVER_PORT`, `USE_HTTPS`) work unchanged.

**Do this when you switch:**

1. **Take a backup or snapshot of your server data first.** A world opened by a newer Minecraft
   version cannot be opened by the older one again.
2. **Give the container a long stop timeout.** Stopping the container now saves and stops every
   running server first, waiting up to `MINEOS_SHUTDOWN_TIMEOUT` seconds (default 120). Docker
   stops containers after 10 seconds by default, which kills servers mid-save. Set a longer
   grace period, for example in compose:

   ```yaml
   services:
     mineos:
       stop_grace_period: 3m
   ```

   With `docker stop`, use `-t 180`.
3. **Set `USER_UID` and `GROUP_GID` to the owner of your server files** if they are not 1000. The
   new base image already has a user and group with id 1000.
4. **If you mount your own `profiles.d`** over `/usr/games/minecraft/profiles.d`, your copy hides
   the profiles shipped in the image, including the new NeoForge profile and fixes to the others.
   Remove the mount, or copy the new files into it.

**What behaves differently:**

- **Cross-site requests are refused.** The web UI only accepts changes and socket connections
  from its own address (or the address a reverse proxy forwards as `X-Forwarded-Host`). The HTTP
  API at `/api/<server>/<command>` and `/admin/command` takes POST only and only the server
  commands the web UI offers (start, stop, restart, backup, ...); deleting a server is web-UI only.
  **Behind a reverse proxy,** the proxy must pass the address the browser used, port included:
  keep the original `Host` header, or set `X-Forwarded-Host` (nginx: `$http_host`, not `$host`,
  which drops the port). Otherwise every change and the live connection are refused.
- **Without `USER_PASSWORD`, the generated password now survives a restart.** It is random, kept
  in `/root/password` inside the container, and printed once when it is created. Before, a
  restarted container fell back to the literal password `random_see_log`. If you relied on the
  default, read the new password from the container log or set `USER_PASSWORD`.
- **Java is chosen per server.** A server with an empty `java_binary` now runs on the Java its
  Minecraft version needs (26.x on 25, 1.20.5 to 1.21.x on 21, 1.17 to 1.20.4 on 17 or newer,
  older on 8), instead of the one `java` on the PATH. A server with `java_binary` set keeps using
  it (set it under `[java]` in the server's `server.config`). The server page shows the Java
  version it will start with.
  - On a bare-metal host with several Java versions installed, a server may now get an older
    runtime than before (for example a 1.20.1 server gets 17 where it used to get 21). If a mod
    needs the newer one, set `java_binary` for that server.
- **A `java_binary` that is not a Java runtime now stops the start with an error.** Before, a
  value like `server.jar` let the server start and die immediately with no message. Fix
  `java_binary` under `[java]` in the server's `server.config` (in its server directory), or clear
  it to have Java chosen automatically. The web UI has no field for it.
- **A legacy server (Minecraft 1.16 or older) never runs on a modern Java.** If no Java 8 is
  installed, it refuses to start and says why. The image includes Java 8.
- **`screenlog.0`** (screen's console log in each server directory) is rotated to `screenlog.1`
  at every start, instead of growing forever.
- **NeoForge profile.** NeoForge builds, including 26.x, can be downloaded like any other
  profile. The download runs the installer and adds NeoForged's ServerStarterJar as
  `server.jar`; choose that jar in the server's Java settings.
