import settings from "./blog-settings.json";

export type BlogCategoryId = "llm" | "memory" | "system";

export type BlogCategory = {
  id: BlogCategoryId;
  label: string;
  path: string;
  description: string;
};

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  url: string;
  category: BlogCategoryId;
  categoryLabel: string;
  tags: string[];
  lessonDate: string;
  minutes?: number;
};

export type BlogTag = {
  tag: string;
  count: number;
  slug: string;
  path: string;
};

type MarkdownModule = {
  frontmatter?: Record<string, unknown>;
};

export const blogSettings = settings;

export const blogCategories: BlogCategory[] = [
  {
    id: "llm",
    label: "LLM",
    path: "/llm/",
    description: "Transformer, inference, serving, agent workload, token-level memory traffic.",
  },
  {
    id: "memory",
    label: "Memory",
    path: "/memory/",
    description: "DRAM, HBM, DDR, CXL, emerging memory, memory-controller behavior.",
  },
  {
    id: "system",
    label: "System",
    path: "/system/",
    description: "CPU/GPU architecture, cache, NUMA, I/O, interconnect, and performance analysis.",
  },
];

export const orderedBlogCategories = [...blogCategories].sort((left, right) => {
  const order = blogSettings.categoryOrder as string[];
  return order.indexOf(left.id) - order.indexOf(right.id);
});

const categoryAliases: Record<string, BlogCategoryId> = {
  llm: "llm",
  ai: "llm",
  model: "llm",
  memory: "memory",
  dram: "memory",
  hbm: "memory",
  cxl: "memory",
  system: "system",
  systems: "system",
  architecture: "system",
  performance: "system",
};

const postModules = import.meta.glob<MarkdownModule>("../pages/posts/*.{md,mdx}", { eager: true });

export function normalizeCategory(value: unknown): BlogCategoryId {
  const key = String(value ?? "").trim().toLowerCase();
  return categoryAliases[key] ?? "system";
}

export function categoryById(id: BlogCategoryId): BlogCategory {
  return blogCategories.find((category) => category.id === id) ?? blogCategories[2];
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function slugFromPath(path: string) {
  return path.split("/").pop()?.replace(/\.(md|mdx)$/i, "") ?? "post";
}

export function tagSlug(tag: string) {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "tag";
}

export const posts: BlogPost[] = Object.entries(postModules)
  .map(([path, module]) => {
    const frontmatter = module.frontmatter ?? {};
    const category = normalizeCategory(frontmatter.category);
    const categoryInfo = categoryById(category);
    const slug = slugFromPath(path);
    return {
      slug,
      title: stringValue(frontmatter.title, slug),
      description: stringValue(frontmatter.description, "No description yet."),
      url: `/posts/${slug}/`,
      category,
      categoryLabel: categoryInfo.label,
      tags: stringArray(frontmatter.tags),
      lessonDate: stringValue(frontmatter.lessonDate ?? frontmatter.pubDate ?? frontmatter.date),
      minutes: Number.isFinite(Number(frontmatter.minutes)) ? Number(frontmatter.minutes) : undefined,
    };
  })
  .sort((left, right) => right.lessonDate.localeCompare(left.lessonDate) || right.title.localeCompare(left.title));

export function postsForCategory(category: BlogCategoryId) {
  return posts.filter((post) => post.category === category);
}

export function tagCloud(limit = 24): BlogTag[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count, slug: tagSlug(tag), path: `/tags/${tagSlug(tag)}/` }));
}

export function allTags() {
  return tagCloud(Number.MAX_SAFE_INTEGER);
}

export function postsForTagSlug(slug: string) {
  return posts.filter((post) => post.tags.some((tag) => tagSlug(tag) === slug));
}

export function archiveMonths() {
  const counts = new Map<string, number>();
  for (const post of posts) {
    if (!post.lessonDate) continue;
    const month = post.lessonDate.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([month, count]) => ({ month, count }));
}

export function relatedPosts(post: BlogPost, limit = 4) {
  const tagSet = new Set(post.tags.map(tagSlug));
  return posts
    .filter((candidate) => candidate.url !== post.url)
    .map((candidate) => ({
      post: candidate,
      score:
        (candidate.category === post.category ? 2 : 0) +
        candidate.tags.filter((tag) => tagSet.has(tagSlug(tag))).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.post.lessonDate.localeCompare(left.post.lessonDate))
    .slice(0, limit)
    .map((entry) => entry.post);
}
