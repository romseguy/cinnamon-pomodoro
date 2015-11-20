const Lang = imports.lang
const Mainloop = imports.mainloop

const St = imports.gi.St
const Pango = imports.gi.Pango
const Clutter = imports.gi.Clutter
const Cinnamon = imports.gi.Cinnamon
const Util = imports.misc.util
const GLib = imports.gi.GLib

const Main = imports.ui.main
const Applet = imports.ui.applet
const PopupMenu = imports.ui.popupMenu
const MessageTray = imports.ui.messageTray

const Gettext = imports.gettext.domain('cinnamon-applets')
const _ = Gettext.gettext

const appletUUID = 'pomodoro@romseguy'
const appletDir = imports.ui.appletManager.appletMeta[appletUUID].path
const configFilePath = appletDir + '/config.json'

let configOptions = [ // [ <variable>, <config_category>, <actual_option>, <default_value> ]
  ['_pomodoroTime', 'timer', 'pomodoro_duration', 1500],
  ['_showCountdownTimer', 'options', 'is_countdown', true],
  ['_showNotificationMessages', 'options', 'show_messages', true]
]

function main(metadata, orientation, panel_height) {
  return new MyApplet(orientation, panel_height)
}

function MyApplet(orientation, panel_height) {
  this._init(orientation, panel_height)
}

