import { launchUi } from '../scripts/ui-capture.mjs';
const { page, close, errors } = await launchUi();
const reqs = [];
page.on('request', (r) => {
	const u = r.url();
	if (u.includes('/api/classes/') || u.includes('/api/files'))
		reqs.push(u.replace('http://localhost:3000', ''));
});
try {
	await page.goto('/files', { waitUntil: 'networkidle' });
	await page.waitForTimeout(1200);
	reqs.length = 0;
	// Click the LABEL (class name text) — what a real user clicks.
	const label = page.locator('label[for="cls-travel"]');
	console.log('label count:', await label.count());
	await label.click();
	await page.waitForTimeout(1500);
	const checked = await page
		.locator('#cls-travel')
		.getAttribute('aria-checked')
		.catch(() => '?');
	const after = (await page.locator('body').innerText()).match(/(\d+)\s+files?/);
	console.log('after LABEL click — checkbox aria-checked:', checked);
	console.log('REQS:', reqs.join(' | ') || '(NONE)');
	console.log('header:', after ? after[0] : '?');
} finally {
	if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
	await close();
}
