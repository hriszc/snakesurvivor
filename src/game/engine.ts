import { sfx } from './audio';
import {
    BossDef,
    BuildSnapshot,
    DifficultyTier,
    EncounterDef,
    GameState,
    MetaStats,
    PassiveDef,
    PlatformInputMode,
    RuneDef,
    RunConfig,
    UpgradeOption,
    WeaponDef,
} from './types';
import { InputManager } from './input';
import { normalizeSeed, RunDirector, SeededRng } from './director';

import encounterDefsRaw from './content/encounters.json';
import bossesRaw from './content/bosses.json';
import weaponsRaw from './content/weapons.json';
import passivesRaw from './content/passives.json';
import runesRaw from './content/runes.json';

const ENCOUNTER_DEFS = encounterDefsRaw as EncounterDef[];
const BOSS_DEFS = bossesRaw as BossDef[];
const WEAPON_DEFS = weaponsRaw as WeaponDef[];
const PASSIVE_DEFS = passivesRaw as PassiveDef[];
const RUNE_DEFS = runesRaw as RuneDef[];

const WEAPON_IDS = new Set(WEAPON_DEFS.map((w) => w.id));
const PASSIVE_IDS = new Set(PASSIVE_DEFS.map((p) => p.id));
const RUNE_IDS = new Set(RUNE_DEFS.map((r) => r.id));

type EnemyRole =
    | 'stalker'
    | 'charger'
    | 'ranged'
    | 'summoner'
    | 'shield'
    | 'splitter'
    | 'encircler'
    | 'boss'
    | 'boss_segment';

export class SpatialHash {
    cellSize: number;
    cells: Map<string, any[]>;

    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    clear() {
        this.cells.clear();
    }

