import type { CatalogRepository } from './persistence.js';
import { createTransfermarktCatalog } from './catalog-bootstrap.js';

/** Download and persist the open source only when the durable catalog is empty. */
export async function seedCatalogIfEmpty(catalog: CatalogRepository): Promise<boolean> {
  const existing = await catalog.getCatalog();
  if (existing !== null && existing.players.length > 0 && existing.managers.length > 0)
    return false;
  const source = await createTransfermarktCatalog();
  await catalog.replaceCatalog(source);
  return true;
}
