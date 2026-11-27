# Dashboard personalizzabile

🌐 Italiano · [English](en/dashboard.md) · [Français](fr/dashboard.md)

La dashboard ha **tre viste**, ognuna con la sua griglia di **widget** che si possono spostare, ridimensionare, configurare, togliere o aggiungere più volte, e alcune pagine:

- **Adesso**: sempre sul giorno dei budget, senza filtri. Quanto hai consumato oggi, a che punto sono i budget, che cosa sta facendo OpenCode in questo momento.
- **Analisi**: con i filtri di periodo, raggruppamento e metrica. Andamento nel tempo, ritmo di lavoro, quota per modello, i prompt più pesanti. Il periodo parte da **7 giorni**; quello scelto resta in questo browser (`localStorage`, chiave `lens:range`), quindi chi ne aveva già scelto uno lo ritrova.
- **Monitor**: da tenere aperta su uno schermo. Niente filtri, sempre il giorno dei budget, si aggiorna da sola e ha un pulsante **Schermo intero**; se il browser lo rifiuta non succede nulla.
- **Prompt** e **Sessioni**: la lista dei prompt e quella delle sessioni a tutta pagina, con i filtri di Analisi nella barra del titolo. Non sono personalizzabili.
- **Galleria**, **Skill**, **Novità** e **Impostazioni**: vedi [Le pagine](#le-pagine).

La disposizione è personale: la salva la lens sul tuo computer e non finisce mai nel pacchetto di rilascio. Un'installazione nuova parte dalla disposizione predefinita (vedi [Disposizioni predefinite](#disposizioni-predefinite)).

## La barra del titolo

Ogni pagina ha in alto la sua barra: l'icona della sezione (la stessa della barra laterale), il titolo e sotto una riga che dice che cosa si sta guardando.

| Pagina | Riga sotto il titolo | A destra |
|---|---|---|
| Adesso | «Oggi dalle 00:00 · reset tra 2 h 32 min · 1 prompt in corso» (il giorno dei budget; con `LENS_RESET_HOUR` l'ora di partenza è quella; in pausa finisce con «· in pausa · dati fermi alle 14:31:07») | lo stato del collegamento con OpenCode, Personalizza |
| Analisi | i filtri scritti per esteso: «Ultimi 7 giorni · per modello · in token» | i filtri, Personalizza |
| Monitor | «Si aggiorna da sola · reset tra 2 h 32 min»; in pausa «In pausa · dati fermi alle 14:31:07 · reset tra 2 h 32 min» | il collegamento, l'orologio, Schermo intero, Personalizza |
| Prompt, Sessioni | che cosa elencano, con i filtri di Analisi | i filtri |
| Galleria, Skill, Novità, Impostazioni | il contenuto della pagina | i comandi della pagina |

## La barra laterale

A sinistra, larga 200 px, dall'alto in basso:

1. **Marchio** con il nome; sotto, «beta» e la versione installata, che è un link a Novità. Subito sotto il pulsante **Riduci a icone**.
2. **Navigazione**, in tre gruppi. La voce aperta ha `aria-current="page"`.
   - *Dashboard*: Adesso (con il numero di prompt in corso), Analisi, Monitor e **Modello** (vedi [Modelli di dashboard](#modelli-di-dashboard)).
   - *Dati*: Prompt (con il numero di prompt di oggi), Sessioni (con il numero di sessioni del periodo di Analisi). Vibe Coding è un modulo: con il modulo attivo ha la sua voce in fondo a questo gruppo.
   - *Lens*: Galleria, Novità (con un punto quando c'è una versione che non hai ancora segnato come letta), Impostazioni. I moduli attivi hanno la loro voce in fondo al gruppo che dichiarano (Skill, Sistema e Security, in *Lens*, prima di Impostazioni).
3. **In fondo** lo stato del collegamento con OpenCode, come un badge con pallino e testo («Collegato a OpenCode»: verde se collegato, giallo in connessione, rosso se non raggiungibile o se i dati sono fermi), e sotto il pulsante del tema, che gira tra sistema, chiaro e scuro e dice quello attuale, con un'icona per modo (portatile, sole, luna). Con il menu a icone il badge resta solo il pallino. Passando il mouse sul badge compare lo stato con l'ultimo evento ricevuto («Collegato a OpenCode · ultimo evento 3 s fa (14:31)», o «nessun evento ricevuto finora») e la versione di OpenCode; stesso testo, nascosto, per i lettori di schermo. Lo stato è un `role="status"`; il pallino pulsa solo se c'è un evento recente e il sistema non chiede meno animazioni. Tra il badge e il tema ci sono **Pausa** (poi **Riprendi**) e **Aggiorna**, solo icone con la barra stretta: vedi [Aggiornamenti dal vivo](#aggiornamenti-dal-vivo). In pausa il badge è grigio, senza pulsazione: «In pausa · Dati fermi alle 14:31:07».

Passando il mouse su una voce la riga si evidenzia e l'icona prende il colore d'accento.

**Riduci a icone** stringe la barra a 64 px, solo icone, per lasciare più spazio alla dashboard; lo stesso pulsante, ora «Espandi il menu», la riporta larga. La scelta resta in questo browser (`localStorage`, chiave `lens:railCollapsed`). Con la barra a icone, passando il mouse su un'icona (o arrivandoci con Tab) compare accanto un popup con il nome della voce; i contatori non si vedono.

**Schermi stretti**: sotto 1100 px la barra è sempre a icone, con gli stessi popup (il pulsante per ridurla non serve e non c'è); sotto 760 px diventa una barra in alto con il marchio e un pulsante menu, che apre la navigazione come pannello (Esc o un clic fuori lo chiudono).

### Modelli di dashboard

**Modello** è l'ultima voce del gruppo Dashboard e dice quale disposizione predefinita stanno usando le tre viste: «Consigliata», «Operativa», «Presidio», «Classica», uno dei tuoi [preset](#preset-personalizzati) o, se hai spostato, aggiunto o configurato qualcosa, «Personalizzata». Se la disposizione parte da un modello o da un preset ma l'hai cambiata, il nome resta e si aggiunge «· con modifiche» (per esempio «Consigliata · con modifiche»). Il confronto ignora gli id dei widget e il loro ordine nel file.

Un clic (o Invio, o freccia giù) apre accanto alla barra il menu dei modelli. La voce con il focus (con le frecce, Home e Fine, o passandoci sopra con il mouse) mostra a lato un popover con la descrizione del modello e una riga per Adesso, Analisi e Monitor; il popover è anche la descrizione accessibile della voce (`aria-describedby`). Esc chiude il menu e riporta il focus su Modello; Tab o un clic fuori lo chiudono.

Scegliere un modello lo salva subito per tutte e tre le viste, come «Salva» in modifica. Passare da un modello all'altro non chiede conferma, perché basta sceglierne di nuovo uno; se la disposizione è personalizzata o ha delle modifiche la lens chiede prima di sostituirla, e «Salva come preset…» (vedi sotto) è il modo di conservarla. Le viste di una versione più nuova della lens che il file eventualmente contiene restano com'erano. Modello è disattivato mentre modifichi la dashboard e quando la lens non accetta modifiche da questo browser (solo da questo computer).

- **Consigliata**: ogni vista ha un ruolo e un orizzonte suo. Adesso è la giornata da vicino (token, costo e cache contro la media, i tre budget, il ritmo per modello, il prompt in corso, le sessioni e i prompt di oggi); Analisi segue i filtri dall'alto in basso (riepilogo, andamento, dove vanno token e costo, distribuzione, i più pesanti, tool e permessi) e tiene in fondo i widget a finestra fissa; Monitor usa le carte che a schermo intero ingrandiscono le cifre.
- **Operativa**: per chi lavora con l'agente tutto il giorno (sistemi, troubleshooting, codice). Solo utilizzo e budget del giorno: nessun widget, stile, colonna o metrica che mostri un costo o i budget della settimana e del mese, e in Analisi la metrica di ogni widget è fissata ai token, così il filtro «Costo» della barra non la cambia. Adesso risponde a «arrivo a sera?» (budget del giorno con quanto resta e i token all'ora, token e prompt contro la media, ora per ora, per modello con il ritmo, sessioni e prompt di oggi); Analisi a «dove perdo tempo?» (cache, step falliti ed errori dei tool, andamento, modelli e progetti, cosa è cambiato, primo token e velocità, tool, i più pesanti); Monitor a «l'agente sta bene?» (quattro quadranti a semaforo, il prompt in corso senza il costo, il registro di esiti, step falliti, errori, retry, permessi e compaction senza gli step riusciti, modelli, stato e ore di oggi). Il modello spegne anche «Mostra i costi» (vedi sotto), quindi nessun importo compare neanche nelle pagine Prompt e Sessioni e nel dettaglio di sessione.
- **Presidio**: il meglio degli altri tre, con le stesse regole di Operativa (niente costi, niente budget di settimana e mese) ma con le statistiche di quei periodi. Adesso ha il budget del giorno con quanto resta, token e cache contro la norma, ore, ritmo per modello, sessioni e prompt di oggi; Analisi segue i filtri dalle quote di errore ai token e agli step nel tempo, all'imbuto dei prompt, a modelli, progetti, distribuzione, primo token, tool e i più pesanti, e in fondo tiene le finestre fisse: «Ultimi 7 giorni» e «Ultimi 30 giorni» (prompt, esiti e durate), primo token e affidabilità a 30 giorni, ritmo a 28; Monitor è una schermata di cifre grandi: token, budget del giorno, step falliti ed errori dei tool, il prompt in corso senza il costo, registro senza gli step riusciti, stato, ore e modelli.
- **Classica**: la disposizione delle versioni fino alla 0.20, descritta in [Disposizioni predefinite](#disposizioni-predefinite). È ancora quella di un'installazione nuova.

### Preset personalizzati

Un preset è una tua copia con nome delle tre viste (e di «Mostra i costi»): lo crei da un modello o dalla disposizione in uso, lo modifichi con «Personalizza» e lo ritrovi nel menu **Modello**, sotto i quattro modelli, in «I tuoi preset». Al massimo 10 preset, con un nome di 1–40 caratteri e diverso dagli altri (maiuscole e spazi attorno non contano). I quattro modelli integrati non cambiano mai: modificarli con «Personalizza» cambia solo la disposizione in uso, mai il modello.

Sotto la lista il menu ha le azioni:

- **Salva come preset…** apre la finestra con il cursore nel nome, già «Partendo da» la disposizione in uso; il preset nuovo diventa quello in uso.
- **Aggiorna il preset «X»** (solo se stai usando un preset con modifiche) salva le modifiche nel preset: la prossima volta che lo scegli le ritrovi.
- **Torna a «X»** (solo con modifiche) scarta le modifiche e riapplica il modello o il preset da cui sei partito, dopo una conferma. È diverso da «Annulla» in modifica, che vale solo prima di «Salva».
- **Gestisci preset…** apre la finestra dove si creano, si rinominano, si duplicano («Casa (copia)», «Casa (copia 2)»…) e si eliminano i preset. Creando un preset da un modello o da un altro preset lo si usa subito (con una conferma se la disposizione attuale ha modifiche non salvate). Eliminare il preset in uso non cambia la disposizione, che resta com'è, senza più un preset di partenza (risulta «Personalizzata», a meno che non coincida con un modello o un altro preset). Mentre un salvataggio è in corso «Chiudi» è disattivato; la conferma per sostituire una disposizione con modifiche arriva prima di salvare il preset, e annullarla lascia il modulo com'era.

La disposizione ricorda da quale modello o preset è partita in `prefs.origin` (`t:<modello>` o `p:<id del preset>`), dentro `dashboard-v2.json`, così si salva insieme alla disposizione. Un valore in un formato che questa versione non conosce (di una versione più nuova) si conserva e non indica nessun modello: la disposizione risulta «Personalizzata» invece di essere rifiutata. Se quel preset è stato eliminato, la disposizione risulta «Personalizzata», a meno che non coincida con un altro preset o modello. I preset stanno in `dashboard-presets.json`, accanto a `dashboard-v2.json`: come la disposizione si scrivono solo da questo computer (`GET` e `POST /api/presets`, in [metriche.md](metriche.md#api-locale)). Se il file è rotto o ha un preset non valido, la lens lo ignora (l'elenco è vuoto), lo scrive nel log (una volta per contenuto, non a ogni caricamento della pagina) e ne tiene una copia in `dashboard-presets.bad.json` (una volta sola, mai sovrascritta), così il prossimo salvataggio non distrugge i preset che conteneva. Il menu e la finestra rileggono i preset prima di ogni modifica, quindi una scheda rimasta aperta non cancella i preset salvati da un'altra; due salvataggi nello stesso istante, però, si sovrascrivono: vale l'ultimo.

**Mostra i costi** è una casella nella barra di Personalizza e vale per tutte e tre le viste. Si salva con «Salva» insieme alla disposizione (`prefs.costs` in `dashboard-v2.json`) e «Annulla» la riporta com'era. Operativa e Presidio la spengono, Consigliata e Classica la accendono. Spenta, il costo sparisce ovunque:

- il filtro «Costo» di Analisi (se era scelto, si passa ai token);
- le colonne del costo di Prompt, Sessioni e della tabella per dimensione;
- la cifra del costo nel Riepilogo e negli Indicatori di oggi;
- l'importo del prompt in corso, degli step nell'Attività live e del dettaglio di sessione;
- l'asse «costo basso» del radar G11.

I widget che mostrano solo un costo (Indicatore, Budget o Gauge del costo, la cascata C9, un Andamento o un calendario fissati sul costo) dicono «Costi nascosti».

Ogni pagina ha un indirizzo: `#adesso`, `#analisi`, `#monitor`, `#prompt`, `#sessioni`, `#galleria`, `#novita`, `#vibecoding`, `#sistema`, `#security`, `#impostazioni`. Un vecchio segnalibro `#dashboard` porta all'ultima vista usata (all'inizio Adesso). Passando da una pagina all'altra pagina e dettagli aperti non si perdono; si leggono solo i dati di quello che vedi.

## Modificare la disposizione

Premi **Personalizza** (il pulsante azzurro con l'icona della griglia), in alto a destra nella barra del titolo di una delle tre viste. La modifica riguarda la vista visibile, ma **una sola sessione copre tutte e tre**: puoi cambiare vista mentre modifichi. Prompt, Sessioni, Galleria, Novità e Impostazioni non si personalizzano. La griglia (12 colonne, righe da 40 px) compare in tratteggiato e ogni widget riceve i suoi comandi:

| Comando | Cosa fa |
|---|---|
| **⠿** (in alto al centro) | trascina per spostare il widget; il riquadro tratteggiato mostra dove atterrerà |
| **angolo** in basso a destra | trascina per cambiare larghezza e altezza, a passi di una cella |
| **⚙** | impostazioni del widget (vedi sotto) |
| **×** | toglie il widget |

La posizione è **libera**, come nelle griglie «float» (Gridstack, il layout libero di Grafana): un widget resta dove lo lasci, anche con righe vuote sopra o accanto, e scende soltanto chi viene urtato da uno spostamento o da un ingrandimento. Nessun widget risale da solo, e togliere un widget lascia il suo posto vuoto. Per chiudere gli spazi vuoti c'è **Compatta**.

Dalla barra in alto:

- **+ Aggiungi widget** apre il catalogo, che mostra prima i tipi pensati per la vista visibile («Per questa vista») e poi gli altri («Altri»). Ogni voce si può aggiungere più volte, per esempio due grafici con impostazioni diverse, e arriva con la [dimensione predefinita del suo stile](#dimensioni-per-stile). Ogni vista tiene al massimo 60 widget: arrivati lì le voci del catalogo si disattivano finché non ne togli uno.
- In cima al catalogo, **Dove** sceglie da dove parte il nuovo widget:

  | Scelta | Dove va |
  |---|---|
  | ↖ in alto a sinistra, ↗ in alto a destra | nella prima riga, a sinistra o a destra; chi c'era scende |
  | ↙ in fondo a sinistra (di partenza), ↘ in fondo a destra | sotto il widget più in basso |
  | ✛ scegli sulla griglia | dopo aver scelto la voce, il riquadro del widget segue il puntatore e i widget che verrebbero spinti si spostano per mostrarlo; un clic lo mette lì. Da tastiera: frecce per spostarlo, Invio per confermare, Esc per annullare |

  La scelta resta per le aggiunte successive, in questo browser (`localStorage`, chiave `lens:add-place`).
- **Compatta** fa salire ogni widget, nell'ordine di lettura, finché non tocca il bordo in alto o il widget sopra: chiude gli spazi vuoti lasciati dagli spostamenti.
- La griglia arriva alla riga 1001: uno spostamento o un ingrandimento che spingerebbe un widget più in basso non viene applicato, e la barra lo dice.
- **Salva** conserva la disposizione di **tutte e tre** le viste. Se qualcosa non va (per esempio un widget fuori griglia), la barra elenca gli errori e resti in modifica.
- **Annulla** scarta tutto quello che hai cambiato, in tutte le viste, da quando sei entrato in modifica.
- **Ripristina** riporta alla disposizione predefinita **solo la vista visibile**, dopo una conferma che la nomina. Resta dentro la sessione di modifica: «Salva» la conserva, «Annulla» la scarta (e le altre viste non cambiano).

Se la tua disposizione viene da una versione precedente (vedi [Migrazione](#migrazione-da-una-versione-precedente)), la prima volta che apri il catalogo vedi in cima «Nuovi widget disponibili» con i tipi arrivati con le due viste. I widget nuovi non compaiono da soli in una disposizione personalizzata: li aggiungi tu. Fa eccezione **Monitor**: è una vista nuova, e se la tua disposizione non l'ha ancora prende quella predefinita.

Uscire dalla pagina con modifiche non salvate chiede conferma. Se restringi la finestra sotto i 700 px la modifica si sospende senza perdere niente: barra e comandi spariscono e tornano, con le modifiche fatte, quando la finestra torna larga.

### Da tastiera

In modifica ogni widget si raggiunge con Tab. Con un widget selezionato:

| Tasti | Effetto |
|---|---|
| frecce | sposta di una cella (chi viene urtato scende) |
| Maiusc + frecce | ridimensiona di una cella |
| Canc / Backspace | toglie il widget |

La nuova posizione viene annunciata agli screen reader.

### Quando il pulsante non c'è

- **Dashboard aperta da un altro computer** (`LENS_HOST` non locale con `LENS_TOKEN`): vedi la disposizione salvata ma non puoi cambiarla. Le modifiche si accettano solo da questo computer.
- **Finestra più stretta di 700 px**: i widget si impilano in una colonna, nell'ordine della griglia (per riga, poi per colonna), e la modifica non è disponibile (una modifica già iniziata resta sospesa, vedi sopra).

## Impostazioni del widget (⚙)

Ogni scelta ha anche **Dashboard**, il valore di partenza. In Analisi segue i filtri in alto, che cambiano solo i widget lasciati su «Dashboard». In Adesso e in Monitor, che non hanno filtri, vale il giorno dei budget con metrica token e raggruppamento per modello, e nel ⚙ si chiama **Vista (oggi)**. Un widget con un periodo proprio lo mostra accanto al titolo (per esempio «30 giorni»).

| Impostazione | Widget | Valori |
|---|---|---|
| Titolo | tutti | testo libero, al massimo 80 caratteri; vuoto = titolo automatico (per esempio «Costo per agente») |
| Periodo | Prompt, Prompt: distribuzione, Andamento, Interazione, Riepilogo, Tabella, Tool, Sessioni, Gauge, Dove vanno i token, Velocità | **Oggi** (il giorno dei budget, da mezzanotte o da `LENS_RESET_HOUR`), 1 ora, 8 ore, 24 ore, 7 giorni, 30 giorni, tutto |
| Metrica | Ultimo anno, Andamento | token, costo, step |
| Indicatore | Indicatore (`kpi`) | token, cache, prompt, costo, errori dei tool, primo token, retry |
| Periodo del budget | Budget | giorno, settimana, mese |
| Metrica | Budget | **token** (anche quando manca), step, costo; senza «Mostra i costi» il ⚙ non propone il costo |
| Raggruppa per | Andamento, Tabella per dimensione | modello, agente, provider, tipo di agente; la tabella anche per cartella, l'andamento anche «Totale» (una sola serie) |
| Ordine | Prompt | recenti, più pesanti (per token), più lunghi (per durata) |
| Cosa misura | Gauge | vedi sotto |
| Modello | Gauge «Budget giornaliero di un modello» | uno dei modelli con un budget attivo (card «Budget per modello» delle Impostazioni); il primo è scelto in automatico, e un modello che perde il budget o esce dalla configurazione di OpenCode resta selezionato come «non più configurato» |
| Stile | tutti i widget con più di un modello | vedi [Stili](#stili) |
| Colonne | Prompt (e «I più pesanti») | un sottoinsieme delle colonne, in qualunque ordine: ora, sessione, progetto, modello, agente, esito, durata, primo token, token al secondo, step, tool, composizione, token, costo, cache, e solo per «I più pesanti» la quota del periodo |
| Righe | Prompt | comoda, compatta |
| Prompt mostrati | Prompt | tutti, solo con problemi (falliti, interrotti o con un tool in errore: gli ultimi del periodo, a pagine, non quelli fra gli ultimi prompt) |
| Eventi mostrati | Attività live (tutti gli stili, anche il classico) | un sottoinsieme di prompt, tutti gli step, step falliti, errori dei tool, compaction, sessioni, avvisi; i `git commit` del classico, che non hanno un tipo, compaiono solo con tutti i tipi scelti |
| Ora degli eventi | Attività live | relativa («2 min fa»), orario |
| Sessione dell'evento | Attività live | mostrata, nascosta |
| Costo | Prompt in corso | mostrato (se manca), nascosto: per uno schermo che non deve mostrare costi |

«Tutti gli step» (`step`) comprende anche quelli falliti, come prima che ci fosse «Step falliti» (`failed`): una disposizione salvata con `step` continua a vederli. Per nascondere gli step riusciti, che portano il costo, senza perdere quelli falliti e i loro errori, togli «Tutti gli step» e lascia «Step falliti».

Le impostazioni delle tabelle (colonne, righe, filtri) si vedono nel ⚙ solo mentre il widget è disegnato da uno stile a tabella, tranne «Eventi mostrati», che vale anche per l'Attività live classica; un elenco vuoto (nessuna colonna scelta) vale come «tutte quelle predefinite». Il numero di righe non è un'impostazione: lo decide l'altezza del widget. Le modifiche si vedono subito; «Salva» le conserva.

## Catalogo

Dimensioni in colonne × righe (predefinita / minima); la predefinita è quella del primo stile, gli altri stili hanno la loro (vedi [Dimensioni per stile](#dimensioni-per-stile)). Tutti i widget hanno il titolo tra le impostazioni; sotto sono elencate le altre. «Stili» rimanda a [Stili](#stili): ogni widget che ne ha più di uno si disegna con quello scelto, e **la descrizione qui sotto è quella dello stile `classic`** dove esiste, o del primo stile elencato. Gli stili cambiano il disegno, mai i numeri.

| Widget | Vista | Dimensioni | Contenuto |
|---|---|---|---|
| Oggi (`hero`) | Adesso, Monitor | 8×9 / 4×6 | token di oggi in grande, con il confronto con la media dei 7 giorni precedenti **fino alla stessa ora** («+18% rispetto alla media di 7 giorni a quest'ora»; nel tooltip anche la media del giorno intero); barra della composizione (input, cache letta e scritta, output, ragionamento) con legenda e valori; budget del giorno con la proiezione e «si azzera tra …» (senza budget: i token e il link alle Impostazioni); 24 colonne ora per ora con la media dei 7 giorni come linea grigia; settimana e mese in mini barre (budget `LENS_LIMIT_*_WEEKLY` e `_MONTHLY`); costo e step solo se hanno un budget |
| Per modello oggi (`model-day`) | Adesso, Monitor | 6×5 / 3×4 | una riga per ogni modello usato oggi o con un budget attivo: token di oggi (varianti sommate), barra, quota del budget giornaliero e ritmo («entro il budget», «a questo ritmo lo supera», «budget superato», con icona); «nessun budget» altrimenti; i modelli con budget mai visti invitano a controllarne il nome; in fondo i task interni, divisi in «titoli · compaction · altro» quando la lens li conosce, con il modello delle compaction nel tooltip (non entrano nei budget per modello) |
| Indicatori di oggi (`kpis`) | Adesso | 12×3 / 4×3 | cinque tessere, ciascuna con la sparkline degli ultimi 7 giorni: prompt (chiusi e in corso), costo, cache, latenza degli step (p50 e p95), errori dei tool (percentuale e tool peggiore). Su larghezze strette passano a 3 o 2 colonne |
| Prompt in corso (`live`) | Adesso | 4×5 / 3×4 | un riquadro per ogni prompt che OpenCode sta eseguendo: titolo della sessione o cartella, agente, modello, tempo che scorre, step, chiamate tool, token finora con la composizione, **riempimento del contesto** (per esempio «61%»), il tool in esecuzione col suo tempo, «in attesa di un permesso», «in attesa del primo token» col tempo che scorre, e per l'ultimo step finito «1,8 s al primo token · 42 tok/s». Il costo finora si nasconde con l'impostazione «Costo». Senza prompt: «Nessun prompt in corso» |
| Attività live (`feed`) | Adesso, Monitor | 6×6 / 3×4 | step, tool, prompt conclusi, compaction (finite o fallite, con il motivo e il modello) e nuove sessioni appena registrati; gli stili a tabella (cronologia a fasce, registro a terminale, eventi per sessione, righe compatte) si configurano nel ⚙ (tipi di evento, ora relativa o orario, sessione mostrata o nascosta) e mostrano gli eventi più recenti che stanno nel widget. Nel registro a terminale una riga troppo lunga finisce con «…» e la sessione resta in una colonna a destra; il testo intero è nel tooltip. Il registro è bianco con il tema chiaro e nero con quello scuro |
| Prompt (`runs`) | entrambe | 12×8 / 6×5 | tabella dei prompt del periodo, a pagine (tante righe quante ne stanno nel widget, al massimo 10 per pagina): ora, sessione, modelli, esito (icona e etichetta, con il motivo di un'interruzione vista dal vivo: «interrotto · da te», «· sostituito», «· per inattività»), durata, step, tool (errori come badge), composizione dei token, totale, cache, tok/s (mediana degli step, con il primo token nel tooltip). Un clic su una riga apre sotto il dettaglio della sessione con quel prompt evidenziato. Con ordine «più pesanti», finché il widget non è alto abbastanza per una pagina intera di 10, mostra i primi che ci stanno (fino a 10), una riga ciascuno: un widget più alto non mostra mai meno righe. Ridimensionando un widget a pagine resta visibile la riga a cui eri arrivato. Impostazioni: periodo, ordine |
| Prompt: distribuzione (`run-stats`) | Analisi | 6×7 / 4×4 | istogramma dei token per prompt in fasce (<10k, 10–30k, 30–100k, 100–300k, 300k–1M, 1–3M, >3M) con il segno della mediana; mediana, p95 e durata media; tra gli esiti gli interrotti per motivo, quando è noto; tabella gemella. Impostazioni: periodo |
| Andamento (`trend`) | Analisi | 12×7 / 4×5 | token, costo o step nel tempo, **a colonne o a linea**, per modello, agente, provider, tipo o totale. Oltre le prime sei voci di sempre il resto si somma in «altri modelli» («altri agenti», «altri provider»…). Impostazioni: periodo, metrica, raggruppamento, stile |
| Interazione (`interaction`) | Analisi | 5×11 / 4×3 | prompt, permessi (per azione, con l'attesa), commit e subagenti. Impostazioni: periodo |
| Riepilogo (`summary`) | Analisi | 12×3 / 4×3 | token, costo, step, cache, latenza e tool del periodo, con uno degli stili, disegnati come gli Indicatori (didascalia in alto, cifra in grande, una barretta per cifra: i tipi di token, la quota dei task interni nel costo, step riusciti, falliti e retry, la cache, la latenza mediana fino al p95, gli errori dei tool): C22 cifre in riga, C23 token in grande con la composizione e le altre cinque cifre accanto, B13 tessere con anelli (quote di successo colorate con le soglie della striscia di affidabilità; la latenza come baffo p50–p95). Impostazioni: periodo, stile |
| Ultimo anno (`calendar`) | Analisi | 6×4 / 4×4 | calendario giornaliero di 53 settimane; su una larghezza stretta toglie le settimane più vecchie e lo dice. Impostazioni: metrica |
| Tabella per dimensione (`breakdown`) | Analisi | 12×11 / 4×4 | token, costo, cache, latenza, primo token (mediana) e tok/s (mediana sullo stream) per modello, agente, provider, tipo o cartella; «–» dove mancano i tempi di streaming (step di OpenCode prima di metà ottobre 2026) |
| Tool (`tools`) | Analisi | 7×11 / 4×4 | chiamate, errori e durata per tool |
| Sessioni (`sessions`) | Analisi | 12×13 / 6×6 | sessioni del periodo, a pagine (tante quante ne stanno nel widget, al massimo 10 per pagina), con la timeline di step e tool; nel dettaglio il tooltip della durata di uno step dà primo token, tok/s e attesa dei tool dopo lo stream, e i task interni sono raggruppati per tipo e modello (titolo, compaction automatica o manuale col modello, altro), con il numero di chiamate quando sono più di una («titolo ×3 1,2k») |
| Gauge (`gauge`) | Analisi | 3×5 / 2×4 | un valore rispetto a un massimo (vedi sotto) |
| Indicatore (`kpi`) | Adesso, Monitor | 3×4 / 3×3 | un numero di oggi con il confronto, scelto con l'impostazione «Indicatore»: **token**, **cache**, **prompt**, **costo**, **errori dei tool**, **primo token** (la mediana degli step di oggi) o **retry** (i tentativi ripetuti di oggi, e nella didascalia quanti per limite di frequenza: un 429 o «rate limit» nell'errore). Token, costo, prompt e retry crescono nel corso della giornata e si confrontano **alla stessa ora**: i token con la media dei 7 giorni precedenti fino a quest'ora, costo, prompt e retry con la media dei giorni prima ridotta alla parte di una giornata tipica già passata (quella dei token); senza giorni precedenti con dati, nessun confronto. I retry si registrano solo dal vivo: i giorni in cui la lens era spenta ne hanno zero. Cache, primo token ed errori dei tool si confrontano con la media dei giorni prima. In C20 la fascia normale (p25–p75) è dei giorni prima, senza il parziale di oggi, e oggi si giudica sulla stessa fascia a quest'ora; accanto, gli ultimi giorni in piccolo |
| Budget (`budget`) | Adesso, Monitor | 3×4 / 3×4 | il budget del giorno, della settimana o del mese («Periodo del budget») di token, step o costo («Metrica», token se manca): quanto ne resta, la proiezione e quando si azzera. Cifre e titolo seguono la metrica («Budget di step del giorno», «≤ 15 step/h», gli importi in dollari). Senza budget invita a impostarlo in Impostazioni. L'andamento a burn-up (C1) c'è solo per settimana e mese: senza periodo, o con «giorno», è il mese |
| Dove vanno i token (`flow`) | Adesso, Monitor | 6×6 / 4×5 | i token del periodo per modello e per tipo (input, output, cache letta e scritta, ragionamento). Impostazioni: periodo |
| Stato (`status`) | Adesso, Monitor | 3×4 / 3×4 | collegamento con OpenCode, sincronizzazione, deriva dell'API (solo se c'è) e modelli oltre il budget del giorno. «Striscia di disponibilità» mostra per giorno solo «Tool senza errori» e «Prompt riusciti»: il collegamento con OpenCode e il contratto API per giorno non si registrano ancora, e la striscia non finge di averli |
| Velocità (`speed`) | Analisi | 6×5 / 3×4 | il primo token nel tempo (banda tra mediana e p95), per modello o come tachimetro dei token al secondo. Impostazioni: periodo |
| Quando lavori (`rhythm`) | Analisi | 5×4 / 4×4 | token per ora del giorno e giorno della settimana (mappa di calore a quadratini di 12 px al massimo, con i totali per ora sopra e per giorno a destra, la legenda sempre visibile e, dove c'è spazio, ora e giorno di punta, media a settimana e ore attive) nelle ultime 4 settimane, nell'ora locale; l'orologio mostra la media per ora |
| Sessioni nella giornata (`day-sessions`) | Analisi | 6×6 / 4×5 | le sessioni di oggi su una linea del tempo a corsie, con i loro prompt. I segni degli step dentro la barra di un prompt si disegnano solo dove la lens ha l'istante dello step: niente segni inventati |
| Widget dei moduli (`<id>-<nome>`) | Adesso e/o Analisi, secondo il modulo; mai in Monitor | del modulo | i widget che un modulo attivo dichiara nel manifesto; compaiono in «Aggiungi» dopo quelli del nucleo, con l'etichetta «modulo {nome}», e hanno le impostazioni (titolo, periodo…) che il modulo elenca. A modulo spento restano nella disposizione e dicono perché non si disegnano. Vedi [I widget di un modulo](moduli.md#i-widget-di-un-modulo) |

Il **periodo** di un widget in Adesso e in Monitor è «Oggi» (o «Vista (oggi)», se lasciato sul valore di partenza); gli altri widget con periodo funzionano come in Analisi.

### Gauge

| Cosa misura | Valore | Colore |
|---|---|---|
| Budget del giorno, della settimana o del mese · token, costo o step | usato sul budget `LENS_LIMIT_*` corrispondente, con la proiezione a fine periodo (tacca sull'arco) | verde, giallo dall'80%, rosso dal 100% |
| Budget giornaliero di un modello | token di oggi del modello scelto in **Modello** sul suo budget di `LENS_MODEL_LIMITS`, con la proiezione; il titolo automatico è il nome del modello | come i budget |
| Prompt da cache | quota dei prompt letti dalla cache nel periodo | blu |
| Step falliti | step finiti in errore sul totale del periodo | verde sotto il 5%, giallo fino al 15%, rosso oltre |
| Chiamate tool con errore | chiamate in errore sul totale del periodo | come gli step falliti |

Con un budget, sotto il valore c'è anche fra quanto si azzera il periodo («si azzera tra 2 g 9 h»). Senza il budget corrispondente il gauge mostra quanto è stato usato e il link alla pagina Impostazioni, dove lo si imposta. Il gauge di un modello che non è più in `LENS_MODEL_LIMITS` lo dice e rimanda al ⚙ o alle Impostazioni. Per tenere d'occhio più modelli, aggiungi un gauge per ciascuno. I budget di settimana e mese seguono il calendario (da lunedì, dal giorno 1), quindi il periodo del widget non li cambia.

### Andamento a linea

Con lo stile «linea» le curve passano per ogni punto senza mai superarlo, quindi nessun picco sopra il valore reale e nessuna discesa sotto zero. Ogni serie ha un'area che sfuma dal suo colore al trasparente. Le serie sono sovrapposte, non impilate: la scala è il valore più alto di una singola serie. Come nelle colonne, «altri modelli» (o «altri agenti», «altri provider»…) somma le voci oltre le prime sei di sempre e «task interni» sono titoli e compaction; «Mostra tabella» dà i valori. Gli assi hanno tacche tonde senza etichette ripetute e l'unità accanto ai valori.

## Stili

Ogni tipo con più di un modello grafico ha l'impostazione **Stile**: il modello con cui si disegna. I numeri sono gli stessi, cambia il disegno. Il nome è sempre quello del modello («G1 · Area con gradiente»); `classic` (e `columns`/`line` per Andamento, `semi` per Gauge) è la resa di prima degli stili. Un widget senza stile usa il primo dell'elenco.

| Tipo | Stili (il primo è quello senza impostazione) |
|---|---|
| Oggi (`hero`) | classico · G1 area con gradiente · G4 colonne con picco |
| Indicatore (`kpi`) | B11 cifra con barre giornaliere · B12 anello con sparkline · C20 cifra con fascia normale |
| Budget (`budget`) | C19 conto alla rovescia del reset · B1 semicerchio con lancetta · B2 anello a tacche · B5 barre bullet · B10 batterie a segmenti · C14 doppio anello usato e proiezione · C16 termometri dei budget · C1 consumo del mese con proiezione |
| Per modello oggi (`model-day`) | classico · B3 anelli di budget per modello · C15 archi radiali di budget · B6 barre per modello · C3 piccoli multipli · G9 treemap dei modelli |
| Dove vanno i token (`flow`) | G12 flusso dai modelli ai tipi di token · G10 ciambella dei tipi di token · C13 waffle · B7 composizione dei token |
| Stato (`status`) | C18 luci di stato · C17 strisce di affidabilità |
| Attività live (`feed`) | classico · T1 cronologia a fasce · T4 registro a terminale · T3 eventi per sessione · T2 righe compatte con filtri |
| Prompt (`runs`) | classico · T5 tabella dei prompt · T6 schede con barra degli step · T7 righe espandibili · T8 formattazione a calore · T9 classifica con barre · T12 raggruppati per sessione · T10 Pareto · T11 sparkline per step |
| Andamento (`trend`) | colonne · linea · G2 linee con etichette finali · C3 piccoli multipli · G3 aree impilate · G4 colonne con picco · C4 classifica giorno per giorno · C5 ieri contro oggi |
| Velocità (`speed`) | C2 banda p50-p95 del primo token · B9 primo token per modello · B4 tachimetro della velocità |
| Quando lavori (`rhythm`) | G5 mappa di calore ora × giorno · C6 orologio delle ore |
| Ultimo anno (`calendar`) | classico · G6 calendario dell'attività |
| Tabella per dimensione (`breakdown`) | classico · C21 tabella dei modelli · B6 barre per modello · B7 composizione dei token · B8 variazione per modello · G9 treemap dei modelli · G11 radar dei modelli · C9 cascata del costo |
| Prompt: distribuzione (`run-stats`) | classico · G8 istogramma dei token per prompt · C10 box plot della durata · C11 sciame dei prompt · C12 creste giornaliere · G7 dispersione di token e durata · C8 imbuto dei prompt |
| Gauge (`gauge`) | semicerchio · B1 semicerchio con lancetta · B2 anello a tacche · B10 batterie a segmenti |
| Riepilogo (`summary`) | C22 cifre in riga · C23 token con composizione · B13 tessere con anelli |

«Sessioni nella giornata» ha un solo modello (C7 corsie delle sessioni) e quindi nessuna impostazione di stile.

### Dimensioni per stile

Ogni stile ha una **dimensione predefinita** (colonne × righe): è quella con cui «Aggiungi» mette il widget nella vista e con cui la Galleria lo mostra. Il primo stile di un tipo ha la dimensione del tipo (la tabella del [Catalogo](#catalogo)); cambiare stile a un widget già in griglia non lo ridimensiona. Il criterio: gauge e anelli quasi quadrati, linee e colonne larghe e basse, tabelle alte, cifre in una striscia.

| Tipo | Stile → colonne × righe |
|---|---|
| Oggi | classico 8×9 · G1 6×6 · G4 6×6 |
| Indicatore | B11, B12, C20 3×4 |
| Budget | C19 3×4 · B1, B2 3×5 · B5, B10 4×4 · C14, C16 4×5 · C1 6×5 |
| Per modello oggi | classico 6×5 · B3 6×6 · C15 3×6 · B6 6×5 · C3 6×6 · G9 4×5 |
| Dove vanno i token | G12 6×6 · G10, C13 4×5 · B7 6×5 |
| Stato | C18 3×4 · C17 6×4 |
| Attività live | classico, T1, T3, T2 6×6 · T4 8×6 |
| Prompt | tutti 12×8 |
| Andamento | colonne, linea 12×7 (la legenda vuole spazio) · G2, G3, G4, C5 6×5 · C3 6×6 · C4 6×7 |
| Velocità | C2 6×5 · B9 4×5 · B4 3×5 |
| Quando lavori | G5 5×4 · C6 4×5 |
| Ultimo anno | classico, G6 6×4 |
| Sessioni nella giornata | C7 6×6 |
| Tabella per dimensione | classico 12×11 · C21 6×6 · B6, B7, B8, C9 6×5 · G9, G11 4×5 |
| Prompt: distribuzione | classico 6×7 · G8, C10, C12 6×5 · C11 6×4 · G7 6×6 · C8 4×4 |
| Gauge | semicerchio 3×5 · B1, B2 3×5 · B10 4×4 |
| Riepilogo | C22 12×3 · C23 12×4 · B13 6×5 |

Le misure sono pensate su uno schermo da 1710×1112 punti (MacBook a tutto schermo: griglia larga 1430 px, circa 18 righe visibili). Gli anelli e i semicerchi stanno a 3 colonne, le barre e i termometri a 4, le linee e le colonne a 6 o 12 e 5 righe.

**Dove si cambia.** In modalità modifica ogni carta ha nella testata il menu **Stile** (nome e id del modello). Cambiarlo ridisegna subito la carta con i dati già letti; «Salva» lo conserva, «Annulla» lo riporta indietro. Le impostazioni di quello stile (colonne, righe, filtri) stanno nel ⚙. Fuori dalla modifica la testata mostra l'id dello stile solo se è attivo l'interruttore **Mostra gli id dei modelli** della Galleria.

**Come si disegnano.** Ogni modello si disegna alla misura reale della carta: testi e tratti restano della stessa grandezza in Adesso, in Analisi e in Galleria, e lo spazio in più va ai dati (più colonne, etichette, righe). Sotto una certa larghezza alcuni modelli passano a una forma ridotta (senza legenda o senza etichette finali), altri scalano soltanto. Ogni grafico ha un tooltip e un `aria-label` con i numeri principali. Dove manca il dato lo stile mostra lo stato vuoto con il motivo, mai un numero stimato.

**Confronti.** In «C21 tabella dei modelli» e «B8 variazione per modello» il confronto è con **il periodo prima**, di pari lunghezza: in un periodo di 7 giorni è la settimana precedente, in uno di 30 giorni i 30 giorni prima. Per questo l'etichetta dice «rispetto al periodo prima» e non «7 giorni prima».

**Campioni.** C7, C10, C11, C12 e G7 disegnano i singoli prompt, e il server ne manda al massimo 1000, i più recenti. Quando il periodo ne ha di più il grafico lo scrive in alto a destra e nell'`aria-label` («ultimi 1000 di 4321 prompt»): la distribuzione è quella degli ultimi 1000, non di tutto il periodo. Per tutto il periodo ci sono G8 e C8, che leggono il riepilogo. C7 parte comunque dall'inizio del giorno dei budget, quindi le ore dei prompt non arrivati restano vuote ma visibili. C11 disegna al massimo 150 punti e C12 tanti giorni quanti ne entrano nella carta: quello che resta fuori lo dicono «+N non mostrati» e «ultimi N giorni».

### Disposizioni predefinite

Una installazione nuova parte da queste (le altezze sono in righe da 40 px). Le disposizioni già salvate non cambiano: i loro widget senza `style` usano il primo stile del tipo, quello di prima.

Ogni riga è piena (12 colonne) e le carte di una riga hanno la stessa altezza.

- **Adesso**: in alto quattro tessere da 3 colonne (indicatore token B11, indicatore cache B12, budget del giorno C19, Stato C18); poi Oggi (G1) e Per modello oggi (B3); poi Prompt in corso, Attività live (T1) e Dove vanno i token (G12); in fondo i prompt di oggi (T5).
- **Analisi**: Riepilogo (C22, cifre in riga); Andamento (G2) e «Ora per ora per modello» (Andamento con C3); Quando lavori (G5) e «Quota per modello» (B6); Sessioni nella giornata (C7) e la tabella per modello (C21); in fondo «I più pesanti» (Prompt con T9, ordinati per token, una riga per prompt con le colonne allineate: entrano tutti e dieci).
- **Monitor**: esattamente 18 righe, uno schermo senza scorrere. Indicatore token (B11, 6 colonne), budget del giorno (C19) e Stato (C18); Per modello oggi (C15, stretto e alto) e Oggi (G1, 9 colonne); l'Attività live come registro a terminale (T4, 8 colonne) e Dove vanno i token (G12). Se la tua disposizione salvata non ha ancora la vista Monitor, riceve questa.

Configurazione predefinita delle tabelle: Attività live con tutti i tipi di evento, ora relativa e sessione mostrata; Prompt recenti con le colonne ora, sessione, modello, esito, durata, primo token, composizione, token e cache, righe comode, tutti i prompt; «I più pesanti» con le colonne progetto, modello, esito, durata, token e quota del periodo.

## Le pagine

### Prompt e Sessioni

Il widget dei prompt e quello delle sessioni a tutta pagina, con i filtri di Analisi (periodo, raggruppamento, metrica) nella barra del titolo. Non si personalizzano. Un clic su una riga di Prompt apre sotto il dettaglio della sessione con quel prompt evidenziato, come nel widget.

### Galleria

`#galleria`, con **una scheda per vista**: Adesso, Analisi e Monitor (`#galleria/adesso`, `#galleria/analisi`, `#galleria/monitor`), ciascuna con il numero dei suoi stili; la lens ricorda l'ultima aperta. Una scheda mostra solo i tipi che la sua vista ospita: Adesso quelli della giornata, Analisi quelli del periodo, Monitor i tipi di Adesso pensati per una schermata di cifre grandi (senza tabelle); un widget come il Budget sta quindi sia in Adesso sia in Monitor. In ogni scheda c'è una carta per ogni stile di ogni tipo (tutti i modelli di [Stili](#stili)), **alla dimensione predefinita dello stile** sulla stessa griglia a 12 colonne delle viste (sotto i 1280 px di finestra, carte da almeno 340 px), disegnata **con i dati veri**: il giorno dei budget in Adesso e in Monitor, i filtri correnti in Analisi; in cima la pagina dice quali.

Sotto il titolo, sempre in vista mentre scorri, ci sono le schede, la **ricerca** per id, nome o tipo («G3», «anello»), l'interruttore **Solo non in uso** e l'**indice dei tipi**: un clic porta al gruppo. Ogni carta mostra l'id, il nome, la dimensione in colonne × righe, **dove è già in uso** («In uso: Adesso, Monitor»), secondo la disposizione che stai guardando, modifiche non salvate comprese, e lo stato solo quando c'è qualcosa da dire (in caricamento, il motivo per cui è vuota, dati non disponibili).

**Aggiungi alla vista.** Ogni carta ha il pulsante «Aggiungi a {vista}» (nella scheda Monitor: «Aggiungi a Monitor»): mette nella vista della scheda quel widget con lo stile e le impostazioni che vedi e la sua dimensione predefinita, nell'angolo scelto in «Dove» del catalogo (con «Scegli sulla griglia», in fondo a sinistra: da qui la griglia non si vede). È la stessa sessione di modifica di «Personalizza»: compare la riga **«Modifica in corso · n aggiunti da qui»** con **Salva** e **Annulla**, niente si scrive su disco prima di «Salva» e le carte aggiornano subito «In uso». Se la vista è piena (60 widget, o nessuna riga libera in fondo) la barra lo dice e non cambia nulla. I pulsanti ci sono solo con una finestra larga almeno 700 px e le impostazioni modificabili, come «Personalizza»; altrimenti la pagina lo dice in cima.

**Confronta.** Ogni carta ha la casella «Confronta»: si scelgono da 2 a 4 stili dello stesso tipo (una carta di un altro tipo fa ripartire la scelta) e la riga **«Confronto: n stili di {tipo}»** offre «Confronta» e «Svuota». Il confronto mostra solo quegli stili, nell'ordine scelto, **tutti alla stessa misura** (la più larga e la più alta fra le loro dimensioni predefinite) e con i dati veri; ricerca, filtro e indice sono spenti e «Esci dal confronto» riporta alla scheda. Da una carta del confronto si può aggiungere subito il vincitore, sempre alla dimensione predefinita del suo stile. Cambiando scheda la scelta si azzera.

Per cambiare o togliere un widget già in vista si usa ancora «Personalizza» (menu **Stile**). L'interruttore **Mostra gli id dei modelli** aggiunge l'id dello stile accanto al titolo di ogni carta anche fuori dalla modifica; è una preferenza di questo browser (`localStorage`, chiave `lens:show-style-ids`), parte spenta e non entra nelle impostazioni del servizio. Serve durante una review, per dire «cambia il G2 in G3».

### Skill

`#skill`: la libreria delle tue skill, nel formato delle Agent Skills (una cartella con un `SKILL.md`, cioè un frontmatter con `name` e `description` seguito dalle istruzioni, e se serve `references/`, `scripts/`, `assets/`), e i preset che le raggruppano per darle ai modelli di OpenCode tramite l'MCP (vedi [configurazione.md](configurazione.md#prompt)). È una bacheca: in alto una hero con lo stato della libreria e il suo uso, sotto la colonna «Libreria» e una colonna per ogni preset. È la pagina del modulo **Skill** (vedi [moduli.md](moduli.md#skill)), spento di partenza: si attiva da Impostazioni › Moduli. Finché è spento non ci sono né la voce di menu né la pagina né le route `/api/skill*` (rispondono 404); i conteggi dell'uso continuano a essere raccolti e riattivando il modulo la pagina li mostra.

- **Importa…** (il pulsante in alto apre un pannello con «Scegli i file…», «Scegli una cartella…» e i tre modi; i file si possono anche trascinare su tutta la pagina, e compare un velo «Rilascia per importare», che una skill trascinata dalla bacheca non attiva): scegli o trascina uno `.zip`, un `.skill` (è uno zip) o un `SKILL.md`, fino a 16 MiB; oppure **una cartella** («Scegli una cartella…», o trascinala) o **più file e più cartelle insieme**. Il browser raggruppa i file: ogni cartella che contiene direttamente un `SKILL.md` è una skill (con tutti i file sotto di lei, tranne quelli di una cartella-skill annidata), la impacchetta in uno zip e la carica con una richiesta per skill, una dopo l'altra, sulla stessa rotta di sempre; zip, `.skill` e `SKILL.md` scelti o trascinati insieme vengono caricati come sono. `.DS_Store`, `__MACOSX`, `.git` e i file `._*` sono ignorati, e così i file fuori da una cartella con `SKILL.md`; una cartella oltre i 16 MiB è rifiutata prima di caricarla, con il motivo. Con più skill il messaggio riassume («2 importate, 1 già aggiornata, 1 rifiutata») e sotto compare l'elenco: una riga per skill con l'esito, che può essere importata (`vN`), «già aggiornata, nessuna nuova versione» o rifiutata con il motivo. Lo zip deve avere `SKILL.md` alla radice o nella sua unica cartella. Viene controllato (nomi sicuri, niente symlink, una cartella `.git` dentro lo zip è ignorata come `__MACOSX`, al massimo 2000 file e 64 MiB scompattati, `SKILL.md` fino a 1 MiB e UTF-8 valido) e copiato nella libreria, mai eseguito. L'id della skill è il `name` del frontmatter quando rispetta la regola delle Agent Skills (minuscole, cifre e trattini, fino a 64 caratteri). Se il `name` è un'etichetta come «Code Reviewer», l'id viene dalla cartella radice dello zip o dal nome del file, altrimenti dal `name` ridotto a slug (`code-reviewer`), come fa OpenCode; il `name` resta come etichetta. Senza `name` si ricava dalla cartella o dal file (un file che si chiama solo `SKILL.md` non basta: serve il `name`). Senza `description` la skill è rifiutata: senza, il modello non sa quando usarla; oltre 1024 caratteri è rifiutata anche quella (il limite delle Agent Skills). Sotto la zona di caricamento, «Se la skill c'è già» ha tre scelte, ognuna con la sua riga di spiegazione: **Nuova versione** (la scelta di partenza: la versione di prima resta), **Sovrascrivi la corrente** (sostituisce la cartella della versione in uso, senza crearne una e senza storico: chiede una conferma) e **Salta se esiste già** (se l'id c'è già non importa niente, e lo dice senza trattarlo da errore). Caricare di nuovo gli stessi file non crea una versione in più: il contenuto è confrontato con la versione in uso (un hash dei file, dei loro byte e dei permessi) e, se è identico, la skill risulta «già aggiornata» (anche con «Sovrascrivi la corrente»). Anche gli stessi percorsi e byte con soli permessi diversi sono «già aggiornata»: un browser non legge i permessi di una cartella e li indovina, quindi la stessa skill caricata dal Finder e da una cartella non crea una versione, e quella in uso tiene i suoi. Dopo ogni caricamento la scelta torna a «Nuova versione». Un `SKILL.md` caricato da solo, su una skill che esiste, porta con sé gli altri file della versione in uso: si aggiorna il testo senza ricaricare lo zip. Al massimo 100 skill e 20 versioni per skill: per aggiungerne altre bisogna toglierne. Ogni versione porta nell'indice l'hash del contenuto e la lunghezza in caratteri del testo di `SKILL.md` (senza frontmatter), che serve al peso dei preset. All'avvio la lens adotta le cartelle di versione valide che l'indice non conosce (leggendo il loro `SKILL.md`), così un indice danneggiato non nasconde le skill; non segue mai i link simbolici, e un indice che non riesce a leggere non lo riscrive, ne tiene una copia. Se `skills.json` esiste ma non si legge (non è JSON, o non è un indice di skill) e non c'è modo di ricostruirlo dalle cartelle, la pagina non mostra una libreria vuota con le istruzioni per importare: mostra il motivo («L'indice delle skill (skills.json) non è leggibile…»), `GET /api/skills` porta `reason` e `unusable: true` con `canSave: false`, e import e azioni sulle skill rispondono 409 con quello stesso motivo finché non ripari o sposti il file.
- **In alto e hero**: titolo, riga di contesto («Ultimi 30 giorni · 23 set – 23 ott · conteggi dal 12 ott», l'ultima parte solo se la raccolta è iniziata dentro il periodo), selettore del periodo **7 g · 30 g · 90 g · Tutto** (30 g di partenza, ricordato dal browser; nascosto finché non c'è nessun caricamento), **+ Nuovo preset** e **Importa…**. Il periodo vale solo per i numeri d'uso: lo stato della libreria (quante skill, pesi, senza preset, assenti) è sempre quello di adesso. La hero ha sei riquadri: **Libreria** (n / 100, nuove e aggiornate nel periodo, import per settimana), **Caricamenti** (con ▲▼ rispetto al periodo prima, «da preset» e «dirette», barre per giorno), **Skill in uso** (usate e mai usate), **Senza preset** (le skill che OpenCode non vede: le skill della libreria arrivano a OpenCode solo dentro un preset), **Preset** (n / 30, il più usato, quelli mai chiesti, le skill assenti) e **Limite testo** (il preset più pieno sui 40 000 caratteri). Con zero skill la hero non c'è e la bacheca diventa la zona di import.
- **Bacheca**: la colonna tratteggiata **Libreria** ha un filtro (Senza preset, Tutte, Mai usate, Aggiornate di recente), l'ordine (Più usate, Ultima importazione, Nome, Più pesanti), la ricerca e il contatore «n di 100 skill»; ogni card dice nome e preset, descrizione, caricamenti nel periodo, ultimo uso («mai», o «—» se la raccolta non copre il periodo) e peso, con i badge «nuova» e «aggiornata» (finestra fissa di 30 giorni). Una colonna per preset, nell'ordine dei preset: nome, stato (assente, oltre il limite, quasi pieno, mai chiesto), `/lens:<id>` da copiare, **Modifica**, i caricamenti (dal comando e dal modello), il misuratore del peso e le mini-card delle skill, con «tagliata» o «assente» scritto. **Trascinamento**: libreria → preset aggiunge, preset → preset sposta (con ⌥ copia), preset → libreria toglie, dentro la colonna riordina (l'ordine decide quali skill arrivano tagliate). Ogni mossa si salva subito, con un avviso e **Annulla** per 6 secondi. Da tastiera e da telefono c'è il menu «Aggiungi a… / Sposta in… / Togli da…» di ogni card, con i pulsanti su/giù per l'ordine. Il salvataggio manda `rev`: se un'altra scheda ha cambiato i preset nel frattempo la lens risponde `409`, la pagina rilegge e rifà la mossa sul documento attuale solo se ha ancora senso. Sotto i 900 px le colonne si impilano.
- **Dettaglio di una skill** (pannello laterale; Esc lo chiude e il focus torna alla card): stato e descrizione intera; **Uso** (caricamenti nel periodo, barre per giorno, canali, preset, ultimo uso, prime 3 cartelle di progetto, errori); **Nei preset**, con le caselle e la quota sul limite; **Versioni** (caricamenti per versione, Dettaglio, **Usa questa versione**, **Elimina versione**); il testo (caratteri, file, `SKILL.md`, **Copia percorso**, versione dichiarata); **Elimina** per ultimo, con una conferma che nomina i preset che la usano e l'ultimo uso. La pagina conta e mostra solo le skill della libreria: i caricamenti delle skill native stanno in `/metrics` ma non qui.
- **Preset**: ogni colonna ha nome, comando `/lens:<id>`, brief e le sue skill, e i pulsanti **Copia /lens:<id>** e **Modifica** (apre il dialogo già su quel preset); una riga spiega che in OpenCode il comando si aggiorna entro circa 30 secondi e l'elenco nelle istruzioni del modello al prossimo riavvio di OpenCode. Una skill che non è più in libreria è segnata «<id> · assente», in rosso; un preset senza skill lo dice. Il dialogo, aperto da **Modifica** o da **+ Nuovo preset**, serve a creare un preset (nome, id proposto dal nome ma modificabile, brief, skill da spuntare), modificarlo (con «Togli dal preset» per le skill assenti; l'id non si cambia), duplicarlo (id «…-copia») ed eliminarlo; ogni riga dice quante skill ha e quante ne mancano, e un errore di compilazione compare sotto il campo. Salvare un preset senza skill è permesso, ma avvisa che in OpenCode non porterà istruzioni. Senza preset la bacheca propone di creare il primo. Il conteggio dell'uso è legato all'id del preset (vedi [Uso delle skill](metriche.md#uso-delle-skill)). Al massimo 30 preset; nome da 1 a 40 caratteri e diverso dagli altri; id di minuscole, cifre e trattini, fino a 40 caratteri (è quello che l'MCP offre come `/lens:<id>`); brief fino a 500 caratteri; fino a 30 skill per preset.
  **Ordine e peso.** L'ordine delle skill di un preset è quello che scegli: spuntando una skill finisce in fondo, e in «Ordine» ogni skill ha i pulsanti **Su** e **Giù** (il nome accessibile dice quale skill sposta); si salva così com'è, e i preset già salvati restano nel loro ordine. Il modello riceve le skill in quest'ordine, fino al tetto di 40 000 caratteri per risposta. Il **peso** del preset, nel dialogo e su ogni card, è il testo di `SKILL.md` di ogni skill più ciò che l'MCP gli mette attorno (descrizione, cartella base, fino a dieci percorsi di file, le etichette, e l'intestazione del preset): «12.000 di 40.000 caratteri · stima», con una barra. È una stima, perché i percorsi dei file sono ricavati dal loro numero. Come l'MCP, la pagina scorre le skill nell'ordine: una skill che non ci sta nel tetto arriva senza testo, ma una più piccola dopo di lei può starci ancora. Quelle che con questo calcolo arriverebbero probabilmente **senza testo** (solo cartella e file, da leggere con `read`) sono segnate «· senza testo» con la spiegazione: si cambia l'ordine o se ne toglie qualcuna. Una skill assente pesa una riga corta e non è mai tagliata; una versione importata prima che l'indice conoscesse la misura è segnata «peso non noto». Eliminare un preset avvisa che il comando `/lens:<id>` non sarà più offerto.

Da un altro computer (non localhost) o dietro un proxy la pagina è in sola lettura: si vedono libreria, dettagli, versioni e preset, ma trascinamento, menu delle card, caricamento, ritorno a una versione ed eliminazioni sono spenti e una riga in cima alla pagina dice perché. Lo stesso senza una cartella dati (`LENS_DB=:memory:`).

### Novità

`#novita`, dai dati di `/api/changelog` e `/api/about`:

- In cima una fascia **«dall'ultima visita»**: le versioni e le voci nuove per tipo (Aggiunto, Corretto, Modificato, Prestazioni, Documentazione), contate rispetto all'ultima versione che hai segnato come letta. **Segna come lette** salva la versione installata nel browser (`lens:seenVersion`) e spegne il punto accanto a «Novità» nella barra: **aprire la pagina non basta**, il punto resta finché non premi il pulsante.
- La **timeline delle versioni**: per ognuna numero, tipo (patch, minor o major, rispetto alla precedente), data, «installata» e «nuova per te», e i conteggi per sezione. Le prime due sono aperte, le altre si aprono con un clic. Ogni voce ha il link al commit (l'hash breve).
- Sopra, i **filtri per tipo** e una **ricerca** che evidenzia il testo trovato.
- Le voci sono nella lingua scelta in Impostazioni (`CHANGELOG.en.md` e `CHANGELOG.fr.md`, tradotti a mano a ogni rilascio). Una versione non ancora tradotta mostra le voci in italiano, con l'etichetta «non ancora tradotto».
- A lato: la versione installata (lens, OpenCode, Node, avvio, aggiornamento automatico), il **ritmo dei rilasci** (colonne impilate per tipo delle ultime 12 versioni) e i collegamenti a CHANGELOG, release e SemVer.

### Vibe Coding

È il modulo Vibe Coding: c'è solo se è attivo (Impostazioni › Moduli, vedi [moduli.md](moduli.md)); spento non ha voce nel menu, `#vibecoding` non esiste e `/api/vibe-coding`, `/api/vibe-coding/history` e `/api/vibe-projects` rispondono 404. Dopo un aggiornamento che lo trova spento ma con progetti già salvati, in ogni pagina compare l'avviso per riattivarlo.

`#vibecoding`: quanto tempo e quanti token hai speso, e dove, con i tuoi **progetti** (gruppi di cartelle di lavoro) e la proiezione di fine mese. Legge `/api/vibe-coding`, `/api/vibe-coding/history` e `/api/vibe-projects`. Ha un periodo suo (7 giorni, 30 giorni, **Mese** o Tutto, ricordato dal browser), indipendente dai filtri di Analisi; non è un widget e non si sposta. «Mese» è il mese di calendario in corso, da mezzanotte del primo, come il budget mensile di Adesso. Vibe Coding è solo di OpenCode: la sorgente Bob scelta nella barra del titolo non lo tocca, nemmeno l'inizio di «Tutto».

- **Costo stimato e speso**: ogni costo ha due cifre. Lo **stimato** è la cifra principale: token × il **Listino prezzi** (Impostazioni, vedi [configurazione.md](configurazione.md#listino-prezzi)), uguale per tutti i progetti qualunque sia il modo di pagare (abbonamenti e modelli locali compresi), quindi misura l'effort. Lo **speso** è il costo scritto da OpenCode, più piccolo accanto. Entrambi contano solo gli step, senza i task interni. Con il listino vuoto la pagina resta sullo speso, lo etichetta «speso» e un avviso porta alle Impostazioni. Con il listino parziale i token dei modelli senza prezzo non diventano 0 $: ogni cifra che li contiene dice «**stima incompleta** · N token senza prezzo».
- **Tipi di progetto**: nel dettaglio si sceglie il tipo. **Continuativo** (il default, e quello di ogni progetto già salvato): budget **mensile**, per attività che non finiscono (per esempio AppSec o il lavoro di ogni giorno). **A scadenza**: un **inizio** (vuoto = il giorno del primo step nelle sue cartelle), una **consegna** e un budget **totale**, per lavori con una fine. Cambiando il tipo il budget si azzera e la pagina lo dice, perché lo stesso numero cambierebbe significato.
- **Panoramica**: sopra la board, la tabella di tutti i progetti: tipo (consegna il … / continuativo / chiuso il …), ore, stimato, speso, previsione (alla consegna o a fine mese), budget e stato. I totali del mese sommano **tutti** i progetti; il budget del mese solo i **continuativi**. Per i progetti a scadenza le cifre contano dall'inizio, per i continuativi dal mese in corso, e la tabella lo dice.
- **Striscia di riepilogo**: sei tessere su una fascia scura: costo (nascosto con «Mostra i costi» spento), token (la composizione per tipo è nel grafico), **tempo di lavoro**, sessioni, **ritmo** (al giorno: la media degli ultimi 7 giorni completi; il grafico ne mostra 14) e **fine mese**. Ogni tessera ha una riga di contesto e un piccolo grafico; costo, token e tempo di lavoro hanno anche la variazione rispetto al periodo precedente. La tessera «Fine mese» ha un anello: se hai impostato `LENS_LIMIT_COST_MONTHLY` usa i numeri del budget mensile di Adesso; altrimenti confronta i progetti che hanno un budget con la somma dei loro budget; se non c'è nessun budget l'anello non c'è e restano la proiezione e l'incertezza. Senza costi il ritmo e la fine mese sono in token e l'anello non c'è. La tessera dei costi mostra lo stimato con lo speso nella nota; ritmo e fine mese seguono lo stimato. Fa eccezione la «Fine mese» quando c'è `LENS_LIMIT_COST_MONTHLY`: quel budget è sul costo di OpenCode, quindi cifra e anello restano sullo **speso** e la tessera lo dice.
- **Progetti** (la board): una colonna per progetto e una **Senza progetto** con le cartelle non assegnate. Ogni colonna mostra costo, token e tempo del periodo, la proiezione di fine mese e, se c'è un budget, la barra speso → previsione → budget con lo stato. Le cartelle sono schede (nome, percorso intero, andamento dei token, token, tempo, costo e sessioni): **trascinale** da una colonna all'altra, oppure usa **Sposta in…** su ogni scheda, che si usa anche da tastiera (frecce, Home, Fine, Invio, Esc). Una cartella appartiene a un progetto per **percorso esatto**: una sottocartella non segue la cartella sopra di lei. **+ Nuovo progetto** ne crea uno (con un colore libero); il nome si cambia sul posto (Invio o fuori dal campo salva, Esc annulla). Al massimo 50 progetti, 500 cartelle in tutto e nomi di 60 caratteri. Cliccando i numeri di un progetto si apre il suo dettaglio. Per un progetto a scadenza la proiezione è quella alla consegna e lo stato la confronta con il budget totale; i numeri della colonna restano quelli del periodo, mentre la barra segue la vita del progetto e sotto ha la sua cifra «dall'inizio: …».
- **Dettaglio del progetto**: nome, tipo, date e budget modificabili (campo vuoto = nessun budget), «Elimina progetto» con conferma (le cartelle tornano in «Senza progetto»; i dati di OpenCode non si toccano). Cifre e grafici seguono la **vita del progetto**, non il periodo scelto; la board e le quote per cartella e per modello seguono il periodo e lo scrivono nell'etichetta. Le **cartelle** del progetto hanno la loro quota (puoi lasciarvi cadere una cartella dalla board) e i **modelli** hanno stimato e speso, con «senza prezzo» per quelli fuori listino.
- **Progetto continuativo**: questo mese (lo stimato, con lo speso accanto, e le ore), la **fine mese** con la fascia e il budget mensile, la media mensile degli **ultimi 12 mesi** e la media a settimana, la **tendenza** (gli ultimi 3 mesi completi contro i 3 prima; con meno di 6 mesi di dati la cifra è «–» con «meno di 6 mesi di dati»; con token senza prezzo in quei sei mesi porta «stima incompleta») e il costo per ora. Il grafico degli ultimi 12 mesi ha lo stimato a colonne con lo speso dentro, il mese in corso con il previsto tratteggiato, le ore e la linea del budget mensile.
- **Progetto a scadenza**: stimato (con lo speso), ore di lavoro, **alla consegna** (stimato previsto con la fascia, ore previste), due barre **budget e tempo** (quanto budget è consumato e quanti giorni sono passati da inizio a consegna), costo per ora e, con un budget, il **margine alla consegna** («Budget finito il …» quando la previsione lo supera). Il grafico del **costo stimato cumulato** va da inizio a consegna: il fatto pieno, il previsto tratteggiato con la fascia, la linea del budget, oggi e la consegna, e lo speso come linea grigia. Le **ore per settimana** hanno le settimane future tratteggiate. La tabella **consuntivo e previsione** ha stimato, speso, ore e token a oggi, alla consegna, nel budget e come scostamento. Prima dell'inizio il progetto dice «inizia il …» e mostra zero. Se un inizio dopo la consegna non si può salvare, le date tornano com'erano e una riga accanto dice perché.
- **Dopo la consegna**: il progetto si **chiude il giorno dopo la consegna** e mostra le cifre finali da inizio a consegna e lo scostamento dal budget. Il lavoro nelle sue cartelle dopo la consegna non entra nel consuntivo: compare in una nota («dopo la consegna»). Se la consegna slitta, sposta la data. Se la retention ha già tagliato i primi dati, i totali sono parziali e la pagina scrive «dati dal …».
- **Proiezione**: è una stima, non una promessa. Si guardano i **14 giorni completi prima di oggi** e si calcolano una media per i giorni feriali e una per il fine settimana. Ai giorni che restano, **oggi compreso**, si applica la media del tipo di giorno; oggi vale il più alto fra quello che hai già fatto e la media. L'**incertezza** è la deviazione standard dei 14 giorni moltiplicata per la radice dei giorni rimasti (oggi compreso): è la fascia «± …». Con meno di **3 giorni di attività** nella finestra la proiezione non c'è e la pagina scrive «dati insufficienti», senza inventare un numero. Per un progetto a scadenza la finestra è da inizio a consegna: prima dell'inizio e dopo la consegna non c'è previsione.
- **Budget e stati**: lo stato confronta la proiezione con il budget del progetto: «budget superato» se la proiezione lo supera, «vicino al limite» sopra l'85 %, «entro il budget» altrimenti. Un progetto senza budget non ha stato. Sui progetti il budget è solo un riferimento: la lens non blocca niente. Per un progetto a scadenza il confronto è fra la previsione alla consegna e il budget totale. I budget sono sullo stimato (sullo speso con il listino vuoto); un progetto con token senza prezzo porta la nota «stima incompleta».
- **Tabelle in fondo**: per modello, per giorno (giorno di budget, come `LENS_RESET_HOUR`) e le sessioni più pesanti del periodo. Mostrano 5 righe, con «Mostra tutti» («Mostra tutte») per vederle per intero e «Mostra meno» per richiuderle.
- **Costi nascosti**: con «Mostra i costi» spento non compare nessun importo (tessera dei costi, budget, stati e barre in dollari, o nella valuta dei costi): restano token, tempo e ritmo, e le proiezioni sono in token e tempo. Sparisce anche lo stimato, con il conteggio dei token senza prezzo.
- **Tempo di lavoro** è una stima, non un cronometro: per ogni sessione con i suoi subagenti (a qualsiasi profondità) si prende il tempo coperto dagli step (dall'inizio alla fine, al massimo 30 minuti l'uno) e dai prompt, e si colmano i vuoti sotto i 30 minuti; una pausa di 30 minuti o più non conta. Un subagente in parallelo non aggiunge tempo, e le sessioni lasciate aperte non gonfiano il totale. Il tempo di ogni cartella e di ogni sessione è la sua parte della stessa linea del tempo, quindi la somma torna al totale. Con un periodo limitato si conta solo la parte dentro il periodo.
- **Dove sono salvati i progetti**: in `vibe-projects.json`, nella cartella del database. Sono configurazione tua (nomi, colori, tipo, date, budget e percorsi delle cartelle), mai prompt o risposte. Se il file non si legge, la pagina parte senza progetti e la lens ne tiene una copia in `vibe-projects.bad.json` (una volta sola), così il prossimo salvataggio non ne distrugge il contenuto. Con `LENS_DB=:memory:` non c'è dove salvarli.
- **Sola lettura da rete**: dal tuo computer (localhost) puoi creare, rinominare, spostare ed eliminare; da un altro computer o dietro un proxy la pagina mostra tutto ma non modifica niente e una riga in cima lo dice. L'unica scrittura è `POST /api/vibe-projects`, solo da loopback.
- Si rilegge ogni minuto mentre la pagina è aperta. Lo storico dei progetti (`/api/vibe-coding/history`: i giorni di calendario di ogni progetto, fino a 24 mesi) si legge all'apertura, al cambio di giorno, dopo una modifica dei progetti e dopo un cambio del **listino** (anche solo di un prezzo: salvarlo riavvia la lens), non a ogni minuto; i giorni prima di oggi vengono da lì, **oggi** dai dati del mese, riletti ogni minuto come il resto. Se la lettura non riesce, una riga sopra la board dice che le cifre dei progetti a scadenza possono essere parziali e il minuto dopo si riprova.

### Sistema

È il modulo Sistema: c'è solo se è attivo (Impostazioni › Moduli, vedi [moduli.md](moduli.md)); spento non ha voce nel menu e `#sistema` non esiste.

`#sistema`, sola lettura: il computer su cui gira la lens e i servizi attorno, letto dal vivo mentre la pagina è aperta e mai salvato nel database, in `/metrics` o nell'export OTLP. CPU e memoria si rileggono ogni 2 secondi da `/api/system/live`, tutto il resto ogni 5 secondi da `/api/system`. Sotto il titolo nome del computer, sistema operativo, processore e da quanto è acceso; a destra l'ora dell'ultimo aggiornamento e la ricerca.

- **Cosa guardare**: una frase in cima con quello che non va, il problema peggiore per primo e in grassetto («Disco al 95%, 21,1 GB liberi: è il volume del database, quando si riempie la lens smette di registrare»), poi gli altri (batteria senza alimentazione, memoria sotto pressione con lo swap, CPU, sincronizzazione, OpenCode). Quando è tutto a posto dice «Tutto nella norma».
- **Dalla sorgente al database**: la catena che la lens tiene in piedi, OpenCode → Lens → Database. Per ciascuno lo stato con il pallino (collegato, al lavoro, disco quasi pieno) e tre righe: versione, indirizzo e PID di OpenCode; ultima sincronizzazione, ritardo dell'event loop, PID e Node della lens; dimensione di database e WAL, record registrati e spazio libero sul volume.
- **CPU** e **Memoria**, dal vivo: l'area della Galleria «Area con gradiente» sugli ultimi 4 minuti, un campione ogni 2 secondi, con il punto sull'ultimo valore e la media della finestra tratteggiata. In alto il valore di adesso; sotto, per la CPU la media dei 4 minuti e il core più carico, per la memoria la quota in uso e la pressione. La memoria in uso è quella di Monitoraggio Attività (memoria delle app + wired + compressa).
- **Disco e batteria**: cambiano lentamente, quindi una riga a segmenti ciascuno (le «Batterie a segmenti» della Galleria) per disco, swap e batteria: verde, giallo dal 70 % e tutti i segmenti rossi quando la risorsa è in difficoltà (disco dal 90 %, batteria sotto il 10 % senza alimentazione). Il disco è il volume del database. In fondo la velocità della rete in entrata e in uscita delle interfacce fisiche (`en*`, macOS). Senza batteria la sua riga non c'è.
- **Ripartizione della memoria**, **Lens** e **OpenCode**: la memoria divisa in wired, compressa, attiva (tre tonalità di blu: quella occupata), in cache e libera (grigi: quella che macOS può ridare), con lo swap (macOS); la lens (CPU, memoria, heap, intervallo di sincronizzazione, LaunchAgent `local.opencode-lens`, anche quando appartiene a un'altra istanza, ultimo errore) e il servizio di OpenCode che osserva (stato, versione, indirizzo, PID, da quanto gira, CPU e memoria). Un dato che OpenCode non dà è un trattino.
- **Processi**, **In ascolto** e **Agenti di avvio**: una carta con una scheda ciascuno e il loro numero, 8 righe e «Mostra tutti».
  - *Processi*: i 15 più pesanti, ordinabili per CPU o per memoria. La CPU è in percentuale di un core, come in Monitoraggio Attività (un processo può superare il 100 %). Si vede solo il nome dell'eseguibile, con il percorso al passaggio del mouse: **mai gli argomenti**, che possono contenere token e password.
  - *In ascolto*: le porte TCP in ascolto e i socket UDP aperti dai processi del tuo utente (`lsof`), con il protocollo, l'indirizzo, il processo, il PID e se si raggiungono solo da questo computer o **dalla rete**; «Solo raggiungibili dalla rete» lascia solo queste.
  - *Agenti di avvio*: i LaunchAgent del tuo utente, senza quelli di Apple e le app aperte, prima quelli usciti con un errore, poi gli attivi, poi i fermi.
  - La lens e OpenCode sono evidenziati.
- **Cerca** (nella barra in alto): trova un processo per **PID**, per **porta TCP o UDP** o per nome. Un numero vale come PID o come porta; `:4777` solo come porta; `tcp 80` e `udp 5353` solo per quel protocollo; `udp` da solo mostra tutti i socket UDP; il testo cerca nel nome del processo. Più termini si separano con la virgola (`node, 4777`). Con una ricerca le tre schede mostrano tutte e solo le corrispondenze (i processi anche se non sono fra i 15 più pesanti, con chi possiede una porta trovata).

La lens tiene in memoria gli ultimi 4 minuti di CPU e memoria, un campione ogni 2 secondi, e non lancia comandi per farlo: la CPU viene da `os.cpus()`. Su macOS legge la memoria con `vm_stat` solo mentre qualcuno guarda la pagina (fino a 15 secondi dopo l'ultima lettura di `/api/system/live`); prima della prima lettura il campione resta senza memoria invece di usare `os.freemem()`, che non conta la cache.

Processi, porte e agenti descrivono tutto quello che gira sul computer: si vedono solo aprendo la dashboard da questo computer. Da rete o dietro un proxy, anche con il token, la pagina mostra solo il riepilogo (cosa guardare, catena, CPU, memoria, disco e batteria, ripartizione della memoria, lens e OpenCode) e lo dice. Fuori da macOS restano CPU, memoria, disco, lens, OpenCode, processi e porte (se c'è `lsof`); ripartizione della memoria, swap, batteria e rete sono solo macOS.

### Security

`#security`, sola lettura e solo con il modulo Security attivo (vedi [sicurezza.md](sicurezza.md#il-modulo-security)), dai dati di `/api/security` e `/api/security/<guard>`: cosa i **guard DLP** di OpenCode (oggi Context7 Guard) hanno lasciato passare o bloccato, perché, e se funzionano. Un guard nuovo compare da solo, appena scrive un `<nome>.audit.jsonl`: la lens legge i suoi file in sola lettura e non li tocca mai. Ha un periodo suo (7 giorni, 30 giorni o tutto, ricordato dal browser) e si rilegge ogni 10 secondi; non è un widget e non si sposta.

- Un pulsante per ogni guard, con il pallino del verdetto.
- In alto, una fascia scura con sei tessere e i loro grafici: stato del guard (i controlli superati), chiamate e blocchi con la variazione sul periodo prima, tasso di blocco (se il guard registra anche le consentite), categoria più rilevata e ultimo blocco con le ultime 24 ore.
- **Salute** (audit, policy, plugin, ultimo evento e confronto con le chiamate che Lens ha visto, ognuno con una nota) e **Policy** del guard (protezioni accese o spente e chiavi in gruppi), affiancate.
- **Eventi**: chiamate e blocchi nel tempo, poi la tabella, 50 per pagina, con il filtro «Solo blocchi»; un clic su una riga apre oggetto, sessione, rilevamenti e, se il guard la scrive, l'anteprima. Accanto: eventi per categoria, eventi per tool e blocchi per giorno della settimana e ora.
- Da un altro computer la pagina è ridotta a esiti, tool e categorie: oggetti, sessioni e policy si vedono solo da questo computer.

Come si riconosce un guard, i campi dell'audit, la salute e il tool MCP `security` sono in [sicurezza.md](sicurezza.md).

### IBM Bob

`#bob`, solo con il modulo IBM Bob attivo (vedi [configurazione](configurazione.md#ibm-bob)): i task di Bob IDE e Bob Shell, con un periodo suo (7 giorni, 30 giorni o tutto, ricordato dal browser), riletti ogni 30 secondi. Sei tessere (Bobcoin e il loro costo, token, task e subagenti, chiamate al modello, tool, task in corso), la barra del mese contro i Bobcoin del piano con la proiezione, i Bobcoin per giorno, le tabelle per cartella, per modello scelto da Bob, per modo e per tool, e i task recenti. Solo numeri: titoli e prompt di Bob non arrivano alla lens.

**OpenCode · + Bob · Solo Bob**, nella barra del titolo di Adesso, Analisi e Monitor (solo con il modulo IBM Bob attivo; il selettore è generico, «OpenCode · + {sorgente} · Solo {sorgente}», e si nasconde se `/api/status` non ha la sorgente), sceglie di chi sono i numeri: **OpenCode** (la dashboard di sempre), **+ Bob** (Bob sommato a OpenCode) o **Solo Bob** (gli stessi widget con i soli numeri di Bob). Vale per riepilogo, giorni, ore, tool, ripartizioni (per modo come «agente», per cartella, per tipo, per modello, sempre `bob/auto` perché Bob non registra il modello che sceglie), andamento nel tempo, ritmo, calendario, prompt, statistiche dei run, sessioni, interazione, prompt in corso e attività dal vivo, anche nelle pagine Prompt e Sessioni: il server risponde con le stesse query di OpenCode lette su Bob, quindi con la stessa forma. Un task di Bob è una sessione, un subagente una sessione figlia, una chiamata al modello uno step del provider `bob`, un messaggio dell'utente un prompt, un prompt di un task principale con ciò che Bob fa fino al prompt successivo un run. Bob lascia «active» i task principali anche a lavoro finito: un task è «in corso» solo se si è mosso negli ultimi 10 minuti, altrimenti «aperto»; il suo contesto si misura sulla finestra di Bob, 270.000 token. I **budget**: con Solo Bob sono il piano di Bob (`LENS_BOB_COINS_MONTHLY` Bobcoin al mese, in dollari, e la quota per giorno e settimana; nessun budget per modello), con + Bob restano quelli di OpenCode. L'**attività dal vivo** di Bob arriva a ogni lettura del suo database (ogni `LENS_BOB_INTERVAL`), non in tempo reale; con OpenCode non compare. Restano solo di OpenCode gli errori e Vibe Coding; velocità, retry, compaction, permessi e titoli restano vuoti perché Bob non li registra (i titoli la lens non li salva). Vale solo in questo browser, come la preferenza `source` (la vecchia `bob-source` non si legge più: dopo l'aggiornamento il selettore riparte da «OpenCode»). Se il modulo si spegne mentre una scheda è aperta su «+ Bob» o «Solo Bob», la scheda torna a «OpenCode» e rilegge tutto. Con il periodo «Tutto» l'inizio è il dato più vecchio della sorgente scelta.

### Impostazioni

`#impostazioni`. In cima un riquadro di stato: «Le modifiche si salvano nel servizio», oppure, se la lens è avviata a mano, «Sola lettura» con il motivo (i campi sono disattivati). Un indice laterale porta alle sezioni e conta le modifiche non salvate di ciascuna; su schermi stretti diventa una riga che scorre.

| Sezione | Contenuto |
|---|---|
| Generale | versione, Node, avvio, cartella; `LENS_SCAN_INTERVAL`, `LENS_STORE_TITLES`, `LENS_LOG_LEVEL`, `LENS_DB`, `LENS_RETENTION_DAYS` (Conserva i dettagli: vedi [configurazione.md](configurazione.md#retention-dei-dettagli)) |
| Budget | `LENS_RESET_HOUR` (ora locale o UTC); tre carte, Giorno, Settimana e Mese, con token, costo e step e la barra del consumo attuale; la tabella dei budget per modello (consumo di oggi con barra e percentuale, campo del budget) |
| Rete e sicurezza | `LENS_HOST`, `LENS_PORT`, `LENS_TOKEN`, `LENS_ALLOWED_HOSTS`; con un host non locale compare l'avviso sul token obbligatorio |
| OpenCode | modo di discovery, indirizzo, versione, stato del contratto API; le variabili `OPENCODE_*` |
| Esportazione | `LENS_LABELS` e le variabili `LENS_OTLP_*`, con lo stato dell'OTLP |
| Lingua e formato | **Lingua** (`LENS_LANG`: Automatico, Italiano, English, Français) e **Formato** (`LENS_LOCALE`: Automatico, it-IT, en-US, en-GB, fr-FR) di date, ore e numeri, indipendenti fra loro. Automatico segue il browser; salvando, la pagina si ricarica nella lingua nuova. Vedi [configurazione.md](configurazione.md#lingua-e-formato) |
| Aspetto | **Dimensione dei widget**: Auto, Piccola (85%), Normale (100%) o Grande (120%), con la dimensione in uso. Vale per le griglie di Adesso, Analisi e Monitor, e solo per questo browser (`lens:size`): menu, Impostazioni e le altre pagine non cambiano. Righe, spazi, testi e grafici cambiano insieme e il layout salvato resta com'è. Auto, la scelta di partenza, rimpicciolisce sotto 1500 px di larghezza della finestra (fino al 75%), lascia tutto com'è fra 1500 e 2200 px e ingrandisce sopra (fino al 150%: un 4K a scala 100% è al 150%). Sotto 700 px, dove la griglia è una colonna sola, non cambia niente. Usa la proprietà CSS `zoom` (Chrome, Safari, Firefox dalla 126) |
| Moduli | una scheda per ogni modulo trovato, con nome, descrizione e stato (spento, attivo, errore con il motivo) e il pulsante *Attiva* o *Disattiva*: cambia `LENS_MODULES`, chiede conferma e salva subito (la lens si riavvia), insieme alle altre modifiche in sospeso (vedi [moduli.md](moduli.md)). Dopo un aggiornamento, un modulo spento che ha già dati ha un avviso in ogni pagina, che si può chiudere. Un modulo acceso ma da completare è «da configurare», con il motivo. Un modulo può avere sotto i campi un pannello suo: per IBM Bob lo stato della lettura di bob.db, i fatti e le sonde |
| Server MCP | stato del server `lens` letto da OpenCode (connesso, in errore, disattivato, in attesa, dichiarato ma non caricato, non collegato, sconosciuto), il comando registrato con l'avviso se non è più quello di questa installazione, il testo degli errori nascosto o visibile; come collegarlo (comando, blocco `opencode.jsonc`, prompt per il modello) e le domande di esempio per ogni strumento (budget, errori, uso, sessioni, security e preset di skill), tutto con «Copia». Solo lettura: niente da salvare |
| Aggiornamento | versione installata e com'è andato l'ultimo aggiornamento; uno zip della lens scelto o trascinato, con l'anteprima (versione nuova e attuale, tipo di zip, novità del CHANGELOG, avvisi) e **Installa e riavvia**, che lancia l'`install.sh` dello zip e aspetta la versione nuova. Spento, con il motivo accanto, se la lens non gira come servizio da `~/Applications/opencode-lens`. Vedi [aggiornamento.md](aggiornamento.md#dalla-dashboard) |
| Dati e file | dimensione del database e righe; file scritti e letti; chiavi `lens:*` del browser |
| Disinstallazione | i comandi già compilati, con «Copia» |

I campi dicono il nome, la variabile in piccolo, l'aiuto e il valore di partenza. I segreti mostrano solo «impostato» o «non impostato». La validazione è quella dell'avvio (`src/config.js`), con l'errore sotto il campo. Il budget `LENS_LIMIT_*` vuole un **numero intero**; **solo la tabella dei budget per modello** accetta anche `100M`, `500k`, `1,5G`.

Una barra fissa in basso compare solo con modifiche non salvate: il numero, le variabili toccate, **Annulla modifiche** e **Salva e riavvia**, spenta finché c'è un errore. Un solo invio (`POST /api/settings`) salva insieme le variabili e i budget per modello. Le variabili sono spiegate in [configurazione.md](configurazione.md).

## Stati e formati

- **Vuoto**: un invito, non una scusa («Nessun prompt oggi»).
- **Errore**: «Dati non disponibili · riprova», con il messaggio nel tooltip. Se una lettura fallisce, i widget che la usano mostrano l'errore sopra l'ultimo disegno, attenuato.
- **In caricamento**: solo al primo disegno. Nelle riletture il widget tiene il disegno precedente finché non arriva il nuovo: niente attenuazioni, scheletri né salti, né sul widget né sulla pagina.
- **Numeri**: compatti con `k`, `M`, `G` senza spazio (`6,7M`, `1k`). Il denaro è `11,53 $`, `0,0042 $` (quattro decimali sotto 0,01), `0 $`, e senza decimali da 100 in su. In it-IT le migliaia si raggruppano con il punto solo da 5 cifre: `1235 $` ma `12.345 $`. Gli esempi sono in it-IT; con un altro **formato** (Impostazioni › Lingua e formato) cambiano separatori, posizione del simbolo e ordine di giorno e mese.
- **Durate**: `ms`, `s`, `min`, `1 h 20 min`, `2 g 3 h` (in inglese `2 d 3 h`, in francese `2 j 3 h`). Date e ore secondo il formato scelto, in it-IT con i nomi in minuscolo (`lun`, `gen`).

## Aggiornamenti dal vivo

La dashboard si aggiorna da sola mentre OpenCode lavora. Il servizio manda alla pagina, al più una volta al secondo, un avviso (il `tick` di `/api/live`) con i tipi di attività di quel secondo: uno step iniziato o concluso, una chiamata tool, l'uso dei token, un permesso, un retry. In Adesso e nel Monitor, che seguono il giorno dei budget, la pagina rilegge solo i dati che quei tipi possono aver cambiato e ridisegna solo i widget che li mostrano: un permesso tocca i prompt in corso, non il budget del giorno. Ogni dato si rilegge al più ogni tanto: i prompt in corso ogni 5 secondi, la lista dei prompt ogni 10, budget, riepilogo e ripartizioni ogni 15, le sessioni ogni 30, i totali per giorno e per ora ogni 60; un aggiornamento rimandato arriva comunque alla sua scadenza, anche se OpenCode nel frattempo si ferma. Una sincronizzazione, una sessione nuova, rinominata o eliminata e un tipo di attività che la pagina non conosce rileggono tutto. Nelle altre viste (Analisi, Prompt, Sessioni) i periodi scorrono con l'orologio e ogni avviso rilegge tutto.

Ogni 60 secondi, all'apertura di una vista, a ogni filtro o disposizione salvata la pagina rilegge comunque tutto. Mentre legge non si attenua: un widget mostra «Caricamento…» solo la prima volta, e i suoi errori sopra l'ultimo disegno. In una scheda in background non legge nulla, né gli avvisi né i 60 secondi, e quando torni alla scheda rilegge tutto.

**Pausa.** **Pausa**, sotto lo stato in fondo alla barra laterale, ferma gli aggiornamenti automatici: avvisi, 60 secondi, «Attività live» e i cronometri dei prompt in corso. Lo stato diventa grigio e senza pulsazione, «In pausa · Dati fermi alle 14:31:07», e la riga sotto il titolo di Adesso e del Monitor lo ripete. Il collegamento con la lens resta aperto: **Riprendi** rilegge subito tutto, «Attività live» compresa. **Aggiorna** rilegge la vista adesso, anche in pausa (l'ora dei dati fermi si sposta); anche cambiare vista o filtro legge dati nuovi. La pausa resta in questo browser (`localStorage`, chiave `lens:paused`) anche ricaricando la pagina; non è un'impostazione del servizio.

## Se la lens non risponde

Se la pagina non riesce più a leggere i dati (lens ferma, riavvio dopo un aggiornamento, token cambiato) lo stato in fondo alla barra laterale diventa rosso con «Dati fermi alle …» («Lens non raggiungibile» se non ha mai letto niente) e il banner resta finché una lettura non riesce: i numeri sullo schermo sono quelli dell'ora indicata. La pagina riprova da sola; quando la lens torna ricarica dati e «Attività live» senza bisogno di aggiornare la pagina. Il banner in cima alla pagina interrompe il lettore di schermo (`role="alert"`) solo quando la lens o OpenCode non sono raggiungibili; gli altri avvisi (API di OpenCode cambiata, sincronizzazione fallita) sono un `role="status"`, e un testo che non cambia non viene riletto.

## Dove si salva

La disposizione sta in `dashboard-v2.json` (e i preset in `dashboard-presets.json`), nella stessa cartella del database (`~/Library/Application Support/opencode-lens/` di default, oppure accanto a `LENS_DB`). Con `LENS_DB=:memory:` resta in memoria fino al riavvio. La pagina **Impostazioni** elenca i file scritti, e la [disinstallazione](disinstallazione.md) li rimuove con il resto.

Le skill della pagina [Skill](#skill) stanno nella stessa cartella: la libreria in `skills/` (una cartella per skill e per versione, `skills/<id>/<n>/`), l'indice in `skills.json` e i preset di skill in `skill-presets.json`. Sono configurazione tua, mai prompt o risposte, e non finiscono nel pacchetto di rilascio. Un indice o un file di preset non leggibile dà un elenco vuoto, un avviso nel log e una copia (`skills.bad.json`, `skill-presets.bad.json`, fatta una volta sola), così il prossimo salvataggio non ne distrugge il contenuto. Con `LENS_DB=:memory:` non c'è una cartella dove tenere le skill.

Il file è JSON leggibile, versione 2: ogni vista ha la sua griglia (`adesso`, `analisi`, `monitor`).

```json
{
  "version": 2,
  "views": {
    "adesso": { "widgets": [
      { "id": "w-kpi-tokens", "type": "kpi", "x": 0, "y": 0, "w": 4, "h": 4,
        "settings": { "style": "B11", "metric": "tokens" } },
      { "id": "w-runs", "type": "runs", "x": 0, "y": 4, "w": 12, "h": 9,
        "settings": { "style": "T5", "sort": "recent", "cols": ["ora", "modello", "token"], "density": "comoda" } }
    ] },
    "analisi": { "widgets": [
      { "id": "w-trend", "type": "trend", "x": 0, "y": 0, "w": 12, "h": 8,
        "settings": { "style": "line", "metric": "cost", "by": "agent", "range": "2592000000" } }
    ] },
    "monitor": { "widgets": [] }
  }
}
```

`x` e `w` sono colonne (0–11 e 1–12), `y` e `h` righe; `range` è in millisecondi (`0` = tutto, `day` = oggi). `style` è uno degli id di [Stili](#stili); `cols` e `kinds` sono elenchi senza doppioni di valori ammessi, in qualunque ordine. Gli `id` sono unici fra le viste. Se il file non è JSON valido o descrive una disposizione impossibile (widget fuori griglia o sovrapposti, un'impostazione non ammessa), la dashboard usa quella predefinita e il log dice perché. Un widget di un tipo, o una vista, che questa versione non conosce, salvato da una versione più nuova, non si disegna: resta nel file, fermo al suo posto, e gli altri ci girano intorno.

### Migrazione da una versione precedente

Le versioni fino alla 0.12.x salvavano una sola griglia in `dashboard.json`. Questa versione la legge e la converte in memoria, senza perdere widget; il file nuovo nasce al primo «Salva».

- Una disposizione ancora **uguale a quella predefinita di prima** diventa la nuova predefinita.
- Altrimenti ogni widget va nella sua vista, con lo stesso id, titolo e coordinate: Oggi, Budget e reset, Budget per modello, Attività live e i gauge dei budget vanno in **Adesso** (diventano Oggi, Per modello oggi, Attività live e Gauge); Grafico a colonne e Linea diventano **Andamento** con lo stile giusto, «Run e interazione» diventa **Interazione**, e gli altri restano in **Analisi**. «Budget e reset» è assorbito da Oggi (se la vista ne ha già uno sparisce) e la sua metrica si perde.
- Larghezza e altezza si portano al minimo del nuovo tipo; le impostazioni che il nuovo tipo non ammette si scartano.
- I widget nuovi non compaiono da soli: una sola volta il catalogo li segnala in «Nuovi widget disponibili».
- Una disposizione v2 salvata prima degli stili e di Monitor resta com'è: i suoi widget senza `style` si disegnano come prima e la vista Monitor, che non c'era, prende quella predefinita.
- Il Riepilogo **classico** (sei tessere) non c'è più: un widget salvato con quello stile si legge come **C22** (cifre in riga), con la stessa posizione e la stessa dimensione, e uno senza `style` si disegna ora come C22. «Salva» conserva la nuova scelta; per un altro stile si usa il menu **Stile**.
- Il Gauge ad **anello pieno** (`ring`) non c'è più: un widget salvato con quello stile (anche da una v1) si legge come **B2**, l'anello a tacche, con la stessa fonte, posizione e dimensione. Il semicerchio non cambia.
- L'**orologio delle ore** del widget Oggi (`hero`, C6) non c'è più: un widget salvato con quello stile si legge come **G1** (area con gradiente, le stesse ore di oggi), con la stessa posizione e dimensione. L'orologio di «Quando lavori» (`rhythm`, C6) non cambia.

**`dashboard.json` (v1) non viene mai scritto da questa versione.** Tornando a una lens più vecchia ritrovi la tua disposizione di prima, intatta. Se esistono tutti e due i file vale `dashboard-v2.json`.

### Tornare a una lens più vecchia

Una lens uscita **prima degli stili** rifiuta un widget con un'impostazione che non ammette («impostazione sconosciuta», «non ammesso»): uno stile nuovo (`style: "G1"`; su Oggi, Per modello oggi, Attività live, Prompt, Prompt: distribuzione, Riepilogo, Ultimo anno e Tabella per dimensione qualsiasi `style`, anche `"classic"`: lì non c'era), `cols`, `kinds`, `density`, `only`, `time`, `session`. Allo stesso modo una lens precedente a «Step falliti» rifiuta `kinds` con `failed` («non ammesso»). Rifiuta anche un **Oggi** (`hero`) più stretto di 6 colonne («più piccolo del minimo 6 × 6»), che da questa versione può scendere a 4: succede se lo restringi, e con ogni widget `today` di una disposizione v1 migrata da questa versione (diventa un Oggi largo 4). Un `dashboard-v2.json` con una di queste cose lo scarta **per intero**: usa `dashboard.json` (v1) se c'è, altrimenti la disposizione predefinita, e lo scrive nel log. I tipi nuovi (`kpi`, `budget`, `flow`, `status`, `speed`, `rhythm`, `day-sessions`) e la vista Monitor, da soli, una lens vecchia li conserva senza disegnarli; a far scartare il file è un'impostazione che non conosce, o un Oggi troppo stretto.

Per questo, **al primo salvataggio con stili o impostazioni nuove**, la lens copia il `dashboard-v2.json` che c'era in `dashboard-v2.prev.json`, nella stessa cartella. In pratica avviene al primo salvataggio con questa versione, qualunque cosa cambi: la vista Monitor che aggiunge conta già come novità. Così anche un Oggi ristretto è coperto: la copia ha quello di prima, e una disposizione v1 resta intatta in `dashboard.json`. La copia si fa una volta sola e non viene mai sovrascritta; se il file di prima non esiste o non è leggibile non si copia niente (e il salvataggio riesce lo stesso). Per tornare indietro:

1. ferma la lens (`opencode-lens service stop`, o chiudi il processo);
2. nella cartella dei dati, sostituisci `dashboard-v2.json` con `dashboard-v2.prev.json` (`cp dashboard-v2.prev.json dashboard-v2.json`);
3. installa la versione vecchia (vedi [aggiornamento.md](aggiornamento.md)) e riavviala.

Senza la copia, cancella `dashboard-v2.json`: la lens vecchia riparte da `dashboard.json` o dalla disposizione predefinita. La copia compare in `/api/about` e nel comando di disinstallazione di Impostazioni. Le modifiche fatte con la versione nuova non tornano nella vecchia: la copia è la disposizione com'era prima del primo salvataggio.

API: `GET /api/dashboard` e `POST /api/dashboard`, in [metriche.md](metriche.md#api-locale). Il ripristino dall'API (`{ "reset": true }`) cancella solo `dashboard-v2.json`: se c'è ancora un `dashboard.json` v1, viene migrato di nuovo. Dalla pagina, «Ripristina» riguarda la sola vista visibile.
