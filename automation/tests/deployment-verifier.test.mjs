import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createHttpDeploymentVerifier } from "../publishing/deployment-verifier.mjs";

describe("deployment verifier", () => {
  test("retries cache-busted URLs until the deployed post and listings agree", async () => {
    const requests = [];
    const sleeps = [];
    let postAttempt = 0;
    const verify = createHttpDeploymentVerifier({
      attempts: 3,
      delayMs: 1,
      sleepFn: async (delay) => { sleeps.push(delay); },
      fetchFn: async (url) => {
        requests.push(url);
        if (url.includes("/posts/example/")) {
          postAttempt += 1;
          return new Response(postAttempt === 1 ? "old page" : "Example post", { status: 200 });
        }
        return new Response("/posts/example/ Example post", { status: 200 });
      },
    });

    const result = await verify({
      postUrl: "https://example.test/posts/example/",
      homeUrl: "https://example.test/",
      categoryUrl: "https://example.test/llm/",
      title: "Example post",
      path: "/posts/example/",
    });

    assert.equal(result.attempts, 2);
    assert.deepEqual(sleeps, [1]);
    assert.equal(requests.every((url) => new URL(url).searchParams.has("msd_verify")), true);
  });

  test("bounds a hung deployment fetch with a timeout", async () => {
    const verify = createHttpDeploymentVerifier({
      attempts: 1,
      fetchTimeoutMs: 5,
      fetchFn: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    });

    await assert.rejects(
      () => verify({ postUrl: "https://example.test/posts/example/", title: "Example post" }),
      (error) => error.code === "HTTP_TIMEOUT",
    );
  });
});
