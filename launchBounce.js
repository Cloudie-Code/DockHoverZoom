import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class LaunchBounce {
    constructor(isDash) {
        this._isDash = isDash;
        this._apps = Shell.AppSystem.get_default();
        this._starting = new Set();
        this._actors = new Map();
        this._stateId = this._apps.connect('app-state-changed', (_system, app) => {
            if (app.state === Shell.AppState.STARTING)
                this._starting.add(app);
            else
                this._starting.delete(app);

            this._syncActors();
            if (this._starting.size && !this._scanId) {
                this._scanId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    this._syncActors();
                    return GLib.SOURCE_CONTINUE;
                });
            } else if (!this._starting.size) {
                this._stopScan();
            }
        });
    }

    destroy() {
        this._apps.disconnect(this._stateId);
        this._stopScan();
        this._starting.clear();
        this._syncActors();
    }

    _stopScan() {
        if (this._scanId) {
            GLib.source_remove(this._scanId);
            this._scanId = 0;
        }
    }

    _syncActors() {
        const targets = new Map();
        if (this._starting.size && St.Settings.get().enable_animations)
            this._findTargets(Main.uiGroup, targets);

        for (const [actor, state] of this._actors) {
            if (!targets.has(actor)) {
                this._actors.delete(actor);
                actor.disconnect(state.destroyId);
                actor.remove_transition(state.property);
                actor[state.field] = state.original;
            }
        }

        for (const [actor, side] of targets) {
            if (this._actors.has(actor))
                continue;

            const horizontal = side === St.Side.LEFT || side === St.Side.RIGHT;
            const property = horizontal ? 'translation-x' : 'translation-y';
            const field = horizontal ? 'translation_x' : 'translation_y';
            const original = actor[field];
            const direction = side === St.Side.LEFT || side === St.Side.TOP ? 1 : -1;
            const distance = Math.max(4, (horizontal ? actor.width : actor.height) * 0.22);
            const destroyId = actor.connect('destroy', () => this._actors.delete(actor));
            this._actors.set(actor, {destroyId, property, field, original});
            actor.ease_property(property, original + direction * distance, {
                duration: 230,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                repeatCount: -1,
                autoReverse: true,
            });
        }
    }

    _findTargets(actor, targets) {
        if (!actor.mapped)
            return;

        if (this._isDash(actor)) {
            for (const item of actor._box.get_children()) {
                const appIcon = item.child?._delegate;
                const texture = appIcon?.icon?.icon;
                if (texture?.mapped && this._starting.has(appIcon.app))
                    targets.set(texture, actor._position ?? St.Side.BOTTOM);
            }
            return;
        }

        for (const child of actor.get_children())
            this._findTargets(child, targets);
    }
}
