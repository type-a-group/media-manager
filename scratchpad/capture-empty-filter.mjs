import { launchUi } from '../scripts/ui-capture.mjs';

const { page, shoot, close, errors } = await launchUi();
try {
	// Records — Notes type. Open directly via ?type=notes.
	await page.goto('/media?type=notes', { waitUntil: 'networkidle' });
	await page.waitForTimeout(800);
	await shoot('records-rail-filter-off');

	// Toggle "Incomplete only".
	const incomplete = page.getByLabel('Incomplete only');
	await incomplete.click();
	await page.waitForTimeout(800);
	await shoot('records-rail-incomplete-on');

	// Turn it off, then pick a per-field "is empty" (title).
	await incomplete.click();
	await page.waitForTimeout(300);
	// Open the per-field Select (the trigger showing the em dash).
	await page.getByText('Field', { exact: true }).locator('..').getByRole('combobox').click();
	await page.waitForTimeout(300);
	await shoot('records-rail-field-picker-open');
} finally {
	if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
	await close();
}
