var mineos = require("../mineos");
var test = exports;

// Prune and restore act on the step number, so it must always count from the
// newest backup, whichever order rdiff-backup printed them in.
var rows = [
  { time: "Mon Oct  5 02:17:48 2026", size: "56 bytes", cum: "4.12 KB" },
  { time: "Mon Oct  5 02:17:50 2026", size: "58 bytes", cum: "4.06 KB" },
  { time: "Mon Oct  5 02:17:51 2026", size: "4.01 KB", cum: "4.01 KB" },
];

function steps(list) {
  return list.map(function (e) {
    return e.step + " " + e.time;
  });
}

test.oldest_first_output = function (t) {
  var copy = rows.map(function (r) { return Object.assign({}, r); });
  t.deepEqual(steps(mineos.number_increments(copy)), [
    "0B Mon Oct  5 02:17:51 2026",
    "1B Mon Oct  5 02:17:50 2026",
    "2B Mon Oct  5 02:17:48 2026",
  ]);
  t.done();
};

test.newest_first_output = function (t) {
  var copy = rows.map(function (r) { return Object.assign({}, r); }).reverse();
  t.deepEqual(steps(mineos.number_increments(copy)), [
    "0B Mon Oct  5 02:17:51 2026",
    "1B Mon Oct  5 02:17:50 2026",
    "2B Mon Oct  5 02:17:48 2026",
  ]);
  t.done();
};
