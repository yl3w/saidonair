// `.sql` files are imported as strings via the `Text` module rule in wrangler.jsonc.
declare module "*.sql" {
  const sql: string;
  export default sql;
}
