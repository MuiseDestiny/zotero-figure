# Zotero Figure

Extrae figuras, tablas y fórmulas de archivos PDF en Zotero.

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure detecta figuras, tablas, fórmulas aisladas, leyendas y notas al pie de tabla. La lectura, el renderizado y la detección de la estructura del PDF se realizan localmente con el modelo incluido en el plugin.

## Funciones

- Analiza archivos PDF localmente, sin subir páginas ni descargar un modelo durante la ejecución.
- Muestra los resultados en un panel del Reader con filtros por tipo y progreso del análisis.
- Permite copiar, guardar o fijar imágenes; editar leyendas o recortes; abrir la página del PDF; añadir a una nota o eliminar el resultado.
- Reúne resultados de varios documentos en **PDF Figure Library**, con filtros por biblioteca, documento, año, categoría, tipo y leyenda.
- Analiza por lotes elementos de la biblioteca o adjuntos PDF y, opcionalmente, crea notas o anotaciones de Zotero.
- Traduce leyendas cuando Zotero PDF Translate está instalado.
- Opcionalmente reconoce LaTeX mediante SiliconFlow `Qwen/Qwen3.6-35B-A3B`, lo renderiza localmente con KaTeX y permite copiarlo, volver a reconocerlo o editarlo con Monaco de Zotero.
- Crea notas de Zotero con imágenes PNG incrustadas que enlazan al PDF de origen.
- Opcionalmente duplica los resultados locales como anotaciones de imagen de Zotero para sincronización e interoperabilidad.
- Interfaz en inglés, chino simplificado, italiano y ruso.

## Requisitos

- Zotero 9.
- El XPI de Zotero Figure de la [última versión](https://github.com/MuiseDestiny/zotero-figure/releases/latest).
- Solo para OCR de fórmulas: conexión de red y una clave API de SiliconFlow.

No se necesitan Java ni `pdffigures2.jar`.

## Instalación

1. Descarga `zotero-figure.xpi` de la última versión.
2. En Zotero abre `Herramientas > Plugins`, elige instalar desde un archivo y selecciona el XPI.
3. Reinicia Zotero si se solicita.

## Puntos de entrada

- **Reader PDF:** Abre un PDF, selecciona el icono de Zotero Figure en la barra lateral izquierda y elige analizar figuras, tablas y fórmulas.
- **Biblioteca de figuras:** Abre `Tools > PDF Figure Library` para explorar resultados de varios documentos. Selecciona una tarjeta para abrir el PDF de origen.
- **Procesamiento por lotes:** Selecciona elementos de la biblioteca o adjuntos PDF, haz clic con el botón derecho y abre `PDF Figure >` para analizar, añadir resultados a notas o crear anotaciones.
- **Preferencias:** Abre el panel de preferencias de PDF Figure para gestionar el modelo integrado, la sincronización de anotaciones y el OCR de fórmulas. Usa **Convertir fórmulas existentes** para reconocer fórmulas sin caché en todas las bibliotecas.

## Privacidad

El análisis, el renderizado, la detección de la estructura y el almacenamiento de resultados permanecen en el equipo. Los resultados locales no usan Zotero Sync salvo que se active la duplicación como anotaciones.

El OCR de fórmulas es opcional. La comprobación de la clave API envía a SiliconFlow una solicitud solo de texto. El reconocimiento envía recortes PNG de fórmulas, nunca páginas PDF completas; la clave se guarda en las preferencias locales de Zotero. El uso de SiliconFlow puede tener costes.

## Enlaces

- [Versiones](https://github.com/MuiseDestiny/zotero-figure/releases)
- [Incidencias](https://github.com/MuiseDestiny/zotero-figure/issues)
- [Licencia AGPL-3.0-or-later](../LICENSE)
