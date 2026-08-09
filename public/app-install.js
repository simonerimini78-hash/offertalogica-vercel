(() => {
  const requested = new URLSearchParams(location.search).get("install") === "1";
  const panel = document.getElementById("installEntryPanel");
  const button = document.getElementById("installEntryButton");
  const continueButton = document.getElementById("installEntryContinue");
  const copy = document.getElementById("installEntryText");
  if (!panel || !button || !continueButton || !copy) return;

  let deferredPrompt = null;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMac = !isIos && /Macintosh|Mac OS X/i.test(navigator.userAgent);
  const isSafari = /Safari/i.test(navigator.userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  const cleanInstallParam = () => {
    const url = new URL(location.href);
    url.searchParams.delete("install");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const instructions = () => {
    if (isIos) {
      return "Su iPhone/iPad: apri la pagina in Safari, tocca Condividi, scegli Aggiungi alla schermata Home, attiva “Apri come app web” e poi tocca Aggiungi.";
    }
    if (isMac && isSafari) {
      return "Su Safari per Mac: usa Condividi → Aggiungi al Dock oppure File → Aggiungi al Dock.";
    }
    return "Il browser non ha aperto la finestra automatica. Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.";
  };

  const initialCopy = () => {
    if (isIos || (isMac && isSafari)) return instructions();
    return "Installa l’app sul dispositivo. Premi il pulsante verde qui sotto.";
  };

  if (requested) {
    if (isStandalone) cleanInstallParam();
    else {
      panel.hidden = false;
      button.hidden = false;
      copy.textContent = initialCopy();
    }
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    if (requested && !isStandalone) {
      panel.hidden = false;
      button.hidden = false;
      copy.textContent = "L’app è pronta per essere installata su questo dispositivo.";
    }
  });

  button.addEventListener("click", async () => {
    if (!deferredPrompt) {
      copy.textContent = instructions();
      return;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice?.outcome === "accepted") {
      panel.hidden = true;
      cleanInstallParam();
    } else {
      button.hidden = false;
      copy.textContent = instructions();
    }
  });

  continueButton.addEventListener("click", () => {
    panel.hidden = true;
    cleanInstallParam();
  });

  window.addEventListener("appinstalled", () => {
    panel.hidden = true;
    cleanInstallParam();
  });
})();
