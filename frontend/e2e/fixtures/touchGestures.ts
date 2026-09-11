import type { Page, Locator } from '@playwright/test';

// Use real browser touch input so touch-action, pointer capture, and multiple
// simultaneous fingers participate; synthetic DOM events miss these behaviors.
export async function touchGesture(page: Page, surface: Locator, kind: 'pinch' | 'left' | 'right' | 'down', cancel = false) {
  const box = (await surface.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 180);
  const points = (step: number) => kind === 'pinch'
    ? [{ x: x - 35 - step * 7, y, id: 1 }, { x: x + 35 + step * 7, y, id: 2 }]
    : [{ x: x + (kind === 'left' ? -step * 14 : kind === 'right' ? step * 14 : 0), y: y + (kind === 'down' ? step * 14 : 0), id: 1 }];
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
    for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) });
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}
