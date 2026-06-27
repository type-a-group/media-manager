import { launchUi } from '../scripts/ui-capture.mjs';

const { page, close, errors } = await launchUi();
const reqs = [];
page.on('request', (r) => {
	const u = r.url();
	if (u.includes('/api/files') || u.includes('/api/classes/')) reqs.push(u.replace('http://localhost:3000', ''));
});
async function state(label) {
	await page.waitForTimeout(700);
	const crumb = await page.locator('nav, [aria-label="breadcrumb"]').first().innerText().catch(() => '?');
	const tiles = await page.locator('img[alt], .truncate').allInnerTexts().catch(() => []);
	const names = (await page.getByText(/\.(png|txt)$/).allInnerTexts().catch(() => []));
	console.log(`\n## ${label}`);
	console.log('  reqs:', reqs.splice(0).join(' | ') || '(none)');
	console.log('  tile names:', [...new Set(names)].join(', ') || '(none)');
}
try {
	await page.goto('/files', { waitUntil: 'networkidle' });
	await state('initial (All Files)');
	await page.locator('#cls-images').click();
	await state('check Images (solo)');
	await page.locator('#cls-documents').click();
	await state('also check Documents (2 → any of)');
	await page.locator('#cls-images').click();
	await state('uncheck Images (back to Documents solo)');
	await page.locator('#cls-documents').click();
	await state('uncheck Documents (back to All Files)');
} finally {
	if (errors.length) console.log('\nCONSOLE ERRORS:\n' + errors.join('\n'));
	await close();
}
