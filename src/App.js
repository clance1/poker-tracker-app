import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  apiFetch, getStoredUsername, getRole, getStoredAvatar,
  clearUsername, clearRole, storeAvatar, roleIsAdmin, roleIsOwner,
} from "./lib/api";
import { TABS } from "./lib/constants";
import Avatar from "./components/Avatar";
import LoginScreen from "./components/LoginScreen";
import ChangePasswordScreen from "./components/ChangePasswordScreen";
import ProfileModal from "./components/ProfileModal";
import Leaderboard from "./components/Leaderboard";
import GameHistory from "./components/GameHistory";
import NewGameModal from "./components/NewGameModal";
import ScheduleGameModal from "./components/ScheduleGameModal";
import GameDetail from "./components/GameDetail";
import PlayersTab from "./components/PlayersTab";
import SkeletonTab from "./components/Skeleton";
import AchievementToast from "./components/achievements/AchievementToast";
import "./App.css";

// Tabs most users never open, plus the two heaviest trees (Gemini/Claude
// tooling and the image framer). Kept out of the initial bundle.
const RulesTab = lazy(() => import("./components/rules/RulesTab"));
const AchievementsTab = lazy(() => import("./components/achievements/AchievementsTab"));
const StatsTab = lazy(() => import("./components/StatsTab"));
const AskClaudeTab = lazy(() => import("./components/askclaude/AskClaudeTab"));
const AdminPanel = lazy(() => import("./components/AdminPanel"));

