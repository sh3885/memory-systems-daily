(function () {
  const admin = window.MSDAdmin;
  if (!admin) return;

  admin.onReady(() => {
    for (const row of document.querySelectorAll("[data-post-slug]")) {
      const button = row.querySelector("[data-post-delete]");
      if (!button) continue;
      button.addEventListener("click", async () => {
        const { postSlug, postTitle } = row.dataset;
        const label = postTitle || postSlug;
        if (!window.confirm(`"${label}" 글을 삭제할까요?\n\nGitHub에서 글 파일이 지워지며 되돌릴 수 없습니다.`)) return;

        button.disabled = true;
        admin.setStatus(`"${label}" 삭제 중...`);
        try {
          await admin.request(`/api/admin/posts/${encodeURIComponent(postSlug)}`, { method: "DELETE" });
          row.remove();
          admin.setStatus(`"${label}" 글을 삭제했습니다. 공개 사이트는 다음 배포에 반영됩니다.`, "success");
        } catch (error) {
          button.disabled = false;
          admin.setStatus(`삭제 실패: ${error.message}`, "error");
        }
      });
    }
  });
})();
