# Zotero Figure

Estrazione locale di figure, tabelle e formule dai PDF in Zotero.

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure legge localmente gli allegati PDF con MuPDF WASM, rileva figure, tabelle, formule isolate, didascalie e note a piè di tabella con DocLayout-YOLO e mostra le immagini estratte in un pannello dedicato del lettore PDF. L'analisi non richiede un Reader aperto e il PDF non viene inviato a servizi remoti.

> Il modello può commettere errori. Sono benvenute segnalazioni di arresti anomali, problemi di installazione e difetti di integrazione riproducibili; la precisione del rilevamento dipende soprattutto dal modello.

## Funzioni

- Rilevamento locale di figure, tabelle e formule isolate.
- La nota a piè di tabella più vicina viene inclusa nel ritaglio e nella didascalia della tabella.
- Lettura diretta dell'allegato in un Worker MuPDF WASM, estrazione di pagine e testo, rendering delle immagini di rilevamento a 640 px e rendering diretto dei PNG ad alta risoluzione dalle coordinate PDF. Il pannello Reader e i flussi batch della finestra principale condividono gli stessi risultati locali.
- Modello Q8 ottimizzato incluso nell'XPI, copia installata verificata tramite dimensione esatta e SHA-256, quindi byte verificati trasferiti al Worker e sottoposti a un ulteriore controllo SHA-256 prima dell'inferenza.
- Indice dei risultati per allegato salvato come JSON e immagini estratte salvate come PNG nella directory dati di Zotero.
- Nuova analisi sicura, sostituendo i risultati locali pagina per pagina o aggiungendo solo quelli mancanti.
- Se l'analisi viene annullata o la scrittura di una pagina non riesce, vengono annullate le nuove annotazioni speculari create per quella pagina; le scritture PNG non confermate vengono rimosse e i PNG sovrascritti vengono ripristinati.
- Analisi annullabile; l'annullamento termina i Worker di inferenza interessati, che vengono ricreati per le attività successive. Il rilevamento rimane a 640 px. Ogni risultato non memorizzato viene renderizzato direttamente dal rettangolo PDF, con lato lungo obiettivo di 2400 px, fino a 6x e 8 megapixel, senza una tela ad alta risoluzione dell'intera pagina.
- Anche le pagine senza testo estraibile vengono inviate al rilevatore anziché essere ignorate. Le pagine con testo usano indicazioni complete e più rigorose per figure e tabelle in inglese, cinese, italiano e russo.
- Icona Zotero Figure nella barra laterale sinistra come unico accesso principale; il plugin non aggiunge pulsanti alla barra superiore del lettore.
- Schede responsive ordinate prima per pagina PDF e poi per posizione visiva, dall'alto verso il basso e da sinistra a destra, con filtri **Tutto**, **Figure**, **Tabelle** e **Formule**, ciascuno con il relativo numero di risultati. I PNG locali vengono caricati vicino all'area visibile tramite URL Blob revocabili, con al massimo tre letture di immagini simultanee.
- Le didascalie lunghe sono compresse per impostazione predefinita; fai clic per espanderle o comprimerle.
- Barra delle azioni per analizzare, annullare, aggiungere tutti i risultati a una nota, aggiornare o cancellare i risultati locali. La cancellazione svuota subito il pannello, rimuove JSON e PNG in background e non elimina le annotazioni speculari Zotero esistenti.
- Avanzamento dell'analisi Reader mostrato direttamente nella barra laterale con percentuale, barra di progresso e testo localizzato della fase corrente, senza una finestra di avanzamento separata.
- Se è installato Zotero PDF Translate, traduci le didascalie dalla barra delle azioni e torna all'originale con un secondo clic. Le traduzioni riuscite vengono memorizzate localmente per lingua di destinazione e riutilizzate.
- I risultati locali esistenti possono essere convertiti su richiesta in annotazioni Zotero dalla barra delle azioni.
- Menu di ogni scheda per copiare, salvare o fissare l'immagine, modificare la didascalia, correggere il ritaglio su un'anteprima trascinabile dell'intera pagina, raggiungere la pagina, aggiungerla a una nota o rimuoverla. Il ritaglio corretto viene renderizzato di nuovo in alta risoluzione e sopravvive alle nuove analisi.
- Sincronizzazione facoltativa dei risultati come annotazioni immagine native, con tag `Figure N`, `Table N` o `Formula N` e didascalia nel commento. L'opzione è disattivata per impostazione predefinita.
- Preferenze limitate alla manutenzione del modello integrato e alla sincronizzazione facoltativa delle annotazioni; la spiegazione della sincronizzazione è disponibile tramite una compatta icona di aiuto con punto interrogativo.
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

Zotero Figure include esclusivamente il modello Q8 con le uscite inutilizzate rimosse `optimized-q8-6c25a56c`, da 19.505.323 byte, con SHA-256 `6c25a56caf796a074e26def15eea9018686836155fd9e15e5e0950e9c08a4cac`. Mantiene esattamente il tensore `output0` usato dal plugin ed elimina sette rami di uscita inutilizzati. L'XPI lo copia in `zotero-figure/models/` nella directory dati di Zotero e verifica la copia prima dell'analisi.

