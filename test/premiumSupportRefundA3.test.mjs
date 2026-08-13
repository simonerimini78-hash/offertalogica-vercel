import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const support = await readFile(new URL("../public/app-support.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("A3 espone il recesso/rimborso solo nella categoria pagamento", () => {
  const paymentStart = support.indexOf('if (category === "payment")');
  const utilitiesStart = support.indexOf('if (category === "utilities")');
  assert.ok(paymentStart >= 0 && utilitiesStart > paymentStart);
  const paymentBlock = support.slice(paymentStart, utilitiesStart);
  assert.match(paymentBlock, /Richiedi recesso\/rimborso primo acquisto/);
  assert.match(paymentBlock, /primo acquisto Premium/);
  assert.match(paymentBlock, /entro 14 giorni/);
});

test("A3 usa il flusso rosso esistente e non introduce endpoint", () => {
  assert.match(support, /prepareEscalation\("Richiesta recesso\/rimborso primo acquisto entro 14 giorni"\)/);
  assert.match(support, /premium_communications/);
  assert.doesNotMatch(support, /fetch\(\s*[`'"]\/api\//);
});

test("A3 conserva anti-duplicato, chat e risposta Staff-cliente", () => {
  assert.match(support, /if \(existing\.openCase\)/);
  assert.match(support, /Non verrà creata una seconda richiesta/);
  assert.match(support, /direction === "staff_to_user"/);
  assert.match(support, /premiumSupportReplyForm/);
  assert.match(support, /deleteCurrentCase/);
});

test("A3 forza il refresh della risorsa supporto senza cambiare la logica PWA", () => {
  assert.match(sw, /offertalogica-premium-v03629-install-simple-support-a3-refund/);
  assert.match(sw, /"\/app-support\.js"/);
  assert.match(sw, /SKIP_WAITING/);
  assert.match(sw, /request\.mode === "navigate"/);
});
