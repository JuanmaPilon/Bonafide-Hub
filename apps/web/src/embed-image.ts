// Re-encuadre de las imágenes de eventos para el aviso de Discord.
//
// Discord no permite fijar el ancho de un embed: la caja se ajusta a su
// contenido y la imagen se muestra a su tamaño natural (no la estira), así que
// una imagen angosta achica el aviso entero y quedan publicaciones de anchos
// distintos. Por eso la imagen se guarda ya re-encuadrada a este ancho: el
// texto (que llega hasta ~432 px) pasa a mandar y todas las cajas quedan
// parejas.
export const EMBED_IMAGE_MIN_WIDTH = 400;

// Ancho máximo de una imagen guardada. Una imagen de raid viene en 2K/4K y 5-8
// MB; a este ancho se ve igual en el hub y en el embed, y lo que queda guardado
// (y lo que baja Discord cada vez que muestra el aviso) es una fracción. Sin
// esto, subir el límite de peso solo serviría para llenar la base de megas.
export const UPLOAD_IMAGE_MAX_WIDTH = 1920;
// Peso máximo del archivo que se elige (antes de reducir).
export const EVENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const EVENT_IMAGE_MAX_LABEL = "10MB";

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer la imagen"));
    image.src = src;
  });
}

// Reduce una imagen grande al ancho máximo, o la devuelve tal cual si ya entra
// (o si no se puede decodificar: en ese caso es mejor subirla como vino).
//
// Los GIF animados no se tocan: un canvas se queda con el primer cuadro y la
// animación se perdería. Si el navegador no sabe escribir WebP (el canvas
// devuelve PNG), se usa JPEG cuando la imagen no tiene transparencia.
export async function shrinkImageForUpload(
  dataUrl: string,
): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }
  if (dataUrl.startsWith("data:image/gif")) {
    return dataUrl;
  }

  const image = await loadImageElement(dataUrl).catch(() => null);
  if (!image || image.naturalWidth <= UPLOAD_IMAGE_MAX_WIDTH) {
    return dataUrl;
  }

  const scale = UPLOAD_IMAGE_MAX_WIDTH / image.naturalWidth;
  const width = UPLOAD_IMAGE_MAX_WIDTH;
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }
  context.drawImage(image, 0, 0, width, height);

  const webp = canvas.toDataURL("image/webp", 0.9);
  if (webp.startsWith("data:image/webp")) {
    return webp;
  }
  // Sin WebP, el JPEG es lo más liviano, pero aplana la transparencia a negro:
  // una imagen con alfa se queda en PNG (más pesada, pero se ve bien).
  return dataUrl.startsWith("data:image/png")
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.9);
}

// Devuelve la data URL re-encuadrada, o la misma si no hace falta tocarla (ya es
// ancha, no es una imagen, es un GIF animado —el canvas lo dejaría quieto— o no
// se pudo decodificar). El arte queda centrado y los costados se completan
// estirando sus columnas de borde, así no aparece un marco ni un color
// inventado que se vea mal en el tema claro del embed.
export async function padImageForEmbed(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }
  if (dataUrl.startsWith("data:image/gif")) {
    return dataUrl;
  }

  const image = await loadImageElement(dataUrl).catch(() => null);
  if (!image || image.naturalWidth >= EMBED_IMAGE_MIN_WIDTH) {
    return dataUrl;
  }

  const height = image.naturalHeight;
  const left = Math.round((EMBED_IMAGE_MIN_WIDTH - image.naturalWidth) / 2);
  const right = EMBED_IMAGE_MIN_WIDTH - image.naturalWidth - left;

  const canvas = document.createElement("canvas");
  canvas.width = EMBED_IMAGE_MIN_WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }

  if (left > 0) {
    context.drawImage(image, 0, 0, 1, height, 0, 0, left, height);
  }
  if (right > 0) {
    context.drawImage(
      image,
      image.naturalWidth - 1,
      0,
      1,
      height,
      EMBED_IMAGE_MIN_WIDTH - right,
      0,
      right,
      height,
    );
  }
  context.drawImage(image, left, 0);

  return canvas.toDataURL("image/png");
}
