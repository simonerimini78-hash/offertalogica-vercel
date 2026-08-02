(() => {
  "use strict";

  const DB_NAME = "offertalogica-app";
  const DB_VERSION = 1;
  const STORE_NAME = "bills";
  const MAX_PDF_BYTES = 20_000_000;

  function uid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `bill-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in globalThis)) {
        reject(new Error("ARCHIVE_NOT_SUPPORTED"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("ARCHIVE_OPEN_FAILED"));
    });
  }

  async function withStore(mode, operation) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let request;

        try {
          request = operation(store);
        } catch (error) {
          reject(error);
          return;
        }

        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = () => reject(transaction.error || new Error("ARCHIVE_TRANSACTION_FAILED"));
        transaction.onabort = () => reject(transaction.error || new Error("ARCHIVE_TRANSACTION_ABORTED"));
      });
    } finally {
      db.close();
    }
  }

  function listBills() {
    return withStore("readonly", store => store.getAll()).then(records =>
      (Array.isArray(records) ? records : []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    );
  }

  function getBill(id) {
    return withStore("readonly", store => store.get(id));
  }

  function saveBill(record) {
    return withStore("readwrite", store => store.put(record));
  }

  function deleteBill(id) {
    return withStore("readwrite", store => store.delete(id));
  }

  function clearBills() {
    return withStore("readwrite", store => store.clear());
  }

  function validatePdf(file) {
    if (!file || Number(file.size || 0) <= 0) return "Il file selezionato è vuoto.";
    if (Number(file.size || 0) > MAX_PDF_BYTES) return "Il PDF supera il limite di 20 MB.";

    const nameLooksPdf = /\.pdf$/i.test(String(file.name || ""));
    const acceptedTypes = ["application/pdf", "application/x-pdf", "application/octet-stream", ""];
    const typeLooksPdf = acceptedTypes.includes(String(file.type || "").toLowerCase());
    if (!nameLooksPdf || !typeLooksPdf) return "Seleziona un file PDF valido.";

    return "";
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data non disponibile";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function sizeLabel(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "Dimensione non disponibile";
    if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1_000))} KB`;
    return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value / 1_000_000)} MB`;
  }

  function storageSizeLabel(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 KB";
    return sizeLabel(value);
  }

  function euroLabel(cents) {
    const value = Number(cents || 0) / 100;
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);
  }

  function amountInputValue(cents) {
    const value = Number(cents || 0) / 100;
    if (!Number.isFinite(value) || value <= 0) return "";
    return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  function parseAmountCents(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) return 0;
    let normalized = raw.replace(/[€\s]/g, "");
    if (normalized.includes(",") && normalized.includes(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if (normalized.includes(",")) {
      normalized = normalized.replace(",", ".");
    }
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return NaN;
    return Math.round(value * 100);
  }

  async function fingerprintBlob(blob) {
    if (!blob || typeof blob.arrayBuffer !== "function" || !globalThis.crypto?.subtle) return "";
    const buffer = await blob.arrayBuffer();
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function isDuplicateBill(file, records, fingerprint) {
    if (!fingerprint) return false;

    const sameSize = records.filter(record => Number(record.fileSize || 0) === Number(file.size || 0));
    for (const record of sameSize) {
      let recordFingerprint = String(record.fingerprint || "");
      if (!recordFingerprint && record.pdfBlob) {
        recordFingerprint = await fingerprintBlob(record.pdfBlob);
        if (recordFingerprint) {
          await saveBill({ ...record, fingerprint: recordFingerprint });
          record.fingerprint = recordFingerprint;
        }
      }
      if (recordFingerprint && recordFingerprint === fingerprint) return true;
    }

    return false;
  }

  function errorMessage(error) {
    if (error?.name === "QuotaExceededError") {
      return "Spazio insufficiente per archiviare il PDF su questo dispositivo.";
    }
    if (error?.message === "ARCHIVE_NOT_SUPPORTED") {
      return "L’archivio locale non è supportato da questo browser.";
    }
    return String(error?.message || "Non è stato possibile archiviare la bolletta.").trim();
  }

  function init() {
    const input = document.getElementById("billFileInput");
    const button = document.getElementById("billUploadButton");
    const buttonLabel = document.getElementById("billUploadButtonLabel");
    const status = document.getElementById("billUploadStatus");
    const statusText = document.getElementById("billUploadStatusText");
    const count = document.getElementById("billArchiveCount");
    const homeCount = document.getElementById("homeBillArchiveCount");
    const latest = document.getElementById("billArchiveLatest");
    const empty = document.getElementById("billArchiveEmpty");
    const list = document.getElementById("billArchiveList");
    const profileCount = document.getElementById("profileBillArchiveCount");
    const profileSize = document.getElementById("profileBillArchiveSize");
    const clearArchiveButton = document.getElementById("clearBillArchiveButton");
    const profileDataStatus = document.getElementById("profileDataStatus");
    const spendTotal = document.getElementById("billSpendTotal");
    const spendYear = document.getElementById("billSpendYear");
    const spendMeta = document.getElementById("billSpendMeta");
    let selectedSpendYear = new Date().getFullYear();

    if (!input || !button || !buttonLabel || !status || !statusText || !count || !latest || !empty || !list) return;

    const setStatus = (kind, text) => {
      status.className = `upload-status show ${kind || ""}`.trim();
      statusText.textContent = text;
    };

    const clearStatus = () => {
      status.className = "upload-status";
      statusText.textContent = "";
    };

    const renderSpending = records => {
      if (!spendTotal || !spendYear || !spendMeta) return;

      const currentYear = new Date().getFullYear();
      const years = new Set([currentYear]);
      records.forEach(record => {
        const year = Number(record.expenseYear || 0);
        if (Number.isInteger(year) && year >= 2000 && year <= 2100) years.add(year);
      });

      const orderedYears = [...years].sort((a, b) => b - a);
      if (!orderedYears.includes(selectedSpendYear)) selectedSpendYear = currentYear;
      spendYear.replaceChildren(...orderedYears.map(year => {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        option.selected = year === selectedSpendYear;
        return option;
      }));

      const withAmount = records.filter(record =>
        Number(record.expenseYear || 0) === selectedSpendYear && Number(record.expenseCents || 0) > 0
      );
      const totalCents = withAmount.reduce((sum, record) => sum + Number(record.expenseCents || 0), 0);
      spendTotal.textContent = euroLabel(totalCents);

      if (!withAmount.length) {
        spendMeta.textContent = "Aggiungi manualmente l’importo a una bolletta per iniziare il totale.";
        return;
      }

      const archivedInYear = records.filter(record => Number(record.expenseYear || 0) === selectedSpendYear).length;
      const periods = [...new Set(withAmount.map(record => String(record.expensePeriod || "").trim()).filter(Boolean))];
      const coverage = periods.length ? ` · Periodi: ${periods.slice(0, 3).join(", ")}${periods.length > 3 ? "…" : ""}` : "";
      spendMeta.textContent = `${withAmount.length} ${withAmount.length === 1 ? "bolletta con importo" : "bollette con importo"}${archivedInYear > withAmount.length ? ` su ${archivedInYear}` : ""}${coverage}`;
    };

    const render = async () => {
      let records;
      try {
        records = await listBills();
      } catch (error) {
        count.textContent = "—";
        if (homeCount) homeCount.textContent = "—";
        if (profileCount) profileCount.textContent = "—";
        if (profileSize) profileSize.textContent = "—";
        latest.textContent = "—";
        empty.hidden = false;
        list.hidden = true;
        setStatus("error", "L’archivio locale non è disponibile su questo dispositivo.");
        return;
      }

      count.textContent = String(records.length);
      if (homeCount) homeCount.textContent = String(records.length);
      if (profileCount) profileCount.textContent = String(records.length);
      if (profileSize) {
        const totalBytes = records.reduce((sum, record) => sum + Number(record.fileSize || 0), 0);
        profileSize.textContent = storageSizeLabel(totalBytes);
      }
      renderSpending(records);
      if (clearArchiveButton) clearArchiveButton.disabled = records.length === 0;
      latest.textContent = records.length ? dateLabel(records[0].createdAt) : "—";
      buttonLabel.textContent = records.length ? "AGGIUNGI BOLLETTA" : "CARICA BOLLETTA";
      empty.hidden = records.length > 0;
      list.hidden = records.length === 0;
      list.replaceChildren();

      records.forEach(record => {
        const item = document.createElement("article");
        item.className = "bill-item";

        const icon = document.createElement("div");
        icon.className = "bill-item-icon";
        icon.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h6"/></svg>';

        const copy = document.createElement("div");
        copy.className = "bill-item-copy";
        const title = document.createElement("strong");
        title.textContent = record.filename || "Bolletta.pdf";
        const meta = document.createElement("span");
        meta.textContent = `Archiviata · ${dateLabel(record.createdAt)}`;
        const detail = document.createElement("small");
        detail.textContent = `${sizeLabel(record.fileSize)} · Solo su questo dispositivo`;
        const expense = document.createElement("small");
        expense.className = "bill-item-expense";
        expense.textContent = Number(record.expenseCents || 0) > 0
          ? `${euroLabel(record.expenseCents)} · ${record.expenseYear || "Anno non indicato"}${record.expensePeriod ? ` · ${record.expensePeriod}` : ""}`
          : "Importo non inserito";
        copy.append(title, meta, detail, expense);

        const actions = document.createElement("div");
        actions.className = "bill-item-actions";

        const pdfButton = document.createElement("button");
        pdfButton.type = "button";
        pdfButton.className = "bill-mini-btn";
        pdfButton.textContent = "PDF";
        pdfButton.dataset.billOpen = record.id;
        pdfButton.setAttribute("aria-label", `Apri ${record.filename || "la bolletta"}`);

        const expenseButton = document.createElement("button");
        expenseButton.type = "button";
        expenseButton.className = "bill-mini-btn";
        expenseButton.textContent = Number(record.expenseCents || 0) > 0 ? "Modifica" : "Importo";
        expenseButton.dataset.billExpense = record.id;

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "bill-mini-btn danger";
        deleteButton.textContent = "Elimina";
        deleteButton.dataset.billDelete = record.id;

        const expenseForm = document.createElement("form");
        expenseForm.className = "bill-expense-form";
        expenseForm.dataset.billExpenseForm = record.id;
        expenseForm.hidden = true;
        expenseForm.innerHTML = `
          <label>Importo totale (€)<input data-expense-amount inputmode="decimal" autocomplete="off" placeholder="0,00"></label>
          <label>Anno<input data-expense-year type="number" min="2000" max="2100" step="1"></label>
          <label class="wide">Periodo facoltativo<input data-expense-period maxlength="60" autocomplete="off" placeholder="es. gennaio–febbraio"></label>
          <div class="bill-expense-actions"><button class="bill-expense-save" type="submit">SALVA IMPORTO</button><button class="bill-expense-cancel" type="button" data-expense-cancel>ANNULLA</button></div>`;
        expenseForm.querySelector("[data-expense-amount]").value = amountInputValue(record.expenseCents);
        expenseForm.querySelector("[data-expense-year]").value = String(record.expenseYear || new Date().getFullYear());
        expenseForm.querySelector("[data-expense-period]").value = String(record.expensePeriod || "");

        actions.append(pdfButton, expenseButton, deleteButton);
        item.append(icon, copy, actions, expenseForm);
        list.append(item);
      });
    };

    if (spendYear) {
      spendYear.addEventListener("change", async () => {
        selectedSpendYear = Number(spendYear.value || new Date().getFullYear());
        await render();
      });
    }

    button.addEventListener("click", () => input.click());

    document.querySelectorAll("[data-bill-upload-shortcut]").forEach(shortcut => {
      shortcut.addEventListener("click", () => input.click());
    });

    if (clearArchiveButton) {
      clearArchiveButton.addEventListener("click", async () => {
        let records;
        try {
          records = await listBills();
        } catch (error) {
          if (profileDataStatus) {
            profileDataStatus.hidden = false;
            profileDataStatus.className = "profile-data-status error";
            profileDataStatus.textContent = "L’archivio locale non è disponibile.";
          }
          return;
        }

        if (!records.length) return;

        const confirmed = globalThis.confirm(
          `Eliminare definitivamente ${records.length} ${records.length === 1 ? "bolletta" : "bollette"} da questo dispositivo?`
        );
        if (!confirmed) return;

        clearArchiveButton.disabled = true;
        try {
          await clearBills();
          clearStatus();
          if (profileDataStatus) {
            profileDataStatus.hidden = false;
            profileDataStatus.className = "profile-data-status";
            profileDataStatus.textContent = "Archivio locale eliminato.";
          }
          await render();
        } catch (error) {
          if (profileDataStatus) {
            profileDataStatus.hidden = false;
            profileDataStatus.className = "profile-data-status error";
            profileDataStatus.textContent = "Non è stato possibile eliminare l’archivio locale.";
          }
          clearArchiveButton.disabled = false;
        }
      });
    }

    input.addEventListener("change", async () => {
      const files = [...(input.files || [])];
      input.value = "";
      if (!files.length) return;

      button.disabled = true;
      if (profileDataStatus) profileDataStatus.hidden = true;
      let completed = 0;
      let failed = 0;
      let skipped = 0;
      let records = [];

      try {
        records = await listBills();
      } catch (error) {
        button.disabled = false;
        setStatus("error", "L’archivio locale non è disponibile su questo dispositivo.");
        return;
      }

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const validationError = validatePdf(file);
        if (validationError) {
          failed += 1;
          setStatus("error", `${file?.name || "File"}: ${validationError}`);
          continue;
        }

        setStatus("loading", `Verifica ${index + 1} di ${files.length}: ${file.name}`);

        try {
          const fingerprint = await fingerprintBlob(file);
          if (await isDuplicateBill(file, records, fingerprint)) {
            skipped += 1;
            setStatus("warning", `${file.name}: il PDF è già presente nell’archivio.`);
            continue;
          }

          setStatus("loading", `Salvataggio ${index + 1} di ${files.length}: ${file.name}`);
          const record = {
            id: uid(),
            filename: file.name || "bolletta.pdf",
            mimeType: file.type || "application/pdf",
            fileSize: Number(file.size || 0),
            sourceLastModified: Number(file.lastModified || 0),
            fingerprint,
            createdAt: new Date().toISOString(),
            pdfBlob: file.slice(0, file.size, file.type || "application/pdf"),
            status: "archived",
          };
          await saveBill(record);
          records.unshift(record);
          completed += 1;
          await render();
        } catch (error) {
          failed += 1;
          setStatus("error", `${file.name}: ${errorMessage(error)}`);
        }
      }

      button.disabled = false;

      if (completed && !failed && !skipped) {
        setStatus(
          "success",
          completed === 1 ? "Bolletta aggiunta all’archivio locale." : `${completed} bollette aggiunte all’archivio locale.`
        );
      } else if (completed) {
        const details = [];
        if (skipped) details.push(`${skipped} già ${skipped === 1 ? "presente" : "presenti"}`);
        if (failed) details.push(`${failed} non ${failed === 1 ? "completata" : "completate"}`);
        setStatus("warning", `${completed} ${completed === 1 ? "bolletta archiviata" : "bollette archiviate"}; ${details.join("; ")}.`);
      } else if (skipped && !failed) {
        setStatus(
          "warning",
          skipped === 1 ? "Il PDF selezionato è già presente nell’archivio." : "I PDF selezionati sono già presenti nell’archivio."
        );
      }

      await render();
    });

    list.addEventListener("submit", async event => {
      const form = event.target.closest("[data-bill-expense-form]");
      if (!form) return;
      event.preventDefault();

      const amountField = form.querySelector("[data-expense-amount]");
      const yearField = form.querySelector("[data-expense-year]");
      const periodField = form.querySelector("[data-expense-period]");
      const amountCents = parseAmountCents(amountField?.value);
      const year = Number(yearField?.value || 0);

      if (Number.isNaN(amountCents)) {
        setStatus("error", "Inserisci un importo valido, per esempio 125,40.");
        amountField?.focus();
        return;
      }
      if (amountCents > 0 && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
        setStatus("error", "Inserisci un anno valido.");
        yearField?.focus();
        return;
      }

      try {
        const record = await getBill(form.dataset.billExpenseForm);
        if (!record) throw new Error("Bolletta non disponibile.");
        await saveBill({
          ...record,
          expenseCents: amountCents || null,
          expenseYear: amountCents ? year : null,
          expensePeriod: amountCents ? String(periodField?.value || "").trim() : "",
          expenseUpdatedAt: new Date().toISOString(),
        });
        selectedSpendYear = amountCents ? year : selectedSpendYear;
        setStatus("success", amountCents ? "Importo salvato nella bolletta." : "Importo rimosso dalla bolletta.");
        await render();
      } catch (error) {
        setStatus("error", "Non è stato possibile salvare l’importo.");
      }
    });

    list.addEventListener("click", async event => {
      const expenseButton = event.target.closest("[data-bill-expense]");
      if (expenseButton) {
        const form = list.querySelector(`[data-bill-expense-form="${expenseButton.dataset.billExpense}"]`);
        if (form) {
          list.querySelectorAll("[data-bill-expense-form]").forEach(other => { if (other !== form) other.hidden = true; });
          form.hidden = !form.hidden;
          if (!form.hidden) form.querySelector("[data-expense-amount]")?.focus();
        }
        return;
      }

      const cancelButton = event.target.closest("[data-expense-cancel]");
      if (cancelButton) {
        const form = cancelButton.closest("[data-bill-expense-form]");
        if (form) form.hidden = true;
        return;
      }

      const openButton = event.target.closest("[data-bill-open]");
      if (openButton) {
        try {
          const record = await getBill(openButton.dataset.billOpen);
          if (!record?.pdfBlob) throw new Error("PDF non disponibile.");

          const viewer = globalThis.OffertaLogicaAppBrowser;
          if (!viewer || typeof viewer.openPdf !== "function") {
            throw new Error("Visualizzatore PDF non disponibile.");
          }
          viewer.openPdf(record.pdfBlob, record.filename || "Bolletta.pdf");
        } catch (error) {
          setStatus("error", errorMessage(error));
        }
        return;
      }

      const deleteButton = event.target.closest("[data-bill-delete]");
      if (!deleteButton) return;

      try {
        await deleteBill(deleteButton.dataset.billDelete);
        clearStatus();
        await render();
      } catch (error) {
        setStatus("error", "Non è stato possibile eliminare la bolletta.");
      }
    });

    render();
  }

  globalThis.OffertaLogicaBillArchive = { init };
})();
