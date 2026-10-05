var path = require('path');
var fs = require('fs-extra');
var crypto = require('crypto');
var profile = require('./template');
var java = require('../java');
var mc_version = require('../mc_version');

// NeoForged ServerStarterJar, pinned so every install runs the same reviewed
// launcher. To update: take the new release's server.jar digest from
// https://github.com/neoforged/ServerStarterJar/releases.
var SERVER_STARTER_VERSION = '0.1.35';
var SERVER_STARTER_SHA256 = 'd019d815868d451e57bdb965174b8443ec361336e84e9c41abc41a6c627bacd1';
var SERVER_STARTER_URL = 'https://github.com/neoforged/ServerStarterJar/releases/download/{0}/server.jar';

var INSTALLER_TIMEOUT_MS = 15 * 60 * 1000;

// The installer is downloaded code that runs Java. Run it as an unprivileged
// user (nobody) in a directory that user owns, never as root; the profile
// directory is handed back to root afterwards like every other profile.
var INSTALLER_UID = 65534;
var INSTALLER_GID = 65534;

exports.profile = {
  name: 'NeoForge Mod',
  request_args: {
    url: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
    json: false
  },
  handler: function (profile_dir, body, callback) {
    var p = [];
    try {
      var xml = body.toString();

      var version_regex = /<version>([^<]+)<\/version>/g;
      var versions = [];
      var match;
      while ((match = version_regex.exec(xml)) !== null) {
        versions.push(match[1]);
      }

      for (var i = 0; i < versions.length; i++) {
        var nfver = versions[i];
        var parsed = mc_version.parseNeoForge(nfver);
        if (!parsed) continue;
        var mcver = parsed.minecraft;
        var is_prerelease = !!parsed.prerelease;

        var item = new profile();
        item['id'] = nfver;
        item['type'] = is_prerelease ? 'snapshot' : 'release';
        item['group'] = 'neoforge';
        item['webui_desc'] = is_prerelease
          ? 'NeoForge {0} (MC {1}, {2})'.format(nfver, mcver, parsed.prerelease)
          : 'NeoForge {0} (MC {1})'.format(nfver, mcver);
        item['weight'] = 0;
        item['version'] = nfver;
        item['release_version'] = nfver;
        item['filename'] = 'neoforge-{0}-installer.jar'.format(nfver);
        item['url'] = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/{0}/{1}'.format(nfver, item['filename']);
        item['downloaded'] = fs.existsSync(path.join(profile_dir, item.id, 'server.jar'));
        p.push(item);
      }
    } catch (e) { }
    callback(null, p);
  }, //end handler

  postdownload: function (profile_dir, dest_filepath, callback) {
    // dest_filepath points at the installer that was just written into
    // profile_dir/<id>/. We need to:
    //   1. Run the installer with --installServer to lay down libraries/
    //      and the run.sh / run.bat / user_jvm_args.txt scaffolding.
    //   2. Drop NeoForged ServerStarterJar in the same dir so MineOS has
    //      a launchable jar to pick from its Java Settings dropdown.
    //
    // ServerStarterJar parses run.sh, builds the module layer in-process,
    // and chains to cpw.mods.bootstraplauncher.BootstrapLauncher, so
    // MineOS' stock `java -Xms -Xmx -jar <jar> nogui` invocation works.
    //
    // server.jar is only written once both steps succeed, so the profile
    // shows as downloaded only when it can actually start a server.
    var child_process = require('child_process');
    var request = require('request');

    var install_dir = path.dirname(dest_filepath);
    var nfver = path.basename(install_dir);
    var server_jar = path.join(install_dir, 'server.jar');
    var partial_jar = server_jar + '.part';

    var done = false;
    function finish(err) {
      if (done) return;
      done = true;
      if (err) fs.remove(partial_jar, function () { callback(err); });
      else callback(null);
    }

    // The installer runs the target version's processors, so run it on the
    // Java that version's servers will use.
    var required = mc_version.requiredJavaForMinecraft(mc_version.minecraftFromNeoForge(nfver));
    var picked = required ? java.chooseJava(required) : null;
    var java_binary = picked ? picked.binary : 'java';

    function chown_tree(owner, cb) {
      child_process.execFile('chown', ['-R', owner, install_dir], function (err) {
        cb(err ? new Error('could not change ownership of ' + install_dir + ': ' + err.message) : null);
      });
    }

    // The installer runs in its own process group, so on a timeout everything
    // it started is killed with it, not just the java process.
    function run_installer(callback) {
      var stderr = '';
      var called = false;
      function cb(err) {
        if (called) return;
        called = true;
        callback(err);
      }
      var child = child_process.spawn(java_binary, ['-jar', dest_filepath, '--installServer'], {
        cwd: install_dir,
        uid: INSTALLER_UID,
        gid: INSTALLER_GID,
        env: { PATH: process.env.PATH, HOME: install_dir },
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
      var timer = setTimeout(function () {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
      }, INSTALLER_TIMEOUT_MS);
      child.stderr.on('data', function (chunk) {
        if (stderr.length < 64 * 1024) stderr += chunk;
      });
      child.on('error', function (err) {
        clearTimeout(timer);
        cb(new Error('NeoForge installer failed: ' + err.message));
      });
      child.on('close', function (code, signal) {
        clearTimeout(timer);
        try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {} // anything it left running
        if (code === 0) cb(null);
        else cb(new Error('NeoForge installer failed: ' + (stderr || (signal ? 'killed by ' + signal : 'exit code ' + code))));
      });
    }

    // Hand the tree back to root, and take away any write or set-id bits the
    // installer gave its files: a shared profile must not be writable by others.
    function restore_tree(cb) {
      chown_tree('0:0', function (err) {
        if (err) return cb(err);
        child_process.execFile('chmod', ['-R', 'u+rwX,go-w,ug-s', install_dir], function (chmod_err) {
          cb(chmod_err ? new Error('could not reset permissions of ' + install_dir + ': ' + chmod_err.message) : null);
        });
      });
    }

    chown_tree(INSTALLER_UID + ':' + INSTALLER_GID, function (chown_err) {
      if (chown_err) return finish(chown_err);
      run_installer(function (install_err) {
        restore_tree(function (restore_err) {
          if (install_err || restore_err) return finish(install_err || restore_err);
          download_starter();
        });
      });
    });

    function download_starter() {
      var hash = crypto.createHash('sha256');
      var stream = fs.createWriteStream(partial_jar);
      stream.on('error', finish);
      stream.on('finish', function () {
        var digest = hash.digest('hex');
        if (digest != SERVER_STARTER_SHA256)
          return finish(new Error('ServerStarterJar checksum mismatch: got ' + digest));
        fs.move(partial_jar, server_jar, { overwrite: true }, finish);
      });

      request(SERVER_STARTER_URL.format(SERVER_STARTER_VERSION))
        .on('error', finish)
        .on('response', function (res) {
          if (res.statusCode != 200)
            finish(new Error('ServerStarterJar download failed: HTTP ' + res.statusCode));
        })
        .on('data', function (chunk) {
          hash.update(chunk);
        })
        .pipe(stream);
    }
  } //end postdownload
};
