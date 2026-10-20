import { test } from "node:test";
import assert from "node:assert/strict";
import { zoomLabel } from "../fractal_explorer/static/numbers.mjs";

test("zoom labels preserve exponents beyond JavaScript Number range", () => {
  assert.equal(zoomLabel("3.6"), "1×");
  assert.equal(zoomLabel("16"), "0.23×");
  assert.equal(zoomLabel("1e-80"), "3.60e+80×");
  assert.equal(zoomLabel("1E-1000"), "3.60e+1000×");
  assert.equal(zoomLabel("1e-10000"), "3.60e+10000×");
  assert.equal(zoomLabel("0.00010e-996"), "3.60e+1000×");
});
