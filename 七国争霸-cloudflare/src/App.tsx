import React, { useState } from 'react';
import { useGameStore } from './stores/gameStore';
import { useSocket } from './hooks/useSocket';
import Lobby, { PLAYER_NAME_KEY } from './components/Lobby';
import NameEntry from './components/NameEntry';
import GameBoard from './components/GameBoard';
import ResultModal from './components/ResultModal';
import Shop from './components/Shop';
import Redeem from './components/Redeem';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  const { currentRoom, lastGameResult, clearLastGameResult, playerId, isConnected, error, setError } = useGameStore();
  // 名字流程：首次进入先显示起名页（NameEntry），确认名字后写入 localStorage 并放行进大厅；
  // 已有名字（刷新/再次访问）直接进大厅，名字从 localStorage 恢复
  const [playerName, setPlayerName] = useState<string>(() => localStorage.getItem(PLAYER_NAME_KEY) || '');
  const [hasName, setHasName] = useState<boolean>(() => !!localStorage.getItem(PLAYER_NAME_KEY));
  const [view, setView] = useState<'lobby' | 'shop' | 'redeem'>('lobby');
  const { createRoom, createAIRoom, joinRoom } = useSocket();

  // 起名页确认：保存名字并进入大厅
  const handleNameConfirm = (name: string) => {
    localStorage.setItem(PLAYER_NAME_KEY, name);
    setPlayerName(name);
    setHasName(true);
  };

  if (error) {
    setTimeout(() => setError(null), 3000);
  }

  // 主页面结果遮罩：离开房间后 lastGameResult 仍有值 → 显示"我赢了/你输了"
  const showResultOverlay = !currentRoom && !!lastGameResult;
  const resultIsWin = !lastGameResult?.isDraw && lastGameResult?.winnerSocketId === playerId;
  const resultIsDraw = lastGameResult?.isDraw;

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-gradient-to-br from-primary to-secondary p-2 sm:p-4">
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-danger text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}

      {!isConnected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-secondary p-8 rounded-xl text-center">
            <div className="text-4xl mb-4">🔌</div>
            <p className="text-xl">正在连接服务器...</p>
            <p className="text-sm text-gray-400 mt-2">请确保服务器运行在 localhost:3001</p>
          </div>
        </div>
      )}

      {!currentRoom ? (
        !hasName ? (
          // 未起名：先显示起名页，确认名字后才进大厅
          <NameEntry onConfirm={handleNameConfirm} />
        ) : view === 'shop' ? (
          <Shop
            onBack={() => setView('lobby')}
            onOpenRedeem={() => setView('redeem')}
          />
        ) : view === 'redeem' ? (
          <Redeem onBack={() => setView('shop')} />
        ) : (
          <Lobby
            playerName={playerName}
            setPlayerName={setPlayerName}
            createRoom={createRoom}
            createAIRoom={createAIRoom}
            joinRoom={joinRoom}
            onOpenShop={() => setView('shop')}
          />
        )
      ) : currentRoom.gameStatus === 'ended' ? (
        <ResultModal />
      ) : (
        <GameBoard />
      )}

      {/* 主页面结果遮罩：赢/输/平局 */}
      {showResultOverlay && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-secondary rounded-2xl p-8 border border-accent/30 max-w-sm w-full mx-4 text-center shadow-2xl">
            {resultIsDraw ? (
              <>
                <div className="text-6xl mb-4">🤝</div>
                <h2 className="text-4xl font-serif mb-3 text-gray-200">平局</h2>
              </>
            ) : resultIsWin ? (
              <>
                <div className="text-6xl mb-4 animate-bounce">🏆</div>
                <h2 className="text-4xl font-serif mb-2 text-accent">我赢了</h2>
                <p className="text-yellow-400 font-bold text-lg animate-pulse mb-2">+10 系统货币</p>
              </>
            ) : (
              <>
                <div className="text-6xl mb-4 animate-bounce">💀</div>
                <h2 className="text-4xl font-serif mb-3 text-danger">我输了</h2>
              </>
            )}
            <p className="text-gray-400 text-sm mb-6">
              {lastGameResult?.winner ? `本局胜者：${lastGameResult.winner}` : '本局已结束'}
            </p>
            <button
              onClick={() => clearLastGameResult()}
              className="w-full py-3 bg-accent text-primary font-bold rounded-lg hover:bg-accent/90 transition-all"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}

export default App;
