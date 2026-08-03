(function () {
  const admin = window.MSDAdmin;
  const form = document.querySelector("[data-admin-form]");
  if (!admin || !form) return;

  const preview = document.querySelector("[data-admin-preview]");
  const submitButton = form.querySelector("[data-admin-submit]");
  const deleteButton = form.querySelector("[data-admin-delete]");
  const mode = form.dataset.mode;
  const slug = form.dataset.slug || "";

  function csv(value) {
    return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  function updatePreview() {
    if (!preview) return;
    const values = Object.fromEntries(new FormData(form).entries());
    preview.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = values.title || "제목 미입력";
    const meta = document.createElement("p");
    meta.textContent = `${values.category || "LLM"} · ${values.tags || "태그 없음"}`;
    const body = document.createElement("p");
    body.textContent = String(values.description || values.markdown || "본문을 입력하면 미리보기가 표시됩니다.").slice(0, 220);
    preview.append(title, meta, body);
  }

  async function loadExistingPost() {
    admin.setStatus("글을 불러오는 중...");
    try {
      const data = await admin.request(`/api/admin/posts/${encodeURIComponent(slug)}`);
      const post = data.post;
      form.elements.title.value = post.title || "";
      form.elements.slug.value = post.slug || slug;
      form.elements.description.value = post.description || "";
      form.elements.category.value = post.category || "System";
      form.elements.tags.value = (post.tags || []).join(", ");
      form.elements.markdown.value = post.markdown || "";
      admin.setStatus("불러왔습니다. 저장하면 같은 URL로 반영됩니다.", "success");
      updatePreview();
    } catch (error) {
      admin.setStatus(`글을 불러오지 못했습니다: ${error.message}`, "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.tags = csv(payload.tags);
    if (mode === "edit") payload.slug = slug;

    if (submitButton) submitButton.disabled = true;
    admin.setStatus(mode === "edit" ? "저장 중..." : "발행 중...");
    try {
      const data = await admin.request(
        mode === "edit" ? `/api/admin/posts/${encodeURIComponent(slug)}` : "/api/admin/posts",
        { method: mode === "edit" ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      admin.setStatus(
        `${mode === "edit" ? "저장했습니다" : "발행했습니다"}. 공개 사이트는 다음 배포에 반영됩니다. (${data.postUrl || ""})`,
        "success",
      );
      if (mode === "new") window.setTimeout(() => { window.location.href = "/admin/"; }, 1200);
    } catch (error) {
      admin.setStatus(`${mode === "edit" ? "저장" : "발행"} 실패: ${error.message}`, "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  deleteButton?.addEventListener("click", async () => {
    const label = form.elements.title.value || slug;
    if (!window.confirm(`"${label}" 글을 삭제할까요?\n\nGitHub에서 글 파일이 지워지며 되돌릴 수 없습니다.`)) return;
    deleteButton.disabled = true;
    admin.setStatus("삭제 중...");
    try {
      await admin.request(`/api/admin/posts/${encodeURIComponent(slug)}`, { method: "DELETE" });
      admin.setStatus("삭제했습니다. 목록으로 이동합니다.", "success");
      window.setTimeout(() => { window.location.href = "/admin/"; }, 900);
    } catch (error) {
      deleteButton.disabled = false;
      admin.setStatus(`삭제 실패: ${error.message}`, "error");
    }
  });

  form.addEventListener("input", updatePreview);

  admin.onReady(() => {
    updatePreview();
    if (mode === "edit" && slug) loadExistingPost();
  });
})();
