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

var JVM_ROOT = "/usr/lib/jvm";

// Minecraft version -> minimum Java major, from Mojang's version manifests
// (each version's javaVersion.majorVersion).
function requiredJavaForMinecraft(mc_version) {
  var parts = String(mc_version || "")
    .split(".")
    .map(function (p) {
      return parseInt(p, 10);
    });
  if (!parts.length || isNaN(parts[0])) return null;

  // Year-based versions (26.1 onward) need Java 25.
  if (parts[0] >= 26) return 25;
  if (parts[0] != 1 || isNaN(parts[1])) return null;

  var minor = parts[1];
  var patch = isNaN(parts[2]) ? 0 : parts[2];
  if (minor > 20 || (minor == 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor == 17) return 16;
  return 8;
}

// NeoForge versions encode the Minecraft version: 21.1.229 is 1.21.1, and
// from the 26.x releases on the leading fields are the Minecraft version.
function minecraftFromNeoForge(nf_version) {
  var m = /^(\d+)\.(\d+)\./.exec(String(nf_version || ""));
  if (!m) return null;
  var major = parseInt(m[1], 10);
  if (major >= 26) return `${m[1]}.${m[2]}`;
  return m[2] == "0" ? `1.${m[1]}` : `1.${m[1]}.${m[2]}`;
}

// Minecraft version named in a jar file name, for the common launchers.
function minecraftFromJarName(jarfile) {
  var name = path.basename(String(jarfile || ""));
  var patterns = [
    /^minecraft_server\.(\d+(?:\.\d+)+)\.jar$/i, // vanilla, as MineOS names it
    /^fabric-server-mc\.(\d+(?:\.\d+)+)-loader/i, // Fabric server launcher
    /^forge-(1\.\d+(?:\.\d+)?)-/i, // Forge installer or universal jar
    /^(?:paper|purpur|spigot|craftbukkit)-(\d+(?:\.\d+)+)/i, // Bukkit family
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = patterns[i].exec(name);
    if (m) return m[1];
  }
  return null;
}

// Java major a vanilla (or bundler) server jar declares in its version.json.
function requiredJavaFromJar(jar_path) {
  try {
    var AdmZip = require("adm-zip");
    var entry = new AdmZip(jar_path).getEntry("version.json");
    if (!entry) return null;
    var info = JSON.parse(entry.getData().toString("utf8"));
    var major = parseInt(info.java_version, 10);
    return isNaN(major) ? null : major;
  } catch (e) {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
}

// The Minecraft version a modded server is built on, from the vanilla jar its
// installer laid down under libraries/ (Forge and NeoForge) or .fabric/.
function minecraftFromServerDir(cwd) {
  var vanilla = listDir(path.join(cwd, "libraries", "net", "minecraft", "server"));
  // NeoForge names these 1.21.1-20240808.144430; the version is the prefix.
  for (var i = 0; i < vanilla.length; i++) {
    var v = /^(\d+(?:\.\d+)+)(?:$|-)/.exec(vanilla[i]);
    if (v) return v[1];
  }

  var neoforge = listDir(path.join(cwd, "libraries", "net", "neoforged", "neoforge"));
  for (var j = 0; j < neoforge.length; j++) {
    var mc = minecraftFromNeoForge(neoforge[j]);
    if (mc) return mc;
  }

  var fabric = listDir(path.join(cwd, ".fabric", "server"));
  for (var k = 0; k < fabric.length; k++) {
    var m = /^(\d+(?:\.\d+)+)-server\.jar$/.exec(fabric[k]);
    if (m) return m[1];
  }
  return null;
}

// Minecraft version from a profile id: plain versions (1.21.5, 26.3,
// 1.21.1-latest) or a NeoForge build number (21.1.229).
function minecraftFromProfile(profile) {
  var id = String(profile || "");
  var plain = /^((?:1\.\d+(?:\.\d+)?)|(?:2[6-9]|[3-9]\d)\.\d+(?:\.\d+)?)(?:$|-)/.exec(id);
  if (plain) return plain[1];
  return minecraftFromNeoForge(id);
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
function resolveJava(cwd, sc, callback) {
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
    minecraft = minecraftFromJarName(jarfile) || minecraftFromServerDir(cwd) || minecraftFromProfile((sc.minecraft || {}).profile);
    required = requiredJavaForMinecraft(minecraft);
  }

  var fallback = whichOrNull("java");
  if (required) {
    var chosen = pickJava(required, installedJavas());
    if (chosen) return callback(null, { binary: chosen.binary, source: "auto", required: required, minecraft: minecraft });
  }
  if (!fallback) return callback("No Java runtime found on this host.");
  callback(null, { binary: fallback, source: "default", required: required, minecraft: minecraft });
}

// The Java version string a server will run with, for the web UI.
function usedJavaVersion(cwd, sc, callback) {
  resolveJava(cwd, sc, function (err, result) {
    if (err) return callback(null, err);
    try {
      var out = child_process.spawnSync(result.binary, ["-version"]);
      var text = (out.stderr || "").toString() + (out.stdout || "").toString();
      var m = /version "([^"]+)"/.exec(text);
      callback(null, m ? m[1] : `unknown (${result.binary})`);
    } catch (e) {
      callback(null, `Error running '${result.binary}'`);
    }
  });
}

module.exports = {
  requiredJavaForMinecraft,
  minecraftFromNeoForge,
  minecraftFromJarName,
  minecraftFromServerDir,
  minecraftFromProfile,
  requiredJavaFromJar,
  installedJavas,
  pickJava,
  resolveJava,
  usedJavaVersion,
};
