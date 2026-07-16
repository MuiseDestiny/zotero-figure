# Zotero Figure

Estrai figure, tabelle e formule dai PDF in Zotero.

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure rileva figure, tabelle, formule isolate, didascalie e note a piè di tabella. Lettura, rendering e rilevamento del layout PDF vengono eseguiti localmente con il modello incluso nel plugin.

## Funzioni

- Analizza i PDF localmente, senza caricare pagine o scaricare un modello durante l'esecuzione.
- Mostra i risultati in un pannello Reader dedicato, con filtri per tipo e avanzamento dell'analisi.
- Consente di copiare, salvare o fissare immagini; modificare didascalie o ritagli; aprire la pagina PDF; aggiungere a una nota o eliminare il risultato.
- Raccoglie i risultati di più documenti nella **Libreria di figure PDF**, con filtri per libreria, documento, anno, categoria, tipo e didascalia.
- Analizza in batch elementi della libreria o allegati PDF e, facoltativamente, crea note o annotazioni Zotero.
- Traduce le didascalie quando Zotero PDF Translate è installato.
- Facoltativamente riconosce il LaTeX tramite SiliconFlow `Qwen/Qwen3.6-35B-A3B`, lo renderizza localmente con KaTeX e consente di copiarlo, riconoscerlo di nuovo o modificarlo con Monaco di Zotero.
- Crea note Zotero con immagini PNG incorporate che rimandano al PDF di origine.
- Facoltativamente duplica i risultati locali come annotazioni immagine Zotero per sincronizzazione e interoperabilità.
- Interfaccia in inglese, cinese semplificato, italiano e russo.

## Requisiti

- Zotero 9.
- L'XPI di Zotero Figure dall'[ultima versione](https://github.com/MuiseDestiny/zotero-figure/releases/latest).
- Solo per l'OCR delle formule: accesso alla rete e una chiave API SiliconFlow.

Java e `pdffigures2.jar` non sono necessari.

## Installazione

1. Scarica `zotero-figure.xpi` dall'ultima versione.
2. In Zotero apri `Strumenti > Plugin`, scegli l'installazione da file e seleziona l'XPI.
3. Riavvia Zotero se richiesto.

## Punti di accesso

- **Reader PDF:** Apri un PDF, seleziona l'icona Zotero Figure nella barra laterale sinistra e avvia l'analisi di figure, tabelle e formule.
- **Libreria di figure:** Apri `Strumenti > Libreria di figure PDF` per esplorare i risultati di più documenti. Seleziona una scheda per aprire il PDF di origine.
- **Elaborazione batch:** Seleziona elementi della libreria o allegati PDF, fai clic con il pulsante destro e apri `PDF Figure >` per analizzare, aggiungere risultati alle note o creare annotazioni.
- **Preferenze:** Apri il pannello delle preferenze PDF Figure per gestire il modello integrato, la sincronizzazione delle annotazioni e l'OCR delle formule. Usa **Converti formule esistenti** per riconoscere le formule non memorizzate in tutte le librerie.

## Privacy

Analisi, rendering, rilevamento del layout e archiviazione dei risultati rimangono sul computer. I risultati locali non usano Zotero Sync a meno che non venga attivata la duplicazione come annotazioni.

L'OCR delle formule è facoltativo. La verifica della chiave API invia a SiliconFlow una richiesta di solo testo. Il riconoscimento invia ritagli PNG delle formule, mai pagine PDF complete; la chiave viene salvata nelle preferenze locali di Zotero. L'uso di SiliconFlow può comportare costi.

## Collegamenti

- [Versioni](https://github.com/MuiseDestiny/zotero-figure/releases)
- [Segnalazioni](https://github.com/MuiseDestiny/zotero-figure/issues)
- [Licenza AGPL-3.0-or-later](../LICENSE)
