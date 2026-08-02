import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Funzione ${name} non trovata`);
  const braceStart = html.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`Fine funzione ${name} non trovata`);
}

function journeyContext({ verified = true, context = {}, unifiedReady = false, choiceResult = true } = {}) {
  const calls = [];
  const choiceCalls = [];
  const sandbox = {
    LEAD_STATE: { verified },
    OFFER_RENDER_CONTEXTS: new Map([["offer-1", context]]),
    graduatoriaCommercialeUnificataPronta: () => unifiedReady,
    apriSceltaCanaleAttivazione: (offer, channels) => {
      choiceCalls.push({ offer, channels });
      return choiceResult;
    },
    canaleAttivazioneDisponibile: (channels, channel) => channel === "direct"
      ? Boolean(channels?.directAvailable)
      : Boolean(channels?.switchoAvailable && channels?.exactSwitchoMatch && channels?.switchoUrl),
    window: {
      apriConsensoOfferta: (offer, options) => calls.push({ offer, options }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction("avviaPercorsoAttivazioneOfferta")}; globalThis.run = avviaPercorsoAttivazioneOfferta;`, sandbox);
  return { sandbox, calls, choiceCalls };
}

test("scelta canale: il percorso legacy apre ancora direttamente il consenso", () => {
  const { sandbox, calls, choiceCalls } = journeyContext({
    context: { displayGroup: "attivabile", activationRoute: "direct", directAvailable: true },
    unifiedReady: false,
  });
  const result = sandbox.run({ id: "offer-1", nome: "Offerta" });
  assert.equal(result, "legacy");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options, undefined);
  assert.equal(choiceCalls.length, 0);
});

test("scelta canale: il doppio percorso apre la scelta senza anticipare il consenso", () => {
  const { sandbox, calls, choiceCalls } = journeyContext({
    context: {
      displayGroup: "unified",
      activationRoute: "direct_and_switcho",
      directAvailable: true,
      switchoAvailable: true,
      exactSwitchoMatch: true,
      switchoUrl: "https://partner.example/switcho",
    },
    unifiedReady: true,
  });
  const result = sandbox.run({ id: "offer-1", nome: "Offerta" });
  assert.equal(result, "choice");
  assert.equal(choiceCalls.length, 1);
  assert.equal(calls.length, 0);
});

test("scelta canale: una offerta solo Switcho prepara il consenso assistito", () => {
  const { sandbox, calls } = journeyContext({
    context: {
      displayGroup: "unified",
      activationRoute: "switcho",
      directAvailable: false,
      switchoAvailable: true,
      exactSwitchoMatch: true,
      switchoReference: "SW-42",
      switchoUrl: "https://partner.example/switcho",
    },
    unifiedReady: true,
  });
  const result = sandbox.run({ id: "offer-1", nome: "Offerta" });
  assert.equal(result, "switcho");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.activationChannel, "switcho");
});

test("scelta canale: prima dell'OTP resta il blocco esistente", () => {
  const { sandbox, calls, choiceCalls } = journeyContext({ verified: false, unifiedReady: true });
  const result = sandbox.run({ id: "offer-1", nome: "Offerta" });
  assert.equal(result, "locked");
  assert.equal(calls.length, 1);
  assert.equal(choiceCalls.length, 0);
});

test("sicurezza: Switcho richiede match esatto e URL", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction("canaleAttivazioneDisponibile")}; globalThis.available = canaleAttivazioneDisponibile;`, sandbox);
  assert.equal(sandbox.available({ switchoAvailable: true, exactSwitchoMatch: false, switchoUrl: "https://example.com" }, "switcho"), false);
  assert.equal(sandbox.available({ switchoAvailable: true, exactSwitchoMatch: true, switchoUrl: "" }, "switcho"), false);
  assert.equal(sandbox.available({ switchoAvailable: true, exactSwitchoMatch: true, switchoUrl: "https://example.com" }, "switcho"), true);
});

test("conferma scelta: conserva il canale prima di aprire il consenso", () => {
  const consentCalls = [];
  const events = [];
  const sandbox = {
    LEAD_STATE: {
      pendingActivationChoice: {
        offer: { id: "offer-1", nome: "Offerta", provider: "Fornitore" },
        channels: { route: "direct_and_switcho", directAvailable: true, switchoAvailable: true, exactSwitchoMatch: true, switchoUrl: "https://example.com" },
      },
    },
    document: { getElementById: () => ({ style: { display: "flex" } }) },
    trackEvent: (name, payload) => events.push({ name, payload }),
    window: { apriConsensoOfferta: (offer, options) => consentCalls.push({ offer, options }) },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${extractFunction("canaleAttivazioneDisponibile")}; ${extractFunction("confermaSceltaCanaleAttivazione")}; globalThis.confirm = confermaSceltaCanaleAttivazione;`, sandbox);
  assert.equal(sandbox.confirm("switcho"), true);
  assert.equal(consentCalls[0].options.activationChannel, "switcho");
  assert.equal(events[0].payload.selectedChannel, "switcho");
  assert.equal(sandbox.LEAD_STATE.pendingActivationChoice.offer, null);
});

test("interfaccia: il selettore canale è nascosto e accessibile", () => {
  assert.match(html, /class="activation-channel-backdrop" id="activation-channel-backdrop" role="dialog" aria-modal="true"/);
  assert.match(html, /id="activation-channel-switcho"/);
  assert.match(html, /id="activation-channel-direct"/);
  assert.match(html, /\.activation-channel-backdrop \{[^}]*display: none/);
  assert.match(html, /avviaPercorsoAttivazioneOfferta\(offerta\)/);
});

test("selezione: registra il canale scelto senza attivare redirect Switcho", () => {
  assert.match(html, /LEAD_STATE\.selectedOffer\.activationChannel = options\.activationChannel/);
  assert.match(html, /activationChannel: LEAD_STATE\.selectedOffer\.activationChannel/);
  assert.match(html, /activationChannel: offer\.activationChannel/);
  assert.doesNotMatch(html, /window\.location\.href = offer\.switchoUrl/);
  assert.doesNotMatch(html, /window\.location\.href = LEAD_STATE\.selectedOffer\.switchoUrl/);
});
