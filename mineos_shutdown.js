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

// List names of running servers
var servers = mineos.server_list_up();

// Read base directory configurations
var mineos_config = read_ini('/etc/mineos.conf') || read_ini('/usr/local/etc/mineos.conf') || {};
var base_directory = '/var/games/minecraft';

if ('base_directory' in mineos_config) {
    try {
        if (mineos_config['base_directory'].length < 2)
            throw new error('Invalid base_directory length.');

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

// List of running servers
var server_watches=[]

function make_cb(server_watch)
{
    return function() {
        console.log("    stopped server",server_watch.name);
        server_watch.running = false;
        for (w of server_watches) {
            if (w.running){
                console.log("  waiting for",w.name);
            }
        }                
    };
}

for (server of servers) {
    
    // obect to track state of server
    var server_watch = {name:server, running:true};
    server_watches.push(server_watch);    
    
    var instance = new mineos.mc(server, base_directory);
    console.log("Stopping", server);
    cb_stopped = make_cb(server_watch);
    
    instance.stop(cb_stopped);

}
console.log("Waiting for servers to stop");

// instance.stop() gives up waiting after about 30 seconds, but a large or
// modded world can take longer to save. Keep waiting until every server has
// exited or MINEOS_SHUTDOWN_TIMEOUT (seconds, default 120) runs out, so the
// caller only kills what is left after that.
var shutdown_timeout_s = parseInt(process.env.MINEOS_SHUTDOWN_TIMEOUT, 10) || 120;
var shutdown_deadline = Date.now() + shutdown_timeout_s * 1000;
var shutdown_poll = setInterval(function () {
    var still_up = Object.keys(mineos.server_pids_up());
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
