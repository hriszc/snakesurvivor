import { PlatformInputMode } from './types';

export class InputManager {
    private keys = new Set<string>();
    private mode: PlatformInputMode;
    private joystick = { x: 0, y: 0, active: false };

    constructor(mode: PlatformInputMode) {
        this.mode = mode;
    }

    attach() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    detach() {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
    }

    setMode(mode: PlatformInputMode) {
        this.mode = mode;
        if (mode === 'desktop') {
            this.joystick = { x: 0, y: 0, active: false };
        }
    }

    getMode(): PlatformInputMode {
        return this.mode;
    }

    setVirtualJoystick(x: number, y: number, active: boolean) {
        this.joystick = {
            x: clamp(x, -1, 1),
            y: clamp(y, -1, 1),
            active,
        };
    }

    getMovementVector(): { x: number; y: number } {
        if (this.mode === 'mobile' && this.joystick.active) {
            return normalize(this.joystick.x, this.joystick.y);
        }

        let x = 0;
        let y = 0;
        if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
        if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
        if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
        if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
        return normalize(x, y);
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        this.keys.add(e.key.toLowerCase());
    };

    private handleKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.key.toLowerCase());
    };
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

function normalize(x: number, y: number): { x: number; y: number } {
    if (x === 0 && y === 0) return { x: 0, y: 0 };
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
}
