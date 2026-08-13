import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../public/app-support.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

function makeElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    hidden: false,
    className: '',
    textContent: '',
    value: '',
    children: [],
    style: {},
    dataset: {},
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    setAttribute() {},
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
    scrollIntoView() {},
    scrollTop: 0,
    scrollHeight: 0,
  };
}

function buildHarness(rows) {
  const elements = new Map([
    ['premiumSupportOptions', makeElement()],
    ['premiumSupportEscalationForm', makeElement('form')],
    ['premiumSupportReplyForm', makeElement('form')],
    ['premiumSupportChat', makeElement()],
    ['premiumSupportTraffic', makeElement('span')],
    ['premiumSupportStatus', makeElement()],
  ]);

  const updateCalls = [];
  const supabase = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: 'user-1' } } }, error: null };
      },
    },
    from(table) {
      assert.equal(table, 'premium_communications');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        limit: async () => ({ data: rows, error: null }),
        update(payload) { updateCalls.push(payload); return chain; },
        in() { return chain; },
      };
      return chain;
    },
  };

  const document = {
    readyState: 'loading',
    head: makeElement('head'),
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return makeElement(tag); },
    addEventListener() {},
  };

  const instrumented = source.replace(
    'globalThis.OffertaLogicaPremiumSupport = Object.freeze({ init });',
    'globalThis.__supportTestHooks = { loadSupportCommunications, renderOpenCase, submitReply };\n  globalThis.OffertaLogicaPremiumSupport = Object.freeze({ init });'
  );
  assert.notEqual(instrumented, source, 'test hook injection failed');

  const context = {
    console,
    document,
    CSS: { escape: value => String(value) },
    Intl,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    confirm: () => true,
    OffertaLogicaPremiumAuth: { getClient: () => supabase },
  };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context, { filename: 'app-support.js' });
  return { hooks: context.__supportTestHooks, elements, updateCalls };
}

const subject = '[support:red:payment:case-123] Abbonamento e pagamento';
const userMessage = {
  id: 'u1', user_id: 'user-1', direction: 'user_to_staff', subject,
  body: 'Problema pagamento', read_at: '2026-08-13T16:00:00Z', created_at: '2026-08-13T15:00:00Z',
};
const unreadStaffReply = {
  id: 's1', user_id: 'user-1', direction: 'staff_to_user', subject,
  body: 'Risposta staff', read_at: null, created_at: '2026-08-13T15:30:00Z',
};

test('pratica chiusa: risposta staff non letta resta selezionata e la conversazione completa viene restituita', async () => {
  const { hooks } = buildHarness([userMessage, unreadStaffReply]);
  const result = await hooks.loadSupportCommunications();
  assert.ok(result.openCase);
  assert.equal(result.openCase.caseId, 'case-123');
  assert.equal(result.openCase.closed, true);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages.at(-1).direction, 'staff_to_user');
});

test('pratica chiusa: dopo la lettura della risposta staff non resta nella sezione attiva', async () => {
  const readStaffReply = { ...unreadStaffReply, read_at: '2026-08-13T16:10:00Z' };
  const { hooks } = buildHarness([userMessage, readStaffReply]);
  const result = await hooks.loadSupportCommunications();
  assert.equal(result.openCase, null);
  assert.equal(result.messages.length, 0);
});

test('pratica chiusa: UI mostra stato chiuso e non espone il campo Rispondi', async () => {
  const { hooks, elements } = buildHarness([userMessage, unreadStaffReply]);
  const result = await hooks.loadSupportCommunications();
  hooks.renderOpenCase(result.openCase, result.messages);
  assert.equal(elements.get('premiumSupportReplyForm').hidden, true);
  assert.equal(elements.get('premiumSupportTraffic').textContent, 'CHIUSA · STAFF');
  assert.match(elements.get('premiumSupportStatus').textContent, /Pratica chiusa dallo Staff/);
});

test('service worker forza il refresh del modulo supporto corretto', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /support-a3-refund-closed-reply/);
  assert.match(sw, /"\/app-support\.js"/);
});
