import { launchUi } from '../scripts/ui-capture.mjs';

const { page, shoot, close, errors } = await launchUi();
try {
	// Files — solo the Images class via ?class=images.
	await page.goto('/files?class=images', { waitUntil: 'networkidle' });
	await page.waitForTimeout(900);
	await shoot('files-catalog-filter-off');

	// Toggle "Incomplete only" → grid should shrink from 3 to 2.
	await page.getByLabel('Incomplete only').click();
	await page.waitForTimeout(900);
	await shoot('files-catalog-incomplete-on');

	// Navigate to the plain All-Files hub — the "Show" control must be ABSENT.
	await page.goto('/files', { waitUntil: 'networkidle' });
	await page.waitForTimeout(800);
	await shoot('files-hub-no-control');
} finally {
	if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
	await close();
}
