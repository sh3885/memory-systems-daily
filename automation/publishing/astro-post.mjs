function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function frontmatterString(value) {
  return JSON.stringify(String(value ?? "").replace(/\r\n?/g, "\n"));
}

function titleFromMarkdown(content, fallback) {
  const heading = normalizeText(content).split("\n").find((line) => line.match(/^#\s+\S/));
  return heading ? heading.replace(/^#\s+/, "").trim() : fallback;
}

function descriptionFromMarkdown(content, fallback) {
  const line = normalizeText(content)
    .split("\n")
    .map((entry) => entry.replace(/^#+\s+/, "").trim())
    .find((entry) => entry && !entry.startsWith("```") && !entry.startsWith("- "));
  return (line || fallback).slice(0, 160);
}

export function slugFromParts(parts) {
  const slug = parts
    .map((part) => String(part ?? "").toLowerCase())
    .join("-")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "daily-post";
}

export function renderAstroMarkdownPost({ lesson, revision }) {
  const body = normalizeText(revision.content);
  const title = titleFromMarkdown(body, `${lesson.lessonDate} ${lesson.curriculumRef}`);
  const description = descriptionFromMarkdown(body, `${lesson.curriculumRef} daily study note`);
  return [
    "---",
    "layout: ../../layouts/BaseLayout.astro",
    `title: ${frontmatterString(title)}`,
    `description: ${frontmatterString(description)}`,
    `lessonDate: ${frontmatterString(lesson.lessonDate)}`,
    `curriculumRef: ${frontmatterString(lesson.curriculumRef)}`,
    `revisionId: ${frontmatterString(revision.id)}`,
    `revisionNumber: ${Number(revision.revisionNumber)}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

export function publicationPath({ lesson, revision, directory = "src/pages/posts" }) {
  const cleanDirectory = String(directory || "src/pages/posts").replace(/^\/+|\/+$/g, "");
  const slug = slugFromParts([lesson.lessonDate, lesson.curriculumRef, `r${revision.revisionNumber}`]);
  return `${cleanDirectory}/${slug}.md`;
}

export function publicationPermalink({ publicSiteUrl, lesson, revision }) {
  const base = String(publicSiteUrl ?? "").trim().replace(/\/+$/g, "");
  if (!base) return null;
  const slug = slugFromParts([lesson.lessonDate, lesson.curriculumRef, `r${revision.revisionNumber}`]);
  return `${base}/posts/${slug}/`;
}
