import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

// A stalled request must expose the existing recovery action, not leave the
// observatory resolving forever. Network interception keeps the real fetch.
test('stalled topology has a deadline and Try again can recover', async ({ page }) => {
  let requests = 0;
  const failures = [];
  page.on('requestfailed', request => {
    if (request.url().endsWith('/graph.json')) failures.push(request.failure().errorText);
  });
  let stalledRoute;
  await page.route('**/graph.json', route => {
    requests += 1;
    if (requests === 1) stalledRoute = route;
    else return route.continue();
  });
  await page.clock.install();
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => requests).toBe(1);
  await page.clock.pauseAt(new Date());
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'loading');
  await expect(page.locator('#loading-notice')).toBeVisible();
  await page.clock.fastForward(15_000);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#loading-notice')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.locator('.sector-button')).toHaveCount(0);
  await expect(page.locator('#explore-tools')).toBeHidden();
  // Late completion of the expired request must not resurrect the app.
  await stalledRoute.continue();
  await expect.poll(() => failures).toEqual(['net::ERR_ABORTED']);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'error');
  expect(requests).toBe(1);
  await page.clock.resume();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('#fallback')).toBeHidden();
  await expect(page.locator('#explore-tools')).toBeHidden();
});

test('topology deadline includes a stalled response body', async ({ page }) => {
  // A real streaming HTTP response distinguishes body completion from headers.
  let disconnected = false;
  const server = createServer((_request, response) => {
    response.on('close', () => { disconnected = true; });
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    response.write('{"version":1,');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/graph.json`;
    await page.route('**/graph.json', route => route.continue({ url }));
    await page.clock.install();
    const headers = page.waitForResponse(response => response.url().endsWith('/graph.json'));
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    expect((await headers).status()).toBe(200);
    await page.clock.pauseAt(new Date());
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'loading');
    await page.clock.fastForward(15_000);
    await expect(page.locator('#app')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#loading-notice')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
    await expect(page.locator('.sector-button')).toHaveCount(0);
    await expect.poll(() => disconnected).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('successful topology remains ready past the former loading deadline', async ({ page }) => {
  let requests = 0;
  await page.route('**/graph.json', route => {
    requests += 1;
    return route.continue();
  });
  await page.clock.install();
  await page.goto('./');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#observatory')).toHaveAttribute('data-renderer', 'webgl');
  await page.clock.fastForward(15_000);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#fallback')).toBeHidden();
  await expect(page.locator('#loading-notice')).toBeHidden();
  await expect(page.locator('#explore-tools')).toBeHidden();
  expect(requests).toBe(1);
});
