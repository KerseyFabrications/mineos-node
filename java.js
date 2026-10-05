// Chooses the Java runtime a server runs on.
//
// A server's [java] java_binary always wins when it is set. Otherwise the
// runtime is picked from the Minecraft version the server runs, so one host
// can run 26.x worlds (Java 25), 1.17 to 1.21.x worlds (Java 17/21) and
// legacy worlds (Java 8) side by side without per-server configuration.

var fs = require("fs");
var path = require("path");
var child_process = require("child_process");
var which = require("which");
var mc_version = require("./mc_version");

var requiredJavaForMinecraft = mc_version.requiredJavaForMinecraft;
var minecraftFromNeoForge = mc_version.minecraftFromNeoForge;
var minecraftFromJarName = mc_version.minecraftFromJarName;
var minecraftFromProfile = mc_version.minecraftFromProfile;
var highest = mc_version.highest;

var JVM_ROOT = "/usr/lib/jvm";
var VERSION_TIMEOUT_MS = 5000; // for running any java -version

// The web UI runs as root and reads a jar the server's owner controls, so
// only read a regular file of plausible size, and only a small version.json.
var JAR_MAX_BYTES = 512 * 1024 * 1024;
var VERSION_JSON_MAX_BYTES = 64 * 1024;
var jar_cache = {}; // jar path -> {mtimeMs, size, major}

// Java major a vanilla (or bundler) server jar declares in its version.json.
// The result is cached until the jar changes: reading a jar loads all of it.
function requiredJavaFromJar(jar_path) {
  var st;
  try {
    st = fs.lstatSync(jar_path);
  } catch (e) {
    return null;
  }
  if (!st.isFile() || st.size > JAR_MAX_BYTES) return null;

  var cached = jar_cache[jar_path];
  if (cached && cached.mtimeMs == st.mtimeMs && cached.size == st.size) return cached.major;

  var major = null;
  try {
    var AdmZip = require("adm-zip");
    var entry = new AdmZip(jar_path).getEntry("version.json");
    if (entry && entry.header.size <= VERSION_JSON_MAX_BYTES) {
      var parsed = parseInt(JSON.parse(entry.getData().toString("utf8")).java_version, 10);
      major = isNaN(parsed) ? null : parsed;
    }
  } catch (e) {}
  jar_cache[jar_path] = { mtimeMs: st.mtimeMs, size: st.size, major: major };
  return major;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
}

// The Minecraft version a modded server is built on, from what its loader
// installed: the NeoForge version, else the vanilla jar under libraries/
// (Forge and NeoForge), else Fabric's cached server jar. A server upgraded in
// place keeps the old version's directories next to the new ones, so the
// highest version found wins.
function minecraftFromServerDir(cwd) {
  var neoforge = listDir(path.join(cwd, "libraries", "net", "neoforged", "neoforge")).map(minecraftFromNeoForge);
  if (highest(neoforge)) return highest(neoforge);

  // NeoForge names these 1.21.1-20240808.144430; the version is the prefix.
  var vanilla = listDir(path.join(cwd, "libraries", "net", "minecraft", "server")).map(function (dir) {
    var v = /^(\d+(?:\.\d+)+)(?:$|-)/.exec(dir);
    return v && v[1];
  });
  if (highest(vanilla)) return highest(vanilla);

  var fabric = listDir(path.join(cwd, ".fabric", "server")).map(function (file) {
    var m = /^(\d+(?:\.\d+)+)-server\.jar$/.exec(file);
    return m && m[1];
  });
  return highest(fabric);
}

// Java majors installed under /usr/lib/jvm, highest first, as {major, binary}.
function installedJavas(jvm_root) {
  var found = {};
  listDir(jvm_root || JVM_ROOT).forEach(function (dir) {
    var m = /^(?:java-|jdk-?|temurin-|openjdk-?|zulu-?)(?:1\.)?(\d+)/i.exec(dir);
    if (!m) return;
    var major = parseInt(m[1], 10);
    var candidates = [path.join(jvm_root || JVM_ROOT, dir, "bin", "java"), path.join(jvm_root || JVM_ROOT, dir, "jre", "bin", "java")];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var real = fs.realpathSync(candidates[i]);
        fs.accessSync(real, fs.constants.X_OK);
        if (!(major in found)) found[major] = candidates[i];
        return;
      } catch (e) {}
    }
  });
  return Object.keys(found)
    .map(Number)
    .sort(function (a, b) {
      return b - a;
    })
    .map(function (major) {
      return { major: major, binary: found[major] };
    });
}

// The java on PATH, as {major, binary}, so hosts that keep Java outside
// /usr/lib/jvm (FreeBSD, /opt) still find a matching runtime. Its version is
// read once per binary; it is the system's own java, not a server's choice.
var path_java_cache = {};
function pathJava() {
  var binary = whichOrNull("java");
  if (!binary) return null;
  var real;
  try {
    real = fs.realpathSync(binary);
  } catch (e) {
    return null;
  }
  if (!(real in path_java_cache)) {
    var major = null;
    try {
      var out = child_process.spawnSync(real, ["-version"], { timeout: VERSION_TIMEOUT_MS });
      var m = /version "(?:1\.)?(\d+)/.exec(String(out.stderr || "") + String(out.stdout || ""));
      if (m) major = parseInt(m[1], 10);
    } catch (e) {}
    path_java_cache[real] = major;
  }
  return path_java_cache[real] ? { major: path_java_cache[real], binary: binary } : null;
}

