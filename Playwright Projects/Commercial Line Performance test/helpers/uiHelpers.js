export async function waitForAppReady(page) {

    const progressBar = page.locator('[role="progressbar"]');

    const isVisible = await progressBar.first().isVisible().catch(() => false);

    if (isVisible) {
        await progressBar.first().waitFor({
            state: 'hidden',
            timeout: 30000
        });
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
}