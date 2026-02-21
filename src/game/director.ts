import { BossDef, DifficultyTier, EncounterDef, RunConfig } from './types';

export class SeededRng {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
        if (this.state === 0) this.state = 0x6d2b79f5;
    }

    next(): number {
        this.state = (1664525 * this.state + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }

    pick<T>(arr: T[]): T {
        return arr[Math.floor(this.next() * arr.length) % arr.length];
    }
}

export function normalizeSeed(seed: RunConfig['seed']): number {
    if (typeof seed === 'number' && Number.isFinite(seed)) {
        return Math.abs(Math.floor(seed)) || 1;
    }
    if (typeof seed === 'string' && seed.length > 0) {
        let hash = 2166136261;
        for (let i = 0; i < seed.length; i++) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }
    return Math.floor(Date.now() % 2147483647) || 1;
}

const difficultyScale: Record<DifficultyTier, { interval: number; batch: number; hp: number }> = {
    rookie: { interval: 1.2, batch: 0.9, hp: 0.9 },
    veteran: { interval: 1.0, batch: 1.0, hp: 1.0 },
    nightmare: { interval: 0.8, batch: 1.2, hp: 1.25 },
};

export class RunDirector {
    private encounters: EncounterDef[];
    private bosses: BossDef[];
    private runConfig: Required<RunConfig>;

    constructor(encounters: EncounterDef[], bosses: BossDef[], runConfig: Required<RunConfig>) {
        this.encounters = encounters;
        this.bosses = bosses;
        this.runConfig = runConfig;
    }

    getEncounterAt(time: number): EncounterDef {
        for (const encounter of this.encounters) {
            if (time >= encounter.start && time < encounter.end) return encounter;
        }
        return this.encounters[this.encounters.length - 1];
    }

    getSpawnInterval(encounter: EncounterDef): number {
        const diff = difficultyScale[this.runConfig.difficulty];
        const paceRamp = Math.max(0.8, 1 - Math.min(timeRamp(this.runConfig.durationSec), 0.2));
        return Math.max(0.2, encounter.spawnInterval * diff.interval * paceRamp);
    }

    getSpawnBatch(encounter: EncounterDef, rng: SeededRng): number {
        const diff = difficultyScale[this.runConfig.difficulty];
        const variance = 0.8 + rng.next() * 0.5;
        return Math.max(1, Math.floor(encounter.spawnBatch * diff.batch * variance));
    }

    getEnemyHpScale(): number {
        return difficultyScale[this.runConfig.difficulty].hp;
    }

    getBossToSpawn(time: number, spawned: Set<string>): BossDef | null {
        for (const boss of this.bosses) {
            if (time >= boss.spawnTime && !spawned.has(boss.id)) {
                return boss;
            }
        }
        return null;
    }

    getRunDuration(): number {
        return this.runConfig.durationSec;
    }

    pickRole(encounter: EncounterDef, rng: SeededRng): string {
        return rng.pick(encounter.roles);
    }
}

function timeRamp(durationSec: number): number {
    return durationSec / 720;
}
