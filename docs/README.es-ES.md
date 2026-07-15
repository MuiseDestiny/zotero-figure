# Zotero Figure

Extracción local de figuras y tablas de archivos PDF en Zotero.

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure renderiza las páginas PDF localmente, detecta figuras, tablas y sus leyendas con DocLayout-YOLO y muestra las imágenes extraídas en un panel dedicado del lector PDF. El PDF y los datos de inferencia no se envían a servicios remotos.

> El modelo puede cometer errores. Informa de bloqueos, problemas de instalación y fallos de integración reproducibles; la precisión de detección depende principalmente del modelo.

## Funciones

- Detección local de figuras y tablas.
- Modelo Q8 optimizado incluido en el XPI: primero se verifica la copia instalada por su tamaño exacto y SHA-256; después, esos bytes ya verificados se transfieren al Worker, que vuelve a comprobar el SHA-256 antes de la inferencia.
- Índice de resultados por adjunto guardado como JSON e imágenes extraídas guardadas como PNG en el directorio de datos de Zotero.
- Reanálisis seguro, sustituyendo los resultados locales por página o añadiendo solo los que faltan.
- Análisis cancelable; cancelar una inferencia activa termina el Worker actual, que se reconstruye para trabajos posteriores. La detección siempre se renderiza a 640 px. Cada página con resultados se renderiza una sola vez en alta resolución, con límites de 4x, 12 megapíxeles y 8192 px por lado, y todos los rectángulos detectados se recortan de esa imagen de página.
- Las páginas sin texto extraíble también pasan por el detector en vez de omitirse. En las páginas con texto se emplean términos completos en inglés, chino, italiano y ruso para acotar la detección de figuras y tablas.
- Icono de Zotero Figure en la barra lateral izquierda como única entrada principal; el plugin no añade botones a la barra superior del lector.
- Tarjetas adaptables con filtros en el orden **Todo**, **Figuras** y **Tablas**, cada uno con su número de resultados. Los PNG locales se cargan de forma diferida cerca del área visible mediante URL de Blob revocables, con un máximo de tres lecturas de imagen simultáneas.
- Las leyendas largas aparecen contraídas de forma predeterminada; haz clic para expandirlas o contraerlas.
- Barra de acciones para analizar, cancelar, añadir todos los resultados a una nota, actualizar o borrar los resultados locales. Al borrar, el panel se vacía de inmediato, los JSON y PNG se eliminan en segundo plano y las anotaciones duplicadas de Zotero existentes no se modifican.
- Si Zotero PDF Translate está instalado, traduce las leyendas desde la barra de acciones y vuelve al original con otro clic. Las traducciones correctas se almacenan localmente por idioma de destino y se reutilizan.
- Los resultados locales existentes se pueden convertir bajo demanda en anotaciones espejo de Zotero desde la barra de acciones.
- Menú en cada tarjeta para copiar o guardar la imagen, ir a su página, añadirla a una nota o eliminarla.
- Duplicado opcional de los resultados como anotaciones de imagen nativas, con etiquetas `Figure N` o `Table N` y la leyenda en el comentario. La opción está desactivada de forma predeterminada.
- Creación de notas de Zotero con adjuntos PNG realmente incrustados, para una tarjeta o para todos los resultados. Cada imagen de la nota sigue siendo un enlace al recorte correspondiente del PDF de origen sin requerir una anotación duplicada.
- Interfaz en inglés, chino simplificado, italiano y ruso.

## Requisitos

