import { test, expect } from '@playwright/test';

/* ================================================================== */
/*  Landing page - laptop micro-insurance branding                    */
/* ================================================================== */
test.describe('Landing page - laptop branding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays BlinkReserve heading', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Blink');
  });

  test('shows per-second laptop micro-insurance tagline', async ({ page }) => {
    await expect(
      page.getByText('Per-second laptop micro-insurance powered by gasless USDC micropayments')
    ).toBeVisible();
  });

  test('renders navigation bar with all menu items', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    await expect(menubar.getByText('Home')).toBeVisible();
    await expect(menubar.getByText('About')).toBeVisible();
    await expect(menubar.getByText('Services')).toBeVisible();
    await expect(menubar.getByText('Contact')).toBeVisible();
  });

  test('shows About section with three feature cards', async ({ page }) => {
    await expect(page.getByText('About Blink')).toBeVisible();
    await expect(page.getByText('Per-Second Premiums')).toBeVisible();
    await expect(page.getByText('Two Coverage Modes')).toBeVisible();
    await expect(page.getByText('Gasless Settlement')).toBeVisible();
  });

  test('displays Get Coverage CTA card', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Get Coverage' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Coverage/i })).toBeVisible();
  });

  test('displays For Insurance Companies CTA card', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'For Insurance Companies' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Admin Dashboard/i })).toBeVisible();
  });

  test('admin card does not mention MetaMask', async ({ page }) => {
    const adminCard = page.locator('text=For Insurance Companies').locator('..');
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('MetaMask required');
  });

  test('shows copyright footer', async ({ page }) => {
    await expect(page.getByText(/2026 Blink/)).toBeVisible();
  });
});

/* ================================================================== */
/*  Landing page - navigation flows                                   */
/* ================================================================== */
test.describe('Landing page - navigation', () => {
  test('navigates to individual dashboard and back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Start Coverage/i }).click();
    await expect(page.getByText('Blink: Laptop Micro-Insurance')).toBeVisible();
    await page.getByText('Back to Home').click();
    await expect(page.locator('h1')).toContainText('Blink');
  });

  test('navigates to admin dashboard and back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Admin Dashboard/i }).click();
    await expect(page.getByText('Blink: Admin Portal')).toBeVisible();
    await page.getByText('Back to Home').click();
    await expect(page.locator('h1')).toContainText('Blink');
  });

  test('NotFound page renders for unknown routes', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page.locator('body')).not.toBeEmpty();
  });
});