MyApplet.prototype = {
  __proto__: Applet.TextApplet.prototype,

  on_applet_removed_from_panel: function() {
    Mainloop.source_remove(this._timer)
  },

  on_applet_clicked: function(event) {
    this.menu && this.menu.toggle()
  },

  _init: function(orientation, panel_height) {
    Applet.TextApplet.prototype._init.call(this, orientation, panel_height)

    try {
      this._parseConfig()
      this._initMenu(orientation)
      this._tick()
    }
    catch (e) {
      global.logError(e)
    }
  },

  _initMenu: function(orientation) {
    this._reset(true);

    this.menuManager = new PopupMenu.PopupMenuManager(this)
    this.menu = new Applet.AppletPopupMenu(this, orientation)
    this.menuManager.addMenu(this.menu)

    // Toggle timer state button
    this._timerToggle = new PopupMenu.PopupSwitchMenuItem(_('Pomodoro Timer'), false)
    this.menu.addMenuItem(this._timerToggle)

    // Separator
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())

    // Options SubMenu
    const options = new PopupMenu.PopupSubMenuMenuItem(_('Options'))
    // Reset Counters Menu
    let resetButton = new PopupMenu.PopupMenuItem(_('Reset Counts and Timer'))
    resetButton.actor.tooltip_text = 'Click to reset session and break counts to zero'
    options.menu.addMenuItem(resetButton)

    // Notification section
    let notificationSection = new PopupMenu.PopupMenuSection()
    options.menu.addMenuItem(notificationSection)

    // Countdown toggle
    let showCountdownTimerToggle = new PopupMenu.PopupSwitchMenuItem(_('Countdown'), this._showCountdownTimer)
    showCountdownTimerToggle.actor.tooltip_text = 'Make the pomodoro timer count down to zero'
    notificationSection.addMenuItem(showCountdownTimerToggle)

    // ShowNotifications toggle
    let showNotificationMessagesToggle = new PopupMenu.PopupSwitchMenuItem(_('Show Notification Messages'), this._showNotificationMessages)
    showNotificationMessagesToggle.actor.tooltip_text = 'Show notification messages'
    notificationSection.addMenuItem(showNotificationMessagesToggle)

    // Pomodoro Duration section
    let timerLengthSection = new PopupMenu.PopupMenuSection()
    options.menu.addMenuItem(timerLengthSection)

    // Pomodor Time label
    let pomodoroTimeSlider = new PopupMenu.PopupMenuItem(_('Duration'), {reactive: false})
    this._pomodoroTimeLabel = new St.Label({text: this._formatTime(this._pomodoroTime)})
    pomodoroTimeSlider.addActor(this._pomodoroTimeLabel, {align: St.Align.END})
    timerLengthSection.addMenuItem(pomodoroTimeSlider)

    // Pomodoro Time slider
    this._pomodoroTimeSlider = new PopupMenu.PopupSliderMenuItem(this._pomodoroTime / 3600)
    timerLengthSection.addMenuItem(this._pomodoroTimeSlider)

    // handlers
    Main.keybindingManager.addHotKey('someid', 'F9', Lang.bind(this, function(){
      this._isRunning = !this._isRunning;
      this._tick();

      if (this._timerToggle) {
        this._timerToggle.setToggleState(this._isRunning);
      }
    }));
    this._timerToggle.connect('toggled', Lang.bind(this, function(item) {
      this._isRunning = item.state
      this._tick()
    }))
    resetButton.connect('activate', Lang.bind(this, function() {
      this._reset(true);
    }))
    showCountdownTimerToggle.connect('toggled', Lang.bind(this, function() {
      this._showCountdownTimer = !this._showCountdownTimer
      this._onConfigUpdate(false)
    }))
    showNotificationMessagesToggle.connect('toggled', Lang.bind(this, function() {
      this._showNotificationMessages = !this._showNotificationMessages
      this._onConfigUpdate(false)
    }))
    this._pomodoroTimeSlider.connect('value-changed', Lang.bind(this, function() {
      this._pomodoroTime = Math.ceil(Math.ceil(this._pomodoroTimeSlider._value * 3600) / 60) * 60
      this._pomodoroTimeLabel.set_text(this._formatTime(this._pomodoroTime))
      this._onConfigUpdate(true)
    }))
    this.menu.addMenuItem(options)
  },

  _reset: function(resetSessionCount) {
    resetSessionCount = resetSessionCount || false;
    this._timeSpent = -1
    this._minutes = 0
    this._seconds = 0
    this._isRunning = false

    if (resetSessionCount) {
      this._sessionCount = 0
    }

    if (this._timerToggle) {
      this._timerToggle.setToggleState(false);
    }

    this._updateTimerLabel();
  },

  _resetIfFinished: function() {
    if (this._isRunning && this._timeSpent >= this._pomodoroTime) {
      this._sessionCount += 1
      this._reset();

      if (this._showNotificationMessages) {
        Main.notify(_('Pomodoro ' + this._sessionCount + ' finished!'))
      }
    }
  },

  _tick: function() {
    if (this._isRunning) {
      this._timeSpent += 1
      this._resetIfFinished()
      this._updateTimer()
      this._timer = Mainloop.timeout_add_seconds(1, Lang.bind(this, this._tick))
    }
  },

  _updateTimer: function() {
    if (this._isRunning) {
      let seconds = this._timeSpent

      if (this._showCountdownTimer)
        seconds = this._pomodoroTime - this._timeSpent

      this._minutes = parseInt(seconds / 60)
      this._seconds = parseInt(seconds % 60)
      this._updateTimerLabel()
    }
  },

  _updateTimerLabel: function() {
    this.set_applet_label(this._getCircles() + ' %02d:%02d'.format(this._minutes, this._seconds))
  },

  _getCircles: function() {
    let circles = ''

    if (this._sessionCount) {
      circles = Array(this._sessionCount + 1).join('\u25cf')
    }

    return circles;
  },

  _formatTime: function(abs) {
    let minutes = Math.floor(abs / 60)
    let seconds = abs - minutes * 60
    return _("%d minutes").format(minutes)
  },

  _parseConfig: function() {
    // Set the default values
    for (let i = 0; i < configOptions.length; i++)
      this[configOptions[i][0]] = configOptions[i][3]

    if (GLib.file_test(configFilePath, GLib.FileTest.EXISTS)) {
      let filedata = null

      try {
        filedata = Cinnamon.get_file_contents_utf8_sync(configFilePath)

        let jsondata = JSON.parse(filedata)

        for (let i = 0; i < configOptions.length; i++) {
          let option = configOptions[i]
          if (jsondata.hasOwnProperty(option[1]) && jsondata[option[1]].hasOwnProperty(option[2])) {
            // The option "category" and the actual option is defined in config file,
            // override it!
            this[option[0]] = jsondata[option[1]][option[2]]
          }
        }
      }
      catch (e) {
        global.logError("Pomodoro: Error reading config file " + configFilePath + ", error = " + e)
      }
      finally {
        filedata = null
      }
    }
  },

  _onConfigUpdate: function(validateTimer) {
    if (validateTimer) {
      this._resetIfFinished()
      this._updateTimer()
    }

    this._saveConfig()
  },

  _saveConfig: function() {
    let filedata = null
    let jsondata = {}

    try {
      for (let i = 0; i < configOptions.length; i++) {
        let option = configOptions[i]

        // Insert the option "category", if it's undefined
        if (!jsondata.hasOwnProperty(option[1])) {
          jsondata[option[1]] = {}
        }

        // Update the option key/value pairs
        jsondata[option[1]][option[2]] = this[option[0]]
      }
      filedata = JSON.stringify(jsondata, null, "  ")
      GLib.file_set_contents(configFilePath, filedata, filedata.length)
    }
    catch (e) {
      global.logError("Pomodoro: Error writing config file = " + e)
    }
    finally {
      jsondata = null
      filedata = null
    }
  }
}
