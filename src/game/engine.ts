import { GameState, UpgradeOption, MetaStats } from './types';
import { sfx } from './audio';

export const UPGRADE_POOL: UpgradeOption[] = [
    { id: 'wand', name: 'Magic Wand', desc: 'Fires projectiles at nearest enemy', type: 'weapon', isNew: true, level: 1 },
    { id: 'garlic', name: 'Garlic', desc: 'Damages nearby enemies', type: 'weapon', isNew: true, level: 1 },
    { id: 'whip', name: 'Whip', desc: 'Attacks horizontally', type: 'weapon', isNew: true, level: 1 },
    { id: 'bible', name: 'King Bible', desc: 'Orbiting books', type: 'weapon', isNew: true, level: 1 },
    { id: 'speed', name: 'Boots', desc: 'Increases movement speed by 20%', type: 'stat', isNew: true, level: 1 },
    { id: 'maxhp', name: 'Heart', desc: 'Increases max HP by 50', type: 'stat', isNew: true, level: 1 },
    { id: 'regen', name: 'Regen', desc: 'Regenerates 1 HP per second', type: 'stat', isNew: true, level: 1 },
];

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
    speed: number = 150;
    hp: number = 100;
    maxHp: number = 100;
    regen: number = 0;
    level: number = 1;
    xp: number = 0;
    xpToNext: number = 10;
    pickupRadius: number = 60;
    weapons: Weapon[] = [];
    stats: Record<string, number> = {
        speed: 1,
        maxhp: 1,
        regen: 1
    };
    meta: MetaStats;

    constructor(meta: MetaStats) {
        this.meta = meta;
        this.speed *= (1 + meta.speed * 0.1);
        this.pickupRadius *= (1 + meta.magnet * 0.2);
    }

    takeDamage(amount: number) {
        const actualDamage = Math.max(1, amount - this.meta.armor);
        this.hp -= actualDamage;
        if (this.hp < 0) this.hp = 0;
    }
}

export class Enemy {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    speed: number;
    radius: number;
    leader: Enemy | null;
    isHead: boolean;
    color: string;
    isDead: boolean = false;
    isElite: boolean = false;
    hitCooldown: Map<string, number> = new Map();
    
    // Knockback
    kbX: number = 0;
    kbY: number = 0;
    
    // Hit flash
    flashTimer: number = 0;

    constructor(x: number, y: number, leader: Enemy | null, isHead: boolean, isElite: boolean = false) {
        this.x = x;
        this.y = y;
        this.leader = leader;
        this.isHead = isHead;
        this.isElite = isElite;
        this.hp = isElite ? 100 : 10;
        this.maxHp = this.hp;
        this.speed = isElite ? 60 : 80;
        this.radius = isHead ? (isElite ? 25 : 15) : (isElite ? 20 : 12);
        this.color = isHead ? (isElite ? '#8e44ad' : '#e74c3c') : (isElite ? '#9b59b6' : '#e67e22');
    }

    takeDamage(amount: number, engine: GameEngine, sourceX: number, sourceY: number, knockbackForce: number = 0) {
        this.hp -= amount;
        this.flashTimer = 0.1;
        sfx.hit();
        
        if (knockbackForce > 0) {
            const dx = this.x - sourceX;
            const dy = this.y - sourceY;
            const dist = Math.hypot(dx, dy) || 1;
            this.kbX = (dx / dist) * knockbackForce;
            this.kbY = (dy / dist) * knockbackForce;
        }

        engine.floatingTexts.push(new FloatingText(this.x, this.y, Math.floor(amount).toString(), '#fff'));
        if (this.hp <= 0 && !this.isDead) {
            this.isDead = true;
            engine.kills++;
            
            if (this.isElite && this.isHead) {
                engine.drops.push(new Drop(this.x, this.y, 'chest'));
            } else {
                // Random drops
                const rand = Math.random();
                if (rand < 0.01) engine.drops.push(new Drop(this.x, this.y, 'chicken'));
                else if (rand < 0.015) engine.drops.push(new Drop(this.x, this.y, 'magnet'));
                else if (rand < 0.02) engine.drops.push(new Drop(this.x, this.y, 'cross'));
                else if (rand < 0.05) engine.drops.push(new Drop(this.x, this.y, 'gold'));
                else engine.gems.push(new Gem(this.x, this.y, this.isHead ? 5 : 1));
            }
            
            for (let i = 0; i < 5; i++) {
                engine.particles.push(new Particle(this.x, this.y, this.color));
            }
        }
    }