function App() {
  // isLoggedIn is seeded from stored username (non-sensitive display state).
  // If the httpOnly cookie has actually expired the first apiFetch will 401 and reload.
  const [isLoggedIn, setIsLoggedIn] = useState(!!getStoredUsername());
  const [pendingPasswordChange, setPendingPasswordChange] = useState(null); // { username, currentPassword }
  const [tab, setTab] = useState("leaderboard");
  const [players, setPlayers] = useState([]);
  const [games, setGames] = useState([]);
  const [scheduledGames, setScheduledGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);
  const [showNewGame, setShowNewGame] = useState(false);
  const [showScheduleGame, setShowScheduleGame] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [currentUsername, setCurrentUsername] = useState(getStoredUsername);
  const [currentRole, setCurrentRole] = useState(getRole);
  const [currentAvatar, setCurrentAvatar] = useState(getStoredAvatar);

  const isAdmin = roleIsAdmin(currentRole);
  const isOwner = roleIsOwner(currentRole);

  const [toastQueue, setToastQueue] = useState([]);

  const pollUnseen = useCallback(async () => {
    try {
      const rows = await apiFetch("/api/achievements/unseen");
      if (rows.length > 0) setToastQueue((q) => [...q, ...rows]);
    } catch {}
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    pollUnseen();
    const id = setInterval(pollUnseen, 30000);
    return () => clearInterval(id);
  }, [isLoggedIn, pollUnseen]);

  const dismissToast = useCallback(() => {
    setToastQueue([]);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    try {
      const [playersData, gamesData, scheduledData] = await Promise.all([
        apiFetch("/api/players"),
        apiFetch("/api/games"),
        apiFetch("/api/scheduled-games").catch(() => ({ games: [] })),
      ]);
      setPlayers(playersData.items);
      setGames(gamesData.items ?? []);
      setScheduledGames(scheduledData.games ?? []);
    } catch (e) {
      setFetchError(e.message || "Failed to load data.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isLoggedIn) fetchData(); }, [isLoggedIn, fetchData]);

  const handleLogin = (username, role, avatarPath) => {
    setCurrentUsername(username);
    setCurrentRole(role);
    setCurrentAvatar(avatarPath);
    setIsLoggedIn(true);
  };

  const signOut = async () => {
    try { await apiFetch("/api/logout", { method: "POST" }); } catch {}
    clearUsername(); clearRole(); storeAvatar(null);
    setIsLoggedIn(false);
    setCurrentUsername(null);
    setCurrentRole(null);
    setCurrentAvatar(null);
    setPlayers([]);
    setGames([]);
    setSelectedGame(null);
    setTab("leaderboard");
  };

  const handleSelectGame = (game) => {
    const fresh = games.find((g) => g.id === game.id) || game;
    setSelectedGame(fresh);
  };

  const handleNewGameCreated = async () => {
    await fetchData();
    setShowNewGame(false);
    setTab("games");
  };

  const handleRefreshAndBack = async () => {
    await fetchData();
    setSelectedGame(null);
    setTimeout(pollUnseen, 1500);
  };

  const activeGame = games.find((g) => !g.isComplete);

  if (!isLoggedIn && pendingPasswordChange) {
    return (
      <ChangePasswordScreen
        username={pendingPasswordChange.username}
        currentPassword={pendingPasswordChange.currentPassword}
        onSuccess={() => {
          setPendingPasswordChange(null);
          setIsLoggedIn(true);
          setCurrentUsername(getStoredUsername());
          setCurrentRole(getRole());
          setCurrentAvatar(getStoredAvatar());
        }}
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onRequirePasswordChange={(username, currentPassword) =>
          setPendingPasswordChange({ username, currentPassword })}
      />
    );
  }

  const allTabs = [
    ...TABS,
    ...(isAdmin ? [{ id: "ask-claude", label: "Ask Claude" }] : []),
    ...(isAdmin ? [{ id: "admin", label: "Admin" }] : []),
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <span className="logo">Carson&rsquo;s Game</span>
          {activeGame && !selectedGame && (
            <button className="active-game-pill" onClick={() => handleSelectGame(activeGame)}>
              Live
            </button>
          )}
        </div>
        <div className="header-right">
          <button
            className="btn btn-ghost btn-sm header-stats-btn"
            onClick={() => { setSelectedGame(null); setTab("stats"); }}
          >
            Stats
          </button>
          <button
            className="profile-btn"
            onClick={() => setShowProfile(true)}
            aria-label="Open your profile"
          >
            <Avatar src={currentAvatar} name={currentUsername} size={28} />
            <span className="header-username">{currentUsername}</span>
          </button>
        </div>
      </header>

      {!selectedGame && (
        <nav className="tab-nav" aria-label="Sections">
          {allTabs.map((t) => (
            <button
              key={t.id}
              className={"tab-btn" + (tab === t.id ? " active" : "")}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="app-main">
        {loading ? (
          <SkeletonTab rows={5} />
        ) : fetchError ? (
          <div className="error-banner" role="alert">
            <p>{fetchError}</p>
            <button className="btn btn-ghost" onClick={fetchData}>Retry</button>
          </div>
        ) : selectedGame ? (
          <GameDetail
            game={selectedGame}
            onBack={() => setSelectedGame(null)}
            onRefresh={handleRefreshAndBack}
            isOwner={isOwner}
            isAdmin={isAdmin}
            allPlayers={players}
          />
        ) : (
          <Suspense fallback={<SkeletonTab />}>
            {tab === "leaderboard"  && <Leaderboard players={players} />}
            {tab === "games"        && (
              <GameHistory
                games={games}
                scheduledGames={scheduledGames}
                onSelectGame={handleSelectGame}
                onNewGame={() => setShowNewGame(true)}
                onScheduleGame={() => setShowScheduleGame(true)}
                isOwner={isOwner}
                isAdmin={isAdmin}
                onRefresh={fetchData}
              />
            )}
            {tab === "players"      && <PlayersTab players={players} onRefresh={fetchData} isOwner={isOwner} isAdmin={isAdmin} />}
            {tab === "rules"        && <RulesTab isOwner={isOwner} isAdmin={isAdmin} />}
            {tab === "achievements" && (
              <AchievementsTab
                isAdmin={isAdmin}
                onPreviewToast={(achievement) => setToastQueue((q) => [
                  { achievementId: achievement.id, earnedAt: new Date().toISOString(), gameId: null, count: 1,
                    name: achievement.name, description: achievement.description,
                    imageSvg: achievement.imageSvg, imageFrame: achievement.imageFrame,
                    xpValue: achievement.xpValue ?? 0 },
                  ...q,
                ])}
              />
            )}
            {tab === "stats"        && <StatsTab />}
            {tab === "ask-claude"   && isAdmin && <AskClaudeTab />}
            {tab === "admin"        && isAdmin && <AdminPanel />}
          </Suspense>
        )}
      </main>

      {showNewGame && (
        <NewGameModal
          players={players}
          onClose={() => setShowNewGame(false)}
          onCreate={handleNewGameCreated}
        />
      )}

      {showScheduleGame && (
        <ScheduleGameModal
          onClose={() => setShowScheduleGame(false)}
          onScheduled={fetchData}
        />
      )}

      {showProfile && (
        <ProfileModal
          onClose={() => setShowProfile(false)}
          onAvatarChange={(path) => {
            setCurrentAvatar(path);
            storeAvatar(path);
          }}
          onSignOut={() => { setShowProfile(false); signOut(); }}
        />
      )}

      {toastQueue.length > 0 && (
        <AchievementToast
          key={toastQueue.map((a) => a.achievementId).join(",")}
          achievements={toastQueue}
          onDismiss={dismissToast}
          onViewAll={() => { setSelectedGame(null); setTab("achievements"); }}
        />
      )}
    </div>
  );
}

export default App;
