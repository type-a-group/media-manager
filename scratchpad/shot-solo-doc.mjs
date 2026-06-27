import { launchUi } from '../scripts/ui-capture.mjs';
const { page, shoot, close } = await launchUi();
try {
  await page.goto('/files?class=documents', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await shoot('solo-documents-overlap-chips');
} finally { await close(); }
