var path = require('path');
var fs = require('fs-extra');
var profile = require('./template');

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

      // NeoForge versions: <mc_minor>.<mc_patch>.<build>[-beta]
      // e.g. 21.4.111-beta -> Minecraft 1.21.4, build 111, beta
      var nf_regex = /^(\d+)\.(\d+)\.(\d+)(-beta)?$/;

      for (var i = 0; i < versions.length; i++) {
        var nfver = versions[i];
        var ver = nfver.match(nf_regex);
        if (!ver) continue;

        var mcver = '1.{0}.{1}'.format(ver[1], ver[2]);
        var is_beta = !!ver[4];

        var item = new profile();
        item['id'] = nfver;
        item['type'] = is_beta ? 'snapshot' : 'release';
        item['group'] = 'neoforge';
        item['webui_desc'] = is_beta
          ? 'NeoForge {0} (MC {1}, beta)'.format(nfver, mcver)
          : 'NeoForge {0} (MC {1})'.format(nfver, mcver);
        item['weight'] = 0;
        item['version'] = nfver;
        item['release_version'] = nfver;
        item['filename'] = 'neoforge-{0}-installer.jar'.format(nfver);
        item['url'] = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/{0}/{1}'.format(nfver, item['filename']);
        item['downloaded'] = fs.existsSync(path.join(profile_dir, item.id, item.filename));
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
    var child_process = require('child_process');
    var request = require('request');

    var install_dir = path.dirname(dest_filepath);
    var server_jar = path.join(install_dir, 'server.jar');
    var SERVER_STARTER_URL = 'https://github.com/neoforged/ServerStarterJar/releases/latest/download/server.jar';

    child_process.execFile(
      'java',
      ['-jar', dest_filepath, '--installServer'],
      { cwd: install_dir, maxBuffer: 10 * 1024 * 1024 },
      function (err, stdout, stderr) {
        if (err) {
          return callback(new Error('NeoForge installer failed: ' + (stderr || err.message)));
        }

        var stream = fs.createWriteStream(server_jar);
        request(SERVER_STARTER_URL)
          .on('error', function (dl_err) {
            callback(dl_err);
          })
          .pipe(stream)
          .on('finish', function () {
            callback(null);
          })
          .on('error', function (write_err) {
            callback(write_err);
          });
      }
    );
  } //end postdownload
};
