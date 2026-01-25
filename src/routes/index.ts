/**
 * Route Module Exports
 *
 * Central export point for all route handler factories.
 */

// Types
export type { RouteDependencies, RouteHandler, BroadcastToChat, BroadcastToAll } from './types.js';

// Core routes (health, metrics, auth, debug)
export {
  generateUid,
  generateChatId,
  generateTeamChatId,
  createHealthHandler,
  createMetricsJsonHandler,
  createAuthHandler,
  createDebugHandler,
} from './core.js';

// Chat routes (users, teams, chats, messages)
export {
  createGetUserHandler,
  createGetUserChatsHandler,
  createGetTeamAgentsHandler,
  createBroadcastHandler,
  createGetTeamTasksHandler,
  createCreateChatHandler,
  createGetMessagesHandler,
  createSendMessageHandler,
  createMarkReadHandler,
} from './chats.js';

// Task routes
export {
  createCreateTaskHandler,
  createGetTaskHandler,
  createUpdateTaskHandler,
} from './tasks.js';

// Orchestration routes (workers, worktrees)
export {
  createSpawnWorkerHandler,
  createDismissWorkerHandler,
  createSendToWorkerHandler,
  createGetWorkersHandler,
  createGetWorkerOutputHandler,
  createWorktreeCommitHandler,
  createWorktreePushHandler,
  createWorktreePRHandler,
  createWorktreeStatusHandler,
} from './orchestrate.js';

// Wave & Multi-repo orchestration routes
export {
  createExecuteWavesHandler,
  createGetWaveStatusHandler,
  createCancelWaveHandler,
  createListWaveExecutionsHandler,
  createExecuteMultiRepoHandler,
  createGetMultiRepoStatusHandler,
  createListMultiRepoExecutionsHandler,
  createUpdateDepsHandler,
  createSecurityAuditHandler,
  createFormatCodeHandler,
  createRunTestsHandler,
} from './wave-orchestrate.js';

// Work item routes (work items, batches)
export {
  createCreateWorkItemHandler,
  createListWorkItemsHandler,
  createGetWorkItemHandler,
  createUpdateWorkItemHandler,
  createCreateBatchHandler,
  createListBatchesHandler,
  createGetBatchHandler,
  createDispatchBatchHandler,
} from './workitems.js';

// Mail routes (mail, handoffs)
export {
  createSendMailHandler,
  createGetMailHandler,
  createGetUnreadMailHandler,
  createMarkMailReadHandler,
  createCreateHandoffHandler,
  createGetHandoffsHandler,
} from './mail.js';

// Fleet coordination routes (blackboard, spawn-queue, checkpoints, swarms)
export {
  createBlackboardPostHandler,
  createBlackboardReadHandler,
  createBlackboardMarkReadHandler,
  createBlackboardArchiveHandler,
  createBlackboardArchiveOldHandler,
  createSpawnEnqueueHandler,
  createSpawnStatusHandler,
  createSpawnGetHandler,
  createSpawnCancelHandler,
  createCheckpointCreateHandler,
  createCheckpointLoadHandler,
  createCheckpointLatestHandler,
  createCheckpointListHandler,
  createCheckpointAcceptHandler,
  createCheckpointRejectHandler,
  createSwarmCreateHandler,
  createSwarmListHandler,
  createSwarmGetHandler,
  createSwarmKillHandler,
} from './fleet.js';

// TLDR routes (token-efficient code analysis)
export {
  createGetFileSummaryHandler,
  createCheckSummaryHandler,
  createStoreFileSummaryHandler,
  createGetMultipleSummariesHandler,
  createGetCodebaseOverviewHandler,
  createStoreCodebaseOverviewHandler,
  createStoreDependencyHandler,
  createGetDependencyGraphHandler,
  createGetDependentsHandler,
  createGetDependenciesHandler,
  createInvalidateFileHandler,
  createGetTLDRStatsHandler,
  createClearTLDRCacheHandler,
} from './tldr.js';

// Workflow routes (DAG-based workflow execution)
export {
  createCreateWorkflowHandler,
  createListWorkflowsHandler,
  createGetWorkflowHandler,
  createUpdateWorkflowHandler,
  createDeleteWorkflowHandler,
  createStartWorkflowHandler,
  createListExecutionsHandler,
  createGetExecutionHandler,
  createPauseExecutionHandler,
  createResumeExecutionHandler,
  createCancelExecutionHandler,
  createGetExecutionStepsHandler,
  createRetryStepHandler,
  createCompleteStepHandler,
  createCreateTriggerHandler,
  createListTriggersHandler,
  createDeleteTriggerHandler,
  createGetExecutionEventsHandler,
} from './workflows.js';

// Audit routes (codebase health checks and audit loop)
export {
  createAuditStatusHandler,
  createAuditOutputHandler,
  createAuditStartHandler,
  createAuditStopHandler,
  createQuickAuditHandler,
} from './audit.js';

// Template routes (swarm templates management)
export {
  createCreateTemplateHandler,
  createListTemplatesHandler,
  createGetTemplateHandler,
  createUpdateTemplateHandler,
  createDeleteTemplateHandler,
  createRunTemplateHandler,
} from './templates.js';

// Swarm intelligence routes (stigmergic coordination, beliefs, credits, consensus, bidding)
export {
  // Pheromone trails
  createDepositPheromoneHandler,
  createQueryPheromonesHandler,
  createGetResourceTrailsHandler,
  createGetResourceActivityHandler,
  createDecayPheromonesHandler,
  createPheromoneStatsHandler,
  // Agent beliefs
  createUpsertBeliefHandler,
  createGetBeliefsHandler,
  createUpsertMetaBeliefHandler,
  createGetSwarmConsensusHandler,
  createBeliefStatsHandler,
  // Credits & reputation
  createGetCreditsHandler,
  createGetLeaderboardHandler,
  createTransferCreditsHandler,
  createRecordTransactionHandler,
  createGetCreditHistoryHandler,
  createCreditStatsHandler,
  // Consensus voting
  createCreateProposalHandler,
  createListProposalsHandler,
  createGetProposalHandler,
  createCastVoteHandler,
  createCloseProposalHandler,
  createConsensusStatsHandler,
  // Task bidding
  createSubmitBidHandler,
  createGetTaskBidsHandler,
  createGetBidHandler,
  createAcceptBidHandler,
  createWithdrawBidHandler,
  createEvaluateBidsHandler,
  createBiddingStatsHandler,
  // Payoffs
  createDefinePayoffHandler,
  createCalculatePayoffHandler,
  createGetPayoffsHandler,
  // Additional handlers
  createUpdateReputationHandler,
  createRunAuctionHandler,
} from './swarm-intelligence.js';
