(function () {
  const form = document.querySelector("#post-form");
  const status = document.querySelector("#post-status");
  const tokenInput = document.querySelector("#admin-token");
  const apiBaseInput = document.querySelector("#api-base");
  const postsList = document.querySelector("#admin-posts");

  const storedToken = localStorage.getItem("msd_admin_token");
  const storedApiBase = localStorage.getItem("msd_api_base");
  if (storedToken) tokenInput.value = storedToken;
  if (storedApiBase) apiBaseInput.value = storedApiBase;

  function apiUrl(path) {
    return `${apiBaseInput.value.replace(/\/+$/, "")}${path}`;
  }

  function authHeaders() {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${tokenInput.value}`,
    };
  }

  function csv(value) {
    return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function remember() {
    localStorage.setItem("msd_admin_token", tokenInput.value);
    localStorage.setItem("msd_api_base", apiBaseInput.value.replace(/\/+$/, ""));
  }

  async function refreshAdminPosts() {
    if (!tokenInput.value || !apiBaseInput.value) return;
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    remember();
    setStatus("Publishing...");
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.tags = csv(payload.tags);
    try {
      const response = await fetch(apiUrl("/api/admin/posts"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      setStatus(`Published to GitHub. URL: ${data.postUrl}`);
      await refreshAdminPosts();
    } catch (error) {
      setStatus(`Publish failed: ${error.message}`);
    }
  });

  document.querySelector("#save-settings").addEventListener("click", async () => {
    remember();
    setStatus("Updating settings...");
    const payload = {
      blogTitle: document.querySelector("#blog-title").value,
      description: document.querySelector("#blog-description").value,
      categoryOrder: csv(document.querySelector("#category-order").value),
      featuredTags: csv(document.querySelector("#featured-tags").value),
    };
    try {
      const response = await fetch(apiUrl("/api/admin/settings"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      setStatus("Settings pushed to GitHub.");
    } catch (error) {
      setStatus(`Update failed: ${error.message}`);
    }
  });

  tokenInput.addEventListener("change", () => {
    remember();
    refreshAdminPosts();
  });
  apiBaseInput.addEventListener("change", () => {
    remember();
    refreshAdminPosts();
  });
  refreshAdminPosts();
})();
