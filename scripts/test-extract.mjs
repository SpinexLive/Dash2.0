// Unit test for the recruit Steam/EPIC ID extraction (no Discord needed).
import { extractGameId } from '../apps/bot/dist/jobs/recruit-poll.job.js';

const cases = [
  {
    name: 'standard numbered format',
    input: '1. Name? Bob\n2. Age? 25\n3. What is your Steam/EPIC ID?\n76561198000000000\n4. Hours? 500',
    expect: '76561198000000000',
  },
  {
    name: 'inline answer with colon',
    input: '3. What is your Steam/EPIC ID?: 76561198123456789',
    expect: '76561198123456789',
  },
  {
    name: 'EPIC id text answer',
    input: '3. What is your Steam/EPIC ID?\nEpic: CoolGamer123',
    expect: 'Epic: CoolGamer123',
  },
  {
    name: 'no question present',
    input: 'Just a random message',
    expect: null,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = extractGameId(c.input);
  const ok = got === c.expect;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}  -> ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
console.log(`\n==== EXTRACTION: ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
