var mc_version = require("../mc_version");
var test = exports;

test.required_java_for_minecraft = function (t) {
  t.equal(mc_version.requiredJavaForMinecraft("26.1"), 25);
  t.equal(mc_version.requiredJavaForMinecraft("26.3.1"), 25);
  t.equal(mc_version.requiredJavaForMinecraft("1.21.5"), 21);
  t.equal(mc_version.requiredJavaForMinecraft("1.20.5"), 21);
  t.equal(mc_version.requiredJavaForMinecraft("1.20.4"), 17);
  t.equal(mc_version.requiredJavaForMinecraft("1.18"), 17);
  t.equal(mc_version.requiredJavaForMinecraft("1.17.1"), 16);
  t.equal(mc_version.requiredJavaForMinecraft("1.16.5"), 8);
  t.equal(mc_version.requiredJavaForMinecraft("1.7.10"), 8);
  t.equal(mc_version.requiredJavaForMinecraft(""), null);
  t.equal(mc_version.requiredJavaForMinecraft("latest"), null);
  t.done();
};

test.minecraft_from_neoforge = function (t) {
  t.equal(mc_version.minecraftFromNeoForge("21.1.229"), "1.21.1");
  t.equal(mc_version.minecraftFromNeoForge("21.4.111-beta"), "1.21.4");
  t.equal(mc_version.minecraftFromNeoForge("21.0.167"), "1.21");
  t.equal(mc_version.minecraftFromNeoForge("20.4.237"), "1.20.4");
  t.equal(mc_version.minecraftFromNeoForge("26.1.0.12-beta"), "26.1");
  t.equal(mc_version.minecraftFromNeoForge("26.3.0.48-beta"), "26.3");
  t.equal(mc_version.minecraftFromNeoForge("26.3.1.5"), "26.3.1");
  t.equal(mc_version.minecraftFromNeoForge("26.1.0.0-alpha.1+snapshot-1"), "26.1");
  t.equal(mc_version.minecraftFromNeoForge("not-a-version"), null);
  t.done();
};

test.minecraft_from_jar_name = function (t) {
  t.equal(mc_version.minecraftFromJarName("minecraft_server.26.3.jar"), "26.3");
  t.equal(mc_version.minecraftFromJarName("minecraft_server.1.21.5.jar"), "1.21.5");
  t.equal(mc_version.minecraftFromJarName("fabric-server-mc.1.21.1-loader.0.17.3-launcher.1.1.0.jar"), "1.21.1");
  t.equal(mc_version.minecraftFromJarName("forge-1.21.1-52.1.6-installer.jar"), "1.21.1");
  t.equal(mc_version.minecraftFromJarName("paper-1.21.4-232.jar"), "1.21.4");
  t.equal(mc_version.minecraftFromJarName("server.jar"), null);
  t.done();
};

test.minecraft_from_profile = function (t) {
  t.equal(mc_version.minecraftFromProfile("1.21.5-latest"), "1.21.5");
  t.equal(mc_version.minecraftFromProfile("1.19"), "1.19");
  t.equal(mc_version.minecraftFromProfile("26.3"), "26.3");
  t.equal(mc_version.minecraftFromProfile("21.1.229"), "1.21.1");
  t.equal(mc_version.minecraftFromProfile(""), null);
  t.done();
};

test.compare_versions = function (t) {
  t.ok(mc_version.compareVersions("1.21.10", "1.21.9") > 0);
  t.ok(mc_version.compareVersions("26.1", "1.21.11") > 0);
  t.equal(mc_version.compareVersions("1.21", "1.21.0"), 0);
  t.done();
};

test.parse_neoforge = function (t) {
  t.deepEqual(mc_version.parseNeoForge("21.1.229"), { minecraft: "1.21.1", prerelease: null });
  t.deepEqual(mc_version.parseNeoForge("21.4.111-beta"), { minecraft: "1.21.4", prerelease: "beta" });
  t.deepEqual(mc_version.parseNeoForge("26.3.0.48-beta"), { minecraft: "26.3", prerelease: "beta" });
  t.deepEqual(mc_version.parseNeoForge("26.1.0.0-alpha.1+snapshot-1"), { minecraft: "26.1", prerelease: "alpha" });
  t.equal(mc_version.parseNeoForge("21.1.229/../x"), null);
  t.equal(mc_version.parseNeoForge("latest"), null);
  t.done();
};
