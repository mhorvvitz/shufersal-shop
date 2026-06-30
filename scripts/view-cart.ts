import dotenv from 'dotenv';
import path from 'path';
import { runViewCart } from './lib/view-cart-core';

// Load credentials from the skill's own .env (see README).
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const dictPath = path.join(__dirname, '..', 'product-dictionary.json');

runViewCart(dictPath)
  .then((result) => {
    console.log('RESULT_JSON_START');
    console.log(JSON.stringify(result, null, 2));
    console.log('RESULT_JSON_END');
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
