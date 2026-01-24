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
