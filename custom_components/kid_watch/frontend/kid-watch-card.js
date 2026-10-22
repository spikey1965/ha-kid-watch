// Kid Watch card: each child's now-playing, screen time, timeline, TVs, top sites and alerts, with one-tap controls.
// Served by the Kid Watch integration; reads the "Status" sensor of every child it set up.
const KW_VERSION = "0.2.0";

const KW_CATS = {
  video: ["Video", "#e5484d"], social: ["Social", "#8e5cf7"], gaming: ["Gaming", "#2f9e6b"], school: ["School", "#2f6fdc"],
  tv: ["TV & Plex", "#d48a00"], music: ["Music", "#d6487e"], web: ["Other sites", "#7a7f88"], blocked: ["Blocked", "#8a8f98"], paused: ["Paused", "#5d6068"], alert: ["Alert", "#d93025"],
};
const KW_ICON = {
  video: "mdi:play-box", social: "mdi:chat", gaming: "mdi:controller", school: "mdi:school", tv: "mdi:television-play",
  music: "mdi:music", web: "mdi:web", idle: "mdi:weather-night", paused: "mdi:wifi-off",
};
const kwEsc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kwDur = m => (m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m");
// times follow HA's language and its 12/24-hour setting (Profile → Time format)
const kwTime = (t, hass) => {
  const loc = (hass && hass.locale) || {}, h12 = { 12: true, 24: false }[loc.time_format];
  return new Date(t).toLocaleTimeString(loc.language || (hass && hass.language) || [], { hour: "2-digit", minute: "2-digit", ...(h12 === undefined ? {} : { hour12: h12 }) });
};
const kwOver = (rating, limit) => {
  const age = r => {
    if (!r) return null;
    let s = String(r).toUpperCase().split("/").pop().trim();
    const map = { U: 0, UC: 0, G: 0, "TV-Y": 0, "TV-G": 0, "TV-Y7": 7, PG: 8, "TV-PG": 8, "12A": 12, "PG-13": 13, "TV-14": 14, R: 17, "TV-MA": 17, "NC-17": 18 };
    if (s in map) return map[s];
    const m = s.match(/\d{1,2}/);
    return m ? +m[0] : null;
  };
  const a = age(rating), lim = { U: 0, PG: 8, 12: 12, 15: 15, 18: 18 }[limit] ?? 18;
  return a !== null && a > lim;
};

// Words on the card. Follows Home Assistant's language, or `language: de` on the card. Missing words fall back to English.
const KW_I18N = {
  en: {
    cat_video: "Video", cat_social: "Social", cat_gaming: "Gaming", cat_school: "School", cat_tv: "TV & Plex", cat_music: "Music", cat_web: "Other sites",
    cat_blocked: "Blocked", cat_paused: "Paused", cat_alert: "Alert",
    now: "Now", internet_paused: "Internet paused", watching: "Watching on TV", playing: "Playing", schoolwork: "Schoolwork", on: "On",
    nothing_now: "Nothing right now", no_activity: "No activity on {child}'s devices",
    screen_time: "Screen time today", of_budget: "{used} of {budget}",
    pause: "Pause internet", resume: "Resume internet", all_blocked: "All devices blocked", dev_one: "{n} device", dev_other: "{n} devices",
    bedtime: "Bedtime", pauses: "Pauses {from}–{to}", off: "Off", safesearch: "SafeSearch", safesearch_on: "Google, YouTube, Bing",
    age_limit: "TV age limit: {limit}", stops_older: "Stops older shows", alerts_only: "Alerts only", block: "Block:",
    timeline: "Timeline", tvs: "TVs", top_sites: "Top sites", alerts: "Alerts", nothing_yet: "Nothing yet today.", no_alerts: "No alerts today.",
    details: "Details", close: "Close",
    no_children: "No children set up yet. Add Kid Watch in Settings → Devices & services, then add a child.",
    min_left: "{n} min left", paused_sm: "paused", screen: "📺 Screen", play: "▶ Play", pause_tv: "❚❚ Pause", turn_off: "Turn off TV",
    no_tvs: "No TVs added yet. Add them to a child in Kid Watch's Configure.", tvs_intro: "Every TV you've added, and who's watching.",
    nothing_playing: "Nothing playing", childs_tv: "{child}'s TV", tv_off: "TV off", nothing_for: "Nothing playing for {child} right now.",
    over_warn: "{rating}-rated: above {child}'s age limit ({limit})",
    artwork: "The picture is the artwork the TV reports. Streaming apps block copying the live screen.",
  },
  de: {
    cat_video: "Video", cat_social: "Social Media", cat_gaming: "Spiele", cat_school: "Schule", cat_tv: "TV & Plex", cat_music: "Musik", cat_web: "Andere Seiten",
    cat_blocked: "Gesperrt", cat_paused: "Pausiert", cat_alert: "Warnung",
    now: "Jetzt", internet_paused: "Internet pausiert", watching: "Schaut fern", playing: "Spielt", schoolwork: "Schulaufgaben", on: "Nutzt",
    nothing_now: "Gerade nichts", no_activity: "Keine Aktivität auf den Geräten von {child}",
    screen_time: "Bildschirmzeit heute", of_budget: "{used} von {budget}",
    pause: "Internet pausieren", resume: "Internet fortsetzen", all_blocked: "Alle Geräte gesperrt", dev_one: "{n} Gerät", dev_other: "{n} Geräte",
    bedtime: "Schlafenszeit", pauses: "Pause {from}–{to}", off: "Aus",
    age_limit: "TV-Altersgrenze: {limit}", stops_older: "Stoppt ungeeignete Sendungen", alerts_only: "Nur Warnungen", block: "Sperren:",
    timeline: "Verlauf", tvs: "Fernseher", top_sites: "Top-Seiten", alerts: "Warnungen", nothing_yet: "Heute noch nichts.", no_alerts: "Heute keine Warnungen.",
    details: "Details", close: "Schließen",
    no_children: "Noch keine Kinder eingerichtet. Füge Kid Watch unter Einstellungen → Geräte & Dienste hinzu und dann ein Kind.",
    min_left: "noch {n} Min.", paused_sm: "pausiert", screen: "📺 Bildschirm", play: "▶ Abspielen", pause_tv: "❚❚ Pause", turn_off: "TV ausschalten",
    no_tvs: "Noch keine Fernseher. Füge sie einem Kind unter Kid Watch → Konfigurieren hinzu.", tvs_intro: "Alle hinzugefügten Fernseher, und wer gerade schaut.",
    nothing_playing: "Nichts läuft", childs_tv: "Fernseher von {child}", tv_off: "TV aus", nothing_for: "Gerade läuft nichts für {child}.",
    over_warn: "Ab {rating}: über der Altersgrenze von {child} ({limit})",
    artwork: "Das Bild ist das Cover, das der Fernseher meldet. Streaming-Apps verhindern das Kopieren des Live-Bilds.",
  },
  fr: {
    cat_video: "Vidéo", cat_social: "Réseaux sociaux", cat_gaming: "Jeux", cat_school: "École", cat_tv: "TV & Plex", cat_music: "Musique", cat_web: "Autres sites",
    cat_blocked: "Bloqué", cat_paused: "En pause", cat_alert: "Alerte",
    now: "Maintenant", internet_paused: "Internet en pause", watching: "Regarde la TV", playing: "Joue à", schoolwork: "Devoirs", on: "Utilise",
    nothing_now: "Rien en ce moment", no_activity: "Aucune activité sur les appareils de {child}",
    screen_time: "Temps d'écran aujourd'hui", of_budget: "{used} sur {budget}",
    pause: "Mettre Internet en pause", resume: "Reprendre Internet", all_blocked: "Tous les appareils bloqués", dev_one: "{n} appareil", dev_other: "{n} appareils",
    bedtime: "Heure du coucher", pauses: "Pause {from}–{to}", off: "Désactivé",
    age_limit: "Limite d'âge TV : {limit}", stops_older: "Arrête les programmes inadaptés", alerts_only: "Alertes seulement", block: "Bloquer :",
    timeline: "Chronologie", tvs: "Téléviseurs", top_sites: "Sites les plus vus", alerts: "Alertes", nothing_yet: "Rien pour l'instant aujourd'hui.", no_alerts: "Aucune alerte aujourd'hui.",
    details: "Détails", close: "Fermer",
    no_children: "Aucun enfant configuré. Ajoutez Kid Watch dans Paramètres → Appareils et services, puis ajoutez un enfant.",
    min_left: "{n} min restantes", paused_sm: "en pause", screen: "📺 Écran", play: "▶ Lecture", pause_tv: "❚❚ Pause", turn_off: "Éteindre la TV",
    no_tvs: "Aucun téléviseur ajouté. Ajoutez-les à un enfant dans Configurer de Kid Watch.", tvs_intro: "Tous vos téléviseurs, et qui regarde.",
    nothing_playing: "Rien en lecture", childs_tv: "TV de {child}", tv_off: "TV éteinte", nothing_for: "Rien en lecture pour {child} en ce moment.",
    over_warn: "Classé {rating} : au-dessus de la limite d'âge de {child} ({limit})",
    artwork: "L'image est la jaquette envoyée par la TV. Les applis de streaming empêchent de copier l'écran en direct.",
  },
  it: {
    cat_video: "Video", cat_social: "Social", cat_gaming: "Giochi", cat_school: "Scuola", cat_tv: "TV e Plex", cat_music: "Musica", cat_web: "Altri siti",
    cat_blocked: "Bloccato", cat_paused: "In pausa", cat_alert: "Avviso",
    now: "Ora", internet_paused: "Internet in pausa", watching: "Guarda la TV", playing: "Gioca a", schoolwork: "Compiti", on: "Usa",
    nothing_now: "Niente al momento", no_activity: "Nessuna attività sui dispositivi di {child}",
    screen_time: "Tempo di schermo oggi", of_budget: "{used} di {budget}",
    pause: "Metti in pausa Internet", resume: "Riattiva Internet", all_blocked: "Tutti i dispositivi bloccati", dev_one: "{n} dispositivo", dev_other: "{n} dispositivi",
    bedtime: "Ora di dormire", pauses: "Pausa {from}–{to}", off: "Spento",
    age_limit: "Limite di età TV: {limit}", stops_older: "Ferma i programmi non adatti", alerts_only: "Solo avvisi", block: "Blocca:",
    timeline: "Cronologia", tvs: "TV", top_sites: "Siti più usati", alerts: "Avvisi", nothing_yet: "Ancora niente oggi.", no_alerts: "Nessun avviso oggi.",
    details: "Dettagli", close: "Chiudi",
    no_children: "Nessun bambino configurato. Aggiungi Kid Watch in Impostazioni → Dispositivi e servizi, poi aggiungi un bambino.",
    min_left: "{n} min rimasti", paused_sm: "in pausa", screen: "📺 Schermo", play: "▶ Riproduci", pause_tv: "❚❚ Pausa", turn_off: "Spegni la TV",
    no_tvs: "Nessuna TV aggiunta. Aggiungile a un bambino in Configura di Kid Watch.", tvs_intro: "Tutte le TV aggiunte, e chi sta guardando.",
    nothing_playing: "Niente in riproduzione", childs_tv: "TV di {child}", tv_off: "TV spenta", nothing_for: "Niente in riproduzione per {child} al momento.",
    over_warn: "Classificato {rating}: sopra il limite di età di {child} ({limit})",
    artwork: "L'immagine è la copertina inviata dalla TV. Le app di streaming impediscono di copiare lo schermo dal vivo.",
  },
  es: {
    cat_video: "Vídeo", cat_social: "Redes sociales", cat_gaming: "Juegos", cat_school: "Colegio", cat_tv: "TV y Plex", cat_music: "Música", cat_web: "Otros sitios",
    cat_blocked: "Bloqueado", cat_paused: "En pausa", cat_alert: "Aviso",
    now: "Ahora", internet_paused: "Internet en pausa", watching: "Viendo la TV", playing: "Jugando a", schoolwork: "Deberes", on: "Usando",
    nothing_now: "Nada ahora mismo", no_activity: "Sin actividad en los dispositivos de {child}",
    screen_time: "Tiempo de pantalla hoy", of_budget: "{used} de {budget}",
    pause: "Pausar internet", resume: "Reanudar internet", all_blocked: "Todos los dispositivos bloqueados", dev_one: "{n} dispositivo", dev_other: "{n} dispositivos",
    bedtime: "Hora de dormir", pauses: "Pausa {from}–{to}", off: "Desactivado",
    age_limit: "Límite de edad TV: {limit}", stops_older: "Detiene programas no aptos", alerts_only: "Solo avisos", block: "Bloquear:",
    timeline: "Cronología", tvs: "Televisores", top_sites: "Sitios más usados", alerts: "Avisos", nothing_yet: "Nada todavía hoy.", no_alerts: "Hoy no hay avisos.",
    details: "Detalles", close: "Cerrar",
    no_children: "Aún no hay niños. Añade Kid Watch en Ajustes → Dispositivos y servicios, y luego añade un niño.",
    min_left: "quedan {n} min", paused_sm: "en pausa", screen: "📺 Pantalla", play: "▶ Reproducir", pause_tv: "❚❚ Pausa", turn_off: "Apagar la TV",
    no_tvs: "Aún no hay televisores. Añádelos a un niño en Configurar de Kid Watch.", tvs_intro: "Todos los televisores que has añadido, y quién está viendo.",
    nothing_playing: "Nada en reproducción", childs_tv: "TV de {child}", tv_off: "TV apagada", nothing_for: "Nada en reproducción para {child} ahora mismo.",
    over_warn: "Calificado {rating}: por encima del límite de edad de {child} ({limit})",
    artwork: "La imagen es la carátula que envía la TV. Las apps de streaming impiden copiar la pantalla en directo.",
  },
  nl: {
    cat_video: "Video", cat_social: "Sociaal", cat_gaming: "Games", cat_school: "School", cat_tv: "Tv & Plex", cat_music: "Muziek", cat_web: "Andere sites",
    cat_blocked: "Geblokkeerd", cat_paused: "Gepauzeerd", cat_alert: "Melding",
    now: "Nu", internet_paused: "Internet gepauzeerd", watching: "Kijkt tv", playing: "Speelt", schoolwork: "Schoolwerk", on: "Gebruikt",
    nothing_now: "Nu niets", no_activity: "Geen activiteit op de apparaten van {child}",
    screen_time: "Schermtijd vandaag", of_budget: "{used} van {budget}",
    pause: "Internet pauzeren", resume: "Internet hervatten", all_blocked: "Alle apparaten geblokkeerd", dev_one: "{n} apparaat", dev_other: "{n} apparaten",
    bedtime: "Bedtijd", pauses: "Pauze {from}–{to}", off: "Uit",
    age_limit: "Leeftijdsgrens tv: {limit}", stops_older: "Stopt ongeschikte programma's", alerts_only: "Alleen meldingen", block: "Blokkeren:",
    timeline: "Tijdlijn", tvs: "Tv's", top_sites: "Topsites", alerts: "Meldingen", nothing_yet: "Vandaag nog niets.", no_alerts: "Vandaag geen meldingen.",
    details: "Details", close: "Sluiten",
    no_children: "Nog geen kinderen ingesteld. Voeg Kid Watch toe via Instellingen → Apparaten & diensten en voeg dan een kind toe.",
    min_left: "nog {n} min", paused_sm: "gepauzeerd", screen: "📺 Scherm", play: "▶ Afspelen", pause_tv: "❚❚ Pauze", turn_off: "Tv uitzetten",
    no_tvs: "Nog geen tv's toegevoegd. Voeg ze toe aan een kind via Configureren bij Kid Watch.", tvs_intro: "Alle tv's die je hebt toegevoegd, en wie er kijkt.",
    nothing_playing: "Er speelt niets", childs_tv: "Tv van {child}", tv_off: "Tv uit", nothing_for: "Er speelt nu niets voor {child}.",
    over_warn: "Classificatie {rating}: boven de leeftijdsgrens van {child} ({limit})",
    artwork: "De afbeelding is de hoes die de tv doorgeeft. Streamingapps blokkeren het kopiëren van het live beeld.",
  },
  pl: {
    cat_video: "Wideo", cat_social: "Społecznościowe", cat_gaming: "Gry", cat_school: "Szkoła", cat_tv: "TV i Plex", cat_music: "Muzyka", cat_web: "Inne strony",
    cat_blocked: "Zablokowane", cat_paused: "Wstrzymane", cat_alert: "Alert",
    now: "Teraz", internet_paused: "Internet wstrzymany", watching: "Ogląda TV", playing: "Gra w", schoolwork: "Nauka", on: "Używa",
    nothing_now: "Teraz nic", no_activity: "Brak aktywności na urządzeniach ({child})",
    screen_time: "Czas przed ekranem dziś", of_budget: "{used} z {budget}",
    pause: "Wstrzymaj internet", resume: "Wznów internet", all_blocked: "Wszystkie urządzenia zablokowane",
    dev_one: "{n} urządzenie", dev_few: "{n} urządzenia", dev_other: "{n} urządzeń",
    bedtime: "Pora snu", pauses: "Przerwa {from}–{to}", off: "Wył.",
    age_limit: "Limit wieku TV: {limit}", stops_older: "Zatrzymuje nieodpowiednie programy", alerts_only: "Tylko alerty", block: "Blokuj:",
    timeline: "Oś czasu", tvs: "Telewizory", top_sites: "Najczęstsze strony", alerts: "Alerty", nothing_yet: "Dziś jeszcze nic.", no_alerts: "Dziś brak alertów.",
    details: "Szczegóły", close: "Zamknij",
    no_children: "Nie ma jeszcze dzieci. Dodaj Kid Watch w Ustawienia → Urządzenia oraz usługi, a potem dodaj dziecko.",
    min_left: "zostało {n} min", paused_sm: "wstrzymane", screen: "📺 Ekran", play: "▶ Odtwórz", pause_tv: "❚❚ Pauza", turn_off: "Wyłącz TV",
    no_tvs: "Nie dodano jeszcze telewizorów. Dodaj je do dziecka w Kid Watch → Konfiguruj.", tvs_intro: "Wszystkie dodane telewizory i kto ogląda.",
    nothing_playing: "Nic nie leci", childs_tv: "Telewizor: {child}", tv_off: "TV wyłączony", nothing_for: "Teraz nic nie leci ({child}).",
    over_warn: "Kategoria {rating}: powyżej limitu wieku ({child}: {limit})",
    artwork: "Obraz to okładka przekazana przez telewizor. Aplikacje streamingowe blokują kopiowanie obrazu na żywo.",
  },
  pt: {
    cat_video: "Vídeo", cat_social: "Redes sociais", cat_gaming: "Jogos", cat_school: "Escola", cat_tv: "TV e Plex", cat_music: "Música", cat_web: "Outros sites",
    cat_blocked: "Bloqueado", cat_paused: "Em pausa", cat_alert: "Alerta",
    now: "Agora", internet_paused: "Internet em pausa", watching: "A ver TV", playing: "A jogar", schoolwork: "Trabalhos de casa", on: "A usar",
    nothing_now: "Nada neste momento", no_activity: "Sem atividade nos dispositivos de {child}",
    screen_time: "Tempo de ecrã hoje", of_budget: "{used} de {budget}",
    pause: "Pausar a internet", resume: "Retomar a internet", all_blocked: "Todos os dispositivos bloqueados", dev_one: "{n} dispositivo", dev_other: "{n} dispositivos",
    bedtime: "Hora de dormir", pauses: "Pausa {from}–{to}", off: "Desligado",
    age_limit: "Limite de idade TV: {limit}", stops_older: "Para programas inadequados", alerts_only: "Só alertas", block: "Bloquear:",
    timeline: "Cronologia", tvs: "Televisões", top_sites: "Sites mais usados", alerts: "Alertas", nothing_yet: "Ainda nada hoje.", no_alerts: "Sem alertas hoje.",
    details: "Detalhes", close: "Fechar",
    no_children: "Ainda não há crianças. Adicione o Kid Watch em Definições → Dispositivos e serviços e depois adicione uma criança.",
    min_left: "faltam {n} min", paused_sm: "em pausa", screen: "📺 Ecrã", play: "▶ Reproduzir", pause_tv: "❚❚ Pausa", turn_off: "Desligar a TV",
    no_tvs: "Ainda não há televisões. Adicione-as a uma criança em Configurar do Kid Watch.", tvs_intro: "Todas as televisões que adicionou, e quem está a ver.",
    nothing_playing: "Nada a reproduzir", childs_tv: "TV de {child}", tv_off: "TV desligada", nothing_for: "Nada a reproduzir para {child} neste momento.",
    over_warn: "Classificação {rating}: acima do limite de idade de {child} ({limit})",
    artwork: "A imagem é a capa que a TV envia. As apps de streaming impedem copiar o ecrã em direto.",
  },
};
// Brazilian Portuguese: only the words that differ
KW_I18N["pt-br"] = {
  ...KW_I18N.pt,
  watching: "Assistindo TV", playing: "Jogando", schoolwork: "Lição de casa", on: "Usando", nothing_now: "Nada agora",
  screen_time: "Tempo de tela hoje", pause: "Pausar internet", resume: "Retomar internet", tvs: "TVs", screen: "📺 Tela",
  no_children: "Ainda não há crianças. Adicione o Kid Watch em Configurações → Dispositivos e serviços e depois adicione uma criança.",
  no_tvs: "Ainda não há TVs. Adicione-as a uma criança em Configurar do Kid Watch.", tvs_intro: "Todas as TVs que você adicionou, e quem está assistindo.",
  nothing_playing: "Nada em reprodução", nothing_for: "Nada em reprodução para {child} agora.",
  artwork: "A imagem é a capa que a TV envia. Os apps de streaming impedem copiar a tela ao vivo.",
};
const kwLang = (hass, config) => {
  const code = String(config.language || (hass.locale && hass.locale.language) || hass.language || "en").toLowerCase().replace("_", "-");
  return KW_I18N[code] ? code : KW_I18N[code.split("-")[0]] ? code.split("-")[0] : "en";
};

const KW_STYLE = `
:host { --kw-soft: var(--secondary-background-color, #f1efe8); --kw-line: var(--divider-color, #e3e0d6); --kw-muted: var(--secondary-text-color, #5d6068); --kw-alert: var(--error-color, #d93025); }
ha-card { padding: 16px; }
.top { display:flex; align-items:center; gap:10px; }
.top h2 { margin:0; flex:1; font-size:1.15rem; font-weight:700; }
.ib { border:1px solid var(--kw-line); background:var(--kw-soft); color:inherit; border-radius:10px; padding:5px 10px; font:600 13px inherit; font-family:inherit; cursor:pointer; }
.ib[disabled] { opacity:.5; cursor:default; }
.kids { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0; }
.kid { flex:1 1 150px; display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:14px; border:2px solid var(--kw-line); background:none; color:inherit; cursor:pointer; text-align:left; font:inherit; position:relative; min-width:0; }
.kid[aria-selected="true"] { border-color:var(--kc); background:color-mix(in srgb, var(--kc) 10%, transparent); }
.av { width:36px; height:36px; border-radius:50%; display:grid; place-items:center; color:#fff; font-weight:700; background:var(--kc); flex:none; }
.av.sm { width:22px; height:22px; font-size:11px; }
.kid b { display:block; }
.kid small { color:var(--kw-muted); font-size:12px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kid .dot { position:absolute; top:6px; right:8px; width:10px; height:10px; border-radius:50%; background:var(--kw-alert); }
.now { display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; background:var(--kw-soft); }
.ic { width:46px; height:46px; border-radius:12px; display:grid; place-items:center; color:#fff; flex:none; background:var(--cc); overflow:hidden; }
.ic img { width:100%; height:100%; object-fit:cover; }
.lbl { font-size:12px; color:var(--kw-muted); text-transform:uppercase; letter-spacing:.05em; font-weight:700; }
.ttl { font-weight:700; font-size:1.05rem; line-height:1.25; }
.sub, .d { font-size:13px; color:var(--kw-muted); }
.st { margin:12px 0 4px; }
.row { display:flex; justify-content:space-between; font-size:13px; }
.bar { height:10px; border-radius:6px; background:var(--kw-soft); overflow:hidden; margin-top:4px; display:flex; }
.bar i { display:block; height:100%; }
.ctrls { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; margin:14px 0 10px; }
.tg { border:1px solid var(--kw-line); background:var(--kw-soft); color:inherit; border-radius:12px; padding:8px; font:600 13px inherit; font-family:inherit; cursor:pointer; text-align:left; }
.tg small { display:block; color:var(--kw-muted); font-weight:400; font-size:12px; }
.tg.on { background:var(--kc); border-color:var(--kc); color:#fff; }
.tg.on small { color:#fff; opacity:.85; }
.tg.pause.on { background:var(--kw-alert); border-color:var(--kw-alert); }
.blk { display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:13px; }
.blk span { color:var(--kw-muted); }
.chip { border:1px solid var(--kw-line); background:none; color:inherit; border-radius:999px; padding:3px 10px; font:600 12px inherit; font-family:inherit; cursor:pointer; }
.chip.on { background:var(--primary-text-color); color:var(--card-background-color, #fff); border-color:var(--primary-text-color); text-decoration:line-through; }
.seg { display:flex; gap:4px; background:var(--kw-soft); padding:4px; border-radius:12px; margin:16px 0 10px; }
.seg button { flex:1; border:0; background:none; color:inherit; padding:6px; border-radius:9px; font:600 13px inherit; font-family:inherit; cursor:pointer; }
.seg button[aria-selected="true"] { background:var(--card-background-color, #fff); box-shadow:0 1px 3px rgb(0 0 0 / .15); }
.n { background:var(--kw-alert); color:#fff; border-radius:999px; padding:0 6px; font-size:11px; margin-left:4px; }
.list { list-style:none; margin:0; padding:0; max-height:320px; overflow:auto; }
.list li { display:grid; grid-template-columns:auto 10px minmax(0,1fr); gap:8px; align-items:start; padding:7px 0; border-bottom:1px solid var(--kw-line); font-size:14px; }
.list li:last-child { border-bottom:0; }
.list time { font:12px monospace; color:var(--kw-muted); padding-top:2px; white-space:nowrap; }
.cd { width:10px; height:10px; border-radius:50%; margin-top:6px; background:var(--cc); }
.list li.blocked b { text-decoration:line-through; color:var(--kw-muted); }
.list li.alert b { color:var(--kw-alert); text-decoration:none; }
.sites li { grid-template-columns:minmax(0,1fr) 60px; }
.sb { height:6px; border-radius:3px; background:var(--cc); margin-top:4px; }
.m { text-align:right; font:12px monospace; color:var(--kw-muted); padding-top:2px; }
.tvs li { grid-template-columns:36px minmax(0,1fr); }
.tvic { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; color:#fff; background:var(--cc); }
.wt { display:flex; gap:8px; align-items:center; margin-top:6px; }
.pg { height:6px; border-radius:3px; background:color-mix(in srgb, #d48a00 22%, transparent); overflow:hidden; margin-top:8px; }
.pg i { display:block; height:100%; background:#d48a00; }
.tvm { margin-top:4px; display:flex; align-items:center; gap:6px; }
.rt { display:inline-block; min-width:26px; text-align:center; padding:0 5px; border:1.5px solid currentColor; border-radius:5px; font:700 11px/16px inherit; font-family:inherit; }
.rt.over { background:var(--kw-alert); border-color:var(--kw-alert); color:#fff; }
.acts { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
.empty { color:var(--kw-muted); font-size:14px; padding:10px 0; }
.legend { display:flex; flex-wrap:wrap; gap:10px; font-size:12px; color:var(--kw-muted); margin-top:10px; }
.legend i { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:4px; background:var(--cc); }
.ov { position:fixed; inset:0; background:rgb(0 0 0 / .55); display:grid; place-items:center; z-index:10; padding:16px; }
.dlg { background:var(--card-background-color, #fff); color:var(--primary-text-color); border-radius:18px; padding:16px; width:min(560px, 100%); max-height:90vh; overflow:auto; }
.shead { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.shead h3 { margin:0; }
.frame { background:#0b0c0e; border-radius:12px; padding:8px; }
.screen { aspect-ratio:16/9; border-radius:5px; position:relative; overflow:hidden; color:#fff; display:flex; align-items:flex-end; background:#222 center/cover no-repeat; }
.screen.off { background:#000; align-items:center; justify-content:center; color:#777; font-weight:700; }
.screen .app { position:absolute; top:10px; left:12px; font:700 11px inherit; font-family:inherit; background:rgb(0 0 0 / .5); padding:2px 8px; border-radius:6px; letter-spacing:.06em; text-transform:uppercase; }
.screen .cap { padding:14px 16px; background:linear-gradient(transparent, rgb(0 0 0 / .7)); width:100%; }
.screen .cap b { display:block; font-size:1.6rem; line-height:1.1; }
.screen .pz { position:absolute; inset:0; display:grid; place-items:center; font-size:44px; background:rgb(0 0 0 / .4); }
.stand { width:28%; height:7px; margin:0 auto 10px; background:#0b0c0e; border-radius:0 0 6px 6px; }
.warn { background:var(--kw-alert); color:#fff; border-radius:10px; padding:8px 12px; font-weight:700; font-size:14px; margin-bottom:10px; }
`;

class KidWatchCard extends HTMLElement {
  setConfig(config) {
    this._config = { popup: true, ...(config || {}) };
    this._sel = null;
    this._view = "timeline";
    this._screen = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", e => this._click(e));
    }
  }

  static getStubConfig() { return {}; }
  getCardSize() { return 9; }

  connectedCallback() { this._tick = setInterval(() => this._render(), 30000); }
  disconnectedCallback() { clearInterval(this._tick); }

  set hass(hass) {
    this._hass = hass;
    const kids = this._kids();
    const ids = kids.flatMap(k => [k.entity_id, ...Object.values(k.attributes.switches || {}).flatMap(v => (typeof v === "string" ? [v] : Object.values(v || {}))), ...(k.attributes.tv_entities || [])]);
    const sig = ids.map(id => { const s = hass.states[id]; return s ? s.last_updated + s.state : ""; }).join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    this._autoPopup(kids);
    this._render();
  }

  _kids() {
    const want = (this._config.children || []).map(n => String(n).toLowerCase());
    return Object.values(this._hass.states)
      .filter(s => s.attributes.kid_watch && (!want.length || want.includes(String(s.attributes.child).toLowerCase())))
      .sort((a, b) => String(a.attributes.child).localeCompare(b.attributes.child));
  }

  _seen(cid, val) {
    const key = "kid-watch-seen-" + cid;
    try {
      if (val !== undefined) localStorage.setItem(key, val);
      return localStorage.getItem(key) || "";
    } catch { return ""; }
  }

  // a show above the age limit opens the TV pop-up, once per alert
  _autoPopup(kids) {
    if (!this._config.popup) return;
    for (const k of kids) {
      const a = (k.attributes.alerts || [])[0];
      if (!a || a.type !== "tv" || Date.now() - new Date(a.t) > 120000) continue;
      const key = k.attributes.child_id + a.t;
      if (this._popped === key) continue;
      this._popped = key;
      this._screen = { cid: k.attributes.child_id, auto: true };
      this._sel = k.attributes.child_id;
    }
  }

  _t(key, vars) {
    const s = (KW_I18N[this._lang] || {})[key] ?? KW_I18N.en[key];
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
  }

  // "1 device" / "3 devices", with Polish's extra plural form
  _dev(n) {
    const few = this._lang === "pl" && n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
    return this._t(n === 1 ? "dev_one" : few ? "dev_few" : "dev_other", { n });
  }

  _cat(c) { return this._t("cat_" + (KW_CATS[c] ? c : "web")); }

  _call(domain, service, data) { this._hass.callService(domain, service, data); }

  _click(e) {
    const t = e.target.closest("[data-a]");
    if (!t) { if (e.target.classList.contains("ov")) { this._screen = null; this._render(); } return; }
    const a = t.dataset.a, v = t.dataset.v;
    if (a === "kid") { this._sel = v; }
    else if (a === "view") { this._view = v; }
    else if (a === "toggle") { this._call("switch", "toggle", { entity_id: v }); return; }
    else if (a === "tvpause") { this._call("media_player", "media_play_pause", { entity_id: v }); return; }
    else if (a === "tvoff") { this._call("media_player", "turn_off", { entity_id: v }); return; }
    else if (a === "screen") { this._screen = { cid: v, eid: t.dataset.e, auto: false }; }
    else if (a === "close") { this._screen = null; }
    else if (a === "more") { this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: v } })); return; }
    this._render();
  }

  _tvBlock(k, tv, inPopup) {
    const known = tv.duration && tv.position != null;
    const pct = known ? Math.min(100, tv.position / tv.duration * 100) : 0;
    const left = known ? Math.max(0, Math.round((tv.duration - tv.position) / 60)) : null;
    const over = kwOver(tv.rating, k.attributes.age_limit);
    return `${known ? `<div class="pg"><i style="width:${pct}%"></i></div>` : ""}
      <div class="d tvm">${tv.rating ? `<span class="rt${over ? " over" : ""}">${kwEsc(String(tv.rating).split("/").pop())}</span>` : ""}${left !== null ? this._t("min_left", { n: left }) : ""}${tv.paused ? " · " + this._t("paused_sm") : ""}</div>
      <div class="acts">${inPopup ? "" : `<button class="ib" data-a="screen" data-v="${kwEsc(k.attributes.child_id)}" data-e="${kwEsc(tv.entity_id)}">${this._t("screen")}</button>`}
        <button class="ib" data-a="tvpause" data-v="${kwEsc(tv.entity_id)}">${tv.paused ? this._t("play") : this._t("pause_tv")}</button>
        <button class="ib" data-a="tvoff" data-v="${kwEsc(tv.entity_id)}">${this._t("turn_off")}</button></div>`;
  }

  _render() {
    if (!this._hass || !this.shadowRoot) return;
    this._lang = kwLang(this._hass, this._config);
    const kids = this._kids();
    if (!kids.length) {
      this.shadowRoot.innerHTML = `<style>${KW_STYLE}</style><ha-card><div class="empty">${kwEsc(this._t("no_children"))}</div></ha-card>`;
      return;
    }
    if (!kids.some(k => k.attributes.child_id === this._sel)) this._sel = kids[0].attributes.child_id;
    const k = kids.find(x => x.attributes.child_id === this._sel), A = k.attributes, sw = A.switches || {};
    const isOn = id => id && this._hass.states[id] && this._hass.states[id].state === "on";
    const n = A.now;

    const tabs = kids.map(c => {
      const a = c.attributes, line = a.paused ? this._t("cat_paused") : a.now ? (a.now.kind === "tv" ? "📺 " : "") + a.now.title : this._t("nothing_now");
      const unseen = (a.alerts || []).length && (a.alerts[0].t > this._seen(a.child_id));
      return `<button class="kid" role="tab" aria-selected="${a.child_id === this._sel}" data-a="kid" data-v="${kwEsc(a.child_id)}" style="--kc:${kwEsc(a.color)}">
        <span class="av">${kwEsc(String(a.child)[0])}</span><span style="min-width:0"><b>${kwEsc(a.child)}</b><small>${kwEsc(line)}</small></span>${unseen ? `<span class="dot"></span>` : ""}</button>`;
    }).join("");

    let now;
    if (A.paused) now = `<div class="ic" style="--cc:var(--kw-alert)"><ha-icon icon="${KW_ICON.paused}"></ha-icon></div><div><div class="lbl">${this._t("now")}</div><div class="ttl">${this._t("internet_paused")}</div><div class="sub">${this._dev((A.devices || []).length)}</div></div>`;
    else if (n && n.kind === "tv") now = `<div class="ic" style="--cc:${KW_CATS.tv[1]}">${n.picture ? `<img src="${kwEsc(n.picture)}" alt="">` : `<ha-icon icon="${KW_ICON.tv}"></ha-icon>`}</div><div style="min-width:0;flex:1"><div class="lbl">${this._t("watching")}</div><div class="ttl">${kwEsc(n.title)}</div><div class="sub">${kwEsc([n.app, n.tv].filter(Boolean).join(" · "))}</div>${this._tvBlock(k, n)}</div>`;
    else if (n) now = `<div class="ic" style="--cc:${(KW_CATS[n.category] || KW_CATS.web)[1]}"><ha-icon icon="${KW_ICON[n.category] || KW_ICON.web}"></ha-icon></div><div style="min-width:0"><div class="lbl">${this._t(n.category === "gaming" ? "playing" : n.category === "school" ? "schoolwork" : "on")}</div><div class="ttl">${kwEsc(n.title)}</div><div class="sub">${kwEsc(n.device)}</div></div>`;
    else now = `<div class="ic" style="--cc:#8a8f98"><ha-icon icon="${KW_ICON.idle}"></ha-icon></div><div><div class="lbl">${this._t("now")}</div><div class="ttl">${this._t("nothing_now")}</div><div class="sub">${kwEsc(this._t("no_activity", { child: A.child }))}</div></div>`;

    const used = A.screen_time || 0, budget = A.budget || 0, tot = Math.max(used, budget, 1);
    const bar = Object.entries(A.by_category || {}).map(([c, m]) => `<i style="width:${m / tot * 100}%;background:${(KW_CATS[c] || KW_CATS.web)[1]}" title="${kwEsc(this._cat(c))}: ${kwDur(m)}"></i>`).join("");

    const tg = (id, cls, title, sub) => `<button class="tg ${cls}${isOn(id) ? " on" : ""}" data-a="toggle" data-v="${kwEsc(id)}" ${id ? "" : "disabled"}>${title}<small>${sub}</small></button>`;
    const ctrls = tg(sw.pause, "pause", this._t(isOn(sw.pause) ? "resume" : "pause"), isOn(sw.pause) ? this._t("all_blocked") : this._dev((A.devices || []).length))
      + tg(sw.bedtime, "", this._t("bedtime"), isOn(sw.bedtime) ? kwEsc(this._t("pauses", { from: A.bedtime, to: A.wake_time })) : this._t("off"))
      + tg(sw.safesearch, "", this._t("safesearch"), isOn(sw.safesearch) ? this._t("safesearch_on") : this._t("off"))
      + tg(sw.stop_over_age, "", kwEsc(this._t("age_limit", { limit: A.age_limit })), this._t(isOn(sw.stop_over_age) ? "stops_older" : "alerts_only"));
    const chips = Object.entries(sw.services || {}).filter(([, id]) => id).map(([s, id]) => `<button class="chip${isOn(id) ? " on" : ""}" data-a="toggle" data-v="${kwEsc(id)}">${kwEsc((A.services || {})[s] || s)}</button>`).join("");

    const alerts = A.alerts || [];
    let view;
    if (this._view === "tvs") view = this._tvsView(kids);
    else if (this._view === "sites") {
      const rows = A.top_sites || [], max = rows.length ? rows[0].minutes || 1 : 1;
      view = rows.length ? `<ul class="list sites">${rows.map(r => `<li><div><b style="font-size:14px">${kwEsc(r.name)}</b><div class="sb" style="--cc:${(KW_CATS[r.category] || KW_CATS.web)[1]};width:${r.minutes / max * 100}%"></div></div><span class="m">${kwDur(r.minutes)}</span></li>`).join("")}</ul>` : `<div class="empty">${this._t("nothing_yet")}</div>`;
    } else if (this._view === "alerts") {
      if (alerts.length) this._seen(A.child_id, alerts[0].t);
      view = alerts.length ? `<ul class="list">${alerts.map(e => `<li class="alert"><time>${kwTime(e.t, this._hass)}</time><span class="cd" style="--cc:var(--kw-alert)"></span><div><b>${kwEsc(e.title)}</b><div class="d">${kwEsc(e.detail)}</div></div></li>`).join("")}</ul>` : `<div class="empty">${this._t("no_alerts")}</div>`;
    } else {
      const tl = A.timeline || [];
      view = tl.length ? `<ul class="list">${tl.map(e => `<li class="${e.category === "blocked" ? "blocked" : ""}${e.alert ? " alert" : ""}"><time>${kwTime(e.t, this._hass)}</time><span class="cd" style="--cc:${e.alert ? "var(--kw-alert)" : (KW_CATS[e.category] || KW_CATS.web)[1]}"></span><div><b>${kwEsc(e.title)}</b><div class="d">${kwEsc(e.detail)}</div></div></li>`).join("")}</ul>` : `<div class="empty">${this._t("nothing_yet")}</div>`;
    }
    const seg = [["timeline", "timeline"], ["tvs", "tvs"], ["sites", "top_sites"], ["alerts", "alerts"]].map(([v, l]) =>
      `<button role="tab" data-a="view" data-v="${v}" aria-selected="${this._view === v}">${this._t(l)}${v === "alerts" && alerts.length ? `<span class="n">${alerts.length}</span>` : ""}</button>`).join("");
    const legend = ["video", "social", "gaming", "school", "tv", "blocked"].map(c => `<span><i style="--cc:${KW_CATS[c][1]}"></i>${kwEsc(this._cat(c))}</span>`).join("");

    this.shadowRoot.innerHTML = `<style>${KW_STYLE}</style>
      <ha-card style="--kc:${kwEsc(A.color)}">
        <div class="top"><h2>${kwEsc(this._config.title || "Kid Watch")}</h2><button class="ib" data-a="more" data-v="${kwEsc(k.entity_id)}" title="${this._t("details")}" aria-label="${this._t("details")}"><ha-icon icon="mdi:information-outline" style="--mdc-icon-size:18px;width:18px;height:18px"></ha-icon></button></div>
        <div class="kids" role="tablist">${tabs}</div>
        <div class="now">${now}</div>
        <div class="st"><div class="row"><span>${this._t("screen_time")}</span><span>${budget ? this._t("of_budget", { used: `<b style="${used > budget ? "color:var(--kw-alert)" : ""}">${kwDur(used)}</b>`, budget: kwDur(budget) }) : `<b>${kwDur(used)}</b>`}</span></div><div class="bar">${bar}</div></div>
        <div class="ctrls">${ctrls}</div>
        ${chips ? `<div class="blk"><span>${kwEsc(this._t("block"))}</span>${chips}</div>` : ""}
        <div class="seg" role="tablist">${seg}</div>
        ${view}
        <div class="legend">${legend}</div>
      </ha-card>${this._screen ? this._screenView(kids) : ""}`;
  }

  _tvsView(kids) {
    const all = new Map();
    for (const c of kids) {
      for (const eid of c.attributes.tv_entities || []) if (!all.has(eid)) all.set(eid, null);
      for (const tv of c.attributes.tvs || []) all.set(tv.entity_id, { kid: c, tv });
    }
    if (!all.size) return `<div class="empty">${kwEsc(this._t("no_tvs"))}</div>`;
    return `<p class="d" style="margin:0 0 4px">${kwEsc(this._t("tvs_intro"))}</p><ul class="list tvs">${[...all].map(([eid, w]) => {
      const st = this._hass.states[eid], name = w ? w.tv.tv : (st ? st.attributes.friendly_name || eid : eid);
      return `<li><span class="tvic" style="--cc:${w ? KW_CATS.tv[1] : "#8a8f98"}"><ha-icon icon="mdi:television"></ha-icon></span><div style="min-width:0"><b>${kwEsc(name)}</b>
        ${w ? `<div class="wt"><span class="av sm" style="--kc:${kwEsc(w.kid.attributes.color)}">${kwEsc(String(w.kid.attributes.child)[0])}</span><span><b>${kwEsc(w.tv.title)}</b><span class="d">${w.tv.app ? " · " + kwEsc(w.tv.app) : ""}</span></span></div>${this._tvBlock(w.kid, w.tv)}`
          : `<div class="d">${this._t(st && st.state === "off" ? "off" : "nothing_playing")}</div>`}</div></li>`;
    }).join("")}</ul>`;
  }

  _screenView(kids) {
    const k = kids.find(x => x.attributes.child_id === this._screen.cid);
    if (!k) return "";
    const A = k.attributes, tvs = A.tvs || [];
    const tv = tvs.find(t => t.entity_id === this._screen.eid) || tvs[0];
    const head = `<div class="shead"><h3>${kwEsc(this._t("childs_tv", { child: A.child }))}</h3><button class="ib" data-a="close" aria-label="${this._t("close")}">✕</button></div>`;
    if (!tv) return `<div class="ov"><div class="dlg">${head}<div class="frame"><div class="screen off">${this._t("tv_off")}</div></div><div class="stand"></div><p class="d">${kwEsc(this._t("nothing_for", { child: A.child }))}</p></div></div>`;
    const over = kwOver(tv.rating, A.age_limit);
    const pic = tv.picture ? `background-image:url('${kwEsc(tv.picture)}')` : "background:linear-gradient(135deg,#3b5bdb,#1b1d3a)";
    return `<div class="ov"><div class="dlg" role="dialog" aria-label="${kwEsc(this._t("childs_tv", { child: A.child }))}">${head}
      ${over ? `<div class="warn">⚠ ${kwEsc(this._t("over_warn", { rating: String(tv.rating).split("/").pop(), child: A.child, limit: A.age_limit }))}</div>` : ""}
      <div class="frame"><div class="screen" style="${pic}">${tv.app ? `<span class="app">${kwEsc(tv.app)}</span>` : ""}
        <div class="cap"><b>${kwEsc(tv.show)}</b>${tv.episode ? `<span>${kwEsc(tv.episode)}</span>` : ""}</div>${tv.paused ? `<div class="pz">❚❚</div>` : ""}</div></div><div class="stand"></div>
      <div class="wt"><span class="av sm" style="--kc:${kwEsc(A.color)}">${kwEsc(String(A.child)[0])}</span><span><b>${kwEsc(A.child)}</b> · ${kwEsc(tv.tv)}</span></div>
      ${this._tvBlock(k, tv, true)}
      <p class="d" style="margin:10px 0 0">${kwEsc(this._t("artwork"))}</p></div></div>`;
  }
}

if (!customElements.get("kid-watch-card")) customElements.define("kid-watch-card", KidWatchCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === "kid-watch-card")) {
  window.customCards.push({ type: "kid-watch-card", name: "Kid Watch", description: "What each child is watching and browsing, with screen time and AdGuard controls.", preview: false });
}
console.info(`%c KID-WATCH-CARD %c ${KW_VERSION} `, "background:#ffcc00;color:#000;font-weight:700", "background:#222;color:#fff");
