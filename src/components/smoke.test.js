/*
 * Mount every extracted component once.
 *
 * App.js was a single 4,600-line file with no render coverage. After splitting
 * it into ~30 modules, a typo in an import or a stale prop name would only show
 * up when a user opened that tab. This catches it at test time instead.
 *
 * These are smoke tests, not behaviour tests: they assert "renders without
 * throwing" and nothing more.
 */
import { render, act } from "@testing-library/react";

import Avatar from "./Avatar";
import LoginScreen from "./LoginScreen";
import ChangePasswordScreen from "./ChangePasswordScreen";
import ProfileModal from "./ProfileModal";
import Leaderboard from "./Leaderboard";
import LeaderboardCharts from "./LeaderboardCharts";
import GameHistory from "./GameHistory";
import NewGameModal from "./NewGameModal";
import ScheduleGameModal from "./ScheduleGameModal";
import GameDetail from "./GameDetail";
import PlayersTab from "./PlayersTab";
import StatsTab from "./StatsTab";
import AdminPanel from "./AdminPanel";
import SkeletonTab from "./Skeleton";
import RulesTab from "./rules/RulesTab";
import RuleDetail from "./rules/RuleDetail";
import RuleEditModal from "./rules/RuleEditModal";
import DuplicateRuleModal from "./rules/DuplicateRuleModal";
import PlayingCard from "./askclaude/PlayingCard";
import CardPicker from "./askclaude/CardPicker";
import AskClaudeTab from "./askclaude/AskClaudeTab";
import AchievementImage from "./achievements/AchievementImage";
import ImageFramer from "./achievements/ImageFramer";
import JokerCard from "./achievements/JokerCard";
import CriteriaEditor from "./achievements/CriteriaEditor";
import EditAchievementModal from "./achievements/EditAchievementModal";
import RecommendAchievementModal from "./achievements/RecommendAchievementModal";
import ApproveRecModal from "./achievements/ApproveRecModal";
import AchievementToast from "./achievements/AchievementToast";
import AchievementsTab from "./achievements/AchievementsTab";

// Shapes the components actually destructure, keyed by endpoint.
const ROUTES = {
  "/api/profile": { username: "ada", role: "user", xp: 0 },
  "/api/profile/stats": { summary: { gamesPlayed: 0 }, history: [] },
  "/api/leaderboard/badges": { winner: null, loser: null },
  "/api/owners": { owners: [] },
  "/api/users": { users: [] },
  "/api/players": { items: [] },
  "/api/games": { items: [] },
  "/api/scheduled-games": { games: [] },
};

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    const path = String(url).split("?")[0];
    const body = path in ROUTES ? ROUTES[path] : [];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  });
  // ResponsiveContainer measures its parent, which jsdom reports as 0x0.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

const noop = () => {};

const GAME = {
  id: "g1",
  date: "2026-01-15",
  isComplete: false,
  notes: "",
  players: { items: [] },
};

const ACHIEVEMENT = {
  id: "a1",
  name: "Last Man Standing",
  description: "Win a game after being down to your last chips.",
  xpValue: 50,
  imageSvg: null,
  imageFrame: null,
  criteriaJson: null,
};

const REC = {
  id: "r1",
  name: "Comeback",
  description: "Recover from a big loss.",
  username: "ada",
  referenceImagePath: null,
};

const RULE = {
  id: "ru1",
  gameName: "Hold'Em",
  overview: "Community card game.",
  minPlayers: 2,
  cardsDealt: 2,
  bettingType: "NLH",
  howToPlay: "[]",
  winningHierarchy: "[]",
  keyConsiderations: "[]",
  howItEnds: "",
  versions: [],
  comments: [],
  createdAt: "2026-01-01T00:00:00Z",
};

// [name, element]
const CASES = [
  ["Avatar", <Avatar name="Ada" />],
  ["Avatar (with image)", <Avatar name="Ada" src="/x.png" size={48} />],
  ["SkeletonTab", <SkeletonTab />],
  ["LoginScreen", <LoginScreen onLogin={noop} onRequirePasswordChange={noop} />],
  ["ChangePasswordScreen", <ChangePasswordScreen username="ada" currentPassword="x" onSuccess={noop} />],
  ["ProfileModal", <ProfileModal onClose={noop} onAvatarChange={noop} onSignOut={noop} />],
  ["Leaderboard (empty)", <Leaderboard players={[]} />],
  ["LeaderboardCharts", <LeaderboardCharts activeChart="bar" barData={[]} lineData={[]} visibleStats={[]} />],
  ["GameHistory", <GameHistory games={[]} scheduledGames={[]} onSelectGame={noop} onNewGame={noop} onScheduleGame={noop} isOwner isAdmin onRefresh={noop} />],
  ["NewGameModal", <NewGameModal players={[]} onClose={noop} onCreate={noop} />],
  ["ScheduleGameModal", <ScheduleGameModal onClose={noop} onScheduled={noop} />],
  ["GameDetail", <GameDetail game={GAME} onBack={noop} onRefresh={noop} isOwner isAdmin allPlayers={[]} />],
  ["PlayersTab", <PlayersTab players={[]} onRefresh={noop} isOwner isAdmin />],
  ["StatsTab", <StatsTab />],
  ["AdminPanel", <AdminPanel />],
  ["RulesTab", <RulesTab isOwner isAdmin />],
  ["RuleDetail", <RuleDetail rule={RULE} isOwner isAdmin onBack={noop} onEdit={noop} onRefresh={noop} />],
  ["RuleEditModal", <RuleEditModal rule={null} onClose={noop} onSaved={noop} />],
  ["DuplicateRuleModal", <DuplicateRuleModal rule={RULE} existingNames={[]} onClose={noop} onDuplicated={noop} />],
  ["PlayingCard", <PlayingCard rank="A" suit="♠" />],
  ["CardPicker", <CardPicker card={{ rank: "", suit: "" }} label="Card 1" onChange={noop} duplicate={false} />],
  ["AskClaudeTab", <AskClaudeTab />],
  ["AchievementImage", <AchievementImage src="<svg />" imageFrame={null} />],
  ["ImageFramer", <ImageFramer src="/x.png" frame={{ x: 0, y: 0, scale: 1 }} onChange={noop} />],
  ["JokerCard (locked)", <JokerCard achievement={ACHIEVEMENT} earned={false} isAdmin onEdit={noop} onPreviewToast={noop} />],
  ["JokerCard (earned x5)", <JokerCard achievement={ACHIEVEMENT} earned earnedAt="2026-01-01T00:00:00Z" timesEarned={5} isAdmin={false} onEdit={noop} onPreviewToast={noop} />],
  ["CriteriaEditor", <CriteriaEditor value={{ scope: "game", conditions: [] }} onChange={noop} />],
  ["EditAchievementModal", <EditAchievementModal achievement={ACHIEVEMENT} onClose={noop} onSaved={noop} />],
  ["RecommendAchievementModal", <RecommendAchievementModal onClose={noop} onSubmitted={noop} />],
  ["ApproveRecModal", <ApproveRecModal rec={REC} onClose={noop} onApproved={noop} />],
  ["AchievementToast", <AchievementToast achievements={[{ achievementId: "a1", ...ACHIEVEMENT, count: 1 }]} onDismiss={noop} onViewAll={noop} />],
  ["AchievementsTab", <AchievementsTab isAdmin onPreviewToast={noop} />],
];

describe("component smoke tests", () => {
  test.each(CASES)("%s mounts without throwing", async (_name, element) => {
    let result;
    await act(async () => {
      result = render(element);
    });
    expect(result.container).toBeTruthy();
    result.unmount();
  });
});
