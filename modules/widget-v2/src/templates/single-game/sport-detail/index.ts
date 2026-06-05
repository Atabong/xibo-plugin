/**
 * SPEC-CRWDQ-084 — sport-detail registry wiring.
 *
 * Registers the SOCCER (football) + BASEBALL detail panels. Importing this
 * module (the SingleGameTemplate does) registers them as a side effect, so the
 * template's `sportDetailPanel(sport)` lookup resolves a panel for those sports
 * and `null` (→ no detail panel, shell-only) for everything else.
 *
 * FUTURE SPORTS (basketball / hockey / american_football) are intentionally
 * left as registry STUBS — NOT half-built. To add one, write a
 * `SportDetailPanel` (see FootballDetail.ts / BaseballDetail.ts for the shape:
 * mount-once + in-place update reading off `state.timeline` +
 * `state.sport_context.detail`), add its CSS to broadcast.css under a
 * `.cdq-detail-<sport>` block, then `registerSportDetail('<sport>', Panel)`
 * here. The backend already stamps `sport_context.detail` per sport (see
 * docs/ADDING_A_SPORT.md). Until then those sports render the shell only.
 */
import { registerSportDetail } from './registry';
import { FootballDetailPanel } from './FootballDetail';
import { BaseballDetailPanel } from './BaseballDetail';

registerSportDetail('football', FootballDetailPanel);
registerSportDetail('baseball', BaseballDetailPanel);

// --- future-sport stubs (documented, not registered) ----------------------
// registerSportDetail('basketball', BasketballDetailPanel);       // TODO S-future
// registerSportDetail('hockey', HockeyDetailPanel);               // TODO S-future
// registerSportDetail('american_football', NflDetailPanel);       // TODO S-future

export {
  registerSportDetail,
  sportDetailPanel,
  registeredSports,
} from './registry';
export type { SportDetailPanel, SportDetailInstance } from './registry';
export { FootballDetailPanel, FOOTBALL_TESTID } from './FootballDetail';
export { BaseballDetailPanel, BASEBALL_TESTID } from './BaseballDetail';
