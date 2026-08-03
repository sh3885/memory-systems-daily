(function () {
  const admin = window.MSDAdmin;
  if (!admin) return;

  const settingsForm = document.querySelector("[data-blog-settings]");
  const connectionForm = document.querySelector("[data-admin-connection]");
  const resetButton = document.querySelector("[data-connection-reset]");

  function csv(value) {
    return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(settingsForm).entries());
    admin.setStatus("설정 저장 중...");
    try {
      await admin.request("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({
          blogTitle: values.blogTitle,
          description: values.description,
          categoryOrder: csv(values.categoryOrder),
          featuredTags: csv(values.featuredTags),
        }),
      });
      admin.setStatus("설정을 저장했습니다. 공개 사이트는 다음 배포에 반영됩니다.", "success");
    } catch (error) {
      admin.setStatus(`설정 저장 실패: ${error.message}`, "error");
    }
  });

  connectionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = admin.normalizeBase(connectionForm.elements.apiBase.value);
    if (value) localStorage.setItem("msd_api_base", value);
    else localStorage.removeItem("msd_api_base");
    admin.setStatus("Worker 주소를 이 브라우저에 저장했습니다.", "success");
  });

  resetButton?.addEventListener("click", () => {
    localStorage.removeItem("msd_api_base");
    if (connectionForm) connectionForm.elements.apiBase.value = window.MSD_API_BASE || "";
    admin.setStatus("기본 Worker 주소로 되돌렸습니다.", "success");
  });

  admin.onReady(() => {
    const stored = localStorage.getItem("msd_api_base");
    if (stored && connectionForm) connectionForm.elements.apiBase.value = stored;
  });
})();
