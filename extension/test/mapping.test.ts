import { describe, expect, it } from "vitest";
import { unwrapGoogleRedirect, inject } from "../src/inject";
import { campaignFor, isForbiddenOrigin, parseMapping, shouldTrack } from "../src/mapping";

const ORIGIN = "https://track.example.com";
const CSV = [
  "email,name,campaign,id,pseudonym",
  'alice@med.cornell.edu,"Doe, Alice",imaging-physician,AbCdEfGhIjKlMnOpQrStUv,anon-AbCdEfGhIj',
  "bob@x.com,Bob,staff,short-id,anon-nope", // malformed id: skipped
].join("\n");

describe("mapping import", () => {
  it("indexes rows by lower-cased email and skips malformed ids", () => {
    const idx = parseMapping(CSV);
    expect(Object.keys(idx)).toEqual(["alice@med.cornell.edu"]);
    expect(idx["alice@med.cornell.edu"]).toEqual({
      id: "AbCdEfGhIjKlMnOpQrStUv",
      pseudonym: "anon-AbCdEfGhIj",
      campaign: "imaging-physician",
    });
  });
});

describe("shouldTrack", () => {
  it("prefix turns tracking on, the manual toggle wins both ways", () => {
    expect(shouldTrack(null, "Cornell research: EP guide", "Cornell research:", false)).toBe(true);
    expect(shouldTrack(null, "cornell RESEARCH: hi", "Cornell research:", false)).toBe(true);
    expect(shouldTrack(null, "Lunch?", "Cornell research:", false)).toBe(false);
    expect(shouldTrack(false, "Cornell research: EP guide", "Cornell research:", true)).toBe(false);
    expect(shouldTrack(true, "Lunch?", "Cornell research:", false)).toBe(true);
    expect(shouldTrack(null, "Lunch?", "", true)).toBe(true);
  });
});

describe("campaignFor", () => {
  it("prefers the mapping entry, then the configured campaign, then the de-prefixed subject", () => {
    const entry = { id: "A".repeat(22), pseudonym: "anon-x", campaign: "ep" };
    expect(campaignFor(entry, "fallback", "Cornell research: hi", "Cornell research:")).toBe("ep");
    expect(campaignFor(undefined, "fallback", "Cornell research: hi", "Cornell research:")).toBe("fallback");
    expect(campaignFor(undefined, "", "Cornell research: EP outreach", "Cornell research:")).toBe("EP outreach");
    expect(campaignFor(undefined, "", "Plain subject", "Cornell research:")).toBe("Plain subject");
  });
});

describe("isForbiddenOrigin", () => {
  it("rejects workers.dev and garbage, accepts the custom domain", () => {
    expect(isForbiddenOrigin("https://x.oceanpine99.workers.dev")).toBe(true);
    expect(isForbiddenOrigin("not a url")).toBe(true);
    expect(isForbiddenOrigin("https://track.standahealth.com")).toBe(false);
  });
});

describe("google wrapper unwrap", () => {
  const WRAPPED = "https://www.google.com/url?q=https://docs.example.com/d/F7&source=gmail&ust=179&usg=AO";

  it("unwraps /url wrappers and leaves everything else alone", () => {
    expect(unwrapGoogleRedirect(WRAPPED)).toBe("https://docs.example.com/d/F7");
    expect(unwrapGoogleRedirect("https://www.google.com/search?q=x")).toBe("https://www.google.com/search?q=x");
    expect(unwrapGoogleRedirect("https://a.com/")).toBe("https://a.com/");
  });

  it("inject tracks the unwrapped target and leaves already-tracked wrapped links as direct tracked links", () => {
    const already = `https://www.google.com/url?q=${ORIGIN}/c/${"B".repeat(22)}/0&ust=179`;
    const html = `<div><a href="${WRAPPED}">guide</a> <a href="${already}">old</a></div>`;
    const out = inject(html, { id: "A".repeat(22), origin: ORIGIN });
    expect(out.links).toEqual(["https://docs.example.com/d/F7"]);
    expect(out.html).toContain(`href="${ORIGIN}/c/${"A".repeat(22)}/0"`);
    expect(out.html).toContain(`href="${ORIGIN}/c/${"B".repeat(22)}/0"`); // unwrapped, not re-tracked
    expect(out.html).not.toContain("google.com/url");
  });
});
