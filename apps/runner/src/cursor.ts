import type { Locator, Page } from "playwright";

const cursorScript = `
(() => {
  const id = "sentinelqa-video-cursor";
  const styleId = "sentinelqa-video-cursor-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = \`
      #\${id} {
        position: fixed;
        left: 0;
        top: 0;
        width: 32px;
        height: 32px;
        pointer-events: none;
        z-index: 2147483647;
        opacity: 0;
        transform: translate3d(0, 0, 0);
        transition: transform 160ms ease-out, opacity 80ms ease-out;
        will-change: transform, opacity;
      }
      #\${id}.is-visible { opacity: 1; }
      #\${id} svg {
        display: block;
        width: 32px;
        height: 32px;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.55));
      }
      #\${id}::after {
        content: "";
        position: absolute;
        left: 2px;
        top: 2px;
        width: 24px;
        height: 24px;
        border: 2px solid rgba(52, 211, 153, .9);
        border-radius: 999px;
        opacity: 0;
        transform: scale(.45);
      }
      #\${id}.is-clicking::after {
        animation: sentinelqa-cursor-click 280ms ease-out;
      }
      @keyframes sentinelqa-cursor-click {
        0% { opacity: .95; transform: scale(.45); }
        100% { opacity: 0; transform: scale(1.45); }
      }
    \`;
    document.documentElement.appendChild(style);
  }
  let cursor = document.getElementById(id);
  if (!cursor) {
    cursor = document.createElement("div");
    cursor.id = id;
    cursor.setAttribute("aria-hidden", "true");
    cursor.innerHTML = \`
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 3.8L24.4 18.7L15.6 20.1L11.4 28.1L6 3.8Z" fill="white" stroke="#111827" stroke-width="2.2" stroke-linejoin="round"/>
      </svg>
    \`;
    document.documentElement.appendChild(cursor);
  }
})();
`;

export async function moveCursorToLocator(page: Page, locator: Locator, timeoutMs: number): Promise<boolean> {
  await locator.scrollIntoViewIfNeeded({ timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
  const box = await locator.boundingBox({ timeout: Math.min(timeoutMs, 5000) }).catch(() => null);
  if (!box) return false;
  await moveCursorToPoint(page, box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

export async function pulseCursor(page: Page): Promise<void> {
  await ensureCursor(page);
  await page
    .evaluate(() => {
      const cursor = document.getElementById("sentinelqa-video-cursor");
      if (!cursor) return;
      cursor.classList.remove("is-clicking");
      void cursor.offsetWidth;
      cursor.classList.add("is-clicking");
    })
    .catch(() => undefined);
  await page.waitForTimeout(140).catch(() => undefined);
}

export async function animateCursorDrag(page: Page, source: Locator, target: Locator, timeoutMs: number): Promise<boolean> {
  await source.scrollIntoViewIfNeeded({ timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
  const sourceBox = await source.boundingBox({ timeout: Math.min(timeoutMs, 5000) }).catch(() => null);
  if (!sourceBox) return false;

  await moveCursorToPoint(page, sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await pulseCursor(page);

  await target.scrollIntoViewIfNeeded({ timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
  const targetBox = await target.boundingBox({ timeout: Math.min(timeoutMs, 5000) }).catch(() => null);
  if (!targetBox) return true;

  await page
    .evaluate(
      ({ x, y }) => {
        const cursor = document.getElementById("sentinelqa-video-cursor");
        if (!cursor) return;
        cursor.style.transition = "transform 360ms ease-in-out, opacity 80ms ease-out";
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        cursor.classList.add("is-visible");
        window.setTimeout(() => {
          cursor.style.transition = "transform 160ms ease-out, opacity 80ms ease-out";
        }, 380);
      },
      { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 }
    )
    .catch(() => undefined);
  await page.waitForTimeout(380).catch(() => undefined);
  return true;
}

export async function hideCursor(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document.getElementById("sentinelqa-video-cursor")?.classList.remove("is-visible", "is-clicking");
    })
    .catch(() => undefined);
  await page.waitForTimeout(100).catch(() => undefined);
}

async function moveCursorToPoint(page: Page, x: number, y: number): Promise<void> {
  await ensureCursor(page);
  await page
    .evaluate(
      ({ x, y }) => {
        const cursor = document.getElementById("sentinelqa-video-cursor");
        if (!cursor) return;
        cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        cursor.classList.add("is-visible");
      },
      { x, y }
    )
    .catch(() => undefined);
  await page.waitForTimeout(120).catch(() => undefined);
}

async function ensureCursor(page: Page): Promise<void> {
  await page.evaluate(cursorScript).catch(() => undefined);
}
