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

    if (!input || !button || !buttonLabel || !status || !statusText || !count || !latest || !empty || !list) return;

    const setStatus = (kind, text) => {
      status.className = `upload-status show ${kind || ""}`.trim();
      statusText.textContent = text;
    };

    const clearStatus = () => {
      status.className = "upload-status";
      statusText.textContent = "";
    };

    const render = async () => {
      let records;
      try {
        records = await listBills();
      } catch (error) {
        count.textContent = "—";
        if (homeCount) homeCount.textContent = "—";
        latest.textContent = "—";
        empty.hidden = false;
        list.hidden = true;
        setStatus("error", "L’archivio locale non è disponibile su questo dispositivo.");
        return;
      }

      count.textContent = String(records.length);
      if (homeCount) homeCount.textContent = String(records.length);
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
        copy.append(title, meta, detail);

        const actions = document.createElement("div");
        actions.className = "bill-item-actions";

        const pdfButton = document.createElement("button");
        pdfButton.type = "button";
        pdfButton.className = "bill-mini-btn";
        pdfButton.textContent = "PDF";
        pdfButton.dataset.billOpen = record.id;
        pdfButton.setAttribute("aria-label", `Apri ${record.filename || "la bolletta"}`);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "bill-mini-btn danger";
        deleteButton.textContent = "Elimina";
        deleteButton.dataset.billDelete = record.id;

        actions.append(pdfButton, deleteButton);
        item.append(icon, copy, actions);
        list.append(item);
      });
    };

    button.addEventListener("click", () => input.click());

    document.querySelectorAll("[data-bill-upload-shortcut]").forEach(shortcut => {
      shortcut.addEventListener("click", () => input.click());
    });

    input.addEventListener("change", async () => {
      const files = [...(input.files || [])];
      input.value = "";
      if (!files.length) return;

      button.disabled = true;
      let completed = 0;
      let failed = 0;

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const validationError = validatePdf(file);
        if (validationError) {
          failed += 1;
          setStatus("error", `${file?.name || "File"}: ${validationError}`);
          continue;
        }

        setStatus("loading", `Salvataggio ${index + 1} di ${files.length}: ${file.name}`);

        try {
          await saveBill({
            id: uid(),
            filename: file.name || "bolletta.pdf",
            mimeType: file.type || "application/pdf",
            fileSize: Number(file.size || 0),
            createdAt: new Date().toISOString(),
            pdfBlob: file.slice(0, file.size, file.type || "application/pdf"),
            status: "archived",
          });
          completed += 1;
          await render();
        } catch (error) {
          failed += 1;
          setStatus("error", `${file.name}: ${errorMessage(error)}`);
        }
      }

      button.disabled = false;

      if (completed && !failed) {
        setStatus(
          "success",
          completed === 1 ? "Bolletta aggiunta all’archivio locale." : `${completed} bollette aggiunte all’archivio locale.`
        );
      } else if (completed) {
        setStatus("warning", `${completed} bollette archiviate; ${failed} non completate.`);
      }

      await render();
    });

    list.addEventListener("click", async event => {
      const openButton = event.target.closest("[data-bill-open]");
      if (openButton) {
        try {
          const record = await getBill(openButton.dataset.billOpen);
          if (!record?.pdfBlob) throw new Error("PDF non disponibile.");

          const url = URL.createObjectURL(record.pdfBlob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = record.filename || "bolletta.pdf";
          anchor.rel = "noopener";
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