    insert(obj: any) {
        const x = Math.floor(obj.x / this.cellSize);
        const y = Math.floor(obj.y / this.cellSize);
        const key = `${x},${y}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key)!.push(obj);
    }

    query(x: number, y: number, radius: number): any[] {
        const minX = Math.floor((x - radius) / this.cellSize);
        const maxX = Math.floor((x + radius) / this.cellSize);
        const minY = Math.floor((y - radius) / this.cellSize);
        const maxY = Math.floor((y + radius) / this.cellSize);

        const result = [];
        for (let cx = minX; cx <= maxX; cx++) {
            for (let cy = minY; cy <= maxY; cy++) {
                const key = `${cx},${cy}`;
                const cell = this.cells.get(key);
                if (cell) result.push(...cell);
            }
        }
        return result;
    }
}

export class Player {
    x: number = 0;
    y: number = 0;
    vx: number = 0;
    vy: number = 0;

    speed: number = 160;
    hp: number = 120;
    maxHp: number = 120;
    regen: number = 0;

    level: number = 1;
    xp: number = 0;
    xpToNext: number = 12;

    pickupRadius: number = 70;
    damageMul: number = 1;
    cooldownMul: number = 1;
    aoeMul: number = 1;
    thorns: number = 0;
    lifesteal: number = 0;
    armorFlat: number = 0;
    luck: number = 0;

    weapons: Weapon[] = [];
    passives: Record<string, number> = {};
    runes: Set<string> = new Set();

    meta: MetaStats;

    constructor(meta: MetaStats) {
        this.meta = meta;
        this.speed *= 1 + meta.speed * 0.1;
        this.pickupRadius *= 1 + meta.magnet * 0.2;
        this.damageMul *= 1 + meta.might * 0.1;
        this.armorFlat += meta.armor * 0.6;
        this.luck += meta.greed * 0.02;
    }

    takeDamage(amount: number, dt: number = 1) {
        const reduced = Math.max(0.1, amount - (this.armorFlat + this.meta.armor * 0.4) * dt);
        this.hp -= reduced;
        if (this.hp < 0) this.hp = 0;
    }

    heal(amount: number) {
        this.hp = Math.min(this.maxHp, this.hp + amount);
    }

    applyPassive(id: string) {
        this.passives[id] = (this.passives[id] || 0) + 1;
        const level = this.passives[id];

        if (id === 'speed') this.speed *= 1.12;
        if (id === 'maxhp') {
            this.maxHp += 40;
            this.hp += 40;
        }
        if (id === 'regen') this.regen += 0.6;
        if (id === 'armor') this.armorFlat += 0.5;
        if (id === 'might') this.damageMul *= 1.12;
        if (id === 'cooldown') this.cooldownMul *= 0.92;
        if (id === 'radius') {
            this.pickupRadius *= 1.1;
            this.aoeMul *= 1.1;
        }
        if (id === 'luck') this.luck += 0.04;
        if (id === 'thorns') this.thorns += 4;
        if (id === 'lifesteal') this.lifesteal += 0.01;

        // Soft cap to keep single-run numbers sane.
        if (level > 8) this.passives[id] = 8;
    }

    addRune(id: string) {
        if (this.runes.has(id)) return;
        this.runes.add(id);

        if (id === 'storm-sigil') this.cooldownMul *= 0.82;
        if (id === 'blood-oath') this.lifesteal += 0.04;
        if (id === 'frozen-core') this.armorFlat += 1;
        if (id === 'gravity-well') this.pickupRadius *= 1.15;
        if (id === 'berserker-loop') {
            this.speed *= 1.08;
            this.damageMul *= 1.08;
        }
        if (id === 'echo-battery') this.damageMul *= 1.06;
    }

    getTags(): string[] {
        const weaponIds = this.weapons.map((w) => w.id);
        const passiveIds = Object.keys(this.passives).filter((k) => this.passives[k] > 0);
        return [...new Set([...weaponIds, ...passiveIds, ...this.runes])];
    }
}

export class Enemy {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    speed: number;
    radius: number;
    role: EnemyRole;
    isHead: boolean;
    leader: Enemy | null;
    isDead: boolean = false;
    isElite: boolean = false;
    isBoss: boolean = false;
    isFinalBoss: boolean = false;
    isBossSegment: boolean = false;
    bossId: string = '';
    bossPhases: number = 0;

    color: string;
    hitCooldown: Map<string, number> = new Map();
    flashTimer: number = 0;
    slowTimer: number = 0;
    summonTimer: number = 0.8;
    rangedTimer: number = 0.7;
    bossStrikeTimer: number = 2.8;
    vulnerableTimer: number = 0;

    kbX: number = 0;
    kbY: number = 0;

    constructor(opts: {
        x: number;
        y: number;
        leader: Enemy | null;
        isHead: boolean;
        role: EnemyRole;
        hpScale: number;
        isElite?: boolean;
        boss?: BossDef;
    }) {
        this.x = opts.x;
        this.y = opts.y;
        this.leader = opts.leader;
        this.isHead = opts.isHead;
        this.role = opts.role;
        this.isElite = !!opts.isElite;
        this.isBossSegment = opts.role === 'boss_segment';

        if (opts.boss) {
            this.isBoss = true;
            this.bossId = opts.boss.id;
            this.bossPhases = opts.boss.phases;
            this.maxHp = opts.boss.hp * opts.hpScale;
            this.hp = this.maxHp;
            this.speed = opts.boss.speed;
            this.radius = opts.boss.radius;
            this.color = opts.boss.color;
            return;
        }

        const roleBase = roleBaseStats(this.role);
        this.maxHp = roleBase.hp * opts.hpScale * (this.isElite ? 1.6 : 1);
        this.hp = this.maxHp;
        this.speed = roleBase.speed * (this.isElite ? 1.2 : 1);
        this.radius = roleBase.radius + (this.isHead ? 2 : 0);
        this.color = roleBase.color;
    }

    takeDamage(amount: number, engine: GameEngine, sourceX: number, sourceY: number, knockbackForce: number = 0) {
        if (this.isBossSegment) return;

        if (this.role === 'shield' && !this.isBoss) {
            amount *= 0.75;
        }

        if (this.isBoss) {
            if (this.isFinalBoss) {
                amount *= this.vulnerableTimer > 0 ? 0.95 : 0.12;
                const ratio = this.hp / this.maxHp;
                if (ratio > 0.75) amount *= 0.78;
                else if (ratio > 0.4) amount *= 0.86;
            } else {
                amount *= this.vulnerableTimer > 0 ? 1.45 : 0.78;
            }
        }

        if (engine.player.runes.has('berserker-loop') && engine.player.hp < engine.player.maxHp * 0.35) {
            amount *= 1.25;
        }

        this.hp -= amount;
        this.flashTimer = 0.08;
        sfx.hit();

        if (knockbackForce > 0) {
            const dx = this.x - sourceX;
            const dy = this.y - sourceY;
            const dist = Math.hypot(dx, dy) || 1;
            this.kbX = (dx / dist) * knockbackForce;
            this.kbY = (dy / dist) * knockbackForce;
        }

        engine.floatingTexts.push(new FloatingText(this.x, this.y, Math.floor(amount).toString(), '#ffffff'));

        if (this.hp <= 0 && !this.isDead) {
            this.isDead = true;
            engine.kills++;

            if (engine.player.lifesteal > 0) {
                engine.player.heal(engine.player.maxHp * 0.01 + engine.player.lifesteal * 3);
            }

            if (this.role === 'splitter' && !this.isBoss) {
                engine.spawnSplitChildren(this);
            }

            if (this.isBoss) {
                engine.drops.push(new Drop(this.x, this.y, 'chest'));
                engine.drops.push(new Drop(this.x + 18, this.y - 12, 'gold'));
                engine.drops.push(new Drop(this.x - 18, this.y + 12, 'magnet'));
            } else if (this.isElite && this.isHead) {
                engine.drops.push(new Drop(this.x, this.y, 'chest'));
            } else {
                const rand = engine.rng.next();
                const luckBoost = Math.min(0.35, engine.player.luck);
                const chickenChance = 0.007 + luckBoost * 0.05;
                const magnetChance = 0.006 + luckBoost * 0.04;
                const crossChance = 0.0015 + luckBoost * 0.005;
                const goldChance = 0.018 + luckBoost * 0.06;
                const effectiveCrossChance = engine.gameTime >= engine.crossDropCooldownUntil ? crossChance : 0;

                if (rand < chickenChance) engine.drops.push(new Drop(this.x, this.y, 'chicken'));
                else if (rand < chickenChance + magnetChance) engine.drops.push(new Drop(this.x, this.y, 'magnet'));
                else if (rand < chickenChance + magnetChance + effectiveCrossChance) {
                    engine.drops.push(new Drop(this.x, this.y, 'cross'));
                } else if (rand < chickenChance + magnetChance + effectiveCrossChance + goldChance) {
                    engine.drops.push(new Drop(this.x, this.y, 'gold'));
                }
                else engine.gems.push(new Gem(this.x, this.y, this.isHead ? 5 : 1));
            }

            for (let i = 0; i < (this.isBoss ? 15 : 5); i++) {
                engine.particles.push(new Particle(this.x, this.y, this.color));
            }
        }
    }

    update(dt: number, engine: GameEngine) {
        if (this.isBossSegment) {
            if (!this.leader || this.leader.isDead) {
                this.isDead = true;
                return;
            }

            // Very cheap follow behavior to keep 100+ segments stable on mid devices.
            const targetDist = 14;
            const dx = this.leader.x - this.x;
            const dy = this.leader.y - this.y;
            const dist = Math.hypot(dx, dy) || 1;
            const pull = Math.max(0, dist - targetDist);
            this.x += (dx / dist) * pull * 0.6;
            this.y += (dy / dist) * pull * 0.6;

            const playerDist = Math.hypot(engine.player.x - this.x, engine.player.y - this.y);
            if (playerDist < this.radius + 13) {
                engine.player.takeDamage(6 * dt, dt);
                engine.shake(1.2);
            }
            return;
        }

        if (this.flashTimer > 0) this.flashTimer -= dt;
        if (this.slowTimer > 0) this.slowTimer -= dt;
        if (this.vulnerableTimer > 0) this.vulnerableTimer -= dt;

        for (const [key, val] of this.hitCooldown.entries()) {
            if (val > 0) this.hitCooldown.set(key, val - dt);
        }

        if (this.leader && this.leader.isDead) {
            this.leader = null;
            this.isHead = true;
        }

        if (Math.abs(this.kbX) > 0.1 || Math.abs(this.kbY) > 0.1) {
            this.x += this.kbX * dt;
            this.y += this.kbY * dt;
            this.kbX *= 0.86;
            this.kbY *= 0.86;
        }

        let targetX = engine.player.x;
        let targetY = engine.player.y;

        if (this.leader) {
            targetX = this.leader.x;
            targetY = this.leader.y;
        }

        if (this.role === 'encircler' && !this.isBoss) {
            const orbit = engine.gameTime * 1.2 + (this.x + this.y) * 0.01;
            targetX += Math.cos(orbit) * 100;
            targetY += Math.sin(orbit) * 100;
        }

        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy) || 1;

        let speedMul = this.slowTimer > 0 ? 0.55 : 1;

        if (this.role === 'charger' && dist > 150) speedMul *= 1.5;
        if (this.role === 'shield') speedMul *= 0.9;
        if (this.isBoss && this.hp < this.maxHp * 0.66) speedMul *= 1.2;
        if (this.isBoss && this.hp < this.maxHp * 0.33) speedMul *= 1.3;
        if (this.isFinalBoss && this.vulnerableTimer <= 0) speedMul *= 1.3;

        if (this.isHead || dist > 20) {
            this.x += (dx / dist) * this.speed * speedMul * dt;
            this.y += (dy / dist) * this.speed * speedMul * dt;
        }

        if (this.role === 'summoner' && !this.isBoss) {
            this.summonTimer -= dt;
            if (this.summonTimer <= 0 && engine.enemies.length < 280) {
                this.summonTimer = 3.5;
                engine.spawnSummoned(this.x, this.y);
            }
        }

        if ((this.role === 'ranged' || this.isBoss) && !this.leader && (!this.isBoss || this.vulnerableTimer <= 0)) {
            this.rangedTimer -= dt;
            if (this.rangedTimer <= 0 && dist < 360) {
                this.rangedTimer = this.isFinalBoss ? 0.32 : this.isBoss ? 0.5 : 1.3;
                const speed = this.isBoss ? 260 : 200;
                engine.enemyProjectiles.push(
                    new EnemyProjectile(this.x, this.y, (dx / dist) * speed, (dy / dist) * speed, this.isFinalBoss ? 13 : this.isBoss ? 9 : 5)
                );
            }
        }

        if (this.isBoss && this.vulnerableTimer <= 0) {
            this.bossStrikeTimer -= dt;
            if (this.bossStrikeTimer <= 0) {
                const phase = this.getBossPhase();
                this.bossStrikeTimer = this.isFinalBoss
                    ? Math.max(0.55, 1.35 - phase * 0.15)
                    : Math.max(1.35, 3.0 - phase * 0.45);
                const tx = engine.player.x + engine.player.vx * 0.28;
                const ty = engine.player.y + engine.player.vy * 0.28;
                engine.spawnBossStrike(this, tx, ty, phase);
                if (this.isFinalBoss && phase >= 2) {
                    engine.spawnBossStrike(this, tx + (engine.rng.next() - 0.5) * 140, ty + (engine.rng.next() - 0.5) * 140, phase);
                }
            }
        }

        const playerDist = Math.hypot(engine.player.x - this.x, engine.player.y - this.y);
        if (playerDist < this.radius + 15) {
            const contactDamage = this.isFinalBoss ? 40 : this.isBoss ? 22 : this.isBossSegment ? 7 : this.role === 'charger' ? 14 : 10;
            engine.player.takeDamage(contactDamage * dt * engine.getIncomingDamageMultiplier(), dt);
            if (engine.player.thorns > 0) {
                this.takeDamage(engine.player.thorns * dt, engine, engine.player.x, engine.player.y, 0);
            }
            engine.shake(this.isBoss ? 5 : 2);
        }
    }

    getBossPhase(): number {
        if (!this.isBoss || this.bossPhases <= 1) return 0;
        const ratio = this.hp / this.maxHp;
        if (ratio > 0.66) return 1;
        if (ratio > 0.33) return 2;
        return 3;
    }
}

export class EnemyProjectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    life: number = 2.8;
    radius: number = 4;
    isDead: boolean = false;

    constructor(x: number, y: number, vx: number, vy: number, damage: number) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
    }

    update(dt: number, engine: GameEngine) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;

        if (this.life <= 0) {
            this.isDead = true;
            return;
        }

        const dist = Math.hypot(this.x - engine.player.x, this.y - engine.player.y);
        if (dist < this.radius + 14) {
            engine.player.takeDamage(this.damage * dt * 8 * engine.getIncomingDamageMultiplier(), dt);
            this.isDead = true;
            engine.shake(2);
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.fillStyle = '#d35400';
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

export class Projectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    pierce: number;
    life: number;
    color: string;
    radius: number;
    isDead: boolean = false;
    hitEnemies: Set<Enemy> = new Set();
    knockback: number;

    constructor(opts: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        damage: number;
        pierce: number;
        life: number;
        color: string;
        knockback?: number;
        radius?: number;
    }) {
        this.x = opts.x;
        this.y = opts.y;
        this.vx = opts.vx;
        this.vy = opts.vy;
        this.damage = opts.damage;
        this.pierce = opts.pierce;
        this.life = opts.life;
        this.color = opts.color;
        this.knockback = opts.knockback || 90;
        this.radius = opts.radius || 5;
    }

    update(dt: number, engine: GameEngine) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) {
            this.isDead = true;
            return;
        }

        const nearby = engine.spatialHash.query(this.x, this.y, this.radius + 36);
        for (const enemy of nearby as Enemy[]) {
            if (enemy.isDead || this.hitEnemies.has(enemy)) continue;
            const dist = Math.hypot(enemy.x - this.x, enemy.y - this.y);
            if (dist < this.radius + enemy.radius) {
                enemy.takeDamage(this.damage, engine, this.x, this.y, this.knockback);
                this.hitEnemies.add(enemy);
                this.pierce--;
                if (this.pierce <= 0) {
                    this.isDead = true;
                    break;
                }
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

export class Mine {
    x: number;
    y: number;
    life: number = 10;
    radius: number = 11;
    isDead: boolean = false;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    update(dt: number, engine: GameEngine) {
        this.life -= dt;
        if (this.life <= 0) {
            this.isDead = true;
            return;
        }

        const nearby = engine.spatialHash.query(this.x, this.y, 36) as Enemy[];
        for (const enemy of nearby) {
            const dist = Math.hypot(enemy.x - this.x, enemy.y - this.y);
            if (dist < this.radius + enemy.radius) {
                this.isDead = true;
                engine.shake(4);
                const damage = 35 * engine.player.damageMul;
                const blast = engine.spatialHash.query(this.x, this.y, 130) as Enemy[];
                for (const e of blast) {
                    const d = Math.hypot(e.x - this.x, e.y - this.y);
                    if (d < 80 + e.radius) {
                        e.takeDamage(damage, engine, this.x, this.y, 220);
                    }
                }
                break;
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.fillStyle = '#f39c12';
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

export class Gem {
    x: number;
    y: number;
    value: number;
    color: string;

    constructor(x: number, y: number, value: number) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.color = value > 1 ? '#3498db' : '#2ecc71';
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, this.value > 1 ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

export class Drop {
    x: number;
    y: number;
    type: 'chest' | 'chicken' | 'magnet' | 'cross' | 'gold';

    constructor(x: number, y: number, type: 'chest' | 'chicken' | 'magnet' | 'cross' | 'gold') {
        this.x = x;
        this.y = y;
        this.type = type;
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.save();
        ctx.translate(this.x - camera.x, this.y - camera.y);

        if (this.type === 'chest') {
            ctx.fillStyle = '#f1c40f';
            ctx.fillRect(-10, -8, 20, 16);
            ctx.fillStyle = '#e67e22';
            ctx.fillRect(-10, -2, 20, 4);
        } else if (this.type === 'chicken') {
            ctx.fillStyle = '#e74c3c';
            ctx.beginPath();
            ctx.arc(0, 0, 6, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'magnet') {
            ctx.strokeStyle = '#ecf0f1';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, 8, Math.PI, 0);
            ctx.stroke();
        } else if (this.type === 'cross') {
            ctx.fillStyle = '#ecf0f1';
            ctx.fillRect(-2, -8, 4, 16);
            ctx.fillRect(-6, -4, 12, 4);
        } else {
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

export class Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    color: string;

    constructor(x: number, y: number, color: string) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 50 + 20;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = Math.random() * 0.5 + 0.2;
        this.maxLife = this.life;
        this.color = color;
    }

    update(dt: number) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

export class FloatingText {
    x: number;
    y: number;
    text: string;
    life: number = 0.5;
    maxLife: number = 0.5;
    color: string;

    constructor(x: number, y: number, text: string, color: string) {
        this.x = x + (Math.random() - 0.5) * 20;
        this.y = y + (Math.random() - 0.5) * 20;
        this.text = text;
        this.color = color;
    }

    update(dt: number) {
        this.y -= 30 * dt;
        this.life -= dt;
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.text, this.x - camera.x, this.y - camera.y);
        ctx.globalAlpha = 1;
    }
}

export class LightningArc {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    life: number = 0.12;

    constructor(fromX: number, fromY: number, toX: number, toY: number) {
        this.fromX = fromX;
        this.fromY = fromY;
        this.toX = toX;
        this.toY = toY;
    }

    update(dt: number) {
        this.life -= dt;
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        ctx.strokeStyle = '#9b59b6';
        ctx.globalAlpha = Math.max(0, this.life / 0.12);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.fromX - camera.x, this.fromY - camera.y);
        ctx.lineTo(this.toX - camera.x, this.toY - camera.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

export class BossStrike {
    x: number;
    y: number;
    radius: number;
    telegraph: number;
    explodeLife: number = 0.25;
    exploded: boolean = false;
    isDead: boolean = false;
    hitDone: boolean = false;
    owner: Enemy;

    constructor(owner: Enemy, x: number, y: number, radius: number, telegraph: number) {
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.telegraph = telegraph;
    }

    update(dt: number, engine: GameEngine) {
        if (this.isDead) return;

        if (!this.exploded) {
            this.telegraph -= dt;
            if (this.telegraph <= 0) {
                this.exploded = true;
                if (!this.hitDone) {
                    this.hitDone = true;
                    const dist = Math.hypot(engine.player.x - this.x, engine.player.y - this.y);
                    if (dist <= this.radius + 14) {
                        engine.player.takeDamage(34 * engine.getIncomingDamageMultiplier(), 1);
                        engine.applyBossPunish(this.owner.isFinalBoss ? 3.2 : 2.4);
                        this.owner.vulnerableTimer = Math.max(this.owner.vulnerableTimer, this.owner.isFinalBoss ? 0.35 : 0.75);
                        this.owner.bossStrikeTimer = Math.max(this.owner.isFinalBoss ? 0.4 : 0.8, this.owner.bossStrikeTimer * 0.5);
                        engine.shake(7);
                        engine.floatingTexts.push(new FloatingText(engine.player.x, engine.player.y - 24, 'HIT!', '#ff7675'));
                        engine.floatingTexts.push(new FloatingText(engine.player.x, engine.player.y - 44, 'PUNISHED', '#ff7675'));
                    } else {
                        this.owner.vulnerableTimer = Math.max(this.owner.vulnerableTimer, this.owner.isFinalBoss ? 0.95 : 2.8);
                        this.owner.rangedTimer = Math.max(this.owner.rangedTimer, this.owner.isFinalBoss ? 0.25 : 0.45);
                        engine.floatingTexts.push(new FloatingText(this.owner.x, this.owner.y - 44, 'COUNTER WINDOW', '#74b9ff'));
                    }
                }
            }
            return;
        }

        this.explodeLife -= dt;
        if (this.explodeLife <= 0) this.isDead = true;
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }) {
        if (!this.exploded) {
            const alpha = 0.25 + Math.sin(this.telegraph * 24) * 0.12;
            ctx.strokeStyle = `rgba(231, 76, 60, ${Math.max(0.12, alpha)})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(this.x - camera.x, this.y - camera.y, this.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(231, 76, 60, 0.35)';
            ctx.beginPath();
            ctx.arc(this.x - camera.x, this.y - camera.y, 8, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        const a = Math.max(0, this.explodeLife / 0.25);
        ctx.fillStyle = `rgba(241, 196, 15, ${0.28 * a})`;
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

export interface Weapon {
    id: string;
    level: number;
    update(dt: number, engine: GameEngine): void;
    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, player: Player): void;
}

export class MagicWand implements Weapon {
    id = 'wand';
    level = 1;
    cooldown = 0.95;
    timer = 0;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer > 0) return;

        const nearest = engine.findNearestEnemy(engine.player.x, engine.player.y);
        if (!nearest) return;

        const cooldown = this.cooldown / (1 + this.level * 0.08) * engine.player.cooldownMul;
        this.timer = Math.max(0.07, cooldown);

        const dx = nearest.x - engine.player.x;
        const dy = nearest.y - engine.player.y;
        const angle = Math.atan2(dy, dx);
        const damage = (10 + this.level * 4) * engine.player.damageMul;

        const projectileCount = engine.player.runes.has('echo-battery') ? 2 : 1;
        for (let i = 0; i < projectileCount; i++) {
            const spread = projectileCount > 1 ? (i === 0 ? -0.08 : 0.08) : 0;
            engine.projectiles.push(
                new Projectile({
                    x: engine.player.x,
                    y: engine.player.y,
                    vx: Math.cos(angle + spread) * 420,
                    vy: Math.sin(angle + spread) * 420,
                    damage,
                    pierce: 1 + Math.floor(this.level / 3),
                    life: 2,
                    color: '#4facfe',
                    knockback: 170,
                })
            );
        }
    }

    draw() {}
}

export class Garlic implements Weapon {
    id = 'garlic';
    level = 1;
    timer = 0;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = Math.max(0.2, 0.45 * engine.player.cooldownMul);

