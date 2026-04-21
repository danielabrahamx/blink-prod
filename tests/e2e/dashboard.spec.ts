import { test, expect } from '@playwright/test';

/* ================================================================== */
/*  User Dashboard - Gateway wallet + configurable policy             */
/* ================================================================== */
test.describe('User dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Start Coverage/i }).click();
  });

  test('shows page title with laptop branding', async ({ page }) => {
    await expect(page.getByText('Blink: Laptop Micro-Insurance')).toBeVisible();
  });

  test('displays Gateway Wallet section with buyer address', async ({ page }) => {
    await expect(page.getByText('Gateway Wallet')).toBeVisible();
    await expect(page.getByText(/Buyer address/)).toBeVisible();
  });

  test('shows USDC balance display', async ({ page }) => {
    await expect(page.getByText(/USDC/i).first()).toBeVisible();
  });

  test('has Deposit 1 USDC to Gateway button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Deposit 1 USDC to Gateway/i })
    ).toBeVisible();
  });

  test('has copy address button', async ({ page }) => {
    await expect(page.locator('button[title="Copy address"]')).toBeVisible();
  });

  test('shows Configure Policy section', async ({ page }) => {
    await expect(page.getByText('Configure Policy')).toBeVisible();
  });

  test('has coverage amount input', async ({ page }) => {
    await expect(page.getByText('Coverage Amount (USDC)')).toBeVisible();
    const input = page.locator('input[type="number"]').first();
    await expect(input).toBeVisible();
  });

  test('has policy duration input', async ({ page }) => {
    await expect(page.getByText('Policy Duration (seconds)')).toBeVisible();
  });

  test('has mode selector with Active Use and Idle options', async ({ page }) => {
    await expect(page.getByText('Coverage Mode')).toBeVisible();
    await expect(page.getByRole('button', { name: /Active Use/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Idle/i })).toBeVisible();
  });

  test('shows cost estimate section', async ({ page }) => {
    await expect(page.getByText('Estimated premium cost')).toBeVisible();
  });

  test('has Start Policy button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /Start Policy/i })
    ).toBeVisible();
  });

  test('mode selector toggles between active and idle', async ({ page }) => {
    // Click idle mode
    await page.getByRole('button', { name: /Idle/i }).click();
    // Verify idle rate text is shown
    await expect(page.getByText(/Idle:.*\/second premium/)).toBeVisible();

    // Click active mode
    await page.getByRole('button', { name: /Active Use/i }).click();
    // Verify active rate text is shown
    await expect(page.getByText(/Active:.*\/second premium/)).toBeVisible();
  });

  test('shows x402 footer text', async ({ page }) => {
    await expect(
      page.getByText('Powered by x402 gasless micropayments on Arc Testnet')
    ).toBeVisible();
  });

  test('Back to Home returns to landing page', async ({ page }) => {
    await page.getByText('Back to Home').click();
    await expect(page.locator('h1')).toContainText('Blink');
  });
});

/* ================================================================== */
/*  Admin Dashboard - direct access (no wallet needed)                */
/* ================================================================== */
test.describe('Admin dashboard - direct access', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Admin Dashboard/i }).click();
  });

  test('shows admin portal heading', async ({ page }) => {
    await expect(page.getByText('Blink: Admin Portal')).toBeVisible();
  });

  test('shows ADMIN badge', async ({ page }) => {
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();
  });

  test('does not require wallet connection', async ({ page }) => {
    // Admin should load directly without any "Connect Wallet" prompt
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('Connect Wallet');
    expect(bodyText).not.toContain('Please connect your wallet');
  });

  test('shows Circle Dev Wallet section', async ({ page }) => {
    await expect(page.getByText('Circle Dev Wallet')).toBeVisible();
  });

  test('shows wallet address', async ({ page }) => {
    await expect(page.getByText('Wallet address')).toBeVisible();
  });

  test('shows wallet USDC and USYC balances', async ({ page }) => {
    await expect(page.getByText(/USDC/).first()).toBeVisible();
    await expect(page.getByText(/USYC/).first()).toBeVisible();
  });

  test('shows Reserve Pool with pool and reserve values', async ({ page }) => {
    await expect(page.getByText('Reserve Pool')).toBeVisible();
    await expect(page.getByText('USDC Pool (premiums):')).toBeVisible();
    await expect(page.getByText('USYC Reserve:')).toBeVisible();
  });

  test('shows deposit USYC form', async ({ page }) => {
    await expect(page.getByPlaceholder('USYC amount')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Deposit USYC/i })
    ).toBeVisible();
  });

  test('shows Trigger Claim section', async ({ page }) => {
    await expect(page.getByText('Trigger Claim Payout')).toBeVisible();
    await expect(page.getByPlaceholder(/Recipient wallet address/)).toBeVisible();
    await expect(page.getByPlaceholder('USDC amount')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Trigger Claim/i })
    ).toBeVisible();
  });

  test('shows Roles section with three active roles', async ({ page }) => {
    await expect(page.getByText('Roles')).toBeVisible();
    const yesIndicators = page.locator('text=Yes');
    await expect(yesIndicators).toHaveCount(3);
  });

  test('has Refresh button', async ({ page }) => {
    await expect(page.getByText('Refresh')).toBeVisible();
  });

  test('shows x402 footer text', async ({ page }) => {
    await expect(
      page.getByText('Powered by x402 gasless micropayments on Arc Testnet')
    ).toBeVisible();
  });

  test('Back to Home returns to landing page', async ({ page }) => {
    await page.getByText('Back to Home').click();
    await expect(page.locator('h1')).toContainText('Blink');
  });
});
