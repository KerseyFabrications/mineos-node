// Minecraft version names: which Java a version needs, and the Minecraft
// version encoded in loader version names, jar names and profile ids. Pure
// string handling, shared by java.js and the profiles.

var path = require("path");

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

// NeoForge versions encode the Minecraft version. Up to 1.21.x they are
// <mc minor>.<mc patch>.<build> (21.1.229 is 1.21.1); from 26.x on they are
// <year>.<drop>.<hotfix>.<build> (26.3.0.48-beta is 26.3).
function minecraftFromNeoForge(nf_version) {
  var m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(nf_version || ""));
  if (!m) return null;
  var major = parseInt(m[1], 10);
  if (major >= 26) return m[3] == "0" ? `${m[1]}.${m[2]}` : `${m[1]}.${m[2]}.${m[3]}`;
  return m[2] == "0" ? `1.${m[1]}` : `1.${m[1]}.${m[2]}`;
}

// Orders Minecraft versions (1.21.1 < 1.21.10 < 26.1).
function compareVersions(a, b) {
  var pa = String(a).split(".").map(Number);
  var pb = String(b).split(".").map(Number);
  for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
    var d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function highest(versions) {
  return versions.filter(Boolean).sort(compareVersions).pop() || null;
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

// Minecraft version from a profile id: plain versions (1.21.5, 26.3,
// 1.21.1-latest) or a NeoForge build number (21.1.229).
function minecraftFromProfile(profile) {
  var id = String(profile || "");
  var plain = /^((?:1\.\d+(?:\.\d+)?)|(?:2[6-9]|[3-9]\d)\.\d+(?:\.\d+)?)(?:$|-)/.exec(id);
  if (plain) return plain[1];
  return minecraftFromNeoForge(id);
}

// NeoForge release names: <mc minor>.<mc patch>.<build> up to 1.21.x
// (21.4.111-beta is Minecraft 1.21.4), <year>.<drop>.<hotfix>.<build> from
// 26.x on (26.3.0.48-beta is 26.3), with an optional pre-release suffix.
var NEOFORGE_RELEASE = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(-[0-9A-Za-z.+-]+)?$/;

// A NeoForge release name as {minecraft, prerelease}, where prerelease is the
// suffix's first word ("beta", "alpha") or null; null if it is not a release name.
function parseNeoForge(nf_version) {
  var m = NEOFORGE_RELEASE.exec(String(nf_version || ""));
  if (!m) return null;
  var minecraft = minecraftFromNeoForge(nf_version);
  if (!minecraft) return null;
  return { minecraft: minecraft, prerelease: m[5] ? m[5].slice(1).split(/[.+]/)[0] : null };
}

module.exports = {
  compareVersions,
  highest,
  requiredJavaForMinecraft,
  minecraftFromNeoForge,
  minecraftFromJarName,
  minecraftFromProfile,
  parseNeoForge,
};
