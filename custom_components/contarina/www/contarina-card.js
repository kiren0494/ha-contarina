/*
 * Contarina card - upcoming waste collection pickups.
 *
 * Renders one block per configured municipality, titled
 * "<custom name or municipality> - Waste collection" (translated), or with `title`.
 *
 * Config (all optional):
 *   type: custom:contarina-card
 *   title: Bins at {location}      (replaces the whole header; {location} = calendar name)
 *   location: Beach house          (only show the calendar with this name; a municipality
 *                                   name shows all its calendars if none is named so)
 *   soon_days: 1                   (default limit, in days, for the types set to "soon")
 *   hide_when_empty: true          (hide municipalities/card with nothing to show)
 *   ecocenter: false               (hide the EcoCentro button next to each header;
 *                                   "inline" shows the hours in the card instead)
 *   view: search                   (a search card: "Where does it go?" always open and the
 *                                   bins' guides, no pickups)
 *   view: ecocenter                (only the EcoCentro of each calendar, with its hours)
 *   search: false                  (hide the "Where does it go?" search button)
 *   show:                          (per type: always | soon | never | N, default always)
 *     paper: soon                  (shown only within soon_days)
 *     residual: 5                  (shown only within 5 days: overrides soon_days for this type)
 *     garden: never
 *   entities:                      (default: every Contarina sensor)
 *     - sensor.contarina_home_organic
 *   colors:                        (per type badge color, default as in WASTE_STYLE)
 *     organic: "#8d6e63"
 *     paper: "#fbc02d"
 *     glass: "#1e88e5"
 *     residual: "#757575"
 *     garden: "#43a047"
 *
 * Waste type keys: organic, paper, glass, residual, garden
 */

// Keys match the sensors' "waste" attribute
const WASTE_STYLE = {
  organic: { icon: "mdi:food-apple-outline", color: "#8d6e63" },
  paper: { icon: "mdi:newspaper-variant-outline", color: "#fbc02d" },
  glass: { icon: "mdi:bottle-soda-classic-outline", color: "#1e88e5" },
  residual: { icon: "mdi:trash-can-outline", color: "#757575" },
  garden: { icon: "mdi:leaf", color: "#43a047" },
};
const WASTE_KEYS = Object.keys(WASTE_STYLE);

// EcoCentro sensors: state open | booking_only | closed
const ECO_STYLE = { icon: "mdi:recycle", color: "#00897b" };
// Special collections of the waste dictionary (search results)
const SPECIAL_ICONS = {
  special_service: "mdi:truck-outline",
  batteries: "mdi:battery-outline",
  small_appliances: "mdi:blender-outline",
  toner: "mdi:printer-outline",
  clothes: "mdi:tshirt-crew-outline",
  medicines: "mdi:pill",
};
const ECO_RANK = { open: 0, booking_only: 1, closed: 2 };
const ECO_HOURS_URL = "https://contarina.it/cittadino/raccolta-differenziata/ecocentro/orari-ecocentro";

