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
  const formTitle = document.querySelector("[data-admin-form-title]");
  const submitButton = document.querySelector("[data-admin-submit]");
  const cancelButton = document.querySelector("[data-admin-cancel]");
  let editingSlug = null;

  const apiBaseInput = connectionForm?.elements.apiBase;

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

  function adminPassword() {
    return sessionStorage.getItem("msd_admin_password") || "";
  }

  function authHeaders() {
    const password = adminPassword();
    return {
      "content-type": "application/json",
      ...(password ? { "x-admin-password": password } : {}),
    };
  }

  function rememberConnection() {
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
    if (!postsList) return;
    if (!adminPassword() || !apiBaseInput?.value) {
      postsList.innerHTML = "<li>관리자 비밀번호로 입장하면 목록을 불러옵니다.</li>";
      return;
    }
    postsList.innerHTML = "<li>목록을 불러오는 중...</li>";
    try {
      const response = await fetch(apiUrl("/api/admin/posts"), { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      postsList.innerHTML = "";
      if (!data.posts.length) {
        postsList.innerHTML = "<li>아직 게시된 글이 없습니다.</li>";
        return;
      }
      for (const post of data.posts) {
        const item = document.createElement("li");
        item.className = "admin-post-row";
        const title = document.createElement("strong");
        title.textContent = post.title || post.slug;
        const detail = document.createElement("p");
        detail.textContent = [post.category, post.title && post.title !== post.slug ? post.slug : ""]
          .filter(Boolean)
          .join(" · ");
        const actions = document.createElement("div");
        actions.className = "admin-row-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => loadPostForEditing(post.slug));
        const link = document.createElement("a");
        link.href = post.url || `/posts/${post.slug}/`;
        link.textContent = "View";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => deletePost(post.slug, post.title));
        actions.append(edit, link, remove);
        item.append(title, detail, actions);
        postsList.append(item);
      }
    } catch (error) {
      postsList.innerHTML = `<li>목록 로드 실패: ${error.message}</li>`;
    }
  }

  async function deletePost(slug, title) {
    if (!window.confirm(`정말 "${title || slug}" 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    rememberConnection();
    setStatus("Deleting post...");
    try {
      const response = await fetch(apiUrl(`/api/admin/posts/${encodeURIComponent(slug)}`), {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      setStatus(`글을 삭제했습니다: ${slug}`, "success");
      if (editingSlug === slug) resetEditor();
      await refreshAdminPosts();
    } catch (error) {
      setStatus(`삭제 실패: ${error.message}`, "error");
    }
  }

  function resetEditor() {
    editingSlug = null;
    postForm?.reset();
    if (postForm?.elements.category) postForm.elements.category.value = "LLM";
    if (postForm?.elements.slug) postForm.elements.slug.disabled = false;
    if (formTitle) formTitle.textContent = "New post";
    if (submitButton) submitButton.textContent = "Publish post";
    if (cancelButton) cancelButton.hidden = true;
    updatePreview();
  }

  async function loadPostForEditing(slug) {
    if (!postForm) return;
    rememberConnection();
    setStatus("Loading post...");
    try {
      const response = await fetch(apiUrl(`/api/admin/posts/${encodeURIComponent(slug)}`), { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      const post = data.post;
      editingSlug = post.slug;
      postForm.elements.title.value = post.title || "";
      postForm.elements.slug.value = post.slug;
      postForm.elements.slug.disabled = true;
      postForm.elements.description.value = post.description || "";
      postForm.elements.category.value = post.category || "System";
      postForm.elements.tags.value = (post.tags || []).join(", ");
      postForm.elements.markdown.value = post.markdown || "";
      if (formTitle) formTitle.textContent = `Edit: ${post.title}`;
      if (submitButton) submitButton.textContent = "Update post";
      if (cancelButton) cancelButton.hidden = false;
      setStatus("Editing loaded post. Saving updates the existing URL.", "success");
      updatePreview();
      postForm.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(`Could not load post: ${error.message}`, "error");
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
    sessionStorage.setItem("msd_admin_password", password);
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
    setStatus(editingSlug ? "Updating post..." : "Publishing...");
    const payload = Object.fromEntries(new FormData(postForm).entries());
    payload.tags = csv(payload.tags);
    try {
      const response = await fetch(apiUrl(editingSlug ? `/api/admin/posts/${encodeURIComponent(editingSlug)}` : "/api/admin/posts"), {
        method: editingSlug ? "PUT" : "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      setStatus(`${editingSlug ? "Post updated" : "Post published"}. URL: ${data.postUrl}`, "success");
      resetEditor();
      await refreshAdminPosts();
    } catch (error) {
      setStatus(`발행 실패: ${error.message}`, "error");
    }
  });

  cancelButton?.addEventListener("click", resetEditor);

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
  apiBaseInput?.addEventListener("change", () => {
    rememberConnection();
    refreshAdminPosts();
  });

  const storedApiBase = localStorage.getItem("msd_api_base");
  if (apiBaseInput) apiBaseInput.value = storedApiBase || apiBaseInput.value || window.MSD_API_BASE || "";

  updatePreview();
  if (sessionStorage.getItem("msd_admin_unlocked") === "1" && sessionStorage.getItem("msd_admin_password")) unlockAdmin();
})();