    update(dt: number, engine: GameEngine) {
        if (this.flashTimer > 0) this.flashTimer -= dt;

        for (const [key, val] of this.hitCooldown.entries()) {
            if (val > 0) this.hitCooldown.set(key, val - dt);
        }

        if (this.leader && this.leader.isDead) {
            this.leader = null;
            this.isHead = true;
            this.color = this.isElite ? '#8e44ad' : '#e74c3c';
            this.radius = this.isElite ? 25 : 15;
        }

        // Apply knockback
        if (Math.abs(this.kbX) > 0.1 || Math.abs(this.kbY) > 0.1) {
            this.x += this.kbX * dt;
            this.y += this.kbY * dt;
            this.kbX *= 0.9;
            this.kbY *= 0.9;
        }

        let targetX = engine.player.x;
        let targetY = engine.player.y;

        if (this.leader) {
            targetX = this.leader.x;
            targetY = this.leader.y;
        }

        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);

        if (this.isHead || dist > 20) {
            const speed = this.isHead ? this.speed : this.speed * 1.1;
            if (dist > 0) {
                this.x += (dx / dist) * speed * dt;
                this.y += (dy / dist) * speed * dt;
            }
        }

        const pDist = Math.hypot(engine.player.x - this.x, engine.player.y - this.y);
        if (pDist < this.radius + 15) {
            engine.player.takeDamage(10 * dt);
            engine.shake(2);
        }
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
    radius: number = 5;
    isDead: boolean = false;
    hitEnemies: Set<Enemy> = new Set();
    knockback: number;

    constructor(opts: any) {
        this.x = opts.x;
        this.y = opts.y;
        this.vx = opts.vx;
        this.vy = opts.vy;
        this.damage = opts.damage;
        this.pierce = opts.pierce;
        this.life = opts.life;
        this.color = opts.color;
        this.knockback = opts.knockback || 100;
    }

    update(dt: number, engine: GameEngine) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) {
            this.isDead = true;
            return;
        }

        const nearby = engine.spatialHash.query(this.x, this.y, this.radius + 30);
        for (const e of nearby) {
            if (this.hitEnemies.has(e)) continue;
            const dist = Math.hypot(e.x - this.x, e.y - this.y);
            if (dist < this.radius + e.radius) {
                e.takeDamage(this.damage, engine, this.x, this.y, this.knockback);
                this.hitEnemies.add(e);
                this.pierce--;
                if (this.pierce <= 0) {
                    this.isDead = true;
                    break;
                }
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

export class Gem {
    x: number;
    y: number;
    value: number;
    isCollected: boolean = false;
    color: string;

    constructor(x: number, y: number, value: number) {
        this.x = x;
        this.y = y;
        this.value = value;
        this.color = value > 1 ? '#3498db' : '#2ecc71';
    }

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}) {
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
    isCollected: boolean = false;

    constructor(x: number, y: number, type: 'chest' | 'chicken' | 'magnet' | 'cross' | 'gold') {
        this.x = x;
        this.y = y;
        this.type = type;
    }

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}) {
        ctx.save();
        ctx.translate(this.x - camera.x, this.y - camera.y);
        if (this.type === 'chest') {
            ctx.fillStyle = '#f1c40f';
            ctx.fillRect(-10, -8, 20, 16);
            ctx.fillStyle = '#e67e22';
            ctx.fillRect(-10, -2, 20, 4);
        } else if (this.type === 'chicken') {
            ctx.fillStyle = '#e74c3c';
            ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        } else if (this.type === 'magnet') {
            ctx.fillStyle = '#34495e';
            ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI, true); ctx.lineWidth=3; ctx.stroke();
        } else if (this.type === 'cross') {
            ctx.fillStyle = '#ecf0f1';
            ctx.fillRect(-2, -8, 4, 16);
            ctx.fillRect(-6, -4, 12, 4);
        } else if (this.type === 'gold') {
            ctx.fillStyle = '#f1c40f';
            ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
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

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}) {
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

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}) {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.text, this.x - camera.x, this.y - camera.y);
        ctx.globalAlpha = 1;
    }
}