// What goes in each bin, from the Contarina EcoCalendario; types without a guide get no info button
const GUIDE = {
  en: {
    residual: {
      container: "Grey bin with transponder (records each emptying), grey transparent bags",
      sections: [
        {
          title: "How to put it out",
          items: [
            "Put the waste in the transparent bags",
            "Put the bin out with the lid closed",
            "Put the bin out only when full",
            "Don't leave anything on top of or next to the bin",
            "Don't press the waste down too much",
          ],
        },
        {
          title: "What goes in",
          items: [
            "Bags and other packaging made of materials that are hard to separate (e.g. paper and aluminium bags)",
            "Nappies and sanitary pads",
            "Incandescent light bulbs",
            "Pens and markers",
            "Plastic toys, ornaments and household items",
            "Vacuum cleaner bags",
            "CDs, audio cassettes, video cassettes and their plastic cases",
            "Plastic document holders and folders",
            "Rubber items and hoses",
            "Rubber gloves",
            "Cosmetics",
            "Synthetic sponges",
            "Plastic razors and toothbrushes",
            "Syringes with the cap on, dialysis and ostomy bags",
            "Thermal paper receipts",
            "Dirty nylon sacks, bags and wrappers (if clean, see Glass, plastic, cans)",
            "Fabric scraps and rags",
            "Household photos and X-ray films",
            "Broken shoes and slippers",
            "Broken umbrellas",
            "Fully extinguished cigarette butts",
            "Non-compostable coffee capsules and pods",
            "Synthetic pet litter, also with excrement",
            "Pet excrement in a non-compostable bag",
            "Non-compostable plastic disposable cutlery (forks, spoons, knives)",
            "Disposable non-woven towels",
            "Disposable face masks",
          ],
        },
        {
          title: "Disposable cutlery and tableware",
          items: [
            "Non-compostable plastic cutlery: not considered packaging, so it goes in the residual waste bin",
            "Non-compostable plastic tableware (plates, cups): clean, stacked and loose in the Glass, plastic, cans bin, where it is recycled with the other plastic packaging",
            "Compostable cutlery and tableware: in the brown Organic bin",
          ],
        },
      ],
      notes: [
        "You can get the right bags from the vending machines around the area, or have them delivered at home for a fee using the contacts on the back of the EcoCalendario.",
        "If in doubt, use the contacts on the back of the EcoCalendario.",
      ],
    },
    glass: {
      container: "Blue bin",
      sections: [
        {
          title: "How to put it out",
          items: [
            "Put the waste in loose, without bags",
            "Don't put in dirty packaging (e.g. film soiled with food, solvents or other pollutants)",
            "Put in completely empty packaging only",
            "Crush cans and plastic containers to reduce their volume",
            "Put the bin out with the lid closed",
            "Don't leave anything on top of or next to the bin",
            "Put the bin out preferably when full",
          ],
        },
        {
          title: "What goes in",
          items: [
            "Glass bottles",
            "Glass jars and containers",
            "Plastic water and soft drink bottles",
            "Plastic bottles, non-spray dispensers and tubs for various products (e.g. detergents, cleaning products, cosmetics)",
            "Clean household plastic flower pots",
            "Plastic yogurt pots",
            "Moulded plastic or polystyrene trays for food (eggs, fruit, ice cream, etc.) and for other items",
            "Aluminium cans (e.g. soft drinks)",
            "Tin cans and containers for food (e.g. peeled tomatoes, tuna)",
            "Metal caps and lids",
            "Aluminium foil and trays",
            "Empty metal tubes (e.g. mayonnaise, shoe polish)",
            "Nylon and plastic food bags and packaging (e.g. frozen food packaging, coffee bags)",
            "Fruit and vegetable nets",
            "Small polystyrene packaging",
            "Wrapping for drink packs or magazines",
            "Film, cling film and cellophane",
            "Plastic bags and boxes for clothing",
            "Packaging straps",
            "Metal or plastic coat hangers",
            "Non-compostable plastic disposable tableware (such as plates and cups)",
          ],
        },
        {
          title: "Watch out for spray cans",
          items: [
            "Don't throw spray cans (e.g. deodorant, hairspray, whipped cream, paint) in the kerbside bins: they can explode and start dangerous fires in the collection trucks. Take them to the EcoCentro!",
          ],
        },
      ],
    },
    organic: {
      container: "Brown bin, compostable bag",
      sections: [
        {
          title: "How to put it out",
          items: [
            "Put the waste in certified compostable bags, bearing at least one compostability symbol (UNI EN 13432 standard)",
            "Don't use plastic bags, not even to line the bin you put out",
            "Don't put out the under-sink caddy, it is only for collecting waste at home",
            "Put the bin out with the lid closed",
            "Don't leave anything on top of or next to the bin",
          ],
        },
        {
          title: "What goes in",
          items: [
            "Fruit, vegetable and food scraps",
            "Eggshells",
            "Small bones",
            "Fish and shellfish scraps",
            "Coffee grounds and compostable coffee pods, tea bags",
            "Small amounts of plants and cut flowers",
            "Dirty paper tissues and napkins",
            "Small amounts of compostable pet litter, also with pet excrement in compostable bags",
            "Cold fireplace ashes",
            "Cork stoppers without glass, plastic or metal parts (better still, take them to the dedicated containers at EcoCentri, service desks, schools, town halls)",
            "Wooden ice cream sticks and toothpicks",
            "Dirty parts of pizza boxes, reduced in size",
            "Compostable baking paper",
            "Tableware, cutlery, bags and carrier bags in compostable material, bearing at least one symbol certifying compostability under the UNI EN 13432 standard",
          ],
        },
      ],
      notes: [
        "You can use bags from the shops, as long as they bear at least one symbol certifying their compostability.",
        "You can also get the right bags from the vending machines around the area, or have them delivered at home for a fee using the contacts on the back of the EcoCalendario.",
      ],
    },
    garden: {
      container: "Ventilated beige bin",
      sections: [
        {
          title: "How to put it out",
          items: [
            "Put the waste in loose, without bags",
            "Don't use plastic bags, not even to line the bin",
            "Put the bin out with the lid closed, without pressing the waste down too much",
            "Don't leave anything or other bags of garden waste on top of or next to the bin",
            "Put the bin out preferably when full",
          ],
        },
        {
          title: "What goes in",
          items: [
            "Branches, tree and hedge prunings",
            "Grass clippings and cut flowers",
            "Plants without soil",
            "Vegetable garden waste",
          ],
        },
      ],
      notes: [
        "The service is optional and paid.",
        "Collection: once a week from April to December, once every 2 weeks from January to March.",
      ],
    },
    paper: {
      container: "Yellow bin",
      sections: [
        {
          title: "How to put it out",
          items: [
            "Put the waste in loose, without bags",
            "Don't put in dirty paper",
            "Put the bin out with the lid closed",
            "Don't leave anything on top of or next to the bin",
            "Put the bin out preferably when full",
          ],
        },
        {
          title: "What goes in",
          items: [
            "Drink and food cartons (e.g. milk, wine, fruit juice, tomato passata), clean and without plastic parts",
            "Newspapers and magazines",
            "Sheets of paper, notebooks and books",
            "Cardboard trays and packaging (e.g. pasta, rice)",
            "Clean pizza boxes",
            "Paper bags (e.g. bread, shopping bags)",
            "Flattened cardboard boxes (for large amounts, take them to the EcoCentro, checking the access limits and rules in the EcoCalendario first)",
            "Clean ice cream cups and paper cups",
            "Cigarette packs without plastic parts",
            "Paper rolls and tubes (e.g. kitchen roll, toilet paper)",
            "Clean paper napkins",
          ],
        },
      ],
    },
  },
  it: {
    residual: {
      container: "Contenitore grigio con transponder (registra gli svuotamenti), sacchetto grigio trasparente",
      sections: [
        {
          title: "Come conferire",
          items: [
            "Metti il rifiuto nei sacchetti trasparenti",
            "Esponi il contenitore con il coperchio chiuso",
            "Esponi il contenitore soltanto se pieno",
            "Non depositare materiale sopra o accanto al contenitore",
            "Non pressare eccessivamente il rifiuto",
          ],
        },
        {
          title: "Metti nel contenitore",
          items: [
            "Sacchetti e altri imballaggi in più materiali difficilmente separabili (es. sacchetti in carta e alluminio)",
            "Pannolini e assorbenti",
            "Lampadine a filamento",
            "Penne e pennarelli",
            "Giocattoli, soprammobili e oggetti casalinghi in plastica",
            "Sacchi per aspirapolvere",
            "Compact disc, musicassette, videocassette e le loro custodie in plastica",
            "Portadocumenti e cartellette in plastica",
            "Oggetti e tubi in gomma",
            "Guanti in gomma",
            "Cosmetici",
            "Spugne sintetiche",
            "Rasoi e spazzolini in plastica",
            "Siringhe chiuse col tappo e sacche per dialisi e per stomizzati",
            "Scontrini in carta chimica",
            "Sacchi, sacchetti, borse e involucri in nylon sporchi (se puliti vedi Vetro, plastica, lattine)",
            "Pezzi di stoffa e stracci",
            "Fotografie e lastre radiografiche di provenienza domestica",
            "Scarpe e ciabatte rotte",
            "Ombrelli rotti",
            "Mozziconi di sigaretta ben spenti",
            "Capsule e cialde non compostabili per macchinette del caffè",
            "Lettiere sintetiche per animali domestici, anche con escrementi",
            "Escrementi di animali chiusi in sacchetto non compostabile",
            "Posate usa e getta in plastica non compostabile (forchette, cucchiai, coltelli)",
            "Asciugamani monouso in TNT",
            "Mascherine monouso",
          ],
        },
        {
          title: "Attenzione alle posate e alle stoviglie usa e getta",
          items: [
            "Posate usa e getta in plastica non compostabile: non sono considerate imballaggi e quindi vanno nel secco non riciclabile",
            "Stoviglie usa e getta in plastica non compostabile (piatti, bicchieri): pulite, impilate e sfuse nel contenitore del vetro plastica lattine, dove vengono riciclate con gli altri imballaggi in plastica",
            "Posate e stoviglie in materiale compostabile: nel contenitore marrone dell'umido",
          ],
        },
      ],
      notes: [
        "Puoi ritirare i sacchetti adeguati ai distributori automatici presenti sul territorio, oppure richiederne la consegna a domicilio (servizio a pagamento) contattando i riferimenti sul retro dell'EcoCalendario.",
        "Se hai dei dubbi, puoi contattare i riferimenti indicati sul retro dell'EcoCalendario.",
      ],
    },
    glass: {
      container: "Contenitore blu",
      sections: [
        {
          title: "Come conferire",
          items: [
            "Metti nel contenitore i rifiuti sfusi, senza usare sacchetti",
            "Non inserire imballaggi sporchi (ad esempio pellicola sporca di cibo o di solventi o altro inquinante)",
            "Metti nel contenitore imballaggi completamente vuoti",
            "Schiaccia le lattine e i contenitori di plastica per ridurli di volume",
            "Esponi il contenitore con il coperchio chiuso",
            "Non depositare materiale sopra o accanto al contenitore",
            "Esponi il contenitore possibilmente pieno",
          ],
        },
        {
          title: "Metti nel contenitore",
          items: [
            "Bottiglie di vetro",
            "Vasetti e contenitori in vetro",
            "Bottiglie in plastica di acqua e bibite",
            "Flaconi, dispensatori non spray, barattoli in plastica per il confezionamento di prodotti vari (es. detergenti, detersivi, cosmetici, ecc.)",
            "Vasi in plastica per fiori, puliti e di provenienza domestica",
            "Vasetti in plastica dello yogurt",
            "Vaschette sagomate in plastica o polistirolo per alimenti (uova, frutta, gelato, ecc.) e per oggetti vari",
            "Lattine in alluminio (es. di bibite)",
            "Scatole e contenitori in banda stagnata per alimenti (es. pelati, tonno, ecc.)",
            "Tappi e coperchi metallici",
            "Carta stagnola e vaschette in alluminio",
            "Tubetti metallici vuoti (es. per maionese, lucido per scarpe, ecc.)",
            "Buste, borsette, confezioni in nylon e plastica per alimenti (es. confezioni in plastica dei surgelati, sacchetti del caffè, ecc.)",
            "Reti per frutta e verdura",
            "Piccoli imballaggi in polistirolo",
            "Involucri per confezioni di bibite o riviste",
            "Film, pellicole e cellophane",
            "Sacchi e scatole in plastica per il confezionamento degli abiti",
            "Reggette per pacchi",
            "Grucce appendiabiti in metallo o plastica",
            "Stoviglie usa e getta in plastica non compostabile (come piatti e bicchieri)",
          ],
        },
        {
          title: "Attenzione ai contenitori spray",
          items: [
            "Non gettare i contenitori spray (es. bombolette di deodoranti, lacca per i capelli, panna, vernici, ecc.) nei bidoni della raccolta porta a porta: possono esplodere e innescare pericolosi incendi nei mezzi della raccolta. Portali all'EcoCentro!",
          ],
        },
      ],
    },
    organic: {
      container: "Contenitore marrone, sacchetto compostabile",
      sections: [
        {
          title: "Come conferire",
          items: [
            "Metti il rifiuto nei sacchetti compostabili certificati, con almeno un simbolo di compostabilità (norma UNI EN 13432)",
            "Non usare sacchetti di plastica, nemmeno per proteggere internamente il contenitore da esporre",
            "Non esporre il sottolavello, che serve soltanto per raccogliere i rifiuti in casa",
            "Esponi il contenitore con il coperchio chiuso",
            "Non depositare materiale sopra o accanto al contenitore",
          ],
        },
        {
          title: "Metti nel contenitore",
          items: [
            "Resti di frutta, verdura e alimenti",
            "Gusci d'uovo",
            "Piccoli ossi",
            "Resti di pesce e molluschi",
            "Fondi e cialde compostabili di caffè, bustine di tè",
            "Piante e fiori recisi in piccole quantità",
            "Fazzoletti e tovaglioli di carta sporchi",
            "Piccole lettiere compostabili per animali domestici, anche con escrementi di animali chiusi in sacchetti compostabili",
            "Ceneri spente di caminetti",
            "Tappi di sughero senza parti in vetro, plastica o metallo (o meglio portali nei contenitori appositi presso EcoCentri, sportelli, scuole, Municipi)",
            "Stecchi in legno del gelato e stuzzicadenti",
            "Parti sporche di scatole di pizza ridotte di volume",
            "Carta da forno compostabile",
            "Stoviglie, posate, sacchetti e borsette in materiale compostabile contrassegnati da almeno un simbolo che ne attesti la compostabilità ai sensi della norma UNI EN 13432",
          ],
        },
      ],
      notes: [
        "Puoi usare i sacchetti in commercio, purché presentino almeno un simbolo che ne certifichi la compostabilità.",
        "Puoi ritirare i sacchetti adeguati anche ai distributori automatici presenti sul territorio, oppure richiederne la consegna a domicilio (servizio a pagamento) contattando i riferimenti sul retro dell'EcoCalendario.",
      ],
    },
    garden: {
      container: "Contenitore beige aerato",
      sections: [
        {
          title: "Come conferire",
          items: [
            "Metti nel contenitore i rifiuti sfusi, senza usare sacchetti",
            "Non usare sacchetti di plastica, nemmeno per proteggere internamente il contenitore",
            "Esponi il contenitore con il coperchio chiuso e senza pressare eccessivamente il rifiuto",
            "Non depositare materiale o altri sacchi contenenti rifiuto vegetale sopra o accanto al contenitore",
            "Esponi il contenitore possibilmente pieno",
          ],
        },
        {
          title: "Metti nel contenitore",
          items: [
            "Ramaglie, potature di alberi e siepi",
            "Sfalci d'erba e fiori recisi",
            "Piante senza terra",
            "Residui vegetali dell'orto",
          ],
        },
      ],
      notes: [
        "Il servizio è facoltativo e a pagamento.",
        "Raccolta: 1 volta alla settimana da aprile a dicembre e 1 volta ogni 2 settimane da gennaio a marzo.",
      ],
    },
    paper: {
      container: "Contenitore giallo",
      sections: [
        {
          title: "Come conferire",
          items: [
            "Metti nel contenitore i rifiuti sfusi, senza usare sacchetti",
            "Non inserire carta sporca",
            "Esponi il contenitore con il coperchio chiuso",
            "Non depositare materiale sopra o accanto al contenitore",
            "Esponi il contenitore possibilmente pieno",
          ],
        },
        {
          title: "Metti nel contenitore",
          items: [
            "Cartoni per bevande e alimenti (es. per latte, vino, succo di frutta, passata di pomodoro, ecc.) puliti e senza parti in plastica",
            "Giornali e riviste",
            "Fogli, quaderni e libri",
            "Vassoi e confezioni in cartoncino (es. della pasta, del riso, ecc.)",
            "Scatole della pizza pulite",
            "Sacchetti di carta (es. pane, shopper, ecc.)",
            "Cartoni piegati (per grandi quantità portali all'EcoCentro, verificando prima limiti e regole d'accesso sull'EcoCalendario)",
            "Coppette per gelato pulite e bicchieri di carta",
            "Pacchetti di sigarette senza parti in plastica",
            "Rotoli e anime di carta (es. carta da cucina, carta igienica, ecc.)",
            "Salviette pulite",
          ],
        },
      ],
    },
  },
};

