import assert from 'node:assert/strict';
import { extractApplicantId, extractGameId } from './recruit-poll.job';

const sample = `### **1.** What is your In-Game name?
Critical
### **2.** Do you play via Steam or Epic Games?
Steam
### **3.** What is your Steam/EPIC ID?
76561198037633678
### **12.** Why do you want to join 331?
Play ECL

Submission stats
UserId: \`560879380356792338\`
Username: \`criticalfail_\``;

assert.equal(extractApplicantId(sample), '560879380356792338');
assert.equal(extractGameId(sample), '76561198037633678');
console.log('recruit-poll parser checks passed');
