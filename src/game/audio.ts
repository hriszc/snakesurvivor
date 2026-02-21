export class SoundFX {
    ctx: AudioContext | null = null;
    
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
    }

    play(freq: number, type: OscillatorType, duration: number, vol: number = 0.1) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    hit() { this.play(150, 'square', 0.1, 0.05); }
    gem() { this.play(800 + Math.random() * 200, 'sine', 0.1, 0.02); }
    levelUp() {
        this.play(400, 'square', 0.1, 0.1);
        setTimeout(() => this.play(600, 'square', 0.2, 0.1), 100);
        setTimeout(() => this.play(800, 'square', 0.4, 0.1), 200);
    }
    chestOpen() {
        this.play(300, 'sawtooth', 0.2, 0.1);
        setTimeout(() => this.play(400, 'sawtooth', 0.2, 0.1), 200);
        setTimeout(() => this.play(600, 'sawtooth', 0.6, 0.15), 400);
    }
    gold() { this.play(1200, 'sine', 0.1, 0.05); }
    powerup() { this.play(600, 'sine', 0.5, 0.1); }
    explosion() { this.play(100, 'sawtooth', 0.5, 0.2); }
}

export const sfx = new SoundFX();
