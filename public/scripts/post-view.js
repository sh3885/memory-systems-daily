(function () {
  const page = document.querySelector("[data-post-page]");
  if (!page) return;

  const toggle = document.querySelector("[data-wide-toggle]");
  const label = document.querySelector("[data-wide-label]");
  const STORAGE_KEY = "msd_post_wide";

  function applyWide(wide) {
    page.dataset.wide = wide ? "1" : "0";
    if (toggle) toggle.setAttribute("aria-pressed", wide ? "true" : "false");
    if (label) label.textContent = wide ? "기본 너비" : "넓게 보기";
  }

  toggle?.addEventListener("click", () => {
    const wide = page.dataset.wide !== "1";
    try {
      localStorage.setItem(STORAGE_KEY, wide ? "1" : "0");
    } catch {
      // Private browsing can block storage; the toggle still works for this page.
    }
    applyWide(wide);
  });

  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  applyWide(stored === "1");

  // Diagrams stay dense even at full column width, so allow a full-screen look.
  // The overlay is built on first use; a preloaded empty <img> would sit in every
  // page as a permanently broken image.
  let viewer = null;

  function closeViewer() {
    viewer?.remove();
    viewer = null;
    document.body.style.overflow = "";
  }

  function openViewer(image) {
    closeViewer();
    viewer = document.createElement("div");
    viewer.className = "image-viewer";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "image-viewer-close";
    close.textContent = "닫기 ✕";

    const full = document.createElement("img");
    full.src = image.currentSrc || image.src;
    full.alt = image.alt || "";

    viewer.append(close, full);
    viewer.addEventListener("click", closeViewer);
    document.body.append(viewer);
    document.body.style.overflow = "hidden";
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeViewer();
  });

  for (const image of document.querySelectorAll(".post-content img")) {
    image.classList.add("zoomable");
    image.addEventListener("click", () => openViewer(image));
  }
})();
