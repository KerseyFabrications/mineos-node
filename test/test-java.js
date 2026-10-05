var fs = require("fs");
var os = require("os");
var path = require("path");
var java = require("../java");
var test = exports;

test.required_java_for_minecraft = function (t) {
  t.equal(java.requiredJavaForMinecraft("26.1"), 25);
  t.equal(java.requiredJavaForMinecraft("26.3.1"), 25);
  t.equal(java.requiredJavaForMinecraft("1.21.5"), 21);
  t.equal(java.requiredJavaForMinecraft("1.20.5"), 21);
  t.equal(java.requiredJavaForMinecraft("1.20.4"), 17);
  t.equal(java.requiredJavaForMinecraft("1.18"), 17);
  t.equal(java.requiredJavaForMinecraft("1.17.1"), 16);
  t.equal(java.requiredJavaForMinecraft("1.16.5"), 8);
  t.equal(java.requiredJavaForMinecraft("1.7.10"), 8);
  t.equal(java.requiredJavaForMinecraft(""), null);
  t.equal(java.requiredJavaForMinecraft("latest"), null);
  t.done();
};

test.minecraft_from_neoforge = function (t) {
  t.equal(java.minecraftFromNeoForge("21.1.229"), "1.21.1");
  t.equal(java.minecraftFromNeoForge("21.4.111-beta"), "1.21.4");
  t.equal(java.minecraftFromNeoForge("21.0.167"), "1.21");
  t.equal(java.minecraftFromNeoForge("20.4.237"), "1.20.4");
  t.equal(java.minecraftFromNeoForge("26.1.0.12-beta"), "26.1");
  t.equal(java.minecraftFromNeoForge("26.3.0.48-beta"), "26.3");
  t.equal(java.minecraftFromNeoForge("26.3.1.5"), "26.3.1");
  t.equal(java.minecraftFromNeoForge("26.1.0.0-alpha.1+snapshot-1"), "26.1");
  t.equal(java.minecraftFromNeoForge("not-a-version"), null);
  t.done();
};

test.minecraft_from_jar_name = function (t) {
  t.equal(java.minecraftFromJarName("minecraft_server.26.3.jar"), "26.3");
  t.equal(java.minecraftFromJarName("minecraft_server.1.21.5.jar"), "1.21.5");
  t.equal(java.minecraftFromJarName("fabric-server-mc.1.21.1-loader.0.17.3-launcher.1.1.0.jar"), "1.21.1");
  t.equal(java.minecraftFromJarName("forge-1.21.1-52.1.6-installer.jar"), "1.21.1");
  t.equal(java.minecraftFromJarName("paper-1.21.4-232.jar"), "1.21.4");
  t.equal(java.minecraftFromJarName("server.jar"), null);
  t.done();
};

test.minecraft_from_profile = function (t) {
  t.equal(java.minecraftFromProfile("1.21.5-latest"), "1.21.5");
  t.equal(java.minecraftFromProfile("1.19"), "1.19");
  t.equal(java.minecraftFromProfile("26.3"), "26.3");
  t.equal(java.minecraftFromProfile("21.1.229"), "1.21.1");
  t.equal(java.minecraftFromProfile(""), null);
  t.done();
};

test.minecraft_from_server_dir = function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  t.equal(java.minecraftFromServerDir(dir), null);

  fs.mkdirSync(path.join(dir, "libraries/net/neoforged/neoforge/21.1.229"), { recursive: true });
  t.equal(java.minecraftFromServerDir(dir), "1.21.1");

  // the vanilla jar an installer laid down outranks the loader version
  fs.mkdirSync(path.join(dir, "libraries/net/minecraft/server/1.21.1-20240808.144430"), { recursive: true });
  t.equal(java.minecraftFromServerDir(dir), "1.21.1");

  // upgraded in place: the old version's directories stay, the highest wins
  fs.mkdirSync(path.join(dir, "libraries/net/neoforged/neoforge/26.3.0.48-beta"), { recursive: true });
  t.equal(java.minecraftFromServerDir(dir), "26.3");

  var fabric = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  fs.mkdirSync(path.join(fabric, ".fabric/server"), { recursive: true });
  fs.writeFileSync(path.join(fabric, ".fabric/server/1.21.5-server.jar"), "");
  t.equal(java.minecraftFromServerDir(fabric), "1.21.5");

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(fabric, { recursive: true, force: true });
  t.done();
};

test.pick_java = function (t) {
  var all = [
    { major: 25, binary: "/j25" },
    { major: 21, binary: "/j21" },
    { major: 8, binary: "/j8" },
  ];
  t.equal(java.pickJava(25, all).binary, "/j25");
  t.equal(java.pickJava(21, all).binary, "/j21");
  t.equal(java.pickJava(17, all).binary, "/j21", "17 runs on the next newer runtime");
  t.equal(java.pickJava(16, all).binary, "/j21", "1.17 runs on 17 and newer");
  t.equal(java.pickJava(8, all).binary, "/j8");
  t.equal(java.pickJava(8, [{ major: 21, binary: "/j21" }]), null, "legacy never moves to a modern runtime");
  t.equal(java.pickJava(25, [{ major: 21, binary: "/j21" }]), null, "never an older runtime than required");
  t.done();
};

