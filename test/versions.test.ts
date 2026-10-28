/**
 * The package is published to npm, the official MCP registry and ClawHub from
 * four separately-declared versions. They must move together, or a listing
 * points at a package version that does not exist.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_VERSION } from "../dist/server.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("release versions", () => {
  const pkg = JSON.parse(read("package.json"));
  const manifest = JSON.parse(read("server.json"));
  const skillVersion = /^version:\s*(\S+)$/m.exec(read("skill/SKILL.md"))?.[1];

  it("package.json, server.json, the server constant and the skill agree", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.packages[0].version).toBe(pkg.version);
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(skillVersion).toBe(pkg.version);
  });

  it("server.json names the npm package and registry name package.json declares", () => {
    expect(manifest.packages[0].identifier).toBe(pkg.name);
    expect(manifest.name).toBe(pkg.mcpName);
  });

  it("ships the licence text it claims", () => {
    expect(pkg.license).toBe("MIT");
    expect(pkg.files).toContain("LICENSE");
    expect(read("LICENSE")).toMatch(/^MIT License/);
  });
});
