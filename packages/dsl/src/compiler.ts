import {
  targetRequiredCommands,
  testDslSchema,
  type TestDsl,
  type TestStep,
  valueRequiredCommands,
  variableNameRequiredCommands
} from "./schema.js";

export interface CompileIssue {
  stepId?: string;
  path: string;
  message: string;
}

export interface CompiledTest {
  dsl: TestDsl;
  issues: CompileIssue[];
}

function blank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

export function normalizeStep(step: TestStep, sequence: number): TestStep {
  return {
    ...step,
    target: step.target?.trim() || null,
    value: step.value ?? null,
    variableName: step.variableName?.trim() || null,
    backupSelectors: [...new Set((step.backupSelectors ?? []).map((selector) => selector.trim()).filter(Boolean))],
    sequence
  };
}

export function compileTestDsl(input: unknown): CompiledTest {
  const parsed = testDslSchema.safeParse(input);
  if (!parsed.success) {
    return {
      dsl: testDslSchema.parse({
        name: "Invalid test",
        startUrl: "about:blank",
        steps: []
      }),
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    };
  }

  const steps = [...parsed.data.steps]
    .sort((a, b) => a.sequence - b.sequence)
    .map((step, index) => normalizeStep(step, index + 1));

  const issues: CompileIssue[] = [];
  for (const step of steps) {
    if (targetRequiredCommands.has(step.command) && blank(step.target)) {
      issues.push({
        stepId: step.id,
        path: `steps.${step.sequence}.target`,
        message: `${step.command} requires a target`
      });
    }
    if (valueRequiredCommands.has(step.command) && blank(step.value)) {
      issues.push({
        stepId: step.id,
        path: `steps.${step.sequence}.value`,
        message: `${step.command} requires a value`
      });
    }
    if (variableNameRequiredCommands.has(step.command) && blank(step.variableName)) {
      issues.push({
        stepId: step.id,
        path: `steps.${step.sequence}.variableName`,
        message: `${step.command} requires a variableName`
      });
    }
    if ((step.command === "executeJs" || step.command === "assertJsReturnsTrue") && blank(step.target) && blank(step.value)) {
      issues.push({
        stepId: step.id,
        path: `steps.${step.sequence}.target`,
        message: `${step.command} requires JavaScript`
      });
    }
    if (step.command === "assertUrlContains" && blank(step.value) && blank(step.target)) {
      issues.push({
        stepId: step.id,
        path: `steps.${step.sequence}.value`,
        message: "assertUrlContains requires a URL fragment"
      });
    }
  }

  return {
    dsl: {
      ...parsed.data,
      steps
    },
    issues
  };
}

export function assertValidDsl(input: unknown): TestDsl {
  const compiled = compileTestDsl(input);
  if (compiled.issues.length > 0) {
    throw new Error(compiled.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return compiled.dsl;
}
