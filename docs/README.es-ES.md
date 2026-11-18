# Zotero Figure

Extrae figuras, tablas y fórmulas de archivos PDF en Zotero.

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure detecta figuras, tablas, fórmulas aisladas, leyendas y notas al pie de tabla. La lectura, el renderizado y la detección de la estructura del PDF se realizan localmente con el modelo incluido en el plugin.

## Funciones

- Elimina resultados locales individuales desde el menú de una tarjeta de la biblioteca o vacía un documento desde la cabecera de su columna o el botón junto al filtro de documento. El vaciado incluye todos sus adjuntos PDF y los resultados ocultos por los filtros. La confirmación permite eliminar también las anotaciones generadas por Figure; se conservan los PDF originales y las notas guardadas. Un nuevo análisis puede recrear los resultados. No se pueden eliminar mientras los adjuntos afectados se estén analizando o actualizando.
- Analiza archivos PDF localmente, sin subir páginas ni descargar un modelo durante la ejecución.
- Muestra los resultados en un panel del Reader con filtros de tipo combinables que ocultan los tipos no disponibles y con el progreso del análisis.
- Permite copiar, guardar o fijar imágenes; editar leyendas o corregir recortes en un diálogo adaptado a la página del PDF; abrir la página del PDF; añadir a una nota o eliminar el resultado.
- En el PDF Reader, haz clic derecho en una anotación de imagen seleccionada para añadirla a los resultados locales del análisis; se conservan las etiquetas Figure, Table o Formula existentes.
- Reúne resultados de varios documentos en **PDF Figure Library**, con filtros por documento, año, categoría, tipo y leyenda. Permite alternar entre las vistas en cascada y por columnas de documentos recordando la selección; en las columnas los resultados conservan el orden estable de página y se muestran en filas comparativas alineadas con nombre opcional. Arrastra los encabezados para reordenar las columnas y las tarjetas dentro de un documento para reorganizar las filas, o haz clic con el botón derecho en una imagen para añadirla a un grupo comparativo. Cuando un documento aporta varias imágenes a un grupo, la celda muestra una imagen principal y miniaturas a la izquierda; selecciona una miniatura para convertirla en principal. Disuelve un grupo para eliminar su fila comparativa y usa el control de escala de la barra de herramientas para cambiar el tamaño de todas las vistas previas.
- Los diseños de comparación se guardan localmente en `zotero-figure/comparison-layouts.json`, dentro del directorio de datos de Zotero, para admitir tablas grandes. Los diseños existentes se migran automáticamente; incluye este archivo en las copias de seguridad. Los diseños no se sincronizan mediante Zotero Sync.
- Las tarjetas usan resaltados suaves al pasar el puntero y al seleccionarlas. El clic derecho selecciona la tarjeta y mantiene el resaltado mientras el menú está abierto; el doble clic abre el PDF de origen.
- Analiza por lotes elementos de la biblioteca o adjuntos PDF y, opcionalmente, crea notas o anotaciones de Zotero.
- Traduce leyendas cuando Zotero PDF Translate está instalado.
- Opcionalmente reconoce LaTeX mediante SiliconFlow `Qwen/Qwen3.6-35B-A3B`, lo renderiza localmente con KaTeX y permite copiarlo, volver a reconocerlo o editarlo con un editor de código CodeMirror y una vista previa de KaTeX en tiempo real.
- Crea notas de Zotero con imágenes PNG incrustadas que enlazan al PDF de origen.
- Opcionalmente duplica los resultados locales como anotaciones de imagen de Zotero para sincronización e interoperabilidad.
- Interfaz en inglés, chino simplificado, italiano y ruso.

## Requisitos

- Zotero 9, Zotero 10 o Zotero 11 (beta).
- El XPI de Zotero Figure de la [última versión](https://github.com/MuiseDestiny/zotero-figure/releases/latest).
- Solo para OCR de fórmulas: conexión de red y una clave API de SiliconFlow o de un servicio personalizado compatible con OpenAI.

No se necesitan Java ni `pdffigures2.jar`.

## Instalación

1. Descarga `zotero-figure.xpi` de la última versión.
2. En Zotero abre `Herramientas > Plugins`, elige instalar desde un archivo y selecciona el XPI.
3. Reinicia Zotero si se solicita.

## Puntos de entrada

- **Reader PDF:** Abre un PDF, selecciona el icono de Zotero Figure en la barra lateral izquierda y elige analizar figuras, tablas y fórmulas.
- **Biblioteca de figuras:** Abre `Tools > PDF Figure Library` para explorar resultados de varios documentos. Haz doble clic en una tarjeta para abrir el PDF de origen.
- **Procesamiento por lotes:** Selecciona elementos de la biblioteca o adjuntos PDF, haz clic con el botón derecho y abre `PDF Figure >` para analizar, añadir resultados a notas o crear anotaciones. Selecciona anotaciones de imagen y elige `Añadir a Figure` para importarlas por lotes.
- **Preferencias:** Abre el panel de preferencias de PDF Figure para gestionar el modelo integrado, la sincronización de anotaciones y el OCR de fórmulas, o para abrir directamente la Biblioteca de figuras. Usa **Convertir fórmulas existentes** para reconocer fórmulas sin caché en todas las bibliotecas.

## Privacidad

El análisis, el renderizado, la detección de la estructura y el almacenamiento de resultados permanecen en el equipo. Los resultados locales no usan Zotero Sync salvo que se active la duplicación como anotaciones.

El OCR de fórmulas es opcional. En Preferencias, **Personalizar** permite configurar la URL de una API Chat Completions compatible con OpenAI, la clave y un modelo que admita imágenes. Se aceptan URL base y URL completas `/chat/completions`. **Guardar y comprobar** verifica automáticamente la conexión con una solicitud de texto; no comprueba la compatibilidad con imágenes. Se puede restaurar la configuración de SiliconFlow. El reconocimiento envía recortes PNG de fórmulas al servicio configurado, nunca páginas PDF completas. Las claves se guardan en el gestor de contraseñas de Zotero; las antiguas claves en preferencias se eliminan tras guardarse de forma segura. El uso de la API puede tener costes.

## Enlaces

- [Versiones](https://github.com/MuiseDestiny/zotero-figure/releases)
- [Incidencias](https://github.com/MuiseDestiny/zotero-figure/issues)
- [Licencia AGPL-3.0-or-later](../LICENSE)
