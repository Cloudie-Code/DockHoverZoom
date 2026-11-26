// SPDX-License-Identifier: GPL-2.0-or-later
// Magnification curve by Cloudie-Code, from Dash to Dock's Hover-Zoom branch.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {DashItemContainer} from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ANIMATION_TIME = 150;
const SPREAD = 2.5;

export class IconMagnifier {
    constructor(dash, settings, onDestroy) {
        this.dash = dash;
        this._settings = settings;
        this._actors = new Map();
        this._paintOverrides = [];
        this._progress = new St.Adjustment({actor: dash, lower: 0, upper: 1});
        this._signals = [
            [this._progress, this._progress.connect('notify::value', () => this._update())],
            [settings, settings.connect('changed::hover-zoom-scale', () => this._update())],
            [dash, dash.connect('notify::mapped', () => {
                if (!dash.mapped)
                    this.reset(false);
            })],
            [dash, dash.connect('destroy', () => {
                this.destroy();
                onDestroy();
            })],
        ];
        for (const actor of [dash, dash._box])
            this._signals.push([actor, actor.connect('notify::allocation', () => this._queueUpdate())]);

        const box = dash.get_parent();
        const slider = box?.get_parent();
        if (box?.name === 'dashtodockBox' && typeof slider?.slide_x === 'number') {
            this._signals.push([slider, slider.connect('notify::slide-x', () => {
                if (slider.slide_x === 0 && this._progress.value > 0)
                    this.reset(false);
            })]);
        }
    }

    destroy() {
        if (this._updateId)
            GLib.source_remove(this._updateId);
        this.reset(false);
        for (const [object, id] of this._signals)
            object.disconnect(id);
    }

    move(pointer) {
        this._pointer = pointer;
        if (!this._hovering) {
            this._hovering = true;
            this._animate(1);
        }
        this._update();
    }

    reset(animate = true) {
        if (!animate) {
            this._hovering = false;
            this._pointer = null;
            this._progress.remove_transition('value');
            this._progress.value = 0;
            this._update();
        } else if (this._hovering) {
            this._hovering = false;
            this._animate(0);
        }
    }