export interface Weapon {
    id: string;
    level: number;
    update(dt: number, engine: GameEngine): void;
    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}, player: Player): void;
}

export class MagicWand implements Weapon {
    id = 'wand';
    level = 1;
    cooldown = 1.0;
    timer = 0;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer <= 0) {
            this.timer = this.cooldown / (1 + this.level * 0.1);
            let nearest = null;
            let minDist = Infinity;
            for (const e of engine.enemies) {
                const dist = Math.hypot(e.x - engine.player.x, e.y - engine.player.y);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = e;
                }
            }

            if (nearest) {
                const dx = nearest.x - engine.player.x;
                const dy = nearest.y - engine.player.y;
                const angle = Math.atan2(dy, dx);
                const damage = (10 + this.level * 5) * (1 + engine.player.meta.might * 0.1);
                engine.projectiles.push(new Projectile({
                    x: engine.player.x,
                    y: engine.player.y,
                    vx: Math.cos(angle) * 400,
                    vy: Math.sin(angle) * 400,
                    damage: damage,
                    pierce: 1 + Math.floor(this.level / 3),
                    life: 2,
                    color: '#4facfe',
                    knockback: 150
                }));
            }
        }
    }
    draw() {}
}

export class Garlic implements Weapon {
    id = 'garlic';
    level = 1;
    cooldown = 0.5;
    timer = 0;
    radius = 60;

