# Zotero Figure

Estrazione locale di figure e tabelle dai PDF in Zotero.

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure renderizza localmente le pagine PDF, rileva figure, tabelle e relative didascalie con DocLayout-YOLO e mostra le immagini estratte in un pannello dedicato del lettore PDF. Il PDF e i dati di inferenza non vengono inviati a servizi remoti.

> Il modello può commettere errori. Sono benvenute segnalazioni di arresti anomali, problemi di installazione e difetti di integrazione riproducibili; la precisione del rilevamento dipende soprattutto dal modello.

## Funzioni

- Rilevamento locale di figure e tabelle.
- Modello Q8 ottimizzato incluso nell'XPI, copia installata verificata tramite dimensione esatta e SHA-256, quindi byte verificati trasferiti al Worker e sottoposti a un ulteriore controllo SHA-256 prima dell'inferenza.
- Indice dei risultati per allegato salvato come JSON e immagini estratte salvate come PNG nella directory dati di Zotero.
- Nuova analisi sicura, sostituendo i risultati locali pagina per pagina o aggiungendo solo quelli mancanti.
- Analisi annullabile; l'annullamento durante l'inferenza termina il Worker attivo, che viene ricreato per le attività successive. Il rilevamento rimane a 640 px. Ogni pagina con risultati viene renderizzata una sola volta fino a 4x, 12 megapixel e 8192 px per lato, quindi tutti i rettangoli rilevati vengono ritagliati da quell'unica immagine della pagina.
- Anche le pagine senza testo estraibile vengono inviate al rilevatore anziché essere ignorate. Le pagine con testo usano indicazioni complete e più rigorose per figure e tabelle in inglese, cinese, italiano e russo.
- Icona Zotero Figure nella barra laterale sinistra come unico accesso principale; il plugin non aggiunge pulsanti alla barra superiore del lettore.
- Schede responsive con filtri nell'ordine **Tutto**, **Figure** e **Tabelle**, ciascuno con il relativo numero di risultati. I PNG locali vengono caricati vicino all'area visibile tramite URL Blob revocabili, con al massimo tre letture di immagini simultanee.
- Le didascalie lunghe sono compresse per impostazione predefinita; fai clic per espanderle o comprimerle.
- Barra delle azioni per analizzare, annullare, aggiungere tutti i risultati a una nota, aggiornare o cancellare i risultati locali. La cancellazione svuota subito il pannello, rimuove JSON e PNG in background e non elimina le annotazioni speculari Zotero esistenti.
- Se è installato Zotero PDF Translate, traduci le didascalie dalla barra delle azioni e torna all'originale con un secondo clic. Le traduzioni riuscite vengono memorizzate localmente per lingua di destinazione e riutilizzate.
- I risultati locali esistenti possono essere convertiti su richiesta in annotazioni Zotero dalla barra delle azioni.
- Menu di ogni scheda per copiare o salvare l'immagine, raggiungere la pagina, aggiungerla a una nota o rimuoverla.
- Sincronizzazione facoltativa dei risultati come annotazioni immagine native, con tag `Figure N` o `Table N` e didascalia nel commento. L'opzione è disattivata per impostazione predefinita.
- Creazione di note Zotero con allegati PNG realmente incorporati, per una singola scheda o per tutti i risultati. Ogni immagine nella nota rimane cliccabile e porta al ritaglio corrispondente nel PDF di origine senza richiedere un'annotazione speculare.
- Interfaccia in inglese, cinese semplificato, italiano e russo.

## Requisiti