test.installed_javas = function (t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-jvm-"));
  function fake(rel) {
    var file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "#!/bin/sh\n");
    fs.chmodSync(file, 0o755);
  }
  fake("java-25-openjdk-amd64/bin/java");
  fake("java-8-openjdk-amd64/jre/bin/java");
  fake("temurin-21-jdk/bin/java");
  fs.mkdirSync(path.join(root, "default-java"));

  var found = java.installedJavas(root);
  t.deepEqual(
    found.map(function (j) {
      return j.major;
    }),
    [25, 21, 8],
  );
  t.equal(found[2].binary, path.join(root, "java-8-openjdk-amd64/jre/bin/java"));
  fs.rmSync(root, { recursive: true, force: true });
  t.done();
};

test.resolve_rejects_non_executable = function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  fs.writeFileSync(path.join(dir, "server.jar"), "");
  java.resolveJava(dir, { java: { java_binary: "server.jar", jarfile: "server.jar" } }, function (err) {
    t.ok(err && err.indexOf("not an executable") != -1, "a jar is not a Java runtime");
    fs.rmSync(dir, { recursive: true, force: true });
    t.done();
  });
};

test.required_java_from_jar = function (t) {
  var AdmZip = require("adm-zip");
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  var jar = new AdmZip();
  jar.addFile("version.json", Buffer.from(JSON.stringify({ id: "26.3", java_version: 25 })));
  jar.writeZip(path.join(dir, "minecraft_server.26.3.jar"));
  t.equal(java.requiredJavaFromJar(path.join(dir, "minecraft_server.26.3.jar")), 25);
  t.equal(java.requiredJavaFromJar(path.join(dir, "missing.jar")), null);
  fs.rmSync(dir, { recursive: true, force: true });
  t.done();
};

test.compare_versions = function (t) {
  t.ok(java.compareVersions("1.21.10", "1.21.9") > 0);
  t.ok(java.compareVersions("26.1", "1.21.11") > 0);
  t.equal(java.compareVersions("1.21", "1.21.0"), 0);
  t.done();
};

test.profile_outranks_stale_libraries = function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  fs.mkdirSync(path.join(dir, "libraries/net/minecraft/server/1.21.1-20240808.144430"), { recursive: true });
  var javas = [{ major: 25, binary: "/j25" }, { major: 21, binary: "/j21" }];
  var sc = { java: { jarfile: "server.jar" }, minecraft: { profile: "26.3.0.48-beta" } };
  java.resolveJava(dir, sc, function (err, picked) {
    t.equal(picked.minecraft, "26.3");
    t.equal(picked.required, 25);
    t.equal(picked.binary, "/j25");
    fs.rmSync(dir, { recursive: true, force: true });
    t.done();
  }, javas);
};

test.legacy_server_without_java_8 = function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  var sc = { java: { jarfile: "minecraft_server.1.12.2.jar" } };
  java.resolveJava(dir, sc, function (err, picked) {
    t.ok(err && err.indexOf("needs Java 8") != -1, "refuses rather than running on Java 21");
    java.resolveJava(dir, sc, function (err2, picked2) {
      t.equal(picked2.binary, "/j8");
      fs.rmSync(dir, { recursive: true, force: true });
      t.done();
    }, [{ major: 21, binary: "/j21" }, { major: 8, binary: "/j8" }]);
  }, [{ major: 21, binary: "/j21" }]);
};

test.required_java_from_jar_refuses_non_files = function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  fs.symlinkSync("/dev/zero", path.join(dir, "server.jar"));
  t.equal(java.requiredJavaFromJar(path.join(dir, "server.jar")), null, "a symlink is not read");
  fs.mkdirSync(path.join(dir, "dir.jar"));
  t.equal(java.requiredJavaFromJar(path.join(dir, "dir.jar")), null, "a directory is not read");
  fs.rmSync(dir, { recursive: true, force: true });
  t.done();
};

test.used_java_version_runs_as_owner = function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  var fake = path.join(dir, "fakejava");
  // prints the uid it runs as inside the version string
  fs.writeFileSync(fake, '#!/bin/sh\necho "openjdk version \\"uid-$(id -u)\\"" >&2\n');
  fs.chmodSync(fake, 0o755);
  var sc = { java: { java_binary: fake } };
  java.usedJavaVersion(dir, sc, null, function (err, unknown) {
    t.equal(unknown, "unknown", "without an owner nothing is run");
    var me = { uid: process.getuid(), gid: process.getgid() };
    java.usedJavaVersion(dir, sc, me, function (err2, version) {
      t.equal(version, "uid-" + process.getuid());
      fs.rmSync(dir, { recursive: true, force: true });
      t.done();
    });
  });
};

test.java_on_path_is_considered = function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "mineos-java-"));
  var fake = path.join(dir, "java");
  fs.writeFileSync(fake, '#!/bin/sh\necho \'openjdk version "1.8.0_402"\' >&2\n');
  fs.chmodSync(fake, 0o755);
  var saved = process.env.PATH;
  process.env.PATH = dir + ":" + saved;
  try {
    var majors = java.availableJavas().map(function (j) {
      return j.major;
    });
    t.ok(majors.indexOf(8) != -1, "a Java 8 on PATH counts even outside /usr/lib/jvm");
  } finally {
    process.env.PATH = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  t.done();
};
