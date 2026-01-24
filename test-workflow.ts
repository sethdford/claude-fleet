import { SQLiteStorage } from './src/storage/sqlite.js';
import { WorkflowStorage } from './src/storage/workflow.js';
import { WorkflowEngine } from './src/workers/workflow-engine.js';

async function testKahnAlgorithm() {
  console.log('=== TEST: Kahn algorithm full cascade ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('test-dag', {
    steps: [
      { key: 'a', name: 'A', type: 'task', config: { type: 'task', title: 'A' } },
      { key: 'b', name: 'B', type: 'task', dependsOn: ['a'], config: { type: 'task', title: 'B' } },
      { key: 'c', name: 'C', type: 'task', dependsOn: ['a'], config: { type: 'task', title: 'C' } },
      { key: 'd', name: 'D', type: 'task', dependsOn: ['b', 'c'], config: { type: 'task', title: 'D' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  let steps = wf.getStepsByExecution(exec.id);

  console.log('Initial state:');
  steps.forEach(s => console.log(`  ${s.stepKey}: blocked=${s.blockedByCount}`));

  // Complete A
  const stepA = steps.find(s => s.stepKey === 'a')!;
  wf.updateStepStatus(stepA.id, 'completed');
  wf.decrementDependents(exec.id, 'a');

  // Complete B
  steps = wf.getStepsByExecution(exec.id);
  const stepB = steps.find(s => s.stepKey === 'b')!;
  wf.updateStepStatus(stepB.id, 'completed');
  wf.decrementDependents(exec.id, 'b');

  steps = wf.getStepsByExecution(exec.id);
  const stepD1 = steps.find(s => s.stepKey === 'd')!;
  console.log(`After B completes, D blocked: ${stepD1.blockedByCount}`);

  // Complete C
  const stepC = steps.find(s => s.stepKey === 'c')!;
  wf.updateStepStatus(stepC.id, 'completed');
  wf.decrementDependents(exec.id, 'c');

  steps = wf.getStepsByExecution(exec.id);
  const stepD2 = steps.find(s => s.stepKey === 'd')!;
  console.log(`After C completes, D blocked: ${stepD2.blockedByCount}, status: ${stepD2.status}`);

  const ready = wf.getReadySteps(exec.id);
  console.log('Final ready:', ready.map(s => s.stepKey));

  if (stepD2.blockedByCount !== 0 || stepD2.status !== 'ready') {
    throw new Error('FAIL: D should be ready now');
  }

  console.log('PASS: Full DAG cascade works\n');
  db.close();
}

async function testGuardEvaluation() {
  console.log('=== TEST: Guard evaluation ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  // Test the evaluateGuard method (if accessible)
  // For now just verify it doesn't crash

  const workflow = wf.createWorkflow('guard-test', {
    steps: [
      { key: 'gate', name: 'Gate', type: 'gate', config: {
        type: 'gate',
        condition: {
          type: 'expression' as const,
          condition: 'context.approved === true'
        },
        onTrue: ['proceed'],
        onFalse: ['reject']
      } },
      { key: 'proceed', name: 'Proceed', type: 'task', config: { type: 'task', title: 'Proceed' } },
      { key: 'reject', name: 'Reject', type: 'task', config: { type: 'task', title: 'Reject' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  console.log('Guard workflow started:', exec.status);

  console.log('PASS: Guard workflow creation works\n');
  db.close();
}

async function testTemplateSubstitution() {
  console.log('=== TEST: Template variable in workflow ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  wf.seedTemplates();
  const templates = wf.listWorkflows({ isTemplate: true });
  const featureBranch = templates.find(t => t.name === 'feature-branch')!;

  // Check definition has {{feature}} placeholder
  const stepConfig = featureBranch.definition.steps[0].config as { task?: string };
  if (!stepConfig.task?.includes('{{feature}}')) {
    console.log('Step config:', JSON.stringify(stepConfig));
    throw new Error('FAIL: Template should have {{feature}} placeholder');
  }

  // Start with inputs - verify required input validation
  try {
    await engine.startWorkflow(featureBranch.id, 'test'); // Missing required input
    throw new Error('FAIL: Should have thrown for missing required input');
  } catch (e) {
    if (!String(e).includes('Missing required input')) {
      throw e;
    }
    console.log('Required input validation works');
  }

  // Start with valid inputs
  const exec = await engine.startWorkflow(featureBranch.id, 'test', { feature: 'auth' });
  console.log('Started with inputs, context:', JSON.stringify(exec.context));

  console.log('PASS: Template variables work\n');
  db.close();
}

async function testWorkflowCompletion() {
  console.log('=== TEST: Workflow completion detection ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('simple', {
    steps: [
      { key: 'only', name: 'Only Step', type: 'task', config: { type: 'task', title: 'Test' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  let steps = wf.getStepsByExecution(exec.id);
  const step = steps[0];

  // Complete the only step
  await engine.completeStep(step.id, { result: 'done' });

  // Check execution status
  const finalExec = wf.getExecution(exec.id);
  console.log('Final execution status:', finalExec?.status);

  if (finalExec?.status !== 'completed') {
    throw new Error('FAIL: Execution should be completed');
  }

  console.log('PASS: Workflow completion detection works\n');
  db.close();
}

async function testGateStepRouting() {
  console.log('=== TEST: Gate step onPass/onFail routing ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('gate-routing', {
    steps: [
      { key: 'check', name: 'Check', type: 'task', config: { type: 'task', title: 'Check' } },
      { key: 'gate', name: 'Gate', type: 'gate', dependsOn: ['check'], config: {
        type: 'gate',
        condition: {
          type: 'expression' as const,
          condition: "steps.check.output.approved === true"
        },
        onTrue: ['proceed'],
        onFalse: ['reject']
      }},
      { key: 'proceed', name: 'Proceed', type: 'task', dependsOn: ['gate'], config: { type: 'task', title: 'Proceed' } },
      { key: 'reject', name: 'Reject', type: 'task', dependsOn: ['gate'], config: { type: 'task', title: 'Reject' } },
    ]
  });

  // Test 1: approved = true -> should enable 'proceed'
  const exec1 = await engine.startWorkflow(workflow.id, 'test');
  let steps = wf.getStepsByExecution(exec1.id);
  const check1 = steps.find(s => s.stepKey === 'check')!;

  // Complete check with approved = true
  await engine.completeStep(check1.id, { approved: true });

  // Process to trigger gate evaluation
  await engine.processExecutions();

  steps = wf.getStepsByExecution(exec1.id);
  const gate1 = steps.find(s => s.stepKey === 'gate')!;
  const proceed1 = steps.find(s => s.stepKey === 'proceed')!;
  const reject1 = steps.find(s => s.stepKey === 'reject')!;

  console.log('Test 1 (approved=true):');
  console.log('  gate:', gate1.status);
  console.log('  proceed:', proceed1.status, 'blocked:', proceed1.blockedByCount);
  console.log('  reject:', reject1.status);

  // When approved=true: proceed should be ready, reject should be skipped
  if (gate1.status !== 'completed') {
    throw new Error('FAIL: Gate should be completed');
  }
  if (reject1.status !== 'skipped') {
    throw new Error(`FAIL: Reject should be skipped when approved=true, got: ${reject1.status}`);
  }
  if (proceed1.status !== 'ready' && proceed1.blockedByCount !== 0) {
    throw new Error(`FAIL: Proceed should be ready when approved=true, got: ${proceed1.status} blocked=${proceed1.blockedByCount}`);
  }

  db.close();
  console.log('PASS: Gate routing works correctly\n');
}

async function testTriggerFiring() {
  console.log('=== TEST: Blackboard trigger ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const BlackboardStorage = (await import('./src/storage/blackboard.js')).BlackboardStorage;
  const bb = new BlackboardStorage(db);
  const engine = new WorkflowEngine({
    workflowStorage: wf,
    blackboardStorage: bb,
  });

  // Create a workflow with a blackboard trigger
  const workflow = wf.createWorkflow('triggered', {
    steps: [
      { key: 'react', name: 'React', type: 'task', config: { type: 'task', title: 'React to event' } },
    ]
  });

  const trigger = wf.createTrigger(workflow.id, 'blackboard', {
    type: 'blackboard',
    swarmId: 'test-swarm',
    messageType: 'directive',
  });

  console.log('Created trigger:', trigger.id);

  // Post a message to blackboard
  bb.postMessage('test-swarm', 'leader', 'directive', { action: 'deploy' });

  // Process triggers
  const fired = await engine.processTriggers();
  console.log('Triggers fired:', fired);

  // Check if execution was created
  const executions = wf.listExecutions({ workflowId: workflow.id });
  console.log('Executions created:', executions.length);

  if (executions.length !== 1) {
    throw new Error('FAIL: Expected 1 execution from trigger');
  }

  console.log('PASS: Blackboard trigger works\n');
  db.close();
}

async function testPauseResumeCancel() {
  console.log('=== TEST: Pause/Resume/Cancel workflow ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('pausable', {
    steps: [
      { key: 'a', name: 'A', type: 'task', config: { type: 'task', title: 'A' } },
      { key: 'b', name: 'B', type: 'task', dependsOn: ['a'], config: { type: 'task', title: 'B' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  console.log('Initial status:', exec.status);

  // Test pause
  const paused = await engine.pauseWorkflow(exec.id);
  const afterPause = wf.getExecution(exec.id);
  console.log('After pause:', afterPause?.status, 'success:', paused);

  if (afterPause?.status !== 'paused') {
    throw new Error('FAIL: Should be paused');
  }

  // Test resume
  const resumed = await engine.resumeWorkflow(exec.id);
  const afterResume = wf.getExecution(exec.id);
  console.log('After resume:', afterResume?.status, 'success:', resumed);

  if (afterResume?.status !== 'running') {
    throw new Error('FAIL: Should be running after resume');
  }

  // Test cancel
  const cancelled = await engine.cancelWorkflow(exec.id);
  const afterCancel = wf.getExecution(exec.id);
  console.log('After cancel:', afterCancel?.status, 'success:', cancelled);

  if (afterCancel?.status !== 'cancelled') {
    throw new Error('FAIL: Should be cancelled');
  }

  db.close();
  console.log('PASS: Pause/Resume/Cancel work\n');
}

async function testGateFalseCondition() {
  console.log('=== TEST: Gate with FALSE condition ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('gate-false', {
    steps: [
      { key: 'check', name: 'Check', type: 'task', config: { type: 'task', title: 'Check' } },
      { key: 'gate', name: 'Gate', type: 'gate', dependsOn: ['check'], config: {
        type: 'gate',
        condition: {
          type: 'expression' as const,
          condition: "steps.check.output.approved === true"
        },
        onTrue: ['proceed'],
        onFalse: ['reject']
      }},
      { key: 'proceed', name: 'Proceed', type: 'task', dependsOn: ['gate'], config: { type: 'task', title: 'Proceed' } },
      { key: 'reject', name: 'Reject', type: 'task', dependsOn: ['gate'], config: { type: 'task', title: 'Reject' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  let steps = wf.getStepsByExecution(exec.id);
  const check = steps.find(s => s.stepKey === 'check')!;

  // Complete check with approved = FALSE
  await engine.completeStep(check.id, { approved: false });
  await engine.processExecutions();

  steps = wf.getStepsByExecution(exec.id);
  const proceed = steps.find(s => s.stepKey === 'proceed')!;
  const reject = steps.find(s => s.stepKey === 'reject')!;

  console.log('When approved=false:');
  console.log('  proceed:', proceed.status);
  console.log('  reject:', reject.status, 'blocked:', reject.blockedByCount);

  // When approved=false: proceed should be skipped, reject should be ready
  if (proceed.status !== 'skipped') {
    throw new Error(`FAIL: Proceed should be skipped when approved=false, got: ${proceed.status}`);
  }
  if (reject.status !== 'ready' && reject.blockedByCount !== 0) {
    throw new Error(`FAIL: Reject should be ready when approved=false, got: ${reject.status}`);
  }

  db.close();
  console.log('PASS: Gate FALSE condition works\n');
}

async function testScriptStep() {
  console.log('=== TEST: Script step execution ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('script-test', {
    steps: [
      { key: 'compute', name: 'Compute', type: 'script', config: {
        type: 'script',
        script: '5 > 3',
        outputKey: 'comparison'
      }},
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  await engine.processExecutions();

  const steps = wf.getStepsByExecution(exec.id);
  const compute = steps.find(s => s.stepKey === 'compute')!;

  console.log('Script step status:', compute.status);
  console.log('Script step output:', JSON.stringify(compute.output));

  if (compute.status !== 'completed') {
    throw new Error('FAIL: Script step should be completed');
  }
  if (compute.output?.comparison !== true) {
    throw new Error(`FAIL: Script output should be true, got: ${compute.output?.comparison}`);
  }

  db.close();
  console.log('PASS: Script step works\n');
}

async function testContextPropagation() {
  console.log('=== TEST: Context propagation between steps ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('context-test', {
    steps: [
      { key: 'producer', name: 'Producer', type: 'task', config: { type: 'task', title: 'Produce' } },
      { key: 'gate', name: 'Gate', type: 'gate', dependsOn: ['producer'], config: {
        type: 'gate',
        condition: {
          type: 'expression' as const,
          condition: "steps.producer.output.value > 10"
        },
        onTrue: ['high'],
        onFalse: ['low']
      }},
      { key: 'high', name: 'High', type: 'task', dependsOn: ['gate'], config: { type: 'task', title: 'High' } },
      { key: 'low', name: 'Low', type: 'task', dependsOn: ['gate'], config: { type: 'task', title: 'Low' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  let steps = wf.getStepsByExecution(exec.id);
  const producer = steps.find(s => s.stepKey === 'producer')!;

  // Complete with value = 25 (> 10)
  await engine.completeStep(producer.id, { value: 25 });
  await engine.processExecutions();

  steps = wf.getStepsByExecution(exec.id);
  const high = steps.find(s => s.stepKey === 'high')!;
  const low = steps.find(s => s.stepKey === 'low')!;

  console.log('With value=25 (>10):');
  console.log('  high:', high.status);
  console.log('  low:', low.status);

  if (high.status !== 'ready' && high.blockedByCount !== 0) {
    throw new Error(`FAIL: High should be ready when value>10`);
  }
  if (low.status !== 'skipped') {
    throw new Error(`FAIL: Low should be skipped when value>10`);
  }

  db.close();
  console.log('PASS: Context propagation works\n');
}

async function testStepRetry() {
  console.log('=== TEST: Step retry ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  const workflow = wf.createWorkflow('retry-test', {
    steps: [
      { key: 'flaky', name: 'Flaky', type: 'task', maxRetries: 3, config: { type: 'task', title: 'Flaky' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  let steps = wf.getStepsByExecution(exec.id);
  const step = steps.find(s => s.stepKey === 'flaky')!;

  // Fail the step
  await engine.completeStep(step.id, undefined, 'Simulated error');

  steps = wf.getStepsByExecution(exec.id);
  const failedStep = steps.find(s => s.stepKey === 'flaky')!;
  console.log('After failure - status:', failedStep.status, 'retries:', failedStep.retryCount);

  // Retry the step
  const retried = await engine.retryStep(failedStep.id);
  console.log('Retry result:', retried);

  steps = wf.getStepsByExecution(exec.id);
  const retriedStep = steps.find(s => s.stepKey === 'flaky')!;
  console.log('After retry - retryCount:', retriedStep.retryCount);

  if (retriedStep.retryCount !== 1) {
    throw new Error(`FAIL: Retry count should be 1, got: ${retriedStep.retryCount}`);
  }

  db.close();
  console.log('PASS: Step retry works\n');
}

async function testCircularDependency() {
  console.log('=== TEST: Circular dependency handling ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  // Create a workflow with circular dependency: a -> b -> c -> a
  const workflow = wf.createWorkflow('circular', {
    steps: [
      { key: 'a', name: 'A', type: 'task', dependsOn: ['c'], config: { type: 'task', title: 'A' } },
      { key: 'b', name: 'B', type: 'task', dependsOn: ['a'], config: { type: 'task', title: 'B' } },
      { key: 'c', name: 'C', type: 'task', dependsOn: ['b'], config: { type: 'task', title: 'C' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  const steps = wf.getStepsByExecution(exec.id);

  console.log('Circular dependency steps:');
  steps.forEach(s => console.log(`  ${s.stepKey}: blocked=${s.blockedByCount}, status=${s.status}`));

  // All steps should be blocked (no ready steps)
  const ready = wf.getReadySteps(exec.id);
  console.log('Ready steps:', ready.length);

  // This is a deadlock - no steps can ever be ready
  if (ready.length > 0) {
    throw new Error('FAIL: Circular dependency should result in no ready steps');
  }

  // All steps should be blocked
  const allBlocked = steps.every(s => s.blockedByCount > 0);
  if (!allBlocked) {
    throw new Error('FAIL: All steps should be blocked in circular dependency');
  }

  db.close();
  console.log('PASS: Circular dependency handled (deadlock detected)\n');
}

async function testParallelStep() {
  console.log('=== TEST: Parallel step execution ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  // Create workflow with parallel pattern
  const workflow = wf.createWorkflow('parallel-test', {
    steps: [
      { key: 'setup', name: 'Setup', type: 'task', config: { type: 'task', title: 'Setup' } },
      { key: 'parallel', name: 'Parallel', type: 'parallel', dependsOn: ['setup'], config: {
        type: 'parallel',
        stepKeys: ['task-a', 'task-b'],
        strategy: 'all' as const
      }},
      { key: 'task-a', name: 'Task A', type: 'task', config: { type: 'task', title: 'A' } },
      { key: 'task-b', name: 'Task B', type: 'task', config: { type: 'task', title: 'B' } },
      { key: 'finish', name: 'Finish', type: 'task', dependsOn: ['parallel'], config: { type: 'task', title: 'Finish' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  let steps = wf.getStepsByExecution(exec.id);

  console.log('Initial state:');
  steps.forEach(s => console.log(`  ${s.stepKey}: blocked=${s.blockedByCount}, status=${s.status}`));

  // Check: Are task-a and task-b immediately ready (no deps) or blocked?
  const taskA = steps.find(s => s.stepKey === 'task-a')!;
  const taskB = steps.find(s => s.stepKey === 'task-b')!;
  const setup = steps.find(s => s.stepKey === 'setup')!;

  console.log('\nBUG CHECK: task-a and task-b have no dependsOn, so they are ready immediately');
  console.log(`  setup: blocked=${setup.blockedByCount}`);
  console.log(`  task-a: blocked=${taskA.blockedByCount}`);
  console.log(`  task-b: blocked=${taskB.blockedByCount}`);

  // This reveals a design issue: parallel sub-steps don't auto-depend on the parallel step
  // They run immediately instead of waiting for the parallel step to be ready
  if (taskA.blockedByCount === 0 && taskB.blockedByCount === 0) {
    console.log('WARNING: Parallel sub-steps run immediately without waiting for setup!');
    console.log('  This is a design issue - parallel stepKeys should auto-wire dependencies');
  }

  db.close();
  console.log('INFO: Parallel step behavior documented\n');
}

async function testEmptySteps() {
  console.log('=== TEST: Empty steps validation ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);

  // Try to create workflow with empty steps (should fail validation at API level)
  try {
    wf.createWorkflow('empty', { steps: [] });
    console.log('WARNING: Empty steps allowed by storage (validation only at API level)');
  } catch (e) {
    console.log('Storage rejected empty steps:', String(e).slice(0, 50));
  }

  db.close();
  console.log('INFO: Empty steps handling documented\n');
}

async function testDuplicateStepKeys() {
  console.log('=== TEST: Duplicate step keys ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  // Create workflow with duplicate keys
  const workflow = wf.createWorkflow('duplicate-keys', {
    steps: [
      { key: 'a', name: 'A1', type: 'task', config: { type: 'task', title: 'A1' } },
      { key: 'a', name: 'A2', type: 'task', config: { type: 'task', title: 'A2' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  const steps = wf.getStepsByExecution(exec.id);

  console.log('Duplicate keys result:');
  steps.forEach(s => console.log(`  ${s.stepKey}: ${s.name}`));
  console.log(`Total steps: ${steps.length}`);

  // This might create 2 steps with same key, which could cause issues
  if (steps.length === 2) {
    console.log('WARNING: Duplicate keys allowed - could cause dependency issues!');
  }

  db.close();
  console.log('INFO: Duplicate key handling documented\n');
}

async function testNonExistentDependency() {
  console.log('=== TEST: Non-existent dependency ===');

  const db = new SQLiteStorage(':memory:');
  const wf = new WorkflowStorage(db);
  const engine = new WorkflowEngine({ workflowStorage: wf });

  // Create a workflow with dependency on non-existent step
  const workflow = wf.createWorkflow('bad-dep', {
    steps: [
      { key: 'a', name: 'A', type: 'task', dependsOn: ['nonexistent'], config: { type: 'task', title: 'A' } },
    ]
  });

  const exec = await engine.startWorkflow(workflow.id, 'test');
  const steps = wf.getStepsByExecution(exec.id);

  console.log('Non-existent dependency:');
  steps.forEach(s => console.log(`  ${s.stepKey}: blocked=${s.blockedByCount}, status=${s.status}`));

  // Step 'a' depends on 'nonexistent' which doesn't exist
  // It should still be blocked waiting for that step
  const stepA = steps.find(s => s.stepKey === 'a')!;
  console.log('Step A blocked by count:', stepA.blockedByCount);

  db.close();
  console.log('INFO: Non-existent dependency behavior documented\n');
}

async function main() {
  try {
    await testKahnAlgorithm();
    await testGuardEvaluation();
    await testTemplateSubstitution();
    await testWorkflowCompletion();
    await testGateStepRouting();
    await testTriggerFiring();
    await testPauseResumeCancel();
    await testGateFalseCondition();
    await testScriptStep();
    await testContextPropagation();
    await testStepRetry();
    await testCircularDependency();
    await testParallelStep();
    await testEmptySteps();
    await testDuplicateStepKeys();
    await testNonExistentDependency();
    console.log('=== ALL TESTS PASSED ===');
  } catch (e) {
    console.error('TEST FAILED:', e);
    process.exit(1);
  }
}

main();
