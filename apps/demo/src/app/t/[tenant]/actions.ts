'use server';

import { runTenantAction } from '@kitto/auth/server';
import { canLoadSampleData, isEmptyWorkspace, loadSampleData } from '@/lib/sample-data';

/** "Load sample data" on the workspace home. Refuses once the workspace has data. */
export async function loadSampleDataAction(formData: FormData): Promise<void> {
  await runTenantAction(formData, 'tenant.manage', '/', async (ctx) => {
    if (!canLoadSampleData(ctx)) return { error: 'forbidden' };
    if (!(await isEmptyWorkspace(ctx))) return { error: 'sample_not_empty' };
    await loadSampleData(ctx);
    return { notice: 'sample_loaded' };
  });
}
