import dotenv from 'dotenv';
import path from 'path';

// Every runner loads the skill's own .env (see README). Importing this module is what
// performs that load, so import it before reading any process.env value.
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

export interface ShufersalCredentials {
  username: string;
  password: string;
}

export function requireCredentials(env: NodeJS.ProcessEnv = process.env): ShufersalCredentials {
  const username = env['SHUFERSAL_USERNAME'];
  const password = env['SHUFERSAL_PASSWORD'];
  if (!username || !password) {
    throw new Error('SHUFERSAL_USERNAME and SHUFERSAL_PASSWORD must be set in .env');
  }
  return { username, password };
}
