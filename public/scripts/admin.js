(function () {
  const ENTRY_PASSWORD_HASH = "ea8800180d8baaae0f6a567d6efac6de48dd8c5607643fd36d70e4a59cc7aed7";
  const gate = document.querySelector("[data-admin-gate]");
  const gateForm = document.querySelector("[data-admin-password-form]");
  const gateStatus = document.querySelector("[data-admin-gate-status]");
  const adminContent = document.querySelector("[data-admin-content]");
  const connectionForm = document.querySelector("[data-admin-settings]");
  const postForm = document.querySelector("[data-admin-form]");
  const blogSettingsForm = document.querySelector("[data-blog-settings]");
  const status = document.querySelector("[data-admin-status]");
  const postsList = document.querySelector("[data-admin-list]");
  const preview = document.querySelector("[data-admin-preview]");

  const apiBaseInput = connectionForm?.elements.apiBase;
  const tokenInput = connectionForm?.elements.adminToken;

  function csv(value) {
    return String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function setStatus(message, tone) {
    if (!status) return;
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function setGateStatus(message, tone) {
    if (!gateStatus) return;
    gateStatus.textContent = message;
    if (tone) gateStatus.dataset.tone = tone;
    else delete gateStatus.dataset.tone;
  }

  function normalizeApiBase(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function apiUrl(path) {
    const base = normalizeApiBase(apiBaseInput?.value || window.MSD_API_BASE || "");
    return `${base}${path}`;
  }

  function authHeaders() {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${tokenInput?.value || ""}`,
    };
  }

  function rememberConnection() {
    if (tokenInput?.value) localStorage.setItem("msd_admin_token", tokenInput.value);
    if (apiBaseInput?.value) localStorage.setItem("msd_api_base", normalizeApiBase(apiBaseInput.value));
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function unlockAdmin() {
    sessionStorage.setItem("msd_admin_unlocked", "1");
    if (gate) gate.hidden = true;
    if (adminContent) adminContent.hidden = false;
    refreshAdminPosts();
  }

  async function refreshAdminPosts() {
    if (!postsList || !tokenInput?.value || !apiBaseInput?.value) return;
    try {
      const response = await fetch(apiUrl("/api/admin/posts"), { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      postsList.innerHTML = "";
      if (!data.posts.length) {
        postsList.innerHTML = "<li>아직 admin에서 만든 글이 없습니다.</li>";
        return;
      }
      for (const post of data.posts) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = post.url || "#";
        link.textContent = `${post.title} (${post.category})`;
        item.append(link);
        postsList.append(item);
      }
    } catch (error) {
      postsList.innerHTML = `<li>목록 로드 실패: ${error.message}</li>`;
    }
  }

  function updatePreview() {
    if (!preview || !postForm) return;
    const values = Object.fromEntries(new FormData(postForm).entries());
    preview.innerHTML = "";
    const title = document.createElement("h3");
    title.textContent = values.title || "제목 미입력";
    const meta = document.createElement("p");
    meta.textContent = `${values.category || "LLM"} · ${values.tags || "태그 없음"}`;
    const body = document.createElement("p");
    body.textContent = String(values.description || values.markdown || "본문을 입력하면 미리보기가 표시됩니다.").slice(0, 180);
    preview.append(title, meta, body);
  }

  gateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = gateForm.elements.entryPassword.value;
    const hash = await sha256Hex(password);
    if (hash !== ENTRY_PASSWORD_HASH) {
      setGateStatus("비밀번호가 맞지 않습니다.", "error");
      gateForm.elements.entryPassword.select();
      return;
    }
    setGateStatus("확인되었습니다.", "success");
    unlockAdmin();
  });

  connectionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    rememberConnection();
    setStatus("연결 설정을 브라우저에 저장했습니다.", "success");
    refreshAdminPosts();
  });

  postForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    rememberConnection();
    setStatus("Publishing...");
    const payload = Object.fromEntries(new FormData(postForm).entries());
    payload.tags = csv(payload.tags);
    try {
      const response = await fetch(apiUrl("/api/admin/posts"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      setStatus(`GitHub에 반영했습니다. URL: ${data.postUrl}`, "success");
      await refreshAdminPosts();
    } catch (error) {
      setStatus(`발행 실패: ${error.message}`, "error");
    }
  });

  blogSettingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    rememberConnection();
    setStatus("목록 설정 업데이트 중...");
    const values = Object.fromEntries(new FormData(blogSettingsForm).entries());
    const payload = {
      blogTitle: values.blogTitle,
      description: values.description,
      categoryOrder: csv(values.categoryOrder),
      featuredTags: csv(values.featuredTags),
    };
    try {
      const response = await fetch(apiUrl("/api/admin/settings"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      setStatus("블로그 목록 설정을 GitHub에 반영했습니다.", "success");
    } catch (error) {
      setStatus(`설정 저장 실패: ${error.message}`, "error");
    }
  });

  postForm?.addEventListener("input", updatePreview);
  apiBaseInput?.addEventListener("change", rememberConnection);
  tokenInput?.addEventListener("change", () => {
    rememberConnection();
    refreshAdminPosts();
  });

  const storedToken = localStorage.getItem("msd_admin_token");
  const storedApiBase = localStorage.getItem("msd_api_base");
  if (storedToken && tokenInput) tokenInput.value = storedToken;
  if (apiBaseInput) apiBaseInput.value = storedApiBase || apiBaseInput.value || window.MSD_API_BASE || "";

  updatePreview();
  if (sessionStorage.getItem("msd_admin_unlocked") === "1") unlockAdmin();
})();
