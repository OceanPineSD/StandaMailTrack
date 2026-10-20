import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api";

const ORIGIN = "https://t.example.workers.dev";

function fakeFetch(status: number, body: unknown = {}) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe("api client", () => {
  it("registers an email with the bearer token", async () => {
    const fetch = fakeFetch(200, { id: "x", created: true });
    const api = createApi({ origin: ORIGIN, token: "tok", fetch });
    await api.register({ id: "x", subject: "s", recipients: ["a@b.c"], links: ["https://a.com/"] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/api/emails`);
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init!.body as string)).toEqual({ id: "x", subject: "s", recipients: ["a@b.c"], links: ["https://a.com/"] });
  });

  it("patches thread and message ids", async () => {
    const fetch = fakeFetch(200);
    await createApi({ origin: ORIGIN, token: "tok", fetch }).patch("x", { thread_id: "t", message_id: "m" });
    expect(fetch.mock.calls[0][0]).toBe(`${ORIGIN}/api/emails/x`);
    expect(fetch.mock.calls[0][1]!.method).toBe("PATCH");
  });

  it("throws ApiError with the status on a non-2xx answer", async () => {
    const api = createApi({ origin: ORIGIN, token: "tok", fetch: fakeFetch(401) });
    await expect(api.register({ id: "x", subject: "", recipients: [], links: [] })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
    expect(new ApiError(500, "x")).toBeInstanceOf(Error);
  });

  it("checkConnection tells a wrong token from an unreachable Worker", async () => {
    // An authorized lookup of an unknown email answers 404.
    expect(await createApi({ origin: ORIGIN, token: "tok", fetch: fakeFetch(404) }).checkConnection()).toBe("ok");
    expect(await createApi({ origin: ORIGIN, token: "bad", fetch: fakeFetch(401) }).checkConnection()).toBe("unauthorized");
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await createApi({ origin: ORIGIN, token: "tok", fetch: down }).checkConnection()).toBe("unreachable");
  });
});

describe("api client: read routes", () => {
  it("looks up threads with the ids url-encoded in one query", async () => {
    const fetch = fakeFetch(200, { threads: {} });
    await createApi({ origin: ORIGIN, token: "tok", fetch }).threads(["a b", "c"]);
    expect(fetch.mock.calls[0][0]).toBe(`${ORIGIN}/api/threads?ids=a%20b%2Cc`);
    expect(fetch.mock.calls[0][1]!.method).toBe("GET");
  });

  it("fetches one email's detail and posts self views", async () => {
    const fetch = fakeFetch(200, {});
    const api = createApi({ origin: ORIGIN, token: "tok", fetch });
    await api.email("x");
    await api.selfViews(["x", "y"]);
    expect(fetch.mock.calls[0][0]).toBe(`${ORIGIN}/api/emails/x`);
    expect(fetch.mock.calls[1][0]).toBe(`${ORIGIN}/api/self-views`);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ ids: ["x", "y"] });
  });
});
