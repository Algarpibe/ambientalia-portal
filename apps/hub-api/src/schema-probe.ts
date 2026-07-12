import { getHubPool } from './db.js';

// One-off hub schema introspection. Run with a HUB_DB_URL that can reach the
// hub (inside EasyPanel, or via a tunnel):
//   HUB_DB_URL="postgres://hub_reader:***@host:5432/zoho-hub" npx tsx src/schema-probe.ts
// The /debug/schema endpoint in index.ts exposes the same info over HTTP.

async function main() {
  const db = getHubPool();

  const { rows: tables } = await db.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'books' ORDER BY table_name`
  );
  console.log('BOOKS TABLES:', tables.map((t: { table_name: string }) => t.table_name));

  for (const t of ['invoices', 'customer_payments', 'customer_payment_invoices', 'payments']) {
    const { rows: cols } = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'books' AND table_name = $1 ORDER BY ordinal_position`,
      [t]
    );
    if (cols.length) console.log(`\nbooks.${t} COLUMNS:`, cols);
  }

  const { rows: counts } = await db.query(
    `SELECT (SELECT count(*) FROM crm.deals) deals,
            (SELECT count(*) FROM books.invoices) invoices,
            (SELECT count(*) FROM desk.tickets) tickets`
  );
  console.log('\nCOUNTS:', counts[0]);

  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
