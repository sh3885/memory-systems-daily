(function () {
  const apiBase = (window.MSD_API_BASE || localStorage.getItem("msd_api_base") || "").replace(/\/+$/, "");
  const path = window.location.pathname;

  function visitorKey() {
    const key = "msd_visitor_key";
    let value = localStorage.getItem(key);
    if (!value) {
      value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, value);
    }
    return value;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
  }

  function paintVisits(stats) {
    document.querySelectorAll("[data-visit-total]").forEach((node) => {
      node.textContent = formatNumber(stats.totalViews);
    });
    document.querySelectorAll("[data-visit-today]").forEach((node) => {
      node.textContent = formatNumber(stats.todayViews);
    });
    document.querySelectorAll("[data-visit-unique]").forEach((node) => {
      node.textContent = formatNumber(stats.uniqueVisitors);
    });
  }

  function applyDynamicPostOrder(posts) {
    if (!Array.isArray(posts) || posts.length === 0) return;
    const stream = document.querySelector("[data-post-stream]");
    if (!stream) return;
    const nodes = new Map([...stream.querySelectorAll("[data-post-url]")].map((node) => [node.dataset.postUrl, node]));
    posts
      .filter((post) => post.status === "published")
      .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || left.position - right.position)
      .forEach((post) => {
        const node = nodes.get(post.url);
        if (node) stream.appendChild(node);
      });
  }

  async function updateVisits() {
    if (!apiBase) return;
    try {
      const response = await fetch(`${apiBase}/api/visits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, visitorKey: visitorKey() }),
      });
      const data = await response.json();
      if (data.ok && data.stats) paintVisits(data.stats);
    } catch {
      document.querySelectorAll("[data-visit-status]").forEach((node) => {
        node.textContent = "offline";
      });
    }
  }

  async function loadConfig() {
    if (!apiBase) return;
    try {
      const response = await fetch(`${apiBase}/api/blog/config`);
      const data = await response.json();
      if (data.ok) applyDynamicPostOrder(data.posts);
    } catch {
      // Static ordering remains the fallback.
    }
  }

  updateVisits();
  loadConfig();
})();
