import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Coins,
  Clock,
  Heart,
  Magnet,
  Monitor,
  Shield,
  Skull,
  Smartphone,
  Star,
  Swords,
  Zap,
  Zap as SpeedIcon,
} from 'lucide-react';
import { GameEngine } from './game/engine';
import {
  DEFAULT_META,
  DifficultyTier,
  GameState,
  MetaStats,
  PlatformInputMode,
} from './game/types';

const DEFAULT_STATE: GameState = {
  hp: 120,
  maxHp: 120,
  level: 1,
  xp: 0,
  xpToNext: 12,
  time: 0,
  kills: 0,
  gold: 0,
  isGameOver: false,
  isPaused: false,
  upgradeActive: false,
  upgradeRewards: [],
  chestActive: false,
  chestRewards: [],
  currentEncounter: 'Opening Swarm',
  bossPhase: 0,
  buildTags: [],
  inputMode: 'desktop',
  difficultyTier: 'veteran',
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const joystickRef = useRef<HTMLDivElement>(null);
  const joystickPointerIdRef = useRef<number | null>(null);

  const [gameState, setGameState] = useState<GameState>(DEFAULT_STATE);
  const [showMenu, setShowMenu] = useState(true);
  const [showStore, setShowStore] = useState(false);

  const [totalGold, setTotalGold] = useState(0);
  const [metaStats, setMetaStats] = useState<MetaStats>(DEFAULT_META);

  const [difficulty, setDifficulty] = useState<DifficultyTier>('veteran');
  const [preferredInputMode, setPreferredInputMode] = useState<PlatformInputMode>('desktop');
  const [runSeed, setRunSeed] = useState<number>(Date.now());

  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickKnob, setJoystickKnob] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    setPreferredInputMode(coarse ? 'mobile' : 'desktop');
  }, []);

  useEffect(() => {
    const savedGold = localStorage.getItem('snake_survivors_gold');
    const savedMeta = localStorage.getItem('snake_survivors_meta');
    if (savedGold) setTotalGold(parseInt(savedGold, 10));
    if (savedMeta) setMetaStats(JSON.parse(savedMeta));
  }, []);

  useEffect(() => {
    localStorage.setItem('snake_survivors_gold', totalGold.toString());
    localStorage.setItem('snake_survivors_meta', JSON.stringify(metaStats));
  }, [totalGold, metaStats]);

  useEffect(() => {
    if (!canvasRef.current || showMenu) return;

    const canvas = canvasRef.current;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const engine = new GameEngine(
      canvas,
      metaStats,
      (state) => setGameState(state),
      () => {}
    );

    engine.startRun({
      seed: runSeed,
      difficulty,
      durationSec: 720,
      inputMode: preferredInputMode,
    });
    engine.start();
    engineRef.current = engine;

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.cleanup();
    };
  }, [showMenu, metaStats]);

  useEffect(() => {
    if (gameState.isGameOver && engineRef.current) {
      setTotalGold((prev) => prev + gameState.gold);
      engineRef.current = null;
    }
  }, [gameState.isGameOver, gameState.gold]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const startGame = () => {
    setRunSeed(Date.now());
    setShowMenu(false);
  };

  const restartGame = () => {
    setShowMenu(true);
    setGameState(DEFAULT_STATE);
    setJoystickActive(false);
    setJoystickKnob({ x: 0, y: 0 });
  };

  const handleUpgradeSelect = (id: string) => {
    if (!engineRef.current) return;
    engineRef.current.applyPlayerChoice(id);
  };

  const handleChestSelect = (id: string) => {
    if (!engineRef.current) return;
    engineRef.current.applyPlayerChoice(id);
    setGameState((prev) => ({ ...prev, chestActive: false, chestRewards: [] }));
  };

  const buyMetaUpgrade = (stat: keyof MetaStats) => {
    const cost = (metaStats[stat] + 1) * 100;
    if (totalGold < cost) return;
    setTotalGold((prev) => prev - cost);
    setMetaStats((prev) => ({ ...prev, [stat]: prev[stat] + 1 }));
  };

  const toggleInputMode = () => {
    const nextMode: PlatformInputMode = gameState.inputMode === 'desktop' ? 'mobile' : 'desktop';
    setPreferredInputMode(nextMode);
    engineRef.current?.setInputMode(nextMode);
    if (nextMode === 'desktop') {
      setJoystickActive(false);
      setJoystickKnob({ x: 0, y: 0 });
      engineRef.current?.setVirtualJoystick(0, 0, false);
    }
  };

  const updateJoystickFromClient = (clientX: number, clientY: number, active: boolean) => {
    const el = joystickRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;

    const radius = rect.width * 0.38;
    const dist = Math.hypot(dx, dy);
    const clamped = dist > radius ? radius / dist : 1;

    const knobX = dx * clamped;
    const knobY = dy * clamped;
    const nx = knobX / radius;
    const ny = knobY / radius;

    setJoystickKnob(active ? { x: knobX, y: knobY } : { x: 0, y: 0 });
    setJoystickActive(active);
    engineRef.current?.setVirtualJoystick(active ? nx : 0, active ? ny : 0, active);
  };

  const onJoystickDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (gameState.inputMode !== 'mobile') return;
    joystickPointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateJoystickFromClient(e.clientX, e.clientY, true);
  };

  const onJoystickMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (gameState.inputMode !== 'mobile') return;
    if (joystickPointerIdRef.current !== e.pointerId) return;
    updateJoystickFromClient(e.clientX, e.clientY, true);
  };

  const onJoystickUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (joystickPointerIdRef.current !== e.pointerId) return;
    joystickPointerIdRef.current = null;
    updateJoystickFromClient(e.clientX, e.clientY, false);
  };

  const difficultyBadge =
    gameState.difficultyTier === 'rookie' ? 'ROOKIE' : gameState.difficultyTier === 'nightmare' ? 'NIGHTMARE' : 'VETERAN';

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#1a1a1a] text-white font-sans select-none">
      {!showMenu && <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />}

      {!showMenu && !gameState.isGameOver && (
        <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">
          <div className="flex justify-between items-start gap-2">
            <div className="w-full max-w-2xl mx-auto absolute top-0 left-0 right-0 h-4 bg-gray-900/80">
              <div
                className="h-full bg-blue-500 transition-all duration-200"
                style={{ width: `${(gameState.xp / gameState.xpToNext) * 100}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tracking-widest">
                LVL {gameState.level}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 pointer-events-auto">
              <div className="flex items-center gap-2 bg-black/55 px-3 py-1.5 rounded-full border border-white/10">
                <Heart className="w-4 h-4 text-red-500" />
                <div className="w-28 h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500" style={{ width: `${(gameState.hp / gameState.maxHp) * 100}%` }} />
                </div>
                <span className="text-xs font-mono">{Math.ceil(gameState.hp)}/{Math.ceil(gameState.maxHp)}</span>
              </div>
              <div className="flex items-center gap-2 bg-black/55 px-3 py-1.5 rounded-full border border-white/10 w-fit">
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="text-xs font-mono text-yellow-400">{gameState.gold}</span>
              </div>
              <div className="flex items-center gap-2 bg-black/55 px-3 py-1.5 rounded-full border border-white/10 w-fit text-xs">
                <Swords className="w-4 h-4 text-cyan-300" />
                <span>{gameState.currentEncounter}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-end gap-2 pointer-events-auto">
              <div className="flex items-center gap-2 bg-black/55 px-3 py-1.5 rounded-full border border-white/10 text-xs">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="font-mono text-base">{formatTime(gameState.time)}</span>
              </div>
              <div className="flex items-center gap-2 bg-black/55 px-3 py-1.5 rounded-full border border-white/10 text-xs">
                <Skull className="w-4 h-4 text-gray-400" />
                <span className="font-mono">{gameState.kills}</span>
                {gameState.bossPhase > 0 && <span className="ml-2 text-orange-300">BOSS P{gameState.bossPhase}</span>}
              </div>
              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  onClick={toggleInputMode}
                  className="px-3 py-1.5 rounded-full bg-black/55 border border-white/10 text-xs hover:bg-black/70"
                >
                  {gameState.inputMode === 'desktop' ? <Monitor className="w-4 h-4 inline mr-1" /> : <Smartphone className="w-4 h-4 inline mr-1" />}
                  {gameState.inputMode.toUpperCase()}
                </button>
                <span className="px-3 py-1.5 rounded-full bg-black/55 border border-white/10 text-xs">{difficultyBadge}</span>
              </div>
            </div>
          </div>

          {gameState.buildTags.length > 0 && (
            <div className="pointer-events-none mb-1">
              <div className="flex flex-wrap gap-2 justify-center">
                {gameState.buildTags.slice(0, 8).map((tag) => (
                  <span key={tag} className="px-2 py-1 rounded-full bg-black/45 border border-white/10 text-[11px] text-cyan-200">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!showMenu && !gameState.isGameOver && gameState.inputMode === 'mobile' && (
        <div className="absolute bottom-6 left-6 pointer-events-auto z-30">
          <div
            ref={joystickRef}
            className="w-36 h-36 rounded-full border border-white/20 bg-black/35 backdrop-blur-sm touch-none"
            onPointerDown={onJoystickDown}
            onPointerMove={onJoystickMove}
            onPointerUp={onJoystickUp}
            onPointerCancel={onJoystickUp}
          >
            <div
              className={`absolute left-1/2 top-1/2 w-14 h-14 -ml-7 -mt-7 rounded-full border border-white/25 ${
                joystickActive ? 'bg-cyan-300/40' : 'bg-white/20'
              }`}
              style={{ transform: `translate(${joystickKnob.x}px, ${joystickKnob.y}px)` }}
            />
          </div>
        </div>
      )}

      <AnimatePresence>
        {showMenu && !showStore && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a] z-50"
          >
            <div className="text-center max-w-md w-full p-8">
              <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
                <h1 className="text-6xl font-black tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-br from-red-500 to-orange-500">
                  SNAKE
                  <br />SURVIVORS
                </h1>
                <p className="text-gray-400 mb-6">12-minute director run. Build synergies, beat phased bosses.</p>
              </motion.div>

              <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
                {(['rookie', 'veteran', 'nightmare'] as DifficultyTier[]).map((tier) => (
                  <button
                    key={tier}
                    onClick={() => setDifficulty(tier)}
                    className={`py-2 rounded-lg border transition-colors ${
                      difficulty === tier ? 'bg-white text-black border-white' : 'bg-gray-900 text-gray-300 border-gray-700'
                    }`}
                  >
                    {tier.toUpperCase()}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setPreferredInputMode(preferredInputMode === 'desktop' ? 'mobile' : 'desktop')}
                className="mb-4 w-full py-3 bg-gray-900 text-gray-100 border border-gray-700 font-bold rounded-2xl hover:bg-gray-800 transition-colors"
              >
                INPUT: {preferredInputMode === 'desktop' ? 'DESKTOP' : 'MOBILE'}
              </button>

              <div className="flex flex-col gap-4">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={startGame}
                  className="w-full py-4 bg-white text-black font-bold rounded-2xl text-xl hover:bg-gray-200 transition-colors"
                >
                  PLAY RUN
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowStore(true)}
                  className="w-full py-4 bg-gray-800 text-yellow-400 border border-yellow-500/30 font-bold rounded-2xl text-xl hover:bg-gray-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Coins className="w-6 h-6" />
                  UPGRADES ({totalGold})
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMenu && showStore && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a] z-50 p-8"
          >
            <div className="max-w-2xl w-full">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-4xl font-black text-white">META UPGRADES</h2>
                <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-full border border-yellow-500/30">
                  <Coins className="w-5 h-5 text-yellow-400" />
                  <span className="font-mono text-xl text-yellow-400">{totalGold}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 mb-8">
                {[
                  { id: 'might', name: 'Might', desc: '+10% Damage per level', icon: Zap, color: 'text-red-400' },
                  { id: 'armor', name: 'Armor', desc: 'Damage reduction scaling', icon: Shield, color: 'text-blue-400' },
                  { id: 'speed', name: 'Speed', desc: '+10% Move Speed per level', icon: SpeedIcon, color: 'text-green-400' },
                  { id: 'magnet', name: 'Magnet', desc: '+20% Pickup Radius per level', icon: Magnet, color: 'text-purple-400' },
                  { id: 'greed', name: 'Greed', desc: '+20% Gold drops per level', icon: Coins, color: 'text-yellow-400' },
                ].map((stat) => {
                  const level = metaStats[stat.id as keyof MetaStats];
                  const cost = (level + 1) * 100;
                  const canAfford = totalGold >= cost;
                  const Icon = stat.icon;

                  return (
                    <div key={stat.id} className="flex items-center justify-between bg-gray-800 p-4 rounded-2xl border border-gray-700">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center ${stat.color}`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-bold text-lg">
                            {stat.name} <span className="text-gray-500 text-sm ml-2">LVL {level}</span>
                          </h3>
                          <p className="text-sm text-gray-400">{stat.desc}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => buyMetaUpgrade(stat.id as keyof MetaStats)}
                        disabled={!canAfford}
                        className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-colors ${
                          canAfford ? 'bg-yellow-500 text-black hover:bg-yellow-400' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        <Coins className="w-4 h-4" />
                        {cost}
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setShowStore(false)}
                className="w-full py-4 bg-gray-800 text-white font-bold rounded-2xl hover:bg-gray-700 transition-colors"
              >
                BACK TO MENU
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {gameState.upgradeActive && gameState.upgradeRewards.length > 0 && !gameState.chestActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-40 p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-gray-900 border border-white/10 p-8 rounded-3xl max-w-3xl w-full shadow-2xl"
            >
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-yellow-400 flex items-center justify-center gap-2">
                  <Star className="w-8 h-8 fill-yellow-400" />
                  LEVEL UP
                  <Star className="w-8 h-8 fill-yellow-400" />
                </h2>
                <p className="text-gray-400 mt-2">Pick your build direction</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {gameState.upgradeRewards.map((opt, i) => (
                  <motion.button
                    key={i}
                    whileHover={{ scale: 1.02, y: -4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleUpgradeSelect(opt.id)}
                    className="flex flex-col items-center text-center p-6 rounded-2xl bg-gray-800 border border-gray-700 hover:border-blue-500 transition-all"
                  >
                    <div className="w-16 h-16 rounded-full bg-gray-900 flex items-center justify-center mb-4">
                      {opt.type === 'weapon' && <Zap className="w-8 h-8 text-blue-400" />}
                      {opt.type === 'passive' && <Heart className="w-8 h-8 text-red-400" />}
                      {opt.type === 'rune' && <Star className="w-8 h-8 text-yellow-300" />}
                    </div>
                    <h3 className="font-bold text-lg mb-1">{opt.name}</h3>
                    <div className="text-xs font-mono text-cyan-300 mb-3">
                      {opt.type.toUpperCase()} · {opt.isNew ? 'NEW' : `LEVEL ${opt.level}`}
                    </div>
                    <p className="text-sm text-gray-400 leading-relaxed">{opt.desc}</p>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {gameState.chestActive && gameState.chestRewards.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-md z-40 p-4 pointer-events-auto"
          >
            <motion.div
              initial={{ scale: 0.5, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', bounce: 0.6 }}
              className="bg-gradient-to-b from-yellow-900 to-gray-900 border-2 border-yellow-500/50 p-8 rounded-3xl max-w-md w-full shadow-2xl shadow-yellow-500/20 text-center"
            >
              <div className="mb-8">
                <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 to-yellow-600 mb-2">
                  TREASURE FOUND!
                </h2>
              </div>

              <div className="flex justify-center mb-8">
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="w-32 h-32 bg-yellow-500/20 rounded-full flex items-center justify-center border border-yellow-500/50"
                >
                  {gameState.chestRewards[0].type === 'rune' ? (
                    <Star className="w-16 h-16 text-yellow-400" />
                  ) : gameState.chestRewards[0].type === 'weapon' ? (
                    <Zap className="w-16 h-16 text-yellow-400" />
                  ) : (
                    <Heart className="w-16 h-16 text-red-400" />
                  )}
                </motion.div>
              </div>

              <div className="mb-8">
                <h3 className="text-2xl font-bold mb-2">{gameState.chestRewards[0].name}</h3>
                <div className="text-sm font-mono text-yellow-400 mb-4">
                  {gameState.chestRewards[0].isNew ? 'NEW ITEM' : `UPGRADED TO LEVEL ${gameState.chestRewards[0].level}`}
                </div>
                <p className="text-gray-300">{gameState.chestRewards[0].desc}</p>
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleChestSelect(gameState.chestRewards[0].id)}
                className="w-full py-4 bg-gradient-to-r from-yellow-600 to-yellow-500 text-black font-black rounded-2xl text-xl hover:from-yellow-500 hover:to-yellow-400 transition-all shadow-lg shadow-yellow-500/25"
              >
                COLLECT
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {gameState.isGameOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-red-950/90 backdrop-blur-md z-50 p-4 pointer-events-auto"
          >
            <div className="text-center max-w-md w-full">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', bounce: 0.5 }}
              >
                <Skull className="w-24 h-24 text-red-500 mx-auto mb-6" />
                <h2 className="text-5xl font-black text-white mb-2">RUN OVER</h2>
                <p className="text-red-300 mb-8">Survived {formatTime(gameState.time)} · {gameState.currentEncounter}</p>

                <div className="bg-black/50 rounded-2xl p-6 mb-8 border border-red-500/30">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-gray-400">Level Reached</span>
                    <span className="text-2xl font-bold">{gameState.level}</span>
                  </div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-gray-400">Enemies Defeated</span>
                    <span className="text-2xl font-bold">{gameState.kills}</span>
                  </div>
                  <div className="flex justify-between items-center pt-4 border-t border-white/10">
                    <span className="text-yellow-400 flex items-center gap-2">
                      <Coins className="w-4 h-4" /> Gold Earned
                    </span>
                    <span className="text-2xl font-bold text-yellow-400">+{gameState.gold}</span>
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={restartGame}
                  className="w-full py-4 bg-white text-red-950 font-bold rounded-2xl text-xl hover:bg-gray-200 transition-colors"
                >
                  RETURN TO MENU
                </motion.button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
