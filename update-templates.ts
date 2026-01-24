import { SQLiteStorage } from './src/storage/sqlite.js';
import { WorkflowStorage } from './src/storage/workflow.js';

const db = new SQLiteStorage('./fleet.db');
const wf = new WorkflowStorage(db);

console.log('Seeding/updating templates...');
wf.seedTemplates();

// Verify
const templates = wf.listWorkflows({ isTemplate: true });
for (const t of templates) {
  console.log(`\n=== ${t.name} ===`);
  const gateStep = t.definition.steps.find(s => s.type === 'gate');
  if (gateStep) {
    console.log('Gate config:', JSON.stringify(gateStep.config, null, 2));
  }
}

db.close();
console.log('\nDone!');
