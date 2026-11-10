DOMAIN = "contarina"

# Zone ids from https://github.com/mampfes/hacs_waste_collection_schedule/blob/master/doc/ics/contarina_it.md

# Calendar entity with the pickups (optional, set in the config/options flow)
CONF_CALENDAR = "calendar"
# EcoCentro sensors (on unless turned off in the config/options flow)
CONF_ECOCENTER = "ecocenter"
# "Contarina" page in the sidebar: shown if at least one entry turns it on
CONF_PANEL = "panel"
# The sidebar entry of the page tells tomorrow's pickups ("Contarina · Organic, Paper");
# implies the page
CONF_SIDEBAR_PICKUPS = "sidebar_pickups"

# Residual emptyings tracking (optional, set in the config/options flow)
CONF_HOUSEHOLD_MEMBERS = "household_members"
CONF_BIN_LITERS = "bin_liters"
# The yearly allowance is (household members + 1) emptyings of this bin size
STANDARD_BIN_LITERS = 120

# On a pickup day the "next pickup" sensor moves on to the following one at this hour
# (the trucks come in the morning; by the evening it shows what to put out for tomorrow)
PICKUP_DONE_HOUR = 12
# A pickup reminder can be set at the latest at this hour of the pickup day
REMINDER_LATEST_HOUR = 6

# Reminder defaults (config/options flow): days before the pickup, time, notify target.
# The popup opens with them, and add_reminder uses them when called without "at"/"notify"
CONF_REMINDER_DAYS = "reminder_days"
CONF_REMINDER_TIME = "reminder_time"
CONF_REMINDER_NOTIFY = "reminder_notify"
DEFAULT_REMINDER_DAYS = 1
DEFAULT_REMINDER_TIME = "20:00:00"
REMINDER_MAX_DAYS = 7
# reminder_notify values besides a notify service name (e.g. mobile_app_my_phone):
# the popup's last choice in that browser, or Home Assistant's own notifications
NOTIFY_LAST_USED = "last_used"
NOTIFY_HA = "persistent_notification"

# Waste type -> keyword to look for in the ICS calendar events
WASTE_TYPES = {
    "organic": "umido",
    "paper": "carta",
    "glass": "vpl",
    "residual": "secco",
    "garden": "vegetale",
}

# Same icons as the sensors (icons.json), for the sidebar entry
WASTE_ICONS = {
    "organic": "mdi:food-apple-outline",
    "paper": "mdi:newspaper-variant-outline",
    "glass": "mdi:bottle-soda-classic-outline",
    "residual": "mdi:trash-can-outline",
    "garden": "mdi:leaf",
}

# Municipality name → zone number
MUNICIPALITIES = {
    "Treviso - cintura urbana": 1,
    "Treviso - fuori mura": 2,
    "Treviso - centro storico": 3,
    "Arcade": 4,
    "Breda di Piave": 5,
    "Carbonera": 6,
    "Casale sul Sile": 7,
    "Casier": 8,
    "Giavera del Montello": 9,
    "Maserada sul Piave": 10,
    "Monastier di Treviso": 11,
    "Morgano": 12,
    "Nervesa della Battaglia": 13,
    "Paese": 14,
    "Ponzano Veneto": 15,
    "Povegliano": 16,
    "Preganziol": 17,
    "Quinto di Treviso": 18,
    "Roncade": 19,
    "San Biagio di Callalta": 20,
    "Silea": 21,
    "Spresiano": 22,
    "Susegana": 23,
    "Villorba": 24,
    "Volpago del Montello": 25,
    "Zenson di Piave": 26,
    "Zero Branco": 27,
    "Altivole": 28,
    "Asolo - centro storico": 29,
    "Asolo - fuori centro storico": 30,
    "Borso del Grappa": 31,
    "Caerano di San Marco": 32,
    "Castelcucco": 33,
    "Castelfranco Veneto - centro storico": 34,
    "Castelfranco Veneto - fuori centro storico": 35,
    "Castello di Godego": 36,
    "Cavaso del Tomba": 37,
    "Cornuda": 38,
    "Crocetta del Montello": 40,
    "Fonte": 41,
    "Istrana": 42,
    "Loria": 43,
    "Maser": 44,
    "Monfumo": 45,
    "Montebelluna - centro storico": 46,
    "Montebelluna - fuori centro storico": 47,
    "Pederobba": 49,
    "Possagno": 50,
    "Resana": 51,
    "Riese Pio X": 52,
    "San Zenone degli Ezzelini": 53,
    "Trevignano": 54,
    "Vedelago": 55,
    "Pieve del Grappa": 56,
}
