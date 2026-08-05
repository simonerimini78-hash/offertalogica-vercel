(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const layer = byId("premiumActionDialogLayer");
  if (!layer) return;

  const card = layer.querySelector(".action-dialog-card");
  const title = byId("premiumActionDialogTitle");
  const message = byId("premiumActionDialogMessage");
  const keywordWrap = byId("premiumActionDialogKeywordWrap");
  const keywordLabel = byId("premiumActionDialogKeywordLabel");
  const keywordInput = byId("premiumActionDialogKeyword");
  const inputWrap = byId("premiumActionDialogInputWrap");
  const inputLabel = byId("premiumActionDialogInputLabel");
  const input = byId("premiumActionDialogInput");
  const error = byId("premiumActionDialogError");
  const cancel = byId("premiumActionDialogCancel");
  const accept = byId("premiumActionDialogAccept");

  let active = null;
  let returnFocus = null;

  function setHidden(element, hidden) {
    if (element) element.hidden = hidden;
  }

  function clearError() {
    if (!error) return;
    error.hidden = true;
    error.textContent = "";
  }

  function finish(result) {
    if (!active) return;
    const resolve = active.resolve;
    active = null;
    layer.hidden = true;
    document.body.classList.remove("action-dialog-open");
    clearError();
    const focusTarget = returnFocus;
    returnFocus = null;
    focusTarget?.focus?.();
    resolve(result);
  }

  function cancelDialog() {
    if (!active) return;
    finish(active.mode === "form"
      ? { confirmed: false, value: "", keyword: "" }
      : false);
  }

  function confirmDialog() {
    if (!active) return;
    if (active.mode === "form") {
      const enteredKeyword = String(keywordInput?.value || "").trim();
      if (active.keyword && enteredKeyword !== active.keyword) {
        if (error) {
          error.textContent = `Scrivi esattamente ${active.keyword} per continuare.`;
          error.hidden = false;
        }
        keywordInput?.focus();
        return;
      }
      finish({
        confirmed: true,
        keyword: enteredKeyword,
        value: String(input?.value || "").slice(0, active.inputMaxLength),
      });
      return;
    }
    finish(true);
  }

  function open(options = {}, mode = "confirm") {
    if (active) cancelDialog();
    returnFocus = document.activeElement;
    clearError();

    const keyword = mode === "form" ? String(options.keyword || "").trim() : "";
    const showInput = mode === "form" && Boolean(options.inputLabel);
    const inputMaxLength = Math.max(1, Math.min(2000, Number(options.inputMaxLength || 500)));

    if (title) title.textContent = String(options.title || "Conferma operazione");
    if (message) message.textContent = String(options.message || "Confermi di voler continuare?");
    if (cancel) cancel.textContent = String(options.cancelLabel || "ANNULLA");
    if (accept) {
      accept.textContent = String(options.confirmLabel || "CONFERMA");
      accept.classList.toggle("danger", options.danger === true);
    }

    setHidden(keywordWrap, !keyword);
    if (keywordLabel) keywordLabel.textContent = String(options.keywordLabel || `Scrivi ${keyword} per confermare`);
    if (keywordInput) {
      keywordInput.value = "";
      keywordInput.placeholder = keyword;
      keywordInput.autocomplete = "off";
    }

    setHidden(inputWrap, !showInput);
    if (inputLabel) inputLabel.textContent = String(options.inputLabel || "");
    if (input) {
      input.value = String(options.inputValue || "").slice(0, inputMaxLength);
      input.placeholder = String(options.inputPlaceholder || "");
      input.maxLength = inputMaxLength;
    }

    layer.hidden = false;
    document.body.classList.add("action-dialog-open");

    return new Promise(resolve => {
      active = { resolve, mode, keyword, inputMaxLength };
      requestAnimationFrame(() => {
        if (keyword) keywordInput?.focus();
        else if (showInput) input?.focus();
        else accept?.focus();
      });
    });
  }

  cancel?.addEventListener("click", cancelDialog);
  accept?.addEventListener("click", confirmDialog);
  layer.addEventListener("click", event => {
    if (event.target === layer) cancelDialog();
  });
  card?.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("keydown", event => {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelDialog();
      return;
    }
    if (event.key === "Enter" && event.target !== input) {
      event.preventDefault();
      confirmDialog();
    }
  });

  globalThis.OffertaLogicaPremiumDialog = Object.freeze({
    confirm(options = {}) {
      return open(options, "confirm");
    },
    form(options = {}) {
      return open(options, "form");
    },
  });
})();