    update(dt: number, engine: GameEngine) {
        this.radius = 60 + this.level * 10;
        this.timer -= dt;
        if (this.timer <= 0) {
            this.timer = this.cooldown;
            const damage = (5 + this.level * 2) * (1 + engine.player.meta.might * 0.1);
            const nearby = engine.spatialHash.query(engine.player.x, engine.player.y, this.radius + 30);
            for (const e of nearby) {
                const dist = Math.hypot(e.x - engine.player.x, e.y - engine.player.y);
                if (dist <= this.radius + e.radius) {
                    if (!e.hitCooldown.has('garlic') || e.hitCooldown.get('garlic')! <= 0) {
                        e.takeDamage(damage, engine, engine.player.x, engine.player.y, 50);
                        e.hitCooldown.set('garlic', 0.5);
                    }
                }
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}, player: Player) {
        ctx.save();
        ctx.translate(player.x - camera.x, player.y - camera.y);
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200, 255, 100, 0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200, 255, 100, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

export class Whip implements Weapon {
    id = 'whip';
    level = 1;
    cooldown = 1.5;
    timer = 0;
    active = false;
    activeTimer = 0;
    direction = 1;

    update(dt: number, engine: GameEngine) {
        this.timer -= dt;
        if (this.timer <= 0) {
            this.timer = this.cooldown / (1 + this.level * 0.1);
            this.active = true;
            this.activeTimer = 0.2;
            this.direction = engine.player.vx < 0 ? -1 : 1;
            
            const width = 100 + this.level * 20;
            const height = 40;
            const damage = (15 + this.level * 5) * (1 + engine.player.meta.might * 0.1);
            
            const hx = engine.player.x + (this.direction === 1 ? 0 : -width);
            const hy = engine.player.y - height / 2;
            
            // Simplified query for whip area
            const cx = hx + width/2;
            const cy = hy + height/2;
            const nearby = engine.spatialHash.query(cx, cy, width);

            for (const e of nearby) {
                if (e.x > hx && e.x < hx + width && e.y > hy && e.y < hy + height) {
                    if (!e.hitCooldown.has('whip') || e.hitCooldown.get('whip')! <= 0) {
                        e.takeDamage(damage, engine, engine.player.x, engine.player.y, 200);
                        e.hitCooldown.set('whip', 0.5);
                    }
                }
            }
        }
        
        if (this.active) {
            this.activeTimer -= dt;
            if (this.activeTimer <= 0) {
                this.active = false;
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}, player: Player) {
        if (this.active) {
            const width = 100 + this.level * 20;
            const height = 40;
            const x = player.x - camera.x + (this.direction === 1 ? 0 : -width);
            const y = player.y - camera.y - height / 2;
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(x, y, width, height);
        }
    }
}

export class Bible implements Weapon {
    id = 'bible';
    level = 1;
    angle = 0;

    update(dt: number, engine: GameEngine) {
        const speed = 3 + this.level * 0.5;
        this.angle += speed * dt;
        
        const radius = 80 + this.level * 10;
        const count = 2 + this.level;
        const damage = (10 + this.level * 3) * (1 + engine.player.meta.might * 0.1);
        
        const nearby = engine.spatialHash.query(engine.player.x, engine.player.y, radius + 30);

        for (let i = 0; i < count; i++) {
            const a = this.angle + (Math.PI * 2 / count) * i;
            const px = engine.player.x + Math.cos(a) * radius;
            const py = engine.player.y + Math.sin(a) * radius;
            
            for (const e of nearby) {
                const dist = Math.hypot(e.x - px, e.y - py);
                if (dist < 20 + e.radius) {
                    if (!e.hitCooldown.has('bible') || e.hitCooldown.get('bible')! <= 0) {
                        e.takeDamage(damage, engine, px, py, 100);
                        e.hitCooldown.set('bible', 0.5);
                    }
                }
            }
        }
    }

    draw(ctx: CanvasRenderingContext2D, camera: {x: number, y: number}, player: Player) {
        const radius = 80 + this.level * 10;
        const count = 2 + this.level;
        
        ctx.fillStyle = '#f1c40f';
        for (let i = 0; i < count; i++) {
            const a = this.angle + (Math.PI * 2 / count) * i;
            const px = player.x - camera.x + Math.cos(a) * radius;
            const py = player.y - camera.y + Math.sin(a) * radius;
            
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}

export class GameEngine {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    player: Player;
    enemies: Enemy[] = [];
    projectiles: Projectile[] = [];
    gems: Gem[] = [];
    drops: Drop[] = [];
    particles: Particle[] = [];
    floatingTexts: FloatingText[] = [];
    spatialHash: SpatialHash = new SpatialHash(100);
    
    camera = { x: 0, y: 0 };
    keys = new Set<string>();
    
    lastTime: number = 0;
    gameTime: number = 0;
    spawnTimer: number = 0;
    kills: number = 0;
    gold: number = 0;
    
    isPaused: boolean = false;
    isGameOver: boolean = false;
    animationFrame: number = 0;
    
    shakeIntensity: number = 0;

    onStateChange: (state: GameState) => void;
    onLevelUp: (options: UpgradeOption[]) => void;

    constructor(canvas: HTMLCanvasElement, meta: MetaStats, onStateChange: (state: GameState) => void, onLevelUp: (options: UpgradeOption[]) => void) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.player = new Player(meta);
        this.onStateChange = onStateChange;
        this.onLevelUp = onLevelUp;
        
        // Initial weapon
        this.player.weapons.push(new MagicWand());
        
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    cleanup() {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        cancelAnimationFrame(this.animationFrame);
    }

    handleKeyDown = (e: KeyboardEvent) => {
        this.keys.add(e.key.toLowerCase());
    }

    handleKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.key.toLowerCase());
    }

    start() {
        sfx.init();
        this.lastTime = performance.now();
        this.animationFrame = requestAnimationFrame(this.loop);
    }

    shake(amount: number) {
        this.shakeIntensity = Math.max(this.shakeIntensity, amount);
    }

    loop = (time: number) => {
        const dt = Math.min((time - this.lastTime) / 1000, 0.1);
        this.lastTime = time;
        
        if (!this.isPaused && !this.isGameOver) {
            this.update(dt);
        }
        this.draw();
        
        this.animationFrame = requestAnimationFrame(this.loop);
    }

    update(dt: number) {
        this.gameTime += dt;
        if (this.shakeIntensity > 0) {
            this.shakeIntensity -= dt * 10;
            if (this.shakeIntensity < 0) this.shakeIntensity = 0;
        }
        
        // Player regen
        if (this.player.stats.regen > 1) {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + (this.player.stats.regen - 1) * dt);
        }

        // Player movement
        let vx = 0;
        let vy = 0;
        if (this.keys.has('w') || this.keys.has('arrowup')) vy -= 1;
        if (this.keys.has('s') || this.keys.has('arrowdown')) vy += 1;
        if (this.keys.has('a') || this.keys.has('arrowleft')) vx -= 1;
        if (this.keys.has('d') || this.keys.has('arrowright')) vx += 1;

        if (vx !== 0 && vy !== 0) {
            const length = Math.hypot(vx, vy);
            vx /= length;
            vy /= length;
        }

        const speed = this.player.speed * this.player.stats.speed;
        this.player.vx = vx * speed;
        this.player.vy = vy * speed;
        this.player.x += this.player.vx * dt;
        this.player.y += this.player.vy * dt;

        // Camera
        this.camera.x = this.player.x - this.canvas.width / 2;
        this.camera.y = this.player.y - this.canvas.height / 2;

        // Spawning
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = Math.max(0.2, 2.0 - this.gameTime / 60);
            this.spawnSnake();
        }

        // Update Spatial Hash
        this.spatialHash.clear();
        for (const e of this.enemies) {
            this.spatialHash.insert(e);
        }

        // Update entities
        for (const w of this.player.weapons) w.update(dt, this);
        
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.update(dt, this);
            if (e.isDead) this.enemies.splice(i, 1);
        }

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.update(dt, this);
            if (p.isDead) this.projectiles.splice(i, 1);
        }

        for (let i = this.gems.length - 1; i >= 0; i--) {
            const g = this.gems[i];
            const dist = Math.hypot(g.x - this.player.x, g.y - this.player.y);
            if (dist < this.player.pickupRadius) {
                const speed = 500 * dt;
                g.x += ((this.player.x - g.x) / dist) * speed;
                g.y += ((this.player.y - g.y) / dist) * speed;
                
                if (dist < 15) {
                    g.isCollected = true;
                    sfx.gem();
                    this.player.xp += g.value;
                    this.gems.splice(i, 1);
                    
                    if (this.player.xp >= this.player.xpToNext) {
                        this.triggerLevelUp();
                    }
                }
            }
        }

        for (let i = this.drops.length - 1; i >= 0; i--) {
            const d = this.drops[i];
            const dist = Math.hypot(d.x - this.player.x, d.y - this.player.y);
            if (dist < this.player.pickupRadius) {
                const speed = 500 * dt;
                d.x += ((this.player.x - d.x) / dist) * speed;
                d.y += ((this.player.y - d.y) / dist) * speed;
                
                if (dist < 20) {
                    this.collectDrop(d);
                    this.drops.splice(i, 1);
                }
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update(dt);
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.update(dt);
            if (ft.life <= 0) this.floatingTexts.splice(i, 1);
        }

        if (this.player.hp <= 0) {
            this.isGameOver = true;
        }

        this.onStateChange({
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
            chestActive: false,
            chestRewards: []
        });
    }

    collectDrop(d: Drop) {
        if (d.type === 'chicken') {
            sfx.powerup();
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
            this.floatingTexts.push(new FloatingText(this.player.x, this.player.y, '+30', '#2ecc71'));
        } else if (d.type === 'magnet') {
            sfx.powerup();
            for (const g of this.gems) {
                const dist = Math.hypot(g.x - this.player.x, g.y - this.player.y);
                if (dist < 1000) {
                    this.player.xp += g.value;
                }
            }
            this.gems = [];
            if (this.player.xp >= this.player.xpToNext) this.triggerLevelUp();
        } else if (d.type === 'cross') {
            sfx.explosion();
            this.shake(10);
            for (const e of this.enemies) {
                e.takeDamage(9999, this, this.player.x, this.player.y, 0);
            }
        } else if (d.type === 'gold') {
            sfx.gold();
            this.gold += Math.floor(10 * (1 + this.player.meta.greed * 0.2));
        } else if (d.type === 'chest') {
            sfx.chestOpen();
            this.triggerChest();
        }
    }

    spawnSnake() {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.max(this.canvas.width, this.canvas.height) / 2 + 100;
        const startX = this.player.x + Math.cos(angle) * dist;
        const startY = this.player.y + Math.sin(angle) * dist;
        
        const isElite = Math.random() < 0.05 && this.gameTime > 30; // Elites spawn after 30s
        const length = isElite ? 15 : 5 + Math.floor(this.gameTime / 30);
        let leader = null;
        
        const isFast = Math.random() < 0.2;
        const speed = isFast ? 120 : 70 + this.gameTime * 0.1;
        const hp = 10 + this.gameTime * 0.5;
        const color = isFast ? '#e74c3c' : '#2ecc71';
        
        for (let i = 0; i < length; i++) {
            const isHead = i === 0;
            const enemy = new Enemy(startX, startY, leader, isHead, isElite);
            enemy.x -= Math.cos(angle) * i * 20;
            enemy.y -= Math.sin(angle) * i * 20;
            if (!isElite) {
                enemy.speed = speed;
                enemy.hp = hp;
                enemy.maxHp = hp;
                if (!isHead) enemy.color = color;
            }
            
            this.enemies.push(enemy);
            leader = enemy;
        }
    }

    triggerLevelUp() {
        sfx.levelUp();
        this.player.xp -= this.player.xpToNext;
        this.player.level++;
        this.player.xpToNext = Math.floor(this.player.xpToNext * 1.5);
        this.isPaused = true;
        
        const options = this.getUpgradeOptions(3);
        this.onLevelUp(options);
    }

    triggerChest() {
        this.isPaused = true;
        const options = this.getUpgradeOptions(1); // Chest gives 1 random upgrade
        
        this.onStateChange({
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
            chestActive: true,
            chestRewards: options
        });
    }

    getUpgradeOptions(count: number): UpgradeOption[] {
        const options: UpgradeOption[] = [];
        const available = [...UPGRADE_POOL];
        
        available.sort(() => Math.random() - 0.5);
        for (let i = 0; i < count && i < available.length; i++) {
            const opt = available[i];
            let isNew = true;
            let level = 1;
            
            if (opt.type === 'weapon') {
                const existing = this.player.weapons.find(w => w.id === opt.id);
                if (existing) {
                    isNew = false;
                    level = existing.level + 1;
                }
            } else {
                const existingLevel = this.player.stats[opt.id];
                if (existingLevel > 1) {
                    isNew = false;
                    level = existingLevel;
                }
            }
            
            options.push({ ...opt, isNew, level });
        }
        return options;
    }

    applyUpgrade(id: string) {
        const opt = UPGRADE_POOL.find(u => u.id === id);
        if (!opt) return;

        if (opt.type === 'weapon') {
            const existing = this.player.weapons.find(w => w.id === id);
            if (existing) {
                existing.level++;
            } else {
                if (id === 'wand') this.player.weapons.push(new MagicWand());
                if (id === 'garlic') this.player.weapons.push(new Garlic());
                if (id === 'whip') this.player.weapons.push(new Whip());
                if (id === 'bible') this.player.weapons.push(new Bible());
            }
        } else {
            this.player.stats[id]++;
            if (id === 'maxhp') {
                this.player.maxHp += 50;
                this.player.hp += 50;
            }
        }
        
        this.isPaused = false;
    }

    draw() {
        const ctx = this.ctx;
        
        // Apply screen shake
        ctx.save();
        if (this.shakeIntensity > 0) {
            const dx = (Math.random() - 0.5) * this.shakeIntensity;
            const dy = (Math.random() - 0.5) * this.shakeIntensity;
            ctx.translate(dx, dy);
        }

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Grid
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        const gridSize = 100;
        const startX = -this.camera.x % gridSize;
        const startY = -this.camera.y % gridSize;
        
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

        // Draw entities
        for (const g of this.gems) g.draw(ctx, this.camera);
        for (const d of this.drops) d.draw(ctx, this.camera);
        
        for (const w of this.player.weapons) w.draw(ctx, this.camera, this.player);
        
        for (const p of this.projectiles) p.draw(ctx, this.camera);
        
        for (const e of this.enemies) {
            if (e.flashTimer > 0) {
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.fillStyle = e.color;
            }
            ctx.beginPath();
            ctx.arc(e.x - this.camera.x, e.y - this.camera.y, e.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Player
        ctx.fillStyle = '#3498db';
        ctx.beginPath();
        ctx.arc(this.player.x - this.camera.x, this.player.y - this.camera.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        for (const p of this.particles) p.draw(ctx, this.camera);
        for (const ft of this.floatingTexts) ft.draw(ctx, this.camera);

        ctx.restore(); // Restore shake
    }
}
