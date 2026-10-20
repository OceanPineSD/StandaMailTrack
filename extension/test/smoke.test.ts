import { describe, expect, it } from "vitest";

describe("test env", () => {
  it("has a DOM", () => {
    document.body.innerHTML = "<p>hi</p>";
    expect(document.querySelector("p")?.textContent).toBe("hi");
  });
});
