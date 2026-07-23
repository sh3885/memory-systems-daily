const categoryMap = new Map([
  ["llm", "LLM"],
  ["ai", "LLM"],
  ["memory", "Memory"],
  ["dram", "Memory"],
  ["hbm", "Memory"],
  ["cxl", "Memory"],
  ["system", "System"],
  ["systems", "System"],
  ["architecture", "System"],
  ["performance", "System"],
]);

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  return normalized || fallback;
}

function frontmatterString(value) {
  return JSON.stringify(cleanText(value));
}

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80) || `post-${new Date().toISOString().slice(0, 10)}`;
}

export function normalizeAdminCategory(value) {
  return categoryMap.get(String(value ?? "").trim().toLowerCase()) ?? "System";
}

export function normalizeAdminTags(value) {
  if (Array.isArray(value)) return value.map((tag) => cleanText(tag)).filter(Boolean).slice(0, 12);
  return String(value ?? "")
    .split(",")
    .map((tag) => cleanText(tag))
    .filter(Boolean)
    .slice(0, 12);
}

function titleFromMarkdown(markdown, fallback) {
  const heading = cleanText(markdown).split("\n").find((line) => /^#\s+\S/.test(line));
  return heading ? heading.replace(/^#\s+/, "").trim() : fallback;
}

function descriptionFromMarkdown(markdown, fallback) {
  const line = cleanText(markdown)
    .split("\n")
    .map((entry) => entry.replace(/^#+\s+/, "").trim())
    .find((entry) => entry && !entry.startsWith("- ") && !entry.startsWith("```"));
  return cleanText(line, fallback).slice(0, 180);
}

export function renderAdminMarkdownPost(input = {}) {
  const rawBody = input.markdown ?? input.body;
  const titleSeed = cleanText(input.title, "Untitled");
  const body = cleanText(rawBody, `# ${titleSeed}\n\nWrite the post body here.`);
  const title = cleanText(input.title, titleFromMarkdown(body, "Untitled"));
  const description = cleanText(input.description, descriptionFromMarkdown(body, title));
  const category = normalizeAdminCategory(input.category);
  const tags = normalizeAdminTags(input.tags);
  const slug = slugify(input.slug || title);
  const lessonDate = cleanText(input.lessonDate, new Date().toISOString().slice(0, 10));
  const minutes = Number.isFinite(Number(input.minutes)) ? Math.max(1, Math.trunc(Number(input.minutes))) : null;
  const bodyWithHeading = /^#\s+\S/m.test(body) ? body : `# ${title}\n\n${body}`;
  const frontmatter = [
    "---",
    "layout: ../../layouts/PostLayout.astro",
    `title: ${frontmatterString(title)}`,
    `description: ${frontmatterString(description)}`,
    `lessonDate: ${frontmatterString(lessonDate)}`,
    `category: ${frontmatterString(category)}`,
    `tags: [${tags.map((tag) => frontmatterString(tag)).join(", ")}]`,
    minutes ? `minutes: ${minutes}` : null,
    "source: admin",
    "---",
  ].filter(Boolean);
  return {
    slug,
    title,
    description,
    category,
    tags,
    lessonDate,
    content: [...frontmatter, "", bodyWithHeading, ""].join("\n"),
    url: `/posts/${slug}/`,
    filePath: `src/pages/posts/${slug}.md`,
  };
}
