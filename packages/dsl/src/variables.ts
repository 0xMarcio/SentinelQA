export type VariableMap = Record<string, string>;

export interface VariableLayers {
  testDefaults?: VariableMap;
  testSecrets?: VariableMap;
  suiteVariables?: VariableMap;
  environmentVariables?: VariableMap;
  dataSourceRowVariables?: VariableMap;
  runVariables?: VariableMap;
}

export function mergeVariables(layers: VariableLayers): VariableMap {
  return {
    ...(layers.testDefaults ?? {}),
    ...(layers.testSecrets ?? {}),
    ...(layers.suiteVariables ?? {}),
    ...(layers.environmentVariables ?? {}),
    ...(layers.dataSourceRowVariables ?? {}),
    ...(layers.runVariables ?? {})
  };
}

export function interpolateVariables(input: string | null | undefined, variables: VariableMap): string {
  if (input == null) {
    return "";
  }
  return input.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? "");
}

export function interpolateObject<T>(value: T, variables: VariableMap): T {
  if (typeof value === "string") {
    return interpolateVariables(value, variables) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => interpolateObject(entry, variables)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, interpolateObject(entry, variables)])
    ) as T;
  }
  return value;
}