    _animate(value) {
        this._progress.remove_transition('value');
        this._progress.ease(value, {
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _restoreActor(actor, state) {
        this._actors.delete(actor);
        actor.disconnect(state.destroyId);
        actor.set_pivot_point(...state.pivot);
        actor.set(state.transform);
    }

    _queueUpdate() {
        if (!this._pointer || this._updateId)
            return;

        this._updateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._updateId = 0;
            this._restoreOverflow();
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _restoreOverflow() {
        for (const restore of this._paintOverrides.reverse())
            restore();
        this._paintOverrides = [];
    }

    _restoreBackground() {
        if (this._backgroundState) {
            const {actor, transform} = this._backgroundState;
            actor.set(transform);
            this._backgroundState = null;
        }
    }

    _restoreOverviewStack() {
        if (this._overviewStack) {
            const {parent, next} = this._overviewStack;
            if (this.dash.get_parent() === parent && next.get_parent() === parent)
                parent.set_child_below_sibling(this.dash, next);
            this._overviewStack = null;
        }
    }

    _raiseAbovePreview() {
        const dash = this.dash;
        if (!Main.overview.visible || Main.overview.dash.showAppsButton.checked) {
            this._restoreOverviewStack();
            return;
        }

        const parent = dash.get_parent();
        const workspace = parent?._workspacesDisplay;
        if (workspace?.get_parent() === parent && !this._overviewStack) {
            const children = parent.get_children();
            const index = children.indexOf(dash);
            if (index < children.indexOf(workspace)) {
                this._overviewStack = {parent, next: children[index + 1]};
                parent.set_child_above_sibling(dash, workspace);
            }
        }
    }

    _updateBackground(geometry, horizontal, spread, magnification, progress) {
        const dash = this.dash;
        const background = dash._background;
        if (!background?.mapped || background.get_parent() !== dash) {
            this._restoreBackground();
            return;
        }
        const {x1, x2} = background.allocation;
        const width = x2 - x1;
        if (width <= 0)
            return;

        this._backgroundState ??= {
            actor: background,
            transform: {
                scale_x: background.scale_x,
                translation_x: background.translation_x,
            },
        };
        const {transform} = this._backgroundState;
        const [px] = background.get_pivot_point();
        const originalWidth = width * transform.scale_x;
        const left = x1 + transform.translation_x + px * (width - originalWidth);
        const right = left + originalWidth;
        // The integrated falloff saturates at half the spread in either direction.
        const maxShift = magnification * spread / 2;
        const rowStart = Math.min(...geometry.map(({x, width}) =>
            x - (horizontal ? maxShift : dash._position === St.Side.RIGHT ? width * magnification : 0)));
        const rowEnd = Math.max(...geometry.map(({x, width}) =>
            x + width + (horizontal ? maxShift : dash._position === St.Side.LEFT ? width * magnification : 0)));
        const [, stageY] = dash.get_transformed_position();
        const [startOk, startX] = dash.transform_stage_point(rowStart, stageY);
        const [endOk, endX] = dash.transform_stage_point(rowEnd, stageY);
        if (!startOk || !endOk)
            return;

        const leftExtension = Math.max(0, left - startX) * progress;
        const rightExtension = Math.max(0, endX - right) * progress;
        const growth = leftExtension + rightExtension;
        background.set({
            scale_x: (originalWidth + growth) / width,
            translation_x: transform.translation_x - leftExtension + px * growth,
        });
    }

    _allowOverflow(horizontal, spread) {
        if (this._paintOverrides.length)
            return;

        const dash = this.dash;
        const set = (actor, property, value) => {
            if (actor && actor[property] !== undefined && actor[property] !== value) {
                const original = actor[property];
                actor[property] = value;
                this._paintOverrides.push(() => {
                    if (actor[property] === value)
                        actor[property] = original;
                });
            }
        };

        set(dash, 'offscreen_redirect', Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY);
        const view = dash._scrollView;
        if (!view) {
            set(dash._box, 'clip_to_allocation', false);
            return;
        }

        const viewport = view.get_child?.() ?? view.child;
        const adjustment = horizontal
            ? (viewport?.hadjustment ?? view.hadjustment)
            : (viewport?.vadjustment ?? view.vadjustment);
        if (!adjustment || adjustment.upper - adjustment.lower <= adjustment.page_size + 0.5)
            set(viewport, 'clip_to_view', false);

        const box = dash.get_parent();
        if (box?.name !== 'dashtodockBox' || !Clutter.Actor.prototype.has_clip.call(box))
            return;

        // Dash to Dock reapplies this clip during allocation, even after the
        // reveal has finished. Extend each new clip while the dock is open.
        const originalSetClip = box.set_clip;
        const hadOwnMethod = Object.hasOwn(box, 'set_clip');
        let baseClip = box.get_clip();
        const setClip = (x, y, width, height) => {
            baseClip = [x, y, width, height];
            const slide = box.get_parent()?.slide_x;
            const shown = typeof slide === 'number' ? slide >= 1 :
                x <= 0 && y <= 0 && width >= box.width - 1 && height >= box.height - 1;
            if (!shown)
                return originalSetClip.call(box, ...baseClip);

            const overflow = Math.ceil(spread * 2);
            const left = dash._position === St.Side.LEFT ? 0 : overflow;
            const right = dash._position === St.Side.RIGHT ? 0 : overflow;
            const top = dash._position === St.Side.TOP ? 0 : overflow;
            const bottom = dash._position === St.Side.BOTTOM ? 0 : overflow;
            return originalSetClip.call(box, x - left, y - top,
                width + left + right, height + top + bottom);
        };
        box.set_clip = setClip;
        setClip(...baseClip);
        this._paintOverrides.push(() => {
            if (box.set_clip !== setClip)
                return;
            if (hadOwnMethod)
                box.set_clip = originalSetClip;
            else
                delete box.set_clip;
            originalSetClip.call(box, ...baseClip);
        });
    }

    _update() {
        const dash = this.dash;
        const progress = this._progress.value;
        const horizontal = dash._isHorizontal ?? true;
        const items = new Map();

        if (progress > 0 && this._pointer && dash.mapped) {
            const candidates = [...dash._box.get_children(), dash._showAppsIcon];
            for (const item of candidates) {
                if (!item?.mapped || item.animatingOut || item === dash._dragPlaceholder)
                    continue;
                const target = item instanceof DashItemContainer ? item.child :
                    item === dash._separator ? item : null;
                if (target?.mapped)
                    items.set(target, item);
            }
        }

        for (const [actor, state] of this._actors) {
            if (!items.has(actor))
                this._restoreActor(actor, state);
        }

        if (!items.size) {
            this._restoreOverviewStack();
            this._restoreBackground();
            this._restoreOverflow();
            return;
        }

        const pivot = {
            [St.Side.TOP]: [0.5, 0],
            [St.Side.LEFT]: [0, 0.5],
            [St.Side.RIGHT]: [1, 0.5],
            [St.Side.BOTTOM]: [0.5, 1],
        }[dash._position] ?? [0.5, 1];
        const pointer = this._pointer[horizontal ? 0 : 1];
        const geometry = [...items].map(([actor, item]) => {
            const extents = item.get_transformed_extents();
            const axis = horizontal ? 'translation_x' : 'translation_y';
            const original = this._actors.get(actor)?.transform;
            const shift = actor === item && original ? actor[axis] - original[axis] : 0;
            const start = (horizontal ? extents.get_x() : extents.get_y()) - shift;
            const length = horizontal ? extents.get_width() : extents.get_height();
            return {
                actor, length, start, scalable: actor !== item,
                x: extents.get_x(), width: extents.get_width(),
            };
        });
        const iconGeometry = geometry.filter(item => item.scalable);
        const spread = SPREAD * Math.max(...iconGeometry.map(item => item.length));
        if (spread <= 0)
            return;

        this._allowOverflow(horizontal, spread);
        const magnification = this._settings.get_double('hover-zoom-scale') - 1;
        const amount = magnification * progress;

        // Integrate the cosine falloff to keep the point under the cursor
        // fixed while neighboring icons move apart.
        const magnifiedOffset = offset => {
            const clamped = Math.min(spread, Math.max(-spread, offset));
            return (clamped + spread / Math.PI * Math.sin(Math.PI * clamped / spread)) / 2;
        };

        for (const {actor, length, start: position, scalable} of geometry) {
            if (length <= 0)
                continue;

            if (!this._actors.has(actor)) {
                this._actors.set(actor, {
                    destroyId: actor.connect('destroy', () => this._actors.delete(actor)),
                    pivot: actor.get_pivot_point(),
                    transform: {
                        scale_x: actor.scale_x,
                        scale_y: actor.scale_y,
                        translation_x: actor.translation_x,
                        translation_y: actor.translation_y,
                    },
                });
            }

            const {transform} = this._actors.get(actor);
            const offset = position - pointer;
            const start = magnifiedOffset(offset);
            const end = magnifiedOffset(offset + length);
            const scale = scalable ? 1 + amount * (end - start) / length : 1;
            const translation = amount * (start + end) / 2;
            actor.set_pivot_point(...pivot);
            actor.set({
                scale_x: transform.scale_x * scale,
                scale_y: transform.scale_y * scale,
                translation_x: transform.translation_x + (horizontal ? translation : 0),
                translation_y: transform.translation_y + (horizontal ? 0 : translation),
            });
        }

        this._raiseAbovePreview();
        this._updateBackground(iconGeometry, horizontal, spread, magnification, progress);
    }
}
