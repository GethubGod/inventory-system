// PostgREST caps responses at 1000 rows, silently truncating larger result
// sets. fetchAll pages a select with .range() until a short page comes back,
// concatenating the rows. The builder must return a FRESH query per page with
// a fully deterministic order (add an .order("id") tiebreaker) so consecutive
// pages never overlap or skip rows.

const PAGE_SIZE = 1000;

interface PageResult {
  data: unknown;
  error: { message: string } | null;
}

export async function fetchAll<Row>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data as Row[] | null) ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
