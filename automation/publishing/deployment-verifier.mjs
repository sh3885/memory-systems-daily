export class DeploymentVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DeploymentVerificationError";
    this.code = code;
    this.details = details;
  }
}

function required(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new DeploymentVerificationError("MISCONFIGURED", `${field} is required`, { field });
  return normalized;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheBustedUrl(value, attempt) {
  const url = new URL(value);
  url.searchParams.set("msd_verify", String(attempt));
  return url.toString();
}

async function fetchText(fetchFn, url, { timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchFn(url, {
      headers: { "user-agent": "memory-systems-daily-verifier" },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new DeploymentVerificationError("HTTP_TIMEOUT", `Deployment URL timed out after ${timeoutMs}ms`, { url, timeoutMs });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new DeploymentVerificationError("HTTP_STATUS", `Deployment URL returned HTTP ${response.status}`, {
      url,
      status: response.status,
      bodyText: text.slice(0, 500),
    });
  }
  return text;
}

function missingMarkers(html, markers) {
  return markers.filter((marker) => !html.includes(marker));
}

export function createHttpDeploymentVerifier({
  fetchFn = fetch,
  attempts = 1,
  delayMs = 0,
  fetchTimeoutMs = 8_000,
  sleepFn = sleep,
} = {}) {
  const normalizedAttempts = Math.max(1, Number(attempts) || 1);
  const normalizedDelayMs = Math.max(0, Number(delayMs) || 0);
  const normalizedFetchTimeoutMs = Math.max(1, Number(fetchTimeoutMs) || 8_000);

  return async function verifyDeployment({
    postUrl,
    homeUrl,
    categoryUrl,
    title,
    path,
    extraMarkers = [],
  }) {
    const requiredPostUrl = required(postUrl, "postUrl");
    const postMarkers = unique([title, ...extraMarkers]);
    const listMarkers = unique([path, title]);
    let lastError;

    for (let attempt = 1; attempt <= normalizedAttempts; attempt += 1) {
      try {
        const postHtml = await fetchText(fetchFn, cacheBustedUrl(requiredPostUrl, attempt), { timeoutMs: normalizedFetchTimeoutMs });
        const missingPost = missingMarkers(postHtml, postMarkers);
        if (missingPost.length) {
          throw new DeploymentVerificationError("MISSING_POST_MARKERS", "Post page is reachable but missing expected text", {
            url: requiredPostUrl,
            missing: missingPost,
          });
        }

        for (const url of unique([homeUrl, categoryUrl])) {
          const html = await fetchText(fetchFn, cacheBustedUrl(url, attempt), { timeoutMs: normalizedFetchTimeoutMs });
          const missing = missingMarkers(html, listMarkers);
          if (missing.length) {
            throw new DeploymentVerificationError("MISSING_LIST_MARKERS", "Listing page is reachable but missing the post link or title", {
              url,
              missing,
            });
          }
        }

        return { verified: true, postUrl: requiredPostUrl, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (attempt < normalizedAttempts && normalizedDelayMs > 0) await sleepFn(normalizedDelayMs);
      }
    }

    if (lastError instanceof DeploymentVerificationError) throw lastError;
    throw new DeploymentVerificationError("VERIFY_FAILED", lastError?.message ?? "Deployment verification failed", {
      cause: lastError?.message ?? String(lastError),
    });
  };
}
