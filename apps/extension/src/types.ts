import type { TestStep } from "@sentinelqa/dsl";

export type RecorderMode = "operations" | "assertions" | "screenshot" | "accessibility";

export interface RecorderSettings {
  apiBase: string;
  token: string;
  organizationId?: string;
  projectId?: string;
  suiteId?: string;
  appendTestId?: string;
  createNew: boolean;
  mode: RecorderMode;
  active: boolean;
  steps: TestStep[];
}

export const defaultSettings: RecorderSettings = {
  apiBase: "http://localhost:4000",
  token: "sentinelqa-dev-token",
  createNew: true,
  mode: "operations",
  active: false,
  steps: []
};

