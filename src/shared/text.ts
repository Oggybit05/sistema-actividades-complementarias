/**
 * Limpieza de campos de texto que llegan por IPC.
 *
 * Los DTO declaran sus campos como `string`, pero TypeScript solo vigila el
 * código: lo que cruza de la ventana al proceso principal viaja serializado y
 * nadie garantiza que un campo opcional venga incluido. Cuando faltaba, el
 * `dto.description.trim()` de siempre reventaba con un
 * "Cannot read properties of undefined (reading 'trim')", que la profesora veía
 * como "no me deja guardar" sin ninguna pista de qué campo era el culpable.
 *
 * Por eso los campos de texto se normalizan aquí antes de tocar la base: los
 * obligatorios ya se rechazan en su propia validación, y los opcionales
 * (descripción, aula, días, teléfono) simplemente quedan vacíos.
 */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}
