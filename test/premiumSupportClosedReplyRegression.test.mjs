import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../public/app-support.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

function makeElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), hidden: false, disabled: false, className: '', textContent: '', value: '',
    children: [], style: {}, dataset: {},
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    setAttribute() {}, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    focus() {}, scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
  };
}

function buildHarness(initialRows) {
  let rows = initialRows;
  const elements = new Map([
    ['premiumSupportOptions', makeElement()], ['premiumSupportEscalationForm', makeElement('form')],
    ['premiumSupportReplyForm', makeElement('form')], ['premiumSupportChat', makeElement()],
    ['premiumSupportTraffic', makeElement('span')], ['premiumSupportStatus', makeElement()],
    ['premiumSupportRefresh', makeElement('button')],
  ]);
  const updateCalls = [];
  const supabase = {
    auth: { async getSession() { return { data: { session: { user: { id: 'user-1' } } }, error: null }; } },
    from(table) {
      assert.equal(table, 'premium_communications');
      const chain = {
        select() { return chain; }, eq() { return chain; }, order() { return chain; },
        limit: async () => ({ data: rows, error: null }),
        update(payload) { updateCalls.push(payload); return chain; }, in() { return chain; },
      };
      return chain;
    },
  };
  const document = {
    readyState: 'loading', head: makeElement('head'),
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return makeElement(tag); }, addEventListener() {},
  };
  const instrumented = source.replace(
    'globalThis.OffertaLogicaPremiumSupport = Object.freeze({ init });',
    'globalThis.__supportTestHooks = { loadSupportCommunications, renderOpenCase, refreshSupportMessages };\n  globalThis.OffertaLogicaPremiumSupport = Object.freeze({ init });'
  );
  assert.notEqual(instrumented, source, 'test hook injection failed');
  const context = { console, document, CSS: { escape: value => String(value) }, Intl, Date, Math, setTimeout, clearTimeout,
    confirm: () => true, OffertaLogicaPremiumAuth: { getClient: () => supabase } };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context, { filename: 'app-support.js' });
  return { hooks: context.__supportTestHooks, elements, updateCalls, setRows(next) { rows = next; } };
}

const subject = '[support:red:payment:case-123] Abbonamento e pagamento';
const userClosed = { id:'u1', user_id:'user-1', direction:'user_to_staff', subject, body:'Problema pagamento', read_at:'2026-08-13T16:00:00Z', created_at:'2026-08-13T15:00:00Z' };
const staffUnread = { id:'s1', user_id:'user-1', direction:'staff_to_user', subject, body:'Risposta staff', read_at:null, created_at:'2026-08-13T15:30:00Z' };

test('pratica chiusa: risposta non letta resta visibile con conversazione completa', async () => {
  const { hooks } = buildHarness([userClosed, staffUnread]);
  const result = await hooks.loadSupportCommunications();
  assert.ok(result.openCase); assert.equal(result.openCase.closed, true); assert.equal(result.messages.length, 2);
});

test('pratica chiusa: dopo la lettura resta nello storico e non sparisce', async () => {
  const staffRead = { ...staffUnread, read_at:'2026-08-13T16:10:00Z' };
  const { hooks } = buildHarness([userClosed, staffRead]);
  const result = await hooks.loadSupportCommunications();
  assert.ok(result.openCase); assert.equal(result.openCase.closed, true); assert.equal(result.messages.length, 2);
});

test('pratica chiusa: UI non espone Rispondi al cliente', async () => {
  const { hooks, elements } = buildHarness([userClosed, staffUnread]);
  const result = await hooks.loadSupportCommunications();
  hooks.renderOpenCase(result.openCase, result.messages);
  assert.equal(elements.get('premiumSupportReplyForm').hidden, true);
  assert.equal(elements.get('premiumSupportTraffic').textContent, 'CHIUSA · STAFF');
});

test('aggiorna messaggi: una nuova risposta Staff compare senza uscire dal pannello', async () => {
  const staffRead = { ...staffUnread, read_at:'2026-08-13T16:10:00Z' };
  const staffNew = { ...staffUnread, id:'s2', body:'Secondo aggiornamento staff', created_at:'2026-08-13T16:20:00Z' };
  const harness = buildHarness([userClosed, staffRead]);
  harness.setRows([userClosed, staffRead, staffNew]);
  await harness.hooks.refreshSupportMessages();
  const chatText = harness.elements.get('premiumSupportChat').children.map(node => node.textContent).join(' ');
  assert.match(chatText, /Secondo aggiornamento staff/);
  assert.equal(harness.elements.get('premiumSupportRefresh').disabled, false);
});

test('pratica aperta: resta prioritaria rispetto allo storico chiuso', async () => {
  const openSubject='[support:red:account:case-999] Account e accesso';
  const openUser={id:'u2',user_id:'user-1',direction:'user_to_staff',subject:openSubject,body:'Nuovo problema',read_at:null,created_at:'2026-08-13T17:00:00Z'};
  const { hooks } = buildHarness([userClosed, staffUnread, openUser]);
  const result = await hooks.loadSupportCommunications();
  assert.equal(result.openCase.caseId,'case-999'); assert.equal(result.openCase.closed,false);
});

test('service worker forza il refresh del modulo supporto definitivo', () => {
  const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  assert.match(sw,/closed-history-refresh/); assert.match(sw,/"\/app-support\.js"/);
});
