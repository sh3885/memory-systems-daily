(function () {
  const ENTRY_PASSWORD_HASH = "ea8800180d8baaae0f6a567d6efac6de48dd8c5607643fd36d70e4a59cc7aed7";
  const FALLBACK_API_BASE = "https://memory-systems-daily-bot.sh3885-lee.workers.dev";

  const gate = document.querySelector("[data-admin-gate]");
  const gateForm = document.querySelector("[data-admin-password-form]");
  const gateStatus = document.querySelector("[data-admin-gate-status]");
  const content = document.querySelector("[data-admin-content]");
  const pending = [];
  let unlocked = false;

  function normalizeBase(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function apiBase() {
    const stored = localStorage.getItem("msd_api_base");
    return normalizeBase(stored || window.MSD_API_BASE || FALLBACK_API_BASE);
  }

  function apiUrl(path) {
    return `${apiBase()}${path}`;
  }

  function password() {
    return sessionStorage.getItem("msd_admin_password") || "";
  }

  function authHeaders() {
    const value = password();
    return {
      "content-type": "application/json",
      ...(value ? { "x-admin-password": value } : {}),
    };
  }

  async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), { headers: authHeaders(), ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function setStatus(message, tone) {
    const node = document.querySelector("[data-admin-status]");
    if (!node) return;
    node.textContent = message;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function unlock() {
    unlocked = true;
    sessionStorage.setItem("msd_admin_unlocked", "1");
    if (gate) gate.hidden = true;
    if (content) content.hidden = false;
    while (pending.length) pending.shift()();
  }

  gateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = gateForm.elements.entryPassword.value;
    if (await sha256Hex(value) !== ENTRY_PASSWORD_HASH) {
      if (gateStatus) {
        gateStatus.textContent = "비밀번호가 맞지 않습니다.";
        gateStatus.dataset.tone = "error";
      }
      gateForm.elements.entryPassword.select();
      return;
    }
    sessionStorage.setItem("msd_admin_password", value);
    unlock();
  });

  window.MSDAdmin = {
    apiBase,
    apiUrl,
    authHeaders,
    normalizeBase,
    password,
    request,
    setStatus,
    onReady(callback) {
      if (unlocked) callback();
      else pending.push(callback);
    },
  };

  if (sessionStorage.getItem("msd_admin_unlocked") === "1" && password()) unlock();
})();
