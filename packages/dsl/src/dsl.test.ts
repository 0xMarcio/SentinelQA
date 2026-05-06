import { describe, expect, it } from "vitest";
import { compileTestDsl, evaluateVisualThreshold, generateSelectors, interpolateVariables, mergeVariables } from "./index.js";

describe("DSL validation", () => {
  it("requires target and value fields based on command", () => {
    const compiled = compileTestDsl({
      name: "Example",
      startUrl: "http://localhost",
      steps: [{ id: "s1", command: "fill", sequence: 2 }]
    });

    expect(compiled.issues.map((issue) => issue.message)).toContain("fill requires a target");
    expect(compiled.issues.map((issue) => issue.message)).toContain("fill requires a value");
    expect(compiled.dsl.steps[0]?.sequence).toBe(1);
  });
});

describe("variable interpolation", () => {
  it("applies documented precedence", () => {
    const variables = mergeVariables({
      testDefaults: { host: "default", color: "blue" },
      testSecrets: { apiKey: "secret" },
      suiteVariables: { host: "suite" },
      environmentVariables: { host: "env" },
      dataSourceRowVariables: { host: "row" },
      runVariables: { host: "run" }
    });

    expect(interpolateVariables("https://{{host}}/{{color}}?key={{apiKey}}", variables)).toBe("https://run/blue?key=secret");
  });
});

describe("selector generator", () => {
  it("prefers stable data attributes over dynamic ids", () => {
    const el = {
      tagName: "BUTTON",
      id: "btn-9f8a7c6b5d4e3f2a",
      className: "primary css-a1b2c3d",
      textContent: "Save",
      getAttribute: (name: string) => (name === "data-testid" ? "save-button" : null),
      parentElement: null,
      children: []
    };

    const selectors = generateSelectors(el);
    expect(selectors.primary).toBe('[data-testid="save-button"]');
    expect(selectors.backups).toContain("button.primary");
  });
});

describe("visual threshold", () => {
  it("fails when diff percentage is above threshold", () => {
    expect(evaluateVisualThreshold(1000, 4, 0.5).passed).toBe(true);
    expect(evaluateVisualThreshold(1000, 8, 0.5).passed).toBe(false);
  });
});
