import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../public/staff.js", import.meta.url), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `manca ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `manca ${endMarker}`);
  return source.slice(start, end);
}

const load = sliceBetween('async function loadSupportRequests', 'function supportSubject');
const build = sliceBetween('function buildOperationalCases()', 'function filteredCases()');
const render = sliceBetween('function renderCases()', 'async function loadCases');
const open = sliceBetween('async function openSupportCase(item)', 'async function sendSupportReply');
const send = sliceBetween('async function sendSupportReply(event)', 'function viewSupportCustomer');
const close = sliceBetween('async function closeSupportCase()', 'async function deleteSupportCase');

test('Staff: carica anche i messaggi staff e il nuovo stato resolved_at', () => {
  assert.doesNotMatch(load, /\.eq\("direction", "user_to_staff"\)/);
  assert.match(load, /premium_communications/);
  assert.match(load, /resolved_at/);
});

test('Staff: le pratiche supporto chiuse restano in elenco e usano resolved_at', () => {
  assert.match(build, /const supportGroups = new Map\(\)/);
  assert.match(build, /const closed = !userMessages\.some\(message => !message\.resolved_at\)/);
  assert.match(build, /status: closed \? "chiusa" : "aperta"/);
  assert.match(build, /closed,/);
  assert.doesNotMatch(build, /const closed = !userMessages\.some\(message => !message\.read_at\)/);
});

test('Staff: i contatori operativi escludono le pratiche chiuse ma la tabella usa cache.cases', () => {
  assert.match(render, /const activeCases = cache\.cases\.filter\(item => !item\.closed\)/);
  assert.match(render, /const rows = filteredCases\(\)/);
  assert.match(render, /caseMetricTotal"\), activeCases\.length/);
});

test('Staff: una pratica chiusa può restare nel dialog e ricevere altri messaggi', () => {
  assert.match(open, /item\.closed \? "CHIUSA" : "ROSSO"/);
  assert.match(open, /closeButton\.disabled = Boolean\(item\.closed\)/);
  assert.doesNotMatch(send, /if \(activeSupportCase\.closed\) return/);
  assert.match(send, /Messaggio inviato al cliente\. La pratica resta chiusa/);
});

test('Staff: CHIUDI distingue risoluzione da eliminazione e blocca la doppia chiusura', () => {
  assert.match(close, /if \(activeSupportCase\.closed\)/);
  assert.match(close, /restare nell’elenco|resterà nell’elenco/);
  assert.match(close, /resolved_at/);
  assert.doesNotMatch(close, /\.delete\(\)/);
});
