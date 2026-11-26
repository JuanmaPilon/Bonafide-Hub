// Zona horaria con la que el API escribe fechas "de calendario" (día de la
// semana, día/mes/año). El servidor corre en UTC, así que sin esto un evento de
// las 21:00 ART cae en el día siguiente.
//
// Vivía copiada en tres lugares y una de las copias quedó en `Europe/Madrid`:
// el informe archivado de un raid del miércoles salía como "JUEVES 26/11"
// (21:00 ART = 01:00 del día siguiente en Madrid). Por eso está en un solo
// archivo: no hay forma de que se vuelva a desincronizar.
export const GUILD_TIME_ZONE = "America/Argentina/Buenos_Aires";
