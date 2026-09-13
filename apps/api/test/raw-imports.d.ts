// Vite's `?raw` import, used by test/wrangler-config.test.ts to read wrangler.jsonc as text.
declare module "*?raw" {
  const content: string;
  export default content;
}
