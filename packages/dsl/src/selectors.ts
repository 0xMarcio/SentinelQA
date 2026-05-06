const dynamicTokenPattern = /(?:^|[-_])(?:[a-f0-9]{8,}|[0-9]{4,}|css-[a-z0-9]{5,}|ng-[a-z0-9]{5,})(?:$|[-_])/i;

export interface ElementLike {
  tagName: string;
  id?: string | null;
  className?: string | null;
  textContent?: string | null;
  getAttribute(name: string): string | null;
  parentElement?: ElementLike | null;
  children?: ArrayLike<ElementLike>;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function stable(value: string | null | undefined): value is string {
  return Boolean(value && value.trim() && !dynamicTokenPattern.test(value));
}

function nthOfType(el: ElementLike): number {
  const parent = el.parentElement;
  if (!parent?.children) {
    return 1;
  }
  const tag = el.tagName.toLowerCase();
  let count = 0;
  for (const child of Array.from(parent.children)) {
    if (child.tagName.toLowerCase() === tag) {
      count += 1;
    }
    if (child === el) {
      return count;
    }
  }
  return 1;
}

export function generateSelectors(el: ElementLike): { primary: string; backups: string[] } {
  const candidates: string[] = [];
  const tag = el.tagName.toLowerCase();
  for (const attr of ["data-testid", "data-test", "data-qa", "aria-label", "name"]) {
    const value = el.getAttribute(attr);
    if (stable(value)) {
      candidates.push(`[${attr}="${cssEscape(value)}"]`);
    }
  }

  if (stable(el.id)) {
    candidates.push(`#${cssEscape(el.id!)}`);
  }

  const classes = (el.className ?? "")
    .split(/\s+/)
    .filter(stable)
    .slice(0, 3);
  if (classes.length > 0) {
    candidates.push(`${tag}.${classes.map(cssEscape).join(".")}`);
  }

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text && text.length <= 80) {
    candidates.push(`${tag}:has-text("${cssEscape(text)}")`);
  }

  const path: string[] = [];
  let cursor: ElementLike | null | undefined = el;
  while (cursor && cursor.tagName.toLowerCase() !== "html" && path.length < 5) {
    const part = `${cursor.tagName.toLowerCase()}:nth-of-type(${nthOfType(cursor)})`;
    path.unshift(part);
    cursor = cursor.parentElement;
  }
  candidates.push(path.join(" > "));

  const unique = [...new Set(candidates.filter(Boolean))];
  return {
    primary: unique[0] ?? tag,
    backups: unique.slice(1, 5)
  };
}

export function isLikelyDynamicSelectorToken(value: string): boolean {
  return dynamicTokenPattern.test(value);
}

