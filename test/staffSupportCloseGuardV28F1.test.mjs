import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../public/staff.js", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = source.indexOf(`async function ${name}()`);
  assert.notEqual(start, -1, `${name} non trovata`);
  const end = source.indexOf(`async function ${nextName}()`, start);
  assert.notEqual(end, -1, `${nextName} non trovata`);
  return source.slice(start, end);
}

const closeCase = functionBody("closeSupportCase", "deleteSupportCase");

test("Staff: la chiusura verifica l'ultimo messaggio prima della conferma", () => {
  const guard = closeCase.indexOf('beforeConfirmLatest.direction !== "staff_to_user"');
  const confirm = closeCase.indexOf('const confirmed = await confirmAction');
  assert.ok(guard >= 0, "manca il blocco se l'ultimo messaggio non è Staff");
  assert.ok(confirm > guard, "la conferma non deve precedere la verifica");
});

test("Staff: la chiusura ricontrolla il thread dopo la conferma", () => {
  const confirm = closeCase.indexOf('if (!confirmed) return;');
  const liveReload = closeCase.indexOf('const liveMessages = await loadSupportThread(activeSupportCase);', confirm);
  const liveGuard = closeCase.indexOf('latest.direction !== "staff_to_user"', liveReload);
  assert.ok(liveReload > confirm, "manca il reload dopo la conferma");
  assert.ok(liveGuard > liveReload, "manca il secondo blocco sul messaggio cliente");
});

test("Staff: chiude soltanto i messaggi cliente già osservati", () => {
  assert.match(closeCase, /const openUserMessageIds = liveMessages[\s\S]*?\.filter\(message => message\.direction === "user_to_staff" && !message\.read_at\)[\s\S]*?\.map\(message => message\.id\)/);
  assert.match(closeCase, /\.in\("id", openUserMessageIds\)/);
});

test("Staff: un messaggio cliente arrivato mentre si conferma non viene chiuso in massa", () => {
  const updateStart = closeCase.indexOf('client.from("premium_communications")');
  const updateSlice = closeCase.slice(updateStart);
  assert.doesNotMatch(updateSlice, /\.eq\("subject", activeSupportCase\.supportSubjectRaw\)[\s\S]*?\.is\("read_at", null\)/);
});

test("Staff: i messaggi di errore spiegano perché la pratica resta aperta", () => {
  assert.match(closeCase, /l’ultimo messaggio è del cliente/);
  assert.match(closeCase, /nel frattempo è arrivato un nuovo messaggio del cliente/);
});
