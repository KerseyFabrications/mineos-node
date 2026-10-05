var mineos = require("../mineos");
var test = exports;

// A running server is found by its screen session's command line. The start
// command has used both -dmS and -dmSL (logging); both must be recognized,
// and other screen invocations must not be.
test.screen_regex = function (t) {
  function name(cmdline) {
    var m = mineos.SCREEN_REGEX.exec(cmdline);
    return m ? m[1] : null;
  }
  t.equal(name("/usr/bin/SCREEN -dmSL mc-TestWorld /usr/bin/java -server -jar server.jar nogui"), "TestWorld");
  t.equal(name("SCREEN -dmS mc-TestWorld java -server -jar server.jar"), "TestWorld");
  t.equal(name("screen -dmSL mc-a.b_c ./Cuberite"), "a.b_c");
  t.equal(name("/usr/bin/screen -r mc-TestWorld"), null);
  t.equal(name("java -jar screen.jar"), null);
  t.done();
};
