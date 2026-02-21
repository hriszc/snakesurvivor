export type DifficultyTier = 'rookie' | 'veteran' | 'nightmare';
export type PlatformInputMode = 'desktop' | 'mobile';
export type EncounterKind = 'swarm' | 'rush' | 'encircle' | 'boss';

export interface RunConfig {
    seed?: RunSeed;
    difficulty?: DifficultyTier;
    durationSec?: number;
    inputMode?: PlatformInputMode;
}

export type RunSeed = number | string;

export interface EncounterDef {
    id: string;
    name: string;
    start: number;
    end: number;
    kind: EncounterKind;
    spawnInterval: number;
    spawnBatch: number;
    roles: string[];
}

export interface BossDef {
    id: string;
    name: string;
    spawnTime: number;
    hp: number;
    speed: number;
    radius: number;
    color: string;
    phases: number;
}

export interface WeaponDef {
    id: string;
    name: string;
    desc: string;
}

export interface PassiveDef {
    id: string;
    name: string;
    desc: string;
}

export interface RuneDef {
    id: string;
    name: string;
    desc: string;
    requires: string[];
}

export interface BuildSnapshot {
    seed: number;
    weapons: Array<{ id: string; level: number }>;
    passives: Array<{ id: string; level: number }>;
    runes: string[];
    tags: string[];
}

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
    upgradeActive: boolean;
    upgradeRewards: UpgradeOption[];
    chestActive: boolean;
    chestRewards: UpgradeOption[];
    currentEncounter: string;
    bossPhase: number;
    buildTags: string[];
    inputMode: PlatformInputMode;
    difficultyTier: DifficultyTier;
}

export interface UpgradeOption {
    id: string;
    name: string;
    desc: string;
    isNew: boolean;
    level: number;
    type: 'weapon' | 'passive' | 'rune';
}

export interface MetaStats {
    might: number;
    armor: number;
    speed: number;
    magnet: number;
    greed: number;
}

export const DEFAULT_META: MetaStats = {
    might: 0,
    armor: 0,
    speed: 0,
    magnet: 0,
    greed: 0,
};
