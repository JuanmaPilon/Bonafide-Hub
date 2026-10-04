import { env } from "../config/env.js";

// ── CDN de Discord: URLs de adjuntos ────────────────────────────────
// Las imágenes que Karuta manda en sus embeds son adjuntos de Discord: la URL
// viene firmada con `?ex=<hex>&is=…&hm=…` y **deja de funcionar al vencer**
// (~24 h). Acá centralizamos cómo saber si una URL sigue vigente y cómo
// renovarla, para que las colecciones (y cartas) no se vean rotas.

const DISCORD_API_BASE = "https://discord.com/api/v10";
// Tratamos la URL como vencida un rato antes de su vencimiento real, así no
// guardamos una que está por morir.
const FRESH_MARGIN_MS = 5 * 60 * 1000;

function botToken(): string | undefined {
  return env.DISCORD_BOT_TOKEN?.trim() || undefined;
}

// ¿La URL tiene firma vigente? Si no hay `ex` asumimos que no vence (p. ej.
// una imagen externa o una URL vieja sin firma).
export function isDiscordCdnUrlFresh(url: string): boolean {
  try {
    const ex = new URL(url).searchParams.get("ex");
    if (!ex) {
      return true;
    }
    const expirySeconds = Number.parseInt(ex, 16);
    if (!Number.isFinite(expirySeconds)) {
      return true;
    }
    return expirySeconds * 1000 > Date.now() + FRESH_MARGIN_MS;
  } catch {
    return true;
  }
}

// POST /attachments/refresh-urls: renueva las URLs firmadas de adjuntos que
// sigan existiendo. Devuelve un mapa `original -> renovada` (vacío si falla).
export async function refreshDiscordAttachmentUrls(
  urls: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const token = botToken();
  if (!token || urls.length === 0) {
    return result;
  }
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/attachments/refresh-urls`,
      {
        body: JSON.stringify({ attachment_urls: urls.slice(0, 50) }),
        headers: {
          authorization: `Bot ${token}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      return result;
    }
    const data = (await response.json()) as {
      refreshed_urls?: Array<{ original_url?: string; refreshed_url?: string }>;
    };
    for (const entry of data.refreshed_urls ?? []) {
      if (entry.original_url && entry.refreshed_url) {
        result.set(entry.original_url, entry.refreshed_url);
      }
    }
  } catch {
    // Best-effort: si no se puede renovar, el caller decide.
  }
  return result;
}

// Descarga los bytes de una imagen del CDN (best-effort). Devuelve null si no
// es una imagen, es demasiado grande o falla. Sirve para cachear la imagen en
// nuestra DB y dejar de depender de la URL firmada.
export async function downloadDiscordImage(
  url: string,
  maxBytes: number,
): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!mimeType.startsWith("image/")) {
      return null;
    }
    const declared = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10,
    );
    if (Number.isFinite(declared) && declared > maxBytes) {
      return null;
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength === 0 || data.byteLength > maxBytes) {
      return null;
    }
    return { data, mimeType };
  } catch {
    return null;
  }
}

// Relee un mensaje de Discord y devuelve sus URLs de imagen vigentes (embed o
// adjuntos). Es el fallback "por puntero" cuando el refresco masivo no aplica:
// solo sirve para la imagen que el mensaje muestra HOY.
export async function fetchDiscordMessageImageUrls(
  channelId: string,
  messageId: string,
): Promise<string[]> {
  const token = botToken();
  if (!token) {
    return [];
  }
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      { headers: { authorization: `Bot ${token}` } },
    );
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as {
      attachments?: Array<{ proxy_url?: string; url?: string }>;
      embeds?: Array<{
        image?: { url?: string };
        thumbnail?: { url?: string };
      }>;
    };
    const urls: string[] = [];
    for (const embed of data.embeds ?? []) {
      const url = embed?.image?.url ?? embed?.thumbnail?.url;
      if (url) {
        urls.push(url);
      }
    }
    for (const attachment of data.attachments ?? []) {
      const url = attachment?.url ?? attachment?.proxy_url;
      if (url) {
        urls.push(url);
      }
    }
    return urls;
  } catch {
    return [];
  }
}