        const baseRadius = (70 + this.level * 12) * engine.player.aoeMul;
        const radius = engine.player.runes.has('gravity-well') ? baseRadius * 1.2 : baseRadius;
        const damage = (5 + this.level * 2) * engine.player.damageMul;

        const nearby = engine.spatialHash.query(engine.player.x, engine.player.y, radius + 20) as Enemy[];
        for (const enemy of nearby) {
            const dist = Math.hypot(enemy.x - engine.player.x, enemy.y - engine.player.y);
            if (dist <= radius + enemy.radius) {
                if (!enemy.hitCooldown.has('garlic') || enemy.hitCooldown.get('garlic')! <= 0) {
                    enemy.takeDamage(damage, engine, engine.player.x, engine.player.y, 60);
                    enemy.hitCooldown.set('garlic', 0.45);

                    if (engine.player.runes.has('gravity-well')) {
                        const pullDist = Math.max(dist, 1);
                        enemy.x += ((engine.player.x - enemy.x) / pullDist) * 20;
                        enemy.y += ((engine.player.y - enemy.y) / pullDist) * 20;
                    }
                }
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, player: Player) {
        const radius = (70 + this.level * 12) * player.aoeMul;
        ctx.save();
        ctx.translate(player.x - camera.x, player.y - camera.y);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 255, 100, 0.11)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200, 255, 100, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

export class Whip implements Weapon {
    id = 'whip';
    level = 1;
    timer = 0;
    active = false;
    activeTimer = 0;
    direction = 1;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer <= 0) {
            this.timer = Math.max(0.4, 1.2 / (1 + this.level * 0.12) * engine.player.cooldownMul);
            this.active = true;
            this.activeTimer = 0.18;
            this.direction = engine.player.vx < 0 ? -1 : 1;

            const width = 110 + this.level * 22;
            const height = 46;
            const damage = (16 + this.level * 5) * engine.player.damageMul;

            const hx = engine.player.x + (this.direction === 1 ? 0 : -width);
            const hy = engine.player.y - height / 2;

            const nearby = engine.spatialHash.query(hx + width / 2, hy + height / 2, width) as Enemy[];
            for (const enemy of nearby) {
                if (enemy.x > hx && enemy.x < hx + width && enemy.y > hy && enemy.y < hy + height) {
                    if (!enemy.hitCooldown.has('whip') || enemy.hitCooldown.get('whip')! <= 0) {
                        enemy.takeDamage(damage, engine, engine.player.x, engine.player.y, 230);
                        enemy.hitCooldown.set('whip', 0.35);

                        if (engine.player.runes.has('blood-oath')) {
                            engine.player.heal(2 + this.level * 0.5);
                        }
                    }
                }
            }
        }

        if (this.active) {
            this.activeTimer -= dt;
            if (this.activeTimer <= 0) this.active = false;
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, player: Player) {
        if (!this.active) return;
        const width = 110 + this.level * 22;
        const height = 46;
        const x = player.x - camera.x + (this.direction === 1 ? 0 : -width);
        const y = player.y - camera.y - height / 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
        ctx.fillRect(x, y, width, height);
    }
}

export class Bible implements Weapon {
    id = 'bible';
    level = 1;
    angle = 0;

