# drive-staging-consolidator

Un job en Google Apps Script que archiva los documentos depositados en una
carpeta de entrada de Drive dentro de un archivo por fecha — y que comprueba
por su cuenta, con su propia periodicidad, que sigue haciéndolo.

Lo interesante no es archivar. Es lo que tiene que cumplirse para que un
proceso desatendido siga siendo fiable el día 40, cuando un fichero ha cambiado
de nombre, una ejecución se cortó a medias y nadie lo ha mirado desde el día 1.

*[Read in English](README.md)*

## Qué hace

- Vigila una carpeta de **entrada** en Google Drive.
- Archiva cada documento en `ARCHIVE_ROOT/AAAA/MM/` según su fecha de creación.
- Reconoce el contenido que ya archivó, se llame ahora como se llame, y lo
  omite en lugar de duplicarlo.
- Registra cada decisión en un **libro de operaciones de solo anexado** (una
  hoja de cálculo): qué se hizo, cuándo, sobre qué fichero y por qué.
- Ejecuta un **watchdog** con **12 comprobaciones de integridad** en su propio
  disparador y avisa por Telegram cuando el resultado cambia.

Unas 670 líneas de Apps Script. Sin dependencias, sin build, sin servidor.

## Por qué está hecho así

Cuatro decisiones sostienen el conjunto. Cada una está documentada en
**[docs/DESIGN.md](docs/DESIGN.md)** junto al fallo que evita.

| Decisión | Fallo que evita |
|---|---|
| Identidad por hash de contenido, no por nombre | El mismo documento, renombrado, archivado dos veces |
| Escritura en dos fases: planificar y confirmar | Un corte a los seis minutos dejando un estado irreconstruible |
| Verificación en la fuente después de escribir | Confundir una llamada correcta con un resultado completado |
| Avisar por cambio de estado, no por calendario | Una alerta diaria que nadie lee a partir de la segunda semana |

Además, nunca borra ni sobrescribe. Cuando la respuesta correcta es ambigua
—mismo nombre, contenido distinto— registra la colisión y se detiene. Decide
una persona.

## Puesta en marcha

1. Crear un proyecto de Apps Script y copiar el contenido de `src/`.
   (O con [clasp](https://github.com/google/clasp): copiar
   `.clasp.json.example` a `.clasp.json`, añadir el id del script, `clasp push`.)
2. Crear en Drive una carpeta de entrada, una carpeta raíz de archivo y una
   hoja de cálculo vacía para el registro.
3. En **Configuración del proyecto → Propiedades del script**:

   | Propiedad | Obligatoria | Significado |
   |---|---|---|
   | `STAGING_FOLDER_ID` | sí | carpeta vigilada |
   | `ARCHIVE_ROOT_ID` | sí | raíz del árbol `AAAA/MM` |
   | `LEDGER_SPREADSHEET_ID` | sí | hoja con las pestañas `ledger` y `runs` |
   | `TELEGRAM_BOT_TOKEN` | no | si está vacía, las alertas solo se registran en el log |
   | `TELEGRAM_CHAT_ID` | no | destino de las alertas |
   | `DRY_RUN` | no | `true` por defecto; solo el literal `false` habilita los movimientos |

4. Ejecutar `checkNow()` y leer el log. Todas las comprobaciones deben pasar
   antes de permitir que nada se mueva.
5. Ejecutar `runConsolidation()` con `DRY_RUN` todavía en `true`: el registro
   se llena con el plan, el log muestra lo que *se movería*, Drive no se toca.
6. Poner `DRY_RUN` en `false` y ejecutar `installTriggers()`: consolidación
   diaria a las 03:00, watchdog cada seis horas.

No hay credenciales en el repositorio. `.clasp.json` está en `.gitignore`.

## Limitaciones conocidas

Declaradas, no descubiertas más tarde:

- Los ficheros por encima de `HASH_MAX_BYTES` (20 MB por defecto) no caben en
  memoria: su identidad pasa a ser nombre + tamaño + fecha. Esa clave es más
  débil y dos ficheros realmente distintos podrían colisionar.
- Una sola carpeta de entrada, sin recursión. Las subcarpetas se ignoran.
- El registro es una hoja de cálculo: sirve para miles de filas, no para millones.
- El archivo se organiza por fecha de creación del fichero. Un documento que
  se refiere a otro periodo se archivará por su fecha de subida.
- `BATCH_LIMIT` limita los ficheros por ejecución para no agotar la cuota: un
  atasco grande se drena en varias ejecuciones, por diseño.

## Licencia

MIT — ver [LICENSE](LICENSE).
