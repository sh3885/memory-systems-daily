export class GitHubPublishError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GitHubPublishError";
    this.code = code;
    this.details = details;
  }
}

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new GitHubPublishError("MISCONFIGURED", `${field} is required`, { field });
  return normalized;
}

function normalizePrivateKey(value) {
  return required(value, "GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
}

function base64Encode(value) {
  if (typeof Buffer !== "undefined") return Buffer.from(value).toString("base64");
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function normalizedBase64(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

function base64UrlEncode(value) {
  return base64Encode(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToDer(pem) {
  const base64 = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function derLength(length) {
  if (length < 128) return [length];
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function derSequence(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  return new Uint8Array([0x30, ...derLength(length), ...parts.flatMap((part) => Array.from(part))]);
}

function derOctetString(bytes) {
  return new Uint8Array([0x04, ...derLength(bytes.length), ...bytes]);
}

function pkcs1ToPkcs8(pkcs1Der) {
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  return derSequence(version, rsaAlgorithmIdentifier, derOctetString(pkcs1Der));
}

async function signJwt({ appId, privateKey, now = () => Date.now() }) {
  const normalizedKey = normalizePrivateKey(privateKey);
  const der = pemToDer(normalizedKey);
  const pkcs8 = normalizedKey.includes("BEGIN RSA PRIVATE KEY") ? pkcs1ToPkcs8(der) : der;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const issuedAt = Math.floor(now() / 1000) - 60;
  const expiresAt = issuedAt + 540;
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(JSON.stringify({ iat: issuedAt, exp: expiresAt, iss: String(appId) }));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return `${input}.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

function parseNextLink(linkHeader) {
  const link = String(linkHeader ?? "");
  const match = link.split(",").map((part) => part.trim()).find((part) => part.endsWith('rel="next"'));
  return match?.match(/<([^>]+)>/)?.[1] ?? null;
}

function parseJsonResponse(text, { path, status }) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new GitHubPublishError("GITHUB_NON_JSON_RESPONSE", `GitHub API returned non-JSON response: ${status}`, {
      path,
      status,
      bodyText: text.slice(0, 500),
      cause: error.message,
    });
  }
}

export function createGitHubAppPublisher({
  appId,
  privateKey,
  installationId,
  owner,
  repo,
  branch,
  fetchFn = fetch,
  now = () => Date.now(),
  apiBaseUrl = "https://api.github.com",
  jwtFactory = signJwt,
} = {}) {
  const config = {
    appId: required(appId, "GITHUB_APP_ID"),
    privateKey: normalizePrivateKey(privateKey),
    installationId: required(installationId, "GITHUB_INSTALLATION_ID"),
    owner: required(owner, "GITHUB_OWNER"),
    repo: required(repo, "GITHUB_REPOSITORY"),
    branch: required(branch, "GITHUB_CONTENT_BRANCH"),
  };

  async function github(path, options = {}) {
    const response = await fetchFn(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "memory-systems-daily-bot",
        "x-github-api-version": "2022-11-28",
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    const body = parseJsonResponse(text, { path, status: response.status });
    if (!response.ok) {
      throw new GitHubPublishError("GITHUB_API_ERROR", body?.message ?? `GitHub API failed: ${response.status}`, {
        path,
        status: response.status,
        body,
      });
    }
    return { body, response };
  }

  async function installationToken() {
    const jwt = await jwtFactory({ appId: config.appId, privateKey: config.privateKey, now });
    const { body } = await github(`/app/installations/${config.installationId}/access_tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
    });
    return required(body?.token, "installation token");
  }

  async function withToken(token, path, options = {}) {
    return github(path, {
      ...options,
      headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
  }

  async function getDefaultBranch(token) {
    const { body } = await withToken(token, `/repos/${config.owner}/${config.repo}`);
    return required(body.default_branch, "default_branch");
  }

  async function getRef(token, ref) {
    try {
      const { body } = await withToken(token, `/repos/${config.owner}/${config.repo}/git/ref/heads/${ref}`);
      return body;
    } catch (error) {
      if (error instanceof GitHubPublishError && error.details.status === 404) return null;
      throw error;
    }
  }

  async function ensureBranch(token, baseBranch) {
    const target = await getRef(token, config.branch);
    if (target) return { branch: config.branch, sha: target.object.sha, created: false };
    const base = await getRef(token, baseBranch);
    if (!base) throw new GitHubPublishError("BASE_BRANCH_NOT_FOUND", `Base branch not found: ${baseBranch}`);
    const { body } = await withToken(token, `/repos/${config.owner}/${config.repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${config.branch}`, sha: base.object.sha }),
    });
    return { branch: config.branch, sha: body.object.sha, created: true };
  }

  async function existingContent(token, path) {
    try {
      const { body } = await withToken(
        token,
        `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(config.branch)}`,
      );
      return body;
    } catch (error) {
      if (error instanceof GitHubPublishError && error.details.status === 404) return null;
      throw error;
    }
  }

  async function putFile(token, { path, content, message, branchSha }) {
    const existing = await existingContent(token, path);
    const encodedContent = base64Encode(content);
    if (existing?.content && normalizedBase64(existing.content) === encodedContent) {
      return {
        body: { commit: { sha: branchSha }, content: existing },
        skipped: true,
      };
    }
    const { body } = await withToken(
      token,
      `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: encodedContent,
          branch: config.branch,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        }),
      },
    );
    return { body, skipped: false };
  }

  async function findOpenPullRequest(token, baseBranch) {
    let url = `${apiBaseUrl}/repos/${config.owner}/${config.repo}/pulls?state=open&head=${encodeURIComponent(`${config.owner}:${config.branch}`)}&base=${encodeURIComponent(baseBranch)}`;
    while (url) {
      const response = await fetchFn(url, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "memory-systems-daily-bot",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      });
      const text = await response.text();
      const pulls = parseJsonResponse(text, { path: new URL(url).pathname, status: response.status });
      if (!response.ok) {
        throw new GitHubPublishError("GITHUB_API_ERROR", pulls?.message ?? "Could not list pull requests", {
          status: response.status,
          body: pulls,
        });
      }
      if (pulls.length) return pulls[0];
      url = parseNextLink(response.headers.get("link"));
    }
    return null;
  }

  async function ensurePullRequest(token, { baseBranch, title, body }) {
    const existing = await findOpenPullRequest(token, baseBranch);
    if (existing) return { pullRequest: existing, created: false };
    const { body: pullRequest } = await withToken(token, `/repos/${config.owner}/${config.repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title,
        body,
        head: config.branch,
        base: baseBranch,
      }),
    });
    return { pullRequest, created: true };
  }

  return {
    async publishPost({ path, content, message, title, body }) {
      const token = await installationToken();
      const baseBranch = await getDefaultBranch(token);
      const branchState = await ensureBranch(token, baseBranch);
      const file = await putFile(token, { path, content, message, branchSha: branchState.sha });
      const directToProduction = config.branch === baseBranch;
      const pull = directToProduction
        ? { pullRequest: null, created: false }
        : await ensurePullRequest(token, { baseBranch, title, body });
      return {
        provider: "github",
        branch: config.branch,
        baseBranch,
        filePath: path,
        commitSha: file.body.commit.sha,
        fileUrl: file.body.content?.html_url ?? null,
        pullRequestUrl: pull.pullRequest?.html_url ?? null,
        pullRequestNumber: pull.pullRequest?.number ?? null,
        createdPullRequest: pull.created,
        skippedCommit: file.skipped,
      };
    },
  };
}
