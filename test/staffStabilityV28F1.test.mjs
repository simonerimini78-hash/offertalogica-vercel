import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const staff = fs.readFileSync(path.join(root, 'public/staff.js'), 'utf8');
const governance = fs.readFileSync(path.join(root, 'public/staff-governance-v2.5B.js'), 'utf8');
const premium = fs.readFileSync(path.join(root, 'public/staff-premium.js'), 'utf8');

function sliceBetween(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing end marker: ${end}`);
  return source.slice(a, b);
}

test('Collaboratori keeps an explicit loaded-state cache', () => {
  assert.match(staff, /let collaboratorsLoaded = false;/);
  assert.match(staff, /collaboratorsLoaded = true;\s*renderCollaborators\(\);/);
  assert.match(staff, /if \(contextChanged\) collaboratorsLoaded = false;/);
});

test('Owner preloads Collaboratori with the initial overview', () => {
  const block = sliceBetween(staff, 'async function loadOverview', 'async function refreshTab');
  assert.match(block, /if \(isOwner\(\)\) tasks\.push\(loadCollaborators\(\{ silent: true \}\)\);/);
});

test('Returning to Collaboratori does not reload or rebuild when cache is ready', () => {
  const block = sliceBetween(staff, 'async function refreshTab', 'function staffContextDescriptor');
  assert.match(block, /if \(tab === "collaborators"\) \{\s*if \(silent && collaboratorsLoaded\) return;\s*return loadCollaborators\(\{ silent \}\);\s*\}/);
});

test('A real collaborator refresh emits one explicit synchronization event', () => {
  const block = sliceBetween(staff, 'async function loadCollaborators', 'async function loadSystemConfig');
  assert.match(block, /new CustomEvent\("offertalogica:collaborators-refreshed"/);
  assert.equal((block.match(/renderCollaborators\(\);/g) || []).length, 2, 'expected owner and non-owner render paths only');
});

test('V2.5 observer applies cached collaborator controls without network refresh', () => {
  const block = sliceBetween(governance, 'function bindObservers()', 'function startPeriodicRefresh');
  assert.match(block, /new MutationObserver\(\(\) => renderPermissionControls\(\)\)/);
  assert.doesNotMatch(block, /new MutationObserver\(\(\) => schedulePermissionRefresh\(\)\)/);
});

test('V2.8 collaborator observer applies cached matrix/status synchronously', () => {
  const block = sliceBetween(governance, 'function v28bBindObservers()', 'function v28bInit()');
  const observerStart = block.indexOf('const collaboratorRows = byId("collaboratorRows")');
  const observerEnd = block.indexOf('window.addEventListener("offertalogica:collaborators-refreshed"', observerStart);
  assert.ok(observerStart >= 0 && observerEnd > observerStart);
  const observer = block.slice(observerStart, observerEnd);
  assert.match(observer, /v28bRenderAccessControls\(\);/);
  assert.match(observer, /v28b1RenderActivationStatuses\(\);/);
  assert.doesNotMatch(observer, /v28bRefreshMatrix/);
  assert.doesNotMatch(observer, /v28b1RefreshActivationStatuses/);
});

test('Network refresh of collaborator governance happens only on explicit refreshed event', () => {
  const block = sliceBetween(governance, 'window.addEventListener("offertalogica:collaborators-refreshed"', 'const nav = document.querySelector("#staffApp .nav")');
  assert.match(block, /refreshPermissionControls\(\{ silent: true \}\)/);
  assert.match(block, /v28bRefreshMatrix\(\{ silent: true \}\)/);
  assert.match(block, /v28b1RefreshActivationStatuses\(\{ silent: true \}\)/);
  assert.match(block, /renderPermissionControls\(\);/);
  assert.match(block, /v28bRenderAccessControls\(\);/);
  assert.match(block, /v28b1RenderActivationStatuses\(\);/);
});

test('Embedded checks module has idempotent staff verification state', () => {
  assert.match(premium, /let staffVerificationRequest = null;/);
  assert.match(premium, /let staffContextKey = "";/);
  assert.match(premium, /let queueLoaded = false;/);
  const block = sliceBetween(premium, 'async function verifyStaff(session)', 'async function handleLogin');
  assert.match(block, /if \(!contextChanged && dashboardVisible && queueLoaded\) return;/);
  assert.match(block, /if \(staffVerificationRequest\) return staffVerificationRequest;/);
});

test('Embedded checks module no longer wipes queue at the start of every auth event', () => {
  const block = sliceBetween(premium, 'async function verifyStaff(session)', 'async function handleLogin');
  const prefix = block.slice(0, block.indexOf('if (!session?.user)'));
  assert.doesNotMatch(prefix, /rows = \[\]/);
  assert.doesNotMatch(prefix, /clear\(state\.queue\)/);
  assert.doesNotMatch(prefix, /renderEmptyDetail\(\)/);
  assert.match(premium, /function resetOperationalState\(\)/);
});

test('Embedded checks module loads queue before revealing dashboard on first real load', () => {
  const block = sliceBetween(premium, 'async function verifyStaff(session)', 'async function handleLogin');
  const loadIndex = block.indexOf('await loadQueue({ keepSelection: false })');
  const showIndex = block.indexOf('setView("dashboard")');
  assert.ok(loadIndex >= 0, 'loadQueue call missing');
  assert.ok(showIndex > loadIndex, 'dashboard must be shown only after first queue load');
});

test('Queue is marked stable only after queue/detail rendering completes', () => {
  const block = sliceBetween(premium, 'async function loadQueue', 'async function refreshAfterAction');
  const renderIndex = block.indexOf('if (selectedId) await selectCheck(selectedId)');
  const stableIndex = block.indexOf('queueLoaded = true');
  assert.ok(renderIndex >= 0 && stableIndex > renderIndex);
});