// The runtimes to choose from: everything under /usr/lib/jvm, plus the java
// on PATH when it is a version not found there.
function availableJavas() {
  var javas = installedJavas();
  var on_path = pathJava();
  if (on_path && !javas.some(function (j) { return j.major == on_path.major; })) javas.push(on_path);
  return javas;
}

// Best installed runtime for a required major. 17 and newer run on any later
// Java; legacy servers (8 to 16) are only matched exactly or with the next
// installed version below 17, since old Minecraft breaks on modern runtimes.
function pickJava(required, javas) {
  var ascending = javas.slice().sort(function (a, b) {
    return a.major - b.major;
  });
  for (var i = 0; i < ascending.length; i++) {
    var j = ascending[i];
    if (j.major < required) continue;
    if (required < 17 && j.major >= 17 && required != 16) return null;
    return j;
  }
  return null;
}

function whichOrNull(name) {
  try {
    return which.sync(name);
  } catch (e) {
    return null;
  }
}

function isExecutable(file) {
  try {
    fs.accessSync(fs.realpathSync(file), fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
}

// Resolves the runtime for a server. callback(err, {binary, source, required, minecraft}).
// source is "configured" (java_binary), "auto" (picked by version) or
// "default" (the java on PATH, when the version could not be determined).
// javas (optional, for tests) replaces the runtimes found on this host.
function resolveJava(cwd, sc, callback, javas) {
  var java = sc.java || {};
  var configured = String(java.java_binary || "").trim();

  if (configured) {
    var binary = configured.indexOf("/") == -1 ? whichOrNull(configured) : path.resolve(cwd, configured);
    if (!binary || !isExecutable(binary))
      return callback(
        `Java binary '${configured}' is not an executable. Set [java] java_binary to a Java runtime, or leave it empty to pick one automatically.`,
      );
    return callback(null, { binary: binary, source: "configured" });
  }

  var jarfile = java.jarfile || "";
  var minecraft = null;
  var required = null;

  if (/\.jar$/i.test(jarfile)) required = requiredJavaFromJar(path.join(cwd, jarfile));
  if (!required) {
    // The profile names the version the server is set to run (and is what
    // start copies in), so it outranks directories an earlier version left.
    minecraft = minecraftFromJarName(jarfile) || minecraftFromProfile((sc.minecraft || {}).profile) || minecraftFromServerDir(cwd);
    required = requiredJavaForMinecraft(minecraft);
  }

  var fallback = whichOrNull("java");
  if (required) {
    var chosen = pickJava(required, javas || availableJavas());
    if (chosen) return callback(null, { binary: chosen.binary, source: "auto", required: required, minecraft: minecraft });
    if (required < 17)
      return callback(
        `This server needs Java ${required} (Minecraft ${minecraft || "from its jar"}), and no compatible runtime is installed. Install one, or set [java] java_binary.`,
      );
  }
  if (!fallback) return callback("No Java runtime found on this host.");
  callback(null, { binary: fallback, source: "default", required: required, minecraft: minecraft });
}

var version_cache = {}; // real binary path -> {mtimeMs, version}

// The Java version string a server will run with, for the web UI.
//
// A configured java_binary is chosen by whoever can edit server.config, so it
// runs as the server's owner (the same user the server itself runs as), never
// as root, and is killed if it does not answer in time. owner is {uid, gid}.
function usedJavaVersion(cwd, sc, owner, callback) {
  resolveJava(cwd, sc, function (err, result) {
    if (err) return callback(null, err);
    if (!owner || owner.uid === undefined) return callback(null, "unknown");

    var real, st;
    try {
      real = fs.realpathSync(result.binary);
      st = fs.statSync(real);
    } catch (e) {
      return callback(null, `Error accessing '${result.binary}'`);
    }
    var cached = version_cache[real];
    if (cached && cached.mtimeMs == st.mtimeMs) return callback(null, cached.version);

    var opts = { cwd: cwd, uid: owner.uid, gid: owner.gid, timeout: VERSION_TIMEOUT_MS, killSignal: "SIGKILL" };
    child_process.execFile(result.binary, ["-version"], opts, function (exec_err, stdout, stderr) {
      var m = /version "([^"]+)"/.exec(String(stderr || "") + String(stdout || ""));
      if (m) {
        version_cache[real] = { mtimeMs: st.mtimeMs, version: m[1] };
        return callback(null, m[1]);
      }
      if (exec_err && exec_err.killed) return callback(null, `'${result.binary}' did not answer in time`);
      callback(null, `unknown (${result.binary})`);
    });
  });
}

module.exports = {
  minecraftFromServerDir,
  requiredJavaFromJar,
  installedJavas,
  availableJavas,
  pickJava,
  resolveJava,
  usedJavaVersion,
};
