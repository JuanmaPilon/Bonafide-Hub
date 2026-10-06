// Copiar al portapapeles. Puede fallar sin permiso del navegador o fuera de un
// contexto seguro (http sin TLS): devuelve si salió bien y el que llama decide
// qué avisar, así el mensaje de cada acción queda en su lugar.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
