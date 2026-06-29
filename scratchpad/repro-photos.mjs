import { launchUi } from '../scripts/ui-capture.mjs';
const { page, shoot, close, errors } = await launchUi();
try {
	await page.goto('/files', { waitUntil: 'networkidle' });
	await page.waitForTimeout(1000);
	const before = (await page.locator('body').innerText()).match(/(\d+)\s+files?/);
	console.log('All Files header:', before ? before[0] : '?');
	await page.locator('#cls-photos').click();
	await page.waitForTimeout(1500);
	const after = (await page.locator('body').innerText()).match(/(\d+)\s+files?/);
	console.log('After solo Photos header:', after ? after[0] : '?');
	await shoot('real-solo-photos');
} finally {
	if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
	await close();
}
