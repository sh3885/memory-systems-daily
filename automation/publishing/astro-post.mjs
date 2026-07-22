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

function arrayFrontmatter(values) {
  return `[${values.map((value) => frontmatterString(value)).join(", ")}]`;
}

const refCategoryMap = [
  [/^M01|^M06|^M07|^M12/, "LLM"],
  [/^M02|^M03|^M04|^M10|^M11/, "Memory"],
  [/^M05|^M08|^M09/, "System"],
];

const taxonomyRules = [
  {
    category: "LLM",
    patterns: [/llm/i, /transformer/i, /token/i, /attention/i, /kv cache/i, /serving/i, /inference/i, /decode/i, /prefill/i],
    tags: ["LLM", "Transformer"],
  },
  {
    category: "Memory",
    patterns: [/dram/i, /hbm/i, /ddr/i, /lpddr/i, /gddr/i, /cxl/i, /memory controller/i, /row buffer/i, /bank/i],
    tags: ["Memory", "DRAM"],
  },
  {
    category: "System",
    patterns: [/cpu/i, /gpu/i, /cache/i, /numa/i, /roofline/i, /interconnect/i, /pcie/i, /fabric/i, /performance/i],
    tags: ["System", "Architecture"],
  },
];

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

export function taxonomyForPost({ lesson, content }) {
  const text = `${lesson?.curriculumRef ?? ""}\n${content ?? ""}`;
  const refCategory = refCategoryMap.find(([pattern]) => pattern.test(String(lesson?.curriculumRef ?? "")))?.[1];
  const scores = taxonomyRules.map((rule) => ({
    ...rule,
    score: rule.patterns.filter((pattern) => pattern.test(text)).length,
  }));
  const matched = scores.sort((left, right) => right.score - left.score)[0];
  const category = matched.score > 0 ? matched.category : refCategory ?? "System";
  const baseTags = taxonomyRules.find((rule) => rule.category === category)?.tags ?? [category];
  const keywordTags = [
    [/kv cache/i, "KV Cache"],
    [/bandwidth/i, "Bandwidth"],
    [/latency/i, "Latency"],
    [/hbm/i, "HBM"],
    [/dram/i, "DRAM"],
    [/cxl/i, "CXL"],
    [/roofline/i, "Roofline"],
    [/token/i, "Token"],
    [/attention/i, "Attention"],
    [/gpu/i, "GPU"],
    [/cpu/i, "CPU"],
  ]
    .filter(([pattern]) => pattern.test(text))
    .map(([, tag]) => tag);
  return {
    category,
    tags: unique([...baseTags, ...keywordTags]).slice(0, 8),
  };
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
  const taxonomy = taxonomyForPost({ lesson, content: body });
  return [
    "---",
    "layout: ../../layouts/PostLayout.astro",
    `title: ${frontmatterString(title)}`,
    `description: ${frontmatterString(description)}`,
    `lessonDate: ${frontmatterString(lesson.lessonDate)}`,
    `curriculumRef: ${frontmatterString(lesson.curriculumRef)}`,
    `category: ${frontmatterString(taxonomy.category)}`,
    `tags: ${arrayFrontmatter(taxonomy.tags)}`,
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
