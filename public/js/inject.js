if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async (reg) => {
        console.log("SW registered", reg);
        const ready = await navigator.serviceWorker.ready;
        console.log(
          "SW ready, controller =",
          navigator.serviceWorker.controller
        );
      });
  });
}
