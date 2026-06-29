import { launchUi } from '../scripts/ui-capture.mjs';

const { page, shoot, close, errors } = await launchUi();
const reqs = [];
page.on('request', (r) => {
	const u = r.url();
	if (u.includes('/api/files') || u.includes('/api/classes/') || u.includes('/members')) {
		reqs.push(u.replace('http://localhost:3000', ''));
	}
});
try {
	await page.goto('/files', { waitUntil: 'networkidle' });
	await page.waitForTimeout(800);
	console.log('--- before click ---');
	reqs.length = 0;
	// Click the Images class checkbox.
	await page.locator('#cls-images').click();
	await page.waitForTimeout(1000);
	await shoot('after-check-images');
	console.log('REQUESTS after checking Images:');
	for (const r of reqs) console.log('  ' + r);
	// Count tiles shown.
	const tiles = await page
		.locator('[data-grid-item], .grid-item, figure, [role="gridcell"]')
		.count();
	console.log('tile-ish count (heuristic):', tiles);
	const headerText = await page.locator('body').innerText();
	const m = headerText.match(/(\d+)\s+files?/);
	console.log('header file count text:', m ? m[0] : '(none)');
} finally {
	if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
	await close();
}
