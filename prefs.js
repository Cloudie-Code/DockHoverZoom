import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DockHoverZoomPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: _('Magnify icons on hover'),
            description: _('Enlarge the icons under the mouse pointer, like the macOS dock.'),
        });
        const row = new Adw.SpinRow({
            title: _('Magnification size'),
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 1.1,
                upper: 3,
                step_increment: 0.1,
                page_increment: 0.5,
            }),
        });

        const settings = this.getSettings();
        const backgroundRow = new Adw.SwitchRow({title: _('Hide icon backgrounds')});
        const bounceRow = new Adw.SwitchRow({title: _('Bounce icons when launching apps')});
        settings.bind('hover-zoom-scale', row, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('hide-icon-backgrounds', backgroundRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('bounce-on-launch', bounceRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
        group.add(backgroundRow);
        group.add(bounceRow);
        page.add(group);
        window.add(page);
    }
}
