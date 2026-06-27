import { launchUi } from '../scripts/ui-capture.mjs';
const { page, close, errors } = await launchUi();
const reqs = [];
page.on('request', (r) => { const u=r.url(); if (u.includes('/api/classes/')||u.includes('/api/files?')||u.endsWith('/api/files')) reqs.push(u.replace('http://localhost:3000','')); });
async function snap(label){
  await page.waitForTimeout(1200);
  const hdr=(await page.locator('body').innerText()).match(/(\d+)\s+files?/);
  const hasResume = (await page.locator('body').innerText()).includes('resume.pdf');
  const checks = await page.locator('[id^="cls-"]').evaluateAll(els=>els.map(e=>({id:e.id, checked:e.getAttribute('aria-checked')})));
  console.log(`\n## ${label}`);
  console.log('  reqs:', reqs.splice(0).join(' | ')||'(none)');
  console.log('  header:', hdr?hdr[0]:'?', '| resume.pdf visible:', hasResume);
  console.log('  checkboxes:', JSON.stringify(checks));
}
try {
  await page.goto('/files', { waitUntil:'networkidle' }); await snap('initial All Files');
  await page.locator('#cls-documents').click(); await snap('check Documents (solo)');
  await page.locator('#cls-travel').click();    await snap('also check Travel (docs+travel)');
  await page.locator('#cls-documents').click(); await snap('uncheck Documents (travel only?)');
} finally { if(errors.length) console.log('ERRORS:\n'+errors.join('\n')); await close(); }
