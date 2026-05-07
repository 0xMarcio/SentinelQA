import { browserSettingsSchema, type BrowserSettings } from "./schema.js";

export type BrowserOptions = Partial<BrowserSettings>;

export const defaultBrowserSettings: BrowserSettings = browserSettingsSchema.parse({});

export function normalizeBrowserOptions(value: unknown): BrowserOptions {
  return browserSettingsSchema.partial().parse(value ?? {});
}

export function mergeBrowserSettings(suiteOptions: unknown, testOptions: unknown): BrowserSettings {
  const suite = normalizeBrowserOptions(suiteOptions);
  const test = browserSettingsSchema.parse(testOptions ?? {});

  return browserSettingsSchema.parse({
    ...suite,
    ...test,
    headers: {
      ...(suite.headers ?? {}),
      ...(test.headers ?? {})
    },
    localStorage: {
      ...(suite.localStorage ?? {}),
      ...(test.localStorage ?? {})
    },
    cookies: [
      ...(suite.cookies ?? []),
      ...(test.cookies ?? [])
    ]
  });
}
