// Re-encuadre de las imágenes de eventos para el aviso de Discord.
//
// Discord no permite fijar el ancho de un embed: la caja se ajusta a su
// contenido y la imagen se muestra a su tamaño natural (no la estira), así que
// una imagen angosta achica el aviso entero y quedan publicaciones de anchos
// distintos. Por eso la imagen se guarda ya re-encuadrada a este ancho: el
// texto (que llega hasta ~432 px) pasa a mandar y todas las cajas quedan
// parejas.
export const EMBED_IMAGE_MIN_WIDTH = 400;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer la imagen"));
    image.src = src;
  });
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
