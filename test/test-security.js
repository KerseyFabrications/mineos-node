var security = require("../security");
var test = exports;

function req(headers, method) {
  return { method: method || "POST", originalUrl: "/api/x/stop", headers: headers };
}

test.same_origin = function (t) {
  t.ok(security.sameOrigin(req({ host: "nas.local:8443", origin: "https://nas.local:8443" })));
  t.ok(security.sameOrigin(req({ host: "NAS.local:8443", origin: "https://nas.local:8443" })), "host is case-insensitive");
  t.ok(!security.sameOrigin(req({ host: "nas.local:8443", origin: "https://evil.example" })));
  t.ok(!security.sameOrigin(req({ host: "nas.local:8443", origin: "https://nas.local:9999" })), "port is part of the origin");
  t.ok(!security.sameOrigin(req({ host: "nas.local:8443", origin: "null" })), "opaque origins are refused");
  t.ok(security.sameOrigin(req({ host: "nas.local:8443", referer: "https://nas.local:8443/admin/index.html" })));
  t.ok(!security.sameOrigin(req({ host: "nas.local:8443", referer: "https://evil.example/page" })));
  t.ok(security.sameOrigin(req({ host: "nas.local:8443" })), "non-browser clients send neither header");
  t.ok(
    security.sameOrigin(req({ host: "10.0.0.5:8443", "x-forwarded-host": "mc.example.com", origin: "https://mc.example.com" })),
    "behind a reverse proxy the forwarded host is what the browser saw",
  );
  t.done();
};

test.require_same_origin_middleware = function (t) {
  var status = null;
  var res = {
    status: function (s) {
      status = s;
      return this;
    },
    end: function () {},
  };
  var passed = false;
  security.requireSameOrigin(req({ host: "a:1", origin: "https://b:1" }, "GET"), res, function () {
    passed = true;
  });
  t.ok(passed, "GET is not state-changing and passes");

  passed = false;
  security.requireSameOrigin(req({ host: "a:1", origin: "https://b:1" }, "POST"), res, function () {
    passed = true;
  });
  t.ok(!passed);
  t.equal(status, 403);
  t.done();
};

test.socket_handshake = function (t) {
  security.allowSocketRequest(req({ host: "a:1", origin: "https://b:1" }, "GET"), function (err, ok) {
    t.equal(ok, false);
    security.allowSocketRequest(req({ host: "a:1", origin: "http://a:1" }, "GET"), function (err2, ok2) {
      t.equal(ok2, true);
      t.done();
    });
  });
};

test.api_commands = function (t) {
  t.ok(security.isApiCommand("start"));
  t.ok(security.isApiCommand("stop"));
  t.ok(!security.isApiCommand("delete"), "deleting a server is not available over the HTTP API");
  t.ok(!security.isApiCommand("property"));
  t.ok(!security.isApiCommand("__proto__"));
  t.ok(!security.isApiCommand(undefined));
  t.done();
};

test.socket_jsonp_refused = function (t) {
  // a <script> tag can load the JSONP transport with no Origin or Referer
  var r = { method: "GET", url: "/socket.io/?EIO=3&transport=polling&j=0", headers: { host: "a:1" } };
  security.allowSocketRequest(r, function (err, ok) {
    t.equal(ok, false);
    var xhr = { method: "GET", url: "/socket.io/?EIO=3&transport=polling", headers: { host: "a:1", referer: "http://a:1/admin/index.html" } };
    security.allowSocketRequest(xhr, function (err2, ok2) {
      t.equal(ok2, true);
      t.done();
    });
  });
};