// English by default, Italian if Home Assistant is set to Italian
const STRINGS = {
  en: {
    locale: "en-US",
    title: "Waste collection",
    today: "Today",
    tomorrow: "Tomorrow",
    days_unit: "d",
    no_pickup: "No pickup scheduled",
    unavailable: "Unavailable",
    nothing_soon: "No upcoming pickups",
    no_sensors: "No Contarina sensors found.",
    guide_button: "What goes in",
    close: "Close",
    emptyings_title: "Residual emptyings",
    mark: "Put out?",
    marked: "Put out",
    left: "{left} left this year",
    over: "{over} over the allowance, charged separately",
    liters: "{used} of {total} L used · {bin} L bin",
    pace_ok: "You're on track: at an even pace you'd be at {expected} by now",
    pace_over: "You're using them faster than planned: at an even pace you'd be at {expected} by now",
    dates_title: "Emptyings in {year}",
    no_emptyings: "No emptyings marked yet",
    add_title: "Add a forgotten emptying",
    add: "Add",
    remove: "Remove",
    already_marked: "An emptying is already marked on this day",
    ecocenter: "EcoCentro",
    eco_state: { open: "Open", booking_only: "Booking only", closed: "Closed" },
    until: "until {time}",
    opens: "opens {when} at {time}",
    today_lc: "today",
    tomorrow_lc: "tomorrow",
    day_closed: "Closed",
    holiday_closed: "Closed (holiday)",
    special_closed: "Closed (special closure)",
    closed_morning: "Closed in the morning",
    closed_afternoon: "Closed in the afternoon",
    closures_text: "The EcoCentri will be closed: {list}.",
    closure_every: "every {day}",
    part_morning: "morning",
    part_afternoon: "afternoon",
    notice_italian: "Notice from contarina.it (in Italian): {notice}",
    booking: "booking only",
    directions: "Directions",
    eco_page: "Rules and opening hours on contarina.it",
    search_title: "Where does it go?",
    search_placeholder: "Search an item, e.g. capsule",
    search_hint: "Type at least 2 letters.",
    search_none: "Nothing found for \"{q}\"",
    search_updated_today: "Contarina waste dictionary, updated today.",
    search_updated: "Contarina waste dictionary, updated on {date}.",
    search_about_title: "About the search",
    search_about:
      "Searches the waste dictionary of contarina.it, downloaded once a day. Contarina publishes it in Italian only: the item names are translated by this integration, so items added or renamed recently may still be in Italian. Italian words work too (e.g. \"pile\" for batteries).",
    // Special collections in the search results (the bins have their own names)
    containers: {
      special_service: "Special service",
      batteries: "Battery bins",
      small_appliances: "Small appliances bins",
      toner: "Cartridges and toner bins",
      clothes: "Clothes bins",
      medicines: "Medicine bins",
    },
    search_error: "Search not available right now",
    searching: "Searching…",
    guides_title: "What goes in each bin",
    reminder_button: "Reminder",
    reminder_pickup: "Pickup: {date}",
    reminder_when: "When",
    reminder_latest: "At the latest {time} on the pickup day.",
    reminder_to: "Send to",
    reminder_ha: "Home Assistant notifications",
    reminder_all: "All app devices",
    reminder_set: "Set reminder",
    reminder_update: "Update reminder",
    reminder_current: "Reminder set: {when}",
    reminder_at: "{date} at {time}",
    reminder_too_late: "It's too late for a reminder for this pickup.",
    reminder_details: "Sensor details",
    reminder_error: "The reminder couldn't be saved.",
    guide: GUIDE.en,
    waste: {
      organic: "Organic",
      paper: "Paper",
      glass: "Glass, plastic, cans",
      residual: "Residual waste",
      garden: "Garden waste",
    },
    editor: {
      view: "Content",
      view_helper: "The pickups list, or a card with only one of its parts.",
      view_pickups: "Pickups",
      view_ecocenter: "EcoCentro only (status and opening hours)",
      view_search: "\"Where does it go?\" search only",
      title: "Title",
      title_helper: "Replaces the whole header. Write {location} to include the calendar name.",
      title_helper_search: "Replaces the header.",
      location: "Municipality",
      all_locations: "All municipalities",
      soon_days: "\"Soon\" = within how many days (0 = today only)",
      hide_when_empty: "Hide when there are no pickups to show",
      ecocenter: "Show the EcoCentro button",
      search: "Show the \"Where does it go?\" button",
      show: "When to show each waste type",
      type_days: "Days (empty = general)",
      always: "Always",
      soon: "Only soon",
      never: "Never",
    },
  },
  it: {
    locale: "it-IT",
    title: "Raccolta rifiuti",
    today: "Oggi",
    tomorrow: "Domani",
    days_unit: "gg",
    no_pickup: "Nessun ritiro in programma",
    unavailable: "Non disponibile",
    nothing_soon: "Nessun ritiro a breve",
    no_sensors: "Nessun sensore Contarina trovato.",
    guide_button: "Cosa buttare",
    close: "Chiudi",
    emptyings_title: "Svuotamenti del secco",
    mark: "Esposto?",
    marked: "Esposto",
    left: "Ne restano {left} quest'anno",
    over: "{over} oltre la soglia, addebitati a parte",
    liters: "{used} di {total} L usati · bidone da {bin} L",
    pace_ok: "Sei in linea: a ritmo regolare oggi saresti a {expected}",
    pace_over: "Li stai usando più in fretta del previsto: a ritmo regolare oggi saresti a {expected}",
    dates_title: "Svuotamenti {year}",
    no_emptyings: "Nessuno svuotamento segnato",
    add_title: "Aggiungi uno svuotamento dimenticato",
    add: "Aggiungi",
    remove: "Rimuovi",
    already_marked: "Hai già segnato uno svuotamento in questo giorno",
    ecocenter: "EcoCentro",
    eco_state: { open: "Aperto", booking_only: "Solo su prenotazione", closed: "Chiuso" },
    until: "fino alle {time}",
    opens: "apre {when} alle {time}",
    today_lc: "oggi",
    tomorrow_lc: "domani",
    day_closed: "Chiuso",
    holiday_closed: "Chiuso (festivo)",
    special_closed: "Chiuso (chiusura straordinaria)",
    closed_morning: "Chiuso la mattina",
    closed_afternoon: "Chiuso il pomeriggio",
    // Not used in Italian: the original notice is shown
    closures_text: "Gli EcoCentri rimarranno chiusi: {list}.",
    closure_every: "tutti i {day}",
    part_morning: "mattina",
    part_afternoon: "pomeriggio",
    notice_italian: "{notice}",
    booking: "su prenotazione",
    directions: "Indicazioni stradali",
    eco_page: "Regole e orari sul sito di Contarina",
    search_title: "Dove lo butto?",
    search_placeholder: "Cerca un oggetto, es. capsule",
    search_hint: "Scrivi almeno 2 lettere.",
    search_none: "Nessun risultato per \"{q}\"",
    search_updated_today: "Dizionario dei rifiuti di Contarina aggiornato a oggi.",
    search_updated: "Dizionario dei rifiuti di Contarina aggiornato al {date}.",
    search_about_title: "Come funziona la ricerca",
    search_about:
      "Cerca nel dizionario dei rifiuti di contarina.it, scaricato una volta al giorno: le voci e i contenitori sono quelli del sito.",
    // Raccolte speciali: si usano i nomi del sito
    containers: {},
    search_error: "Ricerca non disponibile al momento",
    searching: "Cerco…",
    guides_title: "Cosa va in ogni bidone",
    reminder_button: "Promemoria",
    reminder_pickup: "Raccolta: {date}",
    reminder_when: "Quando",
    reminder_latest: "Al più tardi alle {time} del giorno di raccolta.",
    reminder_to: "Invia a",
    reminder_ha: "Notifiche di Home Assistant",
    reminder_all: "Tutti i dispositivi dell'app",
    reminder_set: "Imposta promemoria",
    reminder_update: "Aggiorna promemoria",
    reminder_current: "Promemoria impostato: {when}",
    reminder_at: "{date} alle {time}",
    reminder_too_late: "È troppo tardi per un promemoria per questa raccolta.",
    reminder_details: "Dettagli del sensore",
    reminder_error: "Non è stato possibile salvare il promemoria.",
    guide: GUIDE.it,
    waste: {
      organic: "Umido",
      paper: "Carta",
      glass: "Vetro, plastica, lattine",
      residual: "Secco",
      garden: "Vegetale",
    },
    editor: {
      view: "Contenuto",
      view_helper: "L'elenco delle raccolte, oppure una card con una sola delle sue parti.",
      view_pickups: "Raccolte",
      view_ecocenter: "Solo EcoCentro (stato e orari)",
      view_search: "Solo la ricerca \"Dove lo butto?\"",
      title: "Titolo",
      title_helper: "Sostituisce tutta l'intestazione. Scrivi {location} per inserire il nome del calendario.",
      title_helper_search: "Sostituisce l'intestazione.",
      location: "Comune",
      all_locations: "Tutti i comuni",
      soon_days: "\"A breve\" = entro quanti giorni (0 = solo oggi)",
      hide_when_empty: "Nascondi se non ci sono ritiri da mostrare",
      ecocenter: "Mostra il pulsante EcoCentro",
      search: "Mostra il pulsante \"Dove lo butto?\"",
      show: "Quando mostrare ogni rifiuto",
      type_days: "Giorni (vuoto = generale)",
      always: "Sempre",
      soon: "Solo a breve",
      never: "Mai",
    },
  },
};