    update(dt: number, engine: GameEngine) {
        this.angle += (3 + this.level * 0.5) * dt;

        const radius = (86 + this.level * 11) * engine.player.aoeMul;
        const count = 2 + Math.floor(this.level / 2);
        const damage = (10 + this.level * 3) * engine.player.damageMul;

        const nearby = engine.spatialHash.query(engine.player.x, engine.player.y, radius + 40) as Enemy[];
        for (let i = 0; i < count; i++) {
            const a = this.angle + (Math.PI * 2 * i) / count;
            const px = engine.player.x + Math.cos(a) * radius;
            const py = engine.player.y + Math.sin(a) * radius;

            for (const enemy of nearby) {
                const dist = Math.hypot(enemy.x - px, enemy.y - py);
                if (dist < 20 + enemy.radius) {
                    if (!enemy.hitCooldown.has('bible') || enemy.hitCooldown.get('bible')! <= 0) {
                        enemy.takeDamage(damage, engine, px, py, 100);
                        enemy.hitCooldown.set('bible', 0.32);
                    }
                }
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, player: Player) {
        const radius = (86 + this.level * 11) * player.aoeMul;
        const count = 2 + Math.floor(this.level / 2);
        ctx.fillStyle = '#f1c40f';

        for (let i = 0; i < count; i++) {
            const a = this.angle + (Math.PI * 2 * i) / count;
            const px = player.x - camera.x + Math.cos(a) * radius;
            const py = player.y - camera.y + Math.sin(a) * radius;
            ctx.beginPath();
            ctx.arc(px, py, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}

export class FrostNova implements Weapon {
    id = 'frost';
    level = 1;
    timer = 0;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer > 0) return;

        this.timer = Math.max(1.2, 3.1 * engine.player.cooldownMul);
        const radius = (130 + this.level * 16) * engine.player.aoeMul;
        const damage = (14 + this.level * 4) * engine.player.damageMul;

        const nearby = engine.spatialHash.query(engine.player.x, engine.player.y, radius + 20) as Enemy[];
        for (const enemy of nearby) {
            const dist = Math.hypot(enemy.x - engine.player.x, enemy.y - engine.player.y);
            if (dist < radius + enemy.radius) {
                enemy.takeDamage(damage, engine, engine.player.x, engine.player.y, 80);
                enemy.slowTimer = engine.player.runes.has('frozen-core') ? 2.2 : 1.4;
            }
        }

        engine.particles.push(new Particle(engine.player.x, engine.player.y, '#74b9ff'));
        engine.particles.push(new Particle(engine.player.x, engine.player.y, '#74b9ff'));
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, player: Player) {
        const radius = (130 + this.level * 16) * player.aoeMul;
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = '#74b9ff';
        ctx.beginPath();
        ctx.arc(player.x - camera.x, player.y - camera.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

export class ChainLightning implements Weapon {
    id = 'chain';
    level = 1;
    timer = 0;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer > 0) return;

        const stormBonus = engine.player.runes.has('storm-sigil') ? 2 : 0;
        this.timer = Math.max(0.2, (1.15 - this.level * 0.04) * engine.player.cooldownMul);

        const hits = 3 + Math.floor(this.level / 2) + stormBonus;
        const damage = (11 + this.level * 3) * engine.player.damageMul;

        const sorted = [...engine.enemies]
            .filter((e) => !e.isDead)
            .sort(
                (a, b) =>
                    Math.hypot(a.x - engine.player.x, a.y - engine.player.y) -
                    Math.hypot(b.x - engine.player.x, b.y - engine.player.y)
            )
            .slice(0, hits);

        if (sorted.length === 0) return;

        let fromX = engine.player.x;
        let fromY = engine.player.y;

        for (const enemy of sorted) {
            enemy.takeDamage(damage, engine, fromX, fromY, 40);
            engine.lightningArcs.push(new LightningArc(fromX, fromY, enemy.x, enemy.y));
            fromX = enemy.x;
            fromY = enemy.y;
        }
    }

    draw() {}
}

export class DroneSwarm implements Weapon {
    id = 'drone';
    level = 1;
    angle = 0;

    update(dt: number, engine: GameEngine) {
        this.angle += dt * (2 + this.level * 0.5);
        const count = 1 + Math.floor(this.level / 2);
        const radius = 52 + this.level * 6;
        const damage = (8 + this.level * 2) * engine.player.damageMul;

        const nearby = engine.spatialHash.query(engine.player.x, engine.player.y, radius + 80) as Enemy[];

        for (let i = 0; i < count; i++) {
            const a = this.angle + (Math.PI * 2 * i) / count;
            const px = engine.player.x + Math.cos(a) * radius;
            const py = engine.player.y + Math.sin(a) * radius;

            for (const enemy of nearby) {
                const dist = Math.hypot(enemy.x - px, enemy.y - py);
                if (dist < 14 + enemy.radius) {
                    if (!enemy.hitCooldown.has(`drone-${i}`) || enemy.hitCooldown.get(`drone-${i}`)! <= 0) {
                        enemy.takeDamage(damage, engine, px, py, 100);
                        enemy.hitCooldown.set(`drone-${i}`, 0.22);
                    }
                }
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, player: Player) {
        const count = 1 + Math.floor(this.level / 2);
        const radius = 52 + this.level * 6;

        ctx.fillStyle = '#1abc9c';
        for (let i = 0; i < count; i++) {
            const a = this.angle + (Math.PI * 2 * i) / count;
            const px = player.x - camera.x + Math.cos(a) * radius;
            const py = player.y - camera.y + Math.sin(a) * radius;
            ctx.beginPath();
            ctx.arc(px, py, 7, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

export class MineLayer implements Weapon {
    id = 'mine';
    level = 1;
    timer = 0;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer > 0) return;

        this.timer = Math.max(0.45, 1.5 * engine.player.cooldownMul);
        const count = 1 + Math.floor(this.level / 3);
        for (let i = 0; i < count; i++) {
            const jitter = (i - (count - 1) / 2) * 14;
            engine.mines.push(new Mine(engine.player.x - engine.player.vx * 0.05 + jitter, engine.player.y - engine.player.vy * 0.05));
        }
    }

    draw() {}
}

export class GameEngine {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    player: Player;
    input: InputManager;
    meta: MetaStats;

    enemies: Enemy[] = [];
    enemyProjectiles: EnemyProjectile[] = [];
    projectiles: Projectile[] = [];
    mines: Mine[] = [];
    gems: Gem[] = [];
    drops: Drop[] = [];
    particles: Particle[] = [];
    floatingTexts: FloatingText[] = [];
    lightningArcs: LightningArc[] = [];
    bossStrikes: BossStrike[] = [];

    spatialHash: SpatialHash = new SpatialHash(100);
    camera = { x: 0, y: 0 };

    director: RunDirector;
    rng: SeededRng;

    runConfig: Required<RunConfig>;
    seed: number;

    currentEncounterName: string = 'Opening Swarm';
    bossPhase: number = 0;
    spawnedBossMinutes = new Set<number>();
    currentBossMinute: number = 0;
    pivotMilestones: number[] = [180, 240, 300, 360, 420];
    triggeredPivotMilestones = new Set<number>();
    lastCrossTime: number = -999;
    crossExhaustTimer: number = 0;
    crossDropCooldownUntil: number = 0;
    bossPunishTimer: number = 0;
    finalBossDoomEndTime: number = 0;
    finalBossPulseTimer: number = 0;
    finalBossLastCountdownSecond: number = -1;

    lastTime: number = 0;
    gameTime: number = 0;
    spawnTimer: number = 0;
    kills: number = 0;
    gold: number = 0;

    isPaused: boolean = false;
    isGameOver: boolean = false;
    animationFrame: number = 0;
    shakeIntensity: number = 0;
    upgradeActive: boolean = false;
    upgradeRewards: UpgradeOption[] = [];
    chestActive: boolean = false;
    chestRewards: UpgradeOption[] = [];

    onStateChange: (state: GameState) => void;
    onLevelUp: (options: UpgradeOption[]) => void;

    constructor(
        canvas: HTMLCanvasElement,
        meta: MetaStats,
        onStateChange: (state: GameState) => void,
        onLevelUp: (options: UpgradeOption[]) => void
    ) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.meta = meta;
        this.onStateChange = onStateChange;
        this.onLevelUp = onLevelUp;

        this.input = new InputManager('desktop');
        this.input.attach();

        this.player = new Player(meta);

        const defaultConfig: Required<RunConfig> = {
            seed: Date.now(),
            difficulty: 'veteran',
            durationSec: 720,
            inputMode: 'desktop',
        };
        this.seed = normalizeSeed(defaultConfig.seed);
        this.rng = new SeededRng(this.seed);
        this.runConfig = defaultConfig;
        this.director = new RunDirector(ENCOUNTER_DEFS, BOSS_DEFS, this.runConfig);

        this.startRun(defaultConfig);
    }

    startRun(config: RunConfig) {
        const resolved: Required<RunConfig> = {
            seed: config.seed ?? Date.now(),
            difficulty: config.difficulty ?? 'veteran',
            durationSec: config.durationSec ?? 720,
            inputMode: config.inputMode ?? 'desktop',
        };

        this.runConfig = resolved;
        this.seed = normalizeSeed(resolved.seed);
        this.rng = new SeededRng(this.seed);
        this.director = new RunDirector(ENCOUNTER_DEFS, BOSS_DEFS, this.runConfig);

        this.player = new Player(this.meta);
        this.player.weapons = [new MagicWand()];

        this.enemies = [];
        this.enemyProjectiles = [];
        this.projectiles = [];
        this.mines = [];
        this.gems = [];
        this.drops = [];
        this.particles = [];
        this.floatingTexts = [];
        this.lightningArcs = [];
        this.bossStrikes = [];
        this.spawnedBossMinutes.clear();
        this.currentBossMinute = 0;
        this.triggeredPivotMilestones.clear();
        this.lastCrossTime = -999;
        this.crossExhaustTimer = 0;
        this.crossDropCooldownUntil = 0;
        this.bossPunishTimer = 0;
        this.finalBossDoomEndTime = 0;
        this.finalBossPulseTimer = 0;
        this.finalBossLastCountdownSecond = -1;

        this.gameTime = 0;
        this.spawnTimer = 0;
        this.kills = 0;
        this.gold = 0;
        this.isPaused = false;
        this.isGameOver = false;
        this.bossPhase = 0;
        this.currentEncounterName = ENCOUNTER_DEFS[0]?.name || 'Opening';
        this.upgradeActive = false;
        this.upgradeRewards = [];
        this.chestActive = false;
        this.chestRewards = [];

        this.setInputMode(resolved.inputMode);
        this.emitState();
    }

    cleanup() {
        this.input.detach();
        cancelAnimationFrame(this.animationFrame);
    }

    setInputMode(mode: PlatformInputMode) {
        this.input.setMode(mode);
        this.emitState();
    }

    setVirtualJoystick(x: number, y: number, active: boolean) {
        this.input.setVirtualJoystick(x, y, active);
    }

    start() {
        sfx.init();
        this.lastTime = performance.now();
        this.animationFrame = requestAnimationFrame(this.loop);

        (window as any).render_game_to_text = () => {
            const payload = {
                coordinate: 'origin at top-left of world space, +x right, +y down',
                time: this.gameTime,
                mode: this.isPaused ? 'paused' : this.isGameOver ? 'gameover' : 'running',
                encounter: this.currentEncounterName,
                bossPhase: this.bossPhase,
                pausedUi: {
                    upgradeActive: this.upgradeActive,
                    upgradeRewards: this.upgradeRewards.length,
                    chestActive: this.chestActive,
                    chestRewards: this.chestRewards.length,
                },
                doomTimer: this.finalBossDoomEndTime > this.gameTime ? this.finalBossDoomEndTime - this.gameTime : 0,
                player: {
                    x: this.player.x,
                    y: this.player.y,
                    vx: this.player.vx,
                    vy: this.player.vy,
                    hp: this.player.hp,
                    maxHp: this.player.maxHp,
                },
                enemies: this.enemies.slice(0, 20).map((e) => ({ x: e.x, y: e.y, hp: e.hp, role: e.role, boss: e.isBoss })),
                projectiles: this.projectiles.length,
                drops: this.drops.length,
                build: this.getBuildSnapshot(),
            };
            return JSON.stringify(payload);
        };

        (window as any).advanceTime = (ms: number) => {
            const steps = Math.max(1, Math.round(ms / (1000 / 60)));
            for (let i = 0; i < steps; i++) {
                if (!this.isPaused && !this.isGameOver) this.update(1 / 60);
            }
            this.draw();
        };
    }

    applyPlayerChoice(choiceId: string) {
        this.applyUpgrade(choiceId);
    }

    getBuildSnapshot(): BuildSnapshot {
        return {
            seed: this.seed,
            weapons: this.player.weapons.map((w) => ({ id: w.id, level: w.level })),
            passives: Object.entries(this.player.passives).map(([id, level]) => ({ id, level })),
            runes: [...this.player.runes],
            tags: this.player.getTags(),
        };
    }

    shake(amount: number) {
        this.shakeIntensity = Math.max(this.shakeIntensity, amount);
    }

    getIncomingDamageMultiplier(): number {
        let mul = 1;
        if (this.crossExhaustTimer > 0) mul *= 1.2;
        if (this.bossPunishTimer > 0) mul *= 1.25;
        return mul;
    }

    applyBossPunish(duration: number) {
        this.bossPunishTimer = Math.max(this.bossPunishTimer, duration);
    }

    spawnBossStrike(owner: Enemy, x: number, y: number, phase: number) {
        const baseRadius = phase === 1 ? 70 : phase === 2 ? 92 : 114;
        const baseTelegraph = phase === 1 ? 0.9 : phase === 2 ? 0.78 : 0.65;
        const radius = owner.isFinalBoss ? baseRadius * 1.28 : baseRadius;
        const telegraph = owner.isFinalBoss ? Math.max(0.28, baseTelegraph * 0.74) : baseTelegraph;
        this.bossStrikes.push(new BossStrike(owner, x, y, radius, telegraph));
        if (phase >= 2) {
            this.floatingTexts.push(new FloatingText(x, y - radius - 8, 'DODGE', '#ff7675'));
        }
    }

    private handleBossPhaseShift(boss: Enemy, phase: number) {
        this.shake(6 + phase * 1.6);
        this.floatingTexts.push(new FloatingText(this.player.x, this.player.y - 84, `BOSS PHASE ${phase}`, '#ff7675'));

        const base = Math.atan2(this.player.y - boss.y, this.player.x - boss.x);
        const spread = phase >= 3 ? [-0.72, -0.28, 0.28, 0.72] : [-0.42, 0, 0.42];
        const dist = phase >= 3 ? 90 : 78;
        for (const offset of spread) {
            const tx = this.player.x + Math.cos(base + offset) * dist;
            const ty = this.player.y + Math.sin(base + offset) * dist;
            this.spawnBossStrike(boss, tx, ty, phase);
        }
    }

    private applyFinalBossPressure(dt: number, boss: Enemy) {
        if (this.finalBossDoomEndTime <= 0) {
            this.finalBossDoomEndTime = this.gameTime + 85;
            this.finalBossPulseTimer = 1.2;
            this.finalBossLastCountdownSecond = -1;
        }

        const remain = this.finalBossDoomEndTime - this.gameTime;
        if (remain <= 0) {
            this.player.takeDamage(this.player.maxHp * 8, 1);
            this.floatingTexts.push(new FloatingText(this.player.x, this.player.y - 36, 'ANNIHILATED', '#ff3b30'));
            this.isGameOver = true;
            return;
        }

        if (boss.vulnerableTimer <= 0) {
            boss.hp = Math.min(boss.maxHp, boss.hp + boss.maxHp * 0.0018 * dt);
        }

        this.finalBossPulseTimer -= dt;
        if (this.finalBossPulseTimer <= 0) {
            const phase = Math.max(1, boss.getBossPhase());
            const count = phase === 1 ? 6 : phase === 2 ? 8 : 10;
            const ring = phase === 1 ? 130 : phase === 2 ? 156 : 182;
            const spin = this.gameTime * 1.1;
            for (let i = 0; i < count; i++) {
                const angle = spin + (i / count) * Math.PI * 2;
                const tx = this.player.x + Math.cos(angle) * ring;
                const ty = this.player.y + Math.sin(angle) * ring;
                this.spawnBossStrike(boss, tx, ty, phase);
            }
            this.finalBossPulseTimer = Math.max(0.68, 1.65 - phase * 0.22);
        }

        if (remain < 20) {
            this.player.takeDamage(10 * dt * this.getIncomingDamageMultiplier(), dt);
        }

        const secLeft = Math.ceil(remain);
        if (secLeft !== this.finalBossLastCountdownSecond && secLeft <= 30 && secLeft % 5 === 0) {
            this.finalBossLastCountdownSecond = secLeft;
            this.floatingTexts.push(new FloatingText(this.player.x, this.player.y - 88, `DOOM ${secLeft}s`, '#ff3b30'));
        }
    }

    private tryTriggerMidgamePivot(): boolean {
        for (const mark of this.pivotMilestones) {
            if (this.gameTime < mark || this.triggeredPivotMilestones.has(mark)) continue;
            this.triggeredPivotMilestones.add(mark);
            const options = this.getPivotOptions(mark);
            if (options.length === 0) return false;

            this.isPaused = true;
            this.upgradeActive = true;
            this.upgradeRewards = options;
            this.chestActive = false;
            this.chestRewards = [];
            try {
                this.onLevelUp(options);
            } catch (err) {
                console.error('onLevelUp callback failed at pivot', err);
            }
            this.floatingTexts.push(
                new FloatingText(this.player.x, this.player.y - 64, `TACTICAL PIVOT ${Math.floor(mark / 60)}:00`, '#f1c40f')
            );
            return true;
        }
        return false;
    }

    private getPivotOptions(mark: number): UpgradeOption[] {
        const hasAssault = this.player.runes.has('pivot:assault-core');
        const hasControl = this.player.runes.has('pivot:control-core');
        const hasSustain = this.player.runes.has('pivot:sustain-core');

        if (mark === 180) {
            return [
                {
                    id: 'pivot:assault-core',
                    name: 'Assault Core',
                    desc: '+35% damage, -22% max HP, +8% speed',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
                {
                    id: 'pivot:control-core',
                    name: 'Control Core',
                    desc: 'Unlock Frost, +35% radius, -12% speed',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
                {
                    id: 'pivot:sustain-core',
                    name: 'Sustain Core',
                    desc: '+30% max HP, +1.2 regen, -14% damage',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
            ];
        }

        if (mark === 240) {
            return [
                {
                    id: 'pivot:tempo-spike',
                    name: 'Tempo Spike',
                    desc: '+20% speed, -18% cooldown, -20% max HP',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
                {
                    id: 'pivot:zone-anchor',
                    name: 'Zone Anchor',
                    desc: '+28% radius, +1 armor, -12% speed',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
                {
                    id: 'pivot:drain-circuit',
                    name: 'Drain Circuit',
                    desc: '+3% lifesteal, +1 regen, -12% damage',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
            ];
        }

        if (mark === 300 && hasAssault) {
            return [
                { id: 'pivot:assault-blitz', name: 'Blitz Chain', desc: '+20% speed, +18% damage, -1 armor', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:assault-omega', name: 'Omega Burst', desc: '+30% damage, +1 chain hit, -16% max HP', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:assault-echo', name: 'Echo Reflex', desc: 'Unlock Drone, -14% cooldown, -8% regen', type: 'rune', isNew: true, level: 1 },
            ];
        }

        if (mark === 300 && hasControl) {
            return [
                { id: 'pivot:control-prison', name: 'Prison Field', desc: '+25% radius, stronger slows, -10% damage', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:control-cascade', name: 'Cascade', desc: 'Unlock Chain, +16% cooldown rate, -12% max HP', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:control-null', name: 'Null Step', desc: '+14% speed, +12% damage, -0.7 regen', type: 'rune', isNew: true, level: 1 },
            ];
        }

        if (mark === 300 && hasSustain) {
            return [
                { id: 'pivot:sustain-bastion', name: 'Bastion', desc: '+2 armor, +10 thorns, -10% speed', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:sustain-drain', name: 'Drain Loop', desc: '+4% lifesteal, +12% damage, -14% max HP', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:sustain-pact', name: 'Blood Pact+', desc: 'Unlock Whip, +20% regen, -10% cooldown', type: 'rune', isNew: true, level: 1 },
            ];
        }

        if (mark === 360) {
            return [
                {
                    id: 'pivot:glass-cannon',
                    name: 'Glass Cannon',
                    desc: '+32% damage, -1.4 armor, -10% max HP',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
                {
                    id: 'pivot:bulwark-shift',
                    name: 'Bulwark Shift',
                    desc: '+24% max HP, +1.2 armor, +12% cooldown',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
                {
                    id: 'pivot:tempo-inversion',
                    name: 'Tempo Inversion',
                    desc: '-18% cooldown, +18% speed, -0.9 regen',
                    type: 'rune',
                    isNew: true,
                    level: 1,
                },
            ];
        }

        if (mark === 420) {
            return [
                { id: 'pivot:final-overclock', name: 'Final Overclock', desc: '+28% damage, +12% speed, +25% incoming damage', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:final-warden', name: 'Final Warden', desc: '+26% max HP, +1.4 regen, -10% damage', type: 'rune', isNew: true, level: 1 },
                { id: 'pivot:final-arcanum', name: 'Final Arcanum', desc: '+22% radius, -16% cooldown, -0.8 armor', type: 'rune', isNew: true, level: 1 },
            ];
        }

        return [];
    }

    private applyPivotChoice(id: string) {
        this.player.runes.add(id);

        if (id === 'pivot:assault-core') {
            this.player.damageMul *= 1.35;
            this.player.speed *= 1.08;
            this.player.maxHp *= 0.78;
            this.player.hp = Math.min(this.player.hp, this.player.maxHp);
        } else if (id === 'pivot:control-core') {
            this.player.aoeMul *= 1.35;
            this.player.speed *= 0.88;
            if (!this.player.weapons.find((w) => w.id === 'frost')) this.player.weapons.push(createWeapon('frost'));
        } else if (id === 'pivot:sustain-core') {
            this.player.maxHp *= 1.3;
            this.player.hp *= 1.15;
            this.player.regen += 1.2;
            this.player.damageMul *= 0.86;
        } else if (id === 'pivot:tempo-spike') {
            this.player.speed *= 1.2;
            this.player.cooldownMul *= 0.82;
            this.player.maxHp *= 0.8;
            this.player.hp = Math.min(this.player.hp, this.player.maxHp);
        } else if (id === 'pivot:zone-anchor') {
            this.player.aoeMul *= 1.28;
            this.player.armorFlat += 1;
            this.player.speed *= 0.88;
        } else if (id === 'pivot:drain-circuit') {
            this.player.lifesteal += 0.03;
            this.player.regen += 1;
            this.player.damageMul *= 0.88;
        } else if (id === 'pivot:assault-blitz') {
            this.player.speed *= 1.2;
            this.player.damageMul *= 1.18;
            this.player.armorFlat = Math.max(0, this.player.armorFlat - 1);
        } else if (id === 'pivot:assault-omega') {
            this.player.damageMul *= 1.3;
            this.player.maxHp *= 0.84;
            this.player.hp = Math.min(this.player.hp, this.player.maxHp);
            if (!this.player.weapons.find((w) => w.id === 'chain')) this.player.weapons.push(createWeapon('chain'));
        } else if (id === 'pivot:assault-echo') {
            this.player.cooldownMul *= 0.86;
            this.player.regen = Math.max(0, this.player.regen - 0.8);
            if (!this.player.weapons.find((w) => w.id === 'drone')) this.player.weapons.push(createWeapon('drone'));
        } else if (id === 'pivot:control-prison') {
            this.player.aoeMul *= 1.25;
            this.player.damageMul *= 0.9;
        } else if (id === 'pivot:control-cascade') {
            this.player.cooldownMul *= 0.84;
            this.player.maxHp *= 0.88;
            this.player.hp = Math.min(this.player.hp, this.player.maxHp);
            if (!this.player.weapons.find((w) => w.id === 'chain')) this.player.weapons.push(createWeapon('chain'));
        } else if (id === 'pivot:control-null') {
            this.player.speed *= 1.14;
            this.player.damageMul *= 1.12;
            this.player.regen = Math.max(0, this.player.regen - 0.7);
        } else if (id === 'pivot:sustain-bastion') {
            this.player.armorFlat += 2;
            this.player.thorns += 10;
            this.player.speed *= 0.9;
        } else if (id === 'pivot:sustain-drain') {
            this.player.lifesteal += 0.04;
            this.player.damageMul *= 1.12;
            this.player.maxHp *= 0.86;
            this.player.hp = Math.min(this.player.hp, this.player.maxHp);
        } else if (id === 'pivot:sustain-pact') {
            this.player.regen *= 1.2;
            this.player.cooldownMul *= 0.9;
            if (!this.player.weapons.find((w) => w.id === 'whip')) this.player.weapons.push(createWeapon('whip'));
        } else if (id === 'pivot:glass-cannon') {
            this.player.damageMul *= 1.32;
            this.player.armorFlat = Math.max(0, this.player.armorFlat - 1.4);
            this.player.maxHp *= 0.9;
            this.player.hp = Math.min(this.player.hp, this.player.maxHp);
        } else if (id === 'pivot:bulwark-shift') {
            this.player.maxHp *= 1.24;
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.15);
            this.player.armorFlat += 1.2;
            this.player.cooldownMul *= 1.12;
        } else if (id === 'pivot:tempo-inversion') {
            this.player.cooldownMul *= 0.82;
            this.player.speed *= 1.18;
            this.player.regen = Math.max(0, this.player.regen - 0.9);
        } else if (id === 'pivot:final-overclock') {
            this.player.damageMul *= 1.28;
            this.player.speed *= 1.12;
            this.crossExhaustTimer = Math.max(this.crossExhaustTimer, 8);
        } else if (id === 'pivot:final-warden') {
            this.player.maxHp *= 1.26;
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.2);
            this.player.regen += 1.4;
            this.player.damageMul *= 0.9;
        } else if (id === 'pivot:final-arcanum') {
            this.player.aoeMul *= 1.22;
            this.player.cooldownMul *= 0.84;
            this.player.armorFlat = Math.max(0, this.player.armorFlat - 0.8);
        }
    }

    private loop = (time: number) => {
        const dt = Math.min((time - this.lastTime) / 1000, 0.1);
        this.lastTime = time;

        if (!this.isPaused && !this.isGameOver) {
            this.update(dt);
        } else if (this.isPaused && !this.isGameOver) {
            this.ensurePauseConsistency();
        }
        this.draw();

        this.animationFrame = requestAnimationFrame(this.loop);
    };

    private ensurePauseConsistency() {
        const hasUpgradeModal = this.upgradeActive && this.upgradeRewards.length > 0;
        const hasChestModal = this.chestActive && this.chestRewards.length > 0;
        if (hasUpgradeModal || hasChestModal) return;

        // Safety net: never keep the run paused without a visible actionable modal.
        this.upgradeActive = false;
        this.upgradeRewards = [];
        this.chestActive = false;
        this.chestRewards = [];
        this.isPaused = false;
        this.emitState();
    }

    private update(dt: number) {
        this.gameTime += dt;
        if (this.crossExhaustTimer > 0) this.crossExhaustTimer -= dt;
        if (this.bossPunishTimer > 0) this.bossPunishTimer -= dt;

        if (this.shakeIntensity > 0) {
            this.shakeIntensity -= dt * 10;
            if (this.shakeIntensity < 0) this.shakeIntensity = 0;
        }

        if (this.player.regen > 0) {
            this.player.heal(this.player.regen * dt);
        }

        const movement = this.input.getMovementVector();
        const lowHpBerserk = this.player.runes.has('berserker-loop') && this.player.hp < this.player.maxHp * 0.35 ? 1.22 : 1;
        const speed = this.player.speed * lowHpBerserk;

        this.player.vx = movement.x * speed;
        this.player.vy = movement.y * speed;
        this.player.x += this.player.vx * dt;
        this.player.y += this.player.vy * dt;

        this.camera.x = this.player.x - this.canvas.width / 2;
        this.camera.y = this.player.y - this.canvas.height / 2;

        const encounter = this.director.getEncounterAt(this.gameTime);
        const bossAtTickStart = this.enemies.find((enemy) => enemy.isBoss && !enemy.isDead) || null;
        this.currentEncounterName = bossAtTickStart
            ? bossAtTickStart.isFinalBoss
                ? 'Final Boss · Doom Snake King'
                : `Boss Battle · Minute ${this.currentBossMinute || Math.max(1, Math.floor(this.gameTime / 60))}`
            : encounter.name;

        if (this.tryTriggerMidgamePivot()) {
            this.emitState();
            return;
        }

        const minuteIndex = Math.floor(this.gameTime / 60);
        if (minuteIndex >= 1 && !this.spawnedBossMinutes.has(minuteIndex)) {
            this.beginMinuteBossBattle(minuteIndex);
            this.spawnedBossMinutes.add(minuteIndex);
            this.currentEncounterName = `Boss Battle · Minute ${minuteIndex}`;
        }

        const hasActiveBoss = this.enemies.some((enemy) => enemy.isBoss && !enemy.isDead);
        if (!hasActiveBoss) {
            this.spawnTimer -= dt;
            if (this.spawnTimer <= 0) {
                this.spawnTimer = this.director.getSpawnInterval(encounter);
                this.spawnEncounterWave(encounter);
            }
        }

        this.spatialHash.clear();
        for (const enemy of this.enemies) {
            if (!enemy.isBossSegment) this.spatialHash.insert(enemy);
        }

        for (const weapon of this.player.weapons) {
            weapon.update(dt, this);
        }

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            enemy.update(dt, this);
            if (enemy.isDead) this.enemies.splice(i, 1);
        }

        for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
            const projectile = this.enemyProjectiles[i];
            projectile.update(dt, this);
            if (projectile.isDead) this.enemyProjectiles.splice(i, 1);
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            projectile.update(dt, this);
            if (projectile.isDead) this.projectiles.splice(i, 1);
        }

        for (let i = this.mines.length - 1; i >= 0; i--) {
            const mine = this.mines[i];
            mine.update(dt, this);
            if (mine.isDead) this.mines.splice(i, 1);
        }

        for (let i = this.gems.length - 1; i >= 0; i--) {
            const gem = this.gems[i];
            const dist = Math.hypot(gem.x - this.player.x, gem.y - this.player.y);
            if (dist < this.player.pickupRadius) {
                if (dist < 15) {
                    sfx.gem();
                    this.player.xp += gem.value;
                    this.gems.splice(i, 1);
                    this.maybeTriggerLevelUp();
                    continue;
                }

                if (dist > 0.0001) {
                    const speedPull = 520 * dt;
                    gem.x += ((this.player.x - gem.x) / dist) * speedPull;
                    gem.y += ((this.player.y - gem.y) / dist) * speedPull;
                }
            }
        }

        for (let i = this.drops.length - 1; i >= 0; i--) {
            const drop = this.drops[i];
            const dist = Math.hypot(drop.x - this.player.x, drop.y - this.player.y);
            if (dist < this.player.pickupRadius) {
                if (dist < 20) {
                    this.collectDrop(drop);
                    this.drops.splice(i, 1);
                    continue;
                }

                if (dist > 0.0001) {
                    const speedPull = 520 * dt;
                    drop.x += ((this.player.x - drop.x) / dist) * speedPull;
                    drop.y += ((this.player.y - drop.y) / dist) * speedPull;
                }
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update(dt);
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const f = this.floatingTexts[i];
            f.update(dt);
            if (f.life <= 0) this.floatingTexts.splice(i, 1);
        }

        for (let i = this.lightningArcs.length - 1; i >= 0; i--) {
            const arc = this.lightningArcs[i];
            arc.update(dt);
            if (arc.life <= 0) this.lightningArcs.splice(i, 1);
        }

        for (let i = this.bossStrikes.length - 1; i >= 0; i--) {
            const strike = this.bossStrikes[i];
            strike.update(dt, this);
            if (strike.isDead) this.bossStrikes.splice(i, 1);
        }

        if (this.particles.length > 550) this.particles.splice(0, this.particles.length - 550);
        if (this.floatingTexts.length > 220) this.floatingTexts.splice(0, this.floatingTexts.length - 220);
        if (this.enemyProjectiles.length > 220) this.enemyProjectiles.splice(0, this.enemyProjectiles.length - 220);
        if (this.projectiles.length > 320) this.projectiles.splice(0, this.projectiles.length - 320);

        const previousBossPhase = this.bossPhase;
        this.bossPhase = 0;
        let bossAlive = false;
        let activeBoss: Enemy | null = null;
        for (const enemy of this.enemies) {
            if (enemy.isBoss) {
                bossAlive = true;
                this.bossPhase = Math.max(this.bossPhase, enemy.getBossPhase());
                if (!activeBoss) activeBoss = enemy;
            }
        }
        if (bossAlive && activeBoss && this.bossPhase > 1 && this.bossPhase !== previousBossPhase) {
            this.handleBossPhaseShift(activeBoss, this.bossPhase);
        }
        if (bossAlive && activeBoss?.isFinalBoss) {
            this.applyFinalBossPressure(dt, activeBoss);
        }
        if (!bossAlive) {
            this.currentBossMinute = 0;
            this.bossStrikes = [];
            this.finalBossDoomEndTime = 0;
            this.finalBossPulseTimer = 0;
            this.finalBossLastCountdownSecond = -1;
            for (const enemy of this.enemies) {
                if (enemy.isBossSegment) enemy.isDead = true;
            }
        }

        if (this.player.hp <= 0) {
            this.isGameOver = true;
        }

        const duration = this.director.getRunDuration();
        if (this.gameTime > duration + 20 && this.enemies.every((e) => !e.isBoss)) {
            this.isGameOver = true;
        }

        this.emitState();
    }

    private spawnEncounterWave(encounter: EncounterDef) {
        if (this.enemies.length > 300) return;
        const batch = this.director.getSpawnBatch(encounter, this.rng);

        for (let i = 0; i < batch; i++) {
            if (this.enemies.length > 340) break;
            const role = this.director.pickRole(encounter, this.rng) as EnemyRole;
            const elite = this.rng.next() < 0.03 + this.gameTime / 2400;
            const length = role === 'splitter' ? 3 : role === 'summoner' ? 4 : 5 + Math.floor(this.gameTime / 90);
            this.spawnSnake(role, elite, Math.min(length, 10));
        }
    }

    private spawnSnake(role: EnemyRole, isElite: boolean, length: number) {
        const angle = this.rng.next() * Math.PI * 2;
        const dist = Math.max(this.canvas.width, this.canvas.height) / 2 + 130;
        const startX = this.player.x + Math.cos(angle) * dist;
        const startY = this.player.y + Math.sin(angle) * dist;

        let leader: Enemy | null = null;
        const hpScale = this.director.getEnemyHpScale() * (1 + this.gameTime / 420);

        for (let i = 0; i < length; i++) {
            const enemy = new Enemy({
                x: startX - Math.cos(angle) * i * 20,
                y: startY - Math.sin(angle) * i * 20,
                leader,
                isHead: i === 0,
                role,
                hpScale,
                isElite,
            });
            this.enemies.push(enemy);
            leader = enemy;
        }
    }

    private beginMinuteBossBattle(minuteIndex: number) {
        this.currentBossMinute = minuteIndex;
        this.enemies = [];
        this.enemyProjectiles = [];
        this.spawnTimer = 1.4;

        const base = BOSS_DEFS[0] || {
            id: 'snake-king',
            name: 'Snake King',
            spawnTime: 60,
            hp: 1600,
            speed: 95,
            radius: 34,
            color: '#e74c3c',
            phases: 3,
        };
        this.spawnBoss(base, minuteIndex);
    }

    private spawnBoss(def: BossDef, minuteIndex: number) {
        const angle = this.rng.next() * Math.PI * 2;
        const dist = Math.max(this.canvas.width, this.canvas.height) / 2 + 180;
        const x = this.player.x + Math.cos(angle) * dist;
        const y = this.player.y + Math.sin(angle) * dist;
        const isFinalBoss = minuteIndex >= 12;

        const statScale = 1 + (minuteIndex - 1) * 0.2;
        const scaledBoss: BossDef = {
            ...def,
            hp: def.hp * statScale * (isFinalBoss ? 28 : 1),
            speed: def.speed * Math.min(isFinalBoss ? 2.4 : 1.6, 1 + (minuteIndex - 1) * (isFinalBoss ? 0.06 : 0.03)),
            radius: def.radius + (isFinalBoss ? 10 : 0),
            color: isFinalBoss ? '#ff3b30' : def.color,
        };

        const boss = new Enemy({
            x,
            y,
            leader: null,
            isHead: true,
            role: 'boss',
            hpScale: this.director.getEnemyHpScale(),
            boss: scaledBoss,
        });
        boss.isFinalBoss = isFinalBoss;
        boss.bossStrikeTimer = isFinalBoss ? 1 : 2.8;
        boss.rangedTimer = isFinalBoss ? 0.35 : 0.7;

        this.enemies.push(boss);

        let leader: Enemy = boss;
        const segmentCount = isFinalBoss ? 180 + Math.min(40, minuteIndex * 2) : 110 + Math.min(50, minuteIndex * 2);
        for (let i = 0; i < segmentCount; i++) {
            const seg = new Enemy({
                x: x - Math.cos(angle) * (i + 1) * 14,
                y: y - Math.sin(angle) * (i + 1) * 14,
                leader,
                isHead: false,
                role: 'boss_segment',
                hpScale: this.director.getEnemyHpScale(),
            });
            seg.speed = scaledBoss.speed * 1.03;
            seg.radius = Math.max(8, scaledBoss.radius - 8 - Math.floor(i / 25));
            seg.color = i % 2 === 0 ? '#c0392b' : '#e74c3c';
            this.enemies.push(seg);
            leader = seg;
        }

        this.shake(8);
        this.floatingTexts.push(
            new FloatingText(
                this.player.x,
                this.player.y - 80,
                isFinalBoss ? `DOOM SNAKE KING · MINUTE ${minuteIndex}` : `${scaledBoss.name} · Minute ${minuteIndex}`,
                isFinalBoss ? '#ff3b30' : '#f1c40f'
            )
        );
        this.floatingTexts.push(
            new FloatingText(this.player.x, this.player.y - 56, `Snake body ${segmentCount + 1} segments`, '#ffffff')
        );
        if (isFinalBoss) {
            this.finalBossDoomEndTime = this.gameTime + 85;
            this.finalBossPulseTimer = 1.2;
            this.finalBossLastCountdownSecond = -1;
            this.floatingTexts.push(new FloatingText(this.player.x, this.player.y - 32, 'SURVIVE 85s OR DIE', '#ff3b30'));
        }
    }

    spawnSummoned(x: number, y: number) {
        if (this.enemies.length > 340) return;
        this.enemies.push(
            new Enemy({
                x: x + (this.rng.next() - 0.5) * 50,
                y: y + (this.rng.next() - 0.5) * 50,
                leader: null,
                isHead: true,
                role: 'stalker',
                hpScale: this.director.getEnemyHpScale() * 0.8,
            })
        );
    }

    spawnSplitChildren(enemy: Enemy) {
        for (let i = 0; i < 2; i++) {
            this.enemies.push(
                new Enemy({
                    x: enemy.x + (i === 0 ? -10 : 10),
                    y: enemy.y + (i === 0 ? 8 : -8),
                    leader: null,
                    isHead: true,
                    role: 'stalker',
                    hpScale: this.director.getEnemyHpScale() * 0.6,
                })
            );
        }
    }

    private collectDrop(drop: Drop) {
        if (drop.type === 'chicken') {
            sfx.powerup();
            this.player.heal(34);
            this.floatingTexts.push(new FloatingText(this.player.x, this.player.y, '+34', '#2ecc71'));
            return;
        }

        if (drop.type === 'magnet') {
            sfx.powerup();
            for (const gem of this.gems) {
                this.player.xp += gem.value;
            }
            this.gems = [];
            this.maybeTriggerLevelUp();
            return;
        }

        if (drop.type === 'cross') {
            sfx.explosion();
            this.shake(10);
            const fatigue = this.gameTime - this.lastCrossTime < 55 ? 0.5 : 1;
            this.lastCrossTime = this.gameTime;
            this.crossDropCooldownUntil = this.gameTime + 70;

            const targets = this.enemies.filter((enemy) => !enemy.isDead);
            let downed = 0;
            let bonusXp = 0;
            for (const enemy of targets) {
                if (enemy.isBossSegment) continue;

                const ratio = enemy.isBoss ? 0.04 : enemy.isElite ? 0.14 : 0.3;
                const damage = enemy.maxHp * ratio * fatigue;
                enemy.hp -= damage;
                enemy.flashTimer = Math.max(enemy.flashTimer, 0.1);

                if (enemy.hp <= 0) {
                    enemy.isDead = true;
                    downed++;
                    this.kills++;
                    if (!enemy.isBoss) bonusXp += enemy.isHead ? 1.5 : 0.6;
                } else {
                    enemy.slowTimer = Math.max(enemy.slowTimer, 1.15);
                }
            }

            const xpCap = 26 + Math.floor(this.gameTime / 36);
            this.player.xp += Math.min(xpCap, Math.floor(bonusXp));
            this.enemyProjectiles = this.enemyProjectiles.slice(-40);
            this.crossExhaustTimer = 8;
            this.floatingTexts.push(new FloatingText(this.player.x, this.player.y - 26, `Cross Burn ${downed}`, '#f1c40f'));
            this.floatingTexts.push(new FloatingText(this.player.x, this.player.y - 46, 'Overload: +20% damage taken', '#ff7675'));
            this.maybeTriggerLevelUp();
            return;
        }

        if (drop.type === 'gold') {
            sfx.gold();
            this.gold += Math.floor(10 * (1 + this.meta.greed * 0.2));
            return;
        }

        if (drop.type === 'chest') {
            sfx.chestOpen();
            this.triggerChest();
        }
    }

    private triggerLevelUp() {
        sfx.levelUp();
        this.player.xp -= this.player.xpToNext;
        this.player.level++;
        this.player.xpToNext = Math.floor(this.player.xpToNext * 1.45 + 5);
        this.upgradeActive = false;
        this.upgradeRewards = [];
        this.chestActive = false;
        this.chestRewards = [];
        const options = this.getUpgradeOptions(3);
        if (options.length === 0) {
            this.isPaused = false;
            return;
        }
        this.isPaused = true;
        this.upgradeActive = true;
        this.upgradeRewards = options;
        try {
            this.onLevelUp(options);
        } catch (err) {
            console.error('onLevelUp callback failed at level up', err);
        }
    }

    private maybeTriggerLevelUp() {
        if (!this.isPaused && this.player.xp >= this.player.xpToNext) {
            this.triggerLevelUp();
        }
    }

    private triggerChest() {
        const options = this.getUpgradeOptions(1);
        if (options.length === 0) {
            this.upgradeActive = false;
            this.upgradeRewards = [];
            this.chestActive = false;
            this.chestRewards = [];
            this.isPaused = false;
            this.emitState();
            return;
        }
        this.isPaused = true;
        this.upgradeActive = false;
        this.upgradeRewards = [];
        this.chestActive = true;
        this.chestRewards = options;
        this.emitState();
    }

    private getUpgradeOptions(count: number): UpgradeOption[] {
        const options: UpgradeOption[] = [];

        const pool: UpgradeOption[] = [];

        for (const weapon of WEAPON_DEFS) {
            const existing = this.player.weapons.find((w) => w.id === weapon.id);
            pool.push({
                id: weapon.id,
                name: weapon.name,
                desc: weapon.desc,
                type: 'weapon',
                isNew: !existing,
                level: existing ? existing.level + 1 : 1,
            });
        }

        for (const passive of PASSIVE_DEFS) {
            const level = this.player.passives[passive.id] || 0;
            pool.push({
                id: passive.id,
                name: passive.name,
                desc: passive.desc,
                type: 'passive',
                isNew: level === 0,
                level: level + 1,
            });
        }

        const tags = new Set(this.player.getTags());
        for (const rune of RUNE_DEFS) {
            if (this.player.runes.has(rune.id)) continue;
            const unlocked = rune.requires.every((req) => tags.has(req));
            if (!unlocked) continue;
            pool.push({
                id: rune.id,
                name: rune.name,
                desc: rune.desc,
                type: 'rune',
                isNew: true,
                level: 1,
            });
        }

        shuffleWithRng(pool, this.rng);
        for (let i = 0; i < count && i < pool.length; i++) {
            options.push(pool[i]);
        }

        return options;
    }

    applyUpgrade(id: string) {
        if (id.startsWith('pivot:')) {
            this.applyPivotChoice(id);
        } else if (WEAPON_IDS.has(id)) {
            const existing = this.player.weapons.find((w) => w.id === id);
            if (existing) {
                existing.level++;
            } else {
                this.player.weapons.push(createWeapon(id));
            }
        } else if (PASSIVE_IDS.has(id)) {
            this.player.applyPassive(id);
        } else if (RUNE_IDS.has(id)) {
            this.player.addRune(id);
        }

        this.upgradeActive = false;
        this.upgradeRewards = [];
        this.chestActive = false;
        this.chestRewards = [];
        this.isPaused = false;
        this.maybeTriggerLevelUp();
        this.emitState();
    }

    findNearestEnemy(x: number, y: number): Enemy | null {
        let nearest: Enemy | null = null;
        let minDist = Infinity;

        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            const dist = Math.hypot(enemy.x - x, enemy.y - y);
            if (dist < minDist) {
                minDist = dist;
                nearest = enemy;
            }
        }

        return nearest;
    }

    private emitState() {
        this.onStateChange({
            ...this.buildState(),
            upgradeActive: this.upgradeActive,
            upgradeRewards: [...this.upgradeRewards],
            chestActive: this.chestActive,
            chestRewards: [...this.chestRewards],
        });
    }

    private buildState(): Omit<GameState, 'upgradeActive' | 'upgradeRewards' | 'chestActive' | 'chestRewards'> {
        return {
            hp: this.player.hp,
            maxHp: this.player.maxHp,
            level: this.player.level,
            xp: this.player.xp,
            xpToNext: this.player.xpToNext,
            time: this.gameTime,
            kills: this.kills,
            gold: this.gold,
            isGameOver: this.isGameOver,
            isPaused: this.isPaused,
            currentEncounter: this.currentEncounterName,
            bossPhase: this.bossPhase,
            buildTags: this.player.getTags(),
            inputMode: this.input.getMode(),
            difficultyTier: this.runConfig.difficulty as DifficultyTier,
        };
    }

    private draw() {
        const ctx = this.ctx;

        ctx.save();
        if (this.shakeIntensity > 0) {
            const dx = (Math.random() - 0.5) * this.shakeIntensity;
            const dy = (Math.random() - 0.5) * this.shakeIntensity;
            ctx.translate(dx, dy);
        }

        const gradient = ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        gradient.addColorStop(0, '#14161d');
        gradient.addColorStop(1, '#0b0d14');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.strokeStyle = 'rgba(100, 110, 140, 0.22)';
        ctx.lineWidth = 1;
        const gridSize = 100;
        const startX = ((-this.camera.x % gridSize) + gridSize) % gridSize;
        const startY = ((-this.camera.y % gridSize) + gridSize) % gridSize;

        ctx.beginPath();
        for (let x = startX; x < this.canvas.width; x += gridSize) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvas.height);
        }
        for (let y = startY; y < this.canvas.height; y += gridSize) {
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
        }
        ctx.stroke();

        for (const gem of this.gems) gem.draw(ctx, this.camera);
        for (const drop of this.drops) drop.draw(ctx, this.camera);

        for (const weapon of this.player.weapons) {
            weapon.draw(ctx, this.camera, this.player);
        }

        for (const arc of this.lightningArcs) arc.draw(ctx, this.camera);
        for (const strike of this.bossStrikes) strike.draw(ctx, this.camera);
        for (const mine of this.mines) mine.draw(ctx, this.camera);
        for (const projectile of this.projectiles) projectile.draw(ctx, this.camera);
        for (const enemyProjectile of this.enemyProjectiles) enemyProjectile.draw(ctx, this.camera);

        for (const enemy of this.enemies) {
            ctx.fillStyle = enemy.flashTimer > 0 ? '#ffffff' : enemy.color;
            ctx.beginPath();
            ctx.arc(enemy.x - this.camera.x, enemy.y - this.camera.y, enemy.radius, 0, Math.PI * 2);
            ctx.fill();

            if (enemy.isBoss) {
                const healthRatio = Math.max(0, enemy.hp / enemy.maxHp);
                const width = enemy.radius * 2.6;
                const x = enemy.x - this.camera.x - width / 2;
                const y = enemy.y - this.camera.y - enemy.radius - 16;
                ctx.fillStyle = '#2c3e50';
                ctx.fillRect(x, y, width, 5);
                ctx.fillStyle = enemy.isFinalBoss ? '#ff3b30' : '#e74c3c';
                ctx.fillRect(x, y, width * healthRatio, 5);
                if (enemy.isFinalBoss) {
                    ctx.fillStyle = '#ffb3ab';
                    ctx.font = 'bold 10px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText('DOOM', enemy.x - this.camera.x, y - 4);
                }

                if (enemy.vulnerableTimer > 0) {
                    ctx.strokeStyle = '#74b9ff';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(enemy.x - this.camera.x, enemy.y - this.camera.y, enemy.radius + 6, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.fillStyle = '#74b9ff';
                    ctx.font = 'bold 11px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText('OPEN', enemy.x - this.camera.x, enemy.y - this.camera.y - enemy.radius - 22);
                }
            }
        }

        ctx.fillStyle = '#4aa3df';
        ctx.beginPath();
        ctx.arc(this.player.x - this.camera.x, this.player.y - this.camera.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (this.bossPunishTimer > 0) {
            ctx.strokeStyle = 'rgba(231, 76, 60, 0.9)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.player.x - this.camera.x, this.player.y - this.camera.y, 21, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (this.finalBossDoomEndTime > this.gameTime && this.currentBossMinute >= 12) {
            const remain = Math.ceil(this.finalBossDoomEndTime - this.gameTime);
            ctx.fillStyle = '#ff3b30';
            ctx.font = 'bold 16px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`DOOM TIMER ${remain}s`, this.canvas.width / 2, 58);
        }

        for (const particle of this.particles) particle.draw(ctx, this.camera);
        for (const text of this.floatingTexts) text.draw(ctx, this.camera);

        ctx.restore();
    }
}

function roleBaseStats(role: EnemyRole): { hp: number; speed: number; radius: number; color: string } {
    if (role === 'boss_segment') return { hp: 99999, speed: 100, radius: 12, color: '#e74c3c' };
    if (role === 'charger') return { hp: 14, speed: 110, radius: 13, color: '#e67e22' };
    if (role === 'ranged') return { hp: 16, speed: 80, radius: 13, color: '#9b59b6' };
    if (role === 'summoner') return { hp: 20, speed: 72, radius: 14, color: '#16a085' };
    if (role === 'shield') return { hp: 28, speed: 66, radius: 16, color: '#95a5a6' };
    if (role === 'splitter') return { hp: 12, speed: 95, radius: 12, color: '#2ecc71' };
    if (role === 'encircler') return { hp: 15, speed: 90, radius: 13, color: '#f39c12' };
    if (role === 'boss') return { hp: 900, speed: 90, radius: 32, color: '#e74c3c' };
    return { hp: 13, speed: 88, radius: 13, color: '#e74c3c' };
}

function createWeapon(id: string): Weapon {
    if (id === 'wand') return new MagicWand();
    if (id === 'garlic') return new Garlic();
    if (id === 'whip') return new Whip();
    if (id === 'bible') return new Bible();
    if (id === 'frost') return new FrostNova();
    if (id === 'chain') return new ChainLightning();
    if (id === 'drone') return new DroneSwarm();
    if (id === 'mine') return new MineLayer();
    return new MagicWand();
}

function shuffleWithRng<T>(arr: T[], rng: SeededRng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}
