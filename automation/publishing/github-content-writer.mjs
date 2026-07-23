import { GitHubPublishError } from "./github-app-publisher.mjs";

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

export function createGitHubContentWriter({
  appId,
  privateKey,
  installationId,
  owner,
  repo,
  branch = "main",
  fetchFn = fetch,
  apiBaseUrl = "https://api.github.com",
  jwtFactory = signJwt,
} = {}) {
  const config = {
    appId: required(appId, "GITHUB_APP_ID"),
    privateKey: normalizePrivateKey(privateKey),
    installationId: required(installationId, "GITHUB_INSTALLATION_ID"),
    owner: required(owner, "GITHUB_OWNER"),
    repo: required(repo, "GITHUB_REPOSITORY"),
    branch: required(branch, "GITHUB_ADMIN_BRANCH"),
  };

  async function github(path, options = {}) {
    const response = await fetchFn(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "memory-systems-daily-admin",
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
    const jwt = await jwtFactory({ appId: config.appId, privateKey: config.privateKey });
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

  async function existingContent(token, path, branch) {
    try {
      const encoded = encodeURIComponent(path).replace(/%2F/g, "/");
      const { body } = await withToken(token, `/repos/${config.owner}/${config.repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`);
      return body;
    } catch (error) {
      if (error instanceof GitHubPublishError && error.details.status === 404) return null;
      throw error;
    }
  }

  return {
    async putFile({ path, content, message, branch = config.branch }) {
      const targetBranch = required(branch, "branch");
      const token = await installationToken();
      const existing = await existingContent(token, required(path, "path"), targetBranch);
      const { body } = await withToken(
        token,
        `/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
        {
          method: "PUT",
          body: JSON.stringify({
            message: required(message, "message"),
            content: base64Encode(String(content ?? "")),
            branch: targetBranch,
            ...(existing?.sha ? { sha: existing.sha } : {}),
          }),
        },
      );
      return {
        provider: "github",
        branch: targetBranch,
        filePath: path,
        commitSha: body.commit.sha,
        fileUrl: body.content?.html_url ?? null,
      };
    },
  };
}
