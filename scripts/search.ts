import dotenv from 'dotenv';
import path from 'path';
import { runSearch } from './lib/search-core';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

//   npx tsx scripts/search.ts "חלב 3%" [limit]
async function main(): Promise<void> {
  const query = process.argv[2];
  const limit = Number(process.argv[3]) || 10;
  if (!query) {
    console.log('Usage: npx tsx scripts/search.ts "<query>" [limit]');
    process.exit(1);
  }

  const result = await runSearch(query, limit);

  console.log('RESULT_JSON_START');
  console.log(JSON.stringify(result, null, 2));
  console.log('RESULT_JSON_END');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
