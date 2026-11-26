import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {IconMagnifier} from './iconMagnifier.js';
import {LaunchBounce} from './launchBounce.js';

function isDash(actor) {
    return actor._box instanceof Clutter.Actor &&
        actor._showAppsIcon instanceof Clutter.Actor &&
        actor.contains(actor._box);
}

function findDash(actor) {
    for (; actor; actor = actor.get_parent()) {
        if (isDash(actor))
            return actor;
    }
    return null;
}

export default class DockHoverZoom extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._iconStylesheet = this.dir.get_child('transparent-icons.css');
        this._iconBackgroundId = this._settings.connect(
            'changed::hide-icon-backgrounds', () => this._syncIconBackgrounds());
        this._syncIconBackgrounds();
        this._launchBounceId = this._settings.connect(
            'changed::bounce-on-launch', () => this._syncLaunchBounce());
        this._syncLaunchBounce();
        this._magnifiers = new Map();
        this._eventId = global.stage.connect('captured-event', (stage, event) => {
            this._handleEvent(stage, event);
            return Clutter.EVENT_PROPAGATE;
        });
        this._dragIds = [
            Main.overview.connect('item-drag-begin', () => {
                this._dragging = true;
                this._active?.reset(false);
            }),
            ...['item-drag-end', 'item-drag-cancelled'].map(signal =>
                Main.overview.connect(signal, () => (this._dragging = false))),
        ];
    }

    disable() {
        this._settings.disconnect(this._launchBounceId);
        this._launchBounce?.destroy();
        this._launchBounce = null;
        this._settings.disconnect(this._iconBackgroundId);
        this._setTransparentIcons(false);
        this._iconStylesheet = null;
        global.stage.disconnect(this._eventId);
        for (const id of this._dragIds)
            Main.overview.disconnect(id);
        for (const magnifier of this._magnifiers.values())
            magnifier.destroy();
        this._magnifiers.clear();
        this._active = null;
        this._settings = null;
        this._dragging = false;
    }

    _syncLaunchBounce() {
        if (this._settings.get_boolean('bounce-on-launch')) {
            this._launchBounce ??= new LaunchBounce(isDash);
        } else {
            this._launchBounce?.destroy();
            this._launchBounce = null;
        }
    }

    _syncIconBackgrounds() {
        this._setTransparentIcons(this._settings.get_boolean('hide-icon-backgrounds'));
    }

    _setTransparentIcons(enabled) {
        if (enabled === Boolean(this._transparentIcons))
            return;

        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (enabled)
            theme.load_stylesheet(this._iconStylesheet);
        else
            theme.unload_stylesheet(this._iconStylesheet);
        this._transparentIcons = enabled;
    }

    _handleEvent(stage, event) {
        switch (event.type()) {
        case Clutter.EventType.BUTTON_PRESS:
            this._active?.reset(false);
            return;
        case Clutter.EventType.LEAVE:
            if (this._active && !this._active.dash.contains(event.get_related() ?? stage))
                this._clearActive();
            return;
        case Clutter.EventType.ENTER:
        case Clutter.EventType.MOTION:
            break;
        default:
            return;
        }

        if (this._dragging || event.get_state() & Clutter.ModifierType.BUTTON1_MASK)
            return;

        const picked = stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, ...event.get_coords());
        let dash = findDash(picked);

        if (!dash && picked?.name === 'dashtodockBox')
            dash = picked.get_children().find(child => findDash(child) === child);

        if (!dash || dash._iconMagnifier?.enabled) {
            this._clearActive();
            return;
        }

        if (this._active?.dash !== dash) {
            this._clearActive();
            if (!this._magnifiers.has(dash)) {
                this._magnifiers.set(dash, new IconMagnifier(dash, this._settings, () => {
                    if (this._active?.dash === dash)
                        this._active = null;
                    this._magnifiers.delete(dash);
                }));
            }
            this._active = this._magnifiers.get(dash);
        }

        this._active.move(event.get_coords());
    }

    _clearActive() {
        this._active?.reset();
        this._active = null;
    }
}