- Solo Zotero 9.
- El XPI de la [última versión](https://github.com/MuiseDestiny/zotero-figure/releases/latest).

La canalización local actual ya no necesita Java ni `pdffigures2.jar`.

## Instalación y configuración

1. Descarga `zotero-figure.xpi` de la última versión.
2. En Zotero abre `Herramientas > Plugins`, elige instalar desde un archivo y selecciona el XPI.
3. Abre un PDF, selecciona el icono de Zotero Figure en la barra lateral izquierda e inicia el análisis. El modelo integrado se prepara y verifica automáticamente, sin una descarga separada.

## Modelo integrado

Zotero Figure incluye únicamente el modelo Q8 optimizado `optimized-q8-d5d1e664`, de 20.552.482 bytes, con SHA-256 `d5d1e664fbe639e716be7011aa7493b40f4ab498374b2157988c2ea41bf70daf`. El XPI lo copia a `zotero-figure/models/` dentro del directorio de datos de Zotero y verifica la copia antes del análisis.

Después de obtener el XPI no se necesita acceso a GitHub ni Hugging Face para el modelo. Publica el mismo XPI en GitHub Releases y en un espejo regional, con el mismo SHA-256. Consulta la [política de distribución](MODEL_DISTRIBUTION.md).

## Uso

1. Abre un adjunto PDF en el lector de Zotero.
2. Selecciona el icono de Zotero Figure en la barra lateral izquierda. No hay un botón de Zotero Figure en la barra superior del lector.
3. Selecciona **Analizar figuras y tablas** en la barra de acciones y espera a que terminen el renderizado y la detección.
4. Cambia entre **Todo**, **Figuras** y **Tablas**. Usa el menú de una tarjeta para copiar o guardar su imagen, ir a su página, añadirla a una nota o eliminarla.
5. Si Zotero PDF Translate está instalado, usa el botón de idioma para traducir las leyendas; vuelve a pulsarlo para restaurar el original.
6. Cuando sea necesario, usa **Añadir todos los resultados a una nota**, **Actualizar** o **Borrar resultados locales**. El borrado solo afecta a los JSON y PNG locales del plugin, no a las anotaciones duplicadas de Zotero existentes.
7. Para crear también anotaciones de imagen sincronizadas, activa **Sincronizar los resultados con las anotaciones de Zotero después del análisis** en las preferencias. La opción está desactivada de forma predeterminada.

El panel siempre lee el almacén local del plugin. Para cada adjunto PDF, los metadatos se guardan en `zotero-figure/results/<libraryID>/<attachmentKey>/manifest.json` dentro del directorio de datos de Zotero, y los PNG en el directorio `images/` contiguo. El esquema v3 del manifiesto guarda las traducciones de las leyendas por idioma de destino e identidades versionadas para la caché de imágenes. Si la huella del adjunto de origen (tamaño y fecha de modificación del archivo; si no están disponibles, la versión del elemento de Zotero), la versión de análisis, el hash del modelo, la versión de la vista previa y la huella del resultado coinciden con la caché, y su PNG todavía existe, un nuevo análisis reutiliza ese PNG. El manifiesto, las cachés de traducción y los PNG no usan Zotero Sync. Al activar la sincronización de anotaciones se crea una copia adicional como anotaciones nativas, útil para sincronizar y para otros plugins, pero la fuente de datos del panel no cambia. Las imágenes añadidas a las notas son adjuntos incrustados, no enlaces a las rutas PNG locales; incluso sin anotaciones duplicadas, al hacer clic se abre el recorte correspondiente del PDF de origen.

La preparación del modelo y del Worker se programa cuando el lector está inactivo. El primer análisis aún puede tardar más si comienza antes de que termine la preparación. El tiempo depende del PDF, la CPU y la memoria disponible.

Durante el análisis se programan como máximo tres páginas a la vez. Las etapas limitadas por separado permiten como máximo dos páginas en detección, un renderizado de página para detección, una página de vista previa en alta resolución y una operación de almacenamiento. Las páginas de detección se renderizan a 640 px. Para una página con resultados que no esté en caché, el PDF se renderiza una sola vez con límites de escala 4x, 12 megapíxeles y 8192 px por lado; todos los rectángulos de resultados se recortan de esa única imagen. Se reutiliza un Worker de inferencia que puede usar hasta cuatro hilos WASM y reserva capacidad lógica para Zotero. Cancelar una inferencia activa termina ese Worker para que no siga consumiendo CPU; los trabajos posteriores lo reconstruyen. Reutilizar un único Worker evita sesiones duplicadas del modelo.

## Privacidad

La detección usa Transformers.js y ONNX Runtime Web dentro de Zotero. Ninguna página PDF se envía a servicios remotos y el modelo no se descarga durante la ejecución.

Los archivos JSON y PNG locales permanecen en el directorio de datos de Zotero. Solo pueden salir del dispositivo si el usuario realiza por separado una copia de seguridad o sincroniza ese directorio, o si activa la sincronización de anotaciones para crear una copia adicional.

## Desarrollo

Se necesita Node.js 20.10 o posterior.

```bash
npm install
npm run check
npm run build
```

`npm run check` verifica formato, ESLint, TypeScript, pruebas y bundle. `npm run build` genera `build/zotero-figure.xpi`. Antes de `npm start`, copia `scripts/zotero-cmd-default.json` como `scripts/zotero-cmd.json` y configura las rutas locales de Zotero.

## Arquitectura

| Ruta                  | Responsabilidad                                        |
| --------------------- | ------------------------------------------------------ |
| `src/domain`          | Tipos y algoritmos puros de diseño y leyendas          |
| `src/features`        | Interfaz del lector y preferencias                     |
| `src/services`        | Análisis, cola de inferencia, recorte y almacén local  |
| `src/platform/zotero` | Límite tipado con las API de Zotero                    |
| `addon`               | Bootstrap, traducciones, Worker y metadatos del modelo |
| `scripts`, `tests`    | Compilación reproducible y comprobaciones automáticas  |

La lógica de dominio debe permanecer independiente de los objetos globales de Zotero. El acceso a API privadas debe aislarse en los adaptadores de plataforma.

## Limitaciones actuales

La lista priorizada está en [docs/KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). Las principales carencias restantes son la extracción de leyendas en PDF escaneados, el riesgo de las API privadas del lector de Zotero y las pruebas integrales en una instalación real de Zotero 9.

## Créditos y licencia

Basado en [DocLayout-YOLO](https://github.com/opendatalab/DocLayout-YOLO), [Transformers.js](https://github.com/huggingface/transformers.js), [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) y la integración histórica con [PDFFigures2](https://github.com/allenai/pdffigures2).

Licencia [GNU AGPL v3.0 o posterior](../LICENSE).
