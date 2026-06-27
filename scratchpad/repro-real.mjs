import { launchUi } from '../scripts/ui-capture.mjs';
const { page, shoot, close, errors } = await launchUi();
const reqs = [];
page.on('request', (r) => { const u=r.url(); if (u.includes('/api/classes/')||u.includes('/api/files')) reqs.push(u.replace('http://localhost:3000','')); });
try {
  await page.goto('/files', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  const before = (await page.locator('body').innerText()).match(/(\d+)\s+files?/);
  console.log('initial header:', before?before[0]:'?');
  console.log('checkbox ids present:', await page.locator('[id^="cls-"]').evaluateAll(els=>els.map(e=>e.id)));
  reqs.length=0;
  await page.locator('#cls-travel').click({force:true}); await page.waitForTimeout(1500);
  const after = (await page.locator('body').innerText()).match(/(\d+)\s+files?/);
  console.log('REQS after click:', reqs.join(' | ') || '(NONE)');
  console.log('after header:', after?after[0]:'?');
  console.log('breadcrumb:', (await page.locator('nav').first().innerText().catch(()=>'?')));
  await shoot('real-after-travel');
} finally { if(errors.length) console.log('ERRORS:\n'+errors.join('\n')); await close(); }
