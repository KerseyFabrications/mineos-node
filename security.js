// Request checks that keep another web site from acting through a logged-in
// browser (cross-site request forgery and cross-site WebSocket hijacking).

// Commands the HTTP API accepts. Anything else (internal helpers, property
// readers) is refused, so a request can only do what the web UI itself can.
var API_COMMANDS = [
  "accept_eula",
  "archive",
  "backup",
  "kill",
  "modify_sc",
  "modify_sp",
  "prune",
  "renice",
  "restart",
  "restore",
  "saveall_latest_log",
  "start",
  "stop",
  "stop_and_backup",
  "stuff",
];

// The host a request was addressed to, as the browser saw it. Behind a reverse
// proxy that is X-Forwarded-Host; the first entry wins when there are several.
function requestHost(req) {
  var forwarded = req.headers["x-forwarded-host"];
  if (forwarded) return String(forwarded).split(",")[0].trim().toLowerCase();
  return String(req.headers.host || "").toLowerCase();
}

// True unless the request carries an Origin (or, failing that, a Referer) from
// a different host. Browsers send Origin on every cross-site POST and WebSocket
// handshake, so a request with neither comes from a non-browser client, which a
// forged cross-site request cannot be.
function sameOrigin(req) {
  var source = req.headers.origin || req.headers.referer;
  if (!source || source == "null") return !req.headers.origin;
  var host;
  try {
    host = new URL(source).host.toLowerCase();
  } catch (e) {
    return false;
  }
  return host == requestHost(req);
}

// Express middleware: refuse state-changing requests from another origin.
function requireSameOrigin(req, res, next) {
  if (req.method == "GET" || req.method == "HEAD" || req.method == "OPTIONS") return next();
  if (sameOrigin(req)) return next();
  console.warn(`Refused cross-origin ${req.method} ${req.originalUrl} from ${req.headers.origin || req.headers.referer}`);
  res.status(403).end();
}

// engine.io allowRequest hook: refuse WebSocket and polling handshakes from
// another origin before any session is attached.
//
// JSONP polling is refused outright: a <script> tag can request it without
// sending Origin or Referer, and the web UI only uses XHR or WebSocket.
function allowSocketRequest(req, callback) {
  if (isJsonp(req)) {
    console.warn("Refused JSONP socket.io handshake");
    return callback(null, false);
  }
  var ok = sameOrigin(req);
  if (!ok) console.warn("Refused cross-origin socket.io handshake from", req.headers.origin);
  callback(null, ok);
}

function isJsonp(req) {
  var query = req._query || {};
  if ("j" in query) return true;
  try {
    return new URL(req.url || "/", "http://x").searchParams.has("j");
  } catch (e) {
    return false;
  }
}

function isApiCommand(command) {
  return API_COMMANDS.indexOf(command) != -1;
}

module.exports = {
  API_COMMANDS,
  requestHost,
  sameOrigin,
  requireSameOrigin,
  allowSocketRequest,
  isApiCommand,
};
