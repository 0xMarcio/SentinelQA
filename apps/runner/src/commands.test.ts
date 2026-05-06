import { describe, expect, it } from "vitest";
import { runnerCommands } from "./commands.js";

describe("runner command mapping", () => {
  it("maps supported DSL commands to execution primitives", () => {
    expect(runnerCommands.click).toBe("locator.click");
    expect(runnerCommands.checkAccessibility).toBe("AxeBuilder.analyze");
    expect(Object.keys(runnerCommands)).toContain("captureScreenshot");
  });
});