- Solo Zotero 9.
- L'XPI dall'[ultima versione](https://github.com/MuiseDestiny/zotero-figure/releases/latest).

La pipeline locale corrente non richiede più Java o `pdffigures2.jar`.

## Installazione e configurazione

1. Scarica `zotero-figure.xpi` dall'ultima versione.
2. In Zotero apri `Strumenti > Plugin`, scegli l'installazione da file e seleziona l'XPI.
3. Apri un PDF, seleziona l'icona Zotero Figure nella barra laterale sinistra e avvia l'analisi. Il modello integrato viene preparato e verificato automaticamente, senza download separati.

## Modello integrato

Zotero Figure include esclusivamente il modello Q8 ottimizzato `optimized-q8-d5d1e664`, da 20.552.482 byte, con SHA-256 `d5d1e664fbe639e716be7011aa7493b40f4ab498374b2157988c2ea41bf70daf`. L'XPI lo copia in `zotero-figure/models/` nella directory dati di Zotero e verifica la copia prima dell'analisi.

Dopo aver ottenuto l'XPI non serve accedere a GitHub o Hugging Face per il modello. Pubblica lo stesso XPI su GitHub Releases e su uno specchio nazionale, verificando lo stesso SHA-256. Consulta la [politica di distribuzione](MODEL_DISTRIBUTION.md).

## Utilizzo

1. Apri un allegato PDF nel lettore di Zotero.
2. Seleziona l'icona Zotero Figure nella barra laterale sinistra. Non è presente un pulsante Zotero Figure nella barra superiore del lettore.
3. Seleziona **Analizza figure e tabelle** nella barra delle azioni e attendi il completamento del rendering e del rilevamento.
4. Passa tra **Tutto**, **Figure** e **Tabelle**. Dal menu di una scheda puoi copiare o salvare l'immagine, raggiungere la pagina, aggiungerla a una nota o rimuoverla.
5. Se Zotero PDF Translate è installato, usa il pulsante della lingua per tradurre le didascalie; fai clic di nuovo per ripristinare gli originali.
6. Quando serve, usa **Aggiungi tutti i risultati a una nota**, **Aggiorna figure e tabelle** o **Cancella i risultati locali**. La cancellazione riguarda solo i JSON e PNG locali del plugin, non le annotazioni speculari Zotero esistenti.
7. Per creare anche annotazioni immagine sincronizzate, abilita **Dopo l'analisi, sincronizza anche i risultati nelle annotazioni immagine Zotero** nelle preferenze. L'opzione è disattivata per impostazione predefinita.

Il pannello legge sempre l'archivio locale del plugin. Per ogni allegato PDF, i metadati sono salvati in `zotero-figure/results/<libraryID>/<attachmentKey>/manifest.json` nella directory dati di Zotero, con i PNG nella directory `images/` adiacente. Lo schema v3 del manifest memorizza le traduzioni delle didascalie per lingua di destinazione e identità versionate della cache delle immagini. Se l'impronta dell'allegato di origine (dimensione e data di modifica del file, con ripiego sulla versione dell'elemento Zotero), la versione di analisi, l'hash del modello, la versione dell'anteprima e l'impronta del risultato coincidono con la cache, e il relativo PNG esiste ancora, le analisi successive riutilizzano quel PNG. Il manifest, le cache delle traduzioni e i PNG non usano Zotero Sync. Abilitando la sincronizzazione delle annotazioni viene creata una copia aggiuntiva come annotazione nativa, utile per la sincronizzazione e per gli altri plugin, ma la fonte dati del pannello non cambia. Le immagini aggiunte alle note sono allegati incorporati, non collegamenti ai percorsi PNG locali; anche senza annotazioni speculari, un clic porta al ritaglio corrispondente nel PDF di origine.

La preparazione del modello e del Worker viene pianificata quando il lettore è inattivo. La prima analisi può comunque essere più lenta se parte prima del completamento. Il tempo dipende da lunghezza e complessità del PDF, CPU e memoria disponibile.

Durante l'analisi vengono pianificate al massimo tre pagine alla volta. Le fasi limitate separatamente consentono al massimo due pagine nel rilevamento, un rendering di pagina per il rilevamento, una pagina di anteprima ad alta risoluzione e un'operazione di archiviazione. Le pagine di rilevamento sono renderizzate a 640 px. Per una pagina di risultati non presente nella cache, il PDF viene renderizzato una sola volta entro una scala di 4x, 12 megapixel o 8192 px per lato, e tutti i rettangoli dei risultati vengono ritagliati dalla stessa immagine. Un singolo Worker di inferenza viene riutilizzato e può impiegare fino a quattro thread WASM, riservando capacità logica a Zotero; l'annullamento dell'inferenza attiva termina il Worker anziché lasciarlo usare la CPU. Il singolo Worker evita sessioni duplicate del modello.

## Privacy

Il rilevamento usa Transformers.js e ONNX Runtime Web dentro Zotero. Nessuna pagina PDF viene inviata a servizi remoti e il modello non viene scaricato durante l'esecuzione.

I file JSON e PNG dei risultati rimangono nella directory dati di Zotero. Possono lasciare il dispositivo solo se l'utente esegue separatamente il backup o la sincronizzazione di tale directory, oppure abilita la sincronizzazione delle annotazioni per crearne una copia aggiuntiva.

## Sviluppo

È richiesto Node.js 20.10 o successivo.

```bash
npm install
npm run check
npm run build
```

`npm run check` esegue formattazione, ESLint, controllo TypeScript, test e verifica del bundle. `npm run build` genera `build/zotero-figure.xpi`. Prima di `npm start`, copia `scripts/zotero-cmd-default.json` in `scripts/zotero-cmd.json` e configura i percorsi locali di Zotero.

## Architettura

| Percorso              | Responsabilità                                         |
| --------------------- | ------------------------------------------------------ |
| `src/domain`          | Tipi e algoritmi puri per layout e didascalie          |
| `src/features`        | Interfaccia del lettore e preferenze                   |
| `src/services`        | Analisi, coda di inferenza, ritaglio e archivio locale |
| `src/platform/zotero` | Confini tipizzati verso le API Zotero                  |
| `addon`               | Bootstrap, traduzioni, Worker e metadati modello       |
| `scripts`, `tests`    | Build riproducibile e verifiche automatiche            |

La logica di dominio deve rimanere indipendente dalle variabili globali di Zotero. Gli accessi a API private vanno isolati negli adattatori di piattaforma.

## Limiti attuali

La lista prioritaria è in [docs/KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). Le lacune principali rimaste sono l'estrazione delle didascalie dai PDF scansionati, il rischio delle API private del lettore Zotero e i test end-to-end su una vera installazione di Zotero 9.

## Crediti e licenza

Basato su [DocLayout-YOLO](https://github.com/opendatalab/DocLayout-YOLO), [Transformers.js](https://github.com/huggingface/transformers.js), [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) e sull'integrazione storica [PDFFigures2](https://github.com/allenai/pdffigures2).

Licenza [GNU AGPL v3.0 o successiva](../LICENSE).
