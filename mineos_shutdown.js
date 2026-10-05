#!/usr/bin/env node

var getopt = require('node-getopt');
var mineos = require('./mineos');
var fs = require('fs-extra');


function read_ini(filepath) {
    var ini = require('ini');
    try {
        var data = fs.readFileSync(filepath);
        return ini.parse(data.toString());
    } catch (e) {
        return null;
    }
}

console.log("Stopping running games");

// Read base directory configurations
var mineos_config = read_ini('/etc/mineos.conf') || read_ini('/usr/local/etc/mineos.conf') || {};
var base_directory = '/var/games/minecraft';

if ('base_directory' in mineos_config) {
    try {
        if (mineos_config['base_directory'].length < 2)
            throw new Error('Invalid base_directory length.');

        base_directory = mineos_config['base_directory'];
        fs.ensureDirSync(base_directory);

    } catch (e) {
        console.error(e.message, 'Aborting shutdown.');
        process.exit(2);
    }

    console.info('base_directory found in mineos.conf, using:', base_directory);
} else {
    console.error('base_directory not specified--missing mineos.conf?');
    console.error('Aborting startup.');
    process.exit(4);
}

// Send stop to every running server, and keep checking: a server started
// while this runs (a scheduled restart, a start from the web UI before it
// went down) is stopped too. Wait until every server has exited or
// MINEOS_SHUTDOWN_TIMEOUT (seconds, default 120, the same limit each server's
// stop uses) runs out. Exit 0 when all stopped, 1 on timeout.
var shutdown_timeout_s = mineos.stop_timeout_ms() / 1000;
var shutdown_deadline = Date.now() + shutdown_timeout_s * 1000;
var signalled = {};

function stop_new_servers() {
    var up = Object.keys(mineos.server_pids_up());
    for (var name of up) {
        if (name in signalled) continue;
        signalled[name] = true;
        var instance = new mineos.mc(name, base_directory);
        var report = function (server_name) {
            return function (err) {
                if (err) console.error("    could not stop", server_name, "cleanly:", err);
                else console.log("    stopped", server_name);
            };
        }(name);
        // Proxies (BungeeCord, Velocity) are "unconventional" servers: they have
        // no world to save and do not understand stop, so end them directly
        // instead of waiting out the timeout.
        instance.property("unconventional", function (instance, server_name, report) {
            return function (err, unconventional) {
                if (unconventional) {
                    console.log("Ending proxy", server_name);
                    instance.kill(report);
                } else {
                    console.log("Stopping", server_name);
                    instance.stop(report);
                }
            };
        }(instance, name, report));
    }
    return up;
}

console.log("Waiting for servers to stop");
stop_new_servers();
var shutdown_poll = setInterval(function () {
    var still_up = stop_new_servers();
    if (!still_up.length) {
        console.log("All servers stopped");
        clearInterval(shutdown_poll);
        process.exit(0);
    } else if (Date.now() > shutdown_deadline) {
        console.error("Timed out after", shutdown_timeout_s, "s; still running:", still_up.join(", "));
        clearInterval(shutdown_poll);
        process.exit(1);
    }
}, 1000);
