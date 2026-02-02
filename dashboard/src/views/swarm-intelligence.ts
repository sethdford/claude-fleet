/**
 * Swarm Intelligence View
 * Main view orchestration — data fetching, event delegation, and layout.
 * Panel renderers live in swarm-intel-panels.ts.
 */

import {
  getPheromones,
  getBeliefStats,
  getLeaderboard,
  getProposals,
  getPheromoneStats,
  getCreditStats,
  getHotResources,
  voteOnProposal,
  closeProposal,
  acceptBid,
  runAuction,
} from '@/api-intelligence';
import toast from '@/components/toast';
import type {
  PheromoneTrail,
  HotResource,
  CreditAccount,
  Proposal,
  PheromoneStats,
  BeliefStats,
  CreditStats,
  ConsensusStats,
  BiddingStats,
} from '@/types';

import {
  renderPheromoneTrails,
  renderHotResources,
  renderBeliefs,
  renderConsensusView,
  renderLeaderboard,
  renderProposals,
  renderBids,
  renderSwarmIntelStats,
} from './swarm-intel-panels';

// ============================================================================
// Main Swarm Intelligence View
// ============================================================================

/**
 * Main swarm intelligence view renderer
 */
export async function renderSwarmIntelligence(container: HTMLElement, swarmId: string): Promise<() => void> {
  // Show loading state
  container.innerHTML = `
    <div class="loading p-xl text-center">
      <div class="spinner"></div>
      <div class="text-fg-muted mt-md">Loading swarm intelligence data...</div>
    </div>
  `;

  // Fetch all data in parallel
  let pheromones: PheromoneTrail[] = [];
  let leaderboard: CreditAccount[] = [];
  let proposals: Proposal[] = [];
  let pheromoneStats: PheromoneStats = {};
  let beliefStats: BeliefStats = {};
  let creditStats: CreditStats = {};
  const consensusStats: ConsensusStats = {};
  const biddingStats: BiddingStats = {};
  let hotResources: HotResource[] = [];

  try {
    const results = await Promise.allSettled([
      getPheromones(swarmId, { limit: 100 }),
      getBeliefStats(swarmId),
      getLeaderboard(swarmId, 20),
      getProposals(swarmId, { limit: 20 }),
      getPheromoneStats(swarmId),
      getCreditStats(swarmId),
      getHotResources(swarmId, 10),
    ]);

    if (results[0].status === 'fulfilled') {
      const val = results[0].value as PheromoneTrail[] | { trails?: PheromoneTrail[] };
      pheromones = Array.isArray(val) ? val : (val as { trails?: PheromoneTrail[] }).trails || [];
    }
    if (results[1].status === 'fulfilled') beliefStats = results[1].value as BeliefStats;
    if (results[2].status === 'fulfilled') {
      const val = results[2].value as CreditAccount[] | { leaderboard?: CreditAccount[] };
      leaderboard = Array.isArray(val) ? val : (val as { leaderboard?: CreditAccount[] }).leaderboard || [];
    }
    if (results[3].status === 'fulfilled') {
      const val = results[3].value as Proposal[] | { proposals?: Proposal[] };
      proposals = Array.isArray(val) ? val : (val as { proposals?: Proposal[] }).proposals || [];
    }
    if (results[4].status === 'fulfilled') pheromoneStats = results[4].value as PheromoneStats;
    if (results[5].status === 'fulfilled') creditStats = results[5].value as CreditStats;
    if (results[6].status === 'fulfilled') {
      const val = results[6].value as HotResource[] | { resources?: HotResource[] };
      hotResources = Array.isArray(val) ? val : (val as { resources?: HotResource[] }).resources || [];
    }
  } catch (e) {
    console.error('Failed to fetch swarm intelligence data:', e);
  }

  // Render the view
  container.innerHTML = `
    <div class="swarm-intelligence-view">
      <!-- Stats Overview -->
      ${renderSwarmIntelStats(pheromoneStats, beliefStats, creditStats, consensusStats, biddingStats)}

      <!-- Main Grid -->
      <div class="grid grid-cols-2 gap-lg">
        <!-- Left Column -->
        <div>
          <!-- Pheromone Trails -->
          ${renderPheromoneTrails(pheromones)}

          <!-- Hot Resources -->
          <div class="card mt-md">
            <div class="card-header">
              <h3 class="card-title">Hot Resources</h3>
            </div>
            <div id="hot-resources-chart" class="p-md"></div>
          </div>

          <!-- Proposals -->
          <div class="mt-md">
            ${renderProposals(proposals)}
          </div>
        </div>

        <!-- Right Column -->
        <div>
          <!-- Leaderboard -->
          ${renderLeaderboard(leaderboard)}

          <!-- Beliefs (fetch for current user) -->
          <div class="mt-md" id="beliefs-container">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">Agent Beliefs</h3>
              </div>
              <div class="empty-state">
                <div class="empty-state-text">Select an agent to view beliefs</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Render hot resources chart
  renderHotResources(document.getElementById('hot-resources-chart'), hotResources);

  // Setup event delegation ONCE — survives innerHTML replacements from vote/close refreshes
  setupSwarmIntelEventDelegation(container, swarmId);

  return () => {
    // Event delegation is on the container which gets cleaned up by the view router.
  };
}

/**
 * Refresh proposals section after vote/close — replaces only the proposals HTML.
 */
async function refreshProposals(container: HTMLElement, swarmId: string): Promise<void> {
  try {
    const updatedProposals = await getProposals(swarmId, { limit: 20 }) as Proposal[] | { proposals?: Proposal[] };
    const proposalsList = Array.isArray(updatedProposals) ? updatedProposals : (updatedProposals as { proposals?: Proposal[] }).proposals || [];
    const proposalsContainer = container.querySelector('.proposals-list')?.parentElement;
    if (proposalsContainer) {
      proposalsContainer.outerHTML = renderProposals(proposalsList);
    }
  } catch (e) {
    toast.error('Failed to refresh proposals: ' + (e as Error).message);
  }
}

/**
 * Event delegation for swarm intelligence interactions.
 * Attached ONCE to the container — survives innerHTML replacements from vote/close refreshes.
 */
function setupSwarmIntelEventDelegation(container: HTMLElement, swarmId: string): void {
  container.addEventListener('click', async (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Vote buttons
    const voteBtn = target.closest('.vote-btn') as HTMLElement | null;
    if (voteBtn) {
      const option = voteBtn.dataset.option;
      const proposalItem = voteBtn.closest('.proposal-item') as HTMLElement | null;
      const proposalId = proposalItem?.dataset.proposalId;
      if (proposalId && option) {
        try {
          await voteOnProposal(proposalId, option);
          await refreshProposals(container, swarmId);
        } catch (e) {
          toast.error('Failed to vote: ' + (e as Error).message);
        }
      }
      return;
    }

    // Close proposal buttons
    const closeBtn = target.closest('.close-proposal-btn') as HTMLElement | null;
    if (closeBtn) {
      const proposalItem = closeBtn.closest('.proposal-item') as HTMLElement | null;
      const proposalId = proposalItem?.dataset.proposalId;
      if (proposalId) {
        try {
          await closeProposal(proposalId);
          await refreshProposals(container, swarmId);
        } catch (e) {
          toast.error('Failed to close proposal: ' + (e as Error).message);
        }
      }
      return;
    }

    // Accept bid buttons
    const acceptBtn = target.closest('.accept-bid-btn') as HTMLElement | null;
    if (acceptBtn) {
      const bidItem = acceptBtn.closest('.bid-item') as HTMLElement | null;
      const bidId = bidItem?.dataset.bidId;
      if (bidId) {
        try {
          await acceptBid(bidId);
          (acceptBtn as HTMLButtonElement).textContent = 'Accepted';
          (acceptBtn as HTMLButtonElement).disabled = true;
          acceptBtn.classList.remove('btn-primary');
          acceptBtn.classList.add('btn-secondary');
        } catch (e) {
          toast.error('Failed to accept bid: ' + (e as Error).message);
        }
      }
      return;
    }

    // Run auction buttons
    const auctionBtn = target.closest('.run-auction-btn') as HTMLElement | null;
    if (auctionBtn) {
      const taskId = auctionBtn.dataset.taskId;
      if (taskId) {
        try {
          const result = await runAuction(taskId) as { winner?: { bidderHandle?: string } };
          toast.success(`Auction complete! Winner: ${result.winner?.bidderHandle || 'No winner'}`);
        } catch (e) {
          toast.error('Failed to run auction: ' + (e as Error).message);
        }
      }
    }
  });
}

export default {
  renderPheromoneTrails,
  renderHotResources,
  renderBeliefs,
  renderConsensusView,
  renderLeaderboard,
  renderProposals,
  renderBids,
  renderSwarmIntelStats,
  renderSwarmIntelligence,
};