Dopo aver ottenuto l'XPI non serve accedere a GitHub o Hugging Face per il modello. Pubblica lo stesso XPI su GitHub Releases e su uno specchio nazionale, verificando lo stesso SHA-256. Consulta la [politica di distribuzione](MODEL_DISTRIBUTION.md).

## Utilizzo

1. Apri un allegato PDF nel lettore di Zotero.
2. Seleziona l'icona Zotero Figure nella barra laterale sinistra. Non è presente un pulsante Zotero Figure nella barra superiore del lettore.
3. Seleziona **Analizza figure, tabelle e formule** nella barra delle azioni e attendi il completamento del rendering e del rilevamento.
4. Passa tra **Tutto**, **Figure**, **Tabelle** e **Formule**. Dal menu di una scheda puoi copiare, salvare, fissare o correggere l'immagine, modificare la didascalia, raggiungere la pagina, aggiungerla a una nota o rimuoverla.
5. Se Zotero PDF Translate è installato, usa il pulsante della lingua per tradurre le didascalie; fai clic di nuovo per ripristinare gli originali.
6. Quando serve, usa **Aggiungi tutti i risultati a una nota**, **Aggiorna figure e tabelle** o **Cancella i risultati locali**. La cancellazione riguarda solo i JSON e PNG locali del plugin, non le annotazioni speculari Zotero esistenti.
7. Per creare anche annotazioni immagine sincronizzate, abilita **Dopo l'analisi, sincronizza anche i risultati nelle annotazioni immagine Zotero** nelle preferenze. L'opzione è disattivata per impostazione predefinita.
8. Per l'elaborazione in batch, seleziona uno o più elementi della libreria o allegati PDF, fai clic con il pulsante destro e usa **PDF Figure > Analizza figure, tabelle e formule**, **Analizza figure, tabelle e formule e aggiungile a una nota** oppure **Analizza figure, tabelle e formule e crea annotazioni**. I PDF vengono elaborati in sequenza e non serve aprire una scheda del lettore.

Il pannello legge sempre l'archivio locale del plugin. Per ogni allegato PDF, i metadati sono salvati in `zotero-figure/results/<libraryID>/<attachmentKey>/manifest.json` nella directory dati di Zotero, con i PNG nella directory `images/` adiacente. Lo schema v5 del manifest memorizza correzioni manuali di didascalie e ritagli, traduzioni per lingua di destinazione e identità versionate della cache delle immagini. Le didascalie e i ritagli corretti restano dopo una nuova analisi perché i valori rilevati vengono conservati separatamente per confrontare la cache; la modifica di una didascalia elimina la vecchia cache di traduzione del risultato. Le analisi successive riutilizzano un PNG solo se coincidono l'impronta dell'allegato di origine (dimensione e data di modifica del file, con ripiego sulla versione dell'elemento Zotero), la versione di analisi, l'hash del modello, la versione dell'anteprima, l'impronta del risultato e quella del ritaglio corrente, e il relativo PNG esiste ancora. Il manifest, le cache delle traduzioni e i PNG non usano Zotero Sync. Abilitando la sincronizzazione delle annotazioni viene creata una copia aggiuntiva come annotazione nativa, utile per la sincronizzazione e per gli altri plugin, ma la fonte dati del pannello non cambia. Le immagini aggiunte alle note sono allegati incorporati, non collegamenti ai percorsi PNG locali; anche senza annotazioni speculari, un clic porta al ritaglio corrispondente nel PDF di origine.

La preparazione di MuPDF, del modello e dei Worker viene pianificata quando il lettore è inattivo. La prima analisi può comunque essere più lenta se parte prima del completamento. Il tempo dipende da lunghezza e complessità del PDF, CPU e memoria disponibile.

Durante l'analisi vengono pianificate al massimo tre pagine alla volta. Le fasi limitate consentono al massimo due pagine nel rilevamento, una richiesta di rendering MuPDF, una fase di regioni ad alta risoluzione e un'operazione di archiviazione. Le immagini di rilevamento hanno il lato lungo di 640 px. I risultati non memorizzati vengono renderizzati uno alla volta direttamente dai rettangoli PDF, con lato lungo obiettivo di 2400 px, fino a 6x e 8 megapixel. Due Worker ONNX persistenti lavorano in parallelo con un thread di inferenza ciascuno; l'annullamento termina i Worker interessati. Questo duplica la sessione Q8 ma elimina la precedente tela ad alta risoluzione dell'intera pagina. Vedi il [budget delle prestazioni](PERFORMANCE.md).

## Privacy

L'analisi e il rendering PDF usano MuPDF WASM integrato; il rilevamento usa Transformers.js e ONNX Runtime Web dentro Zotero. Nessuna pagina PDF viene inviata a servizi remoti e il modello non viene scaricato durante l'esecuzione.

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
| `src/features`        | Interfaccia del lettore, azioni batch e preferenze     |
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