const stringsFor = (hass) => {
  const lang = (hass.locale?.language || hass.language || "en").split("-")[0];
  return STRINGS[lang] || STRINGS.en;
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Fills "{name}" placeholders in a string
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

// Local date as YYYY-MM-DD, the format of the sensors' dates
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// --- EcoCentro: shared by the card and the sidebar page --------------------------------

// "09:00" or a Date -> "9:00"
const fmtTime = (value) => {
  if (value instanceof Date) return `${value.getHours()}:${String(value.getMinutes()).padStart(2, "0")}`;
  const [h, m] = value.split(":");
  return `${Number(h)}:${m}`;
};

// "today", "tomorrow" or the weekday of a date
const relDay = (t, date) => {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (isoDate(date) === isoDate(today)) return t.today_lc;
  if (isoDate(date) === isoDate(tomorrow)) return t.tomorrow_lc;
  return date.toLocaleDateString(t.locale, { weekday: "long" });
};

// "Open · until 12:00", "Closed · opens Thursday at 9:00"
const ecoStatusText = (t, st) => {
  const a = st.attributes;
  if (ECO_RANK[st.state] === undefined) return t.unavailable;
  if (st.state !== "closed") {
    const until = a.open_until ? ` · ${fill(t.until, { time: fmtTime(new Date(a.open_until)) })}` : "";
    return t.eco_state[st.state] + until;
  }
  if (!a.next_opening) return t.eco_state.closed;
  const next = new Date(a.next_opening);
  return `${t.eco_state.closed} · ${fill(t.opens, { when: relDay(t, next), time: fmtTime(next) })}`;
};

// --- Extraordinary closures, read by the integration from the notice of contarina.it ----
// closures = {weekdays: [{weekday, part}], days: [{date, part}]}, part = all | morning |
// afternoon; the same rules as closed_part/open_slots in ecocenter_pages.py

const NOON = "12:00";
const weekdayName = (t, weekday) => new Date(2024, 0, 1 + weekday).toLocaleDateString(t.locale, { weekday: "long" });

const closedPart = (closures, date) => {
  if (!closures) return null;
  const parts = new Set();
  const weekday = (date.getDay() + 6) % 7;
  (closures.weekdays || []).forEach((c) => c.weekday === weekday && parts.add(c.part));
  const iso = isoDate(date);
  (closures.days || []).forEach((c) => c.date === iso && parts.add(c.part));
  if (!parts.size) return null;
  return parts.size === 1 ? [...parts][0] : "all";
};

// A day's slots without the closed part (a slot across noon is cut there)
const openSlots = (slots, part) => {
  if (!part) return slots;
  if (part === "all") return [];
  return slots
    .filter((s) => (part === "afternoon" ? s.from < NOON : s.to > NOON))
    .map((s) =>
      part === "afternoon" && s.to > NOON ? { ...s, to: NOON } : part === "morning" && s.from < NOON ? { ...s, from: NOON } : s
    );
};

// The closures notice in the user's language: the original in Italian; otherwise written
// from the dates read by the integration (past days left out), or the Italian text with a
// note when the integration couldn't read it
const ecoNoticeText = (t, notice, closures) => {
  if (!notice) return null;
  if (t.locale.startsWith("it")) return notice;
  if (!closures) return fill(t.notice_italian, { notice });
  const part = (p) => (p === "morning" ? ` (${t.part_morning})` : p === "afternoon" ? ` (${t.part_afternoon})` : "");
  const now = new Date();
  const today = isoDate(now);
  const items = [
    ...(closures.weekdays || []).map((c) => fill(t.closure_every, { day: weekdayName(t, c.weekday) }) + part(c.part)),
    ...(closures.days || [])
      .filter((c) => c.date >= today)
      .map((c) => {
        const date = new Date(`${c.date}T00:00:00`);
        const opts = { weekday: "long", day: "numeric", month: "long" };
        if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
        return date.toLocaleDateString(t.locale, opts) + part(c.part);
      }),
  ];
  return items.length ? fill(t.closures_text, { list: items.join("; ") }) : null;
};

// A center: address, status, weekly hours, note and directions. `st` is an EcoCentro
// sensor state, or the same shape from the contarina/ecocenters websocket command
const renderCenter = (t, st) => {
  const a = st.attributes;
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7; // Monday = 0, as in opening_hours
  const holidays = a.holidays || [];
  const closed = (text) => `<span class="closed-day">${esc(text)}</span>`;
  const rows = (a.opening_hours || [])
    .map((weekly, i) => {
      // 1 January 2024 was a Monday
      const day = capitalize(weekdayName(t, i));
      // The coming occurrence of this weekday: closed if it's a national holiday or an
      // extraordinary closure
      const date = new Date(now);
      date.setDate(now.getDate() + ((i - todayIndex + 7) % 7));
      const part = weekly.length ? closedPart(a.closures, date) : null;
      const slots = openSlots(weekly, part);
      const hours = holidays.includes(isoDate(date))
        ? closed(t.holiday_closed)
        : part && !slots.length
        ? closed(t.special_closed)
        : slots.length
        ? slots
            .map(
              (s) =>
                `<span class="slot">${esc(fmtTime(s.from))}–${esc(fmtTime(s.to))}${
                  s.booking ? ` <span class="tag">${esc(t.booking)}</span>` : ""
                }</span>`
            )
            .join("") + (part ? closed(part === "morning" ? t.closed_morning : t.closed_afternoon) : "")
        : closed(t.day_closed);
      return `<tr class="${i === todayIndex ? "today" : ""}"><th>${esc(day)}</th><td>${hours}</td></tr>`;
    })
    .join("");
  const directions =
    a.latitude != null && a.longitude != null
      ? `<a class="eco-link" target="_blank" rel="noopener noreferrer"
          href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${a.latitude},${a.longitude}`)}">
          <ha-icon icon="mdi:directions"></ha-icon>${esc(t.directions)}</a>`
      : "";
  return `
    <div class="guide-title">${esc(a.address || "")}</div>
    <div class="eco-status ${esc(st.state)}"><span class="dot ${esc(st.state)}"></span>${esc(ecoStatusText(t, st))}</div>
    <table class="hours">${rows}</table>
    ${a.note ? `<p class="eco-note">${esc(a.note)}</p>` : ""}
    ${directions}`;
};

// Styles of renderCenter's markup
const ECO_CSS = `
  .guide-title { font-weight: 500; margin-top: 16px; }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--disabled-text-color, #9e9e9e); }
  .dot.open { background: var(--success-color, #43a047); }
  .dot.booking_only { background: var(--warning-color, #ffa600); }
  .eco-status { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-weight: 500; }
  .eco-status.open { color: var(--success-color, #43a047); }
  .eco-status.booking_only { color: var(--warning-color, #ffa600); }
  .eco-status.closed { color: var(--secondary-text-color); }
  .hours { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .hours th, .hours td {
    padding: 5px 0; text-align: left; vertical-align: top;
    border-bottom: 1px solid var(--divider-color);
  }
  .hours th { width: 38%; padding-right: 8px; font-weight: 400; color: var(--secondary-text-color); }
  .hours tr.today th, .hours tr.today td { font-weight: 500; color: var(--primary-text-color); }
  .hours .slot { display: block; }
  .hours .closed-day { display: block; color: var(--secondary-text-color); }
  .tag { font-size: 0.85em; color: var(--warning-color, #ffa600); }
  .guide p.eco-note, p.eco-note { color: var(--warning-color, #ffa600); }
  .eco-link {
    display: inline-flex; align-items: center; gap: 4px; margin-top: 10px;
    color: var(--primary-color); text-decoration: none; --mdc-icon-size: 18px;
  }
  .eco-link:hover { text-decoration: underline; }
`;

// --- Pickup reminders: shared by the card and the sidebar page --------------------------

// Reminders are due at the latest at this hour of the pickup day (REMINDER_LATEST_HOUR)
const REMINDER_LATEST_HOUR = 6;
// From this hour today's pickup is over, as for the "next pickup" sensor (PICKUP_DONE_HOUR)
const PICKUP_DONE_HOUR = 12;
// Default: the evening before the pickup
const REMINDER_DEFAULT_HOUR = 20;
const NOTIFY_STORAGE_KEY = "contarina-reminder-notify";

const pad2 = (n) => String(n).padStart(2, "0");
// Value of a datetime-local input
const localDateTime = (d) => `${isoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// The reminder of a waste sensor for a pickup day, if any: {date, at, notify}
const reminderFor = (st, day) => (st?.attributes.reminders || []).find((r) => r.date === day) || null;

// Notify services a reminder can go to (the Companion app's are mobile_app_<device>)
const notifyServices = (hass) =>
  Object.keys(hass.services?.notify || {})
    .filter((s) => s !== "send_message" && s !== "persistent_notification")
    .sort((a, b) => Number(b.startsWith("mobile_app_")) - Number(a.startsWith("mobile_app_")) || a.localeCompare(b));

// Like HA's slugify: how the Companion app turns a device name into its notify service
const slugify = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Device of a mobile_app_<device> service: its registry name is the one the app registered
const notifyDevice = (hass, service) => {
  if (!service.startsWith("mobile_app_")) return null;
  const slug = service.slice("mobile_app_".length);
  return Object.values(hass.devices || {}).find((d) => d.name && slugify(d.name) === slug) || null;
};

// {label, icon} of a reminder target ("" = Home Assistant's own notifications)
const notifyTarget = (hass, service) => {
  const t = stringsFor(hass);
  if (!service) return { label: t.reminder_ha, icon: "mdi:bell-outline" };
  // notify.notify is the Companion app's service for all its devices
  if (service === "notify") return { label: t.reminder_all, icon: "mdi:devices" };
  const device = notifyDevice(hass, service);
  const fallback = capitalize(service.replace(/^mobile_app_/, "").replace(/_/g, " "));
  const label = (device?.name_by_user || device?.name || "").trim() || fallback;
  if (!service.startsWith("mobile_app_")) return { label, icon: "mdi:message-outline" };
  const kind = `${device?.name || ""} ${device?.model || ""}`;
  const icon = /watch/i.test(kind) ? "mdi:watch-variant" : /ipad|tablet/i.test(kind) ? "mdi:tablet" : "mdi:cellphone";
  return { label, icon };
};

/*
 * Popup to set a one-off reminder for a pickup: by default the evening before at 20:00,
 * at the latest 6:00 on the pickup day. Saved by the contarina.add_reminder action, which
 * sends the notification at that time. Appended to the page's body, so it can be opened
 * by the card and by the sidebar page alike.
 */
class ContarinaReminderDialog extends HTMLElement {
  static open(options) {
    const dialog = document.createElement("contarina-reminder-dialog");
    document.body.append(dialog);
    dialog.show(options);
    return dialog;
  }

  // {hass, entityId (waste sensor), date (pickup day, YYYY-MM-DD), color, origin}
  show({ hass, entityId, date, color, origin }) {
    this._hass = hass;
    this._entityId = entityId;
    this._date = date;
    this._origin = origin || null;
    const t = stringsFor(hass);
    this._t = t;
    const st = hass.states[entityId];
    const waste = st?.attributes.waste;
    const style = WASTE_STYLE[waste] || { icon: "mdi:delete", color: "#9e9e9e" };
    const current = reminderFor(st, date);

    const pickup = new Date(`${date}T00:00:00`);
    const latest = new Date(pickup);
    latest.setHours(REMINDER_LATEST_HOUR);
    const now = new Date();
    now.setSeconds(0, 0);
    // The integration's defaults (by default the evening before at 20:00); if that time is
    // gone, the next quarter of an hour
    const defaults = st?.attributes.reminder_defaults || {};
    const [hours, minutes] = String(defaults.time || `${REMINDER_DEFAULT_HOUR}:00`).split(":").map(Number);
    let value = new Date(pickup);
    value.setDate(value.getDate() - (Number.isInteger(defaults.days) ? defaults.days : 1));
    value.setHours(hours || 0, minutes || 0);
    if (current) value = new Date(current.at);
    if (value <= now) {
      value = new Date(now);
      value.setMinutes(Math.ceil((now.getMinutes() + 1) / 15) * 15);
    }
    if (value > latest) value = latest;
    const tooLate = now >= latest;

    const services = notifyServices(hass);
    let stored = null;
    try {
      stored = localStorage.getItem(NOTIFY_STORAGE_KEY);
    } catch (err) {
      // Blocked storage: no remembered choice
    }
    // The current reminder's, else the integration's default, else the last one used, else
    // the first phone
    const preset = defaults.notify === "persistent_notification" ? "" : defaults.notify;
    const target = current
      ? current.notify || ""
      : preset !== undefined && preset !== "last_used" && (preset === "" || services.includes(preset))
      ? preset
      : stored !== null && (stored === "" || services.includes(stored))
      ? stored
      : services.find((s) => s.startsWith("mobile_app_")) || "";

    const longDate = (d) => capitalize(d.toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" }));
    const when = (d) => fill(t.reminder_at, { date: longDate(d), time: fmtTime(d) });
    const currentText = current
      ? `<div class="current"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>
           <span>${esc(fill(t.reminder_current, { when: when(new Date(current.at)) }))}${
             current.notify ? ` · ${esc(notifyTarget(hass, current.notify).label)}` : ""
           }</span>
           <button class="remove" title="${esc(t.remove)}" aria-label="${esc(t.remove)}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
         </div>`
      : "";
    const form = tooLate
      ? `<p class="muted">${esc(t.reminder_too_late)}</p>`
      : `
        <label for="at">${esc(t.reminder_when)}</label>
        <input id="at" type="datetime-local" value="${localDateTime(value)}" min="${localDateTime(now)}" max="${localDateTime(latest)}">
        <p class="muted">${esc(fill(t.reminder_latest, { time: `${REMINDER_LATEST_HOUR}:00` }))}</p>
        <label for="notify">${esc(t.reminder_to)}</label>
        <div class="target">
          <ha-icon icon="${notifyTarget(hass, target).icon}"></ha-icon>
          <select id="notify">
            ${["", ...services]
              .map((v) => `<option value="${esc(v)}" ${v === target ? "selected" : ""}>${esc(notifyTarget(hass, v).label)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="actions">
          ${this._origin ? `<button class="link details">${esc(t.reminder_details)}</button>` : "<span></span>"}
          <button class="save">${esc(current ? t.reminder_update : t.reminder_set)}</button>
        </div>`;

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        dialog {
          width: min(420px, calc(100vw - 32px)); padding: 0; border: none;
          border-radius: var(--ha-card-border-radius, 12px);
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif);
        }
        dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
        .head {
          display: flex; align-items: center; gap: 12px;
          padding: 16px 12px 12px 16px; border-bottom: 1px solid var(--divider-color);
        }
        .badge {
          flex: none; width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--c) 20%, transparent); color: var(--c);
        }
        .info { flex: 1; min-width: 0; }
        .name { font-weight: 500; }
        .sub, .muted { color: var(--secondary-text-color); font-size: 0.9em; }
        .body { padding: 8px 20px 20px; display: flex; flex-direction: column; }
        label { margin-top: 14px; font-weight: 500; }
        input, select {
          margin-top: 6px; padding: 8px 10px; font: inherit; box-sizing: border-box; width: 100%;
          border: 1px solid var(--divider-color); border-radius: 8px;
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          color-scheme: light dark;
        }
        .target { position: relative; }
        .target ha-icon {
          position: absolute; left: 10px; top: calc(50% + 3px); transform: translateY(-50%);
          --mdc-icon-size: 20px; color: var(--secondary-text-color); pointer-events: none;
        }
        .target select { padding-left: 38px; }
        p { margin: 6px 0 0; }
        .current {
          display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 8px 4px 8px 10px;
          border-radius: 10px; background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
          --mdc-icon-size: 20px;
        }
        .current span { flex: 1; }
        .current ha-icon { color: var(--primary-color); }
        .close, .remove {
          flex: none; display: flex; padding: 6px; border: none; border-radius: 50%;
          background: none; color: var(--secondary-text-color); cursor: pointer;
        }
        .close:hover, .remove:hover { color: var(--primary-color); }
        .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 20px; }
        .save {
          padding: 8px 18px; font: inherit; border: none; border-radius: 8px; cursor: pointer;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
        }
        .save:disabled { opacity: 0.6; cursor: default; }
        .link { padding: 0; border: none; background: none; font: inherit; color: var(--primary-color); cursor: pointer; }
        .error { color: var(--error-color, #db4437); }
      </style>
      <dialog>
        <div class="head">
          <div class="badge" style="--c:${esc(color || style.color)}"><ha-icon icon="${style.icon}"></ha-icon></div>
          <div class="info">
            <div class="name">${esc(t.reminder_button)} · ${esc(t.waste[waste] || waste || "")}</div>
            <div class="sub">${esc(fill(t.reminder_pickup, { date: longDate(pickup) }))}${
              st?.attributes.location ? ` · ${esc(st.attributes.location)}` : ""
            }</div>
          </div>
          <button class="close" title="${esc(t.close)}" aria-label="${esc(t.close)}"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        <div class="body">
          ${currentText}
          ${form}
          <p class="error" hidden></p>
        </div>
      </dialog>`;
    this._dialog = this.shadowRoot.querySelector("dialog");
    this._dialog.addEventListener("click", (ev) => this._click(ev));
    this.shadowRoot.querySelector("#notify")?.addEventListener("change", (ev) => {
      this.shadowRoot.querySelector(".target ha-icon").setAttribute("icon", notifyTarget(hass, ev.target.value).icon);
    });
    this._dialog.addEventListener("close", () => this.remove());
    this._dialog.showModal();
  }

  async _call(service, data) {
    const error = this.shadowRoot.querySelector(".error");
    const buttons = this.shadowRoot.querySelectorAll("button.save, button.remove");
    buttons.forEach((b) => (b.disabled = true));
    error.hidden = true;
    try {
      // The error is shown here, not in a toast as well
      await this._hass.callService(
        "contarina",
        service,
        { entity_id: this._entityId, date: this._date, ...data },
        undefined,
        false
      );
      this._dialog.close();
    } catch (err) {
      error.textContent = await this._errorText(err);
      error.hidden = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  // The backend's message is always in English ("Validation error: ..."): translated here
  // from the integration's exceptions, in the user's language
  async _errorText(err) {
    const domain = err?.translation_domain;
    if (domain && err.translation_key && this._hass.loadBackendTranslation) {
      try {
        const localize = await this._hass.loadBackendTranslation("exceptions", domain);
        const text = localize(`component.${domain}.exceptions.${err.translation_key}.message`, err.translation_placeholders || {});
        if (text) return text;
      } catch (e) {
        // Fall back to the English message
      }
    }
    return String(err?.message || this._t.reminder_error).replace(/^Validation error:\s*/i, "");
  }

  _click(ev) {
    if (ev.target === this._dialog || ev.target.closest(".close")) {
      this._dialog.close();
      return;
    }
    if (ev.target.closest(".remove")) {
      this._call("remove_reminder", {});
      return;
    }
    if (ev.target.closest(".details")) {
      this._origin.dispatchEvent(
        new CustomEvent("hass-more-info", { detail: { entityId: this._entityId }, bubbles: true, composed: true })
      );
      this._dialog.close();
      return;
    }
    if (ev.target.closest(".save")) {
      const at = this.shadowRoot.querySelector("#at").value;
      const notify = this.shadowRoot.querySelector("#notify").value;
      if (!at) return;
      try {
        localStorage.setItem(NOTIFY_STORAGE_KEY, notify);
      } catch (err) {
        // Not remembered: fine
      }
      this._call("add_reminder", { at: `${at.replace("T", " ")}:00`, notify: notify || null });
    }
  }
}

if (!customElements.get("contarina-reminder-dialog")) {
  customElements.define("contarina-reminder-dialog", ContarinaReminderDialog);
}

const openReminder = (options) => ContarinaReminderDialog.open(options);

class ContarinaCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._lastKey = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._t = stringsFor(hass);
    // The open emptyings popup follows its sensor (dates added or removed)
    if (this._dialogSensor) this._renderEmptyingsDialog();
    // The open EcoCentro popup follows its sensors (open/closed)
    if (this._dialogEco) this._renderEcoDialog();
    // view: search shows no sensors: render it once, so the typed text isn't wiped
    const groups = this._config.view === "search" ? [] : this._collect();
    // Re-render only if the language or the displayed sensors change
    const key = this._t.locale + (this._config.view || "") + JSON.stringify(groups);
    if (key === this._lastKey) return;
    this._lastKey = key;
    this._render(groups);
  }

  getCardSize() {
    if (!this._lastGroups) return 6;
    return this._lastGroups.reduce((n, g) => n + 1 + g.items.length, 0);
  }

  static getStubConfig() {
    return {};
  }

  static getConfigElement() {
    return document.createElement("contarina-card-editor");
  }

  _visible(waste, days) {
    const mode = (this._config.show || {})[waste] ?? "always";
    if (mode === "never") return false;
    if (mode === "always") return true;
    // "soon" uses soon_days, a number is the override for this type
    const limit = typeof mode === "number" ? mode : this._config.soon_days ?? 1;
    return days !== null && days <= limit;
  }

  _collect() {
    const states = this._hass.states;
    const location = this._config.location;
    let ids = this._config.entities;
    if (!ids || !ids.length) {
      ids = contarinaSensorIds(states);
      if (location) {
        // Match the calendar name first: another calendar of the same municipality
        // (e.g. "Altivole Casa2" next to "Altivole") must not be included
        const attr = (id) => states[id].attributes;
        const byName = ids.filter((id) => (attr(id).location || attr(id).municipality_name) === location);
        ids = byName.length ? byName : ids.filter((id) => attr(id).municipality_name === location);
      }
    }

    // Emptyings sensor of each entry, shown on its residual row
    const emptyingsSensors = {};
    Object.keys(states).forEach((id) => {
      const a = states[id].attributes;
      if (id.startsWith("sensor.") && a.emptyings_total !== undefined) emptyingsSensors[a.entry_id] = id;
    });

    // One group per config entry (two entries of the same municipality stay separate)
    const groups = new Map();
    ids
      .filter((id) => states[id])
      .forEach((id) => {
        const st = states[id];
        const a = st.attributes;
        const groupKey = a.entry_id || a.municipality_name || "";
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            location: a.location || a.municipality_name || "",
            entryId: a.entry_id || null,
            eco: this._config.ecocenter === false ? [] : this._ecoStates(a.entry_id),
            items: [],
          });
        }
        const parsed = Number.parseInt(st.state, 10);
        const days = Number.isNaN(parsed) ? null : parsed;
        const waste = a.waste || a.friendly_name || id;
        // The group stays even if all pickups are hidden, so the header is still shown
        if (!this._visible(waste, days)) return;
        groups.get(groupKey).items.push({
          id,
          waste,
          state: st.state,
          days,
          // Today's pickup is over in the afternoon: no longer highlighted
          done: days === 0 && new Date().getHours() >= PICKUP_DONE_HOUR,
          nextDate: a.next_date || null,
          reminder: a.next_date ? reminderFor(st, a.next_date) : null,
          emptyings: waste === "residual" ? this._emptyingsInfo(emptyingsSensors[a.entry_id], a.next_date) : null,
        });
      });

    const result = [...groups.values()];
    // Nearest pickups first, then those without a date
    result.forEach((g) =>
      g.items.sort((a, b) => {
        if (a.days === null) return 1;
        if (b.days === null) return -1;
        return a.days - b.days;
      })
    );
    result.sort((a, b) => a.location.localeCompare(b.location, this._t.locale));
    this._lastGroups = result;
    return result;
  }

  // EcoCentro sensors of a config entry (two for the municipalities with two centers)
  _ecoIds(entryId) {
    if (!entryId) return [];
    const states = this._hass.states;
    return Object.keys(states)
      .filter((id) => {
        const a = states[id].attributes;
        return id.startsWith("sensor.") && a.opening_hours !== undefined && a.entry_id === entryId;
      })
      .sort();
  }

  // What the button and the inline hours show, so the card re-renders when it changes
  _ecoStates(entryId) {
    return this._ecoIds(entryId).map((id) => {
      const st = this._hass.states[id];
      const a = st.attributes;
      return { id, state: st.state, until: a.open_until, next: a.next_opening, holidays: a.holidays };
    });
  }

  _emptyingsInfo(id, nextDate) {
    if (!id) return null;
    const st = this._hass.states[id];
    return {
      id,
      used: Number(st.state),
      total: st.attributes.emptyings_total,
      marked: !!nextDate && (st.attributes.dates || []).includes(nextDate),
    };
  }

  _num(n) {
    return Number(n).toLocaleString(this._t.locale, { maximumFractionDigits: 1 });
  }

  _longDate(iso) {
    const date = new Date(`${iso}T00:00:00`);
    return capitalize(date.toLocaleDateString(this._t.locale, { weekday: "long", day: "numeric", month: "long" }));
  }

  _when(item) {
    if (item.days === null) {
      if (item.state === "unknown") return this._t.no_pickup;
      if (item.state === "unavailable") return this._t.unavailable;
      return item.state;
    }
    // Date only: the "when" (Today, Tomorrow, N d) is already on the right
    let date;
    if (item.nextDate) {
      date = new Date(`${item.nextDate}T00:00:00`);
    } else {
      date = new Date();
      date.setDate(date.getDate() + item.days);
    }
    return capitalize(
      date.toLocaleDateString(this._t.locale, {
        weekday: "long",
        day: "numeric",
        month: "short",
      })
    );
  }

  _renderDays(item) {
    if (item.days === null) return "";
    if (item.days === 0) return `<div class="days soon ${item.done ? "done" : ""}">${this._t.today}</div>`;
    if (item.days === 1) return `<div class="days soon">${this._t.tomorrow}</div>`;
    return `<div class="days">${item.days}<span>${this._t.days_unit}</span></div>`;
  }

  _renderRow(item) {
    const style = WASTE_STYLE[item.waste] || { icon: "mdi:delete", color: "#9e9e9e" };
    const color = (this._config.colors || {})[item.waste] || style.color;
    const urgent = item.days !== null && item.days <= 1 && !item.done;
    const guide = this._t.guide[item.waste];
    return `
      <div class="row ${urgent ? "urgent" : ""}" data-entity="${esc(item.id)}">
        <div class="badge" style="--c:${esc(color)}">
          <ha-icon icon="${style.icon}"></ha-icon>
        </div>
        <div class="info">
          <div class="name">${esc(this._t.waste[item.waste] || item.waste)}</div>
          <div class="when">
            <span class="when-text">${esc(this._when(item))}</span>
            ${item.reminder ? this._renderBell(item.reminder) : ""}
            ${item.emptyings ? this._renderCount(item.emptyings) : ""}
          </div>
        </div>
        ${this._renderDays(item)}
        ${item.emptyings ? this._renderMark(item) : ""}
        ${
          guide
            ? `<button class="info-btn" data-waste="${esc(item.waste)}" title="${esc(this._t.guide_button)}"
                aria-label="${esc(this._t.guide_button)}" aria-haspopup="dialog">
                <ha-icon icon="mdi:information-outline"></ha-icon>
              </button>`
            : ""
        }
      </div>`;
  }

  // A reminder is set for the next pickup: bell with its time
  _renderBell(reminder) {
    const at = new Date(reminder.at);
    const date = capitalize(at.toLocaleDateString(this._t.locale, { weekday: "short", day: "numeric", month: "short" }));
    const label = fill(this._t.reminder_current, { when: fill(this._t.reminder_at, { date, time: fmtTime(at) }) });
    return `<span class="bell" title="${esc(label)}" aria-label="${esc(label)}"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>${esc(
      fmtTime(at)
    )}</span>`;
  }

  _renderCount(e) {
    // Red once the allowance is used up: further emptyings are charged
    const full = e.used >= e.total;
    return `
      <button class="count-btn ${full ? "full" : ""}" data-sensor="${esc(e.id)}" title="${esc(this._t.emptyings_title)}">
        <ha-icon icon="mdi:counter"></ha-icon>${esc(e.used)}/${esc(this._num(e.total))}
      </button>`;
  }

  _renderMark(item) {
    // Only around pickup day: the bin goes out the evening before
    if (!item.nextDate || item.days === null || item.days > 1) return "";
    const e = item.emptyings;
    const label = e.marked ? this._t.marked : this._t.mark;
    return `
      <button class="mark-btn ${e.marked ? "marked" : ""}" data-sensor="${esc(e.id)}"
        data-date="${esc(item.nextDate)}" title="${esc(label)}" aria-label="${esc(label)}"
        aria-pressed="${e.marked}">
        <ha-icon icon="${e.marked ? "mdi:check-circle" : "mdi:checkbox-blank-circle-outline"}"></ha-icon>
      </button>`;
  }

  _openEmptyings(sensorId) {
    this._dialogEco = null;
    this._dialogSensor = sensorId;
    this._dialogKey = null;
    this._renderEmptyingsDialog();
    this._dialog.showModal();
  }

  _renderEmptyingsDialog() {
    const st = this._hass.states[this._dialogSensor];
    if (!st) return;
    // Rebuild only when the sensor changes, so a date being picked isn't wiped
    const key = this._t.locale + st.state + JSON.stringify(st.attributes);
    if (key === this._dialogKey) return;
    this._dialogKey = key;

    const t = this._t;
    const a = st.attributes;
    const used = Number(st.state);
    const left = a.emptyings_total - used;
    const color = (this._config.colors || {}).residual || WASTE_STYLE.residual.color;
    const now = new Date();
    const today = isoDate(now);
    const dates = [...(a.dates || [])].reverse();
    const dateList = dates.length
      ? `<ul class="date-list">${dates
          .map(
            (d) => `
            <li>
              <span>${esc(this._longDate(d))}</span>
              <button class="remove-btn" data-date="${esc(d)}" title="${esc(t.remove)}" aria-label="${esc(t.remove)}">
                <ha-icon icon="mdi:delete-outline"></ha-icon>
              </button>
            </li>`
          )
          .join("")}</ul>`
      : `<p>${esc(t.no_emptyings)}</p>`;

    this._dialog.innerHTML = `
      <div class="dialog-header">
        <div class="badge" style="--c:${esc(color)}">
          <ha-icon icon="${WASTE_STYLE.residual.icon}"></ha-icon>
        </div>
        <div class="info">
          <div class="name">${esc(t.emptyings_title)}</div>
          <div class="when">${esc(a.location || "")}</div>
        </div>
        <button class="close-btn" title="${esc(t.close)}" aria-label="${esc(t.close)}">
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <div class="guide">
        <div class="stat ${used >= a.emptyings_total ? "full" : ""}"><span class="big">${esc(used)}</span> / ${esc(this._num(a.emptyings_total))}</div>
        <p>${esc(left >= 0 ? fill(t.left, { left: this._num(left) }) : fill(t.over, { over: this._num(-left) }))}</p>
        <p>${esc(fill(t.liters, { used: a.liters_used, total: a.liters_total, bin: a.bin_liters }))}</p>
        <p>${esc(fill(used <= a.expected_by_now ? t.pace_ok : t.pace_over, { expected: this._num(a.expected_by_now) }))}</p>
        <div class="guide-title">${esc(fill(t.dates_title, { year: now.getFullYear() }))}</div>
        ${dateList}
        <div class="guide-title">${esc(t.add_title)}</div>
        <div class="add-row">
          <input type="date" class="add-date" value="${today}" min="${now.getFullYear()}-01-01" max="${today}">
          <button class="add-btn">${esc(t.add)}</button>
        </div>
        <p class="add-error" hidden>${esc(t.already_marked)}</p>
      </div>`;
  }

  _callEmptying(service, entityId, day) {
    this._hass.callService("contarina", service, { entity_id: entityId, date: day });
  }

  _dialogClick(ev) {
    // Click on the backdrop (outside the content) or on the close button
    if (ev.target === this._dialog || ev.target.closest(".close-btn")) {
      this._dialog.close();
      return;
    }
    // A bin in the search results: open its guide
    const chip = ev.target.closest(".chip[data-waste]");
    if (chip) {
      this._openGuide(chip.dataset.waste);
      return;
    }
    const remove = ev.target.closest(".remove-btn");
    if (remove) {
      this._callEmptying("remove_emptying", this._dialogSensor, remove.dataset.date);
      return;
    }
    if (ev.target.closest(".add-btn")) {
      const day = this._dialog.querySelector(".add-date").value;
      if (!day) return;
      // A day already marked isn't added again: tell the user instead
      const dates = this._hass.states[this._dialogSensor]?.attributes.dates || [];
      const duplicate = dates.includes(day);
      this._dialog.querySelector(".add-error").hidden = !duplicate;
      if (!duplicate) this._callEmptying("add_emptying", this._dialogSensor, day);
    }
  }

  _openGuide(waste) {
    this._dialogSensor = null;
    this._dialogEco = null;
    const guide = this._t.guide[waste];
    const style = WASTE_STYLE[waste];
    const color = (this._config.colors || {})[waste] || style.color;
    const sections = guide.sections
      .map(
        (s) => `
        <div class="guide-title">${esc(s.title)}</div>
        <ul class="${s.items.length > 8 ? "cols" : ""}">
          ${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}
        </ul>`
      )
      .join("");
    const notes = (guide.notes || []).map((n) => `<p>${esc(n)}</p>`).join("");
    this._dialog.innerHTML = `
      <div class="dialog-header">
        <div class="badge" style="--c:${esc(color)}">
          <ha-icon icon="${style.icon}"></ha-icon>
        </div>
        <div class="info">
          <div class="name">${esc(this._t.waste[waste])}</div>
          <div class="when">${esc(guide.container)}</div>
        </div>
        <button class="close-btn" title="${esc(this._t.close)}" aria-label="${esc(this._t.close)}">
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <div class="guide">${sections}${notes}</div>`;
    this._dialog.showModal();
  }

  // Button next to the header: the best state among the municipality's centers
  _renderEcoButton(g) {
    if (!g.eco.length || this._config.ecocenter === "inline") return "";
    const known = g.eco.filter((e) => ECO_RANK[e.state] !== undefined);
    const best = known.sort((a, b) => ECO_RANK[a.state] - ECO_RANK[b.state])[0]?.state;
    const label = best ? `${this._t.ecocenter} · ${this._t.eco_state[best]}` : this._t.ecocenter;
    return `
      <button class="eco-btn ${best || ""}" data-entry="${esc(g.entryId)}" title="${esc(label)}"
        aria-label="${esc(label)}" aria-haspopup="dialog">
        <ha-icon icon="${ECO_STYLE.icon}"></ha-icon>
        <span class="eco-label">${esc(this._t.ecocenter)}</span>
        ${best ? `<span class="dot ${best}"></span><span class="eco-state">${esc(this._t.eco_state[best])}</span>` : ""}
      </button>`;
  }

  // ecocenter: inline: the centers' hours right below the pickups, instead of a popup
  _renderEcoInline(g) {
    if (this._config.ecocenter !== "inline" || !g.eco.length) return "";
    return `
      <div class="eco-inline guide">
        <div class="eco-inline-title">
          <ha-icon icon="${ECO_STYLE.icon}"></ha-icon>${esc(this._t.ecocenter)}
        </div>
        ${this._renderCenters(g)}
      </div>`;
  }

  _renderCenters(g) {
    const states = this._hass.states;
    const ids = g.eco.map((e) => e.id).filter((id) => states[id]);
    const first = ids.length ? states[ids[0]].attributes : {};
    const notice = ecoNoticeText(this._t, first.notice, first.closures);
    return `
      ${ids.map((id) => this._renderCenter(states[id])).join("")}
      ${notice ? `<p>${esc(notice)}</p>` : ""}`;
  }

  // view: ecocenter: only the EcoCentro of each calendar, with its hours
  _renderEcoView(groups) {
    return groups
      .filter((g) => g.eco.length)
      .map(
        (g) => `
        <div class="header">
          <ha-icon class="header-icon" icon="${ECO_STYLE.icon}"></ha-icon>
          <span class="header-title">${esc(
            this._config.title ? this._config.title.replaceAll("{location}", g.location) : this._t.ecocenter
          )}</span>
        </div>
        <div class="guide eco-view">${this._renderCenters(g)}</div>`
      )
      .join("");
  }

  // view: search: the "where does it go?" search always open, then the bins' guides
  _renderSearchView() {
    const t = this._t;
    const bins = WASTE_KEYS.filter((key) => t.guide[key])
      .map((key) => this._renderContainer({ type: key }))
      .join("");
    return `
      <div class="header"><span class="header-title">${esc(this._config.title || t.search_title)}${this._searchAboutButton()}</span></div>
      ${this._searchAbout()}
      <div class="guide search-view">
        ${this._searchBox()}
        <div class="guide-title">${esc(t.guides_title)}</div>
        <div class="chips">${bins}</div>
      </div>`;
  }

  _openEco(entryId) {
    this._dialogSensor = null;
    this._dialogEco = entryId;
    this._dialogKey = null;
    this._renderEcoDialog();
    this._dialog.showModal();
  }

  _renderCenter(st) {
    return renderCenter(this._t, st);
  }

  _renderEcoDialog() {
    const states = this._hass.states;
    const ids = this._ecoIds(this._dialogEco);
    // Rebuild only when the sensors change
    const key = this._t.locale + JSON.stringify(ids.map((id) => [states[id].state, states[id].attributes]));
    if (key === this._dialogKey) return;
    this._dialogKey = key;

    const t = this._t;
    const first = ids.length ? states[ids[0]].attributes : {};
    const color = (this._config.colors || {}).ecocenter || ECO_STYLE.color;
    this._dialog.innerHTML = `
      <div class="dialog-header">
        <div class="badge" style="--c:${esc(color)}">
          <ha-icon icon="${ECO_STYLE.icon}"></ha-icon>
        </div>
        <div class="info">
          <div class="name">${esc(t.ecocenter)}</div>
          <div class="when">${esc(first.location || "")}</div>
        </div>
        <button class="close-btn" title="${esc(t.close)}" aria-label="${esc(t.close)}">
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <div class="guide">
        ${ids.map((id) => this._renderCenter(states[id])).join("")}
        ${(() => {
          const notice = ecoNoticeText(t, first.notice, first.closures);
          return notice ? `<p>${esc(notice)}</p>` : "";
        })()}
        <p><a class="eco-link" href="${ECO_HOURS_URL}" target="_blank" rel="noopener noreferrer">
          <ha-icon icon="mdi:open-in-new"></ha-icon>${esc(t.eco_page)}</a></p>
      </div>`;
  }

  _openSearch() {
    this._dialogSensor = null;
    this._dialogEco = null;
    const t = this._t;
    this._dialog.innerHTML = `
      <div class="dialog-header">
        <div class="badge" style="--c:var(--primary-color)">
          <ha-icon icon="mdi:magnify"></ha-icon>
        </div>
        <div class="info">
          <div class="name">${esc(t.search_title)}${this._searchAboutButton()}</div>
        </div>
        <button class="close-btn" title="${esc(t.close)}" aria-label="${esc(t.close)}">
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <div class="guide">${this._searchBox()}</div>
      ${this._searchAbout()}`;
    this._dialog.showModal();
    this._dialog.querySelector(".search-input").focus();
  }

  // Search field and results: in the popup or, with view: search, in the card itself
  _searchBox() {
    const t = this._t;
    return `
      <div class="search-box">
        <input type="search" class="search-input" placeholder="${esc(t.search_placeholder)}"
          aria-label="${esc(t.search_title)}" autocomplete="off" enterkeyhint="search">
        <div class="search-results" aria-live="polite"><p>${esc(t.search_hint)}</p></div>
      </div>`;
  }

  // ⓘ next to the "Where does it go?" title: opens _searchAbout (a native popover, shown
  // on top of everything, also of the search dialog; closed by a click outside or Esc)
  _searchAboutButton() {
    const t = this._t;
    return `<button class="about-btn" popovertarget="search-about" title="${esc(t.search_about_title)}"
      aria-label="${esc(t.search_about_title)}"><ha-icon icon="mdi:information-outline"></ha-icon></button>`;
  }

  // How the search works: the dictionary downloaded daily and, out of Italian, the
  // translated names
  _searchAbout() {
    const t = this._t;
    return `
      <div id="search-about" class="about-pop" popover>
        <div class="about-head">
          <ha-icon icon="mdi:information-outline"></ha-icon>
          <span>${esc(t.search_about_title)}</span>
          <button class="about-close" popovertarget="search-about" popovertargetaction="hide"
            title="${esc(t.close)}" aria-label="${esc(t.close)}"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        <p>${esc(t.search_about)}</p>
      </div>`;
  }

  // Waits for a pause in typing, then asks the integration (which asks contarina.it)
  _searchTyped(input) {
    clearTimeout(this._searchTimer);
    const results = input.closest(".search-box")?.querySelector(".search-results");
    this._searchTimer = setTimeout(() => this._search(input.value.trim(), results), 350);
  }

  async _search(query, results) {
    if (!results) return;
    const t = this._t;
    if (query.length < 2) {
      results.innerHTML = `<p>${esc(t.search_hint)}</p>`;
      return;
    }
    // Only the latest search is shown, even if an older one answers later
    const seq = (this._searchSeq = (this._searchSeq || 0) + 1);
    results.innerHTML = `<p>${esc(t.searching)}</p>`;
    let items;
    let updated;
    try {
      const resp = await this._hass.callWS({
        type: "call_service",
        domain: "contarina",
        service: "search_waste",
        // Names in the user's language (Italian or English)
        service_data: { query, limit: 20, language: this._hass.locale?.language || this._hass.language },
        return_response: true,
      });
      items = resp.response?.results || [];
      updated = resp.response?.updated ? new Date(resp.response.updated) : null;
    } catch (err) {
      if (seq === this._searchSeq) results.innerHTML = `<p class="add-error">${esc(t.search_error)}</p>`;
      return;
    }
    if (seq !== this._searchSeq || !results.isConnected) return;
    results.innerHTML = items.length
      ? `<ul class="search-list">${items
          .map(
            (item) => `
            <li>
              <div class="search-name">${esc(item.name)}</div>
              <div class="chips">${item.containers.map((c) => this._renderContainer(c)).join("")}</div>
            </li>`
          )
          .join("")}</ul>`
      : `<p>${esc(fill(t.search_none, { q: query }))}</p>`;
    // When the dictionary was downloaded from contarina.it (normally today)
    if (updated && !isNaN(updated)) {
      const text =
        isoDate(updated) === isoDate(new Date())
          ? t.search_updated_today
          : fill(t.search_updated, { date: updated.toLocaleDateString(t.locale, { day: "numeric", month: "long", year: "numeric" }) });
      results.insertAdjacentHTML("beforeend", `<p class="search-updated">${esc(text)}</p>`);
    }
  }

  // A container of a search result: the bins open their guide
  _renderContainer(c) {
    const style = WASTE_STYLE[c.type];
    if (style) {
      const color = (this._config.colors || {})[c.type] || style.color;
      const guide = this._t.guide[c.type];
      return `<button class="chip" style="--c:${esc(color)}" ${guide ? `data-waste="${esc(c.type)}"` : "disabled"}
        title="${esc(this._t.guide_button)}"><ha-icon icon="${style.icon}"></ha-icon>${esc(this._t.waste[c.type])}</button>`;
    }
    const icon = c.type === "ecocenter" ? ECO_STYLE.icon : SPECIAL_ICONS[c.type] || "mdi:map-marker-outline";
    const color = c.type === "ecocenter" ? ECO_STYLE.color : "var(--secondary-text-color)";
    const name = c.type === "ecocenter" ? this._t.ecocenter : (this._t.containers || {})[c.type] || c.name;
    return `<span class="chip" style="--c:${color}"><ha-icon icon="${icon}"></ha-icon>${esc(name)}</span>`;
  }

  _cardClick(ev) {
    // Search button: open the "where does it go?" popup
    if (ev.target.closest(".search-btn")) {
      this._openSearch();
      return;
    }
    // A bin (search results or guides list): open its guide
    const chip = ev.target.closest(".chip[data-waste]");
    if (chip) {
      this._openGuide(chip.dataset.waste);
      return;
    }
    // EcoCentro button: open its popup
    const eco = ev.target.closest(".eco-btn");
    if (eco) {
      this._openEco(eco.dataset.entry);
      return;
    }
    // Put-out button: mark or unmark the emptying on the pickup day
    const mark = ev.target.closest(".mark-btn");
    if (mark) {
      const service = mark.classList.contains("marked") ? "remove_emptying" : "add_emptying";
      this._callEmptying(service, mark.dataset.sensor, mark.dataset.date);
      return;
    }
    // Emptyings counter: open the recap popup
    const count = ev.target.closest(".count-btn");
    if (count) {
      this._openEmptyings(count.dataset.sensor);
      return;
    }
    // Info button: open the guide popup
    const btn = ev.target.closest(".info-btn");
    if (btn) {
      this._openGuide(btn.dataset.waste);
      return;
    }
    // Rest of the row: set a reminder for the next pickup (the popup links to the
    // sensor's more-info); without a pickup, straight to the more-info
    const row = ev.target.closest(".row");
    if (!row) return;
    const nextDate = this._hass.states[row.dataset.entity]?.attributes.next_date;
    if (nextDate) {
      const waste = this._hass.states[row.dataset.entity].attributes.waste;
      openReminder({
        hass: this._hass,
        entityId: row.dataset.entity,
        date: nextDate,
        color: (this._config.colors || {})[waste],
        origin: this,
      });
      return;
    }
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId: row.dataset.entity },
        bubbles: true,
        composed: true,
      })
    );
  }

  _render(groups) {
    if (this._config.hide_when_empty) {
      const found = groups.length > 0;
      groups = groups.filter((g) => g.items.length);
      // With sensors found but nothing to show, the card disappears from the dashboard,
      // except in edit/preview mode, otherwise it could no longer be selected
      const editing = this.editMode || this.preview;
      this.style.display = found && !groups.length && !editing ? "none" : "";
    }
    // A custom title replaces the whole header; {location} stands for the calendar name
    const header = (location) => {
      if (this._config.title) return this._config.title.replaceAll("{location}", location);
      return location ? `${location} - ${this._t.title}` : this._t.title;
    };
    // The search is the same for every calendar: one button, in the first header
    const searchBtn =
      this._config.search === false
        ? ""
        : `<button class="search-btn" title="${esc(this._t.search_title)}" aria-label="${esc(this._t.search_title)}"
            aria-haspopup="dialog"><ha-icon icon="mdi:magnify"></ha-icon></button>`;
    const sections = groups
      .map(
        (g, i) => `
        <div class="header"><span class="header-title">${esc(header(g.location))}</span>${this._renderEcoButton(g)}${
          i === 0 ? searchBtn : ""
        }</div>
        <div class="list">${
          g.items.length
            ? g.items.map((item) => this._renderRow(item)).join("")
            : `<div class="empty">${this._t.nothing_soon}</div>`
        }</div>${this._renderEcoInline(g)}`
      )
      .join("");

    const views = {
      search: () => this._renderSearchView(),
      ecocenter: () => this._renderEcoView(groups),
    };
    const content = (views[this._config.view] || (() => sections))();

    // Built once: later renders only replace the card content, so an open popup survives updates
    if (!this._card) {
      this.shadowRoot.innerHTML = `
      <style>
        .header {
          display: flex; align-items: center; gap: 8px;
          padding: 16px 16px 0; font-size: 1.2em; font-weight: 500;
        }
        .header-title { flex: 1; min-width: 0; }
        .eco-btn {
          flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px 3px 6px;
          border: 1px solid var(--divider-color); border-radius: 999px; background: none;
          color: var(--primary-text-color); font: inherit; font-size: 0.7em; font-weight: 400;
          cursor: pointer; --mdc-icon-size: 18px;
        }
        .eco-btn ha-icon { color: ${ECO_STYLE.color}; }
        .eco-btn:hover { background: var(--secondary-background-color); }
        .eco-state { color: var(--secondary-text-color); }
        @media (max-width: 400px) { .eco-label { display: none; } }
        ${ECO_CSS}
        .search-btn {
          flex: none; display: flex; padding: 4px; margin-right: -4px; border: none; border-radius: 50%;
          background: none; color: var(--secondary-text-color); cursor: pointer;
        }
        .search-btn:hover { color: var(--primary-color); }
        .search-input {
          box-sizing: border-box; width: 100%; margin-top: 16px; padding: 10px 12px; font: inherit;
          border: 1px solid var(--divider-color); border-radius: 8px;
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
        }
        .search-input:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; }
        .guide ul.search-list { list-style: none; padding-left: 0; margin-top: 8px; }
        .search-list li { padding: 8px 0; border-bottom: 1px solid var(--divider-color); }
        .guide p.search-updated { margin-top: 10px; font-size: 0.85em; color: var(--secondary-text-color); }
        .about-btn {
          display: inline-flex; vertical-align: middle; margin-left: 4px; padding: 4px;
          border: none; border-radius: 50%; background: none; cursor: pointer;
          color: var(--secondary-text-color); --mdc-icon-size: 18px;
        }
        .about-btn:hover, .about-close:hover { color: var(--primary-color); }
        .about-close {
          flex: none; display: flex; padding: 6px; border: none; border-radius: 50%;
          background: none; color: var(--secondary-text-color); cursor: pointer;
        }
        .about-pop {
          width: min(360px, calc(100vw - 32px)); box-sizing: border-box; margin: auto; padding: 12px 12px 16px 16px;
          border: none; border-radius: var(--ha-card-border-radius, 12px);
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
          font-family: var(--ha-font-family-body, Roboto, Noto, sans-serif); font-size: 0.9em; font-weight: 400;
        }
        .about-pop::backdrop { background: rgba(0, 0, 0, 0.3); }
        .about-head { display: flex; align-items: center; gap: 8px; font-weight: 500; --mdc-icon-size: 20px; }
        .about-head > ha-icon { color: var(--primary-color); }
        .about-head span { flex: 1; }
        .about-pop p { margin: 8px 0 0; line-height: 1.45; color: var(--secondary-text-color); }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
        .chip {
          display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px 2px 6px;
          border: none; border-radius: 999px; font: inherit; font-size: 0.9em;
          background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--primary-text-color);
          --mdc-icon-size: 16px;
        }
        .chip ha-icon { color: var(--c); }
        button.chip[data-waste] { cursor: pointer; }
        button.chip[data-waste]:hover { background: color-mix(in srgb, var(--c) 30%, transparent); }
        .eco-inline { padding-top: 4px; border-top: 1px solid var(--divider-color); }
        .eco-inline-title {
          display: flex; align-items: center; gap: 8px; margin-top: 12px;
          font-size: 1.1em; font-weight: 500; --mdc-icon-size: 20px;
        }
        .eco-inline-title ha-icon { color: ${ECO_STYLE.color}; }
        .header-icon { flex: none; color: ${ECO_STYLE.color}; }
        .eco-view .guide-title:first-child { margin-top: 8px; }
        .search-view .search-input { margin-top: 8px; }
        .search-view .chips { margin-top: 8px; }
        .list { padding: 8px 8px 12px; display: flex; flex-direction: column; gap: 4px; }
        .list + .header { border-top: 1px solid var(--divider-color); }
        .row {
          display: flex; align-items: center; gap: 12px;
          padding: 8px; border-radius: 12px; cursor: pointer;
        }
        .row:hover { background: var(--secondary-background-color); }
        .row.urgent { background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12); }
        .badge {
          flex: none; width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--c) 20%, transparent);
          color: var(--c);
        }
        .info { flex: 1; min-width: 0; }
        .name { font-weight: 500; }
        .when { color: var(--secondary-text-color); font-size: 0.9em; }
        .days { font-size: 1.4em; font-weight: 500; }
        .days.soon { font-size: 1.05em; color: var(--primary-color); }
        .days.soon.done { color: var(--primary-text-color); }
        .days span { font-size: 0.55em; margin-left: 2px; color: var(--secondary-text-color); }
        .empty { padding: 8px; color: var(--secondary-text-color); }
        .info-btn, .close-btn, .remove-btn, .mark-btn {
          flex: none; display: flex; padding: 6px; border: none; border-radius: 50%;
          background: none; color: var(--secondary-text-color); cursor: pointer;
        }
        .info-btn:hover, .close-btn:hover, .remove-btn:hover, .mark-btn:hover { color: var(--primary-color); }
        .mark-btn.marked { color: var(--success-color, #43a047); }
        .when { display: flex; align-items: center; gap: 6px; }
        .when-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .count-btn {
          flex: none; display: inline-flex; align-items: center; gap: 2px; padding: 0 6px;
          border: 1px solid var(--divider-color); border-radius: 999px; background: none;
          color: inherit; font: inherit; line-height: 1.3; cursor: pointer; --mdc-icon-size: 14px;
        }
        .count-btn:hover { background: var(--secondary-background-color); }
        .bell {
          flex: none; display: inline-flex; align-items: center; gap: 2px;
          color: var(--primary-color); --mdc-icon-size: 14px;
        }
        .count-btn.full, .stat.full, .guide p.add-error { color: var(--error-color, #db4437); }
        .count-btn.full { border-color: currentColor; }
        .stat { margin-top: 16px; font-size: 1.1em; }
        .stat .big { font-size: 2em; font-weight: 500; }
        .guide ul.date-list { list-style: none; padding-left: 0; }
        .date-list li {
          display: flex; align-items: center; justify-content: space-between;
          border-bottom: 1px solid var(--divider-color);
        }
        .add-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        .add-date {
          flex: 1; min-width: 0; padding: 6px 8px; font: inherit;
          border: 1px solid var(--divider-color); border-radius: 8px;
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
        }
        .add-btn {
          padding: 6px 16px; font: inherit; border: none; border-radius: 8px; cursor: pointer;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
        }
        .guide-dialog {
          width: min(560px, calc(100vw - 32px)); max-height: 85vh; padding: 0;
          border: none; border-radius: var(--ha-card-border-radius, 12px);
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        .guide-dialog[open] { display: flex; flex-direction: column; }
        .guide-dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
        .dialog-header {
          display: flex; align-items: center; gap: 12px;
          padding: 16px 12px 12px 16px; border-bottom: 1px solid var(--divider-color);
        }
        .guide { overflow: auto; padding: 0 20px 20px; font-size: 0.95em; }
        .guide-title { font-weight: 500; margin-top: 16px; }
        .guide ul { margin: 4px 0 0; padding-left: 18px; }
        .guide ul.cols { columns: 2 16em; column-gap: 24px; }
        .guide li { break-inside: avoid; margin-bottom: 2px; }
        .guide p { margin: 12px 0 0; color: var(--secondary-text-color); }
      </style>
      <ha-card></ha-card>
      <dialog class="guide-dialog"></dialog>`;
      this._card = this.shadowRoot.querySelector("ha-card");
      this._dialog = this.shadowRoot.querySelector("dialog");
      this._card.addEventListener("click", (ev) => this._cardClick(ev));
      this._dialog.addEventListener("click", (ev) => this._dialogClick(ev));
      // Picking another date clears the "already marked" message
      this._dialog.addEventListener("change", (ev) => {
        if (ev.target.matches(".add-date")) this._dialog.querySelector(".add-error").hidden = true;
      });
      this._dialog.addEventListener("input", (ev) => {
        if (ev.target.matches(".search-input")) this._searchTyped(ev.target);
      });
      this._card.addEventListener("input", (ev) => {
        if (ev.target.matches(".search-input")) this._searchTyped(ev.target);
      });
      this._dialog.addEventListener("close", () => {
        clearTimeout(this._searchTimer);
        this._dialogSensor = null;
        this._dialogEco = null;
      });
    }
    this._card.innerHTML = content || `<div class="empty">${this._t.no_sensors}</div>`;
  }
}

function contarinaSensorIds(states) {
  return Object.keys(states).filter((id) => {
    const a = states[id].attributes;
    return id.startsWith("sensor.") && a.waste !== undefined && a.municipality_number !== undefined;
  });
}

const EDITOR_FIELDS = ["view", "title", "location", "soon_days", "hide_when_empty", "ecocenter", "search", "show"];

class ContarinaCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  async connectedCallback() {
    // ha-form is lazy-loaded by the frontend: force it to load through an HA editor
    if (!customElements.get("ha-form")) {
      const entitiesCard = customElements.get("hui-entities-card");
      if (entitiesCard?.getConfigElement) await entitiesCard.getConfigElement();
    }
    this._update();
  }

  _schema() {
    const t = stringsFor(this._hass);
    const showOptions = ["always", "soon", "never"].map((m) => ({ value: m, label: t.editor[m] }));
    const states = this._hass.states;
    const locations = new Map();
    contarinaSensorIds(states).forEach((id) => {
      const a = states[id].attributes;
      const name = a.location || a.municipality_name;
      if (name) locations.set(name, name);
    });
    // view: what the card shows; the other options only apply to the pickups
    const view = {
      name: "view",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "", label: t.editor.view_pickups },
            { value: "ecocenter", label: t.editor.view_ecocenter },
            { value: "search", label: t.editor.view_search },
          ],
        },
      },
    };
    if (this._config.view === "search") return [view, { name: "title", selector: { text: {} } }];
    // Options of the pickups list only
    const pickupFields = [
      { name: "soon_days", selector: { number: { min: 0, max: 14, mode: "box" } } },
      { name: "hide_when_empty", selector: { boolean: {} } },
      { name: "ecocenter", selector: { boolean: {} } },
      { name: "search", selector: { boolean: {} } },
      {
        name: "show",
        type: "expandable",
        title: t.editor.show,
        expanded: true,
        // For each type: mode + optional days (soon_days override for "Only soon")
        schema: WASTE_KEYS.map((key) => ({
          type: "grid",
          schema: [
            { name: key, selector: { select: { mode: "dropdown", options: showOptions } } },
            { name: `${key}_days`, selector: { number: { min: 0, max: 14, mode: "box" } } },
          ],
        })),
      },
    ];
    return [
      view,
      { name: "title", selector: { text: {} } },
      {
        name: "location",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "", label: t.editor.all_locations },
              ...[...locations.keys()].sort((a, b) => a.localeCompare(b, t.locale)).map((l) => ({ value: l, label: l })),
            ],
          },
        },
      },
      ...(this._config.view === "ecocenter" ? [] : pickupFields),
    ];
  }

  _update() {
    if (!this._hass || !this._config || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => {
        const t = stringsFor(this._hass);
        if (EDITOR_FIELDS.includes(s.name)) return t.editor[s.name];
        if (s.name?.endsWith("_days")) return t.editor.type_days;
        return t.waste[s.name] || s.name;
      };
      this._form.computeHelper = (s) => {
        const editor = stringsFor(this._hass).editor;
        if (s.name === "view") return editor.view_helper;
        if (s.name !== "title") return undefined;
        // The search view has no calendar name to put in the title
        return this._config.view === "search" ? editor.title_helper_search : editor.title_helper;
      };
      this._form.addEventListener("value-changed", (ev) => this._changed(ev.detail.value));
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    // Reassign schema and data only when they change, otherwise the form loses focus
    const schema = this._schema();
    const schemaKey = JSON.stringify(schema);
    if (schemaKey !== this._schemaKey) {
      this._schemaKey = schemaKey;
      this._form.schema = schema;
    }
    if (this._config !== this._formConfig) {
      this._formConfig = this._config;
      this._form.data = {
        view: "",
        soon_days: 1,
        ecocenter: true,
        search: true,
        ...this._config,
        show: this._showToForm(this._config.show),
      };
    }
  }

  // { residual: 5 } -> { residual: "soon", residual_days: 5 }
  _showToForm(show = {}) {
    const form = {};
    WASTE_KEYS.forEach((key) => {
      const mode = show[key];
      if (typeof mode === "number") {
        form[key] = "soon";
        form[`${key}_days`] = mode;
      } else {
        form[key] = mode || "always";
      }
    });
    return form;
  }

  // Inverse of _showToForm; "always" is the default and isn't written
  _showFromForm(form = {}) {
    const show = {};
    WASTE_KEYS.forEach((key) => {
      const mode = form[key] || "always";
      const days = form[`${key}_days`];
      if (mode === "soon" && typeof days === "number") show[key] = days;
      else if (mode !== "always") show[key] = mode;
    });
    return show;
  }

  _changed(value) {
    const config = { ...this._config, ...value };
    // Drop default values to keep the YAML clean
    if (!config.view) delete config.view;
    if (!config.title) delete config.title;
    if (!config.location) delete config.location;
    if (config.soon_days === 1 || config.soon_days === undefined) delete config.soon_days;
    if (!config.hide_when_empty) delete config.hide_when_empty;
    // true is the default; "inline" (YAML only) is kept
    if (config.ecocenter === true || config.ecocenter === undefined) delete config.ecocenter;
    if (config.search !== false) delete config.search;
    const show = this._showFromForm(config.show);
    if (Object.keys(show).length) config.show = show;
    else delete config.show;

    this._config = config;
    // The form already has these values: no need to reassign them when HA calls setConfig again
    this._formConfig = config;
    // A different view shows other fields
    this._update();
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

// Shared with the sidebar page (contarina-panel.js), which draws the month view itself
window.ContarinaShared = {
  openReminder,
  ecoNoticeText,
  reminderFor,
  WASTE_STYLE,
  WASTE_KEYS,
  ECO_STYLE,
  ECO_CSS,
  ECO_HOURS_URL,
  stringsFor,
  esc,
  capitalize,
  isoDate,
  fill,
  renderCenter,
  ecoStatusText,
};

// Avoid the error if the card is loaded twice (e.g. a manual Lovelace resource)
if (!customElements.get("contarina-card")) {
  customElements.define("contarina-card", ContarinaCard);
  customElements.define("contarina-card-editor", ContarinaCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "contarina-card",
    name: "Contarina",
    description: "Upcoming Contarina waste collection pickups",
  });
}
