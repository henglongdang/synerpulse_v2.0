import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { createCategorySchema, updateCategorySchema, type CategoryDTO } from '@synerpulse/shared';
import { categories } from '../../db/schema';
import { db } from '../../lib/deps';
import { newId } from '../../lib/crypto';
import { conflict, notFound, parse } from '../../lib/errors';
import { currentHousehold, currentUser, idParam, requireCap } from '../../lib/http';
import { logActivity } from '../../lib/activity';

export const categoriesRouter = Router({ mergeParams: true });

const GROUP_DEFAULT_COLOR = { living: '#E8780C', entertainment: '#8E1E9E', unexpected: '#D2381F', income: '#1F7A4D' } as const;

export function toCategoryDTO(c: typeof categories.$inferSelect): CategoryDTO {
  return { id: c.id, name: c.name, group: c.group, color: c.color, archived: Boolean(c.archivedAt) };
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === '23505' || err?.cause?.code === '23505';
}

categoriesRouter.get('/', async (req, res) => {
  const rows = await db()
    .select()
    .from(categories)
    .where(eq(categories.householdId, currentHousehold(req).id))
    .orderBy(asc(categories.group), asc(categories.name));
  res.json({ categories: rows.map(toCategoryDTO) });
});

categoriesRouter.post('/', requireCap('categories.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const input = parse(createCategorySchema, req.body);
  try {
    const [row] = await db()
      .insert(categories)
      .values({ id: newId(), householdId: h.id, name: input.name, group: input.group, color: input.color ?? GROUP_DEFAULT_COLOR[input.group] })
      .returning();
    await logActivity(db(), {
      householdId: h.id,
      actorId: currentUser(req).id,
      entityType: 'category',
      entityId: row.id,
      action: 'created',
      summary: `added the category “${row.name}”`,
    });
    res.status(201).json({ category: toCategoryDTO(row) });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`A category named “${input.name}” already exists`);
    throw e;
  }
});

categoriesRouter.patch('/:categoryId', requireCap('categories.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const id = idParam(req, 'categoryId', 'Category');
  const input = parse(updateCategorySchema, req.body);
  const { archived, ...rest } = input;
  try {
    const [row] = await db()
      .update(categories)
      .set({ ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) })
      .where(and(eq(categories.id, id), eq(categories.householdId, h.id)))
      .returning();
    if (!row) throw notFound('Category');
    res.json({ category: toCategoryDTO(row) });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`A category with that name already exists`);
    throw e;
  }
});
