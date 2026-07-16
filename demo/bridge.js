(() => {
  "use strict";

  window.__STUDIO_DEMO__ = Object.freeze({ preview: true });
  const routeByPath = {
    "/": "studio",
    "/studio": "studio",
    "/studio/main": "studio",
    "/captions": "captions",
    "/voices": "voices",
    "/studio/voice": "voices",
  };

  function navigate(route) {
    if (!route) return;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "demo:navigate", route }, window.location.origin);
    } else {
      const script = [...document.scripts].find((item) => item.src.endsWith("/bridge.js"));
      const root = new URL("./", script?.src || window.location.href);
      window.location.href = `${root.href}#/${route}`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const script = [...document.scripts].find((item) => item.src.endsWith("/bridge.js"));
    const root = new URL("./", script?.src || window.location.href);
    document.querySelectorAll(".product-nav a[href], .top-actions a[href]").forEach((link) => {
      const url = new URL(link.getAttribute("href"), window.location.origin);
      const route = routeByPath[url.pathname.replace(/\/+$/, "") || "/"];
      if (!route) return;
      link.href = `${root.href}#/${route}`;
      link.target = "_top";
    });

    document.querySelector("#openCaptionsButton")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate("captions");
    }, true);
  });

})();
