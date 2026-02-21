export interface GameState {
    hp: number;
    maxHp: number;
    level: number;
    xp: number;
    xpToNext: number;
    time: number;
    kills: number;
    gold: number;
    isGameOver: boolean;
    isPaused: boolean;
    chestActive: boolean;
    chestRewards: UpgradeOption[];
}

export interface UpgradeOption {
    id: string;
    name: string;
    desc: string;
    isNew: boolean;
    level: number;
    type: 'weapon' | 'stat';
}

export interface MetaStats {
    might: number;   // Damage multiplier
    armor: number;   // Damage reduction
    speed: number;   // Move speed multiplier
    magnet: number;  // Pickup radius multiplier
    greed: number;   // Gold multiplier
}

export const DEFAULT_META: MetaStats = {
    might: 0,
    armor: 0,
    speed: 0,
    magnet: 0,
    greed: 0
};
