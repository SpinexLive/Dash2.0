import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';

// Load the repo-root .env in local development.
const candidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../../../.env'),
];
for (const path of candidates) {
  if (existsSync(path)) {
    config({ path });
    break;
  }
}
