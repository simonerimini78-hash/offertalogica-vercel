(() => {
  const requested = new URLSearchParams(location.search).get("install") === "1";
  const panel = document.getElementById("installEntryPanel");
  const button = document.getElementById("installEntryButton");
  const continueButton = document.getElementById("installEntryContinue");
  const copy = document.getElementById("installEntryText");
  if (!panel || !button || !continueButton || !copy) return;

  let deferredPrompt = null;
  const ua = navigator.userAgent || "";
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isSamsungInternet = /SamsungBrowser/i.test(ua);
  const isEdge = /EdgA|EdgiOS|Edg\//i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !isSamsungInternet && !isEdge;
  const isMac = !isIos && /Macintosh|Mac OS X/i.test(ua);
  const isSafari = /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS|SamsungBrowser/i.test(ua);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  const cleanInstallParam = () => {
    const url = new URL(location.href);
    url.searchParams.delete("install");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const keepInstallLabel = () => {
    button.textContent = "INSTALLA APP";
    button.dataset.installMode = deferredPrompt ? "install" : "guided";
  };

  const initialCopy = () =>
    "Premi INSTALLA APP. Se il dispositivo chiede conferma, scegli Installa.";

  const instructions = () => {
    if (isIos) {
      return "Manca solo un ultimo passaggio: 1. Apri questa pagina in Safari. 2. Tocca Condividi ⬆︎. 3. Tocca “Aggiungi alla schermata Home”. 4. Attiva “Apri come app web” e tocca “Aggiungi”.";
    }
    if (isMac && isSafari) {
      return "Manca solo un ultimo passaggio: 1. In Safari clicca Condividi ⬆︎ nella barra in alto. 2. Clicca “Aggiungi al Dock”. 3. Clicca “Aggiungi”.";
    }
    if (isSamsungInternet) {
      return "Manca solo un ultimo passaggio: 1. In Samsung Internet tocca ☰ (tre linee) in basso a destra. 2. Tocca “+ Aggiungi pagina a”. 3. Tocca “Schermata Home” e poi “Aggiungi”.";
    }
    if (isAndroid && isChrome) {
      return "Manca solo un ultimo passaggio: 1. Tocca ⋮ a destra della barra degli indirizzi. 2. Tocca “Installa e crea scorciatoia”. 3. Tocca “Installa”. Se vedi “Aggiungi a schermata Home”, scegli quella voce e poi “Installa”.";
    }
    if (isAndroid && isEdge) {
      return "Manca solo un ultimo passaggio: 1. Tocca il menu ⋯ di Edge. 2. Cerca “Installa app” o “Aggiungi al telefono”. 3. Tocca la voce e conferma “Installa”.";
    }
    if (isEdge) {
      return "Manca solo un ultimo passaggio: 1. Apri il menu ⋯ in alto a destra. 2. Scegli “Altri strumenti” → “Applicazioni”. 3. Scegli “Installa questo sito come app” e conferma.";
    }
    if (isChrome) {
      return "Manca solo un ultimo passaggio: 1. Apri il menu ⋮ in alto a destra. 2. Scegli “Trasmetti, salva e condividi”. 3. Scegli “Installa questa pagina come app” e conferma.";
    }
    return "Per installarla nel modo più semplice, apri questa pagina con Chrome o Edge e premi di nuovo INSTALLA APP.";
  };

  if (requested) {
    if (isStandalone) cleanInstallParam();
    else {
      panel.hidden = false;
      button.hidden = false;
      keepInstallLabel();
      copy.textContent = initialCopy();
    }
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    keepInstallLabel();
    if (requested && !isStandalone) {
      panel.hidden = false;
      button.hidden = false;
      copy.textContent = "L’app è pronta. Premi INSTALLA APP e conferma l’installazione.";
    }
  });

  button.addEventListener("click", async () => {
    if (!deferredPrompt) {
      keepInstallLabel();
      copy.textContent = instructions();
      return;
    }

    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;

    if (choice?.outcome === "accepted") {
      panel.hidden = true;
      cleanInstallParam();
      return;
    }

    keepInstallLabel();
    copy.textContent = instructions();
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
